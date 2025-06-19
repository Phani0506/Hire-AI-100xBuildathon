import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Search, Upload, BarChart, FileText, User, Settings, MessageSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";

const features = [
  {
    id: "peoplegpt",
    title: "PeopleGPT",
    description: "AI-powered LinkedIn search to find professionals using natural language queries",
    icon: MessageSquare,
    color: "from-blue-500 to-blue-600"
  },
  {
    id: "upload",
    title: "Resume Upload",
    description: "Upload and automatically parse resumes with AI-powered data extraction",
    icon: Upload,
    color: "from-green-500 to-green-600"
  },
  {
    id: "resumes",
    title: "Resume Library",
    description: "Browse and manage your entire collection of uploaded and parsed resumes",
    icon: FileText,
    color: "from-purple-500 to-purple-600"
  },
  {
    id: "search",
    title: "Talent Search",
    description: "Semantic search through your talent pool using natural language queries",
    icon: Search,
    color: "from-orange-500 to-orange-600"
  },
  {
    id: "dashboard",
    title: "Analytics Dashboard",
    description: "Visualize talent pool insights with charts and metrics about your candidates",
    icon: BarChart,
    color: "from-teal-500 to-teal-600"
  },
  {
    id: "settings",
    title: "Account Settings",
    description: "Manage your profile, security settings, and password preferences",
    icon: Settings,
    color: "from-gray-500 to-gray-600"
  }
];

const FeatureLandingPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  const handleFeatureClick = (featureId: string) => {
    navigate(`/dashboard?tab=${featureId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                HIRE AI
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <User className="w-5 h-5 text-gray-600" />
                <span className="text-sm text-gray-600">{user?.email}</span>
              </div>
              <Button variant="outline" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Welcome to Your AI-Powered Talent Hub
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Choose a feature below to start building and managing your talent pool with cutting-edge AI technology.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {features.map((feature) => (
            <Card 
              key={feature.id}
              className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300 hover:scale-105 cursor-pointer"
              onClick={() => handleFeatureClick(feature.id)}
            >
              <CardHeader className="text-center">
                <div className={`w-16 h-16 bg-gradient-to-r ${feature.color} rounded-lg flex items-center justify-center mx-auto mb-4`}>
                  <feature.icon className="w-8 h-8 text-white" />
                </div>
                <CardTitle className="text-xl">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-center text-base">
                  {feature.description}
                </CardDescription>
                <div className="mt-4 text-center">
                  <Button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFeatureClick(feature.id);
                    }}
                    className={`bg-gradient-to-r ${feature.color} hover:opacity-90 text-white`}
                  >
                    Start Using
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Stats Section */}
        <div className="mt-16 bg-white/40 backdrop-blur-sm rounded-2xl p-8 border border-white/20">
          <h3 className="text-2xl font-bold text-center mb-6 text-gray-800">
            Your Talent Pool at a Glance
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">AI-Powered</div>
              <div className="text-gray-600">Resume Parsing</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 mb-2">Semantic</div>
              <div className="text-gray-600">Talent Search</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-teal-600 mb-2">Real-time</div>
              <div className="text-gray-600">Analytics</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeatureLandingPage;
