
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

// Input validation and sanitization
const validateInput = (input: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!input.resumeId || typeof input.resumeId !== 'string') {
    errors.push('Invalid resume ID');
  }
  
  if (!input.filePath || typeof input.filePath !== 'string') {
    errors.push('Invalid file path');
  }
  
  // Check for path traversal attempts
  if (input.filePath?.includes('..') || input.filePath?.includes('//')) {
    errors.push('Invalid file path format');
  }
  
  // Limit file path length
  if (input.filePath?.length > 500) {
    errors.push('File path too long');
  }
  
  return { valid: errors.length === 0, errors };
};

// Rate limiting storage
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

const checkRateLimit = (userId: string): boolean => {
  const now = Date.now();
  const userRequests = requestCounts.get(userId);
  
  if (!userRequests || now > userRequests.resetTime) {
    requestCounts.set(userId, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (userRequests.count >= RATE_LIMIT) {
    return false;
  }
  
  userRequests.count++;
  return true;
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from JWT token
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Authentication failed');
    }

    // Rate limiting check
    if (!checkRateLimit(user.id)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
        { 
          status: 429, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Parse and validate request body
    let requestBody;
    try {
      requestBody = await req.json();
    } catch {
      throw new Error('Invalid JSON in request body');
    }

    // Input validation
    const validation = validateInput(requestBody);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Input validation failed', details: validation.errors }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const { resumeId, filePath } = requestBody;

    // Verify user owns this resume
    const { data: resume, error: resumeError } = await supabaseClient
      .from('resumes')
      .select('user_id, file_name')
      .eq('id', resumeId)
      .eq('user_id', user.id)
      .single();

    if (resumeError || !resume) {
      throw new Error('Resume not found or access denied');
    }

    // Download file from storage with size limit (10MB)
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from('resumes')
      .download(filePath);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`);
    }

    // Check file size (10MB limit)
    if (fileData.size > 10 * 1024 * 1024) {
      throw new Error('File too large. Maximum size is 10MB.');
    }

    // Convert file to text with sanitization
    const fileText = await fileData.text();
    
    // Sanitize text content - remove potentially harmful content
    const sanitizedText = fileText
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .slice(0, 50000) // Limit text length
      .trim();

    if (!sanitizedText) {
      throw new Error('No readable content found in file');
    }

    // Get Google AI API key
    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!googleApiKey) {
      throw new Error('Google AI API key not configured');
    }

    // Parse resume using Google AI with improved prompt
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${googleApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Please analyze this resume and extract the following information in valid JSON format only. Do not include any explanation or additional text:

{
  "full_name": "string",
  "email": "string",
  "phone": "string", 
  "location": "string",
  "skills": ["skill1", "skill2", "skill3"],
  "experience": [
    {
      "title": "string",
      "company": "string", 
      "duration": "string",
      "description": "string"
    }
  ],
  "education": [
    {
      "degree": "string",
      "institution": "string",
      "year": "string"
    }
  ]
}

Resume content:
${sanitizedText}`
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!aiResponse.ok) {
      throw new Error(`AI parsing failed with status: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error('No response from AI service');
    }

    // Parse AI response as JSON with error handling
    let parsedData;
    try {
      // Extract JSON from AI response (in case there's extra text)
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : aiText;
      parsedData = JSON.parse(jsonString);
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }

    // Validate and sanitize parsed data
    const cleanedData = {
      full_name: typeof parsedData.full_name === 'string' ? parsedData.full_name.slice(0, 100) : null,
      email: typeof parsedData.email === 'string' ? parsedData.email.slice(0, 254) : null,
      phone: typeof parsedData.phone === 'string' ? parsedData.phone.slice(0, 20) : null,
      location: typeof parsedData.location === 'string' ? parsedData.location.slice(0, 100) : null,
      skills_json: Array.isArray(parsedData.skills) ? parsedData.skills.slice(0, 50) : [],
      experience_json: Array.isArray(parsedData.experience) ? parsedData.experience.slice(0, 20) : [],
      education_json: Array.isArray(parsedData.education) ? parsedData.education.slice(0, 10) : [],
      raw_text_content: sanitizedText.slice(0, 10000) // Limit stored content
    };

    // Store parsed data in database
    const { error: insertError } = await supabaseClient
      .from('parsed_resume_details')
      .insert({
        resume_id: resumeId,
        user_id: user.id,
        ...cleanedData
      });

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // Update resume status
    const { error: updateError } = await supabaseClient
      .from('resumes')
      .update({ parsing_status: 'completed' })
      .eq('id', resumeId);

    if (updateError) {
      console.error('Failed to update resume status:', updateError);
    }

    // Log successful parsing
    await supabaseClient.rpc('log_auth_event', {
      event_type: 'resume_parsed',
      user_email: user.email
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Resume parsed successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Resume parsing error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Resume parsing failed', 
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
