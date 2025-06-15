
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Search, Upload, BarChart, FileText, User, Settings, Lock } from "lucide-react";
import ResumeUpload from "@/components/ResumeUpload";
import TalentSearch from "@/components/TalentSearch";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import ResumeList from "@/components/ResumeList";
import PeopleGPT from "@/components/PeopleGPT";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const Dashboard = () => {
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleLogout = async () => {
    await signOut();
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Error",
        description: "New passwords don't match",
        variant: "destructive"
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive"
      });
      return;
    }

    setIsChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) {
        toast({
          title: "Error",
          description: error.message,
          variant: "destructive"
        });
      } else {
        toast({
          title: "Success",
          description: "Password changed successfully",
        });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive"
      });
    } finally {
      setIsChangingPassword(false);
    }
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
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2 text-gray-800">Welcome back!</h2>
          <p className="text-gray-600">Manage your talent pool and find the perfect candidates with AI-powered tools.</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 bg-white/60 backdrop-blur-sm">
            <TabsTrigger value="peoplegpt" className="flex items-center space-x-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">PeopleGPT</span>
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center space-x-2">
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">Upload</span>
            </TabsTrigger>
            <TabsTrigger value="resumes" className="flex items-center space-x-2">
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Resumes</span>
            </TabsTrigger>
            <TabsTrigger value="search" className="flex items-center space-x-2">
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">Search</span>
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="flex items-center space-x-2">
              <BarChart className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center space-x-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="peoplegpt">
            <PeopleGPT />
          </TabsContent>

          <TabsContent value="dashboard">
            <AnalyticsDashboard />
          </TabsContent>

          <TabsContent value="upload">
            <ResumeUpload />
          </TabsContent>

          <TabsContent value="resumes">
            <ResumeList />
          </TabsContent>

          <TabsContent value="search">
            <TalentSearch />
          </TabsContent>

          <TabsContent value="settings">
            <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Settings className="w-5 h-5" />
                  <span>Account Settings</span>
                </CardTitle>
                <CardDescription>
                  Manage your account preferences and security settings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input value={user?.email || ""} disabled />
                </div>
                
                <div className="pt-4 border-t">
                  <div className="flex items-center space-x-2 mb-4">
                    <Lock className="w-5 h-5 text-gray-600" />
                    <h3 className="text-lg font-medium">Change Password</h3>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Current Password</label>
                      <Input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        placeholder="Enter current password"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">New Password</label>
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Confirm New Password</label>
                      <Input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                      />
                    </div>
                    
                    <Button 
                      onClick={handleChangePassword}
                      disabled={isChangingPassword || !newPassword || !confirmPassword}
                      className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    >
                      {isChangingPassword ? "Changing..." : "Change Password"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;
