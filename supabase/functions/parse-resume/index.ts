
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// A best-effort PDF text extraction function.
async function extractTextFromPDF(arrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    let pdfAsString = '';
    for (let i = 0; i < uint8Array.length; i++) {
        pdfAsString += String.fromCharCode(uint8Array[i]);
    }
    const streamMatches = pdfAsString.match(/stream([\s\S]*?)endstream/g) || [];
    for (const stream of streamMatches) {
      const content = stream.replace(/^stream\r?\n/, '').replace(/\r?\nendstream$/, '');
      const textMatches = content.match(/\((.*?)\)/g) || [];
      textMatches.forEach((match) => {
        const cleaned = match.slice(1, -1).replace(/\\(r|n|t)/g, ' ').replace(/\\/g, '').trim();
        if (cleaned.length > 2 && /[a-zA-Z]/.test(cleaned)) {
          text += cleaned + ' ';
        }
      });
    }
    text = text.replace(/\s+/g, ' ').trim();
    console.log(`Extracted ${text.length} characters from PDF.`);
    return text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let resumeId;
  try {
    const requestBody = await req.json();
    resumeId = requestBody.resumeId; 
    const { filePath } = requestBody;

    if (!resumeId || !filePath) {
      throw new Error('Missing resumeId or filePath in the request body.');
    }
    
    console.log('Processing resume:', { resumeId, filePath });

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: fileData, error: downloadError } = await supabaseClient
      .storage
      .from('resumes')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    let extractedText = '';
    const lowerFilePath = filePath.toLowerCase();

    if (lowerFilePath.endsWith('.pdf')) {
      extractedText = await extractTextFromPDF(await fileData.arrayBuffer());
    } else if (lowerFilePath.endsWith('.txt')) {
      extractedText = await fileData.text();
    } else {
      throw new Error(`Unsupported file type: ${filePath}. Please upload a PDF or TXT file.`);
    }

    if (!/([a-zA-Z0-9\s.,@]){100,}/.test(extractedText)) {
       console.error('Raw extracted text (first 500 chars):', extractedText.substring(0, 500));
       throw new Error('Text extraction failed or the PDF is image-based. Could not find readable content.');
    }

    console.log('Raw extracted text appears valid. Proceeding.');
    let cleanText = extractedText.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 4000) cleanText = cleanText.substring(0, 4000);
    
    console.log(`Sending ${cleanText.length} characters to AI.`);

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: 'You are an expert resume parsing assistant. Analyze the provided resume text and extract key information. Your response MUST be a single, valid JSON object and nothing else. The JSON object should have these fields: "full_name", "email", "phone", "location", "summary", "skills" (array of strings), "experience" (array of objects with "title", "company", "duration", "description" fields), "education" (array of objects with "degree", "institution", "year" fields). If a field is not found, use null or an empty array.'
          },
          { role: 'user', content: `Extract data from this resume text: ${cleanText}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 2048,
      })
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      throw new Error(`Groq API failed with status ${groqResponse.status}: ${errorText}`);
    }

    const groqData = await groqResponse.json();
    const messageContent = groqData.choices?.[0]?.message?.content;
    if (!messageContent) throw new Error('Invalid or empty response from Groq AI.');
    
    const parsedContent = JSON.parse(messageContent);
    console.log('Successfully parsed AI response.');

    const { data: resumeData, error: resumeError } = await supabaseClient
      .from('resumes').select('user_id').eq('id', resumeId).single();

    if (resumeError) throw new Error(`Database error when fetching resume: ${resumeError.message}`);
    if (!resumeData) throw new Error(`Resume with ID ${resumeId} not found. This is likely a permission issue due to Row Level Security (RLS).`);

    const { error: insertError } = await supabaseClient.from('parsed_resume_details').insert({
      resume_id: resumeId, user_id: resumeData.user_id,
      full_name: parsedContent.full_name || null, email: parsedContent.email || null,
      phone: parsedContent.phone || null, location: parsedContent.location || null,
      summary: parsedContent.summary || null, skills_json: parsedContent.skills || [],
      experience_json: parsedContent.experience || [], education_json: parsedContent.education || [],
      raw_text_content: cleanText
    });

    if (insertError) throw new Error(`Failed to store parsed data: ${insertError.message}`);

    await supabaseClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId);

    console.log('Resume parsing completed successfully for resumeId:', resumeId);
    return new Response(JSON.stringify({ success: true, parsedData: parsedContent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error(`Error processing resume ${resumeId || 'unknown'}:`, error.message);
    
    if (resumeId) {
      try {
        // Use a service_role client to guarantee the status update works
        const serviceClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        await serviceClient.from('resumes').update({ parsing_status: 'failed' }).eq('id', resumeId);
        console.log(`Updated resume ${resumeId} status to 'failed'.`);
      } catch (updateError) {
        console.error('Fatal: Failed to update resume status to failed.', updateError);
      }
    }
    
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
