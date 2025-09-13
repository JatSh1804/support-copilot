// services/document-processor.ts
import { createClient } from '@supabase/supabase-js';
import { AtlanDocsScraper, generateContentHash } from './atlan-scraper';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for admin operations
);


interface DocumentChunk {
  content: string;
  index: number;
  heading?: string;
}

export class DocumentProcessor {
  private readonly CHUNK_SIZE = 1000;
  private readonly CHUNK_OVERLAP = 200;

  async processAtlanDocumentation(): Promise<void> {
    console.log('🔄 Starting documentation processing...');
    
    const scraper = new AtlanDocsScraper();
    
    try {
      // Step 1: Scrape all documents
      const scrapedDocs = await scraper.scrapeAtlanDocumentation();
      console.log(`📚 Scraped ${scrapedDocs.length} documents`);

      // Step 2: Process each document
      for (let i = 0; i < scrapedDocs.length; i++) {
        const doc = scrapedDocs[i];
        console.log(`⚙️ Processing document ${i + 1}/${scrapedDocs.length}: ${doc.title}`);
        
        await this.processDocument(doc);
        
        // Small delay to avoid rate limits
        await this.sleep(100);
      }

      console.log('✅ Documentation processing complete!');
      
    } catch (error) {
      console.error('❌ Error processing documentation:', error);
      throw error;
    }
  }

  private async processDocument(doc: any): Promise<void> {
    const contentHash = generateContentHash(doc.content);
    // Check if document already exists and hasn't changed
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id, content_hash')
      .eq('url', doc.url)
      .single();

    if (existingDoc && existingDoc.content_hash === contentHash) {
      console.log(`⏭️ Skipping unchanged document: ${doc.url}`);
      return;
    }

    // Upsert document
    const { data: document, error: docError } = await supabase
      .from('documents')
      .upsert({
        url: doc.url,
        title: doc.title,
        content: doc.content,
        content_hash: contentHash,
        metadata: {
          headings: doc.headings,
          breadcrumbs: doc.breadcrumbs,
          section: doc.section,
          lastModified: doc.lastModified
        }
      })
      .select('id')
      .single();

    if (docError) {
      console.error(`Error saving document ${doc.url}:`, docError);
      return;
    }

    // Delete old chunks if document was updated
    if (existingDoc) {
      await supabase
        .from('document_chunks')
        .delete()
        .eq('document_id', document.id);
    }

    // Process chunks (insert without embedding, trigger will enqueue for embedding)
    const chunks = this.chunkDocument(doc.content, doc.headings);
    console.log(`📄 Created ${chunks.length} chunks for ${doc.title}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Insert chunk without embedding
      const { error: chunkError } = await supabase
        .from('document_chunks')
        .insert({
          document_id: document.id,
          chunk_content: chunk.content,
          chunk_index: chunk.index,
          section_heading: chunk.heading,
          source_url: doc.url,
          metadata: {
            word_count: chunk.content.split(/\s+/).length
          }
        });

      if (chunkError) {
        console.error('Error storing chunk:', chunkError);
        continue;
      }
      // No direct queue enqueue needed; trigger handles it
    }
  }

  private chunkDocument(content: string, headings: string[] = []): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = content.split(/\s+/);
    
    let currentChunk = '';
    let currentHeading = '';
    let chunkIndex = 0;
    
    // Try to detect current section from headings
    const headingPositions = headings.map(heading => {
      const index = content.indexOf(heading);
      return { heading, index };
    }).filter(h => h.index !== -1)
      .sort((a, b) => a.index - b.index);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // Check if we're entering a new section
      const wordPosition = content.indexOf(word, currentChunk.length);
      const nextHeading = headingPositions.find(h => h.index <= wordPosition && h.index > wordPosition - 100);
      if (nextHeading) {
        currentHeading = nextHeading.heading;
      }

      if ((currentChunk + ' ' + word).length > this.CHUNK_SIZE) {
        // Create chunk
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            index: chunkIndex++,
            heading: currentHeading
          });
        }

        // Start new chunk with overlap
        const overlapWords = words.slice(Math.max(0, i - Math.floor(this.CHUNK_OVERLAP / 6)), i);
        currentChunk = overlapWords.join(' ') + ' ' + word;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + word;
      }
    }

    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex,
        heading: currentHeading
      });
    }

    return chunks;
  }

  

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}