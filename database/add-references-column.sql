-- Add references column to ticket_responses table if it doesn't exist
ALTER TABLE ticket_responses
ADD COLUMN IF NOT EXISTS references JSONB;

-- Add index for better performance when querying references
CREATE INDEX IF NOT EXISTS idx_ticket_responses_references ON ticket_responses USING GIN (references);

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ticket_responses'
  AND column_name = 'references';
