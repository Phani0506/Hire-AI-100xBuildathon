
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

// Improved PDF text extraction
async function extractTextFromPDF(arrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string safely
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfAsString = decoder.decode(uint8Array);
    
    // Extract text from different PDF structures
    const patterns = [
      /BT[\s\S]*?ET/g, // Text objects
      /\((.*?)\)/g,    // Text in parentheses
      /\[(.*?)\]/g,    // Text in brackets
      /\/F\d+\s+\d+\s+Tf\s*\((.*?)\)/g, // Font text
    ];
    
    for (const pattern of patterns) {
      const matches = pdfAsString.match(pattern) || [];
      for (const match of matches) {
        let cleanText = match
          .replace(/BT|ET|Tf|TJ|Tj|'|"/g, ' ')
          .replace(/\/F\d+\s+\d+\s+/g, ' ')
          .replace(/[\(\)\[\]]/g, ' ')
          .replace(/\\n|\\r|\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E\u00A0-\u017F]/g, ' ') // Keep only printable ASCII + Latin-1
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanText.length > 2 && /[a-zA-Z@.]/.test(cleanText)) {
          text += cleanText + ' ';
        }
      }
    }
    
    // Additional extraction for stream content
    const streams = pdfAsString.match(/stream([\s\S]*?)endstream/g) || [];
    for (const stream of streams) {
      const streamContent = stream.replace(/^stream\s*/, '').replace(/\s*endstream$/, '');
      const textMatches = streamContent.match(/\((.*?)\)/g) || [];
      
      for (const match of textMatches) {
        let cleanText = match
          .replace(/[\(\)]/g, '')
          .replace(/\\n|\\r|\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E\u00A0-\u017F]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanText.length > 2 && /[a-zA-Z@.]/.test(cleanText)) {
          text += cleanText + ' ';
        }
      }
    }
    
    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Clean text for database storage
function cleanTextForDatabase(text) {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, ' ') // Replace special spaces
    .replace(/[^\x20-\x7E\u00A0-\u017F]/g, '') // Keep only safe characters
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
      try {
        rawText = await fileData.text();
      } catch {
        rawText = '';
      }
    }

    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, length: ${cleanText.length} characters`);
    console.log(`First 500 characters: ${cleanText.substring(0, 500)}`);

    // Get resume user_id
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

    // Only try AI parsing if we have sufficient text
    if (cleanText.length > 100) {
      console.log(`Attempting AI parsing for resume ${resumeId}...`);
      
      try {
        const aiPrompt = `
You are a professional resume parser. Extract information from the following resume text and return it as a JSON object with this EXACT structure:

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
      "description": "Developed web applications using React and Node.js"
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

Instructions:
- Extract the person's full name from headers or contact sections
- Find email addresses (look for @ symbols)
- Extract phone numbers (various formats)
- Find location/address information
- List all skills, technologies, programming languages mentioned
- Extract work experience with job titles, companies, dates, and descriptions
- Extract education with degrees, schools, and graduation years
- If information is not found, use null for strings and empty arrays for lists
- Be thorough and look for information throughout the entire text

Resume text:
${cleanText}
`;

        const aiResult = await getGroqCompletion(aiPrompt);
        console.log(`AI parsing result: ${aiResult}`);
        
        const parsed = JSON.parse(aiResult);
        
        // Validate and map the AI result
        parsedContent = {
          full_name: parsed.full_name && typeof parsed.full_name === 'string' ? parsed.full_name.trim() : null,
          email: parsed.email && typeof parsed.email === 'string' ? parsed.email.trim() : null,
          phone: parsed.phone && typeof parsed.phone === 'string' ? parsed.phone.trim() : null,
          location: parsed.location && typeof parsed.location === 'string' ? parsed.location.trim() : null,
          skills_json: Array.isArray(parsed.skills) ? parsed.skills.filter(s => s && typeof s === 'string') : [],
          experience_json: Array.isArray(parsed.experience) ? parsed.experience.filter(exp => exp && typeof exp === 'object') : [],
          education_json: Array.isArray(parsed.education) ? parsed.education.filter(edu => edu && typeof edu === 'object') : [],
          raw_text_content: cleanText
        };
        
        console.log(`Successfully parsed content:`, JSON.stringify(parsedContent, null, 2));
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        console.log('Continuing with empty parsed content...');
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
