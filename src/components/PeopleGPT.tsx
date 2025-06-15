
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Users, Search, ExternalLink, User } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const PeopleGPT = () => {
  const [isLinkedInConnected, setIsLinkedInConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const handleLinkedInLogin = () => {
    // This would typically integrate with LinkedIn OAuth
    // For now, we'll simulate the connection
    toast({
      title: "LinkedIn Integration",
      description: "LinkedIn OAuth integration would be implemented here. This requires LinkedIn API credentials.",
    });
    setIsLinkedInConnected(true);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      toast({
        title: "Search Required",
        description: "Please enter a search query",
        variant: "destructive"
      });
      return;
    }

    if (!isLinkedInConnected) {
      toast({
        title: "LinkedIn Not Connected",
        description: "Please connect to LinkedIn first",
        variant: "destructive"
      });
      return;
    }

    setIsSearching(true);
    
    // Simulate search - in real implementation, this would call LinkedIn API
    setTimeout(() => {
      const mockResults = [
        {
          id: 1,
          name: "John Doe",
          title: "Software Engineer",
          company: "Tech Corp",
          location: "San Francisco, CA",
          profileUrl: "#",
          imageUrl: "/placeholder.svg"
        },
        {
          id: 2,
          name: "Jane Smith",
          title: "Product Manager",
          company: "Innovation Labs",
          location: "New York, NY",
          profileUrl: "#",
          imageUrl: "/placeholder.svg"
        },
        {
          id: 3,
          name: "Mike Johnson",
          title: "Data Scientist",
          company: "Analytics Inc",
          location: "Austin, TX",
          profileUrl: "#",
          imageUrl: "/placeholder.svg"
        }
      ];
      
      setSearchResults(mockResults);
      setIsSearching(false);
      
      toast({
        title: "Search Completed",
        description: `Found ${mockResults.length} results for "${searchQuery}"`,
      });
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="w-6 h-6 text-blue-600" />
            <span>PeopleGPT - LinkedIn Search</span>
          </CardTitle>
          <CardDescription>
            Connect to LinkedIn and search for professionals using AI-powered queries
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* LinkedIn Connection */}
          {!isLinkedInConnected ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Connect to LinkedIn</h3>
              <p className="text-gray-600 mb-4">
                Connect your LinkedIn account to search for professionals and build your talent pipeline
              </p>
              <Button 
                onClick={handleLinkedInLogin}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Connect LinkedIn Account
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-green-600">
                <Users className="w-5 h-5" />
                <span className="font-medium">LinkedIn Connected</span>
              </div>
              
              {/* Search Interface */}
              <div className="flex space-x-2">
                <Input
                  placeholder="Search for professionals (e.g., 'Software Engineers in San Francisco')"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button 
                  onClick={handleSearch}
                  disabled={isSearching}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  <Search className="w-4 h-4 mr-2" />
                  {isSearching ? "Searching..." : "Search"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Search Results</CardTitle>
            <CardDescription>
              Found {searchResults.length} professionals matching your search
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {searchResults.map((person) => (
                <div key={person.id} className="flex items-center space-x-4 p-4 border rounded-lg bg-white/40">
                  <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center">
                    <User className="w-6 h-6 text-gray-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold">{person.name}</h3>
                    <p className="text-sm text-gray-600">{person.title} at {person.company}</p>
                    <p className="text-sm text-gray-500">{person.location}</p>
                  </div>
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View Profile
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      {isLinkedInConnected && searchResults.length === 0 && (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6 text-center">
            <Search className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Ready to Search</h3>
            <p className="text-gray-600">
              Use the search bar above to find professionals on LinkedIn. 
              Try searches like "React developers in New York" or "Marketing managers with 5+ years experience"
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PeopleGPT;
