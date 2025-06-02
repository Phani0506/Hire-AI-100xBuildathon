
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, User, MapPin, Briefcase, Mail, Phone } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ParsedCandidate {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills_json: string[];
  experience_json: any[];
  education_json: any[];
  resume_file_name: string;
}

// Mock data for demonstration
const mockCandidates: ParsedCandidate[] = [
  {
    id: "mock-1",
    full_name: "John Doe",
    email: "john.doe@example.com",
    phone: "+1 234 567 8900",
    location: "San Francisco, CA",
    skills_json: ["React", "TypeScript", "Node.js", "Python", "AWS"],
    experience_json: [
      {
        company: "Tech Corp",
        position: "Senior Software Engineer",
        duration: "2020-2023",
        description: "Led development of web applications"
      },
      {
        company: "StartupXYZ",
        position: "Full Stack Developer",
        duration: "2018-2020",
        description: "Built scalable web solutions"
      }
    ],
    education_json: [
      {
        degree: "Master of Science",
        institution: "Stanford University",
        field: "Computer Science",
        year: "2016-2018",
        grade: "3.8 GPA"
      }
    ],
    resume_file_name: "john_doe_resume.pdf"
  },
  {
    id: "mock-2",
    full_name: "Sarah Johnson",
    email: "sarah.johnson@example.com",
    phone: "+1 987 654 3210",
    location: "New York, NY",
    skills_json: ["Product Management", "Agile", "Scrum", "Analytics", "Leadership"],
    experience_json: [
      {
        company: "Global Inc",
        position: "Senior Product Manager",
        duration: "2019-2023",
        description: "Managed product roadmap for 5M+ users"
      }
    ],
    education_json: [
      {
        degree: "MBA",
        institution: "Harvard Business School",
        field: "Business Administration",
        year: "2015-2017",
        grade: "Magna Cum Laude"
      }
    ],
    resume_file_name: "sarah_johnson_resume.pdf"
  },
  {
    id: "mock-3",
    full_name: "Michael Chen",
    email: "michael.chen@example.com",
    phone: "+1 555 123 4567",
    location: "Seattle, WA",
    skills_json: ["Data Science", "Machine Learning", "Python", "SQL", "TensorFlow"],
    experience_json: [
      {
        company: "Data Analytics Co",
        position: "Data Scientist",
        duration: "2021-2023",
        description: "Built ML models for customer analytics"
      }
    ],
    education_json: [
      {
        degree: "PhD",
        institution: "MIT",
        field: "Data Science",
        year: "2017-2021",
        grade: "4.0 GPA"
      }
    ],
    resume_file_name: "michael_chen_resume.pdf"
  }
];

const TalentSearch = () => {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ParsedCandidate[]>([]);
  const [allCandidates, setAllCandidates] = useState<ParsedCandidate[]>([]);

  useEffect(() => {
    if (user) {
      fetchAllCandidates();
    }
  }, [user]);

  const fetchAllCandidates = async () => {
    if (!user) return;

    try {
      console.log('Fetching parsed candidates for user:', user.id);
      
      const { data, error } = await supabase
        .from('parsed_resume_details')
        .select(`
          id,
          full_name,
          email,
          phone,
          location,
          skills_json,
          experience_json,
          education_json,
          resumes!inner(file_name)
        `)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching candidates:', error);
        return;
      }

      const candidates = data?.map(candidate => ({
        id: candidate.id,
        full_name: candidate.full_name,
        email: candidate.email,
        phone: candidate.phone,
        location: candidate.location,
        skills_json: Array.isArray(candidate.skills_json) ? 
          candidate.skills_json.map(skill => String(skill)) : [],
        experience_json: Array.isArray(candidate.experience_json) ? candidate.experience_json : [],
        education_json: Array.isArray(candidate.education_json) ? candidate.education_json : [],
        resume_file_name: (candidate as any).resumes?.file_name || 'Resume'
      })) || [];

      console.log('Fetched candidates:', candidates);
      
      // Combine real candidates with mock data
      const combinedCandidates = [...candidates, ...mockCandidates];
      setAllCandidates(combinedCandidates);
      setSearchResults(combinedCandidates); // Show all candidates initially
    } catch (error) {
      console.error('Error in fetchAllCandidates:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(allCandidates);
      toast({
        title: "Showing all candidates",
        description: `Displaying ${allCandidates.length} candidates from your talent pool.`,
      });
      return;
    }

    setIsSearching(true);

    // Mock search delay for better UX
    setTimeout(() => {
      const query = searchQuery.toLowerCase();
      
      const filtered = allCandidates.filter(candidate => {
        // Search in name
        if (candidate.full_name && candidate.full_name.toLowerCase().includes(query)) {
          return true;
        }
        
        // Search in location
        if (candidate.location && candidate.location.toLowerCase().includes(query)) {
          return true;
        }
        
        // Search in skills
        if (candidate.skills_json && candidate.skills_json.some(skill => 
          skill.toLowerCase().includes(query)
        )) {
          return true;
        }
        
        // Search in experience
        if (candidate.experience_json && candidate.experience_json.some(exp => 
          (exp.company && exp.company.toLowerCase().includes(query)) ||
          (exp.position && exp.position.toLowerCase().includes(query))
        )) {
          return true;
        }
        
        // Search in education
        if (candidate.education_json && candidate.education_json.some(edu => 
          (edu.degree && edu.degree.toLowerCase().includes(query)) ||
          (edu.institution && edu.institution.toLowerCase().includes(query)) ||
          (edu.field && edu.field.toLowerCase().includes(query))
        )) {
          return true;
        }
        
        return false;
      });

      setSearchResults(filtered);
      setIsSearching(false);

      toast({
        title: "Search completed",
        description: `Found ${filtered.length} matching candidates.`,
      });
    }, 1000);
  };

  const handleOutreach = (candidate: ParsedCandidate) => {
    if (!candidate.email) {
      toast({
        title: "No email found",
        description: "This candidate doesn't have an email address in their resume.",
        variant: "destructive"
      });
      return;
    }

    const subject = encodeURIComponent(`Opportunity Discussion - ${candidate.full_name || 'Candidate'}`);
    const body = encodeURIComponent(`Hi ${candidate.full_name || 'there'},

I came across your profile and was impressed by your background in ${candidate.skills_json?.slice(0, 3).join(', ') || 'your field'}.

I would love to discuss some exciting opportunities that might be a great fit for your experience.

Would you be available for a brief conversation this week?

Best regards,
[Your Name]`);

    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${candidate.email}&su=${subject}&body=${body}`;
    window.open(gmailUrl, '_blank');

    toast({
      title: "Opening Gmail",
      description: `Composing email to ${candidate.full_name || 'candidate'}`,
    });
  };

  const generateQuestions = (candidate: ParsedCandidate) => {
    toast({
      title: "Generating screening questions",
      description: `Creating AI-powered questions for ${candidate.full_name || 'candidate'}...`,
    });
    
    // This will be replaced with actual AI question generation
    setTimeout(() => {
      toast({
        title: "Questions generated",
        description: `5 screening questions created for ${candidate.full_name || 'candidate'}.`,
      });
    }, 2000);
  };

  const calculateExperience = (experience_json: any[]) => {
    if (!experience_json || experience_json.length === 0) return "Entry level";
    return `${experience_json.length * 2}+ years`;
  };

  const getDisplayName = (candidate: ParsedCandidate) => {
    return candidate.full_name || `Candidate from ${candidate.resume_file_name}`;
  };

  const getDisplayTitle = (candidate: ParsedCandidate) => {
    if (candidate.experience_json && candidate.experience_json.length > 0) {
      return candidate.experience_json[0].position || "Professional";
    }
    if (candidate.education_json && candidate.education_json.length > 0) {
      return `${candidate.education_json[0].degree || 'Graduate'} - ${candidate.education_json[0].field || 'Various Fields'}`;
    }
    return "Professional";
  };

  if (!user) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <p className="text-gray-600">Please log in to search for talent.</p>
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
            <Search className="w-5 h-5" />
            <span>AI-Powered Talent Search</span>
          </CardTitle>
          <CardDescription>
            Search through your parsed resumes and demo candidates. Try queries like "Python developer", "San Francisco", "Machine Learning", or "5 years experience".
            {allCandidates.length > 0 && (
              <span className="block mt-2 text-sm font-medium text-blue-600">
                {allCandidates.length} candidates available in your talent pool
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2">
            <Input
              placeholder="Search for candidates by skills, location, experience..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button 
              onClick={handleSearch}
              disabled={isSearching}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
            >
              {isSearching ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              {isSearching ? "Searching..." : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {searchResults.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-800">
            Search Results ({searchResults.length} candidates)
          </h3>
          
          {searchResults.map((candidate) => (
            <Card key={candidate.id} className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                      <User className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h4 className="text-xl font-semibold text-gray-800">{getDisplayName(candidate)}</h4>
                      <p className="text-blue-600 font-medium">{getDisplayTitle(candidate)}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className={candidate.id.startsWith('mock-') ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}>
                    {candidate.id.startsWith('mock-') ? 'Demo Candidate' : 'Parsed Resume'}
                  </Badge>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  {candidate.email && (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">{candidate.email}</span>
                    </div>
                  )}
                  {candidate.phone && (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <Phone className="w-4 h-4" />
                      <span className="text-sm">{candidate.phone}</span>
                    </div>
                  )}
                  {candidate.location && (
                    <div className="flex items-center space-x-2 text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm">{candidate.location}</span>
                    </div>
                  )}
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span className="text-sm">{calculateExperience(candidate.experience_json)} experience</span>
                  </div>
                </div>

                {candidate.experience_json && candidate.experience_json.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Latest Experience:</p>
                    <p className="text-gray-700 text-sm">
                      {candidate.experience_json[0].position} at {candidate.experience_json[0].company}
                      {candidate.experience_json[0].duration && ` (${candidate.experience_json[0].duration})`}
                    </p>
                  </div>
                )}

                {candidate.skills_json && candidate.skills_json.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Skills:</p>
                    <div className="flex flex-wrap gap-2">
                      {candidate.skills_json.slice(0, 10).map((skill, index) => (
                        <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          {skill}
                        </Badge>
                      ))}
                      {candidate.skills_json.length > 10 && (
                        <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                          +{candidate.skills_json.length - 10} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex space-x-2">
                  <Button 
                    onClick={() => generateQuestions(candidate)}
                    variant="outline"
                    size="sm"
                  >
                    Generate Questions
                  </Button>
                  <Button 
                    onClick={() => handleOutreach(candidate)}
                    size="sm"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    disabled={!candidate.email}
                  >
                    Outreach via Gmail
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {searchResults.length === 0 && !isSearching && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">No candidates found</h3>
            <p className="text-gray-600">
              Try adjusting your search criteria or upload more resumes to build your talent pool.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TalentSearch;
