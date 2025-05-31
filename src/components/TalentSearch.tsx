
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, User, MapPin, Briefcase, Mail, Phone } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const TalentSearch = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  // Mock candidate data
  const mockCandidates = [
    {
      id: 1,
      name: "Sarah Johnson",
      email: "sarah.johnson@email.com",
      phone: "+1 (555) 123-4567",
      location: "Hyderabad, India",
      title: "Full Stack Developer",
      experience: "5 years",
      skills: ["Python", "React", "AWS", "Django", "PostgreSQL"],
      summary: "Experienced full-stack developer with expertise in Python and React.",
      matchScore: 95
    },
    {
      id: 2,
      name: "Michael Chen",
      email: "michael.chen@email.com",
      phone: "+1 (555) 987-6543",
      location: "Bangalore, India",
      title: "Cloud Solutions Architect",
      experience: "7 years",
      skills: ["AWS", "Azure", "Python", "Kubernetes", "Terraform"],
      summary: "Senior cloud architect with extensive experience in AWS and Azure.",
      matchScore: 88
    },
    {
      id: 3,
      name: "Priya Sharma",
      email: "priya.sharma@email.com",
      phone: "+91 98765 43210",
      location: "Hyderabad, India",
      title: "DevOps Engineer",
      experience: "4 years",
      skills: ["Docker", "Kubernetes", "Python", "Jenkins", "AWS"],
      summary: "DevOps specialist focused on automation and cloud infrastructure.",
      matchScore: 82
    }
  ];

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Please enter a search query",
        description: "Describe the type of candidate you're looking for.",
        variant: "destructive"
      });
      return;
    }

    setIsSearching(true);

    // Mock search delay
    setTimeout(() => {
      // Filter mock candidates based on query
      const filtered = mockCandidates.filter(candidate => 
        searchQuery.toLowerCase().includes('python') && candidate.skills.includes('Python') ||
        searchQuery.toLowerCase().includes('hyderabad') && candidate.location.includes('Hyderabad') ||
        searchQuery.toLowerCase().includes('full stack') && candidate.title.includes('Full Stack') ||
        searchQuery.toLowerCase().includes('cloud') && candidate.title.includes('Cloud')
      );

      setSearchResults(filtered.length > 0 ? filtered : mockCandidates.slice(0, 2));
      setIsSearching(false);

      toast({
        title: "Search completed",
        description: `Found ${filtered.length > 0 ? filtered.length : 2} matching candidates.`,
      });
    }, 1500);
  };

  const generateQuestions = (candidate: any) => {
    toast({
      title: "Generating screening questions",
      description: `Creating AI-powered questions for ${candidate.name}...`,
    });
    
    // This will be replaced with actual Groq API integration
    setTimeout(() => {
      toast({
        title: "Questions generated",
        description: `5 screening questions created for ${candidate.name}.`,
      });
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="w-5 h-5" />
            <span>AI-Powered Talent Search</span>
          </CardTitle>
          <CardDescription>
            Use natural language to find candidates. Try queries like "Full stack developer in Hyderabad with Python experience" or "Cloud engineer with AWS certification".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex space-x-2">
            <Input
              placeholder="Describe your ideal candidate..."
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
                      <h4 className="text-xl font-semibold text-gray-800">{candidate.name}</h4>
                      <p className="text-blue-600 font-medium">{candidate.title}</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-green-100 text-green-800">
                    {candidate.matchScore}% Match
                  </Badge>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <span className="text-sm">{candidate.email}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Phone className="w-4 h-4" />
                    <span className="text-sm">{candidate.phone}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <MapPin className="w-4 h-4" />
                    <span className="text-sm">{candidate.location}</span>
                  </div>
                  <div className="flex items-center space-x-2 text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span className="text-sm">{candidate.experience} experience</span>
                  </div>
                </div>

                <p className="text-gray-700 mb-4">{candidate.summary}</p>

                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Skills:</p>
                  <div className="flex flex-wrap gap-2">
                    {candidate.skills.map((skill, index) => (
                      <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button 
                    onClick={() => generateQuestions(candidate)}
                    variant="outline"
                    size="sm"
                  >
                    Generate Questions
                  </Button>
                  <Button 
                    size="sm"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                  >
                    Contact Candidate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {searchResults.length === 0 && searchQuery && !isSearching && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">No candidates found</h3>
            <p className="text-gray-600">
              Try adjusting your search criteria or upload more resumes to expand your talent pool.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default TalentSearch;
