import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log('Starting embeddings processing...')

    // Receive messages from the embeddings queue
    const { data: messages, error: receiveError } = await supabaseClient.rpc('pgmq_receive', {
      queue_name: 'embeddings_queue',
      vt: 30, // visibility timeout of 30 seconds
      qty: 10   // process up to 5 messages at once
    })

    if (receiveError) {
      console.error('Error receiving messages:', receiveError)
      throw receiveError
    }

    if (!messages || messages.length === 0) {
      console.log('No messages in embeddings queue')
      return new Response(
        JSON.stringify({ message: 'No messages to process' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    console.log(`Processing ${messages.length} embeddings messages`)

    const processedMessages = []

    for (const message of messages) {
      try {
        const payload = message.message
        console.log(`Processing ticket: ${payload.ticket_number}`)

        // Generate embeddings using OpenAI
        const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: payload.content,
          }),
        })

        if (!embeddingResponse.ok) {
          const errorText = await embeddingResponse.text()
          throw new Error(`OpenAI API error: ${embeddingResponse.status} - ${errorText}`)
        }

        const embeddingData = await embeddingResponse.json()
        const embedding = embeddingData.data[0].embedding

        console.log(`Generated embedding for ticket ${payload.ticket_number}`)

        // Store embedding in database
        const { data: embeddingRecord, error: embeddingError } = await supabaseClient
          .from('ticket_embeddings')
          .insert({
            ticket_id: payload.ticket_id,
            content_type: 'combined',
            embedding: embedding
          })
          .select('id')
          .single()

        if (embeddingError) {
          console.error('Error storing embedding:', embeddingError)
          throw embeddingError
        }

        console.log(`Stored embedding for ticket ${payload.ticket_number}`)

        // Update ticket status to processing
        const { error: updateError } = await supabaseClient
          .from('tickets')
          .update({ status: 'processing' })
          .eq('id', payload.ticket_id)

        if (updateError) {
          console.error('Error updating ticket status:', updateError)
        }

        // Add to classification queue
        const { error: queueError } = await supabaseClient.rpc('pgmq_send', {
          queue_name: 'classification_queue',
          msg: {
            ticket_id: payload.ticket_id,
            ticket_number: payload.ticket_number,
            subject: payload.subject,
            description: payload.description,
            content: payload.content,
            embedding_id: embeddingRecord.id,
            embedding: embedding
          }
        })

        if (queueError) {
          console.error('Error adding to classification queue:', queueError)
          throw queueError
        }

        console.log(`Added ticket ${payload.ticket_number} to classification queue`)

        // Delete message from embeddings queue
        const { error: deleteError } = await supabaseClient.rpc('pgmq_delete', {
          queue_name: 'embeddings_queue',
          msg_id: message.msg_id
        })

        if (deleteError) {
          console.error('Error deleting message from queue:', deleteError)
        }

        processedMessages.push({
          ticket_id: payload.ticket_id,
          ticket_number: payload.ticket_number,
          status: 'completed',
          embedding_dimensions: embedding.length
        })

      } catch (error) {
        console.error(`Error processing message ${message.msg_id}:`, error)
        
        // For now, we'll delete failed messages too to prevent infinite loops
        // In production, you might want to implement retry logic
        const { error: deleteError } = await supabaseClient.rpc('pgmq_delete', {
          queue_name: 'embeddings_queue',
          msg_id: message.msg_id
        })

        if (deleteError) {
          console.error('Error deleting failed message:', deleteError)
        }

        processedMessages.push({
          ticket_id: message.message.ticket_id,
          ticket_number: message.message.ticket_number,
          status: 'failed',
          error: error.message
        })
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${processedMessages.length} messages`,
        results: processedMessages
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})