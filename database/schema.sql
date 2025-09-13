-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Create enum types
CREATE TYPE ticket_status AS ENUM ('pending', 'processing', 'classified', 'in-progress', 'resolved', 'closed');
CREATE TYPE response_type AS ENUM ('customer', 'support', 'system');
CREATE TYPE priority_level AS ENUM ('P0', 'P1', 'P2');
CREATE TYPE sentiment_type AS ENUM ('Frustrated', 'Angry', 'Curious', 'Neutral', 'Happy');

-- Create PGMQ queues
SELECT pgmq.create('embeddings_queue');
SELECT pgmq.create('classification_queue');

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

-- Create indexes
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_ticket_number ON tickets(ticket_number);
CREATE INDEX idx_tickets_email ON tickets(email);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);
CREATE INDEX idx_tickets_classification_status ON tickets(status, classification_completed_at);

-- Ticket embeddings storage with pgvector
CREATE TABLE ticket_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    content_type VARCHAR(50) NOT NULL, -- 'subject', 'description', 'combined'
    embedding vector(1536), -- OpenAI ada-002 embeddings are 1536 dimensions
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(ticket_id, content_type)
);

-- Create vector index for similarity search
CREATE INDEX idx_ticket_embeddings_vector ON ticket_embeddings USING ivfflat (embedding vector_cosine_ops);

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

-- Create indexes for responses
CREATE INDEX idx_responses_ticket ON ticket_responses(ticket_id);
CREATE INDEX idx_responses_created ON ticket_responses(created_at);
CREATE INDEX idx_responses_type ON ticket_responses(response_type);

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

-- Create index for AI responses
CREATE INDEX idx_ai_responses_ticket ON ai_responses(ticket_id);

-- Customer tracking tokens (for customers to check status without auth)
CREATE TABLE ticket_tracking_tokens (
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    tracking_token VARCHAR(32) UNIQUE NOT NULL, -- Random token for customer access
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (ticket_id)
);

-- Create index for tracking tokens
CREATE INDEX idx_tracking_token ON ticket_tracking_tokens(tracking_token);

-- Table to store embeddings for prefilled classification fields (topic tags, sentiment, priority)
CREATE TABLE prefilled_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL, -- 'topic', 'sentiment', 'priority'
    value TEXT NOT NULL, -- e.g. 'Connector', 'Frustrated', 'P0'
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(type, value)
);

-- Create index for fast lookup
CREATE INDEX idx_prefilled_embeddings_type_value ON prefilled_embeddings(type, value);

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

-- Function to find similar tickets using vector similarity (accepts input_ticket_id)
CREATE OR REPLACE FUNCTION match_tickets(
  input_ticket_id uuid,
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
DECLARE
  query_embedding vector(1536);
BEGIN
  -- Get embedding for the given ticket_id
  SELECT te.embedding INTO query_embedding
  FROM ticket_embeddings te
  WHERE te.ticket_id = input_ticket_id AND te.content_type = 'combined'
  LIMIT 1;

  IF query_embedding IS NULL THEN
    RAISE EXCEPTION 'No embedding found for ticket %', input_ticket_id;
  END IF;

  RETURN QUERY
  SELECT
    t.id AS ticket_id,
    t.subject::text,
    t.description::text,
    (
      SELECT tr.content::text
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
    AND t.id <> input_ticket_id -- Exclude the current ticket itself
  ORDER BY te.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function: classify_ticket_by_embedding
CREATE OR REPLACE FUNCTION classify_ticket_by_embedding(
  input_ticket_id uuid
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  ticket_emb vector(1536);
  topic_matches TEXT[];
  sentiment_match TEXT;
  priority_match TEXT;
  topic_scores JSONB := '[]'::jsonb;
  sentiment_scores JSONB := '[]'::jsonb;
  priority_scores JSONB := '[]'::jsonb;
  confidence FLOAT := NULL;
BEGIN
  -- Get ticket embedding
  SELECT embedding INTO ticket_emb
  FROM ticket_embeddings
  WHERE ticket_id = input_ticket_id AND content_type = 'combined'
  LIMIT 1;

  IF ticket_emb IS NULL THEN
    RAISE EXCEPTION 'No embedding found for ticket %', input_ticket_id;
  END IF;

  -- Topic tags: get top 3 by similarity
  topic_matches := ARRAY(
    SELECT value
    FROM prefilled_embeddings
    WHERE type = 'topic'
    ORDER BY (embedding <=> ticket_emb)
    LIMIT 3
  );
  topic_scores := (
    SELECT jsonb_agg(jsonb_build_object('value', value, 'score', 1 - (embedding <=> ticket_emb)))
    FROM (
      SELECT value, embedding
      FROM prefilled_embeddings
      WHERE type = 'topic'
      ORDER BY (embedding <=> ticket_emb)
      LIMIT 3
    ) sub
  );

  -- Sentiment: get top 1 by similarity
  sentiment_match := (
    SELECT value
    FROM prefilled_embeddings
    WHERE type = 'sentiment'
    ORDER BY (embedding <=> ticket_emb)
    LIMIT 1
  );
  sentiment_scores := (
    SELECT jsonb_agg(jsonb_build_object('value', value, 'score', 1 - (embedding <=> ticket_emb)))
    FROM (
      SELECT value, embedding
      FROM prefilled_embeddings
      WHERE type = 'sentiment'
      ORDER BY (embedding <=> ticket_emb)
      LIMIT 1
    ) sub
  );

  -- Priority: get top 1 by similarity
  priority_match := (
    SELECT value
    FROM prefilled_embeddings
    WHERE type = 'priority'
    ORDER BY (embedding <=> ticket_emb)
    LIMIT 1
  );
  priority_scores := (
    SELECT jsonb_agg(jsonb_build_object('value', value, 'score', 1 - (embedding <=> ticket_emb)))
    FROM (
      SELECT value, embedding
      FROM prefilled_embeddings
      WHERE type = 'priority'
      ORDER BY (embedding <=> ticket_emb)
      LIMIT 1
    ) sub
  );

  -- Set confidence to the highest topic score (fix aggregate error)
  SELECT score INTO confidence
  FROM (
    SELECT 1 - (embedding <=> ticket_emb) AS score
    FROM prefilled_embeddings
    WHERE type = 'topic'
    ORDER BY score DESC
    LIMIT 1
  ) sub;

  RETURN jsonb_build_object(
    'topic_tags', topic_matches,
    'sentiment', sentiment_match,
    'priority', priority_match,
    'scores', jsonb_build_object(
      'topics', topic_scores,
      'sentiment', sentiment_scores,
      'priority', priority_scores,
      'confidence', confidence
    )
  );
END;
$$;

-- Table to store similar tickets for each ticket (for reference and UI rendering)
CREATE TABLE ticket_similarities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    similar_ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    similarity_score DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ticket_similarities_ticket_id ON ticket_similarities(ticket_id);
CREATE INDEX idx_ticket_similarities_similar_ticket_id ON ticket_similarities(similar_ticket_id);

-- Table to store Atlan developer documentation embeddings and metadata
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    tags TEXT[],
    last_scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_documents_url ON documents(url);

-- RPC to find top N documentation chunks by embedding similarity (accepts ticket_id)
CREATE OR REPLACE FUNCTION match_documents(
  ticket_id uuid,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  title text,
  url text,
  chunk_content text,
  section_heading text,
  snippet text,
  similarity float
)
LANGUAGE plpgsql
AS $$
DECLARE
  query_embedding vector(1536);
BEGIN
  -- Get embedding for the given ticket_id
  SELECT te.embedding INTO query_embedding
  FROM ticket_embeddings te
  WHERE te.ticket_id = match_documents.ticket_id AND te.content_type = 'combined'
  LIMIT 1;

  IF query_embedding IS NULL THEN
    RAISE EXCEPTION 'No embedding found for ticket %', ticket_id;
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    d.title,
    d.url,
    dc.chunk_content,
    dc.section_heading,
    LEFT(dc.chunk_content, 120) AS snippet,
    (dc.embedding <=> query_embedding) * -1 + 1 AS similarity
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE dc.embedding IS NOT NULL
  ORDER BY (dc.embedding <=> query_embedding)
  LIMIT match_count;
END;
$$;

-- Triggers
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

-- RLS Policies (Row Level Security)
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

-- Schedule cron jobs for processing queues
-- Process embeddings every 5 seconds
SELECT cron.schedule(
    'process-embeddings-job',
    '*/5 * * * * *', -- Every 5 seconds
    $$
    SELECT net.http_post(
        url := 'https://your-project-ref.supabase.co/functions/v1/process-embeddings',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('trigger', 'cron')
    );
    $$
);

-- Process classification every 10 seconds (offset to avoid conflicts)
SELECT cron.schedule(
    'process-classification-job', 
    '5-59/10 * * * * *', -- Every 10 seconds, starting at 5 seconds
    $$
    SELECT net.http_post(
        url := 'https://your-project-ref.supabase.co/functions/v1/process-classification',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('trigger', 'cron')
    );
    $$
);

-- Optional: View scheduled jobs
-- SELECT * FROM cron.job;

-- Optional: Remove jobs (run if you need to update the schedule)
-- SELECT cron.unschedule('process-embeddings-job');
-- SELECT cron.unschedule('process-classification-job');