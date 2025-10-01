import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    const { ticket_id, ticket_number, subject, description, email, name } = await req.json()
    
    console.log(`[chatbase] Processing ticket ${ticket_number}`)

    // Get Chatbase credentials
    const chatbaseApiKey = Deno.env.get('CHATBASE_API_KEY')
    const chatbotId = Deno.env.get('CHATBASE_CHATBOT_ID')

    if (!chatbaseApiKey || !chatbotId) {
      throw new Error('Chatbase credentials not configured')
    }

    // Prepare message for Chatbase
    const userMessage = `
TICKET: ${ticket_number}
SUBJECT: ${subject}
DESCRIPTION: ${description}
FROM: ${name} (${email})

Please analyze this support ticket and provide:
1. Priority level (P0/P1/P2)
2. Sentiment analysis (Frustrated/Curious/Neutral/Happy)
3. Topic classification (array of topics like ["Integration", "API", "Setup"])
4. A helpful response based on our documentation
5. Relevant documentation links

Format your response as JSON with these exact fields:
{
  "priority": "P0|P1|P2",
  "sentiment": "Frustrated|Curious|Neutral|Happy",
  "topics": ["topic1", "topic2"],
  "response": "your detailed response here",
  "documentation_links": [{"title": "...", "url": "..."}],
  "confidence": 0.85
}
`.trim()

    // Call Chatbase API
    console.log('[chatbase] Calling Chatbase API...')
    const chatbaseResponse = await fetch('https://www.chatbase.co/api/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${chatbaseApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ],
        chatbotId: chatbotId,
        stream: false,
        temperature: 0.3,
        // model: 'gpt-4'
      }),
    })

    if (!chatbaseResponse.ok) {
      const errorText = await chatbaseResponse.text()
      console.error('[chatbase] API error:', errorText)
      throw new Error(`Chatbase API error: ${chatbaseResponse.status}`)
    }

    const chatbaseData = await chatbaseResponse.json()
    console.log('[chatbase] Response received:', chatbaseData)

    // Extract the response text
    const aiResponseText = chatbaseData.text || ''
    
    // Try to parse JSON from the response
    let parsedAnalysis: any = {
      priority: 'P2',
      sentiment: 'Neutral',
      topics: ['General'],
      response: aiResponseText,
      documentation_links: [],
      confidence: 0.5
    }

    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = aiResponseText.match(/```json\s*([\s\S]*?)\s*```/) || 
                       aiResponseText.match(/\{[\s\S]*\}/)
      
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0]
        const parsed = JSON.parse(jsonStr)
        parsedAnalysis = { ...parsedAnalysis, ...parsed }
        console.log('[chatbase] Parsed JSON successfully')
      }
    } catch (parseError) {
      console.warn('[chatbase] Failed to parse JSON, using fallback', parseError)
    }

    // Extract sources from Chatbase response
    const sources = chatbaseData.sources || []
    const formattedSources = sources.map((source: any) => ({
      title: source.name || 'Documentation',
      url: source.url || '#',
      snippet: source.content?.slice(0, 200) || '',
      similarity: 0.9
    }))

    // Merge documentation links from parsed response
    const allSources = [
      ...formattedSources,
      ...(parsedAnalysis.documentation_links || []).map((link: any) => ({
        title: link.title || 'Documentation',
        url: link.url || '#',
        snippet: '',
        similarity: 0.85
      }))
    ]

    // Map Chatbase response to existing tickets table schema
    const { error: updateError } = await supabaseClient
      .from('tickets')
      .update({
        topic_tags: parsedAnalysis.topics || ['General'],           // Existing field
        sentiment: parsedAnalysis.sentiment || 'Neutral',            // Existing field
        ai_priority: parsedAnalysis.priority || 'P2',                // Existing field
        classification_confidence: parsedAnalysis.confidence || 0.5, // Existing field
        status: 'classified',                                        // Existing field
        classification_completed_at: new Date().toISOString()       // Existing field
      })
      .eq('id', ticket_id)

    if (updateError) {
      console.error('[chatbase] Error updating ticket:', updateError)
      throw updateError
    }

    // Store AI response in existing ai_responses table
    const { error: aiResponseError } = await supabaseClient
      .from('ai_responses')
      .insert({
        ticket_id: ticket_id,
        generated_response: parsedAnalysis.response || aiResponseText,
        confidence_score: parsedAnalysis.confidence || 0.5,
        sources: allSources // JSONB field stores documentation references
      })

    if (aiResponseError) {
      console.error('[chatbase] Error storing AI response:', aiResponseError)
    }

    // Add initial AI response to ticket_responses table
    const { error: responseInsertError } = await supabaseClient
      .from('ticket_responses')
      .insert({
        ticket_id: ticket_id,
        author_name: 'AI Assistant',
        response_type: 'system',
        content: parsedAnalysis.response || aiResponseText,
        reference: allSources.length > 0 ? allSources : null // ✅ Changed to 'reference' (singular)
      })

    if (responseInsertError) {
      console.error('[chatbase] Error inserting ticket response:', responseInsertError)
    }

    console.log(`[chatbase] Ticket ${ticket_number} processed successfully`)

    return new Response(
      JSON.stringify({
        success: true,
        ticket_id,
        ticket_number,
        analysis: parsedAnalysis,
        sources: allSources
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('[chatbase] Error:', error)

    // Mark ticket as failed classification
    try {
      const { ticket_id } = await req.json()
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )
      
      await supabaseClient
        .from('tickets')
        .update({ status: 'pending' }) // Reset to pending on failure
        .eq('id', ticket_id)
    } catch (fallbackError) {
      console.error('[chatbase] Failed to update ticket status on error')
    }

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
