CREATE OR REPLACE FUNCTION get_ticket_details(p_ticket_number VARCHAR, p_email VARCHAR)
RETURNS JSONB AS $$
DECLARE
  ticket_details JSONB;
BEGIN
  -- Debugging: Log the input parameters
  RAISE NOTICE 'Input ticket_number: %, email: %', p_ticket_number, p_email;

  -- Fetch ticket details
  SELECT jsonb_build_object(
    'id', t.id,
    'ticket_number', t.ticket_number,
    'name', t.name,
    'email', t.email,
    'subject', t.subject,
    'description', t.description,
    'status', t.status,
    'priority', t.priority,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  )
  INTO ticket_details
  FROM tickets t
  WHERE t.ticket_number = p_ticket_number
    AND LOWER(t.email) = LOWER(p_email); -- Ensure case-insensitive email matching

  -- Debugging: Log the ticket details
  IF ticket_details IS NULL THEN
    RAISE NOTICE 'No ticket found for ticket_number: %, email: %', p_ticket_number, p_email;
    RETURN NULL;
  ELSE
    RAISE NOTICE 'Ticket found: %', ticket_details;
  END IF;

  -- Fetch responses and references
  ticket_details := ticket_details || jsonb_build_object(
    'responses', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'author', r.author_name,
          'content', r.content,
          'timestamp', r.created_at,
          'reference', r.reference  -- Changed from 'references' to 'reference'
        )
        ORDER BY r.created_at ASC
      )
      FROM ticket_responses r
      WHERE r.ticket_id = (ticket_details->>'id')::UUID
    )
  );

  -- Fetch similar resolved tickets
  ticket_details := ticket_details || jsonb_build_object(
    'similar_tickets', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'ticket_id', t.id,
          'ticket_number', t.ticket_number,
          'subject', t.subject,
          'description', t.description,
          'resolved_at', t.resolved_at
        )
        ORDER BY t.resolved_at DESC
      )
      FROM tickets t
      WHERE t.status = 'resolved'
      AND t.id != (ticket_details->>'id')::UUID
      LIMIT 5
    )
  );

  RETURN ticket_details;
END;
$$ LANGUAGE plpgsql;
