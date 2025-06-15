
"use client";
import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Resume {
  id: string;
  file_name: string;
  parsing_status: "pending" | "completed" | "failed";
  created_at: string;
}

const Dashboard = () => {
  const [user, setUser] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        fetchResumes(session.user.id);
      } else {
        router.push("/login");
      }
    };
    checkUser();
  }, [router]);

  // Fetch resumes utility
  const fetchResumes = async (userId: string) => {
    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) toast.error("Failed to fetch resumes.");
    else setResumes(data as Resume[]);
  };

  // Listen for realtime changes
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("realtime:resumes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "resumes",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Whenever a change is detected, refresh the list
          fetchResumes(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleFileUpload = async () => {
    if (!file || !user) return;

    setUploading(true);
    setUploadProgress(0);

    const fileName = file.name;
    const filePath = `public/${user.id}/${uuidv4()}-${fileName}`;

    try {
      const { data: resumeData, error: insertError } = await supabase
        .from("resumes")
        .insert({ user_id: user.id, file_name: fileName, file_path: filePath, parsing_status: "pending" })
        .select().single();

      if (insertError) throw insertError;
      
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(filePath, file, { upsert: false });

      if (uploadError) {
        await supabase.from("resumes").delete().eq("id", resumeData.id); // Clean up failed upload
        throw uploadError;
      }
      
      toast.success("Resume uploaded. Starting analysis...");

      const { error: invokeError } = await supabase.functions.invoke(
        "parse-resume",
        {
          body: {
            resumeId: resumeData.id,
            filePath: filePath,
          },
        }
      );
      
      if (invokeError) throw invokeError;
      
      toast.info("Analysis in progress. The page will update when complete.");

    } catch (error: any) {
      toast.error(`An error occurred: ${error.message}`);
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  if (!user) return <div>Loading...</div>;

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Button variant="outline" onClick={() => supabase.auth.signOut()}>Logout</Button>
      </div>
      <p className="mb-6">Welcome, {user.email}</p>

      <div className="mb-8 p-6 border rounded-lg bg-card">
        <h2 className="text-xl font-semibold mb-4">Upload New Resume</h2>
        <div className="grid w-full max-w-sm items-center gap-1.5">
          <Label htmlFor="resume">Select a .pdf or .txt file</Label>
          <Input id="resume" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} accept=".pdf,.txt" />
        </div>
        <Button onClick={handleFileUpload} disabled={!file || uploading} className="mt-4">
          {uploading ? "Uploading..." : "Upload and Analyze"}
        </Button>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Your Resumes</h2>
        <div className="space-y-4">
          {resumes.length === 0 && <p>You have not uploaded any resumes yet.</p>}
          {resumes.map((resume) => (
            <div key={resume.id} className="p-4 border rounded-lg flex justify-between items-center">
              <div>
                <p className="font-medium">{resume.file_name}</p>
                <p className="text-sm text-gray-500">Status: <span className={`font-semibold ${resume.parsing_status === 'completed' ? 'text-green-600' : resume.parsing_status === 'failed' ? 'text-red-600' : 'text-yellow-600'}`}>{resume.parsing_status}</span></p>
              </div>
              {resume.parsing_status === 'completed' && (
                <Link href={`/resume/${resume.id}`}><Button variant="outline">View Details <ArrowRight className="ml-2 h-4 w-4" /></Button></Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

