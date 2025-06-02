import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
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

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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

    await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'processing' })
      .eq('id', resumeId)

    console.log('Updated status to processing')

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

    let fileText = ''
    try {
      fileText = await fileData.text()
      fileText = cleanText(fileText)
      console.log('File converted to text, length:', fileText.length)
      console.log('First 500 characters:', fileText.substring(0, 500))
    } catch (error) {
      console.error('Error converting file to text:', error)
      fileText = 'Unable to extract text from file. Please ensure the file contains readable text.'
    }

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

    // Enhanced system prompt for better parsing
    const systemPrompt = `You are an expert resume parser with advanced natural language processing capabilities. Your task is to extract comprehensive information from resume text and return it as a valid JSON object.

CRITICAL INSTRUCTIONS:
1. Return ONLY a valid JSON object, no additional text, explanations, or formatting
2. Extract ALL information present in the resume with high accuracy
3. Use intelligent inference to fill gaps in information
4. If information is not explicitly stated, use null for strings or empty arrays

REQUIRED JSON STRUCTURE (EXACT FORMAT):
{
  "full_name": "string or null",
  "email": "string or null", 
  "phone": "string or null",
  "location": "string or null",
  "skills": ["array", "of", "all", "technical", "and", "soft", "skills"],
  "experience": [
    {
      "company": "string",
      "position": "string",
      "duration": "string", 
      "description": "string",
      "responsibilities": ["array", "of", "key", "responsibilities"]
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
  "languages": ["array", "of", "spoken", "languages"],
  "summary": "string or null"
}

EXTRACTION GUIDELINES:
- full_name: Extract the candidate's complete name (usually at the top of resume)
- email: Find email addresses (contains @ symbol)
- phone: Extract phone numbers in any format
- location: Find city, state, country information
- skills: Extract ALL technical skills, programming languages, frameworks, tools, software, methodologies, and relevant soft skills
- experience: Extract complete work history with all details
- education: Extract all educational qualifications with complete information
- projects: Extract personal, academic, or professional projects
- certifications: Extract all certifications, licenses, awards
- languages: Extract spoken/written languages (not programming languages)
- summary: Extract professional summary, objective, or profile summary

PARSING INTELLIGENCE:
- Look for section headers like "Experience", "Education", "Skills", "Projects"
- Parse dates in various formats (2020-2023, Jan 2020 - Present, etc.)
- Identify company names, job titles, educational institutions
- Extract technical skills from various sections, not just "Skills"
- Infer missing information from context when possible
- Handle different resume formats and layouts

Be extremely thorough and accurate in your extraction.`

    let parsedData
    let usesFallback = false

    try {
      // First attempt with Groq API
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
              content: `Extract ALL information from this resume text as JSON:\n\n${fileText.substring(0, 12000)}`
            }
          ],
          temperature: 0.1,
          max_tokens: 4000
        }),
      })

      if (!groqResponse.ok) {
        const errorText = await groqResponse.text()
        console.error('Groq API error:', errorText)
        throw new Error('Groq API failed')
      }

      const groqData = await groqResponse.json()
      console.log('Groq response received successfully')

      const parsedContent = groqData.choices[0]?.message?.content

      if (!parsedContent) {
        throw new Error('No content returned from Groq')
      }

      // Enhanced JSON parsing
      let cleanedContent = parsedContent.trim()
      cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      
      const jsonStart = cleanedContent.indexOf('{')
      const jsonEnd = cleanedContent.lastIndexOf('}')
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1)
      }
      
      console.log('Attempting to parse JSON from AI response')
      parsedData = JSON.parse(cleanedContent)
      console.log('Successfully parsed JSON from AI')
      
      // Validate and enhance the parsed data
      parsedData = validateAndEnhanceParsedData(parsedData, fileText)
      
    } catch (parseError) {
      console.error('AI parsing failed:', parseError)
      console.log('Using enhanced fallback parsing...')
      parsedData = enhancedFallbackParsing(fileText)
      usesFallback = true
    }

    // Insert parsed data into database
    await insertParsedData(supabaseClient, resumeId, resume.user_id, parsedData, fileText)

    await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'completed' })
      .eq('id', resumeId)

    console.log('Resume parsing completed successfully')

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: usesFallback ? 'Resume parsed with enhanced fallback method' : 'Resume parsed successfully',
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

// Enhanced text cleaning function
function cleanText(text: string): string {
  return text
    .replace(/\u0000/g, '') // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[^\x20-\x7E\n\r\t\u00A0-\u017F\u0100-\u017F]/g, '') // Keep printable ASCII + extended Latin
    .trim()
}

// Enhanced validation and enhancement
function validateAndEnhanceParsedData(data: any, originalText: string): any {
  const result = {
    full_name: data.full_name || extractName(originalText),
    email: data.email || extractEmail(originalText),
    phone: data.phone || extractPhone(originalText),
    location: data.location || extractLocation(originalText),
    skills: Array.isArray(data.skills) && data.skills.length > 0 ? 
      cleanSkillsArray(data.skills) : extractSkills(originalText),
    experience: Array.isArray(data.experience) && data.experience.length > 0 ? 
      data.experience : extractExperience(originalText),
    education: Array.isArray(data.education) && data.education.length > 0 ? 
      data.education : extractEducation(originalText),
    projects: Array.isArray(data.projects) ? data.projects : extractProjects(originalText),
    certifications: Array.isArray(data.certifications) ? data.certifications : extractCertifications(originalText),
    languages: Array.isArray(data.languages) ? data.languages : extractLanguages(originalText),
    summary: data.summary || extractSummary(originalText)
  }
  
  console.log('Enhanced parsed data:', JSON.stringify(result, null, 2))
  return result
}

// Enhanced fallback parsing with better algorithms
function enhancedFallbackParsing(text: string): any {
  console.log('Starting enhanced fallback parsing')
  
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
  
  console.log('Enhanced fallback result:', JSON.stringify(result, null, 2))
  return result
}

// Enhanced name extraction
function extractName(text: string): string | null {
  const lines = text.split('\n').slice(0, 25)
  
  // Common name patterns
  const namePatterns = [
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/,
    /^([A-Z][A-Z\s]+)$/,
    /(?:Name|Full Name):\s*([A-Z][a-z]+(?: [A-Z][a-z]+)+)/i
  ]
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length < 3 || trimmed.length > 50) continue
    
    // Skip lines with common resume keywords
    if (/resume|cv|curriculum|vitae|profile|contact|email|phone|address/i.test(trimmed)) continue
    
    for (const pattern of namePatterns) {
      const match = trimmed.match(pattern)
      if (match) {
        console.log('Found name:', match[1])
        return match[1].trim()
      }
    }
  }
  
  return null
}

function extractEmail(text: string): string | null {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g
  const matches = text.match(emailRegex)
  if (matches && matches.length > 0) {
    // Filter out obviously invalid emails
    const validEmails = matches.filter(email => 
      !email.includes('example.com') && 
      !email.includes('test.com') &&
      email.length < 50
    )
    if (validEmails.length > 0) {
      console.log('Found email:', validEmails[0])
      return validEmails[0]
    }
  }
  return null
}

function extractPhone(text: string): string | null {
  const phonePatterns = [
    /\+?[\d\s\-\(\)]{10,}/g,
    /(?:\+?91[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g,
    /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  ]
  
  for (const pattern of phonePatterns) {
    const matches = text.match(pattern)
    if (matches) {
      // Filter and clean phone numbers
      const cleanPhone = matches[0].replace(/[^\d+]/g, '')
      if (cleanPhone.length >= 10 && cleanPhone.length <= 15) {
        console.log('Found phone:', matches[0])
        return matches[0]
      }
    }
  }
  
  return null
}

function extractLocation(text: string): string | null {
  // Enhanced location patterns
  const locationPatterns = [
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),\s*([A-Z]{2}|[A-Z][a-z]+)(?:,\s*([A-Z][a-z]+))?\b/g,
    /\b(Mumbai|Delhi|Bangalore|Hyderabad|Chennai|Kolkata|Pune|Ahmedabad|Jaipur|Surat|Lucknow|Kanpur|Nagpur|Visakhapatnam|Indore|Thane|Bhopal|Pimpri-Chinchwad|Patna|Vadodara|Ghaziabad|Ludhiana|Agra|Nashik|Faridabad|Meerut|Rajkot|Kalyan-Dombivli|Vasai-Virar|Varanasi|Srinagar|Aurangabad|Dhanbad|Amritsar|Navi Mumbai|Allahabad|Ranchi|Howrah|Coimbatore|Jabalpur|Gwalior|Vijayawada|Jodhpur|Madurai|Raipur|Kota|Guwahati|Chandigarh|Solapur|Hubli-Dharwad|Bareilly|Moradabad|Mysore|Gurgaon|Aligarh|Jalandhar|Tiruchirappalli|Bhubaneswar|Salem|Mira-Bhayandar|Warangal|Thiruvananthapuram|Guntur|Bhiwandi|Saharanpur|Gorakhpur|Bikaner|Amravati|Noida|Jamshedpur|Bhilai|Cuttack|Firozabad|Kochi|Nellore|Bhavnagar|Dehradun|Durgapur|Asansol|Rourkela|Nanded|Kolhapur|Ajmer|Akola|Gulbarga|Jamnagar|Ujjain|Loni|Siliguri|Jhansi|Ulhasnagar|Jammu|Sangli-Miraj & Kupwad|Mangalore|Erode|Belgaum|Ambattur|Tirunelveli|Malegaon|Gaya|Jalgaon|Udaipur|Maheshtala)\b/i,
    /(New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Austin|Jacksonville|San Francisco|Indianapolis|Columbus|Fort Worth|Charlotte|Seattle|Denver|El Paso|Detroit|Washington|Boston|Memphis|Nashville|Portland|Oklahoma City|Las Vegas|Baltimore|Louisville|Milwaukee|Albuquerque|Tucson|Fresno|Sacramento|Long Beach|Kansas City|Mesa|Virginia Beach|Atlanta|Colorado Springs|Omaha|Raleigh|Miami|Oakland|Minneapolis|Tulsa|Cleveland|Wichita|Arlington|New Orleans|Bakersfield|Tampa|Honolulu|Aurora|Anaheim|Santa Ana|St. Louis|Riverside|Corpus Christi|Lexington|Pittsburgh|Anchorage|Stockton|Cincinnati|St. Paul|Toledo|Greensboro|Newark|Plano|Henderson|Lincoln|Buffalo|Jersey City|Chula Vista|Fort Wayne|Orlando|St. Petersburg|Chandler|Laredo|Norfolk|Durham|Madison|Lubbock|Irvine|Winston-Salem|Glendale|Garland|Hialeah|Reno|Chesapeake|Gilbert|Baton Rouge|Irving|Scottsdale|North Las Vegas|Fremont|Boise|Richmond|San Bernardino|Birmingham|Spokane|Rochester|Des Moines|Modesto|Fayetteville|Tacoma|Oxnard|Fontana|Columbus|Montgomery|Moreno Valley|Shreveport|Aurora|Yonkers|Akron|Huntington Beach|Little Rock|Augusta|Amarillo|Glendale|Mobile|Grand Rapids|Salt Lake City|Tallahassee|Huntsville|Grand Prairie|Knoxville|Worcester|Newport News|Brownsville|Overland Park|Santa Clarita|Providence|Garden Grove|Chattanooga|Oceanside|Jackson|Fort Lauderdale|Santa Rosa|Rancho Cucamonga|Port St. Lucie|Tempe|Ontario|Vancouver|Cape Coral|Sioux Falls|Springfield|Peoria|Pembroke Pines|Elk Grove|Salem|Lancaster|Corona|Eugene|Palmdale|Salinas|Springfield|Pasadena|Fort Collins|Hayward|Pomona|Cary|Rockford|Alexandria|Escondido|McKinney|Kansas City|Joliet|Sunnyvale|Torrance|Bridgeport|Lakewood|Hollywood|Paterson|Naperville|Syracuse|Mesquite|Dayton|Savannah|Clarksville|Orange|Pasadena|Fullerton|Killeen|Frisco|Hampton|McAllen|Warren|Bellevue|West Valley City|Columbia|Olathe|Sterling Heights|New Haven|Miramar|Waco|Thousand Oaks|Cedar Rapids|Charleston|Sioux City|Round Rock|Fargo|Columbia|Coral Springs|Stamford|Concord|Hartford|Kent|Lafayette|Midland|Surprise|Denton|Victorville|Evansville|Santa Clara|Abilene|Athens|Vallejo|Allentown|Norman|Beaumont|Independence|Murfreesboro|Ann Arbor|Springfield|Berkeley|Peoria|Provo|El Monte|Columbia|Lansing|Fargo|Downey|Costa Mesa|Wilmington|Arvada|Inglewood|Miami Gardens|Carlsbad|Westminster|Rochester|Odessa|Manchester|Elgin|West Jordan|Round Rock|Clearwater|Waterbury|Gresham|Fairfield|Billings|Lowell|San Buenaventura|Pueblo|High Point|West Covina|Richmond|Murrieta|Cambridge|Antioch|Temecula|Norwalk|Centennial|Everett|Palm Bay|Wichita Falls|Green Bay|Daly City|Burbank|Richardson|Pompano Beach|North Charleston|Broken Arrow|Boulder|West Palm Beach|Surprise|Thornton|League City|Dearborn|Roseville|Tallahassee|San Mateo|Hillsboro|Greeley|Concord|Allentown|Rochester|Columbus|Davenport|St. Petersburg|Lakeland|Davie|Pearland|Aurora|Rialto|Edison|Sandy Springs|Tyler|Clifton|Citrus Heights|College Station|Rio Rancho|Duluth|Sugar Land|Woodbridge|Carrollton|Evansville|Frisco|Clearwater|Charleston|Stamford|Sandy|Westminster|North Las Vegas|Richmond|Beaumont|Odessa|El Cajon|Gainesville|Clovis|Norwalk)\b/i
  ]
  
  for (const pattern of locationPatterns) {
    const matches = text.match(pattern)
    if (matches) {
      console.log('Found location:', matches[0])
      return matches[0]
    }
  }
  
  return null
}

function cleanSkillsArray(skills: any[]): string[] {
  return skills
    .map(skill => String(skill).trim())
    .filter(skill => 
      skill.length > 1 && 
      skill.length < 50 && 
      !skill.includes('/') ||
      skill.split('/').length <= 2
    )
    .filter(skill => !skill.match(/^[^a-zA-Z]*$/)) // Remove non-alphabetic entries
    .slice(0, 30) // Limit to 30 skills
}

function extractSkills(text: string): string[] {
  const technicalSkills = [
    // Programming Languages
    'JavaScript', 'Python', 'Java', 'C++', 'C#', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', 'TypeScript',
    'HTML', 'CSS', 'SQL', 'R', 'MATLAB', 'Scala', 'Perl', 'Dart', 'Objective-C', 'Shell', 'PowerShell',
    // Frontend Frameworks & Libraries
    'React', 'Angular', 'Vue', 'Vue.js', 'React.js', 'Angular.js', 'Svelte', 'jQuery', 'Bootstrap', 'Tailwind',
    'Material-UI', 'Ant Design', 'Chakra UI', 'Sass', 'Less', 'Stylus',
    // Backend Frameworks
    'Node.js', 'Express', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Laravel', 'Rails', 'ASP.NET',
    'Next.js', 'Nuxt.js', 'Gatsby', 'Nest.js',
    // Databases
    'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle', 'SQL Server', 'Cassandra', 'DynamoDB',
    'Neo4j', 'CouchDB', 'MariaDB', 'Firebase', 'Supabase',
    // Cloud & DevOps
    'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Jenkins', 'Git', 'GitHub', 'GitLab',
    'Terraform', 'Ansible', 'Vagrant', 'Nginx', 'Apache', 'CI/CD', 'DevOps',
    // Tools & Software
    'Jira', 'Confluence', 'Slack', 'Figma', 'Photoshop', 'Illustrator', 'VSCode', 'IntelliJ', 'Eclipse',
    'Postman', 'Swagger', 'Tableau', 'Power BI',
    // Methodologies & Concepts
    'Agile', 'Scrum', 'Kanban', 'TDD', 'BDD', 'Microservices', 'RESTful', 'GraphQL', 'API', 'MVC',
    'Machine Learning', 'Data Science', 'AI', 'Deep Learning', 'NLP', 'Computer Vision',
    // Soft Skills
    'Leadership', 'Communication', 'Problem Solving', 'Teamwork', 'Project Management', 'Analytical'
  ]
  
  const skills: string[] = []
  const lowerText = text.toLowerCase()
  
  // Extract from skills section
  const skillsSection = text.match(/(?:Skills?|Technical Skills?|Core Competencies|Technologies|Expertise)[\s\S]*?(?=\n[A-Z]|\n\n|$)/i)
  const skillsText = skillsSection ? skillsSection[0] : text
  
  // Check for each known skill
  technicalSkills.forEach(skill => {
    if (lowerText.includes(skill.toLowerCase())) {
      skills.push(skill)
    }
  })
  
  // Extract from bullet points and lists
  const skillMatches = skillsText.match(/(?:•|·|\*|-|→)\s*([A-Za-z][A-Za-z\s.+#/]{1,25})/g)
  if (skillMatches) {
    skillMatches.forEach(match => {
      const skill = match.replace(/^(?:•|·|\*|-|→)\s*/, '').trim()
      if (skill.length > 2 && skill.length < 30 && !skills.includes(skill)) {
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
  
  const expSection = text.match(/(?:Experience|Work Experience|Professional Experience|Employment|Career History)[\s\S]*?(?=\n(?:Education|Skills|Projects|Certifications)|$)/i)
  const expText = expSection ? expSection[0] : text
  
  const entries = expText.split(/\n(?=\S)/)
  
  for (const entry of entries) {
    if (entry.length < 50) continue
    
    const companyMatch = entry.match(/([A-Z][A-Za-z\s&.,()]+(?:Ltd|Inc|Corp|Company|Technologies|Solutions|Systems|Group|LLC|LLP|Pvt|Private|Limited)?)/i)
    const positionMatch = entry.match(/(Software Engineer|Developer|Analyst|Manager|Lead|Senior|Junior|Intern|Consultant|Architect|Designer|Specialist|Director|VP|President|CEO|CTO|Programmer|Tester|DevOps|Data Scientist|Product Manager|Project Manager|Team Lead|Technical Lead|Full Stack|Frontend|Backend|Mobile|Web|QA|Quality Assurance)/i)
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
  return experience.slice(0, 8)
}

function extractEducation(text: string): any[] {
  const education: any[] = []
  
  const eduSection = text.match(/(?:Education|Academic Background|Qualifications|Academic Qualifications)[\s\S]*?(?=\n(?:Experience|Skills|Projects)|$)/i)
  const eduText = eduSection ? eduSection[0] : text
  
  const degreePatterns = [
    /(Bachelor|Master|PhD|B\.?\s*Tech|M\.?\s*Tech|B\.?\s*E|M\.?\s*E|B\.?\s*S|M\.?\s*S|B\.?\s*A|M\.?\s*A|B\.?\s*Com|M\.?\s*Com|MBA|BBA|BCA|MCA)[^,\n]*(?:,|\n|\s{2,})([^,\n]*(?:University|College|Institute|School))[^,\n]*(?:,|\n|\s{2,})*(\d{4})?/gi,
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
  
  const projectSection = text.match(/(?:Projects?|Academic Projects|Personal Projects|Key Projects)[\s\S]*?(?=\n(?:Experience|Education|Skills|Certifications)|$)/i)
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
  
  const certSection = text.match(/(?:Certifications?|Certificates?|Awards?|Achievements?)[\s\S]*?(?=\n(?:Experience|Education|Skills|Projects)|$)/i)
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
  const languages = ['English', 'Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Spanish', 'French', 'German', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Portuguese', 'Italian', 'Dutch', 'Russian']
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
  const summarySection = text.match(/(?:Summary|Objective|Profile|About|Professional Summary|Career Objective)[\s\S]*?(?=\n(?:Experience|Education|Skills)|$)/i)
  if (summarySection) {
    const summary = summarySection[0].replace(/(?:Summary|Objective|Profile|About|Professional Summary|Career Objective)[:]*\s*/i, '').trim()
    if (summary.length > 20) {
      console.log('Found summary:', summary.substring(0, 100))
      return summary.substring(0, 500)
    }
  }
  
  return null
}

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
