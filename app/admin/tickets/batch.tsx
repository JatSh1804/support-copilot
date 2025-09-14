'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function BatchTicketPage() {
  const [jsonText, setJsonText] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  const handleSubmit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const tickets = JSON.parse(jsonText);
      if (!Array.isArray(tickets)) throw new Error('Input must be a JSON array');
      const res = await fetch('/api/tickets/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets, name, email })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ success: true });
        setJsonText('');
      } else {
        setResult({ error: data.error || 'Unknown error' });
      }
    } catch (err: any) {
      setResult({ error: err.message });
    }
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto py-10">
      <Card>
        <CardHeader>
          <CardTitle>Batch Ticket Creation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Label>Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          <Label>Email</Label>
          <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" />
          <Label>Tickets JSON Array</Label>
          <Textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            rows={10}
            placeholder={`Paste JSON array here...`}
          />
          <Button onClick={handleSubmit} disabled={loading || !jsonText.trim() || !name || !email}>
            {loading ? 'Submitting...' : 'Submit Batch'}
          </Button>
          {result?.success && (
            <div className="text-green-600 mt-2">Batch submitted successfully!</div>
          )}
          {result?.error && (
            <div className="text-red-600 mt-2">{result.error}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
