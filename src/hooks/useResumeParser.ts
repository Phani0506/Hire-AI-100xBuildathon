
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export const useResumeParser = () => {
  const triggerParsing = async (resumeId: string) => {
    try {
      console.log('Triggering resume parsing for:', resumeId);
      
      const { data, error } = await supabase.functions.invoke('parse-resume', {
        body: { resumeId }
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
      return true;
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
