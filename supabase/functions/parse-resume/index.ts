import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// This is a global constant, safe to define here.
const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
if (!GOOGLE_AI_API_KEY) throw new Error('Google AI API key not found');

// ==============================================================================
// 1. Google AI Files API Helper (This is a great implementation, no changes needed)
// ==============================================================================
async function uploadFileToGoogleAI(fileBlob: Blob) {
  console.log(`Uploading ${fileBlob.type} (${(fileBlob.size / 1024).toFixed(2)} KB) to Google AI Files API...`);

  const formData = new FormData();
  formData.append('file', fileBlob);

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/files?key=${GOOGLE_AI_API_KEY}`, {
    method: 'POST',
    headers: { 'x-goog-api-client': 'gl-deno/1.0.0' },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google AI File API upload error:', errorText);
    throw new Error(`Google AI File API upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  if (!result.file || !result.file.uri) {
    console.error('Unexpected file upload response:', result);
    throw new Error('Failed to get file URI from Google AI File API');
  }

  console.log(`File uploaded successfully. URI: ${result.file.name}`);
  return result.file;
}


// ==============================================================================
// 2. Universal Text Extraction (Using gemini-1.5-pro is a good choice)
// ==============================================================================
async function extractTextWithAI(fileBlob: Blob) {
  console.log(`Extracting text from ${fileBlob.type} with Gemini...`);
  const model = "gemini-1.5-pro-latest";
  const prompt = `You are an expert document processor. Extract all text from the provided file. Be highly accurate, preserving paragraphs, lists, and structure. Return ONLY the raw extracted text. Do not add any commentary or formatting.`;

  const uploadedFile = await uploadFileToGoogleAI(fileBlob);

  const requestBody = {
    contents: [{ parts: [
      { text: prompt },
      { file_data: { mime_type: uploadedFile.mimeType, file_uri: uploadedFile.uri } },
    ] }],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 8192,
      responseMimeType: "text/plain"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_API_KEY}`, {
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
  if (!data.candidates || !data.candidates[0]?.content?.parts[0]?.text) {
     if (data.promptFeedback?.blockReason) {
      const reason = `Text extraction blocked by safety settings: ${data.promptFeedback.blockReason}`;
      console.error(reason, JSON.stringify(data.promptFeedback));
      throw new Error(reason);
    }
    console.error('Unexpected Gemini text extraction response:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini text extraction API');
  }

  const extractedText = data.candidates[0].content.parts[0].text;
  console.log(`AI successfully extracted ${extractedText.length} characters.`);
  return extractedText;
}


// ==============================================================================
// 3. Structured JSON Parsing (*** HEAVILY REVISED FOR ACCURACY ***)
// ==============================================================================
async function parseResumeWithAI(text: string) {
  const MAX_TEXT_LENGTH = 200000;
  if (!text || text.length < 20) throw new Error('Insufficient text for AI parsing');
  
  const truncatedText = text.substring(0, MAX_TEXT_LENGTH);
  console.log(`Parsing text of length: ${truncatedText.length} with gemini-1.5-pro`);
  
  // Use the more powerful model for this complex reasoning task to get higher quality results.
  const model = 'gemini-1.5-pro-latest'; 

  // *** THE MOST IMPORTANT CHANGE IS THIS NEW, HIGHLY-STRUCTURED PROMPT ***
  const aiPrompt = `
### TASK
You are an expert resume parsing API. Your task is to extract structured information from the provided resume text and return it as a single, valid JSON object.

### JSON SCHEMA
Your output MUST strictly conform to this JSON schema. Do NOT add any extra fields.

{
  "full_name": "string | null",
  "email": "string | null", 
  "phone": "string | null",
  "location": "string | null",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration": "string", "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}]
}

### EXTRACTION RULES
1.  **Accuracy is Key:** Do NOT invent or hallucinate information. If a value is not found, use \`null\` for top-level string fields and an empty array \`[]\` for lists.
2.  **Location:** Extract only the City, State, and/or Country. OMIT all street addresses and zip/postal codes. (e.g., "San Francisco, CA", "London, UK").
3.  **Experience:**
    *   Extract every distinct job role as a separate object in the \`experience\` array.
    *   \`duration\` should be a single string representing the time spent in the role (e.g., "2020 - 2023", "Jan 2021 - Present").
    *   \`description\` should be a concise summary of the key responsibilities and achievements.
4.  **Skills:** Consolidate all technical and soft skills into the \`skills\` array.

### EXAMPLE (This helps the AI learn the format)
---
**INPUT TEXT:**
Jane Doe
Product Manager | San Francisco, CA 94105 | 123-456-7890 | jane.d@email.com

Experience
Lead Product Manager, Tech Solutions Inc. (2020 - Present)
- Led a team of 5 to launch a new analytics platform.
- Increased user engagement by 25%.

Software Engineer, Web Widgets LLC (May 2018 to Dec 2019)
Developed front-end components using React and TypeScript.

Education
M.S. in Computer Science - Stanford University (2018)

Skills: Agile, Product Roadmapping, JavaScript, Python, SQL
---
**EXPECTED JSON OUTPUT:**
{
  "full_name": "Jane Doe",
  "email": "jane.d@email.com",
  "phone": "123-456-7890",
  "location": "San Francisco, CA",
  "skills": ["Agile", "Product Roadmapping", "JavaScript", "Python", "SQL"],
  "experience": [
    {
      "title": "Lead Product Manager",
      "company": "Tech Solutions Inc.",
      "duration": "2020 - Present",
      "description": "Led a team of 5 to launch a new analytics platform. Increased user engagement by 25%."
    },
    {
      "title": "Software Engineer",
      "company": "Web Widgets LLC",
      "duration": "May 2018 to Dec 2019",
      "description": "Developed front-end components using React and TypeScript."
    }
  ],
  "education": [
    {
      "degree": "M.S. in Computer Science",
      "institution": "Stanford University",
      "year": "2018"
    }
  ]
}
---

### RESUME TEXT TO PARSE
---
${truncatedText}
---
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_AI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: aiPrompt }] }],
      generationConfig: {
        temperature: 0.05, // Slightly lower temperature for more deterministic JSON output
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
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    console.error('Unexpected Gemini JSON response structure:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini JSON API');
  }

  // Gemini with JSON mode is very reliable, but this is a good safety measure.
  const parsed = JSON.parse(data.candidates[0].content.parts[0].text);
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
}

// ==============================================================================
// Helper functions (Unchanged text cleaning, but improved Regex Fallback)
// ==============================================================================
function cleanTextForDatabase(text: string) {
  return text ? text.replace(/[\x00-\x1F\x7F-\x9F]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

// **IMPROVED** A more robust regex-based extraction as a fallback
function extractBasicInfoWithRegex(text: string) {
  console.log('Using robust regex fallback extraction...');
  if (!text) {
    return { full_name: null, email: null, phone: null, location: null, skills_json: [], experience_json: [], education_json: [] };
  }

  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  
  let name = null;
  const lines = text.split(/[\n\r]+/).filter(line => line.trim().length > 2);
  const potentialNameLines = lines.slice(0, 5);

  for (const line of potentialNameLines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine.length > 3 &&
      trimmedLine.length < 50 &&
      trimmedLine.includes(' ') &&
      !/[\d@<>()\[\]]/.test(trimmedLine) &&
      !/resume|curriculum|vitae|profile/i.test(trimmedLine)
    ) {
      name = trimmedLine;
      break; 
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

// ==============================================================================
// Main Server Logic (Unchanged)
// ==============================================================================
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

    let rawText = '';
    try {
        rawText = await extractTextWithAI(fileData);
    } catch(extractionError) {
        console.error(`AI text extraction failed: ${extractionError.message}. The file might be corrupted or unsupported.`);
    }
    
    const cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, final length: ${cleanText.length} characters`);

    const { data: resumeData, error: resumeError } = await serviceClient
      .from('resumes').select('user_id').eq('id', resumeId).single();
    if (resumeError || !resumeData) throw new Error(`Resume with ID ${resumeId} not found: ${resumeError?.message}`);

    let parsedContent;
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
      name: finalData.full_name, email: finalData.email, phone: finalData.phone,
      skills: finalData.skills_json.length, experience: finalData.experience_json.length
    }, null, 2));

    const { error: insertError } = await serviceClient
      .from('parsed_resume_details').insert(finalData);
    if (insertError) throw new Error(`Failed to insert parsed details: ${insertError.message}`);

    await serviceClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId);

    console.log(`Successfully parsed and stored details for resume ${resumeId}`);
    
    return new Response(JSON.stringify({ success: true, parsed: { name: finalData.full_name, email: finalData.email } }), { 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error(`Error processing resume ${resumeId || 'unknown'}:`, error.message);
    
    if (resumeId) {
      const serviceClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '', 
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await serviceClient.from('resumes')
        .update({ parsing_status: 'failed', parsing_error: error.message.slice(0, 250) })
        .eq('id', resumeId);
    }
    
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } 
    });
  }
});
