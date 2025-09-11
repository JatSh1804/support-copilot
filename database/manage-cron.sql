-- Quick management commands for pg_cron jobs

-- 1. VIEW ALL SCHEDULED JOBS
SELECT * FROM active_cron_jobs;

-- 2. CHECK JOB STATUS AND EXECUTION HISTORY
SELECT * FROM get_cron_job_status();

-- 3. VIEW RECENT JOB EXECUTIONS (if logging is enabled)
SELECT 
    runid, 
    jobid, 
    start_time, 
    end_time,
    succeeded,
    return_message
FROM cron.job_run_details 
WHERE start_time > NOW() - INTERVAL '1 hour'
ORDER BY start_time DESC;

-- 4. MANUALLY TRIGGER JOBS FOR TESTING
-- Test embeddings processing
SELECT trigger_manual_processing('embeddings');

-- Test classification processing  
SELECT trigger_manual_processing('classification');

-- 5. UPDATE CONFIGURATION (replace with your actual values)
-- Update Supabase URL
INSERT INTO cron_config (key, value) 
VALUES ('supabase_url', 'https://your-actual-project-ref.supabase.co')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Update service role key
INSERT INTO cron_config (key, value) 
VALUES ('service_role_key', 'your-actual-service-role-key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 6. PAUSE/RESUME JOBS
-- Pause embeddings job
SELECT cron.alter_job('process-embeddings-job', schedule := NULL, active := false);

-- Resume embeddings job
SELECT cron.alter_job('process-embeddings-job', schedule := '*/5 * * * * *', active := true);

-- Pause classification job
SELECT cron.alter_job('process-classification-job', schedule := NULL, active := false);

-- Resume classification job  
SELECT cron.alter_job('process-classification-job', schedule := '3-59/8 * * * * *', active := true);

-- 7. REMOVE JOBS (if needed)
-- SELECT cron.unschedule('process-embeddings-job');
-- SELECT cron.unschedule('process-classification-job');

-- 8. RECREATE JOBS WITH NEW SCHEDULE
-- Uncomment and modify as needed:

/*
-- Remove existing jobs
SELECT cron.unschedule('process-embeddings-job');
SELECT cron.unschedule('process-classification-job');

-- Create new jobs with updated schedule
SELECT cron.schedule(
    'process-embeddings-job',
    '*/3 * * * * *', -- Every 3 seconds instead of 5
    $$
    SELECT net.http_post(
        url := get_config('supabase_url') || '/functions/v1/process-embeddings',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || get_config('service_role_key'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('trigger', 'cron')
    );
    $$
);
*/

-- 9. MONITOR QUEUE SIZES
-- Check embeddings queue
SELECT pgmq.queue_length('embeddings_queue') as embeddings_queue_length;

-- Check classification queue
SELECT pgmq.queue_length('classification_queue') as classification_queue_length;

-- 10. VIEW QUEUE MESSAGES (for debugging)
-- Peek at embeddings queue (doesn't remove messages)
SELECT * FROM pgmq.read('embeddings_queue', 5);

-- Peek at classification queue
SELECT * FROM pgmq.read('classification_queue', 5);