
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
      // Clean the text to remove problematic characters
      fileText = fileText.replace(/\u0000/g, '') // Remove null bytes
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
        .trim()
      console.log('File converted to text, length:', fileText.length)
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

    // Parse resume with Groq API
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
            content: `You are a resume parser. Extract structured information from resumes and return ONLY a valid JSON object with these exact fields:
            {
              "full_name": "string or null",
              "email": "string or null", 
              "phone": "string or null",
              "location": "string or null",
              "skills": ["array", "of", "skills"],
              "experience": [{"company": "string", "position": "string", "duration": "string", "description": "string"}],
              "education": [{"institution": "string", "degree": "string", "year": "string", "field": "string"}]
            }
            
            CRITICAL: Return ONLY the JSON object, no additional text, explanations, or markdown formatting.
            If a field cannot be found, use null for strings or empty array for arrays.
            Extract all skills mentioned (technical, soft skills, tools, languages).
            For experience, include company name, job title, duration, and brief description.
            For education, include school/university, degree, graduation year, field of study.`
          },
          {
            role: 'user',
            content: `Parse this resume and extract the information as JSON only:\n\n${fileText.substring(0, 4000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
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

    // Parse the JSON response with better error handling
    let parsedData
    try {
      // Clean the response more aggressively
      let cleanedContent = parsedContent.trim()
      
      // Remove markdown code blocks if present
      cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      
      // Find JSON object boundaries
      const jsonStart = cleanedContent.indexOf('{')
      const jsonEnd = cleanedContent.lastIndexOf('}')
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedContent = cleanedContent.substring(jsonStart, jsonEnd + 1)
      }
      
      console.log('Attempting to parse cleaned content:', cleanedContent.substring(0, 200))
      parsedData = JSON.parse(cleanedContent)
      console.log('Successfully parsed JSON:', parsedData)
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError)
      console.error('Raw content:', parsedContent)
      
      // Create a fallback structure with extracted basic info
      parsedData = {
        full_name: extractName(fileText),
        email: extractEmail(fileText),
        phone: extractPhone(fileText),
        location: extractLocation(fileText),
        skills: extractSkills(fileText),
        experience: [],
        education: []
      }
      console.log('Using fallback parsing:', parsedData)
    }

    // Clean the raw text content for database storage
    const cleanRawText = fileText.substring(0, 5000)
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

// Helper functions for fallback parsing
function extractName(text: string): string | null {
  const lines = text.split('\n').slice(0, 10)
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && /^[A-Z][a-z]+ [A-Z][a-z]+/.test(trimmed) && trimmed.length < 50) {
      return trimmed
    }
  }
  return null
}

function extractEmail(text: string): string | null {
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/
  const match = text.match(emailRegex)
  return match ? match[0] : null
}

function extractPhone(text: string): string | null {
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  const match = text.match(phoneRegex)
  return match ? match[0] : null
}

function extractLocation(text: string): string | null {
  const locationRegex = /\b[A-Z][a-z]+,\s*[A-Z][a-z]+\b/
  const match = text.match(locationRegex)
  return match ? match[0] : null
}

function extractSkills(text: string): string[] {
  const skillKeywords = ['javascript', 'python', 'java', 'react', 'node', 'sql', 'html', 'css', 'git', 'docker', 'aws', 'typescript']
  const skills: string[] = []
  
  skillKeywords.forEach(skill => {
    if (text.toLowerCase().includes(skill)) {
      skills.push(skill.charAt(0).toUpperCase() + skill.slice(1))
    }
  })
  
  return skills
}
