
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FileText, User, MapPin, Briefcase, Mail, Search, Eye } from "lucide-react";

const ResumeList = () => {
  const [searchTerm, setSearchTerm] = useState("");

  // Mock resume data - will be replaced with Supabase data
  const resumes = [
    {
      id: 1,
      fileName: "sarah_johnson_resume.pdf",
      candidateName: "Sarah Johnson",
      email: "sarah.johnson@email.com",
      location: "Hyderabad, India",
      title: "Full Stack Developer",
      experience: "5 years",
      skills: ["Python", "React", "AWS", "Django"],
      uploadedAt: "2024-01-15",
      status: "parsed"
    },
    {
      id: 2,
      fileName: "michael_chen_cv.docx",
      candidateName: "Michael Chen",
      email: "michael.chen@email.com",
      location: "Bangalore, India",
      title: "Cloud Solutions Architect",
      experience: "7 years",
      skills: ["AWS", "Azure", "Python", "Kubernetes"],
      uploadedAt: "2024-01-14",
      status: "parsed"
    },
    {
      id: 3,
      fileName: "priya_sharma_resume.pdf",
      candidateName: "Priya Sharma",
      email: "priya.sharma@email.com",
      location: "Hyderabad, India",
      title: "DevOps Engineer",
      experience: "4 years",
      skills: ["Docker", "Kubernetes", "Python", "Jenkins"],
      uploadedAt: "2024-01-13",
      status: "parsed"
    },
    {
      id: 4,
      fileName: "john_doe_cv.pdf",
      candidateName: "John Doe",
      email: "john.doe@email.com",
      location: "Mumbai, India",
      title: "Frontend Developer",
      experience: "3 years",
      skills: ["JavaScript", "React", "Vue.js", "CSS"],
      uploadedAt: "2024-01-12",
      status: "processing"
    }
  ];

  const filteredResumes = resumes.filter(resume =>
    resume.candidateName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    resume.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    resume.skills.some(skill => skill.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <FileText className="w-5 h-5" />
            <span>Resume Library</span>
          </CardTitle>
          <CardDescription>
            Browse and manage all uploaded resumes in your talent pool.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name, title, or skills..."
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
                    <h4 className="text-xl font-semibold text-gray-800">{resume.candidateName}</h4>
                    <p className="text-blue-600 font-medium">{resume.title}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge 
                    variant={resume.status === 'parsed' ? 'default' : 'secondary'}
                    className={resume.status === 'parsed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}
                  >
                    {resume.status === 'parsed' ? 'Parsed' : 'Processing'}
                  </Badge>
                  <Button variant="outline" size="sm">
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </Button>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div className="flex items-center space-x-2 text-gray-600">
                  <Mail className="w-4 h-4" />
                  <span className="text-sm">{resume.email}</span>
                </div>
                <div className="flex items-center space-x-2 text-gray-600">
                  <MapPin className="w-4 h-4" />
                  <span className="text-sm">{resume.location}</span>
                </div>
                <div className="flex items-center space-x-2 text-gray-600">
                  <Briefcase className="w-4 h-4" />
                  <span className="text-sm">{resume.experience} experience</span>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Skills:</p>
                <div className="flex flex-wrap gap-2">
                  {resume.skills.map((skill, index) => (
                    <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <FileText className="w-4 h-4" />
                  <span>{resume.fileName}</span>
                </div>
                <span>Uploaded {formatDate(resume.uploadedAt)}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredResumes.length === 0 && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">No resumes found</h3>
            <p className="text-gray-600">
              {searchTerm ? "Try adjusting your search criteria." : "Upload some resumes to get started."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ResumeList;
