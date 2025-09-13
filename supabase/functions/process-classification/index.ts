import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '')
const QUEUE_NAME = 'classification_queue'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('[classification] Start batch');
    const requestBody = await req.json();
    console.log(`[classification] Received jobs: ${Array.isArray(requestBody) ? requestBody.length : 1}`);

    const jobs = Array.isArray(requestBody) ? requestBody : [requestBody];
    const completedJobs: any[] = [];
    const failedJobs: any[] = [];

    for (const job of jobs) {
      try {
        console.log(`[classification] Job ${job.jobId}: ticket_id=${job.ticket_id}`);

        // Get ticket data for classification
        const { data: ticket, error: ticketError } = await supabaseClient
          .from('tickets')
          .select('id, subject, description')
          .eq('id', job.ticket_id)
          .single();

        if (ticketError || !ticket) {
          console.error(`[classification] Job ${job.jobId}: Ticket not found (${job.ticket_id})`, ticketError);
          throw new Error(`Ticket not found: ${job.ticket_id}`);
        }
        console.log(`[classification] Job ${job.jobId}: Ticket subject="${ticket.subject}"`);

        // Call RPC to classify ticket
        const { data: classificationData, error: classificationError } = await supabaseClient
          .rpc('classify_ticket_by_embedding', {
            input_ticket_id: job.ticket_id
          });

        if (classificationError || !classificationData) {
          console.error(`[classification] Job ${job.jobId}: classify_ticket_by_embedding error`, classificationError);
          throw new Error('Error classifying ticket via embedding RPC');
        }
        console.log(`[classification] Job ${job.jobId}: Classification result`, JSON.stringify(classificationData));

        // Get similar tickets for RAG context
        const { data: similarTickets, error: similarError } = await supabaseClient
          .rpc('match_tickets', {
            input_ticket_id: job.ticket_id,
            match_threshold: 0.7,
            match_count: 5
          });

        if (similarError) {
          console.warn(`[classification] Job ${job.jobId}: match_tickets error`, similarError);
        } else {
          console.log(`[classification] Job ${job.jobId}: Found ${similarTickets?.length ?? 0} similar tickets`);
        }

        // Prepare context from similar tickets
        const context = similarTickets?.map((t: any) =>
          `Ticket: ${t.subject}\nResolution: ${t.resolution || 'No resolution available'}`
        ).join('\n\n') || 'No similar tickets found';

        // AI Classification using OpenAI
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
        if (!openaiApiKey) {
          console.error(`[classification] Job ${job.jobId}: OPENAI_API_KEY not set`);
          throw new Error('OPENAI_API_KEY environment variable is not set');
        }

        const classificationPrompt = `
Analyze this customer support ticket and provide a helpful response.

TICKET DETAILS:
Subject: ${ticket.subject}
Description: ${ticket.description}

CLASSIFICATION:
Topic tags: ${JSON.stringify(classificationData.topic_tags)}
Sentiment: ${classificationData.sentiment}
Priority: ${classificationData.priority}

SIMILAR RESOLVED TICKETS:
${context}

Please provide:
1. AI-generated response to customer

Format as JSON:
{
  "ai_response": "Your response here"
}
`;

        const classificationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are an expert customer support AI that provides helpful responses.'
              },
              {
                role: 'user',
                content: classificationPrompt
              }
            ],
            temperature: 0.3,
            max_tokens: 1000
          }),
        });

        if (!classificationResponse.ok) {
          const errorText = await classificationResponse.text();
          console.error(`[classification] Job ${job.jobId}: OpenAI API error`, errorText);
          throw new Error(`OpenAI API error: ${classificationResponse.status} - ${errorText}`);
        }

        const classificationResultData = await classificationResponse.json();
        let aiResponse;
        try {
          const rawContent = classificationResultData.choices[0].message.content;
          const sanitizedContent = rawContent.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
          aiResponse = JSON.parse(sanitizedContent).ai_response;
          console.log(`[classification] Job ${job.jobId}: AI response parsed`);
        } catch (err) {
          console.error(`[classification] Job ${job.jobId}: Error parsing AI response JSON`, err, classificationResultData.choices[0].message.content);
          throw new Error("Failed to parse AI response JSON");
        }

        // Update ticket with classification results
        const { error: updateError } = await supabaseClient
          .from('tickets')
          .update({
            topic_tags: classificationData.topic_tags,
            sentiment: classificationData.sentiment,
            ai_priority: classificationData.priority,
            classification_confidence: classificationData.scores?.confidence ?? null,
            status: 'classified',
            classification_completed_at: new Date().toISOString()
          })
          .eq('id', job.ticket_id);

        if (updateError) {
          console.error(`[classification] Job ${job.jobId}: Error updating ticket classification`, updateError);
          throw updateError;
        }
        console.log(`[classification] Job ${job.jobId}: Ticket updated`);

        // Get ticket embedding for document similarity search
        const { data: ticketEmbeddingRow, error: ticketEmbeddingError } = await supabaseClient
          .from('ticket_embeddings')
          .select('embedding')
          .eq('ticket_id', job.ticket_id)
          .eq('content_type', 'combined')
          .single();

        if (ticketEmbeddingError || !ticketEmbeddingRow) {
          console.error(`[classification] Job ${job.jobId}: No embedding found for ticket`, ticketEmbeddingError);
          throw new Error(`No embedding found for ticket ${job.ticket_id}`);
        }

        // Find top N relevant documentation pages by embedding similarity
        const { data: docMatches, error: docError } = await supabaseClient
          .rpc('match_documents', {
            ticket_id: job.ticket_id,
            match_count: 5
          });

        if (docError) {
          console.warn(`[classification] Job ${job.jobId}: Error getting documentation matches`, docError);
        } else {
          console.log(`[classification] Job ${job.jobId}: Found ${docMatches?.length ?? 0} documentation matches`);
        }

        const sources = Array.isArray(docMatches)
          ? docMatches.map((doc: any) => ({
              title: doc.title,
              url: doc.url,
              snippet: doc.snippet || doc.content?.slice(0, 120) || '',
              similarity: doc.similarity
            }))
          : [];

        // Store AI response
        const { error: aiResponseError } = await supabaseClient
          .from('ai_responses')
          .insert({
            ticket_id: job.ticket_id,
            generated_response: aiResponse,
            confidence_score: classificationData.scores?.confidence ?? null,
            sources: sources
          });

        if (aiResponseError) {
          console.error(`[classification] Job ${job.jobId}: Error storing AI response`, aiResponseError);
        } else {
          console.log(`[classification] Job ${job.jobId}: AI response stored`);
        }

        // Store similar tickets in ticket_similarities table
        if (Array.isArray(similarTickets)) {
          for (const sim of similarTickets) {
            try {
              await supabaseClient
                .from('ticket_similarities')
                .upsert({
                  ticket_id: job.ticket_id,
                  similar_ticket_id: sim.ticket_id,
                  similarity_score: sim.similarity
                }, { onConflict: ['ticket_id', 'similar_ticket_id'] });
              console.log(`[classification] Job ${job.jobId}: Similar ticket stored (${sim.ticket_id})`);
            } catch (simError) {
              console.error(`[classification] Job ${job.jobId}: Error storing similar ticket (${sim.ticket_id})`, simError);
            }
          }
        }

        // Remove job from queue using safe function
        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`
          console.log(`[classification] Job ${job.jobId}: Removed from queue`);
        } catch (deleteError) {
          console.error(`[classification] Job ${job.jobId}: Error deleting job from queue`, deleteError);
        }

        console.log(`[classification] Job ${job.jobId}: Completed`);
        completedJobs.push(job);

      } catch (error) {
        console.error(`[classification] Job ${job.jobId}: Error processing job`, error);

        failedJobs.push({
          ...job,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`
          console.log(`[classification] Job ${job.jobId}: Removed failed job from queue`);
        } catch (deleteError) {
          console.error(`[classification] Job ${job.jobId}: Error deleting failed job from queue`, deleteError);
        }
      }
    }

    console.log(`[classification] Batch complete: ${completedJobs.length} completed, ${failedJobs.length} failed`);
    return new Response(
      JSON.stringify({
        message: `Processed ${jobs.length} classification jobs`,
        completedJobs: completedJobs.length,
        failedJobs: failedJobs.length,
        results: {
          completed: completedJobs,
          failed: failedJobs
        }
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'x-completed-jobs': completedJobs.length.toString(),
          'x-failed-jobs': failedJobs.length.toString()
        },
        status: 200
      }
    )

  } catch (error) {
    console.error('[classification] Unexpected error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})