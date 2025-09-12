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

    console.log('Starting classification processing...')

    // Get the request body containing batch of jobs
    const requestBody = await req.json()
    console.log("Received request body:", JSON.stringify(requestBody))

    // Handle both single job and batch processing
    const jobs = Array.isArray(requestBody) ? requestBody : [requestBody]
    console.log(`Processing ${jobs.length} classification jobs`)

    const completedJobs: any[] = []
    const failedJobs: any[] = []

    // Process each job in the batch
    for (const job of jobs) {
      try {
        console.log(`Processing job: ${job.jobId} for ticket ${job.ticket_id}`)

        // Get ticket data for classification
        const { data: ticket, error: ticketError } = await supabaseClient
          .from('tickets')
          .select('id, subject, description')
          .eq('id', job.ticket_id)
          .single();

        if (ticketError || !ticket) {
          throw new Error(`Ticket not found: ${job.ticket_id}`);
        }

        // Call RPC to classify ticket using pgvector similarity
        const { data: classificationData, error: classificationError } = await supabaseClient
          .rpc('classify_ticket_by_embedding', {
            input_ticket_id: job.ticket_id // <-- use correct parameter name
          });

        if (classificationError || !classificationData) {
          throw new Error('Error classifying ticket via embedding RPC:', classificationError);
        }

        // Get similar tickets for RAG context using ticket_id directly
        const { data: similarTickets, error: similarError } = await supabaseClient
          .rpc('match_tickets', {
            input_ticket_id: job.ticket_id,
            match_threshold: 0.7,
            match_count: 5
          });

        if (similarError) {
          console.warn('Error getting similar tickets:', similarError);
        }

        // Prepare context from similar tickets
        const context = similarTickets?.map((t: any) =>
          `Ticket: ${t.subject}\nResolution: ${t.resolution || 'No resolution available'}`
        ).join('\n\n') || 'No similar tickets found';

        // AI Classification using OpenAI (for response only)
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
        if (!openaiApiKey) {
          throw new Error('OPENAI_API_KEY environment variable is not set')
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
`

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
        })

        if (!classificationResponse.ok) {
          const errorText = await classificationResponse.text()
          throw new Error(`OpenAI API error: ${classificationResponse.status} - ${errorText}`)
        }

        const classificationResultData = await classificationResponse.json();
        let aiResponse;
        try {
          // Sanitize control characters and parse
          const rawContent = classificationResultData.choices[0].message.content;
          const sanitizedContent = rawContent.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
          aiResponse = JSON.parse(sanitizedContent).ai_response;
        } catch (err) {
          console.error("Error parsing AI response JSON:", err, classificationResultData.choices[0].message.content);
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
          .eq('id', job.ticket_id)

        if (updateError) {
          console.error('Error updating ticket classification:', updateError)
          throw updateError
        }

        // Store AI response
        const { error: aiResponseError } = await supabaseClient
          .from('ai_responses')
          .insert({
            ticket_id: job.ticket_id,
            generated_response: aiResponse,
            confidence_score: classificationData.scores?.confidence ?? null,
            sources: similarTickets?.map((t: any) => ({
              title: t.subject,
              content: t.resolution || 'No resolution available',
              similarity: t.similarity
            })) || []
          })

        if (aiResponseError) {
          console.error('Error storing AI response:', aiResponseError)
        }

        // Store similar tickets in ticket_similarities table
        if (Array.isArray(similarTickets)) {
          for (const sim of similarTickets) {
            await supabaseClient
              .from('ticket_similarities')
              .upsert({
                ticket_id: job.ticket_id,
                similar_ticket_id: sim.ticket_id,
                similarity_score: sim.similarity
              }, { onConflict: ['ticket_id', 'similar_ticket_id'] });
          }
        }

        // Remove job from queue using safe function
        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`
        } catch (deleteError) {
          console.error('Error deleting job from queue (direct SQL):', deleteError)
        }

        console.log(`Completed classification for ticket ${job.ticket_number}`)
        completedJobs.push(job)

      } catch (error) {
        console.error(`Error processing job ${job.jobId}:`, error)

        // Mark job as failed
        failedJobs.push({
          ...job,
          error: error instanceof Error ? error.message : 'Unknown error'
        })

        // Still try to remove failed job from queue
        try {
          await sql`select pgmq.delete(${QUEUE_NAME}, ${job.jobId}::bigint)`
        } catch (deleteError) {
          console.error('Error deleting failed job (direct SQL):', deleteError)
        }
      }
    }

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
    console.error('Unexpected error:', error)
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