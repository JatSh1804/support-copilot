import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const ticketNumber = searchParams.get('ticketNumber');
    const email = searchParams.get('email');

    console.log('Received ticketNumber:', ticketNumber);
    console.log('Received email:', email);

    if (!ticketNumber || !email) {
      return NextResponse.json(
        { error: 'ticketNumber and email are required' },
        { status: 400 }
      );
    }

    // Call the RPC function to fetch ticket details
    const { data, error } = await supabase.rpc('get_ticket_details', {
      p_ticket_number: ticketNumber,
      p_email: email
    });

    console.log('RPC call response:', { data, error });

    if (error) {
      console.error('Error fetching ticket details:', error);
      return NextResponse.json({ error: 'Failed to fetch ticket details' }, { status: 500 });
    }

    if (!data) {
      console.warn('No data returned from get_ticket_details');
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}