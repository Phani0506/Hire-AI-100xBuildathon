
-- Step 1: Clean up duplicate RLS policies and standardize them
-- First, drop all existing policies to start fresh
DROP POLICY IF EXISTS "Users can insert their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can view their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can update their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can delete their own resumes" ON public.resumes;

DROP POLICY IF EXISTS "Users can insert their own parsed resume details" ON public.parsed_resume_details;
DROP POLICY IF EXISTS "Users can view their own parsed resume details" ON public.parsed_resume_details;
DROP POLICY IF EXISTS "Users can insert their own parsed details" ON public.parsed_resume_details;
DROP POLICY IF EXISTS "Users can view their own parsed details" ON public.parsed_resume_details;

DROP POLICY IF EXISTS "Users can manage their own resume files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own resumes" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own resumes" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own resumes" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own resumes" ON storage.objects;

-- Create standardized RLS policies with consistent naming
-- Resumes table policies
CREATE POLICY "resumes_select_own" ON public.resumes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "resumes_insert_own" ON public.resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "resumes_update_own" ON public.resumes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "resumes_delete_own" ON public.resumes
  FOR DELETE USING (auth.uid() = user_id);

-- Parsed resume details policies
CREATE POLICY "parsed_details_select_own" ON public.parsed_resume_details
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "parsed_details_insert_own" ON public.parsed_resume_details
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Storage policies for resume files
CREATE POLICY "resume_files_all_operations" ON storage.objects
  FOR ALL USING (
    bucket_id = 'resumes' AND 
    auth.uid() = (storage.foldername(name))[1]::uuid
  )
  WITH CHECK (
    bucket_id = 'resumes' AND 
    auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- Add security function for authentication event logging
CREATE OR REPLACE FUNCTION public.log_auth_event(event_type text, user_email text DEFAULT NULL)
RETURNS void AS $$
BEGIN
  INSERT INTO public.auth_logs (event_type, user_email, created_at)
  VALUES (event_type, user_email, now());
EXCEPTION
  WHEN OTHERS THEN
    -- Fail silently to not block auth operations
    NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create auth logs table for security monitoring
CREATE TABLE IF NOT EXISTS public.auth_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on auth logs (only admins should see these)
ALTER TABLE public.auth_logs ENABLE ROW LEVEL SECURITY;

-- Policy to prevent regular users from accessing auth logs
CREATE POLICY "auth_logs_admin_only" ON public.auth_logs
  FOR ALL USING (false);
