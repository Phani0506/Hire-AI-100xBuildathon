
-- 1. Drop all existing policies on resumes and parsed_resume_details
DROP POLICY IF EXISTS "Users can insert their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can view their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can update their own resumes" ON public.resumes;
DROP POLICY IF EXISTS "Users can delete their own resumes" ON public.resumes;

DROP POLICY IF EXISTS "Users can insert their own parsed resume details" ON public.parsed_resume_details;
DROP POLICY IF EXISTS "Users can view their own parsed resume details" ON public.parsed_resume_details;

DROP POLICY IF EXISTS "Users can manage their own resume files" ON storage.objects;

-- 2. Enable RLS on the tables (in case it is not enabled)
ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parsed_resume_details ENABLE ROW LEVEL SECURITY;

-- 3. Add only the intended RLS policies
CREATE POLICY "Users can insert their own resumes" ON public.resumes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own resumes" ON public.resumes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own resumes" ON public.resumes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own resumes" ON public.resumes
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own parsed resume details" ON public.parsed_resume_details
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own parsed resume details" ON public.parsed_resume_details
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own resume files"
ON storage.objects FOR ALL
USING (bucket_id = 'resumes' AND auth.uid() = (storage.foldername(name))[1]::uuid)
WITH CHECK (bucket_id = 'resumes' AND auth.uid() = (storage.foldername(name))[1]::uuid);
