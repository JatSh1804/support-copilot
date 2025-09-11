-- ================================================
-- PRODUCTION-STYLE RPC FUNCTIONS USING PGMQ.READ()
-- ================================================
-- Following the same pattern as your production system with batching

-- Utility function to get project URL from vault
CREATE OR REPLACE FUNCTION get_project_url()
RETURNS TEXT AS $$
DECLARE
    secret_value TEXT;
BEGIN

 select decrypted_secret into secret_value from vault.decrypted_secrets where name = 'project_url';
  return secret_value;
    -- Retrieve the project URL from Vault
    SELECT decrypted_secret INTO secret_value 
    FROM vault.decrypted_secrets 
    WHERE name = 'supabase_url';
    RETURN secret_value;
END;
$$ LANGUAGE plpgsql;



declare
  headers_raw text;
  auth_header text;
begin
  -- If we're in a PostgREST session, reuse the request headers for authorization
  headers_raw := current_setting('request.headers', true);
  -- Only try to parse if headers are present
  auth_header := case
    when headers_raw is not null then
      (headers_raw::json->>'authorization')
    else
      null
  end;
  -- Perform async HTTP request to the edge function
  perform net.http_post(
    url => utils.project_url() || '/functions/v1/' || name,
    headers => jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', auth_header
    ),
    body => body,
    timeout_milliseconds => timeout_milliseconds
  );
end;

-- Utility function to invoke edge functions
CREATE OR REPLACE FUNCTION invoke_edge_function(
    function_name TEXT,
    request_body JSONB,
    timeout_ms INTEGER DEFAULT 30000
)
RETURNS JSONB AS $$
DECLARE
    headers_raw TEXT;
    auth_header TEXT;
    result JSONB;
BEGIN
      -- Get authorization header from vault
      -- If we're in a PostgREST session, reuse the request headers for authorization
    headers_raw := current_setting('request.headers', true);
    -- Only try to parse if headers are present
    auth_header := case
      when headers_raw is not null then
        (headers_raw::json->>'authorization')
      else
        null
    end;
  -- Perform async HTTP request to the edge function
    -- Perform async HTTP request to the edge function
    SELECT net.http_post(
        url := get_project_url() || '/functions/v1/' || function_name,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', auth_header,
            'User-Agent', 'pg_cron/batch-processor/1.0'
        ),
        body := request_body,
        timeout_milliseconds := timeout_ms
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Production-style process_embeddings function with batching
CREATE OR REPLACE FUNCTION process_embeddings(
    batch_size INTEGER DEFAULT 5,
    max_requests INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 30000
)
RETURNS JSONB AS $$
DECLARE
    job_batches JSONB[];
    batch JSONB;
    jobs_processed INTEGER := 0;
    start_time TIMESTAMP;
BEGIN
    start_time := NOW();
    
    RAISE LOG 'process_embeddings() started - batch_size: %, max_requests: %', batch_size, max_requests;
    
    -- Read jobs from embeddings queue and batch them
    WITH numbered_jobs AS (
        SELECT
            message || jsonb_build_object('jobId', msg_id) AS job_info,
            (row_number() OVER (ORDER BY enqueued_at) - 1) / batch_size AS batch_num
        FROM pgmq.read(
            queue_name := 'embeddings_queue',
            vt := timeout_ms / 1000,
            qty := max_requests * batch_size
        )
    ),
    batched_jobs AS (
        SELECT
            jsonb_agg(job_info) AS batch_array,
            batch_num
        FROM numbered_jobs
        GROUP BY batch_num
    )
    SELECT array_agg(batch_array)
    FROM batched_jobs
    INTO job_batches;
    
    -- If no jobs found, return early
    IF job_batches IS NULL OR array_length(job_batches, 1) = 0 THEN
        RAISE LOG 'No embeddings jobs found in queue';
        RETURN jsonb_build_object(
            'status', 'no_jobs',
            'message', 'No jobs in embeddings queue',
            'batches_processed', 0,
            'timestamp', extract(epoch from start_time),
            'execution_time_ms', EXTRACT(MILLISECONDS FROM (NOW() - start_time))
        );
    END IF;
    
    RAISE LOG 'Found % batches to process', array_length(job_batches, 1);
    
    -- Invoke the embeddings edge function for each batch
    FOREACH batch IN ARRAY job_batches LOOP
        BEGIN
            PERFORM invoke_edge_function(
                function_name := 'process-embeddings',
                request_body := batch,
                timeout_ms := timeout_ms
            );
            jobs_processed := jobs_processed + jsonb_array_length(batch);
            RAISE LOG 'Processed batch with % jobs', jsonb_array_length(batch);
        EXCEPTION WHEN OTHERS THEN
            RAISE LOG 'Error processing embeddings batch: %', SQLERRM;
        END;
    END LOOP;
    
    RETURN jsonb_build_object(
        'status', 'processed',
        'batches_processed', array_length(job_batches, 1),
        'jobs_processed', jobs_processed,
        'timestamp', extract(epoch from start_time),
        'execution_time_ms', EXTRACT(MILLISECONDS FROM (NOW() - start_time))
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Error in process_embeddings: %', SQLERRM;
    RETURN jsonb_build_object(
        'status', 'error',
        'message', SQLERRM,
        'timestamp', extract(epoch from start_time)
    );
END;
$$ LANGUAGE plpgsql;

-- Production-style process_classification function with batching
CREATE OR REPLACE FUNCTION process_classification(
    batch_size INTEGER DEFAULT 3,
    max_requests INTEGER DEFAULT 2,
    timeout_ms INTEGER DEFAULT 60000
)
RETURNS JSONB AS $$
DECLARE
    job_batches JSONB[];
    batch JSONB;
    jobs_processed INTEGER := 0;
    start_time TIMESTAMP;
BEGIN
    start_time := NOW();
    
    RAISE LOG 'process_classification() started - batch_size: %, max_requests: %', batch_size, max_requests;
    
    -- Read jobs from classification queue and batch them
    WITH numbered_jobs AS (
        SELECT
            message || jsonb_build_object('jobId', msg_id) AS job_info,
            (row_number() OVER (ORDER BY enqueued_at) - 1) / batch_size AS batch_num
        FROM pgmq.read(
            queue_name := 'classification_queue',
            vt := timeout_ms / 1000,
            qty := max_requests * batch_size
        )
    ),
    batched_jobs AS (
        SELECT
            jsonb_agg(job_info) AS batch_array,
            batch_num
        FROM numbered_jobs
        GROUP BY batch_num
    )
    SELECT array_agg(batch_array)
    FROM batched_jobs
    INTO job_batches;
    
    -- If no jobs found, return early
    IF job_batches IS NULL OR array_length(job_batches, 1) = 0 THEN
        RAISE LOG 'No classification jobs found in queue';
        RETURN jsonb_build_object(
            'status', 'no_jobs',
            'message', 'No jobs in classification queue',
            'batches_processed', 0,
            'timestamp', extract(epoch from start_time),
            'execution_time_ms', EXTRACT(MILLISECONDS FROM (NOW() - start_time))
        );
    END IF;
    
    RAISE LOG 'Found % batches to process', array_length(job_batches, 1);
    
    -- Invoke the classification edge function for each batch
    FOREACH batch IN ARRAY job_batches LOOP
        BEGIN
            PERFORM invoke_edge_function(
                function_name := 'process-classification',
                request_body := batch,
                timeout_ms := timeout_ms
            );
            jobs_processed := jobs_processed + jsonb_array_length(batch);
            RAISE LOG 'Processed batch with % jobs', jsonb_array_length(batch);
        EXCEPTION WHEN OTHERS THEN
            RAISE LOG 'Error processing classification batch: %', SQLERRM;
        END;
    END LOOP;
    
    RETURN jsonb_build_object(
        'status', 'processed',
        'batches_processed', array_length(job_batches, 1),
        'jobs_processed', jobs_processed,
        'timestamp', extract(epoch from start_time),
        'execution_time_ms', EXTRACT(MILLISECONDS FROM (NOW() - start_time))
    );
    
EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'Error in process_classification: %', SQLERRM;
    RETURN jsonb_build_object(
        'status', 'error',
        'message', SQLERRM,
        'timestamp', extract(epoch from start_time)
    );
END;
$$ LANGUAGE plpgsql;

-- Test the production-style functions
SELECT 'Testing production-style process_embeddings()' as test, process_embeddings() as result;
SELECT 'Testing production-style process_classification()' as test, process_classification() as result;