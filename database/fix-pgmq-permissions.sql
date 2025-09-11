-- ================================================
-- FIX PGMQ PERMISSIONS
-- ================================================
-- Run this to fix the "permission denied for schema pgmq" error

-- Grant necessary permissions for PGMQ
GRANT USAGE ON SCHEMA pgmq TO postgres;
GRANT USAGE ON SCHEMA pgmq TO service_role;
GRANT USAGE ON SCHEMA pgmq TO anon;
GRANT USAGE ON SCHEMA pgmq TO authenticated;

-- Grant execute permissions on PGMQ functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO postgres;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO anon;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgmq TO authenticated;

-- Grant permissions on PGMQ tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO postgres;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO anon;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgmq TO authenticated;

-- Grant permissions on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pgmq TO postgres;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pgmq TO anon;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pgmq TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA pgmq TO service_role;

-- Ensure the queues exist and have proper permissions
SELECT pgmq.create('embeddings_queue');
SELECT pgmq.create('classification_queue');

-- Verify permissions work
SELECT pgmq.queue_length('embeddings_queue');
SELECT pgmq.queue_length('classification_queue');