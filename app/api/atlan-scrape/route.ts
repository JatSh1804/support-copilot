import { NextRequest, NextResponse } from 'next/server';
import { DocumentProcessor } from '@/supabase/functions/scrape-docs/document-processor';

export async function POST(req: NextRequest) {
  // Optional: Add authentication/authorization here if needed

  try {
    console.log('🚀 API: Starting documentation scraping...');
    const processor = new DocumentProcessor();
    await processor.processAtlanDocumentation();
    return NextResponse.json({
      success: true,
      message: 'Documentation scraping completed successfully',
      timestamp: new Date().toISOString()
    }, { status: 200 });
  } catch (error: any) {
    console.error('❌ API: Scraping failed:', error);
    return NextResponse.json({
      success: false,
      error: error?.message || 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}
