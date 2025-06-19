
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Helper Function to Call Google AI (Gemini) for structured JSON parsing
async function getGeminiJSONCompletion(prompt: string) {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!apiKey) throw new Error('Google AI API key not found');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini JSON parsing error:', errorText);
    throw new Error(`Gemini JSON API failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    console.error('Unexpected Gemini JSON response structure:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini JSON API');
  }

  return data.candidates[0].content.parts[0].text;
}

// New AI-based text extraction for any file type Gemini supports (PDF, images, etc.)
async function extractTextWithAI(fileBlob: Blob) {
  console.log(`Extracting text from ${fileBlob.type} with Gemini...`);
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!apiKey) throw new Error('Google AI API key not found for text extraction');

  const arrayBuffer = await fileBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  const base64Data = btoa(binary);

  const prompt = `Extract all text from the provided file. Be as accurate as possible, preserving paragraphs and lists. Return ONLY the raw extracted text.`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: fileBlob.type, data: base64Data } },
      ],
    }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 8192,
      responseMimeType: "text/plain"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini text extraction error:', errorText);
    throw new Error(`Gemini text extraction failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts[0].text) {
    if (data.promptFeedback?.blockReason) {
      const reason = `Text extraction blocked by safety settings: ${data.promptFeedback.blockReason}`;
      console.error(reason);
      throw new Error(reason);
    }
    console.error('Unexpected Gemini text extraction response:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini text extraction API');
  }

  const extractedText = data.candidates[0].content.parts[0].text;
  console.log(`AI successfully extracted ${extractedText.length} characters.`);
  return extractedText;
}

// Clean text for database storage
function cleanTextForDatabase(text: string) {
  if (!text) return '';
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove non-printable characters
    .replace(/\s+/g, ' ')
    .trim();
}

// AI resume parsing with a more robust prompt
async function parseResumeWithAI(text: string) {
  const MAX_TEXT_LENGTH = 200000; // Generous limit for Gemini
  if (!text || text.length < 20) {
    throw new Error('Insufficient text for AI parsing');
  }
  
  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);
  console.log(`Parsing text of length: ${truncatedText.length}`);

  const aiPrompt = `
Extract information from this resume text and return ONLY a valid JSON object with this exact structure:
{
  "full_name": "string",
  "email": "string", 
  "phone": "string",
  "location": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration": "string", "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}]
}

Extraction Rules:
- Extract information accurately from the text.
- If a value isn't found, use null for strings and empty arrays [] for lists.
- DO NOT invent or fabricate any information.
- The resume text might be messy or from an OCR process; do your best to interpret it.
- For "experience" and "education", extract every entry you can find.
- For "description" in experience, capture the key responsibilities and achievements.

Resume text to parse:
---
${truncatedText}
---
`;

  try {
    console.log('Sending parsing request to Gemini AI...');
    const aiResult = await getGeminiJSONCompletion(aiPrompt);
    console.log('Raw Gemini response received.');
    
    let cleanedResult = aiResult.trim();
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResult);
    console.log('Successfully parsed AI result.');
    
    return {
      full_name: parsed.full_name || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      location: parsed.location || null,
      skills_json: Array.isArray(parsed.skills) ? parsed.skills : [],
      experience_json: Array.isArray(parsed.experience) ? parsed.experience : [],
      education_json: Array.isArray(parsed.education) ? parsed.education : [],
    };
    
  } catch (error) {
    console.error('AI parsing failed:', error.message);
    throw error;
  }
}

// Enhanced regex-based extraction as fallback
function extractBasicInfoWithRegex(text: string) {
  console.log('Using regex fallback extraction...');
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  
  const lines = text.split(/[\n\r]+/).filter(line => line.trim().length > 2);
  let name = null;
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    if (firstLine.length > 3 && firstLine.length < 50 && /^[A-Z][a-zA-Z\s.'-]+$/.test(firstLine)) {
        name = firstLine;
    }
  }

  return {
    full_name: name,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    location: null,
    skills_json: [],
    experience_json: [],
    education_json: [],
  };
}

// Main Server Logic
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } 
    });
  }

  let resumeId;
  try {
    const body = await req.json();
    resumeId = body.resumeId;
    const filePath = body.filePath;
    
    if (!resumeId || !filePath) throw new Error(`Missing resumeId or filePath`);
    
    console.log(`Starting parsing for resume ${resumeId} with file path: ${filePath}`);
    
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '', 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('resumes')
      .download(filePath);
    if (downloadError) throw new Error(`Failed to download file: ${downloadError.message}`);

    console.log(`File downloaded successfully: ${filePath}, type: ${fileData.type}, size: ${fileData.size}`);

    // Step 1: Extract text using AI for robustness
    let rawText = '';
    try {
        rawText = await extractTextWithAI(fileData);
    } catch(extractionError) {
        console.error(`AI text extraction failed: ${extractionError.message}. The file might be corrupted or unsupported.`);
        // Continue with empty text, so it gets marked as failed with context.
    }
    
    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, final length: ${cleanText.length} characters`);

    const { data: resumeData, error: resumeError } = await serviceClient
      .from('resumes')
      .select('user_id')
      .eq('id', resumeId)
      .single();
    if (resumeError || !resumeData) throw new Error(`Resume with ID ${resumeId} not found: ${resumeError?.message}`);

    let parsedContent;

    // Step 2: Parse the extracted text with AI
    if (cleanText.length > 30) {
      console.log(`Attempting AI parsing for resume ${resumeId}...`);
      try {
        parsedContent = await parseResumeWithAI(cleanText);
        console.log(`AI parsing successful for resume ${resumeId}`);
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}. Falling back to regex.`);
        parsedContent = extractBasicInfoWithRegex(cleanText);
      }
    } else {
      console.log(`Text too short for AI parsing, using regex extraction.`);
      parsedContent = extractBasicInfoWithRegex(cleanText);
    }

    const finalData = {
        resume_id: resumeId,
        user_id: resumeData.user_id,
        raw_text_content: cleanText,
        ...parsedContent
    };

    console.log('Final parsed content summary:', JSON.stringify({
      name: finalData.full_name,
      email: finalData.email,
      phone: finalData.phone,
      skills: finalData.skills_json.length,
      experience: finalData.experience_json.length
    }, null, 2));

    const { error: insertError } = await serviceClient
      .from('parsed_resume_details')
      .insert(finalData);
    if (insertError) throw new Error(`Failed to insert parsed details: ${insertError.message}`);

    await serviceClient
      .from('resumes')
      .update({ parsing_status: 'completed' })
      .eq('id', resumeId);

    console.log(`Successfully parsed and stored details for resume ${resumeId}`);
    
    return new Response(JSON.stringify({ success: true, parsed: { name: finalData.full_name, email: finalData.email } }), { 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } 
    });

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
          .update({ parsing_status: 'failed', parsing_error: error.message })
          .eq('id', resumeId);
      } catch (e) { 
        console.error('Failed to update status to failed:', e.message); 
      }
    }
    
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } 
    });
  }
});
