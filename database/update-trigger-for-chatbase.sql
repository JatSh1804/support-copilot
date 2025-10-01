-- Update existing trigger to call new Chatbase edge function
CREATE OR REPLACE FUNCTION queue_ticket_for_processing()
RETURNS TRIGGER AS $$
DECLARE
  headers_raw text;
  auth_header text;
  supabase_url text;
  edge_function_url text;
BEGIN
  -- Get Supabase URL from environment or use default pattern
  -- You can also hardcode this: supabase_url := 'https://your-project-ref.supabase.co';
  supabase_url := current_setting('app.settings.supabase_url', true);
  
  -- If not set, construct from project reference
  IF supabase_url IS NULL OR supabase_url = '' THEN
    -- Hardcode your Supabase URL here
    supabase_url := 'https://ssfmmfjhlhvphvkyajdh.supabase.co';
  END IF;
  
  edge_function_url := supabase_url || '/functions/v1/analyze-ticket-chatbase';
  
  -- Get authorization header from current request context
  headers_raw := current_setting('request.headers', true);
  
  -- Parse authorization header if present
  auth_header := CASE
    WHEN headers_raw IS NOT NULL THEN
      (headers_raw::json->>'authorization')
    ELSE
      -- Fallback: use service role key if available
      'Bearer ' || current_setting('app.settings.service_role_key', true)
  END;
  
  -- Call Chatbase edge function
  PERFORM net.http_post(
    url := edge_function_url,
    headers := jsonb_build_object(
      'Authorization', COALESCE(auth_header, ''),
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

-- Trigger remains the same, no changes needed
-- The existing trigger "trigger_queue_ticket_processing" will now call the new function
