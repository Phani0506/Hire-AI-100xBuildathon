
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

    if (!resumeId) {
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

    // Update status to processing
    await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'processing' })
      .eq('id', resumeId)

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

    // Convert file to text (simplified - in real app would use proper document parsing)
    const fileText = await fileData.text()

    // Get Groq API key from secrets
    const groqApiKey = Deno.env.get('GROQ_API_KEY')
    if (!groqApiKey) {
      console.error('Groq API key not found')
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
              "full_name": "string",
              "email": "string", 
              "phone": "string",
              "location": "string",
              "skills": ["array", "of", "skills"],
              "experience": [{"company": "string", "position": "string", "duration": "string"}],
              "education": [{"institution": "string", "degree": "string", "year": "string"}]
            }
            Return only valid JSON, no additional text.`
          },
          {
            role: 'user',
            content: `Parse this resume:\n\n${fileText}`
          }
        ],
        temperature: 0.1,
        max_tokens: 1000
      }),
    })

    if (!groqResponse.ok) {
      console.error('Groq API error:', await groqResponse.text())
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Failed to parse resume' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const groqData = await groqResponse.json()
    const parsedContent = groqData.choices[0]?.message?.content

    if (!parsedContent) {
      console.error('No content returned from Groq')
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'No content parsed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the JSON response
    let parsedData
    try {
      parsedData = JSON.parse(parsedContent)
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError)
      await supabaseClient
        .from('resumes')
        .update({ parsing_status: 'failed' })
        .eq('id', resumeId)
      
      return new Response(
        JSON.stringify({ error: 'Invalid response format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Insert parsed data
    const { error: insertError } = await supabaseClient
      .from('parsed_resume_details')
      .insert({
        resume_id: resumeId,
        user_id: resume.user_id,
        full_name: parsedData.full_name,
        email: parsedData.email,
        phone: parsedData.phone,
        location: parsedData.location,
        skills_json: parsedData.skills,
        experience_json: parsedData.experience,
        education_json: parsedData.education,
        raw_text_content: fileText
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

    return new Response(
      JSON.stringify({ success: true, message: 'Resume parsed successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
