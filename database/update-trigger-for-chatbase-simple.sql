-- Simplified version: Hardcode your Supabase URL and use service role key
CREATE OR REPLACE FUNCTION queue_ticket_for_processing()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url text;
  service_role_key text;
BEGIN
  -- IMPORTANT: Replace with your actual Supabase URL
  edge_function_url := 'https://ssfmmfjhlhvphvkyajdh.supabase.co/functions/v1/analyze-ticket-chatbase';
  
  -- IMPORTANT: Replace with your actual service role key
  -- Get it from: Supabase Dashboard → Settings → API → service_role (secret)
  service_role_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzZm1tZmpobGh2cGh2a3lhamRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njk5NzAwNiwiZXhwIjoyMDcyNTczMDA2fQ.your-service-role-key-here';
  
  -- Call Chatbase edge function
  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_role_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'ticket_id', NEW.id,
      'ticket_number', NEW.ticket_number,
      'subject', NEW.subject,
      'description', NEW.description,
      'email', NEW.email,
      'name', NEW.name
    ),
    timeout_milliseconds := 30000
  );
  
  -- Mark as processing
  NEW.status := 'processing';
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
