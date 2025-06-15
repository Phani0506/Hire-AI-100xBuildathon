// Final parsing logic: Multi-call strategy
// PASTE THIS ENTIRE CODE INTO supabase/functions/parse-resume/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// --- Helper Function to Call Groq AI ---
// This centralizes the API call logic and makes the main function cleaner.
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
      // Force JSON output for prompts that request it
      response_format: prompt.toLowerCase().includes('json') ? { type: "json_object" } : undefined,
    })
  });
  if (!groqResponse.ok) {
    throw new Error(`Groq API failed: ${await groqResponse.text()}`);
  }
  const groqData = await groqResponse.json();
  return groqData.choices[0].message.content;
}

// --- Best-effort PDF text extraction ---
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
  } catch { return ''; }
}


// --- Main Server Logic ---
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
  }

  let resumeId;
  try {
    const body = await req.json();
    resumeId = body.resumeId;
    const filePath = body.filePath;
    
    if (!resumeId || !filePath) throw new Error(`Missing resumeId or filePath. Body received: ${JSON.stringify(body)}`);
    
    const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

    const { data: fileData, error: downloadError } = await serviceClient.storage.from('resumes').download(filePath);
    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    let text = '';
    if (filePath.toLowerCase().endsWith('.pdf')) text = await extractTextFromPDF(await fileData.arrayBuffer());
    else if (filePath.toLowerCase().endsWith('.txt')) text = await fileData.text();
    else throw new Error(`Unsupported file type: ${filePath}.`);

    if (!/([a-zA-Z0-9\s.,@]){50,}/.test(text)) {
       throw new Error('Text extraction failed or the PDF is image-based.');
    }

    let cleanText = text.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 6000) cleanText = cleanText.substring(0, 6000); // Allow more text for better context
    
    console.log(`Starting multi-call parsing for resume ${resumeId}...`);

    // --- Execute Multiple Focused API Calls in Parallel ---
    const [nameResult, contactResult, skillsResult, experienceResult, educationResult] = await Promise.all([
      getGroqCompletion(`From the resume text below, extract ONLY the full name of the person. Nothing else. \n\nTEXT: "${cleanText}"`),
      getGroqCompletion(`From the resume text below, extract the email and phone number into a JSON object like {"email": "...", "phone": "..."}. \n\nTEXT: "${cleanText}"`),
      getGroqCompletion(`From the resume text below, extract up to 15 key technical skills and return them in a JSON object like {"skills": ["skill1", "skill2", ...]}. \n\nTEXT: "${cleanText}"`),
      getGroqCompletion(`From the resume text below, extract the work experience into a JSON object like {"experience": [{"title": "...", "company": "...", "duration": "...", "description": "..."}, ...]}. \n\nTEXT: "${cleanText}"`),
      getGroqCompletion(`From the resume text below, extract education into a JSON object like {"education": [{"degree": "...", "institution": "...", "year": "..."}]}. \n\nTEXT: "${cleanText}"`),
    ]);

    console.log("All parsing calls completed.");

    // --- Combine the results from all calls ---
    const parsedContent = {
      full_name: nameResult.trim(),
      email: JSON.parse(contactResult).email || null,
      phone: JSON.parse(contactResult).phone || null,
      skills_json: JSON.parse(skillsResult).skills || [],
      experience_json: JSON.parse(experienceResult).experience || [],
      education_json: JSON.parse(educationResult).education || [],
      summary: null, // Summary is less critical, can be omitted for now
      raw_text_content: cleanText
    };

    const { data: resumeData } = await serviceClient.from('resumes').select('user_id').eq('id', resumeId).single();
    if (!resumeData) throw new Error(`Resume with ID ${resumeId} not found.`);

    // --- Insert the fully parsed data into the database ---
    await serviceClient.from('parsed_resume_details').insert({
      resume_id: resumeId, 
      user_id: resumeData.user_id,
      ...parsedContent
    });

    await serviceClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId);

    console.log(`Successfully parsed and stored details for resume ${resumeId}.`);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`Error processing resume ${resumeId || 'unknown'}:`, error.message);
    if (resumeId) {
      try {
        const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
        await serviceClient.from('resumes').update({ parsing_status: 'failed', parsing_error: error.message }).eq('id', resumeId);
      } catch (e) { console.error('Fatal error updating status:', e) }
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  }
});
