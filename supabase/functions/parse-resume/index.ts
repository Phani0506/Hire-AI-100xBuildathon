
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

// Helper Function to Call Google AI (Gemini) with better token handling
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
        maxOutputTokens: 4000,
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

// Improved PDF text extraction using multiple strategies
async function extractTextFromPDF(arrayBuffer: ArrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string safely with better encoding handling
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfAsString = decoder.decode(uint8Array);
    
    // Strategy 1: Extract from stream objects (most reliable for modern PDFs)
    const streamPattern = /stream\s*(.*?)\s*endstream/gs;
    const streams = [...pdfAsString.matchAll(streamPattern)];
    
    for (const stream of streams) {
      const streamContent = stream[1];
      
      // Look for text showing operators with better patterns
      const textPatterns = [
        /\((.*?)\)\s*Tj/g,           // Simple text showing
        /\((.*?)\)\s*TJ/g,           // Text showing with individual glyph positioning
        /\[(.*?)\]\s*TJ/g,           // Array of strings and numbers
        /BT\s+(.*?)\s+ET/gs,         // Text objects
      ];
      
      for (const pattern of textPatterns) {
        const matches = [...streamContent.matchAll(pattern)];
        for (const match of matches) {
          let extractedText = match[1];
          if (extractedText) {
            // Clean up the extracted text
            extractedText = extractedText
              .replace(/\\n/g, ' ')
              .replace(/\\r/g, ' ')
              .replace(/\\t/g, ' ')
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\\\/g, '\\')
              .replace(/\s+/g, ' ')
              .trim();
            
            if (extractedText.length > 1 && /[a-zA-Z@.]/.test(extractedText)) {
              text += extractedText + ' ';
            }
          }
        }
      }
    }
    
    // Strategy 2: Look for text in object content (fallback)
    if (text.length < 100) {
      const objPattern = /obj\s*(.*?)\s*endobj/gs;
      const objects = [...pdfAsString.matchAll(objPattern)];
      
      for (const obj of objects) {
        const objContent = obj[1];
        // Look for parenthetical text
        const textMatches = objContent.match(/\((.*?)\)/g) || [];
        
        for (const match of textMatches) {
          let cleanText = match
            .replace(/[\(\)]/g, '')
            .replace(/\\n|\\r|\\t/g, ' ')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\')
            .replace(/\s+/g, ' ')
            .trim();
          
          if (cleanText.length > 2 && /[a-zA-Z@.]/.test(cleanText)) {
            text += cleanText + ' ';
          }
        }
      }
    }
    
    // Strategy 3: Direct text extraction (last resort)
    if (text.length < 50) {
      // Look for readable ASCII text in the PDF
      const readableText = pdfAsString.match(/[a-zA-Z][a-zA-Z0-9@.\-\s]{10,}/g) || [];
      text = readableText.join(' ');
    }
    
    console.log(`PDF extraction resulted in ${text.length} characters of text`);
    console.log(`Sample extracted text: "${text.substring(0, 300)}"`);
    
    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Enhanced text extraction for other file types
async function extractTextFromFile(fileData: Blob, fileName: string) {
  const lowerFileName = fileName.toLowerCase();
  
  if (lowerFileName.endsWith('.pdf')) {
    return await extractTextFromPDF(await fileData.arrayBuffer());
  } else if (lowerFileName.endsWith('.txt')) {
    return await fileData.text();
  } else if (lowerFileName.endsWith('.docx')) {
    // For DOCX, try to extract as text (basic approach)
    try {
      const text = await fileData.text();
      // DOCX files are XML-based, try to extract text content
      const xmlText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return xmlText;
    } catch {
      return '';
    }
  } else {
    // Try to extract as text for other formats
    try {
      return await fileData.text();
    } catch {
      return '';
    }
  }
}

// Clean text for database storage
function cleanTextForDatabase(text: string) {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ') // Remove control characters
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, ' ') // Replace special spaces
    .replace(/[^\x20-\x7E\u00A0-\u017F\u0100-\u024F]/g, ' ') // Keep safe characters + extended Latin
    .replace(/\s+/g, ' ')
    .trim();
}

// Enhanced AI parsing with better prompts and validation
async function parseResumeWithAI(text: string) {
  if (!text || text.length < 50) {
    throw new Error('Insufficient text for AI parsing');
  }
  
  // Truncate text to fit within token limits
  const maxLength = 15000; // Conservative limit for Gemini
  const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;
  
  const aiPrompt = `
You are an expert resume parser. Extract key information from this resume text and return it as a JSON object with this EXACT structure. Return ONLY the JSON object, no other text:

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

CRITICAL INSTRUCTIONS:
- Extract the person's ACTUAL full name from the resume (NOT "John Doe")
- Find the ACTUAL email address (look for @ symbols)
- Extract the ACTUAL phone number (look for phone patterns)
- Find the ACTUAL location/address information
- List ALL actual skills, technologies, programming languages mentioned
- Extract ALL work experience with actual job titles, companies, dates
- Extract ALL education with actual degrees, schools, years
- If information is not found, use null for strings and empty arrays for lists
- Do NOT use placeholder data like "John Doe" or "example.com"
- Only extract information that is clearly present in the resume

Resume text:
${truncatedText}
`;

  try {
    console.log('Sending request to Gemini AI...');
    const aiResult = await getGeminiCompletion(aiPrompt);
    console.log('Raw Gemini response:', aiResult.substring(0, 500));
    
    // Clean the response
    let cleanedResult = aiResult.trim();
    
    // Remove markdown code blocks if present
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResult);
    console.log('Successfully parsed AI result');
    
    // Validate and clean the result - reject obvious placeholder data
    const result = {
      full_name: (parsed.full_name && typeof parsed.full_name === 'string' && 
                  parsed.full_name.trim() !== 'John Doe' && 
                  parsed.full_name.trim().length > 0) ? parsed.full_name.trim() : null,
      
      email: (parsed.email && typeof parsed.email === 'string' && 
              parsed.email.includes('@') && 
              !parsed.email.includes('example.com') &&
              !parsed.email.includes('john@')) ? parsed.email.trim() : null,
      
      phone: (parsed.phone && typeof parsed.phone === 'string' && 
              !parsed.phone.includes('555-123-4567') &&
              parsed.phone.trim().length > 0) ? parsed.phone.trim() : null,
      
      location: (parsed.location && typeof parsed.location === 'string' && 
                 parsed.location.trim() !== 'New York, NY' &&
                 parsed.location.trim().length > 0) ? parsed.location.trim() : null,
      
      skills_json: Array.isArray(parsed.skills) ? 
        parsed.skills.filter(s => s && typeof s === 'string' && 
                             s.trim() !== 'JavaScript' && 
                             s.trim() !== 'React' && 
                             s.trim() !== 'Node.js' &&
                             s.trim().length > 0).map(s => s.trim()) : [],
      
      experience_json: Array.isArray(parsed.experience) ? 
        parsed.experience.filter(exp => exp && typeof exp === 'object' && 
                                 exp.company !== 'Tech Company' &&
                                 exp.title && exp.title.length > 0) : [],
      
      education_json: Array.isArray(parsed.education) ? 
        parsed.education.filter(edu => edu && typeof edu === 'object' && 
                               edu.institution !== 'University Name' &&
                               edu.degree && edu.degree.length > 0) : [],
    };
    
    console.log('Final validated result:', JSON.stringify(result, null, 2));
    return result;
    
  } catch (error) {
    console.error('AI parsing failed:', error.message);
    throw error;
  }
}

// Enhanced regex-based extraction as fallback
function extractBasicInfoWithRegex(text: string) {
  console.log('Using regex fallback extraction...');
  
  // Email extraction - more comprehensive patterns
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emailMatches = text.match(emailPattern) || [];
  const email = emailMatches.find(e => !e.includes('example.com') && !e.includes('john@')) || null;
  
  // Phone extraction - multiple patterns
  const phonePatterns = [
    /(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g,
    /(\+\d{1,3}\s?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g,
    /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/g
  ];
  
  let phone = null;
  for (const pattern of phonePatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      phone = matches[0];
      break;
    }
  }
  
  // Name extraction - look for names at the beginning
  const lines = text.split(/[\n\r]+/).filter(line => line.trim().length > 0);
  let possibleName = null;
  
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const line = lines[i].trim();
    // Look for lines that could be names
    if (line.length > 3 && line.length < 50 && 
        /^[A-Z][a-zA-Z\s.'-]+$/.test(line) && 
        !line.toLowerCase().includes('resume') &&
        !line.toLowerCase().includes('cv') &&
        !line.includes('@') &&
        !line.match(/\d{3,}/) &&
        line.split(' ').length >= 2 && line.split(' ').length <= 4) {
      possibleName = line;
      break;
    }
  }
  
  // Skills extraction
  const skillKeywords = [
    'javascript', 'python', 'java', 'react', 'node', 'sql', 'html', 'css', 
    'angular', 'vue', 'php', 'c++', 'c#', 'ruby', 'swift', 'kotlin', 'go', 
    'rust', 'typescript', 'aws', 'docker', 'kubernetes', 'git', 'mongodb', 
    'postgresql', 'mysql', 'redis', 'firebase', 'azure', 'gcp'
  ];
  
  const foundSkills = [];
  const lowerText = text.toLowerCase();
  
  for (const skill of skillKeywords) {
    if (lowerText.includes(skill)) {
      foundSkills.push(skill.charAt(0).toUpperCase() + skill.slice(1));
    }
  }
  
  // Location extraction
  const locationPattern = /([A-Z][a-zA-Z\s]+),\s*([A-Z]{2}|[A-Z][a-zA-Z\s]+)/g;
  const locationMatches = text.match(locationPattern) || [];
  const location = locationMatches[0] || null;
  
  return {
    full_name: possibleName,
    email: email,
    phone: phone,
    location: location,
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
    console.log(`Sample text: "${cleanText.substring(0, 200)}"`);

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

    // Try AI parsing if we have sufficient text
    if (cleanText.length > 50) {
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
        
        // Try regex fallback
        const fallbackData = extractBasicInfoWithRegex(cleanText);
        parsedContent = {
          ...parsedContent,
          ...fallbackData
        };
      }
    } else {
      console.log(`Insufficient text for parsing (${cleanText.length} characters)`);
      
      // If we have very little text, try regex extraction anyway
      if (cleanText.length > 10) {
        const fallbackData = extractBasicInfoWithRegex(cleanText);
        parsedContent = {
          ...parsedContent,
          ...fallbackData
        };
      }
    }

    console.log('Final parsed content:', JSON.stringify(parsedContent, null, 2));

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
