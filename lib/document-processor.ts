// lib/document-processor.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY!,
// });

interface ProcessingResult {
  documentsProcessed: number;
  totalChunks: number;
  totalEmbeddings: number;
}

interface DocumentChunk {
  content: string;
  index: number;
  heading?: string;
}

export class DocumentProcessor {
  private readonly CHUNK_SIZE = 1000;
  private readonly CHUNK_OVERLAP = 200;

  async processDocuments(documents: any[]): Promise<ProcessingResult> {
    console.log(`🔄 Processing ${documents.length} documents...`);
    let documentsProcessed = 0;
    let totalChunks = 0;

    // Process in batches to avoid rate limits
    const batchSize = 3;
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(doc => this.processDocument(doc))
      );
      results.forEach(result => {
        if (result) {
          documentsProcessed++;
          totalChunks += result.chunks;
        }
      });
      await this.sleep(1000);
    }

    return {
      documentsProcessed,
      totalChunks,
      totalEmbeddings: 0 // Embeddings are handled asynchronously by queue
    };
  }

  private async processDocument(doc: any): Promise<{chunks: number} | null> {
    try {
      const contentHash = this.generateContentHash(doc.content);

      // Check if document already exists and hasn't changed
      const { data: existingDoc } = await supabase
        .from('documents')
        .select('id, content_hash')
        .eq('url', doc.url)
        .single();

      if (existingDoc && existingDoc.content_hash === contentHash) {
        console.log(`⏭️ Skipping unchanged document: ${doc.url}`);
        return null;
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
            section: doc.section
          }
        })
        .select('id')
        .single();

      if (docError) {
        console.error(`Error saving document ${doc.url}:`, docError);
        return null;
      }

      // Delete old chunks if document was updated
      if (existingDoc) {
        await supabase
          .from('document_chunks')
          .delete()
          .eq('document_id', document.id);
      }

      // Create and process chunks (insert without embedding)
      const chunks = this.chunkDocument(doc.content, doc.headings);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const { error } = await supabase
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
        if (error) {
          console.error('Error storing chunk:', error);
        }
        // No embedding generation here; DB trigger will enqueue for embedding
      }

      console.log(`✅ Processed ${doc.title}: ${chunks.length} chunks`);
      return { chunks: chunks.length };

    } catch (error) {
      console.error(`Error processing document ${doc.url}:`, error);
      return null;
    }
  }

  private chunkDocument(content: string, headings: string[] = []): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const words = content.split(/\s+/);
    
    let currentChunk = '';
    let currentHeading = '';
    let chunkIndex = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // Simple heading detection
      const wordPosition = content.indexOf(word, currentChunk.length);
      const nearbyHeading = headings.find(heading => {
        const headingPos = content.indexOf(heading);
        return Math.abs(headingPos - wordPosition) < 50;
      });
      
      if (nearbyHeading && nearbyHeading !== currentHeading) {
        currentHeading = nearbyHeading;
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

  private generateContentHash(content: string): string {
    // Use Web Crypto API for browser/Next.js compatibility
    if (typeof window !== 'undefined' && window.crypto) {
      // Browser/Web Crypto
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      return window.crypto.subtle.digest('SHA-256', data).then((hashBuffer) => {
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      });
    } else {
      // Node.js fallback (if needed)
      const { createHash } = require('crypto');
      return createHash('sha256').update(content).digest('hex');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}