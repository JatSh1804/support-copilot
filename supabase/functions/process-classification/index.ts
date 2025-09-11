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

    console.log('Starting classification processing...')

    // Receive messages from the classification queue
    const { data: messages, error: receiveError } = await supabaseClient.rpc('pgmq_receive', {
      queue_name: 'classification_queue',
      vt: 60, // visibility timeout of 60 seconds (classification takes longer)
      qty: 3   // process up to 3 messages at once
    })

    if (receiveError) {
      console.error('Error receiving messages:', receiveError)
      throw receiveError
    }

    if (!messages || messages.length === 0) {
      console.log('No messages in classification queue')
      return new Response(
        JSON.stringify({ message: 'No messages to process' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      )
    }

    console.log(`Processing ${messages.length} classification messages`)

    const processedMessages = []

    for (const message of messages) {
      try {
        const payload = message.message
        console.log(`Classifying ticket: ${payload.ticket_number}`)

        // Step 1: Classify the ticket using OpenAI
        const classificationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: `You are an expert at classifying customer support tickets for Atlan, a data cataloging and governance platform. 

Analyze the ticket and provide classification in this exact JSON format:
{
  "topic_tags": ["tag1", "tag2", "tag3"],
  "sentiment": "Frustrated|Angry|Curious|Neutral|Happy",
  "priority": "P0|P1|P2",
  "confidence": 0.85
}

Topic tags should be from: Connector, How-to, Product, API/SDK, Best practices, Lineage, Glossary, SSO/Authentication, Sensitive Data, Performance, Integration, Configuration, Troubleshooting, Feature Request, Bug Report

Priority levels:
- P0: Critical issues blocking workflows, security issues, data loss
- P1: Important features not working, significant user impact  
- P2: Minor issues, questions, enhancement requests

Sentiment:
- Frustrated: User is having trouble, blocked, expressing frustration
- Angry: User is upset, demanding, using strong negative language
- Curious: User is learning, asking questions, exploring features
- Neutral: Professional, matter-of-fact tone
- Happy: Positive feedback, thanks, satisfaction`
              },
              {
                role: 'user',
                content: `Subject: ${payload.subject}\n\nDescription: ${payload.description}`
              }
            ],
            temperature: 0.1,
          }),
        })

        if (!classificationResponse.ok) {
          const errorText = await classificationResponse.text()
          throw new Error(`OpenAI classification error: ${classificationResponse.status} - ${errorText}`)
        }

        const classificationData = await classificationResponse.json()
        const classificationResult = JSON.parse(classificationData.choices[0].message.content)

        console.log(`Classified ticket ${payload.ticket_number}:`, classificationResult)

        // Step 2: Find similar tickets using vector similarity
        const { data: similarTickets, error: similarityError } = await supabaseClient.rpc('match_tickets', {
          query_embedding: payload.embedding,
          match_threshold: 0.7,
          match_count: 5
        })

        if (similarityError) {
          console.error('Error finding similar tickets:', similarityError)
        }

        // Step 3: Generate AI response using RAG
        const contextTickets = similarTickets?.map(ticket => 
          `Ticket: ${ticket.subject}\nDescription: ${ticket.description}\nResolution: ${ticket.resolution || 'Not resolved'}`
        ).join('\n\n') || ''

        const responsePrompt = `Based on similar tickets and Atlan documentation, provide a helpful response to this customer support ticket.

Customer Ticket:
Subject: ${payload.subject}
Description: ${payload.description}

Similar Resolved Tickets:
${contextTickets}

Provide a response that:
1. Acknowledges their specific issue
2. Provides step-by-step guidance
3. References relevant documentation
4. Is professional and helpful

Format your response as JSON:
{
  "answer": "Your detailed response here...",
  "confidence": 0.85,
  "sources": [
    {
      "title": "Documentation Title",
      "url": "https://docs.atlan.com/...",
      "snippet": "Relevant excerpt..."
    }
  ]
}`

        const aiResponseResult = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful Atlan support agent with deep knowledge of the platform.'
              },
              {
                role: 'user',
                content: responsePrompt
              }
            ],
            temperature: 0.3,
          }),
        })

        let aiResponse = null
        if (aiResponseResult.ok) {
          const aiResponseData = await aiResponseResult.json()
          try {
            aiResponse = JSON.parse(aiResponseData.choices[0].message.content)
          } catch (e) {
            console.error('Error parsing AI response:', e)
          }
        }

        // Step 4: Update ticket with classification results
        const { error: updateError } = await supabaseClient
          .from('tickets')
          .update({
            topic_tags: classificationResult.topic_tags,
            sentiment: classificationResult.sentiment,
            ai_priority: classificationResult.priority,
            classification_confidence: classificationResult.confidence,
            status: 'classified',
            classification_completed_at: new Date().toISOString()
          })
          .eq('id', payload.ticket_id)

        if (updateError) {
          console.error('Error updating ticket:', updateError)
          throw updateError
        }

        // Step 5: Store AI response if generated
        if (aiResponse) {
          const { error: aiResponseError } = await supabaseClient
            .from('ai_responses')
            .insert({
              ticket_id: payload.ticket_id,
              generated_response: aiResponse.answer,
              confidence_score: aiResponse.confidence,
              sources: aiResponse.sources || []
            })

          if (aiResponseError) {
            console.error('Error storing AI response:', aiResponseError)
          }
        }

        console.log(`Completed classification for ticket ${payload.ticket_number}`)

        // Delete message from queue
        const { error: deleteError } = await supabaseClient.rpc('pgmq_delete', {
          queue_name: 'classification_queue',
          msg_id: message.msg_id
        })

        if (deleteError) {
          console.error('Error deleting message from queue:', deleteError)
        }

        processedMessages.push({
          ticket_id: payload.ticket_id,
          ticket_number: payload.ticket_number,
          status: 'completed',
          classification: classificationResult,
          ai_response_generated: !!aiResponse,
          similar_tickets_found: similarTickets?.length || 0
        })

      } catch (error) {
        console.error(`Error processing classification message ${message.msg_id}:`, error)
        
        // Delete failed message to prevent infinite loops
        const { error: deleteError } = await supabaseClient.rpc('pgmq_delete', {
          queue_name: 'classification_queue',
          msg_id: message.msg_id
        })

        if (deleteError) {
          console.error('Error deleting failed message:', deleteError)
        }

        processedMessages.push({
          ticket_id: message.message.ticket_id,
          ticket_number: message.message.ticket_number,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${processedMessages.length} classification messages`,
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
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})