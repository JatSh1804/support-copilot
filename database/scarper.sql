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
  RETURN chunk_row.chunk_content;
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