import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } }
) {
  try {
    const supabase = await createClient();
    const { ticketId } = params;
    const { searchParams } = new URL(request.url);
    const trackingToken = searchParams.get('token');

    // Determine access type - admin or customer tracking
    const { data: { user } } = await supabase.auth.getUser();
    const isAdmin = !!user;
    const isCustomerTracking = !!trackingToken && !isAdmin;

    if (!isAdmin && !isCustomerTracking) {
      return NextResponse.json(
        { error: 'Unauthorized. Either login as admin or provide tracking token.' },
        { status: 401 }
      );
    }

    let ticketQuery;

    if (isCustomerTracking) {
      // Customer access via tracking token
      ticketQuery = supabase
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
          ticket_tracking_tokens!inner(tracking_token)
        `)
        .eq('ticket_tracking_tokens.tracking_token', trackingToken)
        .eq('ticket_number', ticketId)
        .single();
    } else {
      // Admin access - full details
      ticketQuery = supabase
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
          topic_tags,
          sentiment,
          ai_priority,
          classification_confidence,
          created_at,
          updated_at,
          classification_completed_at,
          assigned_to,
          resolved_at
        `)
        .eq('ticket_number', ticketId)
        .single();
    }

    const { data: ticket, error: ticketError } = await ticketQuery;

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    // Get responses/conversation thread
    const { data: responses, error: responsesError } = await supabase
      .from('ticket_responses')
      .select(`
        id,
        author_name,
        author_email,
        author_id,
        response_type,
        content,
        is_internal,
        created_at
      `)
      .eq('ticket_id', ticket.id)
      .eq('is_internal', isCustomerTracking ? false : false) // Show all for admin, only non-internal for customers
      .order('created_at', { ascending: true });

    if (responsesError) {
      console.error('Error fetching responses:', responsesError);
    }

    let aiResponse = null;
    if (isAdmin) {
      // Get AI generated response for admin
      const { data: aiData, error: aiError } = await supabase
        .from('ai_responses')
        .select(`
          id,
          generated_response,
          confidence_score,
          sources,
          used_by_support,
          created_at
        `)
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!aiError && aiData) {
        aiResponse = aiData;
      }
    }

    const response = {
      ticket: {
        ...ticket,
        // Remove sensitive fields for customer access
        ...(isCustomerTracking && {
          topic_tags: undefined,
          sentiment: undefined,
          ai_priority: undefined,
          classification_confidence: undefined,
          assigned_to: undefined
        })
      },
      responses: responses || [],
      ...(isAdmin && aiResponse && { aiResponse }),
      accessType: isAdmin ? 'admin' : 'customer'
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { ticketId: string } }
) {
  try {
    const supabase = await createClient();
    const { ticketId } = params;

    // Check admin authentication
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { status, priority, response, assignedTo } = body;

    // Get ticket ID from ticket number
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id')
      .eq('ticket_number', ticketId)
      .single();

    if (ticketError || !ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    // Update ticket
    const updateData: any = {};
    if (status) updateData.status = status;
    if (priority) updateData.priority = priority;
    if (assignedTo) updateData.assigned_to = assignedTo;
    if (status === 'resolved') updateData.resolved_at = new Date().toISOString();

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('tickets')
        .update(updateData)
        .eq('id', ticket.id);

      if (updateError) {
        console.error('Error updating ticket:', updateError);
        return NextResponse.json(
          { error: 'Failed to update ticket' },
          { status: 500 }
        );
      }
    }

    // Add response if provided
    if (response && response.trim()) {
      const { error: responseError } = await supabase
        .from('ticket_responses')
        .insert({
          ticket_id: ticket.id,
          author_name: user.email || 'Support Team',
          author_email: user.email,
          author_id: user.id,
          response_type: 'support',
          content: response.trim()
        });

      if (responseError) {
        console.error('Error adding response:', responseError);
        return NextResponse.json(
          { error: 'Failed to add response' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, message: 'Ticket updated successfully' });

  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}