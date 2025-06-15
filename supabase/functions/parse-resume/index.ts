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

// Advanced PDF text extraction with multiple strategies
async function extractTextFromPDF(arrayBuffer: ArrayBuffer) {
  try {
    const uint8Array = new Uint8Array(arrayBuffer);
    let extractedText = '';
    
    // Convert to string with proper encoding handling
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const pdfContent = decoder.decode(uint8Array);
    
    console.log(`Processing PDF of size: ${uint8Array.length} bytes`);
    
    // Strategy 1: Extract text from PDF streams (most comprehensive)
    const streamRegex = /stream\s*([\s\S]*?)\s*endstream/gi;
    let streamMatch;
    let streamCount = 0;
    
    while ((streamMatch = streamRegex.exec(pdfContent)) !== null && streamCount < 50) {
      streamCount++;
      const streamData = streamMatch[1];
      
      // Multiple text extraction patterns for different PDF encodings
      const textPatterns = [
        // Standard text objects
        /BT\s+([\s\S]*?)\s+ET/gi,
        // Text with positioning
        /\(((?:[^()\\]|\\.)*)\)\s*Tj/gi,
        /\(((?:[^()\\]|\\.)*)\)\s*TJ/gi,
        // Array-based text
        /\[((?:[^\[\]\\]|\\.)*)\]\s*TJ/gi,
        // Font-based text
        /\/F\d+\s+\d+\s+Tf\s+([\s\S]*?)(?=\/F\d+|\s*ET|\s*endstream)/gi,
        // Simple parenthetical content
        /\(([^)]{3,})\)/gi,
      ];
      
      for (const pattern of textPatterns) {
        let match;
        while ((match = pattern.exec(streamData)) !== null) {
          let text = match[1];
          if (text && text.length > 2) {
            // Clean and decode text
            text = text
              .replace(/\\n/g, ' ')
              .replace(/\\r/g, ' ')
              .replace(/\\t/g, ' ')
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\\\/g, '\\')
              .replace(/\\(\d{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
              .replace(/\s+/g, ' ')
              .trim();
            
            // Only include text that looks like actual content
            if (text.length > 2 && /[a-zA-Z@.\-]/.test(text)) {
              extractedText += text + ' ';
            }
          }
        }
      }
    }
    
    // Strategy 2: Direct object content extraction
    if (extractedText.length < 200) {
      console.log('Fallback: Extracting from PDF objects');
      const objRegex = /obj\s*([\s\S]*?)\s*endobj/gi;
      let objMatch;
      let objCount = 0;
      
      while ((objMatch = objRegex.exec(pdfContent)) !== null && objCount < 100) {
        objCount++;
        const objContent = objMatch[1];
        
        // Look for text in various formats
        const patterns = [
          /\(([^)]{5,})\)/gi,
          /<([0-9a-fA-F\s]{10,})>/gi, // Hex encoded text
          /\/Length\s+\d+[^(]*\(([^)]+)\)/gi,
        ];
        
        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(objContent)) !== null) {
            let text = match[1];
            
            // Handle hex encoded text
            if (/^[0-9a-fA-F\s]+$/.test(text)) {
              try {
                text = text.replace(/\s/g, '');
                if (text.length % 2 === 0) {
                  text = text.match(/.{2}/g)?.map(hex => String.fromCharCode(parseInt(hex, 16))).join('') || text;
                }
              } catch (e) {
                // Continue with original text
              }
            }
            
            text = text
              .replace(/\\n|\\r|\\t/g, ' ')
              .replace(/\\\(/g, '(')
              .replace(/\\\)/g, ')')
              .replace(/\\\\/g, '\\')
              .replace(/\s+/g, ' ')
              .trim();
              
            if (text.length > 3 && /[a-zA-Z@.\-]/.test(text)) {
              extractedText += text + ' ';
            }
          }
        }
      }
    }
    
    // Strategy 3: Raw text extraction for text-based PDFs
    if (extractedText.length < 100) {
      console.log('Fallback: Raw text extraction');
      const textChunks = pdfContent.match(/[a-zA-Z][a-zA-Z0-9@.\-\s]{15,}/g) || [];
      for (const chunk of textChunks.slice(0, 100)) {
        const cleaned = chunk.replace(/\s+/g, ' ').trim();
        if (cleaned.length > 10) {
          extractedText += cleaned + ' ';
        }
      }
    }
    
    // Final cleanup
    extractedText = extractedText
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E\u00A0-\u017F\u0100-\u024F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    console.log(`PDF extraction completed: ${extractedText.length} characters extracted`);
    console.log(`Sample: "${extractedText.substring(0, 500)}"`);
    
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
    // For images and other formats, try to extract any readable text
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
    .replace(/[\u2000-\u206F\u2E00-\u2E7F]/g, ' ')
    .replace(/[^\x20-\x7E\u00A0-\u017F\u0100-\u024F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Enhanced AI parsing with comprehensive prompts
async function parseResumeWithAI(text: string) {
  if (!text || text.length < 30) {
    throw new Error('Insufficient text for AI parsing');
  }
  
  // Use full text capacity (Gemini can handle up to 1M tokens)
  const maxLength = 50000; // Use more of Gemini's capacity
  const textToProcess = text.length > maxLength ? text.substring(0, maxLength) : text;
  
  const aiPrompt = `
You are an expert resume parser. Analyze this resume text carefully and extract ALL available information. Return ONLY a JSON object with this exact structure:

{
  "full_name": "actual name from resume",
  "email": "actual email address", 
  "phone": "actual phone number",
  "location": "actual location/address",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": [
    {
      "title": "actual job title",
      "company": "actual company name", 
      "duration": "actual dates/duration",
      "description": "actual job description"
    }
  ],
  "education": [
    {
      "degree": "actual degree/qualification",
      "institution": "actual school/university",
      "year": "actual year/dates"
    }
  ]
}

CRITICAL PARSING INSTRUCTIONS:
1. Extract the ACTUAL information from the resume text below
2. For full_name: Look for the person's actual name (usually at the top of the resume)
3. For email: Find email addresses containing @ symbol
4. For phone: Look for phone numbers in various formats
5. For location: Find city, state, country information
6. For skills: Extract ALL technical skills, programming languages, tools, certifications
7. For experience: Find ALL job positions with actual company names and descriptions
8. For education: Extract ALL educational qualifications with actual institutions
9. If information is not found, use null for strings and empty arrays for lists
10. DO NOT use placeholder data like "John Doe", "example.com", "Tech Company"
11. Extract information even if formatting is poor or text is fragmented
12. Look for patterns like "Email:", "Phone:", "Skills:", "Experience:", "Education:"
13. Be thorough - scan the entire text for any relevant information

Resume text to analyze:
${textToProcess}
`;

  try {
    console.log('Sending comprehensive parsing request to Gemini AI...');
    const aiResult = await getGeminiCompletion(aiPrompt);
    console.log('Raw Gemini response length:', aiResult.length);
    
    // Clean the response
    let cleanedResult = aiResult.trim();
    
    // Remove markdown code blocks if present
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResult);
    console.log('AI parsing successful, validating results...');
    
    // Validate and clean the result
    const result = {
      full_name: (parsed.full_name && typeof parsed.full_name === 'string' && 
                  !parsed.full_name.toLowerCase().includes('john doe') && 
                  parsed.full_name.trim().length > 0) ? parsed.full_name.trim() : null,
      
      email: (parsed.email && typeof parsed.email === 'string' && 
              parsed.email.includes('@') && 
              !parsed.email.includes('example.com') &&
              !parsed.email.includes('john@')) ? parsed.email.trim() : null,
      
      phone: (parsed.phone && typeof parsed.phone === 'string' && 
              !parsed.phone.includes('555-123-4567') &&
              parsed.phone.trim().length > 0) ? parsed.phone.trim() : null,
      
      location: (parsed.location && typeof parsed.location === 'string' && 
                 !parsed.location.toLowerCase().includes('new york, ny') &&
                 parsed.location.trim().length > 0) ? parsed.location.trim() : null,
      
      skills_json: Array.isArray(parsed.skills) ? 
        parsed.skills.filter(s => s && typeof s === 'string' && 
                             !['javascript', 'react', 'node.js'].includes(s.toLowerCase()) &&
                             s.trim().length > 0).map(s => s.trim()) : [],
      
      experience_json: Array.isArray(parsed.experience) ? 
        parsed.experience.filter(exp => exp && typeof exp === 'object' && 
                                 exp.company && !exp.company.toLowerCase().includes('tech company') &&
                                 exp.title && exp.title.length > 0) : [],
      
      education_json: Array.isArray(parsed.education) ? 
        parsed.education.filter(edu => edu && typeof edu === 'object' && 
                               edu.institution && !edu.institution.toLowerCase().includes('university name') &&
                               edu.degree && edu.degree.length > 0) : [],
    };
    
    console.log('Validation complete. Extracted data:', JSON.stringify({
      name: result.full_name,
      email: result.email,
      skillsCount: result.skills_json.length,
      experienceCount: result.experience_json.length,
      educationCount: result.education_json.length
    }));
    
    return result;
    
  } catch (error) {
    console.error('AI parsing failed:', error.message);
    throw error;
  }
}

// Enhanced regex-based extraction as comprehensive fallback
function extractBasicInfoWithRegex(text: string) {
  console.log('Using comprehensive regex fallback extraction...');
  
  // Email extraction with multiple patterns
  const emailPatterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    /[Ee]mail:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/g,
    /[Ee]-?[Mm]ail:?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/g,
  ];
  
  let email = null;
  for (const pattern of emailPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length > 0) {
      email = matches[0][1] || matches[0][0];
      if (!email.includes('example.com') && !email.includes('john@')) {
        break;
      }
    }
  }
  
  // Phone extraction with comprehensive patterns
  const phonePatterns = [
    /(?:[Pp]hone:?\s*)?(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g,
    /(?:[Pp]hone:?\s*)?(\+\d{1,3}\s?)?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g,
    /(?:[Pp]hone:?\s*)?\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/g,
    /(?:[Mm]obile:?\s*)?(\+?\d{1,3}[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}[-.\s]?\d{4}/g,
  ];
  
  let phone = null;
  for (const pattern of phonePatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      phone = matches[0].replace(/^[Pp]hone:?\s*|^[Mm]obile:?\s*/, '').trim();
      if (!phone.includes('555-123-4567')) {
        break;
      }
    }
  }
  
  // Name extraction - look at first few meaningful lines
  const lines = text.split(/[\n\r]+/).filter(line => line.trim().length > 2);
  let possibleName = null;
  
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    if (line.length > 3 && line.length < 60 && 
        /^[A-Z][a-zA-Z\s.'-]+$/.test(line) && 
        !line.toLowerCase().includes('resume') &&
        !line.toLowerCase().includes('cv') &&
        !line.includes('@') &&
        !line.match(/\d{3,}/) &&
        line.split(' ').length >= 2 && line.split(' ').length <= 5) {
      possibleName = line;
      break;
    }
  }
  
  // Enhanced skills extraction
  const skillCategories = [
    // Programming languages
    'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'swift', 'kotlin', 'go', 'rust', 'typescript',
    // Web technologies
    'html', 'css', 'react', 'angular', 'vue', 'node', 'express', 'django', 'flask', 'spring',
    // Databases
    'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'oracle',
    // Cloud & DevOps
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'git', 'jenkins', 'terraform',
    // Other tools
    'figma', 'photoshop', 'illustrator', 'canva', 'excel', 'powerpoint', 'tableau'
  ];
  
  const foundSkills = [];
  const lowerText = text.toLowerCase();
  
  // Look for skills in context
  const skillsSection = text.match(/skills:?\s*([^.]*?)(?:\n\n|education|experience|$)/i);
  const skillsText = skillsSection ? skillsSection[1] : text;
  
  for (const skill of skillCategories) {
    const regex = new RegExp(`\\b${skill}\\b`, 'i');
    if (regex.test(skillsText)) {
      foundSkills.push(skill.charAt(0).toUpperCase() + skill.slice(1));
    }
  }
  
  // Location extraction with multiple patterns
  const locationPatterns = [
    /(?:[Ll]ocation:?\s*)?([A-Z][a-zA-Z\s]+),\s*([A-Z]{2}|[A-Z][a-zA-Z\s]+)/g,
    /(?:[Aa]ddress:?\s*)?([A-Z][a-zA-Z\s]+),\s*([A-Z]{2})/g,
    /([A-Z][a-zA-Z\s]+),\s*([A-Z]{2})\s*\d{5}/g,
  ];
  
  let location = null;
  for (const pattern of locationPatterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      location = matches[0].replace(/^[Ll]ocation:?\s*|^[Aa]ddress:?\s*/, '').trim();
      break;
    }
  }
  
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
    
    console.log(`Starting comprehensive parsing for resume ${resumeId} with file path: ${filePath}`);
    
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

    // Extract text from the file with enhanced extraction
    const fileName = filePath.split('/').pop() || 'unknown';
    let rawText = await extractTextFromFile(fileData, fileName);
    
    let cleanText = cleanTextForDatabase(rawText);
    console.log(`Text extracted and cleaned, length: ${cleanText.length} characters`);
    console.log(`Sample text: "${cleanText.substring(0, 300)}"`);

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

    // Always try AI parsing first if we have any text
    if (cleanText.length > 20) {
      console.log(`Attempting comprehensive AI parsing for resume ${resumeId}...`);
      
      try {
        const aiParsedData = await parseResumeWithAI(cleanText);
        parsedContent = {
          ...parsedContent,
          ...aiParsedData
        };
        
        console.log(`AI parsing successful for resume ${resumeId}`);
        
      } catch (aiError) {
        console.error(`AI parsing failed: ${aiError.message}`);
        console.log('Falling back to comprehensive regex extraction...');
        
        // Comprehensive regex fallback
        const fallbackData = extractBasicInfoWithRegex(cleanText);
        parsedContent = {
          ...parsedContent,
          ...fallbackData
        };
      }
    } else {
      console.log(`Text too short for parsing (${cleanText.length} characters), using regex extraction`);
      
      // Still try regex extraction for short text
      const fallbackData = extractBasicInfoWithRegex(cleanText);
      parsedContent = {
        ...parsedContent,
        ...fallbackData
      };
    }

    console.log('Final parsed content summary:', JSON.stringify({
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
