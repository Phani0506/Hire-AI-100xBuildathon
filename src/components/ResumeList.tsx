
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FileText, User, MapPin, Briefcase, Mail, Search, Eye, Trash2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface ResumeWithDetails {
  id: string;
  file_name: string;
  file_size: number | null;
  uploaded_at: string;
  parsing_status: string | null;
  parsed_details?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    location: string | null;
    skills_json: any;
    experience_json: any;
  };
}

const ResumeList = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [resumes, setResumes] = useState<ResumeWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchResumes();
    }
  }, [user]);

  const fetchResumes = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log('Fetching resumes for user:', user.id);
      
      // Fetch resumes with their parsed details
      const { data: resumesData, error: resumesError } = await supabase
        .from('resumes')
        .select(`
          *,
          parsed_resume_details (
            full_name,
            email,
            phone,
            location,
            skills_json,
            experience_json
          )
        `)
        .eq('user_id', user.id)
        .order('uploaded_at', { ascending: false });

      if (resumesError) {
        console.error('Error fetching resumes:', resumesError);
        toast({
          title: "Error",
          description: "Failed to fetch resumes. Please try again.",
          variant: "destructive"
        });
        return;
      }

      console.log('Fetched resumes data:', resumesData);

      // Transform the data to match our interface
      const transformedResumes: ResumeWithDetails[] = resumesData?.map(resume => ({
        id: resume.id,
        file_name: resume.file_name,
        file_size: resume.file_size,
        uploaded_at: resume.uploaded_at,
        parsing_status: resume.parsing_status,
        parsed_details: resume.parsed_resume_details?.[0] || undefined
      })) || [];

      setResumes(transformedResumes);
      console.log('Transformed resumes:', transformedResumes);
    } catch (error) {
      console.error('Error in fetchResumes:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred while fetching resumes.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (resumeId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      // Delete parsed details first (due to foreign key constraint)
      const { error: parsedDetailsError } = await supabase
        .from('parsed_resume_details')
        .delete()
        .eq('resume_id', resumeId);

      if (parsedDetailsError) {
        console.error('Error deleting parsed details:', parsedDetailsError);
      }

      // Delete the resume record
      const { error: resumeError } = await supabase
        .from('resumes')
        .delete()
        .eq('id', resumeId);

      if (resumeError) {
        console.error('Error deleting resume:', resumeError);
        toast({
          title: "Error",
          description: "Failed to delete resume. Please try again.",
          variant: "destructive"
        });
        return;
      }

      // Remove from local state
      setResumes(resumes.filter(resume => resume.id !== resumeId));
      
      toast({
        title: "Resume deleted",
        description: `"${fileName}" has been deleted successfully.`,
      });
    } catch (error) {
      console.error('Error in handleDelete:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred while deleting the resume.",
        variant: "destructive"
      });
    }
  };

  const handleOutreach = (resume: ResumeWithDetails) => {
    const email = resume.parsed_details?.email;
    const candidateName = resume.parsed_details?.full_name;

    if (!email) {
      toast({
        title: "No email found",
        description: "This candidate doesn't have an email address in their resume.",
        variant: "destructive"
      });
      return;
    }

    const subject = encodeURIComponent(`Opportunity Discussion - ${candidateName || 'Candidate'}`);
    const body = encodeURIComponent(`Hi ${candidateName || 'there'},

I came across your profile and was impressed by your background.

I would love to discuss some exciting opportunities that might be a great fit for your experience.

Would you be available for a brief conversation this week?

Best regards,
[Your Name]`);

    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${email}&su=${subject}&body=${body}`;
    window.open(gmailUrl, '_blank');

    toast({
      title: "Opening Gmail",
      description: `Composing email to ${candidateName || 'candidate'}`,
    });
  };

  const filteredResumes = resumes.filter(resume => {
    const searchLower = searchTerm.toLowerCase();
    const candidateName = resume.parsed_details?.full_name?.toLowerCase() || '';
    const fileName = resume.file_name.toLowerCase();
    const email = resume.parsed_details?.email?.toLowerCase() || '';
    const skills = resume.parsed_details?.skills_json ? 
      (Array.isArray(resume.parsed_details.skills_json) ? 
        resume.parsed_details.skills_json.join(' ').toLowerCase() : 
        String(resume.parsed_details.skills_json).toLowerCase()) : '';
    
    return candidateName.includes(searchLower) || 
           fileName.includes(searchLower) || 
           email.includes(searchLower) ||
           skills.includes(searchLower);
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getSkillsArray = (skillsJson: any): string[] => {
    if (!skillsJson) return [];
    if (Array.isArray(skillsJson)) return skillsJson;
    if (typeof skillsJson === 'string') {
      try {
        const parsed = JSON.parse(skillsJson);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [skillsJson];
      }
    }
    return [];
  };

  const getExperienceYears = (experienceJson: any): string => {
    if (!experienceJson) return 'Not specified';
    
    if (typeof experienceJson === 'object') {
      // Try to extract years from experience object
      if (experienceJson.total_years) return `${experienceJson.total_years} years`;
      if (experienceJson.years) return `${experienceJson.years} years`;
      if (Array.isArray(experienceJson) && experienceJson.length > 0) {
        return `${experienceJson.length} positions`;
      }
    }
    
    return 'Experience available';
  };

  if (!user) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <p className="text-gray-600">Please log in to view your resumes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Loading your resumes...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>Resume Library ({resumes.length})</span>
          </CardTitle>
          <CardDescription>
            Browse and manage all uploaded resumes in your talent pool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name, filename, email, or skills..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {filteredResumes.map((resume) => (
          <Card key={resume.id} className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300">
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xl font-semibold text-gray-800">
                      {resume.parsed_details?.full_name || 'Name not parsed yet'}
                    </h4>
                    <p className="text-blue-600 font-medium text-sm">{resume.file_name}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant={resume.parsing_status === 'completed' ? 'default' : 'secondary'}
                    className={
                      resume.parsing_status === 'completed' 
                        ? 'bg-green-100 text-green-800' 
                        : resume.parsing_status === 'processing'
                        ? 'bg-yellow-100 text-yellow-800'
                        : resume.parsing_status === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }
                  >
                    {resume.parsing_status === 'completed' ? 'Parsed' : 
                     resume.parsing_status === 'processing' ? 'Processing' :
                     resume.parsing_status === 'failed' ? 'Failed' : 'Pending'}
                  </Badge>
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </Button>
                </div>
              </div>

              {resume.parsed_details && (
                <div className="grid md:grid-cols-3 gap-4 mb-4">
                  {resume.parsed_details.email && (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">{resume.parsed_details.email}</span>
                    </div>
                  )}
                  {resume.parsed_details.location && (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm">{resume.parsed_details.location}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span className="text-sm">{getExperienceYears(resume.parsed_details.experience_json)}</span>
                  </div>
                </div>
              )}

              {resume.parsed_details?.skills_json && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Skills:</p>
                  <div className="flex flex-wrap gap-2">
                    {getSkillsArray(resume.parsed_details.skills_json).slice(0, 8).map((skill, index) => (
                      <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {skill}
                      </Badge>
                    ))}
                    {getSkillsArray(resume.parsed_details.skills_json).length > 8 && (
                      <Badge variant="outline" className="bg-gray-50 text-gray-600">
                        +{getSkillsArray(resume.parsed_details.skills_json).length - 8} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center">
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <FileText className="w-4 h-4" />
                  <span>{resume.file_name}</span>
                  <span>({formatFileSize(resume.file_size)})</span>
                  <span>• Uploaded {formatDate(resume.uploaded_at)}</span>
                </div>
                
                <div className="flex space-x-2">
                  <Button 
                    onClick={() => handleOutreach(resume)}
                    size="sm"
                    variant="outline"
                    disabled={!resume.parsed_details?.email}
                    className="text-blue-600 border-blue-200 hover:bg-blue-50"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Outreach
                  </Button>
                  <Button 
                    onClick={() => handleDelete(resume.id, resume.file_name)}
                    size="sm"
                    variant="outline"
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredResumes.length === 0 && !loading && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">
              {resumes.length === 0 ? "No resumes uploaded yet" : "No resumes found"}
            </h3>
            <p className="text-gray-600">
              {resumes.length === 0 
                ? "Upload some resumes to get started with building your talent pool."
                : "Try adjusting your search criteria or upload more resumes."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ResumeList;
