// supabase/functions/scrape-docs/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { DocumentProcessor } from '../_shared/document-processor.ts';

serve(async (req) => {
  // Verify this is a scheduled call (optional security)
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    console.log('🚀 Starting scheduled documentation scraping...');
    
    const processor = new DocumentProcessor();
    await processor.processAtlanDocumentation();
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Documentation scraping completed successfully',
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 200 
      }
    );
    
  } catch (error) {
    console.error('❌ Scraping failed:', error);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});