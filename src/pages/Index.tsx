
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Search, FileText, BarChart } from "lucide-react";
import AuthModal from "@/components/AuthModal";
import Dashboard from "@/components/Dashboard";
import { useState } from "react";

const Index = () => {
  const { user, loading } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center mx-auto mb-4">
            <Users className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Loading HIRE AI...
          </h1>
        </div>
      </div>
    );
  }

  if (user) {
    return <Dashboard />;
  }

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
            <Button 
              onClick={() => setShowAuthModal(true)}
              className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
            >
              Get Started
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-5xl font-bold mb-6 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Your Personal Talent
            <br />
            Matchmaking Platform
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Upload resumes, leverage AI-powered search, and build your private talent pool. 
            Find the perfect candidates with intelligent matching and automated screening.
          </p>
          <Button 
            size="lg"
            onClick={() => setShowAuthModal(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-4 text-lg"
          >
            Start Building Your Talent Pool
          </Button>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300 hover:scale-105">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg flex items-center justify-center mx-auto mb-4">
                <FileText className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">Smart Resume Parsing</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                AI-powered extraction of skills, experience, and contact information from uploaded resumes.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300 hover:scale-105">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Search className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">Semantic Search</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Natural language queries to find candidates based on skills, experience, and location.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300 hover:scale-105">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-lg flex items-center justify-center mx-auto mb-4">
                <Users className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">AI Screening</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Generate relevant screening questions and verify candidate information automatically.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm hover:shadow-xl transition-all duration-300 hover:scale-105">
            <CardHeader className="text-center">
              <div className="w-12 h-12 bg-gradient-to-r from-teal-500 to-teal-600 rounded-lg flex items-center justify-center mx-auto mb-4">
                <BarChart className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-lg">Analytics Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-center">
                Visualize your talent pool with insights on skills distribution and candidate metrics.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* CTA Section */}
        <div className="text-center bg-white/40 backdrop-blur-sm rounded-2xl p-12 border border-white/20">
          <h3 className="text-3xl font-bold mb-4 text-gray-800">
            Ready to Transform Your Hiring Process?
          </h3>
          <p className="text-lg text-gray-600 mb-8">
            Join thousands of recruiters using AI to build better talent pools.
          </p>
          <Button 
            size="lg"
            onClick={() => setShowAuthModal(true)}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-4 text-lg"
          >
            Get Started Free
          </Button>
        </div>
      </section>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal 
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
        />
      )}
    </div>
  );
};

export default Index;
