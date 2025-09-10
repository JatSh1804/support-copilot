'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  ArrowLeft,
  User,
  Calendar,
  Mail,
  MessageSquare,
  Brain,
  Target,
  Heart,
  Tag,
  ExternalLink,
  Send,
  Save,
  RefreshCw
} from 'lucide-react';
import type { User as SupabaseUser } from "@supabase/supabase-js";

// Sample ticket data - in real app this would come from API
const sampleTickets = {
  'TICKET-001': {
    id: 'TICKET-001',
    subject: 'Cannot connect to Snowflake',
    description: 'Getting authentication errors when trying to set up Snowflake connector. I have checked the credentials multiple times and they work fine in other tools. The error message says "Invalid credentials" but I\'m certain they are correct. This is blocking our entire data pipeline and is very urgent.',
    email: 'user@company.com',
    name: 'John Smith',
    status: 'open',
    priority: 'high',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
    responses: [
      {
        id: '1',
        author: 'John Smith',
        content: 'Getting authentication errors when trying to set up Snowflake connector...',
        timestamp: '2024-01-15T10:30:00Z',
        type: 'customer'
      }
    ],
    classification: {
      topicTags: ['Connector', 'How-to', 'Product'],
      sentiment: 'Frustrated',
      priority: 'P0',
      confidence: 0.85,
      aiResponse: {
        answer: 'Based on your description, this appears to be a common Snowflake connector authentication issue. Here are the recommended troubleshooting steps:\n\n1. **Verify Connection Parameters**: Ensure your account identifier follows the correct format (account-region.snowflakecomputing.com)\n\n2. **Check User Permissions**: The user account needs appropriate warehouse and database permissions\n\n3. **Network Configuration**: Verify that your network allows connections to Snowflake on the required ports\n\n4. **Credential Format**: Ensure there are no hidden characters or spaces in your credentials',
        sources: [
          {
            title: 'Snowflake Connector Setup Guide',
            url: 'https://docs.atlan.com/connectors/snowflake/setup',
            snippet: 'Authentication configuration for Snowflake connections'
          },
          {
            title: 'Troubleshooting Connection Issues',
            url: 'https://docs.atlan.com/troubleshooting/connectors',
            snippet: 'Common solutions for connector authentication problems'
          },
          {
            title: 'Network Requirements',
            url: 'https://docs.atlan.com/setup/network-requirements',
            snippet: 'Required network configurations for cloud connectors'
          }
        ],
        confidence: 0.92
      }
    }
  }
};

export default function TicketDetailPage() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ticket, setTicket] = useState<any>(null);
  const [response, setResponse] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const ticketId = params.ticketId as string;

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      setUser(user);
      
      // Load ticket data
      const ticketData = sampleTickets[ticketId as keyof typeof sampleTickets];
      if (ticketData) {
        setTicket(ticketData);
      }
      
      setIsLoading(false);
    };

    checkAuth();
  }, [router, supabase, ticketId]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (isDragging) {
      const container = document.getElementById('resizable-container');
      if (container) {
        const rect = container.getBoundingClientRect();
        const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;
        if (newLeftWidth >= 30 && newLeftWidth <= 70) {
          setLeftWidth(newLeftWidth);
        }
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging]);

  const getPriorityColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high':
      case 'p0':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'medium':
      case 'p1':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low':
      case 'p2':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'in-progress':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'resolved':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment.toLowerCase()) {
      case 'frustrated':
      case 'angry':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'curious':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'neutral':
        return 'bg-gray-100 text-gray-800 border-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const handleSendResponse = async () => {
    setIsResponding(true);
    // Simulate API call
    setTimeout(() => {
      setResponse('');
      setIsResponding(false);
      // In real app, would update ticket responses
    }, 1000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading ticket...</p>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <h3 className="text-lg font-medium">Ticket not found</h3>
        <p className="text-muted-foreground">The ticket you're looking for doesn't exist.</p>
        <Button onClick={() => router.push('/admin/tickets')} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tickets
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => router.push('/admin/tickets')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {ticket.id}
              <Badge className={getStatusColor(ticket.status)}>
                {ticket.status}
              </Badge>
              <Badge className={getPriorityColor(ticket.priority)}>
                {ticket.priority}
              </Badge>
            </h1>
            <p className="text-muted-foreground">{ticket.subject}</p>
          </div>
        </div>
      </div>

      {/* Resizable Layout */}
      <div 
        id="resizable-container"
        className="flex h-[calc(100vh-200px)] gap-1 select-none"
      >
        {/* Left Panel - Ticket Information */}
        <div 
          className="bg-background border rounded-lg overflow-hidden"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="h-full flex flex-col">
            {/* Customer Info */}
            <div className="p-6 border-b bg-muted/30">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold">{ticket.name}</h3>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {ticket.email}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(ticket.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversation */}
            <div className="flex-1 p-6 overflow-y-auto">
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Conversation
              </h4>
              <div className="space-y-4">
                {ticket.responses.map((msg: any) => (
                  <div key={msg.id} className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{msg.author}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm">{msg.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Response Section */}
            <div className="p-6 border-t bg-muted/30">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold">Your Response</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Save className="h-3 w-3 mr-1" />
                      Draft
                    </Button>
                    <Button variant="outline" size="sm">
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Use AI Response
                    </Button>
                  </div>
                </div>
                <Textarea
                  placeholder="Type your response here..."
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  rows={4}
                />
                <div className="flex items-center gap-2">
                  <Select defaultValue={ticket.status}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={handleSendResponse}
                    disabled={!response.trim() || isResponding}
                    className="ml-auto"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    {isResponding ? 'Sending...' : 'Send Response'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resizer */}
        <div 
          className="w-1 bg-border hover:bg-primary/50 cursor-col-resize flex-shrink-0 transition-colors"
          onMouseDown={handleMouseDown}
        />

        {/* Right Panel - AI Analysis */}
        <div 
          className="bg-background border rounded-lg overflow-hidden"
          style={{ width: `${100 - leftWidth}%` }}
        >
          <div className="h-full flex flex-col">
            {/* AI Classification Header */}
            <div className="p-6 border-b bg-muted/30">
              <h3 className="font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Analysis & Classification
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Automated analysis with {Math.round(ticket.classification.confidence * 100)}% confidence
              </p>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-6">
              {/* Topic Classification */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Tag className="h-4 w-4" />
                    Topic Classification
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {ticket.classification.topicTags.map((tag: string, index: number) => (
                      <Badge key={index} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Sentiment Analysis */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Heart className="h-4 w-4" />
                    Sentiment Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge className={getSentimentColor(ticket.classification.sentiment)}>
                    {ticket.classification.sentiment}
                  </Badge>
                </CardContent>
              </Card>

              {/* Priority Assessment */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Priority Assessment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge className={getPriorityColor(ticket.classification.priority)}>
                    {ticket.classification.priority}
                  </Badge>
                </CardContent>
              </Card>

              {/* AI Generated Response */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    AI Generated Response
                    <Badge variant="outline" className="ml-auto">
                      {Math.round(ticket.classification.aiResponse.confidence * 100)}% confidence
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none">
                    <p className="whitespace-pre-line text-sm">
                      {ticket.classification.aiResponse.answer}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Sources & References */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Sources & References
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ticket.classification.aiResponse.sources.map((source: any, index: number) => (
                      <div key={index} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <h5 className="font-medium text-sm">{source.title}</h5>
                            <p className="text-xs text-muted-foreground mt-1">{source.snippet}</p>
                          </div>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}