import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Read body (may be missing if caller used URL param)
    const body = await request.json().catch(() => null);

    // Try ticketId in body first
    let ticketId = body && typeof body === 'object' ? (body.ticketId as string | undefined) : undefined;

    // If missing, try to extract from the request path: /api/tickets/{ticketId}/response
    if (!ticketId) {
      try {
        const pathname = new URL(request.url).pathname;
        const parts = pathname.split('/').filter(Boolean);
        // find 'tickets' and take next segment as ticketId (robust to being mounted)
        const ticketsIndex = parts.findIndex(p => p === 'tickets');
        if (ticketsIndex >= 0 && parts.length > ticketsIndex + 1) {
          ticketId = parts[ticketsIndex + 1];
        }
      } catch (err) {
        // ignore parsing errors
      }
    }

    // Validate ticketId
    if (!ticketId || typeof ticketId !== 'string') {
      console.warn('Missing ticketId. Body:', body, 'Request URL:', request.url);
      return NextResponse.json({ error: 'ticketId is required (body or URL path)' }, { status: 400 });
    }

    // Validate body content
    const content = body?.content;
    const references = body?.references;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Response content is required' }, { status: 400 });
    }

    // Resolve tickets.id:
    // - Primary: if ticketId looks like a ticket_number (e.g. starts with "TICKET-"), lookup by ticket_number
    // - Fallback: if ticketId looks like a UUID, assume it's the id and use it directly
    let resolvedTicketId: string | null = null;

    try {
      if (/^TICKET-/i.test(ticketId)) {
        const { data: ticketRow, error: ticketError } = await supabase
          .from('tickets')
          .select('id')
          .eq('ticket_number', ticketId)
          .single();

        if (ticketError || !ticketRow) {
          console.warn('No ticket found for ticket_number:', ticketId, ticketError);
          return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }
        resolvedTicketId = ticketRow.id;
      } else {
        // Basic UUID-ish check
        const uuidLike = /^[0-9a-fA-F-]{36}$/.test(ticketId);
        if (uuidLike) {
          resolvedTicketId = ticketId;
        } else {
          // Try lookup by ticket_number as a last resort
          const { data: tRow, error: tErr } = await supabase
            .from('tickets')
            .select('id')
            .eq('ticket_number', ticketId)
            .single();
          if (tErr || !tRow) {
            console.warn('Could not resolve ticket identifier:', ticketId, tErr);
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
          }
          resolvedTicketId = tRow.id;
        }
      }
    } catch (err) {
      console.error('Error resolving ticket id for', ticketId, err);
      return NextResponse.json({ error: 'Error resolving ticket' }, { status: 500 });
    }

    // Insert response (store references as JSONB in "references" column)
    const { error: responseError } = await supabase
      .from('ticket_responses')
      .insert({
        ticket_id: resolvedTicketId,
        author_name: 'Support Team',
        response_type: 'support',
        content: content.trim(),
        reference: Array.isArray(references) ? references : null
      });

    if (responseError) {
      console.error('Error inserting ticket response:', responseError);
      return NextResponse.json({ error: 'Failed to submit response' }, { status: 500 });
    }

    // If caller provided a status (e.g. "resolved"), update the ticket status
    let updatedStatus = null;
    if (body?.status && typeof body.status === 'string') {
      const { error: statusError } = await supabase
        .from('tickets')
        .update({ status: 'resolved', updated_at: new Date().toISOString() })
        .eq('id', resolvedTicketId);

      if (statusError) {
        console.error('Error updating ticket status:', statusError);
        // still return success for response insertion, but report status update failure
        return NextResponse.json({ success: true, statusUpdated: false, error: statusError.message }, { status: 200 });
      } else {
        updatedStatus = body.status;
      }
    }

    return NextResponse.json({ success: true, statusUpdated: !!updatedStatus, updatedStatus }, { status: 201 });
  } catch (err: any) {
    console.error('Unexpected error in response route:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
