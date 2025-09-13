// app/api/scrape-docs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { AtlanDocsScraper } from '@/lib/scraper';
import { DocumentProcessor } from '@/lib/document-processor';

export const maxDuration = 300; // 5 minutes

export async function GET(req: NextRequest) {
    return handleScrape(req);
}

export async function POST(req: NextRequest) {
    return handleScrape(req);
}

async function handleScrape(req: NextRequest) {
    const authHeader = req.headers.get('authorization');
    const authToken = authHeader?.replace('Bearer ', '');

    if (authToken !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        console.log('🚀 [api] Starting Atlan documentation scraping...');
        const scraper = new AtlanDocsScraper();
        const processor = new DocumentProcessor();

        const documents = await scraper.scrapeDocumentation();
        console.log(`[api] Scraped ${documents.length} documents`);

        const processed = await processor.processDocuments(documents);
        console.log(`[api] Processed ${processed.totalChunks} chunks from ${processed.documentsProcessed} documents`);

        return NextResponse.json({
            success: true,
            message: 'Documentation scraping completed successfully',
            stats: {
                documentsScraped: documents.length,
                documentsProcessed: processed.documentsProcessed,
                chunksCreated: processed.totalChunks
            },
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('[api] Scraping failed:', error);
        return NextResponse.json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        }, { status: 500 });
    }
}