-- ================================================
-- ATLAN TICKET SYSTEM - PRODUCTION-READY SETUP
-- ================================================
-- Optimized for high-throughput job processing with millions of jobs
-- Uses Supabase vault for secrets and efficient queue checking

-- ================================================
-- 1. ENABLE EXTENSIONS
-- ================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ================================================
-- 2. CREATE ENUM TYPES
-- ================================================
CREATE TYPE ticket_status AS ENUM ('pending', 'processing', 'classified', 'in-progress', 'resolved', 'closed');
CREATE TYPE response_type AS ENUM ('customer', 'support', 'system');
CREATE TYPE priority_level AS ENUM ('P0', 'P1', 'P2');
CREATE TYPE sentiment_type AS ENUM ('Frustrated', 'Angry', 'Curious', 'Neutral', 'Happy');

-- ================================================
-- 3. CREATE PGMQ QUEUES AND SET PERMISSIONS
-- ================================================
SELECT pgmq.create('embeddings_queue');
SELECT pgmq.create('classification_queue');

-- Grant necessary permissions for PGMQ to all roles
GRANT USAGE ON SCHEMA pgmq TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO postgres, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO postgres, anon, authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pgmq TO postgres, anon, authenticated, service_role;

-- ================================================
-- 4. CREATE MAIN TABLES
-- ================================================

-- Tickets table - main tickets storage
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(20) UNIQUE NOT NULL, -- Format: TICKET-001, TICKET-002
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    status ticket_status DEFAULT 'pending',
    priority priority_level DEFAULT 'P2',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    classification_completed_at TIMESTAMP WITH TIME ZONE,
    
    -- AI Classification results
    topic_tags TEXT[], -- Array of topic tags like ['Connector', 'How-to']
    sentiment sentiment_type,
    ai_priority priority_level,
    classification_confidence DECIMAL(3,2), -- 0.00 to 1.00
    
    -- Metadata
    assigned_to UUID REFERENCES auth.users(id),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Ticket embeddings storage with pgvector
CREATE TABLE ticket_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL, -- 'subject', 'description', 'combined'
    embedding vector(1536), -- OpenAI ada-002 embeddings are 1536 dimensions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(ticket_id, content_type)
);

-- Ticket responses/conversation thread
CREATE TABLE ticket_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_name VARCHAR(255) NOT NULL,
    author_email VARCHAR(255),
    author_id UUID REFERENCES auth.users(id), -- NULL for customers
    response_type response_type NOT NULL,
    content TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE, -- Internal notes vs customer-facing responses
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI generated responses and sources
CREATE TABLE ai_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    generated_response TEXT NOT NULL,
    confidence_score DECIMAL(3,2),
    sources JSONB, -- Array of source objects with title, url, snippet
    used_by_support BOOLEAN DEFAULT FALSE, -- Track if support team used this response
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Customer tracking tokens (for customers to check status without auth)
CREATE TABLE ticket_tracking_tokens (
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tracking_token VARCHAR(32) UNIQUE NOT NULL, -- Random token for customer access
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (ticket_id)
);

-- ================================================
-- 5. CREATE INDEXES
-- ================================================
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_ticket_number ON tickets(ticket_number);
CREATE INDEX idx_tickets_email ON tickets(email);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
CREATE INDEX idx_tickets_classification_status ON tickets(status, classification_completed_at);

-- Vector index for similarity search
CREATE INDEX idx_ticket_embeddings_vector ON ticket_embeddings USING ivfflat (embedding vector_cosine_ops);

CREATE INDEX idx_responses_ticket ON ticket_responses(ticket_id);
CREATE INDEX idx_responses_created ON ticket_responses(created_at);
CREATE INDEX idx_responses_type ON ticket_responses(response_type);

CREATE INDEX idx_ai_responses_ticket ON ai_responses(ticket_id);
CREATE INDEX idx_tracking_token ON ticket_tracking_tokens(tracking_token);

-- ================================================
-- 6. CREATE FUNCTIONS
-- ================================================

-- Function to generate ticket numbers
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS TRIGGER AS $$
DECLARE
    next_number INTEGER;
    new_ticket_number VARCHAR(20);
BEGIN
    -- Get the next ticket number
    SELECT COALESCE(MAX(CAST(SUBSTRING(ticket_number FROM 8) AS INTEGER)), 0) + 1
    INTO next_number
    FROM tickets
    WHERE ticket_number LIKE 'TICKET-%';
    
    -- Format as TICKET-001, TICKET-002, etc.
    new_ticket_number := 'TICKET-' || LPAD(next_number::TEXT, 3, '0');
    
    NEW.ticket_number := new_ticket_number;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to generate tracking tokens
CREATE OR REPLACE FUNCTION generate_tracking_token()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO ticket_tracking_tokens (ticket_id, tracking_token)
    VALUES (NEW.id, encode(gen_random_bytes(16), 'hex'));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to add ticket to embeddings queue
CREATE OR REPLACE FUNCTION queue_ticket_for_processing()
RETURNS TRIGGER AS $$
BEGIN
    -- Add to embeddings queue for processing
    PERFORM pgmq.send(
        'embeddings_queue',
        jsonb_build_object(
            'ticket_id', NEW.id,
            'ticket_number', NEW.ticket_number,
            'subject', NEW.subject,
            'description', NEW.description,
            'content', NEW.subject || E'\n\n' || NEW.description,
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar tickets using vector similarity
CREATE OR REPLACE FUNCTION match_tickets(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  ticket_id uuid,
  subject text,
  description text,
  resolution text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id AS ticket_id,
    t.subject,
    t.description,
    -- Get the latest resolution from responses
    (
      SELECT tr.content
      FROM ticket_responses tr
      WHERE tr.ticket_id = t.id 
        AND tr.response_type = 'support'
        AND t.status = 'resolved'
      ORDER BY tr.created_at DESC
      LIMIT 1
    ) AS resolution,
    (te.embedding <=> query_embedding) * -1 + 1 AS similarity
  FROM ticket_embeddings te
  JOIN tickets t ON te.ticket_id = t.id
  WHERE te.embedding <=> query_embedding < 1 - match_threshold
    AND t.status IN ('resolved', 'closed')
  ORDER BY te.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Production-optimized RPC function to process embeddings
-- Only calls edge function if queue has jobs
CREATE OR REPLACE FUNCTION process_embeddings()
RETURNS JSONB AS $$
DECLARE
    queue_length INTEGER;
    result JSONB;
    function_url TEXT;
    auth_header TEXT;
BEGIN
    -- Check if there are any jobs in the embeddings queue
    SELECT pgmq.queue_length('embeddings_queue') INTO queue_length;
    
    -- Early return if no jobs - saves resources
    IF queue_length = 0 THEN
        RETURN jsonb_build_object(
            'status', 'no_jobs',
            'message', 'No jobs in embeddings queue',
            'queue_length', 0,
            'timestamp', extract(epoch from now())
        );
    END IF;
    
    -- Get secrets from vault
    function_url := vault.decrypt_secret('supabase_url') || '/functions/v1/process-embeddings';
    auth_header := 'Bearer ' || vault.decrypt_secret('service_role_key');
    
    -- Call edge function only if jobs exist
    SELECT net.http_post(
        url := function_url,
        headers := jsonb_build_object(
            'Authorization', auth_header,
            'Content-Type', 'application/json',
            'User-Agent', 'pg_cron/1.0'
        ),
        body := jsonb_build_object(
            'trigger', 'cron',
            'queue_length', queue_length,
            'timestamp', extract(epoch from now())
        ),
        timeout_milliseconds := 30000
    ) INTO result;
    
    RETURN jsonb_build_object(
        'status', 'processed',
        'queue_length', queue_length,
        'edge_function_result', result,
        'timestamp', extract(epoch from now())
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log error and return failure status
        RETURN jsonb_build_object(
            'status', 'error',
            'message', SQLERRM,
            'queue_length', queue_length,
            'timestamp', extract(epoch from now())
        );
END;
$$ LANGUAGE plpgsql;

-- Production-optimized RPC function to process classification
-- Only calls edge function if queue has jobs
CREATE OR REPLACE FUNCTION process_classification()
RETURNS JSONB AS $$
DECLARE
    queue_length INTEGER;
    result JSONB;
    function_url TEXT;
    auth_header TEXT;
BEGIN
    -- Check if there are any jobs in the classification queue
    SELECT pgmq.queue_length('classification_queue') INTO queue_length;
    
    -- Early return if no jobs - saves resources
    IF queue_length = 0 THEN
        RETURN jsonb_build_object(
            'status', 'no_jobs',
            'message', 'No jobs in classification queue',
            'queue_length', 0,
            'timestamp', extract(epoch from now())
        );
    END IF;
    
    -- Get secrets from vault
    function_url := vault.decrypt_secret('supabase_url') || '/functions/v1/process-classification';
    auth_header := 'Bearer ' || vault.decrypt_secret('service_role_key');
    
    -- Call edge function only if jobs exist
    SELECT net.http_post(
        url := function_url,
        headers := jsonb_build_object(
            'Authorization', auth_header,
            'Content-Type', 'application/json',
            'User-Agent', 'pg_cron/1.0'
        ),
        body := jsonb_build_object(
            'trigger', 'cron',
            'queue_length', queue_length,
            'timestamp', extract(epoch from now())
        ),
        timeout_milliseconds := 60000
    ) INTO result;
    
    RETURN jsonb_build_object(
        'status', 'processed',
        'queue_length', queue_length,
        'edge_function_result', result,
        'timestamp', extract(epoch from now())
    );
    
EXCEPTION
    WHEN OTHERS THEN
        -- Log error and return failure status
        RETURN jsonb_build_object(
            'status', 'error',
            'message', SQLERRM,
            'queue_length', queue_length,
            'timestamp', extract(epoch from now())
        );
END;
$$ LANGUAGE plpgsql;

-- ================================================
-- 7. CREATE TRIGGERS
-- ================================================
CREATE TRIGGER trigger_generate_ticket_number
    BEFORE INSERT ON tickets
    FOR EACH ROW
    WHEN (NEW.ticket_number IS NULL)
    EXECUTE FUNCTION generate_ticket_number();

CREATE TRIGGER trigger_generate_tracking_token
    AFTER INSERT ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION generate_tracking_token();

CREATE TRIGGER trigger_queue_ticket_processing
    AFTER INSERT ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION queue_ticket_for_processing();

CREATE TRIGGER trigger_update_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ================================================
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (support staff) to see all tickets
CREATE POLICY "Support staff can access all tickets" ON tickets
    FOR ALL USING (auth.role() = 'authenticated');

-- Allow support staff to manage responses
CREATE POLICY "Support staff can manage responses" ON ticket_responses
    FOR ALL USING (auth.role() = 'authenticated');

-- Allow support staff to view AI responses
CREATE POLICY "Support staff can view AI responses" ON ai_responses
    FOR SELECT USING (auth.role() = 'authenticated');

-- ================================================
-- 9. SCHEDULE CRON JOBS
-- ================================================
-- Schedule embeddings processing job (every 5 seconds)
-- Only calls edge function if queue has jobs
SELECT cron.schedule(
    'process-embeddings-job',
    '*/5 * * * * *',
    'SELECT process_embeddings();'
);

-- Schedule classification processing job (every 8 seconds, offset by 3 seconds)  
-- Only calls edge function if queue has jobs
SELECT cron.schedule(
    'process-classification-job',
    '3-59/8 * * * * *',
    'SELECT process_classification();'
);

-- ================================================
-- 10. GRANT PERMISSIONS
-- ================================================
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;

-- ================================================
-- SETUP COMPLETE! 
-- ================================================
-- Next steps:
-- 1. Add secrets to Supabase vault:
--    - supabase_url: https://your-project-ref.supabase.co
--    - service_role_key: your-service-role-key
-- 2. Deploy your edge functions (process-embeddings and process-classification)
-- 3. Add your OpenAI API key to Supabase project secrets
-- 4. Test the system by creating a ticket

-- Monitor with these queries:
-- SELECT * FROM cron.job; -- View scheduled jobs
-- SELECT pgmq.queue_length('embeddings_queue'); -- Check embeddings queue
-- SELECT pgmq.queue_length('classification_queue'); -- Check classification queue
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10; -- Recent executions