
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, PieChart, Users, FileText, MapPin, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ParsedResume {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  skills_json: any;
  experience_json: any;
  education_json: any;
}

const AnalyticsDashboard = () => {
  const { user } = useAuth();
  const [parsedResumes, setParsedResumes] = useState<ParsedResume[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchParsedResumes();
    }
  }, [user]);

  const fetchParsedResumes = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('parsed_resume_details')
        .select('*')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching parsed resumes:', error);
        return;
      }

      setParsedResumes(data || []);
    } catch (error) {
      console.error('Error in fetchParsedResumes:', error);
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats from real data
  const stats = {
    totalResumes: parsedResumes.length,
    totalCandidates: parsedResumes.length,
    avgExperience: calculateAverageExperience(),
    topLocation: getTopLocation()
  };

  function calculateAverageExperience() {
    if (parsedResumes.length === 0) return 0;
    
    const experiences = parsedResumes.map(resume => {
      if (!resume.experience_json) return 0;
      
      if (Array.isArray(resume.experience_json)) {
        return resume.experience_json.length * 2; // Estimate 2 years per job
      }
      
      return 0;
    });
    
    const total = experiences.reduce((sum, exp) => sum + exp, 0);
    return Math.round((total / experiences.length) * 10) / 10;
  }

  function getTopLocation() {
    if (parsedResumes.length === 0) return "No data";
    
    const locationCounts: { [key: string]: number } = {};
    
    parsedResumes.forEach(resume => {
      if (resume.location) {
        const location = resume.location.toLowerCase().trim();
        locationCounts[location] = (locationCounts[location] || 0) + 1;
      }
    });
    
    const topLocation = Object.entries(locationCounts)
      .sort(([,a], [,b]) => b - a)[0];
    
    return topLocation ? topLocation[0] : "No data";
  }

  // Extract skills data from real resumes
  const getSkillsData = () => {
    const skillCounts: { [key: string]: number } = {};
    
    parsedResumes.forEach(resume => {
      if (resume.skills_json && Array.isArray(resume.skills_json)) {
        resume.skills_json.forEach(skill => {
          if (typeof skill === 'string') {
            const skillName = skill.toLowerCase().trim();
            skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
          }
        });
      }
    });
    
    return Object.entries(skillCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([skill, count], index) => ({
        name: skill.charAt(0).toUpperCase() + skill.slice(1),
        count,
        color: ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-teal-500'][index]
      }));
  };

  // Calculate experience distribution
  const getExperienceData = () => {
    const experienceRanges = {
      '0-2 years': 0,
      '3-5 years': 0,
      '6-8 years': 0,
      '9+ years': 0
    };
    
    parsedResumes.forEach(resume => {
      if (resume.experience_json && Array.isArray(resume.experience_json)) {
        const jobCount = resume.experience_json.length;
        const estimatedYears = jobCount * 2; // Estimate 2 years per job
        
        if (estimatedYears <= 2) {
          experienceRanges['0-2 years']++;
        } else if (estimatedYears <= 5) {
          experienceRanges['3-5 years']++;
        } else if (estimatedYears <= 8) {
          experienceRanges['6-8 years']++;
        } else {
          experienceRanges['9+ years']++;
        }
      }
    });
    
    return Object.entries(experienceRanges).map(([range, count], index) => ({
      range,
      count,
      color: ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500'][index]
    }));
  };

  // Get location distribution
  const getLocationData = () => {
    const locationCounts: { [key: string]: number } = {};
    
    parsedResumes.forEach(resume => {
      if (resume.location) {
        const location = resume.location.trim();
        locationCounts[location] = (locationCounts[location] || 0) + 1;
      }
    });
    
    return Object.entries(locationCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 4)
      .map(([city, count]) => ({ city, count }));
  };

  const skillsData = getSkillsData();
  const experienceData = getExperienceData();
  const locationData = getLocationData();

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Loading analytics...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (parsedResumes.length === 0) {
    return (
      <div className="space-y-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-8 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-800 mb-2">No parsed resumes yet</h3>
            <p className="text-gray-600">Upload and parse some resumes to see analytics data.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Resumes</p>
                <p className="text-3xl font-bold text-blue-600">{stats.totalResumes}</p>
              </div>
              <FileText className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Candidates</p>
                <p className="text-3xl font-bold text-green-600">{stats.totalCandidates}</p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Avg Experience</p>
                <p className="text-3xl font-bold text-purple-600">{stats.avgExperience} years</p>
              </div>
              <Briefcase className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Top Location</p>
                <p className="text-3xl font-bold text-orange-600">{stats.topLocation}</p>
              </div>
              <MapPin className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Skills Distribution */}
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <BarChart className="w-5 h-5" />
              <span>Top Skills Distribution</span>
            </CardTitle>
            <CardDescription>
              Most common skills across your talent pool
            </CardDescription>
          </CardHeader>
          <CardContent>
            {skillsData.length > 0 ? (
              <div className="space-y-4">
                {skillsData.map((skill, index) => {
                  const maxCount = Math.max(...skillsData.map(s => s.count));
                  return (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center space-x-3 flex-1">
                        <div className={`w-4 h-4 rounded ${skill.color}`} />
                        <span className="font-medium">{skill.name}</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="w-32 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${skill.color}`}
                            style={{ width: `${(skill.count / maxCount) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600 w-8 text-right">{skill.count}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">No skills data available</p>
            )}
          </CardContent>
        </Card>

        {/* Experience Distribution */}
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <PieChart className="w-5 h-5" />
              <span>Experience Distribution</span>
            </CardTitle>
            <CardDescription>
              Years of experience across candidates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {experienceData.map((exp, index) => {
                const maxCount = Math.max(...experienceData.map(e => e.count));
                return (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1">
                      <div className={`w-4 h-4 rounded ${exp.color}`} />
                      <span className="font-medium">{exp.range}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      <div className="w-32 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${exp.color}`}
                          style={{ width: maxCount > 0 ? `${(exp.count / maxCount) * 100}%` : '0%' }}
                        />
                      </div>
                      <span className="text-sm text-gray-600 w-8 text-right">{exp.count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Location Distribution */}
      {locationData.length > 0 && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <MapPin className="w-5 h-5" />
              <span>Geographic Distribution</span>
            </CardTitle>
            <CardDescription>
              Candidate locations in your talent pool
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {locationData.map((location, index) => (
                <div key={index} className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-800">{location.city}</p>
                      <p className="text-2xl font-bold text-blue-600">{location.count}</p>
                    </div>
                    <MapPin className="w-6 h-6 text-blue-600" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
