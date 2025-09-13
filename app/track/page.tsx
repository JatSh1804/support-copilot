'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';

export default function TrackPage() {
  const [ticketNumber, setTicketNumber] = useState('');
  const [email, setEmail] = useState('');
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTrack = async () => {
    setLoading(true);
    setError('');
    setTicket(null);

    try {
      const res = await fetch(`/api/tickets/track?ticketNumber=${ticketNumber}&email=${email}`);
      const data = await res.json();

      if (res.ok) {
        setTicket(data);
      } else {
        setError(data.error || 'Failed to fetch ticket details');
      }
    } catch (err) {
      console.error('Error fetching ticket:', err);
      setError('An unexpected error occurred. Please try again.');
    }

    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Track Your Ticket</h1>
      <div className="space-y-4">
        <div>
          <label className="block font-medium mb-1">Ticket Number</label>
          <input
            type="text"
            value={ticketNumber}
            onChange={(e) => setTicketNumber(e.target.value)}
            className="w-full border rounded p-2"
            placeholder="Enter your ticket number"
          />
        </div>
        <div>
          <label className="block font-medium mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded p-2"
            placeholder="Enter your email"
          />
        </div>
        <button
          onClick={handleTrack}
          disabled={loading || !ticketNumber || !email}
          className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? 'Tracking...' : 'Track Ticket'}
        </button>
      </div>

      {error && <p className="text-red-500">{error}</p>}

      {ticket && (
        <div className="space-y-6">
          {/* Ticket Details */}
          <div className="p-6 border rounded-lg bg-muted/30">
            <h2 className="text-xl font-bold">{ticket.subject}</h2>
            <p className="text-muted-foreground">{ticket.description}</p>
            <div className="flex items-center gap-4 mt-4">
              <Badge className={`bg-${ticket.status === 'resolved' ? 'green' : 'blue'}-100 text-${ticket.status === 'resolved' ? 'green' : 'blue'}-800`}>
                {ticket.status}
              </Badge>
              <Badge className={`bg-${ticket.priority === 'P0' ? 'red' : ticket.priority === 'P1' ? 'yellow' : 'green'}-100 text-${ticket.priority === 'P0' ? 'red' : ticket.priority === 'P1' ? 'yellow' : 'green'}-800`}>
                {ticket.priority}
              </Badge>
            </div>
          </div>

          {/* Responses */}
          <div className="p-6 border rounded-lg bg-muted/30">
            <h2 className="text-xl font-semibold">Responses</h2>
            <div className="space-y-4 mt-4">
              {ticket.responses.map((response: any) => (
                <div key={response.id} className="p-4 border rounded-lg bg-background">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{response.author}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(response.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2">{response.content}</p>
                  {response.reference && response.reference.length > 0 && (
                    <div className="mt-2">
                      <h4 className="text-sm font-semibold">References:</h4>
                      <ul className="list-disc list-inside">
                        {response.reference.map((ref: any, idx: number) => (
                          <li key={idx}>
                            <a href={ref.url} target="_blank" rel="noopener noreferrer" className="text-blue-500">
                              {ref.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Similar Resolved Tickets */}
          {ticket.similar_tickets && ticket.similar_tickets.length > 0 && (
            <div className="p-6 border rounded-lg bg-muted/30">
              <h2 className="text-xl font-semibold">Similar Resolved Tickets</h2>
              <div className="space-y-4 mt-4">
                {ticket.similar_tickets.map((similar: any) => (
                  <div key={similar.ticket_id} className="p-4 border rounded-lg bg-background">
                    <h3 className="font-medium">{similar.subject}</h3>
                    <p className="text-sm text-muted-foreground">{similar.description}</p>
                    <span className="text-xs text-muted-foreground">
                      Resolved on: {similar.resolved_at ? new Date(similar.resolved_at).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
