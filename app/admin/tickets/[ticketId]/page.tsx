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
// import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

function useAdminTicketDetail(ticketId: string) {
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function fetchTicket() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      const data = await res.json();
      if (data.ticket) {
        setTicket({
          ...data.ticket,
          id: data.ticket.ticket_number,
          ticketId:data.ticket.id,
          classification: {
            topicTags: data.ticket.topic_tags || [],
            sentiment: data.ticket.sentiment || '',
            priority: data.ticket.ai_priority || '',
            confidence: data.ticket.classification_confidence || 0,
            aiResponse: data.aiResponse
              ? {
                  answer: data.aiResponse.generated_response,
                  sources: Array.isArray(data.aiResponse.sources)
                    ? data.aiResponse.sources
                    : [],
                  confidence: data.aiResponse.confidence_score || 0
                }
              : undefined
          },
          responses: data.responses || [],
          createdAt: data.ticket.created_at,
          updatedAt: data.ticket.updated_at,
          priority: data.ticket.priority,
          status: data.ticket.status,
          name: data.ticket.name,
          email: data.ticket.email,
          subject: data.ticket.subject,
          description: data.ticket.description
        });
      }
    } catch (err) {
      setTicket(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (ticketId) fetchTicket();
  }, [ticketId]);

  // expose refresh so callers can re-fetch after actions
  return { ticket, loading, refresh: fetchTicket };
}

export default function TicketDetailPage() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [response, setResponse] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedRefs, setSelectedRefs] = useState<number[]>([]);
  
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const ticketId = params?.ticketId as string;
  const { ticket, loading, refresh } = useAdminTicketDetail(ticketId);
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        router.push('/admin/login');
        return;
      }
      
      setUser(user);
      
      setIsLoading(false);
    };

    checkAuth();
  }, [router]);

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

  // Handle reference selection (multi-select with checkboxes)
  const handleReferenceToggle = (idx: number) => {
    setSelectedRefs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  // Use AI response button handler
  const handleUseAIResponse = () => {
    if (ticket?.classification?.aiResponse?.answer) {
      setResponse(ticket.classification.aiResponse.answer);
    }
    // Optionally, select all references by default
    setSelectedRefs(
      ticket.classification?.aiResponse?.sources
        ? ticket.classification.aiResponse.sources.map((_: any, idx: number) => idx)
        : []
    );
  };

  const handleSendResponse = async () => {
    setIsResponding(true);
    try {
      // Only send selected references
      const refsToSend =
        ticket.classification?.aiResponse?.sources?.filter(
          (_: any, idx: number) => selectedRefs.includes(idx)
        ) || [];
      const res = await fetch(`/api/tickets/${ticketId}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: ticket.ticketId,
          content: response,
          references: refsToSend,
          status: 'resolved' // request that server mark ticket resolved
        })
      });

      const payload = await res.json().catch(() => null);
      if (res.ok && payload?.success) {
        await refresh();
        setResponse('');
        setSelectedRefs([]);
      } else {
        console.error('Failed to submit response', payload);
      }
    } catch (err) {
      console.error('Error sending response', err);
    }
    setIsResponding(false);
  };

  if (loading) {
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
            <div className="flex-1 p-6">
              {/* <h4 className="font-semibold mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Conversation
              </h4> */}
              <div className="space-y-4 max-h-[40vh] overflow-y-auto">
                {ticket.responses.map((msg: any) => (
                  <div key={msg.id} className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{msg.author}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm break-words whitespace-pre-line">{msg.content}</p>
                    {/* Render references if present */}
                    {Array.isArray(msg.references) && msg.references.length > 0 && (
                      <div className="mt-2 space-y-2">
                        <div className="font-semibold text-xs text-muted-foreground">References:</div>
                        {msg.references.map((ref: any, idx: number) => (
                          <div key={idx} className="border rounded p-2 flex items-start gap-2">
                            <div className="flex-1">
                              <div className="font-medium text-xs">{ref.title}</div>
                              <div className="text-xs text-muted-foreground">{ref.snippet}</div>
                            </div>
                            <Button variant="ghost" size="sm" asChild>
                              <a href={ref.url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Response Section */}
            <div className="p-6 border-t bg-muted/30 overflow-y-auto">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold">Your Response</Label>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">
                      <Save className="h-3 w-3 mr-1" />
                      Draft
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleUseAIResponse}>
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
                {/* References selection */}
                {ticket.classification?.aiResponse?.sources?.length > 0 && (
                  <div className="mt-4">
                    <Label className="font-semibold mb-2 block">Select References to Send</Label>
                    <div className="space-y-2 max-h-48 overflow-y-auto border rounded bg-background">
                      {ticket.classification.aiResponse.sources.map((ref: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 border-b last:border-b-0 p-2">
                          <input
                            type="checkbox"
                            checked={selectedRefs.includes(idx)}
                            onChange={() => handleReferenceToggle(idx)}
                            id={`ref-${idx}`}
                          />
                          <label htmlFor={`ref-${idx}`} className="flex-1 cursor-pointer">
                            <span className="font-medium text-xs">{ref.title}</span>
                            <span className="text-xs text-muted-foreground block">{ref.snippet}</span>
                          </label>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={ref.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                Automated analysis with {Math.round(ticket?.classification?.confidence * 100)}% confidence
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