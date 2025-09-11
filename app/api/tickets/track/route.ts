import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const ticketNumber = searchParams.get('ticketNumber');
    const trackingToken = searchParams.get('trackingToken');

    if (!ticketNumber || !trackingToken) {
      return NextResponse.json(
        { error: 'Ticket number and tracking token are required' },
        { status: 400 }
      );
    }

    // Find ticket by tracking token and ticket number
    const { data: ticket, error } = await supabase
      .from('tickets')
      .select(`
        id,
        ticket_number,
        name,
        email,
        subject,
        description,
        status,
        priority,
        created_at,
        updated_at,
        resolved_at,
        ticket_tracking_tokens!inner(tracking_token, expires_at)
      `)
      .eq('ticket_number', ticketNumber)
      .eq('ticket_tracking_tokens.tracking_token', trackingToken)
      .single();

    if (error || !ticket) {
      return NextResponse.json(
        { error: 'Invalid ticket number or tracking token' },
        { status: 404 }
      );
    }

    // Check if tracking token is expired
    const tokenData = ticket.ticket_tracking_tokens as any;
    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Tracking token has expired' },
        { status: 401 }
      );
    }

    // Get public responses (non-internal)
    const { data: responses, error: responsesError } = await supabase
      .from('ticket_responses')
      .select(`
        id,
        author_name,
        response_type,
        content,
        created_at
      `)
      .eq('ticket_id', ticket.id)
      .eq('is_internal', false)
      .order('created_at', { ascending: true });

    if (responsesError) {
      console.error('Error fetching responses:', responsesError);
    }

    // Remove sensitive data and tracking token info
    const { ticket_tracking_tokens, ...publicTicket } = ticket;

    return NextResponse.json({
      ticket: publicTicket,
      responses: responses || [],
      statusMessage: getStatusMessage(ticket.status)
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getStatusMessage(status: string): string {
  const messages = {
    pending: 'Your ticket has been received and is waiting to be processed.',
    processing: 'Our AI is analyzing your ticket and determining the best way to help.',
    classified: 'Your ticket has been analyzed and assigned to the appropriate team.',
    'in-progress': 'A support team member is working on your ticket.',
    resolved: 'Your ticket has been resolved. If you need further assistance, please create a new ticket.',
    closed: 'This ticket has been closed.'
  };
  
  return messages[status as keyof typeof messages] || 'Status unknown.';
}