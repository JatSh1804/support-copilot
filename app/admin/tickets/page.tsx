'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Ticket, 
  Filter, 
  Search, 
  Clock, 
  AlertTriangle, 
  MessageSquare,
  Brain,
  BarChart3
} from 'lucide-react';
import type { User } from "@supabase/supabase-js";

// Sample ticket data for demonstration
const sampleTickets = [
  {
    id: 'TICKET-001',
    subject: 'Cannot connect to Snowflake',
    description: 'Getting authentication errors when trying to set up Snowflake connector...',
    email: 'user@company.com',
    status: 'open',
    priority: 'high',
    createdAt: new Date().toISOString(),
    classification: {
      topicTags: ['Connector', 'How-to'],
      sentiment: 'Frustrated',
      priority: 'P0'
    }
  },
  {
    id: 'TICKET-002',
    subject: 'API documentation unclear',
    description: 'The Python SDK documentation is missing examples for bulk operations...',
    email: 'dev@startup.com',
    status: 'in-progress',
    priority: 'medium',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    classification: {
      topicTags: ['API/SDK', 'Best practices'],
      sentiment: 'Curious',
      priority: 'P1'
    }
  },
  {
    id: 'TICKET-003',
    subject: 'Lineage not showing for dbt models',
    description: 'Our dbt models are connected but lineage is not appearing in the UI...',
    email: 'analyst@corp.com',
    status: 'resolved',
    priority: 'low',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    classification: {
      topicTags: ['Lineage', 'Product'],
      sentiment: 'Neutral',
      priority: 'P2'
    }
  }
];

export default function AdminTicketsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tickets, setTickets] = useState(sampleTickets);
  const [filter, setFilter] = useState('all');
  const router = useRouter();
  const supabase = createClient();

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
  }, [router, supabase]);

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

  const filteredTickets = tickets.filter(ticket => {
    if (filter === 'all') return true;
    return ticket.status === filter;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto"></div>
          <p className="mt-4 text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Support Tickets</h1>
          <p className="text-muted-foreground">Manage and analyze customer support tickets</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push('/admin/chat')}>
            <Brain className="h-4 w-4 mr-2" />
            AI Agent
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Tickets</p>
                <p className="text-2xl font-bold">{tickets.length}</p>
              </div>
              <Ticket className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Open</p>
                <p className="text-2xl font-bold">{tickets.filter(t => t.status === 'open').length}</p>
              </div>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">High Priority</p>
                <p className="text-2xl font-bold">{tickets.filter(t => t.priority === 'high').length}</p>
              </div>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Resolved</p>
                <p className="text-2xl font-bold">{tickets.filter(t => t.status === 'resolved').length}</p>
              </div>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filter:</span>
        </div>
        <div className="flex gap-2">
          {['all', 'open', 'in-progress', 'resolved'].map((status) => (
            <Button
              key={status}
              variant={filter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(status)}
            >
              {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1).replace('-', ' ')}
            </Button>
          ))}
        </div>
      </div>

      {/* Tickets List */}
      <div className="space-y-4">
        {filteredTickets.map((ticket) => (
          <Card 
            key={ticket.id} 
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => router.push(`/admin/tickets/${ticket.id}`)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-sm text-muted-foreground">{ticket.id}</span>
                    <Badge className={getStatusColor(ticket.status)}>
                      {ticket.status}
                    </Badge>
                    <Badge className={getPriorityColor(ticket.priority)}>
                      {ticket.priority}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg">{ticket.subject}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    From: {ticket.email} • {new Date(ticket.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                {ticket.description}
              </p>
              
              {/* AI Classification */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                  <Brain className="h-4 w-4" />
                  AI Classification
                </h4>
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">Topics:</span>
                    {ticket.classification.topicTags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">Sentiment:</span>
                    <Badge className={`text-xs ${getSentimentColor(ticket.classification.sentiment)}`}>
                      {ticket.classification.sentiment}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium">AI Priority:</span>
                    <Badge className={`text-xs ${getPriorityColor(ticket.classification.priority)}`}>
                      {ticket.classification.priority}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredTickets.length === 0 && (
        <div className="text-center py-12">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No tickets found</h3>
          <p className="text-muted-foreground">No tickets match the current filter.</p>
        </div>
      )}
    </div>
  );
}