
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { Users, FileText, TrendingUp, Search, MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const chartConfig = {
  uploads: {
    label: "Uploads",
    color: "#3b82f6",
  },
};

const fetchAnalyticsData = async () => {
  const { data: resumes, error: resumesError } = await supabase
    .from('resumes')
    .select('created_at, parsing_status');
  if (resumesError) throw new Error(resumesError.message, { cause: 'resumes' });

  const { data: parsedDetails, error: parsedDetailsError } = await supabase
    .from('parsed_resume_details')
    .select('skills_json, location');
  if (parsedDetailsError) throw new Error(parsedDetailsError.message, { cause: 'parsed_details' });

  return { resumes, parsedDetails };
};

const AnalyticsDashboard = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analyticsData'],
    queryFn: fetchAnalyticsData,
  });

  const analyticsData = useMemo(() => {
    if (!data?.resumes || !data?.parsedDetails) return null;

    const { resumes, parsedDetails } = data;

    const totalCandidates = resumes.length;
    const resumesParsed = resumes.filter(r => r.parsing_status === 'completed').length;

    const skillsCount = parsedDetails
      .flatMap(d => d.skills_json || [])
      .reduce((acc, skill) => {
        if (skill) {
          acc[skill.trim().toLowerCase()] = (acc[skill.trim().toLowerCase()] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
    const topSkills = Object.entries(skillsCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));

    const locationsCount = parsedDetails
      .reduce((acc, detail) => {
        const location = detail.location?.split(',')[0].trim() || 'Unknown';
        if (location && location.length > 1) {
          acc[location] = (acc[location] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
    const topLocations = Object.entries(locationsCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    const uploadsByMonth = resumes.reduce((acc, resume) => {
      const month = new Date(resume.created_at).toLocaleString('default', { month: 'short' });
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const sortedMonths = Object.keys(uploadsByMonth).sort((a,b) => {
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return months.indexOf(a) - months.indexOf(b);
    });

    const monthlyTrends = sortedMonths.map(month => ({ month, uploads: uploadsByMonth[month] || 0 }));

    return { totalCandidates, resumesParsed, topSkills, topLocations, monthlyTrends };
  }, [data]);

  if (isLoading) {
    return <AnalyticsSkeleton />;
  }
  
  if (error) {
    return <div className="text-red-500">Error loading analytics data: {error.message}</div>;
  }

  if (!analyticsData || analyticsData.totalCandidates === 0) {
    return (
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
            <CardHeader>
                <CardTitle>Welcome to your Dashboard!</CardTitle>
            </CardHeader>
            <CardContent>
                <p>No analytics data to display yet. Start by uploading some resumes to see your talent pool grow.</p>
            </CardContent>
        </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Candidates</p>
                <p className="text-3xl font-bold text-gray-900">{analyticsData.totalCandidates}</p>
              </div>
              <Users className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Resumes Parsed</p>
                <p className="text-3xl font-bold text-gray-900">{analyticsData.resumesParsed}</p>
              </div>
              <FileText className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Searches</p>
                <p className="text-3xl font-bold text-gray-900">45</p>
              </div>
              <Search className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Success Rate</p>
                <p className="text-3xl font-bold text-gray-900">94%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Top Skills Distribution</CardTitle>
            <CardDescription>Most common skills across all candidates</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={analyticsData.topSkills}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Candidates by Location</CardTitle>
            <CardDescription>Breakdown of candidates by primary location</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <PieChart>
                <Pie data={analyticsData.topLocations} cx="50%" cy="50%" labelLine={false} label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`} outerRadius={80} fill="#8884d8" dataKey="count">
                  {analyticsData.topLocations.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
        
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Uploads</CardTitle>
            <CardDescription>Resume upload activity over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={analyticsData.monthlyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="monotone" dataKey="uploads" stroke={chartConfig.uploads.color} strokeWidth={3} dot={{ fill: chartConfig.uploads.color }} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};


const AnalyticsSkeleton = () => (
    <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
                <Card key={i} className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
                    <CardContent className="p-6">
                        <Skeleton className="h-5 w-1/2 mb-2" />
                        <Skeleton className="h-8 w-1/4" />
                    </CardContent>
                </Card>
            ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[...Array(2)].map((_, i) => (
                <Card key={i} className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
                    <CardHeader>
                        <Skeleton className="h-6 w-3/4 mb-2" />
                        <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
                </Card>
            ))}
            <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm lg:col-span-2">
                <CardHeader>
                    <Skeleton className="h-6 w-1/4 mb-2" />
                    <Skeleton className="h-4 w-1/3" />
                </CardHeader>
                <CardContent><Skeleton className="h-[300px] w-full" /></CardContent>
            </Card>
        </div>
    </div>
);


export default AnalyticsDashboard;
