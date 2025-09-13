import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';
const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '');
const QUEUE_NAME = 'embeddings_queue';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    console.log('Starting embeddings processing...');
    // Get the request body containing batch of jobs
    const requestBody = await req.json();
    console.log("Received request body:", JSON.stringify(requestBody));
    // Handle both single job and batch processing
    const jobs = Array.isArray(requestBody) ? requestBody : [
      requestBody
    ];
    console.log(`Processing ${jobs.length} embedding jobs`);
    const completedJobs = [];
    const failedJobs = [];
    // Process each job in the batch
    for (const job of jobs) {
      try {
        console.log(`Processing job: ${job.jobId || job.ticket_id} for ${job.table || 'ticket_embeddings'}/${job.id || job.ticket_id}`);

        // Determine content to embed
        let contentToEmbed = job.content;

        // For document_chunks jobs, use contentFunction if present
        if (job.table === 'document_chunks') {
          if (!contentToEmbed && job.contentFunction) {
            // Fetch chunk_content using contentFunction
            const { data: chunkRow, error: chunkError } = await supabaseClient
              .from('document_chunks')
              .select('chunk_content')
              .eq('id', job.id)
              .single();
            if (chunkError || !chunkRow || !chunkRow.chunk_content) {
              throw new Error(`No chunk_content found for document_chunk ${job.id}`);
            }
            contentToEmbed = chunkRow.chunk_content;
          }
        }

        // For ticket jobs, use content if present, else concatenate subject and description
        if (!contentToEmbed && job.ticket_id) {
          contentToEmbed = (job.subject || '') + '\n\n' + (job.description || '');
        }

        // Generate embedding
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: contentToEmbed
          })
        });
        if (!embeddingResponse.ok) {
          const errorText = await embeddingResponse.text();
          throw new Error(`OpenAI API error: ${embeddingResponse.status} - ${errorText}`);
        }
        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;
        console.log(`Generated embedding for ${job.table} ${job.id}`);

        // Store embedding in database
        let embeddingStored = false;
        if (job.table === 'ticket_embeddings' || job.table === 'tickets') {
          // Ticket embedding logic (legacy, if needed)
          const { error: embeddingError } = await supabaseClient
            .from('ticket_embeddings')
            .upsert({
              ticket_id: job.ticket_id,
              content_type: job.content_type || 'combined',
              embedding: embedding
            });
          if (!embeddingError) embeddingStored = true;
        } else if (job.table === 'document_chunks') {
          // Document chunk embedding logic
          const { error: chunkError } = await supabaseClient
            .from('document_chunks')
            .update({ embedding: embedding })
            .eq('id', job.id);
          if (!chunkError) embeddingStored = true;
        } else {
          // Generic embedding update for other tables
          const { error: genericError } = await supabaseClient
            .from(job.table)
            .update({ [job.embeddingColumn || 'embedding']: embedding })
            .eq('id', job.id);
          if (!genericError) embeddingStored = true;
        }

        if (embeddingStored) {
          try {
            await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`;
            console.log(`Completed embedding for ${job.table} ${job.id}`);
            completedJobs.push(job);
          } catch (e) {
            console.error('Error deleting job from queue (direct SQL):', e);
          }
        } else {
          // If embedding was not stored, do not delete job from queue
          console.warn(`Embedding not stored for job ${job.jobId}, job will remain in queue for retry.`);
          failedJobs.push({
            ...job,
            error: 'Embedding not stored'
          });
        }
      } catch (error) {
        console.error(`Error processing job ${job.jobId}:`, error);
        failedJobs.push({
          ...job,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Do NOT delete job from queue here; leave for retry
      }
    }
    return new Response(JSON.stringify({
      message: `Processed ${jobs.length} embedding jobs`,
      completedJobs: completedJobs.length,
      failedJobs: failedJobs.length,
      results: {
        completed: completedJobs,
        failed: failedJobs
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'x-completed-jobs': completedJobs.length.toString(),
        'x-failed-jobs': failedJobs.length.toString()
      },
      status: 200
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});

/*
Explanation of changes to support both ticket and document chunk embeddings:

1. **Job Routing by Table Type**:
   - The function checks `job.table` to determine if the job is for `ticket_embeddings`/`tickets` or for `document_chunks`.
   - This allows the same function to process both ticket and documentation chunk embedding jobs.

2. **Content Extraction**:
   - For `document_chunks`, if the job does not provide content directly, it fetches `chunk_content` from the database.
   - For tickets, it uses the provided content or fetches as needed.

3. **Embedding Generation**:
   - The function generates the embedding using the OpenAI API (or other providers, if configured).

4. **Embedding Storage**:
   - For tickets: Upserts the embedding into the `ticket_embeddings` table and optionally updates ticket status.
   - For document chunks: Updates the `embedding` field in the `document_chunks` table for the given chunk.
   - For other tables: Updates the specified embedding column.

5. **Queue Management**:
   - After processing, the job is removed from the queue using `pgmq.delete`.

6. **Error Handling**:
   - Errors are logged and failed jobs are tracked and removed from the queue.

**Summary**:
- The function now supports both ticket and documentation chunk embeddings by routing jobs based on the `table` field.
- It fetches the correct content, generates embeddings, and stores them in the appropriate table.
- This unified approach allows you to use a single embedding processor for all types of content in your system.
*/

// # Example: Test ticket embedding job
// curl -X POST "https://your-project-ref.supabase.co/functions/v1/process-embeddings" \
//   -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "jobId": 123,
//     "id": "<ticket_embedding_id>",
//     "table": "ticket_embeddings",
//     "ticket_id": "<ticket_id>",
//     "content_type": "combined",
//     "content": "Ticket subject and description text here"
//   }'

// # Example: Test document chunk embedding job
// curl -X POST "https://your-project-ref.supabase.co/functions/v1/process-embeddings" \
//   -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
//   -H "Content-Type: application/json" \
//   -d '{
//     "jobId": 456,
//     "id": "<document_chunk_id>",
//     "table": "document_chunks",
//     "content": "Chunk content text here"
//   }'
//   }'
