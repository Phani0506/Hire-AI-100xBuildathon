
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

    // Convert file to text (basic text extraction - for PDFs and complex docs, you might need additional parsing)
    let fileText = ''
    try {
      fileText = await fileData.text()
      console.log('File converted to text, length:', fileText.length)
    } catch (error) {
      console.error('Error converting file to text:', error)
      // For binary files like PDFs, we might get limited text extraction
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
            content: `You are a resume parser. Extract structured information from resumes and return it as JSON with these exact fields:
            {
              "full_name": "string or null",
              "email": "string or null", 
              "phone": "string or null",
              "location": "string or null",
              "skills": ["array", "of", "skills"],
              "experience": [{"company": "string", "position": "string", "duration": "string", "description": "string"}],
              "education": [{"institution": "string", "degree": "string", "year": "string", "field": "string"}]
            }
            
            Important rules:
            - Return ONLY valid JSON, no additional text or markdown
            - If a field cannot be found, use null for strings or empty array for arrays
            - Extract all skills mentioned (technical, soft skills, tools, languages)
            - For experience, include company name, job title, duration, and brief description
            - For education, include school/university, degree, graduation year, field of study
            - Ensure the JSON is properly formatted and parseable`
          },
          {
            role: 'user',
            content: `Parse this resume and extract the information:\n\n${fileText.substring(0, 4000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1500
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

    // Parse the JSON response
    let parsedData
    try {
      // Clean the response in case there's any markdown formatting
      const cleanedContent = parsedContent.replace(/```json\n?|\n?```/g, '').trim()
      parsedData = JSON.parse(cleanedContent)
      console.log('Successfully parsed JSON:', parsedData)
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError)
      console.error('Raw content:', parsedContent)
      
      // Try to create a fallback structure
      parsedData = {
        full_name: null,
        email: null,
        phone: null,
        location: null,
        skills: [],
        experience: [],
        education: []
      }
    }

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
        raw_text_content: fileText.substring(0, 5000) // Store first 5000 chars
      })

    if (insertError) {
      console.error('Insert error:', insertError)
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Failed to save parsed data' }),
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
