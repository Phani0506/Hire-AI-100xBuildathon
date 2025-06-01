
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { resumeId } = await req.json()
    console.log('Processing resume:', resumeId)

    if (!resumeId) {
      console.error('Resume ID is missing')
      return new Response(
        JSON.stringify({ error: 'Resume ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get resume details
    const { data: resume, error: resumeError } = await supabaseClient
      .from('resumes')
      .select('*')
      .eq('id', resumeId)
      .single()

    if (resumeError || !resume) {
      console.error('Resume not found:', resumeError)
      return new Response(
        JSON.stringify({ error: 'Resume not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Found resume:', resume.file_name)

    // Update status to processing
    await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'processing' })
      .eq('id', resumeId)

    console.log('Updated status to processing')

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('resumes')
      .download(resume.supabase_storage_path)

    if (downloadError || !fileData) {
      console.error('File download error:', downloadError)
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Failed to download file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('File downloaded successfully, size:', fileData.size)

    // Convert file to text and clean it
    let fileText = ''
    try {
      fileText = await fileData.text()
      // More aggressive text cleaning
      fileText = fileText
        .replace(/\u0000/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[^\x20-\x7E\n\r\t]/g, '') // Keep only printable ASCII + newlines/tabs
        .trim()
      
      console.log('File converted to text, length:', fileText.length)
      console.log('First 500 characters:', fileText.substring(0, 500))
    } catch (error) {
      console.error('Error converting file to text:', error)
      fileText = 'Unable to extract text from file. Please ensure the file contains readable text.'
    }

    // Get Groq API key from secrets
    const groqApiKey = Deno.env.get('GROQ_API_KEY')
    if (!groqApiKey) {
      console.error('Groq API key not found in environment')
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Groq API key found, sending request...')

    // Enhanced prompt for better parsing
    const systemPrompt = `You are an expert resume parser. Extract structured information from resumes and return ONLY a valid JSON object with these exact fields:

{
  "full_name": "string or null",
  "email": "string or null", 
  "phone": "string or null",
  "location": "string or null",
  "skills": ["array", "of", "skills"],
  "experience": [{"company": "string", "position": "string", "duration": "string", "description": "string"}],
  "education": [{"institution": "string", "degree": "string", "year": "string", "field": "string"}]
}

CRITICAL PARSING RULES:
1. Return ONLY the JSON object, no additional text, explanations, or markdown formatting
2. Extract ALL information present in the resume
3. For full_name: Look for the person's name at the top of the resume
4. For email: Find email addresses (containing @)
5. For phone: Find phone numbers in various formats
6. For location: Find city, state, country information
7. For skills: Extract ALL technical skills, programming languages, tools, frameworks, soft skills
8. For experience: Extract ALL work experience with company names, job titles, dates, and descriptions
9. For education: Extract schools, degrees, graduation years, fields of study
10. If a field cannot be found, use null for strings or empty array for arrays
11. Be thorough - don't miss any information present in the text`

    // Parse resume with Groq API using enhanced prompt
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Parse this resume text and extract ALL information as JSON:\n\n${fileText.substring(0, 6000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 2000
      }),
    })

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      console.error('Groq API error:', errorText)
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Failed to parse resume with AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const groqData = await groqResponse.json()
    console.log('Groq response received:', groqData)

    const parsedContent = groqData.choices[0]?.message?.content

    if (!parsedContent) {
      console.error('No content returned from Groq')
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'No content parsed from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Enhanced JSON parsing with better error handling
    let parsedData
    try {
      // More aggressive cleaning of the response
      let cleanedContent = parsedContent.trim()
      
      // Remove any markdown formatting
      cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      cleanedContent = cleanedContent.replace(/^[^{]*/, '') // Remove everything before first {
      cleanedContent = cleanedContent.replace(/[^}]*$/, '}') // Remove everything after last }
      
      // Find JSON object boundaries more precisely
      const jsonStart = cleanedContent.indexOf('{')
      const jsonEnd = cleanedContent.lastIndexOf('}')
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1)
      }
      
      console.log('Attempting to parse cleaned content:', cleanedContent.substring(0, 300))
      parsedData = JSON.parse(cleanedContent)
      console.log('Successfully parsed JSON:', parsedData)
      
      // Validate and enhance parsed data
      parsedData = validateAndEnhanceParsedData(parsedData, fileText)
      
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError)
      console.error('Raw content:', parsedContent)
      
      // Enhanced fallback parsing with better regex patterns
      console.log('Using enhanced fallback parsing...')
      parsedData = enhancedFallbackParsing(fileText)
      console.log('Enhanced fallback parsing result:', parsedData)
    }

    // Clean the raw text content for database storage
    const cleanRawText = fileText.substring(0, 8000)
      .replace(/\u0000/g, '') // Remove null bytes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
      .replace(/\\/g, '\\\\') // Escape backslashes
      .trim()

    // Insert parsed data into database
    console.log('Inserting parsed data into database...')
    const { error: insertError } = await supabaseClient
      .from('parsed_resume_details')
      .insert({
        resume_id: resumeId,
        user_id: resume.user_id,
        full_name: parsedData.full_name,
        email: parsedData.email,
        phone: parsedData.phone,
        location: parsedData.location,
        skills_json: parsedData.skills || [],
        experience_json: parsedData.experience || [],
        education_json: parsedData.education || [],
        raw_text_content: cleanRawText
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Failed to save parsed data', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update resume status to completed
    await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'completed' })
      .eq('id', resumeId)

    console.log('Resume parsing completed successfully')

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Resume parsed successfully',
        parsedData: parsedData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// Enhanced validation and data enhancement function
function validateAndEnhanceParsedData(data: any, originalText: string): any {
  const result = {
    full_name: data.full_name || extractName(originalText),
    email: data.email || extractEmail(originalText),
    phone: data.phone || extractPhone(originalText),
    location: data.location || extractLocation(originalText),
    skills: Array.isArray(data.skills) ? data.skills : extractSkills(originalText),
    experience: Array.isArray(data.experience) ? data.experience : extractExperience(originalText),
    education: Array.isArray(data.education) ? data.education : extractEducation(originalText)
  }
  
  // Enhance skills if too few were found
  if (result.skills.length < 3) {
    const additionalSkills = extractSkills(originalText)
    result.skills = [...new Set([...result.skills, ...additionalSkills])]
  }
  
  return result
}

// Enhanced fallback parsing with comprehensive extraction
function enhancedFallbackParsing(text: string): any {
  return {
    full_name: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    location: extractLocation(text),
    skills: extractSkills(text),
    experience: extractExperience(text),
    education: extractEducation(text)
  }
}

// Enhanced helper functions for better extraction
function extractName(text: string): string | null {
  const lines = text.split('\n').slice(0, 15)
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Look for name patterns (proper case, 2-4 words, no numbers/symbols)
    if (trimmed && 
        /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,3}$/.test(trimmed) && 
        trimmed.length < 60 &&
        !trimmed.toLowerCase().includes('resume') &&
        !trimmed.toLowerCase().includes('cv') &&
        !trimmed.toLowerCase().includes('curriculum')) {
      return trimmed
    }
  }
  
  // Fallback: look for name after "Name:" or similar
  const nameMatch = text.match(/(?:Name|Full Name):\s*([A-Z][a-z]+(?: [A-Z][a-z]+)+)/i)
  return nameMatch ? nameMatch[1] : null
}

function extractEmail(text: string): string | null {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const matches = text.match(emailRegex)
  return matches ? matches[0] : null
}

function extractPhone(text: string): string | null {
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  const match = text.match(phoneRegex)
  return match ? match[0] : null
}

function extractLocation(text: string): string | null {
  // Look for city, state patterns
  const locationRegex = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2}|[A-Z][a-z]+)\b/g
  const matches = text.match(locationRegex)
  if (matches) return matches[0]
  
  // Look for just city names near address indicators
  const cityMatch = text.match(/(?:Address|Location|City):\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/i)
  return cityMatch ? cityMatch[1] : null
}

function extractSkills(text: string): string[] {
  const skillKeywords = [
    // Programming Languages
    'javascript', 'python', 'java', 'c++', 'c#', 'php', 'ruby', 'go', 'rust', 'swift', 'kotlin', 'typescript',
    // Frameworks & Libraries
    'react', 'angular', 'vue', 'node.js', 'express', 'django', 'flask', 'spring', 'laravel', 'rails',
    // Databases
    'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'oracle', 'sql server',
    // Cloud & DevOps
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'jenkins', 'git', 'github', 'gitlab',
    // Web Technologies
    'html', 'css', 'sass', 'less', 'webpack', 'babel', 'jquery', 'bootstrap', 'tailwind',
    // Tools & Software
    'jira', 'confluence', 'slack', 'figma', 'photoshop', 'illustrator',
    // Methodologies
    'agile', 'scrum', 'kanban', 'devops', 'ci/cd', 'tdd', 'bdd'
  ]
  
  const skills: string[] = []
  const lowerText = text.toLowerCase()
  
  // Extract from skills section
  const skillsSection = text.match(/(?:Skills?|Technical Skills?|Core Competencies)[\s\S]*?(?=\n[A-Z]|\n\n|$)/i)
  const skillsText = skillsSection ? skillsSection[0] : text
  
  skillKeywords.forEach(skill => {
    if (lowerText.includes(skill.toLowerCase())) {
      skills.push(skill.charAt(0).toUpperCase() + skill.slice(1))
    }
  })
  
  // Extract skills from bullet points or comma-separated lists
  const skillMatches = skillsText.match(/(?:•|·|\*|-)\s*([A-Za-z][A-Za-z\s.+#]{1,25})/g)
  if (skillMatches) {
    skillMatches.forEach(match => {
      const skill = match.replace(/^(?:•|·|\*|-)\s*/, '').trim()
      if (skill.length > 2 && skill.length < 30) {
        skills.push(skill)
      }
    })
  }
  
  return [...new Set(skills)].slice(0, 20) // Remove duplicates and limit
}

function extractExperience(text: string): any[] {
  const experience: any[] = []
  
  // Look for work experience patterns
  const experienceSection = text.match(/(?:Experience|Work Experience|Professional Experience)[\s\S]*?(?=\n(?:Education|Skills|Projects)|$)/i)
  const expText = experienceSection ? experienceSection[0] : text
  
  // Pattern for job entries: Company, Title, Dates
  const jobPattern = /([A-Z][A-Za-z\s&.,]+?)\s*(?:\n|\s{2,})\s*([A-Z][A-Za-z\s]+?)\s*(?:\n|\s{2,})\s*(\d{4}[\s\-–to]*\d{0,4}|\w+\s+\d{4}[\s\-–to]*\w*\s*\d{0,4})/g
  
  let match
  while ((match = jobPattern.exec(expText)) !== null && experience.length < 5) {
    experience.push({
      company: match[1].trim(),
      position: match[2].trim(),
      duration: match[3].trim(),
      description: "Work experience details"
    })
  }
  
  return experience
}

function extractEducation(text: string): any[] {
  const education: any[] = []
  
  // Look for education section
  const educationSection = text.match(/(?:Education|Academic Background)[\s\S]*?(?=\n(?:Experience|Skills|Projects)|$)/i)
  const eduText = educationSection ? educationSection[0] : text
  
  // Pattern for education: Degree, Institution, Year
  const degreePattern = /(Bachelor|Master|PhD|B\.S\.|M\.S\.|B\.A\.|M\.A\.|Associate)[A-Za-z\s,.]*(University|College|Institute|School)[A-Za-z\s,]*(\d{4})/gi
  
  let match
  while ((match = degreePattern.exec(eduText)) !== null && education.length < 3) {
    education.push({
      degree: match[1],
      institution: match[2],
      year: match[3],
      field: "Field of study"
    })
  }
  
  return education
}
