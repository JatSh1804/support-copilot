// services/atlan-scraper.ts
import { chromium, Browser, Page } from 'playwright';
import { createHash } from 'node:crypto';

interface ScrapedContent {
  url: string;
  title: string;
  content: string;
  headings: string[];
  breadcrumbs: string[];
  section: string;
  lastModified?: string;
}
// types/supabase.ts
export interface Document {
  id: string;
  url: string;
  title: string;
  content: string;
  content_hash: string;
  scraped_at: string;
  metadata: Record<string, any>;
}

export interface DocumentChunk {
  id: string;
  document_id: string;
  chunk_content: string;
  embedding: number[];
  chunk_index: number;
  section_heading?: string;
  source_url: string;
  metadata: Record<string, any>;
}

export class AtlanDocsScraper {
  private browser: Browser | null = null;
  private visited = new Set<string>();
  private maxPages = 300;
  
  // Allowed paths for focused crawling
  private allowedPaths = {
    'docs.atlan.com': [
      '/guide/', '/concepts/', '/setup/', '/integrations/', 
      '/getting-started/', '/overview/', '/tutorial/', '/how-to/',
      '/best-practices/', '/glossary/', '/lineage/', '/connector/',
      '/sso/', '/authentication/', '/api/', '/sdk/'
    ],
    'developer.atlan.com': [
      '/api/', '/sdk/', '/reference/', '/authentication/',
      '/getting-started/', '/guide/', '/tutorial/', '/examples/',
      '/webhook/', '/automation/'
    ]
  };

  private blockedPaths = [
    '/changelog/', '/release-notes/', '/blog/', '/community/',
    '/download/', '/legal/', '/privacy/', '/terms/', '/support/',
    '/contact/', '/about/', '/careers/', '/pricing/',
    '.pdf', '.zip', '.jpg', '.png', '.gif', '/images/', '/assets/'
  ];

  async initialize() {
    console.log('[scraper] Initializing browser...');
    this.browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    console.log('[scraper] Browser launched');
  }

  async scrapeAtlanDocumentation(): Promise<ScrapedContent[]> {
    console.log('🚀 [scraper] Starting Atlan documentation scraping...');
    await this.initialize();
    
    try {
      const startUrls = [
        'https://docs.atlan.com/',
        'https://developer.atlan.com/'
      ];

      // Try to discover sitemap URLs first
      const allUrls = await this.discoverUrls(startUrls);
      console.log(`[scraper] Discovered ${allUrls.length} URLs to process`);

      // Crawl with priority-based approach
      const results = await this.crawlUrls(allUrls);
      
      console.log(`[scraper] Successfully scraped ${results.length} pages`);
      return results;
      
    } finally {
      await this.cleanup();
      console.log('[scraper] Browser closed');
    }
  }

  private async discoverUrls(startUrls: string[]): Promise<string[]> {
    console.log('[scraper] Discovering URLs...');
    const allUrls = new Set<string>();
    
    // Add start URLs
    startUrls.forEach(url => allUrls.add(url));
    
    // Try to find sitemaps
    for (const baseUrl of startUrls) {
      const sitemapUrls = await this.findSitemapUrls(baseUrl);
      sitemapUrls.forEach(url => {
        if (this.isValidDocUrl(url)) {
          allUrls.add(url);
        }
      });
    }
    
    // If no sitemap, do recursive discovery
    if (allUrls.size <= startUrls.length) {
      console.log('📍 No sitemap found, using recursive discovery');
      const discoveredUrls = await this.recursiveUrlDiscovery(startUrls);
      discoveredUrls.forEach(url => allUrls.add(url));
    }

    console.log(`[scraper] Discovery complete. Total URLs: ${allUrls.size}`);
    return Array.from(allUrls);
  }

  private async findSitemapUrls(baseUrl: string): Promise<string[]> {
    console.log(`[scraper] Looking for sitemaps at ${baseUrl}`);
    const sitemapUrls: string[] = [];
    const potentialSitemaps = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/robots.txt`
    ];

    for (const sitemapUrl of potentialSitemaps) {
      try {
        const page = await this.browser!.newPage();
        const response = await page.goto(sitemapUrl);
        
        if (response?.ok()) {
          const content = await page.content();
          
          if (sitemapUrl.endsWith('robots.txt')) {
            // Extract sitemap URLs from robots.txt
            const sitemapMatches = content.match(/Sitemap:\s*(https?:\/\/[^\s]+)/gi);
            if (sitemapMatches) {
              const extractedUrls = await this.parseSitemapUrls(sitemapMatches[0].split(': ')[1]);
              sitemapUrls.push(...extractedUrls);
            }
          } else {
            // Parse XML sitemap
            const urls = await this.parseSitemapUrls(content);
            sitemapUrls.push(...urls);
          }
        }
        
        await page.close();
      } catch (error) {
        console.log(`ℹ️ Could not access ${sitemapUrl}`);
      }
    }

    console.log(`[scraper] Sitemap discovery for ${baseUrl} found ${sitemapUrls.length} URLs`);
    return sitemapUrls;
  }

  private async parseSitemapUrls(xmlContent: string): Promise<string[]> {
    const urls: string[] = [];
    
    // Simple regex to extract URLs from sitemap XML
    const urlMatches = xmlContent.match(/<loc>(.*?)<\/loc>/g);
    
    if (urlMatches) {
      for (const match of urlMatches) {
        const url = match.replace(/<\/?loc>/g, '').trim();
        if (this.isValidDocUrl(url)) {
          urls.push(url);
        }
      }
    }

    console.log(`[scraper] Parsed ${urls.length} URLs from sitemap`);
    return urls;
  }

  private async recursiveUrlDiscovery(startUrls: string[]): Promise<string[]> {
    console.log('[scraper] Starting recursive URL discovery...');
    const discovered = new Set<string>();
    const toVisit = [...startUrls];
    let depth = 0;
    const maxDepth = 3;

    while (toVisit.length > 0 && depth < maxDepth) {
      const currentBatch = toVisit.splice(0, 20); // Process in batches
      
      for (const url of currentBatch) {
        if (discovered.has(url)) continue;
        
        try {
          const links = await this.extractLinksFromPage(url);
          links.forEach(link => {
            if (this.isValidDocUrl(link) && !discovered.has(link)) {
              discovered.add(link);
              if (depth < maxDepth - 1) {
                toVisit.push(link);
              }
            }
          });
          
          discovered.add(url);
        } catch (error) {
          console.log(`⚠️ Failed to discover links from ${url}`);
        }
        
        // Be respectful
        await this.sleep(500);
      }
      
      depth++;
      console.log(`🔍 Discovery depth ${depth}: Found ${discovered.size} URLs`);
    }

    console.log(`[scraper] Recursive discovery found ${discovered.size} URLs`);
    return Array.from(discovered);
  }

  private async extractLinksFromPage(url: string): Promise<string[]> {
    console.log(`[scraper] Extracting links from page: ${url}`);
    const page = await this.browser!.newPage();
    const links: string[] = [];
    
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      const pageLinks = await page.evaluate(() => {
        const linkElements = document.querySelectorAll('a[href]');
        return Array.from(linkElements).map(a => (a as HTMLAnchorElement).href);
      });

      for (const link of pageLinks) {
        const absoluteUrl = new URL(link, url).href;
        if (this.isValidDocUrl(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      }
      
    } catch (error) {
      console.log(`Failed to extract links from ${url}:`, error.message);
    } finally {
      await page.close();
    }

    console.log(`[scraper] Extracted ${links.length} links from ${url}`);
    return links;
  }

  private isValidDocUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      
      // Must be from allowed domains
      if (!['docs.atlan.com', 'developer.atlan.com'].includes(parsedUrl.hostname)) {
        return false;
      }

      const path = parsedUrl.pathname.toLowerCase();
      
      // Block unwanted paths
      if (this.blockedPaths.some(blocked => path.includes(blocked))) {
        return false;
      }
      
      // Check allowed paths for the specific domain
      const domainPaths = this.allowedPaths[parsedUrl.hostname];
      if (domainPaths) {
        return domainPaths.some(allowed => path.includes(allowed)) || 
               path === '/' || 
               path.split('/').filter(Boolean).length <= 1;
      }
      
      return false;
    } catch {
      return false;
    }
  }

  private async crawlUrls(urls: string[]): Promise<ScrapedContent[]> {
    console.log(`[scraper] Crawling ${Math.min(urls.length, this.maxPages)} prioritized URLs`);
    const results: ScrapedContent[] = [];
    const prioritizedUrls = this.prioritizeUrls(urls);
    
    for (let i = 0; i < Math.min(prioritizedUrls.length, this.maxPages); i++) {
      const url = prioritizedUrls[i];
      
      if (this.visited.has(url)) continue;
      
      try {
        console.log(`📖 Scraping (${i + 1}/${Math.min(prioritizedUrls.length, this.maxPages)}): ${url}`);
        
        const content = await this.scrapePage(url);
        if (content && this.isValueableContent(content)) {
          results.push(content);
        }
        
        this.visited.add(url);
        
        // Be respectful - add delay between requests
        await this.sleep(1000 + Math.random() * 1000);
        
      } catch (error) {
        console.error(`❌ Failed to scrape ${url}:`, error.message);
      }
    }

    console.log(`[scraper] Crawl complete. Scraped ${results.length} valuable pages`);
    return results;
  }

  private prioritizeUrls(urls: string[]): string[] {
    return urls.sort((a, b) => {
      const scoreA = this.calculateUrlPriority(a);
      const scoreB = this.calculateUrlPriority(b);
      return scoreB - scoreA; // Higher score first
    });
  }

  private calculateUrlPriority(url: string): number {
    const path = new URL(url).pathname.toLowerCase();
    let score = 0;
    
    // High priority keywords
    const highPriorityKeywords = [
      'getting-started', 'overview', 'introduction', 'quickstart',
      'api', 'sdk', 'authentication', 'guide', 'tutorial'
    ];
    
    const mediumPriorityKeywords = [
      'how-to', 'best-practices', 'concepts', 'setup', 
      'integration', 'connector', 'lineage', 'glossary'
    ];

    // Check for high priority keywords
    if (highPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 10;
    }
    
    if (mediumPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 5;
    }
    
    // Prefer shorter paths (likely more important)
    const pathDepth = path.split('/').length;
    score += Math.max(0, 10 - pathDepth);
    
    // Root pages get higher priority
    if (path === '/' || path === '/index.html') {
      score += 15;
    }

    return score;
  }

  private async scrapePage(url: string): Promise<ScrapedContent | null> {
    console.log(`[scraper] Scraping page: ${url}`);
    const page = await this.browser!.newPage();
    
    try {
      // Set user agent
      await page.setExtraHTTPHeaders({
        'User-Agent': 'AtlanDocsBot/1.0 (+support@company.com)'
      });

      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Wait for dynamic content to load
      await page.waitForTimeout(2000);

      const content = await page.evaluate(() => {
        // Remove unwanted elements
        const unwantedSelectors = [
          'nav', 'header', 'footer', '.navigation', '.sidebar',
          '.advertisement', '.banner', '.cookie-notice', '.feedback',
          'script', 'style', '.social-share', '.comments'
        ];
        
        unwantedSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Find main content area
        const mainContent = document.querySelector('main') || 
                           document.querySelector('.content') ||
                           document.querySelector('.documentation') ||
                           document.querySelector('[role="main"]') ||
                           document.querySelector('.markdown-body') ||
                           document.body;

        // Extract structured content
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
          .map(h => h.textContent?.trim())
          .filter(Boolean) as string[];

        const breadcrumbs = Array.from(document.querySelectorAll('.breadcrumb a, .breadcrumbs a, nav ol a'))
          .map(a => a.textContent?.trim())
          .filter(Boolean) as string[];

        // Get clean text content
        const textContent = mainContent?.textContent?.trim() || '';
        
        // Clean up extra whitespace and normalize
        const cleanedContent = textContent
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n')
          .trim();

        return {
          title: document.title?.trim() || '',
          content: cleanedContent,
          headings,
          breadcrumbs,
          section: breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : '',
          lastModified: document.querySelector('meta[property="article:modified_time"]')?.getAttribute('content') || undefined
        };
      });

      if (content) {
        console.log(`[scraper] Scraped page: ${url} (title: ${content.title}, length: ${content.content.length})`);
      }

      return {
        url,
        ...content
      };

    } catch (error) {
      console.error(`Error scraping page ${url}:`, error.message);
      return null;
    } finally {
      await page.close();
    }
  }

  private isValueableContent(content: ScrapedContent): boolean {
    // Filter out low-value pages
    const minContentLength = 200;
    const title = content.title.toLowerCase();
    
    // Skip error pages, redirects, etc.
    if (title.includes('404') || 
        title.includes('error') || 
        title.includes('not found') ||
        content.content.length < minContentLength) {
      return false;
    }

    // Skip pages that are just navigation
    const contentWords = content.content.split(/\s+/).length;
    const headingWords = content.headings.join(' ').split(/\s+/).length;
    
    // If mostly headings, probably just a navigation page
    if (headingWords > contentWords * 0.3) {
      return false;
    }

    const isValuable = true; // /* ...existing logic... */;
    if (!isValuable) {
      console.log(`[scraper] Skipped low-value page: ${content.title}`);
    }
    return isValuable;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('[scraper] Browser instance cleaned up');
    }
  }
}

// Helper function to generate content hash for change detection
export function generateContentHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}