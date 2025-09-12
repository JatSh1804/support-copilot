import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Only POST allowed', { status: 405 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { type, value } = body;
  if (!type || !value) {
    return new Response('Missing type or value', { status: 400 });
  }
  if (!OPENAI_API_KEY) {
    return new Response('Missing OPENAI_API_KEY', { status: 500 });
  }
  // Generate embedding
  const embeddingRes = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: value
    })
  });
  if (!embeddingRes.ok) {
    const errText = await embeddingRes.text();
    return new Response(`Embedding error: ${errText}`, { status: 500 });
  }
  const embeddingData = await embeddingRes.json();
  const embedding = embeddingData.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    return new Response('No embedding returned', { status: 500 });
  }
  // Insert into prefilled_embeddings
  try {
    await sql`
      insert into prefilled_embeddings (type, value, embedding)
      values (${type}, ${value}, ${JSON.stringify(embedding)})
      on conflict (type, value) do update set embedding = excluded.embedding
    `;
    return new Response(JSON.stringify({ success: true, type, value }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err) {
    return new Response(`DB error: ${err.message}`, { status: 500 });
  }
});
