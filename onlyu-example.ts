// project_url()
declare
  secret_value text;
begin
  -- Retrieve the project URL from Vault
  select decrypted_secret into secret_value from vault.decrypted_secrets where name = 'project_url';
  return secret_value;
end;



// invoke_edge_function() 
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




// process_embedings() function
  declare
    job_batches jsonb[];
    batch jsonb;
  begin
    with
      -- First get jobs and assign batch numbers
      numbered_jobs as (
        select
          message || jsonb_build_object('jobId', msg_id) as job_info,
          (row_number() over (order by 1) - 1) / batch_size as batch_num
        from pgmq.read(
          queue_name => 'embedding_jobs',
          vt => timeout_milliseconds / 1000,
          qty => max_requests * batch_size
        )
      ),
      -- Then group jobs into batches
      batched_jobs as (
        select
          jsonb_agg(job_info) as batch_array,
          batch_num
        from numbered_jobs
        group by batch_num
      )
    -- Finally aggregate all batches into array
    select array_agg(batch_array)
    from batched_jobs
    into job_batches;
  
    -- Invoke the embed edge function for each batch
    foreach batch in array job_batches loop
      perform utils.invoke_edge_function(
        name => 'embed',
        body => batch,
        timeout_milliseconds => timeout_milliseconds
      );
    end loop;
  end;
  







// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { z } from 'npm:zod';
// We'll make a direct Postgres connection to update the document
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
// Schema for job validation - updated to handle string IDs
const jobSchema = z.object({
  jobId: z.number(),
  id: z.union([
    z.string(),
    z.number()
  ]),
  schema: z.string(),
  table: z.string(),
  contentFunction: z.string(),
  embeddingColumn: z.string()
});
const failedJobSchema = jobSchema.extend({
  error: z.string()
});
const QUEUE_NAME = 'embedding_jobs';
// Default embedding model
const EMBEDDINGS_MODEL = 'nomic-ai/nomic-embed-text-v1';
// Default provider to use
const DEFAULT_PROVIDER = Deno.env.get('DEFAULT_EMBEDDING_PROVIDER') || 'fireworks';
// Configuration for embedding providers
const PROVIDERS = [
  {
    name: 'fireworks',
    baseURL: 'https://api.fireworks.ai/inference/v1/',
    apiKey: Deno.env.get('FIREWORKS_API_KEY') || ''
  },
  {
    name: 'together',
    baseURL: 'https://api.together.xyz/v1/',
    apiKey: Deno.env.get('TOGETHER_API_KEY') || ''
  }
];
// Initialize Postgres client
const sql = postgres(Deno.env.get('SUPABASE_DB_URL'));
// Listen for HTTP requests
Deno.serve(async (req)=>{
  if (req.method !== 'POST') {
    return new Response('expected POST request', {
      status: 405
    });
  }
  if (req.headers.get('content-type') !== 'application/json') {
    return new Response('expected json body', {
      status: 400
    });
  }
  let requestBody;
  try {
    requestBody = await req.json();
    console.log("Received request body:", JSON.stringify(requestBody));
  } catch (error) {
    console.error("Error parsing request body:", error);
    return new Response(`Invalid JSON in request body: ${error.message}`, {
      status: 400
    });
  }
  // Use Zod to parse and validate the request body
  const parseResult = z.array(jobSchema).safeParse(requestBody);
  if (parseResult.error) {
    console.error("Validation error:", parseResult.error.message);
    return new Response(`invalid request body: ${parseResult.error.message}`, {
      status: 400
    });
  }
  const pendingJobs = parseResult.data;
  // Track jobs that completed successfully
  const completedJobs = [];
  // Track jobs that failed due to an error
  const failedJobs = [];
  async function processJobs() {
    let currentJob;
    while((currentJob = pendingJobs.shift()) !== undefined){
      try {
        await processJob(currentJob);
        completedJobs.push(currentJob);
      } catch (error) {
        console.error(`Job failed:`, error);
        failedJobs.push({
          ...currentJob,
          error: error instanceof Error ? error.message : JSON.stringify(error)
        });
      }
    }
  }
  try {
    // Process jobs while listening for worker termination
    await Promise.race([
      processJobs(),
      catchUnload()
    ]);
  } catch (error) {
    // If the worker is terminating (e.g. wall clock limit reached),
    // add pending jobs to fail list with termination reason
    failedJobs.push(...pendingJobs.map((job)=>({
        ...job,
        error: error instanceof Error ? error.message : JSON.stringify(error)
      })));
  }
  // Log completed and failed jobs for traceability
  console.log('finished processing jobs:', {
    completedJobs: completedJobs.length,
    failedJobs: failedJobs.length
  });
  return new Response(JSON.stringify({
    completedJobs,
    failedJobs
  }), {
    // 200 OK response
    status: 200,
    // Custom headers to report job status
    headers: {
      'content-type': 'application/json',
      'x-completed-jobs': completedJobs.length.toString(),
      'x-failed-jobs': failedJobs.length.toString()
    }
  });
});
/**
 * Generates embeddings directly using provider APIs
 */ async function generateEmbedding(text) {
  console.log(`Generating embedding with ${DEFAULT_PROVIDER} provider`);
  // Find the selected provider
  const provider = PROVIDERS.find((p)=>p.name === DEFAULT_PROVIDER) || PROVIDERS[0];
  // Validate provider configuration
  if (!provider.apiKey) {
    throw new Error(`API key for ${provider.name} is not configured`);
  }
  try {
    const endpointUrl = provider.baseURL + "embeddings";
    const requestData = {
      input: text,
      model: EMBEDDINGS_MODEL
    };
    const jsonData = JSON.stringify(requestData);
    const contentLength = new TextEncoder().encode(jsonData).length;
    console.log(`Requesting embeddings from ${provider.name}`);
    const requestOptions = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": contentLength.toString()
      },
      body: jsonData
    };
    const res = await fetch(endpointUrl, requestOptions);
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`HTTP error! status: ${res.status}, response: ${errorText}`);
    }
    const resData = await res.json();
    console.log(`API response structure: ${Object.keys(resData).join(', ')}`);
    // Handle different response formats from providers
    let embedding;
    if (resData.data && Array.isArray(resData.data) && resData.data.length > 0) {
      // Standard OpenAI-compatible format
      embedding = resData.data[0].embedding;
      console.log(`Successfully generated embedding with ${embedding.length} dimensions`);
    } else if (resData.embeddings && Array.isArray(resData.embeddings)) {
      // Alternative format 
      embedding = resData.embeddings;
      console.log(`Successfully generated embedding with ${embedding.length} dimensions (alternative format)`);
    } else {
      console.error('Unexpected response structure:', JSON.stringify(resData).substring(0, 100));
      throw new Error("Could not find embedding in provider response");
    }
    return embedding;
  } catch (error) {
    console.error(`Error getting embeddings from ${provider.name}: ${error.message}`);
    // If the configured provider fails, try the fallback provider
    if (provider.name !== PROVIDERS[1].name && PROVIDERS[1].apiKey) {
      console.log(`Falling back to ${PROVIDERS[1].name} provider`);
      try {
        const fallbackProvider = PROVIDERS[1];
        const endpointUrl = fallbackProvider.baseURL + "embeddings";
        const requestData = {
          input: text,
          model: EMBEDDINGS_MODEL
        };
        const jsonData = JSON.stringify(requestData);
        const contentLength = new TextEncoder().encode(jsonData).length;
        const requestOptions = {
          method: "POST",
          headers: {
            Authorization: `Bearer ${fallbackProvider.apiKey}`,
            "Content-Type": "application/json",
            "Content-Length": contentLength.toString()
          },
          body: jsonData
        };
        const res = await fetch(endpointUrl, requestOptions);
        if (!res.ok) {
          throw new Error(`HTTP error in fallback! status: ${res.status}`);
        }
        const resData = await res.json();
        // Handle different response formats from providers
        if (resData.data && resData.data.length > 0) {
          console.log(`Successfully generated embedding with fallback provider`);
          return resData.data[0].embedding;
        } else if (resData.embeddings && Array.isArray(resData.embeddings)) {
          console.log(`Successfully generated embedding with fallback provider (alternative format)`);
          return resData.embeddings;
        }
      } catch (fallbackError) {
        console.error(`Fallback provider failed: ${fallbackError.message}`);
      }
    }
    throw new Error(`Failed to generate embeddings: ${error.message}`);
  }
}
/**
 * Processes an embedding job.
 */ async function processJob(job) {
  const { jobId, id, schema, table, contentFunction, embeddingColumn } = job;
  console.log(`Processing job: ${jobId} for ${schema}.${table}/${id}`);
  // Try to fetch content for the schema/table/row combination
  let row;
  try {
    // Use the content function specific to the table
    const result = await sql`
      select
        id,
        ${sql(contentFunction)}(t) as content
      from
        ${sql(schema)}.${sql(table)} t
      where
        id = ${id}
    `;
    if (result && result.length > 0) {
      row = result[0];
    } else {
      console.log(`No row found for ${schema}.${table}/${id}`);
      throw new Error(`row not found: ${schema}.${table}/${id}`);
    }
  } catch (error) {
    console.error(`SQL error fetching content: ${error.message}`);
    throw new Error(`Error fetching content: ${error.message}`);
  }
  // Tables have different structures - debugging info
  console.log(`Processing content from ${table} table`);
  // Check content validity - MODIFIED to handle empty strings
  if (row.content === null || row.content === undefined || typeof row.content === 'string' && row.content.trim() === '') {
    // Log the detection of empty content
    console.warn(`Empty content detected for ${schema}.${table}/${id}, marking job as complete`);
    // Just remove the job from the queue without generating an embedding
    try {
      await sql`
        select pgmq.delete(${QUEUE_NAME}, ${jobId}::bigint)
      `;
      console.log(`Empty content job marked as complete: ${jobId}`);
      return; // Exit function early
    } catch (deleteError) {
      console.error(`Error removing job from queue: ${deleteError.message}`);
      throw new Error(`Error removing job from queue: ${deleteError.message}`);
    }
  }
  // Rest of the function remains the same for non-empty content
  console.log(`Content type: ${typeof row.content}, content length: ${typeof row.content === 'string' ? row.content.length : 'n/a'}`);
  console.log(`Text used for embeddings: ${row.content.slice(0, 20)}`);
  // Convert content to string as needed
  let processedContent;
  if (typeof row.content === 'string') {
    processedContent = row.content;
  } else {
    console.warn(`Unexpected content type for ${table}: ${typeof row.content}`);
    try {
      if (typeof row.content === 'object') {
        processedContent = JSON.stringify(row.content);
      } else {
        processedContent = String(row.content);
      }
    } catch (err) {
      throw new Error(`Failed to convert content to string: ${err}`);
    }
  }
  if (!processedContent || processedContent.trim() === '') {
    // Extra check to catch any empty strings that might have slipped through
    console.log(`Empty processed content detected, marking job as complete`);
    try {
      await sql`
        select pgmq.delete(${QUEUE_NAME}, ${jobId}::bigint)
      `;
      console.log(`Empty content job marked as complete: ${jobId}`);
      return;
    } catch (deleteError) {
      console.error(`Error removing job from queue: ${deleteError.message}`);
      throw new Error(`Error removing job from queue: ${deleteError.message}`);
    }
  }
  console.log(`Generating embedding for content, length: ${processedContent.length}`);
  const embedding = await generateEmbedding(processedContent);
  console.log(`Generated embedding with ${embedding.length} dimensions`);
  try {
    // Update the table with the embedding
    await sql`
      update
        ${sql(schema)}.${sql(table)}
      set
        ${sql(embeddingColumn)} = ${JSON.stringify(embedding)}
      where
        id = ${id}
    `;
    await sql`
      select pgmq.delete(${QUEUE_NAME}, ${jobId}::bigint)
    `;
    console.log(`Job completed: ${jobId}`);
  } catch (updateError) {
    console.error(`Error updating database: ${updateError.message}`);
    throw new Error(`Error updating database: ${updateError.message}`);
  }
}
/**
 * Returns a promise that rejects if the worker is terminating.
 */ function catchUnload() {
  return new Promise((reject)=>{
    addEventListener('beforeunload', (ev)=>{
      reject(new Error(ev.detail?.reason));
    });
  });
}
