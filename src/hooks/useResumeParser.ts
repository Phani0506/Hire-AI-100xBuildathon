
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export const useResumeParser = () => {
  const triggerParsing = async (resumeId: string) => {
    try {
      console.log('Triggering resume parsing for:', resumeId);
      
      // First, get the resume details to find the file path
      const { data: resumeData, error: fetchError } = await supabase
        .from('resumes')
        .select('supabase_storage_path')
        .eq('id', resumeId)
        .single();

      if (fetchError || !resumeData) {
        console.error('Error fetching resume data:', fetchError);
        toast({
          title: "Parsing failed",
          description: "Could not find resume file. Please try uploading again.",
          variant: "destructive"
        });
        return false;
      }

      console.log('Invoking parse-resume function with data:', {
        resumeId: resumeId,
        filePath: resumeData.supabase_storage_path
      });

      const { data, error } = await supabase.functions.invoke('parse-resume', {
        body: { 
          resumeId: resumeId,
          filePath: resumeData.supabase_storage_path
        }
      });

      if (error) {
        console.error('Resume parsing error:', error);
        toast({
          title: "Parsing failed",
          description: "Failed to parse resume with AI. Please try again.",
          variant: "destructive"
        });
        return false;
      }

      console.log('Resume parsing response:', data);
      
      if (data.success) {
        toast({
          title: "Resume parsed successfully",
          description: "Your resume has been processed and parsed.",
        });
        return true;
      } else {
        toast({
          title: "Parsing completed with warnings",
          description: "Resume was processed but some information may not have been extracted.",
        });
        return true;
      }
    } catch (error) {
      console.error('Resume parsing error:', error);
      toast({
        title: "Parsing failed",
        description: "Failed to parse resume with AI. Please try again.",
        variant: "destructive"
      });
      return false;
    }
  };

  return { triggerParsing };
};
