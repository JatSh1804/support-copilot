/**
 * Simple Deno crawler + embedding generator to upsert documentation embeddings
 * Usage: deno run -A scripts/scraper.ts
 */
import postgres from 'https://deno.land/x/postgresjs@v3.4.5/mod.js';

const START_HOST = 'developer.atlan.com';
const START_URL = `https://${START_HOST}/`;
const MAX_PAGES = 200;
const DELAY_MS = 500; // polite delay between requests

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
const DEFAULT_PROVIDER = Deno.env.get('DEFAULT_EMBEDDING_PROVIDER') || 'fireworks';
const EMBEDDINGS_MODEL = 'nomic-ai/nomic-embed-text-v1';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL'));

// basic fetch + text extraction
async function fetchPage(url) {
	try {
		const res = await fetch(url, { redirect: 'follow' });
		if (!res.ok) return null;
		const html = await res.text();
		// crude extraction: strip script/style and tags, keep whitespace
		const cleaned = html
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/<style[\s\S]*?<\/style>/gi, '')
			.replace(/<!--[\s\S]*?-->/g, '')
			.replace(/<\/?[^>]+(>|$)/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		// Try to get title
		const m = html.match(/<title>([^<]*)<\/title>/i);
		const title = m ? m[1].trim() : url;
		return { url, title, content: cleaned };
	} catch (err) {
		console.error('fetchPage error:', err.message);
		return null;
	}
}

async function generateEmbedding(text) {
	const provider = PROVIDERS.find(p => p.name === DEFAULT_PROVIDER) || PROVIDERS[0];
	if (!provider?.apiKey) throw new Error('No API key configured for embedding provider');
	const endpoint = provider.baseURL + 'embeddings';
	const body = JSON.stringify({ input: text, model: EMBEDDINGS_MODEL });
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${provider.apiKey}`
		},
		body
	});
	if (!res.ok) {
		const t = await res.text();
		throw new Error(`Embedding request failed: ${res.status} ${t}`);
	}
	const data = await res.json();
	if (data.data && data.data[0]?.embedding) return data.data[0].embedding;
	if (data.embeddings) return data.embeddings;
	throw new Error('Unexpected embedding response format');
}

async function upsertDoc({ url, title, content, embedding }) {
	const now = new Date().toISOString();
	try {
		await sql`
			insert into documentation_embeddings (url, title, content, embedding, metadata, updated_at)
			values (${url}, ${title}, ${content}, ${JSON.stringify(embedding)}, ${JSON.stringify({source: START_HOST})}, ${now})
			on conflict (url) do update set title = excluded.title, content = excluded.content, embedding = excluded.embedding, metadata = excluded.metadata, updated_at = excluded.updated_at
		`;
		console.log('Upserted:', url);
	} catch (err) {
		console.error('DB upsert error:', err.message);
	}
}

function sameDomain(url) {
	try {
		const u = new URL(url);
		return u.hostname === START_HOST;
	} catch {
		return false;
	}
}

async function crawl() {
	const seen = new Set();
	const queue = [START_URL];
	while (queue.length && seen.size < MAX_PAGES) {
		const url = queue.shift();
		if (!url || seen.has(url)) continue;
		seen.add(url);
		console.log('Crawling:', url);
		const page = await fetchPage(url);
		if (!page) continue;
		// generate embedding (limit content size)
		const textForEmbedding = page.content.slice(0, 15000);
		let embedding;
		try {
			embedding = await generateEmbedding(textForEmbedding);
		} catch (err) {
			console.error('Embedding error for', url, err.message);
			continue;
		}
		await upsertDoc({ url: page.url, title: page.title, content: page.content, embedding });
		// extract same-domain links
		const linkMatches = page.content.matchAll(/https?:\/\/[^\s"'<>]+/g);
		for (const m of linkMatches) {
			const link = m[0];
			if (sameDomain(link) && !seen.has(link) && !queue.includes(link)) {
				queue.push(link);
			}
		}
		// polite delay
		await new Promise((r) => setTimeout(r, DELAY_MS));
	}
	console.log('Crawl complete. Pages processed:', seen.size);
}

if (import.meta.main) {
	try {
		await crawl();
		console.log('Done');
	} catch (err) {
		console.error('Crawler failed:', err);
		Deno.exit(1);
	}
}
