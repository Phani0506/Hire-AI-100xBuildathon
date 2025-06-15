import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, User, MapPin, Briefcase, Mail, Phone, CornerDownRight } from "lucide-react";
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
  relevanceScore?: number;
}

interface ScreeningQuestionsState {
  loading: boolean;
  questions: string[] | null;
  error: string | null;
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
  const [hasSearched, setHasSearched] = useState(false);
  const [screeningQuestions, setScreeningQuestions] = useState<Record<string, ScreeningQuestionsState>>({});

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
    } catch (error) {
      console.error('Error in fetchAllCandidates:', error);
    }
  };

  // Enhanced ranking algorithm
  const calculateRelevanceScore = (candidate: ParsedCandidate, query: string): number => {
    if (!query.trim()) return 0;
    
    const queryTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
    let score = 0;
    
    // Name match (high weight)
    if (candidate.full_name) {
      queryTerms.forEach(term => {
        if (candidate.full_name!.toLowerCase().includes(term)) {
          score += 20;
        }
      });
    }
    
    // Skills match (very high weight)
    if (candidate.skills_json && candidate.skills_json.length > 0) {
      queryTerms.forEach(term => {
        candidate.skills_json.forEach(skill => {
          if (skill.toLowerCase().includes(term)) {
            score += 15;
          }
        });
      });
    }
    
    // Experience match (high weight)
    if (candidate.experience_json && candidate.experience_json.length > 0) {
      queryTerms.forEach(term => {
        candidate.experience_json.forEach(exp => {
          if (exp.company && exp.company.toLowerCase().includes(term)) score += 10;
          if (exp.position && exp.position.toLowerCase().includes(term)) score += 12;
          if (exp.description && exp.description.toLowerCase().includes(term)) score += 5;
        });
      });
      
      // Bonus for more experience
      score += candidate.experience_json.length * 2;
    }
    
    // Education match (medium weight)
    if (candidate.education_json && candidate.education_json.length > 0) {
      queryTerms.forEach(term => {
        candidate.education_json.forEach(edu => {
          if (edu.degree && edu.degree.toLowerCase().includes(term)) score += 8;
          if (edu.institution && edu.institution.toLowerCase().includes(term)) score += 6;
          if (edu.field && edu.field.toLowerCase().includes(term)) score += 7;
        });
      });
    }
    
    // Location match (medium weight)
    if (candidate.location) {
      queryTerms.forEach(term => {
        if (candidate.location!.toLowerCase().includes(term)) {
          score += 8;
        }
      });
    }
    
    return score;
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Please enter search criteria",
        description: "Enter skills, location, or other criteria to search for candidates.",
        variant: "destructive"
      });
      return;
    }

    setIsSearching(true);
    setHasSearched(true);

    // Simulate search delay for better UX
    setTimeout(() => {
      // Calculate relevance scores for all candidates, filter, and sort.
      const rankedResults = allCandidates
        .map(candidate => ({
          ...candidate,
          relevanceScore: calculateRelevanceScore(candidate, searchQuery),
        }))
        .filter(candidate => (candidate.relevanceScore || 0) > 0)
        .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

      setSearchResults(rankedResults);
      setIsSearching(false);

      toast({
        title: "Search completed",
        description: `Found ${rankedResults.length} matching candidates, ranked by relevance.`,
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

  const generateQuestions = async (candidate: ParsedCandidate) => {
    const candidateId = candidate.id;

    // Toggle: if questions are already there or loading, hide/cancel them.
    if (screeningQuestions[candidateId]) {
      setScreeningQuestions(prev => {
        const newState = { ...prev };
        delete newState[candidateId];
        return newState;
      });
      return;
    }

    setScreeningQuestions(prev => ({
      ...prev,
      [candidateId]: { loading: true, questions: null, error: null }
    }));

    toast({
      title: "Generating screening questions...",
      description: `Creating AI-powered questions for ${getDisplayName(candidate)}.`,
    });

    try {
      const { data, error } = await supabase.functions.invoke('generate-screening-questions', {
        body: {
          skills: candidate.skills_json?.slice(0, 10), // Send top 10 skills
          title: getDisplayTitle(candidate),
        }
      });

      if (error) throw error;
      
      if (data.error) throw new Error(data.error);

      if (!data.questions || data.questions.length === 0) {
        throw new Error("AI did not return any questions. Please try again.");
      }

      setScreeningQuestions(prev => ({
        ...prev,
        [candidateId]: { loading: false, questions: data.questions, error: null }
      }));

      toast({
        title: "Questions generated!",
        description: `Screening questions for ${getDisplayName(candidate)} are ready.`,
      });

    } catch (error: any) {
      console.error('Error generating questions:', error);
      const errorMessage = error.message || "An unknown error occurred.";
      setScreeningQuestions(prev => ({
        ...prev,
        [candidateId]: { loading: false, questions: null, error: errorMessage }
      }));
      toast({
        title: "Failed to generate questions",
        description: errorMessage,
        variant: "destructive"
      });
    }
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

  const getRelevanceLabel = (score: number): string => {
    if (score >= 30) return "Excellent Match";
    if (score >= 20) return "Very Good Match";
    if (score >= 10) return "Good Match";
    if (score >= 5) return "Fair Match";
    return "Possible Match";
  };

  const getRelevanceColor = (score: number): string => {
    if (score >= 30) return "bg-green-100 text-green-800";
    if (score >= 20) return "bg-blue-100 text-blue-800";
    if (score >= 10) return "bg-purple-100 text-purple-800";
    if (score >= 5) return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-800";
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
            Search through your parsed resumes using AI-powered ranking. Try queries like "Python developer", "San Francisco", "Machine Learning", or "5 years experience".
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

      {hasSearched && searchResults.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-800">
            Search Results ({searchResults.length} candidates) - Ranked by Relevance
          </h3>
          
          {searchResults.map((candidate, index) => (
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
                  <div className="flex items-center space-x-2">
                    <Badge 
                      className={`${getRelevanceColor(candidate.relevanceScore || 0)}`}
                    >
                      #{index + 1} - {getRelevanceLabel(candidate.relevanceScore || 0)}
                    </Badge>
                    <Badge variant="secondary" className={candidate.id.startsWith('mock-') ? "bg-orange-100 text-orange-800" : "bg-green-100 text-green-800"}>
                      {candidate.id.startsWith('mock-') ? 'Demo Candidate' : 'Parsed Resume'}
                    </Badge>
                  </div>
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
                    disabled={screeningQuestions[candidate.id]?.loading}
                  >
                    {screeningQuestions[candidate.id]?.loading ? (
                      <>
                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                        Generating...
                      </>
                    ) : screeningQuestions[candidate.id]?.questions ? (
                      "Hide Questions"
                    ) : (
                      "Generate Questions"
                    )}
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

                {screeningQuestions[candidate.id] && (
                  <div className="mt-4 p-4 bg-blue-50/50 rounded-lg border border-blue-100 transition-all duration-300">
                    {screeningQuestions[candidate.id].loading && (
                      <div className="flex items-center space-x-2 text-blue-800 animate-pulse">
                         <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                         <span>Generating AI questions based on resume...</span>
                      </div>
                    )}
                    {screeningQuestions[candidate.id].error && (
                      <p className="text-sm text-red-600">
                        <strong>Error:</strong> {screeningQuestions[candidate.id].error}
                      </p>
                    )}
                    {screeningQuestions[candidate.id].questions && (
                      <div>
                        <h5 className="font-semibold text-gray-800 mb-2">Suggested Screening Questions:</h5>
                        <ul className="space-y-2">
                          {screeningQuestions[candidate.id].questions?.map((q, i) => (
                            <li key={i} className="flex items-start text-sm text-gray-700">
                              <CornerDownRight className="w-4 h-4 mt-0.5 mr-2 shrink-0 text-blue-600" />
                              <span>{q}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {hasSearched && searchResults.length === 0 && !isSearching && (
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

      {!hasSearched && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">Ready to search</h3>
            <p className="text-gray-600">
              Enter your search criteria above to find candidates from your talent pool with AI-powered relevance ranking.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TalentSearch;
