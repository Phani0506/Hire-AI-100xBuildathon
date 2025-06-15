
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Import PDF.js-extract (browser-compatible) for splitting and extracting PDF images
import * as pdfjsLib from "https://cdn.skypack.dev/pdfjs-dist@3.11.174/legacy/build/pdf.js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

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

// Extract images as data URLs from PDF using PDF.js
async function extractImagesFromPDF(arrayBuffer) {
  try {
    const loadingTask = pdfjsLib.getDocument({data: arrayBuffer});
    const pdf = await loadingTask.promise;
    const images = [];

    for(let pageNum = 1; pageNum <= pdf.numPages && pageNum <= 5; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const ops = await page.getOperatorList();
      const objs = page.objs;

      const viewport = page.getViewport({ scale: 2.0 });
      // Create canvas in JS (simulate HTML canvas)
      const canvas = new OffscreenCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      // Render the page into this canvas
      await page.render({ canvasContext: context, viewport }).promise;
      // Export to PNG
      const blob = await canvas.convertToBlob();
      const arrayBufferImg = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBufferImg)));
      images.push(`data:image/png;base64,${base64}`);
    }

    console.log(`Extracted ${images.length} images from PDF`);
    return images;
  } catch (e) {
    console.error('Failed to extract images from PDF:', e);
    return [];
  }
}

// OCR : Send image to Hugging Face Inference API (returns text)
async function ocrImage(base64Image) {
  const HF_TOKEN = Deno.env.get("HUGGING_FACE_ACCESS_TOKEN");
  if (!HF_TOKEN) throw new Error("Missing Hugging Face token (HUGGING_FACE_ACCESS_TOKEN)");

  const response = await fetch('https://api-inference.huggingface.co/models/microsoft/trocr-base-stage1', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: base64Image
    })
  });
  if (!response.ok) throw new Error('Hugging Face OCR failed: ' + (await response.text()));
  const result = await response.json();
  // HF returns either an object {text: "..."} or [{text: "..."}]
  if (typeof result === "object" && Array.isArray(result) && result.length && result[0].text) {
    return result.map(x => x.text).join(' ');
  }
  if (typeof result === "object" && result.text) {
    return result.text;
  }
  return "";
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let resumeId;
  try {
    const requestBody = await req.json();
    resumeId = requestBody.resumeId;
    const filePath = requestBody.filePath;
    
    if (!resumeId || !filePath) {
      throw new Error(`Missing resumeId or filePath in the request body. Body received: ${JSON.stringify(requestBody)}`);
    }
    
    console.log('Processing resume:', { resumeId, filePath });
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: fileData, error: downloadError } = await supabaseClient
      .storage
      .from('resumes')
      .download(filePath);

    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    let extractedText = '';
    if (filePath.toLowerCase().endsWith('.pdf')) {
      extractedText = await extractTextFromPDF(await fileData.arrayBuffer());
      // If text extraction failed or is very short, try OCR for each page
      if (!/([a-zA-Z0-9\s.,@]){50,}/.test(extractedText)) {
        console.log('Primary extraction failed or resulted in little text. Running OCR...');
        const images = await extractImagesFromPDF(await fileData.arrayBuffer());
        let ocrResult = '';
        for (const img of images) {
          const ocrText = await ocrImage(img);
          ocrResult += ocrText + " ";
        }
        ocrResult = ocrResult.replace(/\s+/g, " ").trim();
        console.log(`OCR extracted ${ocrResult.length} characters`);
        if (/([a-zA-Z0-9\s.,@]){50,}/.test(ocrResult)) {
          extractedText = ocrResult;
        } else {
          throw new Error('Text extraction failed: PDF is likely not a valid resume or is too empty for OCR.');
        }
      }
    } else if (filePath.toLowerCase().endsWith('.txt')) {
      extractedText = await fileData.text();
    } else {
      throw new Error(`Unsupported file type: ${filePath}.`);
    }

    let cleanText = extractedText.replace(/\s+/g, ' ').trim();
    if (cleanText.length > 4000) cleanText = cleanText.substring(0, 4000);
    
    console.log(`Sending ${cleanText.length} chars to AI.`);

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: 'You are an expert resume parsing assistant. Analyze the provided resume text and extract key information. Your response MUST be a single, valid JSON object and nothing else. The JSON object should have these fields: "full_name", "email", "phone", "location", "summary", "skills" (array of strings), "experience" (array of objects with "title", "company", "duration", "description" fields), "education" (array of objects with "degree", "institution", "year" fields). If a field is not found, use null or an empty array.' },
          { role: 'user', content: `Extract data from this resume text: ${cleanText}` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 2048,
      })
    });

    if (!groqResponse.ok) {
      throw new Error(`Groq API failed: ${await groqResponse.text()}`);
    }

    const groqData = await groqResponse.json();
    const messageContent = groqData.choices?.[0]?.message?.content;
    if (!messageContent) throw new Error('Invalid or empty response from Groq AI.');
    
    const parsedContent = JSON.parse(messageContent);
    console.log('Successfully parsed AI response.');

    const { data: resumeData, error: resumeError } = await supabaseClient
      .from('resumes').select('user_id').eq('id', resumeId).single();

    if (resumeError) throw new Error(`DB error fetching resume: ${resumeError.message}`);
    if (!resumeData) throw new Error(`Resume with ID ${resumeId} not found.`);

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
