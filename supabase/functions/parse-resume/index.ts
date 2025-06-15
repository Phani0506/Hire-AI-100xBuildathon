
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Helper Function to Call Google AI (Gemini) with maximum token handling
async function getGeminiCompletion(prompt: string) {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY');
  
  if (!apiKey) {
    throw new Error('Google AI API key not found');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: "application/json"
      }
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error(`Gemini API failed: ${response.status} - ${errorText}`);
  }
  
  const data = await response.json();
  
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    console.error('Unexpected Gemini response structure:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini API');
  }
  
  return data.candidates[0].content.parts[0].text;
}

// Improved PDF text extraction
async function extractTextFromPDF(arrayBuffer: ArrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let extractedText = '';
    
    console.log(`Processing PDF of size: ${uint8Array.length} bytes`);
    
    // Convert to string and look for text patterns
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfContent = decoder.decode(uint8Array);
    
    // Strategy 1: Extract text between parentheses (most common in PDFs)
    const textInParens = pdfContent.match(/\(([^)]{3,})\)/g);
    if (textInParens) {
      for (const match of textInParens) {
        const text = match.slice(1, -1); // Remove parentheses
        if (text.length > 2 && /[a-zA-Z]/.test(text)) {
          extractedText += text + ' ';
        }
      }
    }
    
    // Strategy 2: Look for stream content with text objects
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/gi;
    let streamMatch;
    while ((streamMatch = streamRegex.exec(pdfContent)) !== null) {
      const streamData = streamMatch[1];
      
      // Extract text from BT...ET blocks
      const textObjects = streamData.match(/BT\s+([\s\S]*?)\s+ET/gi);
      if (textObjects) {
        for (const textObj of textObjects) {
          const textContent = textObj.match(/\(([^)]+)\)/g);
          if (textContent) {
            for (const text of textContent) {
              const cleanText = text.slice(1, -1);
              if (cleanText.length > 1 && /[a-zA-Z]/.test(cleanText)) {
                extractedText += cleanText + ' ';
              }
            }
          }
        }
      }
      
      // Extract text with Tj and TJ operators
      const tjMatches = streamData.match(/\(([^)]+)\)\s*T[jJ]/g);
      if (tjMatches) {
        for (const match of tjMatches) {
          const text = match.match(/\(([^)]+)\)/);
          if (text && text[1].length > 1) {
            extractedText += text[1] + ' ';
          }
        }
      }
    }
    
    // Strategy 3: Look for readable text patterns directly
    if (extractedText.length < 100) {
      const readableText = pdfContent.match(/[A-Za-z][A-Za-z0-9@.\-\s]{10,}/g);
      if (readableText) {
        extractedText += readableText.slice(0, 50).join(' ') + ' ';
      }
    }
    
    // Clean up the extracted text
    extractedText = extractedText
      .replace(/\\n|\\r|\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`PDF extraction completed: ${extractedText.length} characters extracted`);
    console.log(`Sample: "${extractedText.substring(0, 300)}"`);
    
    return extractedText;
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Enhanced text extraction for different file types
async function extractTextFromFile(fileData: Blob, fileName: string) {
  const lowerFileName = fileName.toLowerCase();
  
  if (lowerFileName.endsWith('.pdf')) {
    return await extractTextFromPDF(await fileData.arrayBuffer());
  } else if (lowerFileName.endsWith('.txt')) {
    return await fileData.text();
  } else if (lowerFileName.endsWith('.docx') || lowerFileName.endsWith('.doc')) {
    try {
      const text = await fileData.text();
      // Basic DOCX text extraction (XML-based)
      return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  } else {
    // For other formats, try to extract any readable text
    try {
      const text = await fileData.text();
      return text.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }
}

// Clean text for database storage
function cleanTextForDatabase(text: string) {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Simplified and more effective AI parsing
async function parseResumeWithAI(text: string) {
  if (!text || text.length < 20) {
    throw new Error('Insufficient text for AI parsing');
  }
  
  console.log(`Parsing text of length: ${text.length}`);
  console.log(`Text sample: "${text.substring(0, 500)}"`);
  
  const aiPrompt = `
Extract information from this resume text and return ONLY a JSON object with this structure:

{
  "full_name": "extract the person's name",
  "email": "extract email address", 
  "phone": "extract phone number",
  "location": "extract location/address",
  "skills": ["list of skills"],
  "experience": [{"title": "job title", "company": "company name", "duration": "dates", "description": "job description"}],
  "education": [{"degree": "degree/qualification", "institution": "school/university", "year": "year/dates"}]
}

Rules:
- Extract ACTUAL information from the text below
- If you can't find information, use null for strings and [] for arrays
- Don't make up information
- Look for email patterns with @ symbol
- Look for phone numbers with digits
- Extract ALL skills mentioned
- Extract ALL work experience
- Extract ALL education

Resume text:
${text}
`;

  try {
    console.log('Sending parsing request to Gemini AI...');
    const aiResult = await getGeminiCompletion(aiPrompt);
    console.log('Raw Gemini response:', aiResult);
    
    // Clean the response
    let cleanedResult = aiResult.trim();
    
    // Remove markdown code blocks if present
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResult);
    console.log('Parsed AI result:', parsed);
    
    // Return the result with proper field mapping
    const result = {
      full_name: parsed.full_name || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      location: parsed.location || null,
      skills_json: Array.isArray(parsed.skills) ? parsed.skills : [],
      experience_json: Array.isArray(parsed.experience) ? parsed.experience : [],
      education_json: Array.isArray(parsed.education) ? parsed.education : [],
    };
    
    console.log('Final parsed result:', result);
    return result;
    
  } catch (error) {
    console.error('AI parsing failed:', error.message);
    throw error;
  }
}

// Enhanced regex-based extraction as fallback
function extractBasicInfoWithRegex(text: string) {
  console.log('Using regex fallback extraction...');
  
  // Email extraction
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  const email = emailMatch ? emailMatch[0] : null;
  
  // Phone extraction
  const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : null;
  
  // Name extraction - look for capitalized words at the beginning
  const lines = text.split(/[\n\r]+/).filter(line => line.trim().length > 2);
  let name = null;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    if (line.length > 3 && line.length < 50 && 
        /^[A-Z][a-zA-Z\s.'-]+$/.test(line) && 
        !line.includes('@') &&
        !line.match(/\d{3,}/)) {
      name = line;
      break;
    }
  }
  
  // Basic skills extraction
  const commonSkills = ['javascript', 'python', 'java', 'react', 'node', 'sql', 'html', 'css', 'aws', 'git'];
  const foundSkills = [];
  const lowerText = text.toLowerCase();
  for (const skill of commonSkills) {
    if (lowerText.includes(skill)) {
      foundSkills.push(skill.charAt(0).toUpperCase() + skill.slice(1));
    }
  }
  
  return {
    full_name: name,
    email: email,
    phone: phone,
    location: null,
    skills_json: foundSkills,
    experience_json: [],
    education_json: [],
  };
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

    // Extract text from the file
    const fileName = filePath.split('/').pop() || 'unknown';
    let rawText = await extractTextFromFile(fileData, fileName);
    
    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, length: ${cleanText.length} characters`);

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

    // Try AI parsing first if we have meaningful text
    if (cleanText.length > 30) {
      console.log(`Attempting AI parsing for resume ${resumeId}...`);
      
      try {
        const aiParsedData = await parseResumeWithAI(cleanText);
        parsedContent = {
          ...parsedContent,
          ...aiParsedData
        };
        
        console.log(`AI parsing successful for resume ${resumeId}`);
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        console.log('Falling back to regex extraction...');
        
        // Regex fallback
        const fallbackData = extractBasicInfoWithRegex(cleanText);
        parsedContent = {
          ...parsedContent,
          ...fallbackData
        };
      }
    } else {
      console.log(`Text too short for AI parsing, using regex extraction`);
      
      // Use regex extraction for short text
      const fallbackData = extractBasicInfoWithRegex(cleanText);
      parsedContent = {
        ...parsedContent,
        ...fallbackData
      };
    }

    console.log('Final parsed content:', JSON.stringify({
      name: parsedContent.full_name,
      email: parsedContent.email,
      phone: parsedContent.phone,
      location: parsedContent.location,
      skillsCount: parsedContent.skills_json.length,
      experienceCount: parsedContent.experience_json.length,
      educationCount: parsedContent.education_json.length,
      textLength: parsedContent.raw_text_content.length
    }, null, 2));

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
        parsed: {
          name: parsedContent.full_name,
          email: parsedContent.email,
          phone: parsedContent.phone,
          skillsCount: parsedContent.skills_json.length,
          experienceCount: parsedContent.experience_json.length
        }
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
        console.error('Failed to update status to failed:', e); 
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
