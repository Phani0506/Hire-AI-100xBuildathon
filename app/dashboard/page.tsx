
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import ResumeUpload from "@/components/ResumeUpload";
import { toast } from "@/hooks/use-toast";

type Resume = {
  id: string;
  file_name: string;
  supabase_storage_path: string;
  parsing_status: string;
};

export default function DashboardPage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchResumes() {
    setLoading(true);
    const { data, error } = await supabase
      .from("resumes")
      .select("id, file_name, supabase_storage_path, parsing_status")
      .order("created_at", { ascending: false });
    if (error) {
      toast({
        title: "Error",
        description: "Unable to fetch resumes",
        variant: "destructive",
      });
      setResumes([]);
    } else {
      setResumes(data);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchResumes();
  }, []);

  const handleParseResume = async (resume: Resume) => {
    try {
      const { data, error } = await supabase.functions.invoke("parse-resume", {
        body: {
          resumeId: resume.id,
          filePath: resume.supabase_storage_path,
        },
      });
      if (error) {
        toast({
          title: "Parsing Error",
          description: "Failed to parse this resume.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Parsing Complete",
          description: `Resume "${resume.file_name}" parsed successfully.`,
        });
        fetchResumes();
      }
    } catch (err) {
      toast({
        title: "Parsing Failed",
        description: "There was an error parsing the resume.",
        variant: "destructive",
      });
    }
  };

  return (
    <main className="max-w-3xl mx-auto p-4 space-y-8">
      <h1 className="text-3xl font-bold text-center mb-4">Dashboard</h1>
      <ResumeUpload />
      <section>
        <h2 className="text-xl font-semibold mb-2">Your Resumes</h2>
        {loading ? (
          <p>Loading...</p>
        ) : resumes.length === 0 ? (
          <p className="text-gray-400">No resumes uploaded yet.</p>
        ) : (
          <ul className="divide-y">
            {resumes.map((r) => (
              <li key={r.id} className="py-4 flex items-center justify-between">
                <div>
                  <strong>{r.file_name}</strong>
                  <span className="ml-2 text-xs text-gray-500">{r.parsing_status}</span>
                </div>
                <Button onClick={() => handleParseResume(r)} size="sm">
                  Parse Resume with AI
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
