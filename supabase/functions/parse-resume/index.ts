
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// A best-effort PDF text extraction function.
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

    if (!/([a-zA-Z0-9\s.,@]){50,}/.test(text)) throw new Error('Text extraction failed or the PDF is image-based.');

    let cleanText = text.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 4000) cleanText = cleanText.substring(0, 4000);
    
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are an expert resume parsing assistant. Your response MUST be a single, valid JSON object with these fields: "full_name", "email", "phone", "location", "summary", "skills" (array of strings), "experience" (array of objects with "title", "company", "duration", "description"), "education" (array with "degree", "institution", "year"). Use null or empty arrays for missing fields.' },
          { role: 'user', content: `Extract from this resume: ${cleanText}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      })
    });

    if (!groqResponse.ok) throw new Error(`Groq API failed: ${await groqResponse.text()}`);

    const parsedContent = (await groqResponse.json()).choices[0].message.content;
    const { data: resumeData } = await serviceClient.from('resumes').select('user_id').eq('id', resumeId).single();
    if (!resumeData) throw new Error(`Resume with ID ${resumeId} not found.`);

    await serviceClient.from('parsed_resume_details').insert({
      resume_id: resumeId, user_id: resumeData.user_id,
      ...JSON.parse(parsedContent),
      raw_text_content: cleanText
    });

    await serviceClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId);

    return new Response(JSON.stringify({ success: true }), { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  } catch (error) {
    if (resumeId) {
      try {
        const serviceClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
        await serviceClient.from('resumes').update({ parsing_status: 'failed' }).eq('id', resumeId);
      } catch (e) { console.error('Fatal error updating status:', e) }
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });
  }
});
