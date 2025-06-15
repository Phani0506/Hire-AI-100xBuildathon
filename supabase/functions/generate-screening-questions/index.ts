
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getGeminiCompletion(prompt: string) {
  const apiKey = Deno.env.get('GOOGLE_AI_API_KEY');
  if (!apiKey) throw new Error('Google AI API key not found');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini error:', errorText);
    throw new Error(`Gemini API failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
    console.error('Unexpected Gemini response structure:', JSON.stringify(data));
    throw new Error('Invalid response from Gemini API');
  }
  
  return data.candidates[0].content.parts[0].text;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { skills, title } = await req.json();

    if (!skills || !Array.isArray(skills) || skills.length === 0) {
      throw new Error("Skills are required and must be a non-empty array.");
    }
    
    console.log(`Generating questions for title: ${title}, skills: ${skills.join(', ')}`);

    const prompt = `
      You are an expert technical recruiter and hiring manager.
      Based on the following candidate profile, generate 5 insightful and distinct screening questions to assess their expertise for the given job title.
      The questions should be practical and aim to understand the candidate's depth of knowledge and real-world application of their skills. Avoid generic or easily searchable questions.

      Candidate Profile:
      - Job Title Consideration: "${title || 'a relevant technical role'}"
      - Key Skills: ${skills.join(', ')}

      Return ONLY a valid JSON object with a single key "questions" which is an array of 5 strings.
      Example format:
      {
        "questions": [
          "Can you describe a situation where you used [Skill A] to solve a complex problem in a project related to [Job Title]?",
          "How would you approach designing a system that utilizes [Skill B] for scalability?",
          "Walk me through your process for debugging an issue involving [Skill C].",
          "What are the key differences between [Skill D] and [Similar Technology], and when would you choose one over the other?",
          "Describe a project you are particularly proud of that showcases your expertise in [Skill E]."
        ]
      }
    `;
    
    const aiResult = await getGeminiCompletion(prompt);
    console.log('Raw Gemini response:', aiResult);
    
    let cleanedResult = aiResult.trim();
    if (cleanedResult.startsWith('```json')) {
      cleanedResult = cleanedResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResult.startsWith('```')) {
      cleanedResult = cleanedResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleanedResult);

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error("AI response did not contain a valid 'questions' array.");
    }

    console.log('Successfully generated questions.');

    return new Response(JSON.stringify({ questions: parsed.questions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating questions:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
