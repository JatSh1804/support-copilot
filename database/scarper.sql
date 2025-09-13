CREATE TABLE documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  content_hash TEXT,
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Document chunks with embeddings
CREATE TABLE document_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  chunk_content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI embedding dimension
  chunk_index INTEGER,
  section_heading TEXT,
  source_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Create vector similarity index
CREATE INDEX ON document_chunks 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- RLS policies (optional for security)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- Helper function to get chunk content for embedding
CREATE OR REPLACE FUNCTION get_chunk_content(chunk_row document_chunks)
RETURNS TEXT AS $$
BEGIN
  -- Return chunk_content if present, else fetch from DB
  IF chunk_row.chunk_content IS NOT NULL AND LENGTH(TRIM(chunk_row.chunk_content)) > 0 THEN
    RETURN chunk_row.chunk_content;
  ELSE
    RETURN (
      SELECT chunk_content
      FROM document_chunks
      WHERE id = chunk_row.id
      LIMIT 1
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to enqueue embedding job for new document_chunks
CREATE OR REPLACE FUNCTION queue_chunk_for_embedding()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pgmq.send(
    'embeddings_queue',
    jsonb_build_object(
      'jobId', gen_random_uuid(),
      'id', NEW.id,
      'schema', 'public',
      'table', 'document_chunks',
      'contentFunction', 'get_chunk_content',
      'embeddingColumn', 'embedding'
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_queue_chunk_embedding
  AFTER INSERT ON document_chunks
  FOR EACH ROW
  EXECUTE FUNCTION queue_chunk_for_embedding();

-- Example: Test get_chunk_content function directly in SQL

-- Replace '2e8b7ee5-7934-4127-9e3a-44be4e573b14' with your actual chunk id
SELECT get_chunk_content(dc)
FROM document_chunks dc
WHERE dc.id = '2e8b7ee5-7934-4127-9e3a-44be4e573b14';

-- Or test with a constructed row:
SELECT get_chunk_content(ROW(
  '2e8b7ee5-7934-4127-9e3a-44be4e573b14', -- id
  NULL, -- document_id
  'Sample chunk content', -- chunk_content
  NULL, -- embedding
  NULL, -- chunk_index
  NULL, -- section_heading
  NULL, -- source_url
  NOW(), -- created_at
  '{}'::jsonb -- metadata
)::document_chunks);

-- Postpone last 1050 jobs in the embeddings_queue by updating their visible_at timestamp

-- Example: Set visible_at to 7 days in the future for last 1050 jobs (by msg_id descending)
UPDATE pgmq.embeddings_queue
SET visible_at = NOW() + INTERVAL '7 days'
WHERE msg_id IN (
  SELECT msg_id
  FROM pgmq.embeddings_queue
  ORDER BY msg_id DESC
  LIMIT 1050
);

-- Now only the first 50 jobs will be visible for processing.