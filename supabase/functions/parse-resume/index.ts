import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// Extract text content from PDF by scanning for text patterns (good for text-based PDFs)
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
    console.log(`Extracted ${text.length} characters from PDF by internal method.`);
    return text;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// OCR: Send file to Hugging Face Inference API (returns extracted text)
async function ocrDocument(base64Str, mimeType) {
  const HF_TOKEN = Deno.env.get("HUGGING_FACE_ACCESS_TOKEN");
  if (!HF_TOKEN) throw new Error("Missing Hugging Face token (HUGGING_FACE_ACCESS_TOKEN)");

  // Try a standard English document OCR Model
  // You may change model to "microsoft/trocr-base-stage1" or another as desired
  const response = await fetch('https://api-inference.huggingface.co/models/impira/layoutlm-document-qa', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: `data:${mimeType};base64,${base64Str}`
    })
  });
  if (!response.ok) throw new Error('Hugging Face OCR failed: ' + (await response.text()));
  const result = await response.json();
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
      throw new Error(`Missing resumeId or filePath in request. Received body: ${JSON.stringify(requestBody)}`);
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

    if (downloadError) {
      console.error("Failed to download file:", downloadError);
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    let extractedText = '';
    const fileExt = filePath.split('.').pop()?.toLowerCase();
    let docBuffer = await fileData.arrayBuffer();
    let mimeType = "application/pdf";
    if (fileExt === "txt") mimeType = "text/plain";
    else if (fileExt === "docx") mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if (fileExt === "doc") mimeType = "application/msword";
    else if (fileExt === "rtf") mimeType = "application/rtf";
    else if (fileExt === "odt") mimeType = "application/vnd.oasis.opendocument.text";
    else mimeType = "application/octet-stream";

    let attemptedOcr = false;
    let base64File = '';
    let textExtractionReason = '';

    if (fileExt === "pdf") {
      // 1. Try internal text extraction
      extractedText = await extractTextFromPDF(docBuffer);

      // 1a. If internal extraction fails/few chars, always do OCR
      if (!/([a-zA-Z0-9\s.,@]){30,}/.test(extractedText)) {
        try {
          attemptedOcr = true;
          textExtractionReason = 'Primary PDF text extraction too short or failed. Performing document OCR...';
          console.log(textExtractionReason);

          base64File = btoa(String.fromCharCode(...new Uint8Array(docBuffer)));
          let ocrText = await ocrDocument(base64File, mimeType);
          ocrText = (ocrText || '').replace(/\s+/g, ' ').trim();
          if (/([a-zA-Z0-9\s.,@]){30,}/.test(ocrText)) {
            extractedText = ocrText;
            console.log(`[OCR] Extracted text: ${ocrText.length} chars.`);
          } else {
            throw new Error('Text extraction failed: Resume appears to be unreadable or too empty even for OCR.');
          }
        } catch (ocrErr) {
          console.error("PDF OCR fallback failed:", ocrErr);
          throw new Error(`PDF text extraction and OCR both failed: ${ocrErr.message}`);
        }
      } else {
        console.log(`[NativeText] Extracted text: ${extractedText.length} chars.`);
      }
    } else if (
      fileExt === "docx" ||
      fileExt === "doc" ||
      fileExt === "rtf" ||
      fileExt === "odt"
    ) {
      try {
        // 2. Always do OCR for non-text files, since we can't parse DOCX directly in Deno
        textExtractionReason = 'Performing OCR for document type: ' + fileExt;
        console.log(textExtractionReason);
        attemptedOcr = true;
        base64File = btoa(String.fromCharCode(...new Uint8Array(docBuffer)));
        let ocrText = await ocrDocument(base64File, mimeType);
        ocrText = (ocrText || '').replace(/\s+/g, ' ').trim();
        if (/([a-zA-Z0-9\s.,@]){30,}/.test(ocrText)) {
          extractedText = ocrText;
          console.log(`[OCR] Extracted text: ${ocrText.length} chars from ${fileExt}.`);
        } else {
          throw new Error('Text extraction failed: Document appears unreadable even with OCR.');
        }
      } catch (ocrErr) {
        console.error(`[${fileExt.toUpperCase()}] OCR failed:`, ocrErr);
        throw new Error(`${fileExt.toUpperCase()} OCR and text extraction failed: ${ocrErr.message}`);
      }
    } else if (fileExt === "txt") {
      try {
        extractedText = await fileData.text();
        if (!/([a-zA-Z0-9\s.,@]){30,}/.test(extractedText)) {
          extractedText = '';
          console.warn('Plaintext resume is too short to parse.');
        }
      } catch (txtErr) {
        console.error("TXT extraction failed:", txtErr);
        throw new Error(`TXT extraction failed: ${txtErr.message}`);
      }
    } else {
      // Unknown file type, try OCR as last-resort fallback.
      try {
        attemptedOcr = true;
        textExtractionReason = 'Unknown or unsupported file type. Attempting OCR...';
        console.log(textExtractionReason);

        base64File = btoa(String.fromCharCode(...new Uint8Array(docBuffer)));
        let ocrText = await ocrDocument(base64File, mimeType);
        ocrText = (ocrText || '').replace(/\s+/g, ' ').trim();
        if (/([a-zA-Z0-9\s.,@]){30,}/.test(ocrText)) {
          extractedText = ocrText;
          console.log(`[Fallback OCR] Extracted text: ${ocrText.length} chars.`);
        } else {
          throw new Error('Unknown file type extraction failed, and fallback OCR failed.');
        }
      } catch (unknownErr) {
        console.error("OCR fallback for unknown file type failed:", unknownErr);
        throw new Error(`Extraction failed: Unknown file type and OCR fallback returned error: ${unknownErr.message}`);
      }
    }

    // Final clean up & length clip before AI
    let cleanText = (extractedText || '').replace(/\s+/g, ' ').trim();
    if (cleanText.length > 4000) cleanText = cleanText.substring(0, 4000);

    if (cleanText.length < 30) {
      let failMessage = "Text extraction failed. Could not extract enough text for parsing, even using OCR. Please try with a higher-resolution scan or a different format.";
      if (attemptedOcr) {
        failMessage += " (OCR was attempted.)";
      }
      throw new Error(failMessage);
    }

    console.log(`Proceeding to Groq AI with ${cleanText.length} chars. Extraction method: ${attemptedOcr ? 'OCR' : 'native text'}.`);

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
    console.error(`Error processing resume ${resumeId || 'unknown'}:`, error.message || error);
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
    return new Response(JSON.stringify({ error: error.message || JSON.stringify(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
