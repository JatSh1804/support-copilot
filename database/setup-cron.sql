-- Setup script for configuring pg_cron jobs
-- Run this after setting up your Supabase project

-- First, ensure pg_cron extension is enabled
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Set up configuration for your Supabase project
-- Replace these values with your actual Supabase project details
DO $$
DECLARE
    supabase_url TEXT := 'https://your-project-ref.supabase.co';
    service_role_key TEXT := 'your-service-role-key-here';
BEGIN
    -- Store configuration in a custom settings table for reuse
    CREATE TABLE IF NOT EXISTS cron_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    
    -- Insert or update configuration
    INSERT INTO cron_config (key, value) 
    VALUES 
        ('supabase_url', supabase_url),
        ('service_role_key', service_role_key)
    ON CONFLICT (key) 
    DO UPDATE SET 
        value = EXCLUDED.value,
        updated_at = NOW();
END $$;

-- Function to get config values
CREATE OR REPLACE FUNCTION get_config(config_key TEXT)
RETURNS TEXT AS $$
DECLARE
    config_value TEXT;
BEGIN
    SELECT value INTO config_value 
    FROM cron_config 
    WHERE key = config_key;
    
    RETURN config_value;
END;
$$ LANGUAGE plpgsql;

-- RPC function to process embeddings
CREATE OR REPLACE FUNCTION process_embeddings()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT net.http_post(
        url := get_config('supabase_url') || '/functions/v1/process-embeddings',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || get_config('service_role_key'),
            'Content-Type', 'application/json',
            'User-Agent', 'pg_cron/1.0'
        ),
        body := jsonb_build_object(
            'trigger', 'cron',
            'timestamp', extract(epoch from now())
        ),
        timeout_milliseconds := 30000
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- RPC function to process classification
CREATE OR REPLACE FUNCTION process_classification()
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT net.http_post(
        url := get_config('supabase_url') || '/functions/v1/process-classification',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || get_config('service_role_key'),
            'Content-Type', 'application/json',
            'User-Agent', 'pg_cron/1.0'
        ),
        body := jsonb_build_object(
            'trigger', 'cron',
            'timestamp', extract(epoch from now())
        ),
        timeout_milliseconds := 60000
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Schedule embeddings processing job (every 5 seconds)
SELECT cron.schedule(
    'process-embeddings-job',
    '*/5 * * * * *',
    'SELECT process_embeddings();'
);

-- Schedule classification processing job (every 8 seconds, offset by 3 seconds)
SELECT cron.schedule(
    'process-classification-job',
    '3-59/8 * * * * *',
    'SELECT process_classification();'
);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA cron TO postgres;