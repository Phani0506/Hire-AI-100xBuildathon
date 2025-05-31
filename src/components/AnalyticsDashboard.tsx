
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, PieChart, Users, FileText, MapPin, Briefcase } from "lucide-react";

const AnalyticsDashboard = () => {
  // Mock data - will be replaced with real data from Supabase
  const stats = {
    totalResumes: 127,
    totalCandidates: 127,
    avgExperience: 4.2,
    topLocation: "Hyderabad"
  };

  const skillsData = [
    { name: "JavaScript", count: 45, color: "bg-blue-500" },
    { name: "Python", count: 38, color: "bg-green-500" },
    { name: "React", count: 32, color: "bg-purple-500" },
    { name: "AWS", count: 28, color: "bg-orange-500" },
    { name: "Node.js", count: 25, color: "bg-teal-500" }
  ];

  const experienceData = [
    { range: "0-2 years", count: 32, color: "bg-red-500" },
    { range: "3-5 years", count: 48, color: "bg-blue-500" },
    { range: "6-8 years", count: 35, color: "bg-green-500" },
    { range: "9+ years", count: 12, color: "bg-purple-500" }
  ];

  const locationData = [
    { city: "Hyderabad", count: 42 },
    { city: "Bangalore", count: 38 },
    { city: "Mumbai", count: 25 },
    { city: "Delhi", count: 22 }
  ];

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
            <div className="space-y-4">
              {skillsData.map((skill, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={`w-4 h-4 rounded ${skill.color}`} />
                    <span className="font-medium">{skill.name}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${skill.color}`}
                        style={{ width: `${(skill.count / 50) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600 w-8 text-right">{skill.count}</span>
                  </div>
                </div>
              ))}
            </div>
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
              {experienceData.map((exp, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className={`w-4 h-4 rounded ${exp.color}`} />
                    <span className="font-medium">{exp.range}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${exp.color}`}
                        style={{ width: `${(exp.count / 50) * 100}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-600 w-8 text-right">{exp.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Location Distribution */}
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
    </div>
  );
};

export default AnalyticsDashboard;
