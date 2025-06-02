
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
      // Clean the text for better AI processing
      fileText = fileText
        .replace(/\u0000/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/[^\x20-\x7E\n\r\t]/g, '') // Keep only printable ASCII + newlines/tabs
        .trim()
      
      console.log('File converted to text, length:', fileText.length)
      console.log('First 1000 characters:', fileText.substring(0, 1000))
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

    // Enhanced system prompt for comprehensive parsing
    const systemPrompt = `You are an expert resume parser. Your task is to extract ALL information from the resume text and return it as a valid JSON object.

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object, no additional text or formatting
2. Extract ALL information present in the resume
3. Be thorough and comprehensive in your extraction
4. If information is not found, use null for strings or empty arrays

Required JSON structure:
{
  "full_name": "string or null",
  "email": "string or null",
  "phone": "string or null", 
  "location": "string or null",
  "skills": ["array", "of", "technical", "and", "soft", "skills"],
  "experience": [
    {
      "company": "string",
      "position": "string", 
      "duration": "string",
      "description": "string",
      "responsibilities": ["array", "of", "responsibilities"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "field": "string", 
      "year": "string",
      "grade": "string or null"
    }
  ],
  "projects": [
    {
      "name": "string",
      "description": "string",
      "technologies": ["array", "of", "technologies"],
      "duration": "string or null"
    }
  ],
  "certifications": ["array", "of", "certifications"],
  "languages": ["array", "of", "languages"],
  "summary": "string or null"
}

EXTRACTION GUIDELINES:
- full_name: Look for the person's name (usually at the top)
- email: Find email addresses containing @
- phone: Find phone numbers in any format
- location: Find city, state, country information
- skills: Extract ALL technical skills, programming languages, frameworks, tools, soft skills
- experience: Extract ALL work history with complete details
- education: Extract ALL educational qualifications
- projects: Extract personal/academic projects mentioned
- certifications: Extract any certifications or licenses
- languages: Extract spoken/programming languages if mentioned separately
- summary: Extract professional summary or objective

Be extremely thorough and extract every piece of relevant information.`

    // Parse resume with Groq API
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3-70b-8192',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Extract ALL information from this resume text as JSON:\n\n${fileText.substring(0, 8000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 3000
      }),
    })

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text()
      console.error('Groq API error:', errorText)
      
      // Use comprehensive fallback parsing
      console.log('Using comprehensive fallback parsing due to API error...')
      const fallbackData = comprehensiveFallbackParsing(fileText)
      
      await insertParsedData(supabaseClient, resumeId, resume.user_id, fallbackData, fileText)
      await supabaseClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ success: true, message: 'Resume parsed with fallback method', parsedData: fallbackData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const groqData = await groqResponse.json()
    console.log('Groq response received:', JSON.stringify(groqData, null, 2))

    const parsedContent = groqData.choices[0]?.message?.content

    if (!parsedContent) {
      console.error('No content returned from Groq')
      const fallbackData = comprehensiveFallbackParsing(fileText)
      await insertParsedData(supabaseClient, resumeId, resume.user_id, fallbackData, fileText)
      await supabaseClient.from('resumes').update({ parsing_status: 'completed' }).eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ success: true, message: 'Resume parsed with fallback method', parsedData: fallbackData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Enhanced JSON parsing
    let parsedData
    try {
      let cleanedContent = parsedContent.trim()
      
      // Remove markdown formatting
      cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      
      // Extract JSON object
      const jsonStart = cleanedContent.indexOf('{')
      const jsonEnd = cleanedContent.lastIndexOf('}')
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1)
      }
      
      console.log('Attempting to parse JSON:', cleanedContent.substring(0, 500))
      parsedData = JSON.parse(cleanedContent)
      console.log('Successfully parsed JSON from AI')
      
      // Validate and enhance the parsed data
      parsedData = validateAndEnhanceParsedData(parsedData, fileText)
      
    } catch (parseError) {
      console.error('Failed to parse JSON from AI:', parseError)
      console.log('Using comprehensive fallback parsing...')
      parsedData = comprehensiveFallbackParsing(fileText)
    }

    // Insert parsed data into database
    await insertParsedData(supabaseClient, resumeId, resume.user_id, parsedData, fileText)

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

// Helper function to insert parsed data
async function insertParsedData(supabaseClient: any, resumeId: string, userId: string, parsedData: any, rawText: string) {
  const cleanRawText = rawText.substring(0, 10000)
    .replace(/\u0000/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\\/g, '\\\\')
    .trim()

  console.log('Inserting comprehensive parsed data:', JSON.stringify(parsedData, null, 2))

  const { error: insertError } = await supabaseClient
    .from('parsed_resume_details')
    .insert({
      resume_id: resumeId,
      user_id: userId,
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
    throw new Error(`Failed to save parsed data: ${insertError.message}`)
  }

  console.log('Successfully inserted parsed data')
}

// Comprehensive validation and enhancement
function validateAndEnhanceParsedData(data: any, originalText: string): any {
  const result = {
    full_name: data.full_name || extractName(originalText),
    email: data.email || extractEmail(originalText),
    phone: data.phone || extractPhone(originalText),
    location: data.location || extractLocation(originalText),
    skills: Array.isArray(data.skills) && data.skills.length > 0 ? data.skills : extractSkills(originalText),
    experience: Array.isArray(data.experience) && data.experience.length > 0 ? data.experience : extractExperience(originalText),
    education: Array.isArray(data.education) && data.education.length > 0 ? data.education : extractEducation(originalText),
    projects: Array.isArray(data.projects) ? data.projects : extractProjects(originalText),
    certifications: Array.isArray(data.certifications) ? data.certifications : extractCertifications(originalText),
    languages: Array.isArray(data.languages) ? data.languages : extractLanguages(originalText),
    summary: data.summary || extractSummary(originalText)
  }
  
  console.log('Enhanced parsed data:', JSON.stringify(result, null, 2))
  return result
}

// Comprehensive fallback parsing
function comprehensiveFallbackParsing(text: string): any {
  console.log('Starting comprehensive fallback parsing')
  
  const result = {
    full_name: extractName(text),
    email: extractEmail(text),
    phone: extractPhone(text),
    location: extractLocation(text),
    skills: extractSkills(text),
    experience: extractExperience(text),
    education: extractEducation(text),
    projects: extractProjects(text),
    certifications: extractCertifications(text),
    languages: extractLanguages(text),
    summary: extractSummary(text)
  }
  
  console.log('Comprehensive fallback result:', JSON.stringify(result, null, 2))
  return result
}

// Enhanced extraction functions
function extractName(text: string): string | null {
  const lines = text.split('\n').slice(0, 20)
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Look for name patterns
    if (trimmed && 
        /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,4}$/.test(trimmed) && 
        trimmed.length < 80 &&
        !trimmed.toLowerCase().includes('resume') &&
        !trimmed.toLowerCase().includes('cv') &&
        !trimmed.toLowerCase().includes('curriculum') &&
        !trimmed.toLowerCase().includes('profile')) {
      console.log('Found name:', trimmed)
      return trimmed
    }
  }
  
  // Look for "Name:" pattern
  const nameMatch = text.match(/(?:Name|Full Name):\s*([A-Z][a-z]+(?: [A-Z][a-z]+)+)/i)
  if (nameMatch) {
    console.log('Found name with pattern:', nameMatch[1])
    return nameMatch[1]
  }
  
  return null
}

function extractEmail(text: string): string | null {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const matches = text.match(emailRegex)
  const email = matches ? matches[0] : null
  if (email) console.log('Found email:', email)
  return email
}

function extractPhone(text: string): string | null {
  const phoneRegex = /(?:\+?91[-.\s]?)?(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  const match = text.match(phoneRegex)
  const phone = match ? match[0] : null
  if (phone) console.log('Found phone:', phone)
  return phone
}

function extractLocation(text: string): string | null {
  // Look for city, state patterns
  const locationRegex = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2}|[A-Z][a-z]+)\b/g
  const matches = text.match(locationRegex)
  if (matches) {
    console.log('Found location:', matches[0])
    return matches[0]
  }
  
  // Look for Indian cities
  const indianCities = ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad', 'Chennai', 'Kolkata', 'Pune', 'Ahmedabad', 'Jaipur', 'Surat']
  for (const city of indianCities) {
    if (text.includes(city)) {
      console.log('Found Indian city:', city)
      return city
    }
  }
  
  return null
}

function extractSkills(text: string): string[] {
  const skillKeywords = [
    // Programming Languages
    'JavaScript', 'Python', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', 'TypeScript',
    'HTML', 'CSS', 'SQL', 'R', 'MATLAB', 'Scala', 'Perl', 'Dart',
    // Frameworks & Libraries
    'React', 'Angular', 'Vue', 'Node.js', 'Express', 'Django', 'Flask', 'Spring', 'Laravel', 'Rails',
    'Next.js', 'Nuxt.js', 'Svelte', 'Bootstrap', 'Tailwind', 'jQuery', 'Redux', 'Vuex',
    // Databases
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'SQL Server', 'Cassandra', 'DynamoDB',
    // Cloud & DevOps
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Jenkins', 'Git', 'GitHub', 'GitLab', 'CI/CD',
    'Terraform', 'Ansible', 'Vagrant', 'Nginx', 'Apache',
    // Tools & Software
    'Jira', 'Confluence', 'Slack', 'Figma', 'Photoshop', 'Illustrator', 'VSCode', 'IntelliJ',
    // Methodologies
    'Agile', 'Scrum', 'Kanban', 'DevOps', 'TDD', 'BDD', 'Microservices', 'RESTful', 'GraphQL',
    // Soft Skills
    'Leadership', 'Communication', 'Problem Solving', 'Teamwork', 'Project Management', 'Analytical'
  ]
  
  const skills: string[] = []
  const lowerText = text.toLowerCase()
  
  // Extract from skills section
  const skillsSection = text.match(/(?:Skills?|Technical Skills?|Core Competencies|Technologies)[\s\S]*?(?=\n[A-Z]|\n\n|$)/i)
  const skillsText = skillsSection ? skillsSection[0] : text
  
  skillKeywords.forEach(skill => {
    if (lowerText.includes(skill.toLowerCase())) {
      skills.push(skill)
    }
  })
  
  // Extract from bullet points
  const skillMatches = skillsText.match(/(?:•|·|\*|-|→)\s*([A-Za-z][A-Za-z\s.+#/]{1,30})/g)
  if (skillMatches) {
    skillMatches.forEach(match => {
      const skill = match.replace(/^(?:•|·|\*|-|→)\s*/, '').trim()
      if (skill.length > 2 && skill.length < 35) {
        skills.push(skill)
      }
    })
  }
  
  const uniqueSkills = [...new Set(skills)].slice(0, 25)
  console.log('Found skills:', uniqueSkills)
  return uniqueSkills
}

function extractExperience(text: string): any[] {
  const experience: any[] = []
  
  // Look for work experience section
  const expSection = text.match(/(?:Experience|Work Experience|Professional Experience|Employment)[\s\S]*?(?=\n(?:Education|Skills|Projects|Certifications)|$)/i)
  const expText = expSection ? expSection[0] : text
  
  // Split by common separators and look for job entries
  const entries = expText.split(/\n(?=\S)/)
  
  for (const entry of entries) {
    if (entry.length < 50) continue
    
    // Look for company and position patterns
    const companyMatch = entry.match(/([A-Z][A-Za-z\s&.,]+(?:Ltd|Inc|Corp|Company|Technologies|Solutions|Systems)?)/i)
    const positionMatch = entry.match(/(Software Engineer|Developer|Analyst|Manager|Lead|Senior|Junior|Intern|Consultant|Architect|Designer|Specialist)/i)
    const dateMatch = entry.match(/(\d{4}[\s\-–to]*\d{0,4}|\w+\s+\d{4}[\s\-–to]*\w*\s*\d{0,4}|Present|Current)/i)
    
    if (companyMatch || positionMatch) {
      const responsibilities = entry.match(/(?:•|·|\*|-)\s*([^•·\*\-\n]+)/g)
      
      experience.push({
        company: companyMatch ? companyMatch[1].trim() : 'Company Name',
        position: positionMatch ? positionMatch[1].trim() : 'Position',
        duration: dateMatch ? dateMatch[1].trim() : 'Duration',
        description: entry.substring(0, 200) + '...',
        responsibilities: responsibilities ? responsibilities.map(r => r.replace(/^(?:•|·|\*|-)\s*/, '').trim()).slice(0, 5) : []
      })
    }
  }
  
  console.log('Found experience entries:', experience.length)
  return experience.slice(0, 10)
}

function extractEducation(text: string): any[] {
  const education: any[] = []
  
  // Look for education section
  const eduSection = text.match(/(?:Education|Academic Background|Qualifications)[\s\S]*?(?=\n(?:Experience|Skills|Projects)|$)/i)
  const eduText = eduSection ? eduSection[0] : text
  
  // Look for degree patterns
  const degreePatterns = [
    /(Bachelor|Master|PhD|B\.?\s*Tech|M\.?\s*Tech|B\.?\s*E|M\.?\s*E|B\.?\s*S|M\.?\s*S|B\.?\s*A|M\.?\s*A|B\.?\s*Com|M\.?\s*Com)[^,\n]*(?:,|\n|\s{2,})([^,\n]*(?:University|College|Institute|School))[^,\n]*(?:,|\n|\s{2,})*(\d{4})?/gi,
    /([^,\n]*(?:University|College|Institute|School))[^,\n]*(?:,|\n|\s{2,})*(Bachelor|Master|PhD|B\.?\s*Tech|M\.?\s*Tech)[^,\n]*(?:,|\n|\s{2,})*(\d{4})?/gi
  ]
  
  degreePatterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(eduText)) !== null && education.length < 5) {
      education.push({
        degree: match[1] || match[2] || 'Degree',
        institution: match[2] || match[1] || 'Institution',
        field: 'Field of Study',
        year: match[3] || 'Year',
        grade: null
      })
    }
  })
  
  console.log('Found education entries:', education.length)
  return education
}

function extractProjects(text: string): any[] {
  const projects: any[] = []
  
  const projectSection = text.match(/(?:Projects?|Academic Projects|Personal Projects)[\s\S]*?(?=\n(?:Experience|Education|Skills|Certifications)|$)/i)
  const projectText = projectSection ? projectSection[0] : ''
  
  if (projectText) {
    const projectEntries = projectText.split(/\n(?=\S)/)
    
    projectEntries.forEach(entry => {
      if (entry.length > 30) {
        const nameMatch = entry.match(/^([^:\n]{10,80})(?::|$)/m)
        if (nameMatch) {
          projects.push({
            name: nameMatch[1].trim(),
            description: entry.substring(0, 150) + '...',
            technologies: extractSkills(entry).slice(0, 5),
            duration: null
          })
        }
      }
    })
  }
  
  console.log('Found projects:', projects.length)
  return projects.slice(0, 5)
}

function extractCertifications(text: string): string[] {
  const certifications: string[] = []
  
  const certSection = text.match(/(?:Certifications?|Certificates?|Awards?)[\s\S]*?(?=\n(?:Experience|Education|Skills|Projects)|$)/i)
  const certText = certSection ? certSection[0] : ''
  
  if (certText) {
    const certMatches = certText.match(/(?:•|·|\*|-)\s*([^•·\*\-\n]{10,100})/g)
    if (certMatches) {
      certMatches.forEach(match => {
        const cert = match.replace(/^(?:•|·|\*|-)\s*/, '').trim()
        if (cert.length > 5) {
          certifications.push(cert)
        }
      })
    }
  }
  
  console.log('Found certifications:', certifications.length)
  return certifications.slice(0, 10)
}

function extractLanguages(text: string): string[] {
  const languages = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Spanish', 'French', 'German', 'Chinese', 'Japanese']
  const foundLanguages: string[] = []
  
  languages.forEach(lang => {
    if (text.includes(lang)) {
      foundLanguages.push(lang)
    }
  })
  
  console.log('Found languages:', foundLanguages)
  return foundLanguages
}

function extractSummary(text: string): string | null {
  const summarySection = text.match(/(?:Summary|Objective|Profile|About)[\s\S]*?(?=\n(?:Experience|Education|Skills)|$)/i)
  if (summarySection) {
    const summary = summarySection[0].replace(/(?:Summary|Objective|Profile|About)[:]*\s*/i, '').trim()
    if (summary.length > 20) {
      console.log('Found summary:', summary.substring(0, 100))
      return summary.substring(0, 500)
    }
  }
  
  return null
}
