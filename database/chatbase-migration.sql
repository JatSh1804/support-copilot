-- Add Chatbase-specific fields to tickets table
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS chatbase_conversation_id TEXT,
ADD COLUMN IF NOT EXISTS chatbase_message_id TEXT,
ADD COLUMN IF NOT EXISTS ai_analysis_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS ai_analysis_completed_at TIMESTAMP WITH TIME ZONE;

-- Create index for Chatbase lookups
CREATE INDEX IF NOT EXISTS idx_tickets_chatbase_conv ON tickets(chatbase_conversation_id);

-- Update trigger to call new edge function instead
CREATE OR REPLACE FUNCTION queue_ticket_for_chatbase_analysis()
RETURNS TRIGGER AS $$
BEGIN
  -- Call edge function via pg_net
  PERFORM net.http_post(
    url := get_config('supabase_url') || '/functions/v1/analyze-ticket-chatbase',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || get_config('service_role_key'),
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
  NEW.ai_analysis_started_at := NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Replace old trigger
DROP TRIGGER IF EXISTS trigger_queue_ticket_processing ON tickets;

CREATE TRIGGER trigger_queue_chatbase_analysis
    AFTER INSERT ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION queue_ticket_for_chatbase_analysis();

-- Optional: Clean up old queue tables if you want to fully remove them
-- DROP TABLE IF EXISTS pgmq.embeddings_queue;
-- DROP TABLE IF EXISTS pgmq.classification_queue;
