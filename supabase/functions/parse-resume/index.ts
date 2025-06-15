
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

// Improved PDF text extraction
async function extractTextFromPDF(arrayBuffer: ArrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let text = '';
    
    // Convert to string safely
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfAsString = decoder.decode(uint8Array);
    
    // Extract text from different PDF structures
    const patterns = [
      /BT[\s\S]*?ET/g, // Text objects
      /\((.*?)\)/g,    // Text in parentheses
      /\[(.*?)\]/g,    // Text in brackets
      /\/F\d+\s+\d+\s+Tf\s*\((.*?)\)/g, // Font text
    ];
    
    for (const pattern of patterns) {
      const matches = pdfAsString.match(pattern) || [];
      for (const match of matches) {
        let cleanText = match
          .replace(/BT|ET|Tf|TJ|Tj|'|"/g, ' ')
          .replace(/\/F\d+\s+\d+\s+/g, ' ')
          .replace(/[\(\)\[\]]/g, ' ')
          .replace(/\\n|\\r|\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E\u00A0-\u017F]/g, ' ') // Keep only printable ASCII + Latin-1
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanText.length > 2 && /[a-zA-Z@.]/.test(cleanText)) {
          text += cleanText + ' ';
        }
      }
    }
    
    // Additional extraction for stream content
    const streams = pdfAsString.match(/stream([\s\S]*?)endstream/g) || [];
    for (const stream of streams) {
      const streamContent = stream.replace(/^stream\s*/, '').replace(/\s*endstream$/, '');
      const textMatches = streamContent.match(/\((.*?)\)/g) || [];
      
      for (const match of textMatches) {
        let cleanText = match
          .replace(/[\(\)]/g, '')
          .replace(/\\n|\\r|\\t/g, ' ')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
          .replace(/[^\x20-\x7E\u00A0-\u017F]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cleanText.length > 2 && /[a-zA-Z@.]/.test(cleanText)) {
          text += cleanText + ' ';
        }
      }
    }
    
    return text.replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    return '';
  }
}

// Clean text for database storage
function cleanTextForDatabase(text: string) {
  if (!text) return '';
  
  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '') // Remove control characters
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, ' ') // Replace special spaces
    .replace(/[^\x20-\x7E\u00A0-\u017F]/g, '') // Keep only safe characters
    .replace(/\s+/g, ' ')
    .trim();
}

// Truncate text to fit within token limits (approximately 3000 tokens = 12000 characters)
function truncateTextForAI(text: string, maxLength = 12000) {
  if (text.length <= maxLength) return text;
  
  // Try to truncate at word boundaries
  const truncated = text.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(' ');
  
  return lastSpaceIndex > maxLength * 0.8 ? truncated.substring(0, lastSpaceIndex) : truncated;
}

// Enhanced AI parsing with Gemini
async function parseResumeWithAI(text: string) {
  const truncatedText = truncateTextForAI(text, 15000); // Gemini can handle more tokens
  
  const aiPrompt = `
You are an expert resume parser. Extract key information from this resume text and return it as a JSON object with this EXACT structure. DO NOT return any text outside of the JSON object:

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
- Extract the person's ACTUAL full name from the resume (look at the very top, headers, contact sections)
- Find the ACTUAL email address (look for @ symbols throughout the document)
- Extract the ACTUAL phone number (look for phone patterns like +1-555-123-4567, (555) 123-4567, etc.)
- Find the ACTUAL location/address information (city, state, country)
- List ALL actual skills, technologies, programming languages, tools mentioned in the resume
- Extract ALL work experience with actual job titles, company names, dates, and descriptions
- Extract ALL education with actual degrees, schools, and graduation years
- If any information is not found in the resume, use null for strings and empty arrays for lists
- Be thorough and extract REAL information from the resume text
- DO NOT use placeholder data like "John Doe" or "example.com"
- Only extract information that is clearly present in the resume

Resume text to parse:
${truncatedText}
`;

  try {
    console.log('Attempting Gemini AI parsing...');
    const aiResult = await getGeminiCompletion(aiPrompt);
    console.log('Raw Gemini response:', aiResult);
    
    // Clean the response to ensure it's valid JSON
    let cleanedResult = aiResult.trim();
    
    // Remove any markdown code block formatting if present
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResult);
    console.log('Parsed AI result:', JSON.stringify(parsed, null, 2));
    
    // Validate and clean the AI result
    const result = {
      full_name: parsed.full_name && typeof parsed.full_name === 'string' && parsed.full_name.trim() !== 'John Doe' ? parsed.full_name.trim() : null,
      email: parsed.email && typeof parsed.email === 'string' && parsed.email.includes('@') && !parsed.email.includes('example.com') ? parsed.email.trim() : null,
      phone: parsed.phone && typeof parsed.phone === 'string' && !parsed.phone.includes('555-123-4567') ? parsed.phone.trim() : null,
      location: parsed.location && typeof parsed.location === 'string' && parsed.location.trim() !== 'New York, NY' ? parsed.location.trim() : null,
      skills_json: Array.isArray(parsed.skills) ? parsed.skills.filter(s => s && typeof s === 'string' && s.trim() !== 'JavaScript' && s.trim() !== 'React' && s.trim() !== 'Node.js').map(s => s.trim()) : [],
      experience_json: Array.isArray(parsed.experience) ? parsed.experience.filter(exp => exp && typeof exp === 'object' && exp.company !== 'Tech Company') : [],
      education_json: Array.isArray(parsed.education) ? parsed.education.filter(edu => edu && typeof edu === 'object' && edu.institution !== 'University Name') : [],
    };
    
    console.log('Final validated result:', JSON.stringify(result, null, 2));
    return result;
    
  } catch (error) {
    console.error('Gemini AI parsing failed:', error.message);
    console.log('Falling back to regex extraction...');
    
    // Enhanced fallback: try to extract basic information using regex
    return extractBasicInfoWithRegex(truncatedText);
  }
}

// Enhanced regex-based extraction
function extractBasicInfoWithRegex(text: string) {
  console.log('Using regex fallback extraction...');
  
  // Email extraction
  const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
  
  // Phone extraction (multiple patterns)
  const phonePatterns = [
    /(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/,
    /(\+\d{1,3}\s?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,
    /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/
  ];
  
  let phoneMatch = null;
  for (const pattern of phonePatterns) {
    phoneMatch = text.match(pattern);
    if (phoneMatch) break;
  }
  
  // Name extraction (improved)
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  let possibleName = null;
  
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    // Look for lines that could be names (2-4 words, proper case, no special chars)
    if (line.length > 3 && line.length < 60 && 
        /^[A-Z][a-zA-Z\s]+$/.test(line) && 
        !line.toLowerCase().includes('resume') &&
        !line.toLowerCase().includes('cv') &&
        !line.toLowerCase().includes('curriculum') &&
        !line.includes('@') &&
        !line.match(/\d{3,}/) &&
        line.split(' ').length >= 2 && line.split(' ').length <= 4) {
      possibleName = line;
      break;
    }
  }
  
  // Skills extraction (look for common skill keywords)
  const skillKeywords = ['javascript', 'python', 'java', 'react', 'node', 'sql', 'html', 'css', 'angular', 'vue', 'php', 'c++', 'c#', 'ruby', 'swift', 'kotlin', 'go', 'rust', 'typescript', 'aws', 'docker', 'kubernetes', 'git', 'mongodb', 'postgresql', 'mysql', 'redis', 'firebase', 'azure', 'gcp'];
  const foundSkills = [];
  const lowerText = text.toLowerCase();
  
  for (const skill of skillKeywords) {
    if (lowerText.includes(skill)) {
      foundSkills.push(skill.charAt(0).toUpperCase() + skill.slice(1));
    }
  }
  
  // Location extraction (look for city, state patterns)
  const locationPattern = /([A-Z][a-zA-Z\s]+),\s*([A-Z]{2}|[A-Z][a-zA-Z\s]+)/;
  const locationMatch = text.match(locationPattern);
  
  const result = {
    full_name: possibleName,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    location: locationMatch ? locationMatch[0] : null,
    skills_json: foundSkills,
    experience_json: [],
    education_json: [],
  };
  
  console.log('Regex extraction result:', JSON.stringify(result, null, 2));
  return result;
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

    // Extract text from different file types
    let rawText = '';
    const fileName = filePath.toLowerCase();
    
    if (fileName.endsWith('.pdf')) {
      rawText = await extractTextFromPDF(await fileData.arrayBuffer());
    } else if (fileName.endsWith('.txt')) {
      rawText = await fileData.text();
    } else {
      // Try to extract as text for other formats
      try {
        rawText = await fileData.text();
      } catch {
        rawText = '';
      }
    }

    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, length: ${cleanText.length} characters`);
    console.log(`First 200 characters: ${cleanText.substring(0, 200)}`);

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
        
        console.log(`Successfully parsed content:`, JSON.stringify(parsedContent, null, 2));
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        console.log('Using fallback extraction...');
        
        // Try regex fallback
        const fallbackData = extractBasicInfoWithRegex(cleanText);
        parsedContent = {
          ...parsedContent,
          ...fallbackData
        };
      }
    } else {
      console.log(`Insufficient text for parsing (${cleanText.length} characters)`);
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
