
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer } from "recharts";
import { Users, FileText, TrendingUp, Search } from "lucide-react";

const skillsData = [
  { name: "JavaScript", value: 45 },
  { name: "Python", value: 38 },
  { name: "React", value: 32 },
  { name: "Node.js", value: 28 },
  { name: "SQL", value: 25 },
  { name: "Java", value: 22 },
];

const experienceData = [
  { level: "Entry (0-2 years)", count: 15 },
  { level: "Mid (3-5 years)", count: 28 },
  { level: "Senior (6-10 years)", count: 22 },
  { level: "Lead (10+ years)", count: 12 },
];

const monthlyTrendsData = [
  { month: "Jan", uploads: 12, searches: 45 },
  { month: "Feb", uploads: 18, searches: 67 },
  { month: "Mar", uploads: 25, searches: 89 },
  { month: "Apr", uploads: 32, searches: 123 },
  { month: "May", uploads: 28, searches: 145 },
  { month: "Jun", uploads: 35, searches: 167 },
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D'];

const chartConfig = {
  uploads: {
    label: "Uploads",
    color: "#3b82f6",
  },
  searches: {
    label: "Searches",
    color: "#8b5cf6",
  },
};

const AnalyticsDashboard = () => {
  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Candidates</p>
                <p className="text-3xl font-bold text-gray-900">127</p>
                <p className="text-sm text-green-600">+12% from last month</p>
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
                <p className="text-3xl font-bold text-gray-900">89</p>
                <p className="text-sm text-green-600">+18% from last month</p>
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
                <p className="text-sm text-blue-600">+8% from last week</p>
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
                <p className="text-sm text-green-600">+2% from last month</p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Skills Chart */}
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Top Skills Distribution</CardTitle>
            <CardDescription>Most common skills across all candidates</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={skillsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Experience Levels */}
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Experience Level Distribution</CardTitle>
            <CardDescription>Breakdown of candidates by experience level</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <PieChart>
                <Pie
                  data={experienceData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {experienceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Monthly Trends */}
        <Card className="border-0 shadow-lg bg-white/60 backdrop-blur-sm lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Trends</CardTitle>
            <CardDescription>Resume uploads and search activity over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={monthlyTrendsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line 
                  type="monotone" 
                  dataKey="uploads" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  dot={{ fill: "#3b82f6" }}
                />
                <Line 
                  type="monotone" 
                  dataKey="searches" 
                  stroke="#8b5cf6" 
                  strokeWidth={3}
                  dot={{ fill: "#8b5cf6" }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
