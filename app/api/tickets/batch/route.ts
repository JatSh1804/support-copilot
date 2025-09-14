import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const { tickets, name, email } = await req.json();
    if (!Array.isArray(tickets) || !name || !email) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const supabase = await createClient();
    const mappedTickets = tickets.map((t: any) => ({
      ticket_number: t.id,
      subject: t.subject,
      description: t.body,
      name,
      email,
      status: 'pending',
    //   priority: 'medium'
    }));
    const { error } = await supabase
      .from('tickets')
      .insert(mappedTickets);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
