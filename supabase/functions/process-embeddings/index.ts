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
        console.log(`Processing job: ${job.jobId} for ticket ${job.ticket_id}`);
        // Generate embeddings using OpenAI
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) {
          throw new Error('OPENAI_API_KEY environment variable is not set');
        }
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: job.content
          })
        });
        if (!embeddingResponse.ok) {
          const errorText = await embeddingResponse.text();
          throw new Error(`OpenAI API error: ${embeddingResponse.status} - ${errorText}`);
        }
        const embeddingData = await embeddingResponse.json();
        const embedding = embeddingData.data[0].embedding;
        console.log(`Generated embedding for ticket ${job.ticket_number}`);
        // Store embedding in database
        const { data: embeddingRecord, error: embeddingError } = await supabaseClient.from('ticket_embeddings').insert({
          ticket_id: job.ticket_id,
          content_type: 'combined',
          embedding: embedding
        }).select('id').single();
        if (embeddingError) {
          console.error('Error storing embedding:', embeddingError);
          throw embeddingError;
        }
        // Update ticket status to processing
        const { error: updateError } = await supabaseClient.from('tickets').update({
          status: 'processing',
        }).eq('id', job.ticket_id);
        if (updateError) {
          console.error('Error updating ticket status:', updateError);
        }
        // Remove job from queue using pgmq.delete
        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`;
        } catch (e) {
          console.error('Error deleting job from queue (direct SQL):', e);
        }
        console.log(`Completed embedding for ticket ${job.ticket_number}`);
        completedJobs.push(job);
      } catch (error) {
        console.error(`Error processing job ${job.jobId}:`, error);
        // Mark job as failed
        failedJobs.push({
          ...job,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Still try to remove failed job from queue
        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`;
        } catch (deleteError) {
          console.error('Error deleting failed job (direct SQL):', deleteError);
        }
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
