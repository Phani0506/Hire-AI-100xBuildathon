
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Helper Function to Call Groq AI
async function getGroqCompletion(prompt, model = 'llama3-8b-8192') {
  const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
    })
  });
  
  if (!groqResponse.ok) {
    throw new Error(`Groq API failed: ${await groqResponse.text()}`);
  }
  
  const groqData = await groqResponse.json();
  return groqData.choices[0].message.content;
}

// Improved PDF text extraction with better Unicode handling
async function extractTextFromPDF(arrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string more safely
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfAsString = decoder.decode(uint8Array);
    
    // Look for text objects and streams
    const textMatches = pdfAsString.match(/\((.*?)\)/g) || [];
    const streamMatches = pdfAsString.match(/stream([\s\S]*?)endstream/g) || [];
    
    // Extract text from parentheses (direct text objects)
    for (const match of textMatches) {
      const content = match.slice(1, -1)
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      
      if (content.length > 2 && /[a-zA-Z@.]/.test(content)) {
        text += content + ' ';
      }
    }
    
    // Extract text from streams
    for (const stream of streamMatches) {
      const content = stream.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '');
      const streamTextMatches = content.match(/\((.*?)\)/g) || [];
      
      for (const match of streamTextMatches) {
        const cleaned = match.slice(1, -1)
          .replace(/\\n/g, ' ')
          .replace(/\\r/g, ' ')
          .replace(/\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\');
        
        if (cleaned.length > 2 && /[a-zA-Z@.]/.test(cleaned)) {
          text += cleaned + ' ';
        }
      }
    }
    
    // Clean up the extracted text
    text = text
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\u00A0-\u017F\u0100-\u024F]/g, '') // Remove problematic Unicode
      .trim();
    
    return text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Clean text to remove problematic characters
function cleanTextForDatabase(text) {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
    .replace(/[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F]/g, ' ') // Replace various Unicode spaces
    .replace(/[^\x20-\x7E\u00A0-\u017F\u0100-\u024F\u0400-\u04FF]/g, '') // Keep only safe Unicode ranges
    .replace(/\s+/g, ' ')
    .trim();
}

// Main Server Logic
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: { 
        'Access-Control-Allow-Origin': '*', 
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' 
      } 
    });
  }

  let resumeId;
  try {
    const body = await req.json();
    resumeId = body.resumeId;
    const filePath = body.filePath;
    
    if (!resumeId || !filePath) {
      throw new Error(`Missing resumeId or filePath. Body received: ${JSON.stringify(body)}`);
    }
    
    console.log(`Starting parsing for resume ${resumeId} with file path: ${filePath}`);
    
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Download the file
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('resumes')
      .download(filePath);
      
    if (downloadError) {
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    console.log(`File downloaded successfully: ${filePath}`);

    // Extract text from different file types
    let rawText = '';
    const fileName = filePath.toLowerCase();
    
    if (fileName.endsWith('.pdf')) {
      rawText = await extractTextFromPDF(await fileData.arrayBuffer());
    } else if (fileName.endsWith('.txt')) {
      rawText = await fileData.text();
    } else {
      // For other file types, try to extract what we can
      try {
        rawText = await fileData.text();
      } catch {
        rawText = ''; // If we can't extract text, proceed with empty text
      }
    }

    // Clean the text for database storage
    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, length: ${cleanText.length} characters`);

    // Limit text length for processing
    if (cleanText.length > 8000) {
      cleanText = cleanText.substring(0, 8000);
    }

    // Get resume user_id for the insert
    const { data: resumeData, error: resumeError } = await serviceClient
      .from('resumes')
      .select('user_id')
      .eq('id', resumeId)
      .single();

    if (resumeError || !resumeData) {
      throw new Error(`Resume with ID ${resumeId} not found: ${resumeError?.message}`);
    }

    // Initialize default parsed content
    let parsedContent = {
      full_name: null,
      email: null,
      phone: null,
      location: null,
      skills_json: [],
      experience_json: [],
      education_json: [],
      raw_text_content: cleanText
    };

    // Only try AI parsing if we have sufficient clean text
    if (cleanText.length > 50) {
      console.log(`Attempting AI parsing for resume ${resumeId}...`);
      
      try {
        const aiPrompt = `
You are a resume parser. Extract information from the following resume text and return it as a JSON object with this exact structure:

{
  "full_name": "John Doe",
  "email": "john@example.com", 
  "phone": "+1-555-123-4567",
  "location": "New York, NY",
  "skills": ["JavaScript", "React", "Node.js"],
  "experience": [
    {
      "title": "Software Engineer",
      "company": "Tech Company", 
      "duration": "2020-2023",
      "description": "Developed web applications"
    }
  ],
  "education": [
    {
      "degree": "Bachelor of Science in Computer Science",
      "institution": "University Name",
      "year": "2020"
    }
  ]
}

Extract as much information as possible. If a field is not found, use null for strings or empty array for arrays.

Resume text:
${cleanText}
`;

        const aiResult = await getGroqCompletion(aiPrompt);
        console.log(`AI parsing result: ${aiResult}`);
        
        const parsed = JSON.parse(aiResult);
        
        // Map the AI result to our database structure with proper validation
        parsedContent = {
          full_name: typeof parsed.full_name === 'string' ? parsed.full_name : null,
          email: typeof parsed.email === 'string' ? parsed.email : null,
          phone: typeof parsed.phone === 'string' ? parsed.phone : null,
          location: typeof parsed.location === 'string' ? parsed.location : null,
          skills_json: Array.isArray(parsed.skills) ? parsed.skills : [],
          experience_json: Array.isArray(parsed.experience) ? parsed.experience : [],
          education_json: Array.isArray(parsed.education) ? parsed.education : [],
          raw_text_content: cleanText
        };
        
        console.log(`Parsed content: ${JSON.stringify(parsedContent)}`);
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        // Continue with default parsedContent - we'll still insert the record
      }
    } else {
      console.log(`Insufficient text for AI parsing (${cleanText.length} characters)`);
    }

    // Insert the parsed data into the database
    const { error: insertError } = await serviceClient
      .from('parsed_resume_details')
      .insert({
        resume_id: resumeId,
        user_id: resumeData.user_id,
        ...parsedContent
      });

    if (insertError) {
      console.error(`Failed to insert parsed details: ${insertError.message}`);
      throw insertError;
    }

    // Update resume status to completed
    const { error: updateError } = await serviceClient
      .from('resumes')
      .update({ parsing_status: 'completed' })
      .eq('id', resumeId);

    if (updateError) {
      console.error(`Failed to update resume status: ${updateError.message}`);
      throw updateError;
    }

    console.log(`Successfully parsed and stored details for resume ${resumeId}`);
    
    return new Response(
      JSON.stringify({ 
        success: true,
        parsed: parsedContent
      }), 
      { 
        headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error(`Error processing resume ${resumeId || 'unknown'}:`, error.message);
    
    if (resumeId) {
      try {
        const serviceClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '', 
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        await serviceClient
          .from('resumes')
          .update({ 
            parsing_status: 'failed', 
            parsing_error: error.message 
          })
          .eq('id', resumeId);
      } catch (e) { 
        console.error('Fatal error updating status:', e); 
      }
    }
    
    return new Response(
      JSON.stringify({ error: error.message }), 
      { 
        status: 500, 
        headers: { 
          'Access-Control-Allow-Origin': '*', 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
