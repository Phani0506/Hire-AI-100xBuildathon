
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

// Best-effort PDF text extraction
async function extractTextFromPDF(arrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '', pdfAsString = '';
    for (let i = 0; i < uint8Array.length; i++) pdfAsString += String.fromCharCode(uint8Array[i]);
    const streamMatches = pdfAsString.match(/stream([\s\S]*?)endstream/g) || [];
    for (const stream of streamMatches) {
      const content = stream.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '');
      const textMatches = content.match(/\((.*?)\)/g) || [];
      textMatches.forEach((match) => {
        const cleaned = match.slice(1, -1).replace(/\\(r|n|t)/g, ' ').replace(/\\/g, '').trim();
        if (cleaned.length > 2 && /[a-zA-Z]/.test(cleaned)) text += cleaned + ' ';
      });
    }
    return text.replace(/\s+/g, ' ').trim();
  } catch { 
    return ''; 
  }
}

// Main Server Logic
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
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
    let text = '';
    const fileName = filePath.toLowerCase();
    
    if (fileName.endsWith('.pdf')) {
      text = await extractTextFromPDF(await fileData.arrayBuffer());
    } else if (fileName.endsWith('.txt')) {
      text = await fileData.text();
    } else {
      // For other file types (doc, docx, images), we'll try to extract what we can
      try {
        text = await fileData.text();
      } catch {
        text = ''; // If we can't extract text, we'll proceed with empty text
      }
    }

    console.log(`Text extracted, length: ${text.length} characters`);

    let cleanText = text.replace(/\s+/g, ' ').trim();
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
    if (cleanText.length > 50) {
      console.log(`Attempting AI parsing for resume ${resumeId}...`);
      
      try {
        // Single comprehensive parsing call
        const aiPrompt = `
Extract resume information from the following text and return it as a JSON object with this exact structure:
{
  "full_name": "candidate's full name or null",
  "email": "email address or null", 
  "phone": "phone number or null",
  "location": "city, state/country or null",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": [{"title": "job title", "company": "company name", "duration": "time period", "description": "brief description"}],
  "education": [{"degree": "degree name", "institution": "school name", "year": "graduation year"}]
}

Resume text: "${cleanText}"
`;

        const aiResult = await getGroqCompletion(aiPrompt);
        console.log(`AI parsing result: ${aiResult}`);
        
        const parsed = JSON.parse(aiResult);
        
        // Map the AI result to our database structure
        parsedContent = {
          full_name: parsed.full_name || null,
          email: parsed.email || null,
          phone: parsed.phone || null,
          location: parsed.location || null,
          skills_json: Array.isArray(parsed.skills) ? parsed.skills : [],
          experience_json: Array.isArray(parsed.experience) ? parsed.experience : [],
          education_json: Array.isArray(parsed.education) ? parsed.education : [],
          raw_text_content: cleanText
        };
        
        console.log(`Parsed content: ${JSON.stringify(parsedContent)}`);
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        // Continue with empty parsedContent - we'll still insert the record
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
