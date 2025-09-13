// lib/scraper.ts
interface ScrapedDocument {
  url: string;
  title: string;
  content: string;
  headings: string[];
  breadcrumbs: string[];
  section: string;
  lastModified?: string;
}

export class AtlanDocsScraper {
  private visited = new Set<string>();
  private readonly maxPages = 200;
  
  private readonly allowedPaths = {
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

  private readonly blockedPaths = [
    '/changelog/', '/release-notes/', '/blog/', '/community/',
    '/download/', '/legal/', '/privacy/', '/terms/', '/support/',
    '/contact/', '/about/', '/careers/', '/pricing/',
    '.pdf', '.zip', '.jpg', '.png', '.gif', '/images/', '/assets/'
  ];

  async scrapeDocumentation(): Promise<ScrapedDocument[]> {
    console.log('🚀 [scraper] Starting Atlan documentation scraping...');
    try {
      const startUrls = [
        'https://docs.atlan.com/',
        'https://developer.atlan.com/'
      ];

      const allUrls = await this.discoverUrls(startUrls);
      console.log(`[scraper] Discovered ${allUrls.length} URLs to process`);

      const results = await this.scrapeUrls(allUrls);
      console.log(`[scraper] Successfully scraped ${results.length} pages`);
      return results;
    } catch (error) {
      console.error('[scraper] Scraping error:', error);
      throw error;
    }
  }

  private async discoverUrls(startUrls: string[]): Promise<string[]> {
    console.log('[scraper] Discovering URLs...');
    const allUrls = new Set<string>();
    startUrls.forEach(url => allUrls.add(url));
    
    // Try to find sitemaps first
    for (const baseUrl of startUrls) {
      const sitemapUrls = await this.findSitemapUrls(baseUrl);
      sitemapUrls.forEach(url => {
        if (this.isValidDocUrl(url)) {
          allUrls.add(url);
        }
      });
    }
    
    // If no sitemap found, do basic recursive discovery
    if (allUrls.size <= startUrls.length) {
      console.log('📍 No sitemap found, using recursive discovery');
      const discoveredUrls = await this.recursiveUrlDiscovery(startUrls.slice(0, 2)); // Limit for performance
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
      `${baseUrl}/sitemap_index.xml`
    ];

    for (const sitemapUrl of potentialSitemaps) {
      try {
        const response = await fetch(sitemapUrl, {
          headers: {
            'User-Agent': 'AtlanDocsBot/1.0 (Documentation Scraper)'
          }
        });
        
        if (response.ok) {
          const xmlContent = await response.text();
          const urls = this.parseSitemapUrls(xmlContent);
          sitemapUrls.push(...urls);
        }
      } catch (error) {
        console.log(`ℹ️ Could not access ${sitemapUrl}`);
      }
    }

    console.log(`[scraper] Sitemap discovery for ${baseUrl} found ${sitemapUrls.length} URLs`);
    return sitemapUrls;
  }

  private parseSitemapUrls(xmlContent: string): string[] {
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

    return urls;
  }

  private async recursiveUrlDiscovery(startUrls: string[]): Promise<string[]> {
    console.log('[scraper] Starting recursive URL discovery...');
    const discovered = new Set<string>();
    const toVisit = [...startUrls];
    let depth = 0;
    const maxDepth = 2; // Reduced for Vercel timeout limits

    while (toVisit.length > 0 && depth < maxDepth) {
      const currentBatch = toVisit.splice(0, 10); // Smaller batches
      
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
        
        // Rate limiting
        await this.sleep(300);
      }
      
      depth++;
      console.log(`🔍 Discovery depth ${depth}: Found ${discovered.size} URLs`);
    }

    console.log(`[scraper] Recursive discovery found ${discovered.size} URLs`);
    return Array.from(discovered);
  }

  private async extractLinksFromPage(url: string): Promise<string[]> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AtlanDocsBot/1.0 (Documentation Scraper)'
        }
      });
      
      if (!response.ok) return [];

      const html = await response.text();
      const links: string[] = [];
      
      // Simple regex to extract href attributes
      const hrefMatches = html.match(/href=["'](.*?)["']/gi);
      
      if (hrefMatches) {
        for (const match of hrefMatches) {
          const href = match.replace(/href=["']|["']/g, '');
          try {
            const absoluteUrl = new URL(href, url).href;
            if (this.isValidDocUrl(absoluteUrl)) {
              links.push(absoluteUrl);
            }
          } catch {
            // Invalid URL, skip
          }
        }
      }

      return links;
    } catch (error) {
      console.log(`Failed to extract links from ${url}:`, error.message);
      return [];
    }
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
      const domainPaths = this.allowedPaths[parsedUrl.hostname as keyof typeof this.allowedPaths];
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

  private async scrapeUrls(urls: string[]): Promise<ScrapedDocument[]> {
    console.log(`[scraper] Scraping ${Math.min(urls.length, this.maxPages)} prioritized URLs`);
    const results: ScrapedDocument[] = [];
    const prioritizedUrls = this.prioritizeUrls(urls);
    
    // Process in batches to avoid timeout
    const batchSize = 5;
    for (let i = 0; i < Math.min(prioritizedUrls.length, this.maxPages); i += batchSize) {
      const batch = prioritizedUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        if (this.visited.has(url)) return null;
        
        try {
          console.log(`[scraper] Scraping page: ${url}`);
          const content = await this.scrapePage(url);
          this.visited.add(url);
          if (content) {
            console.log(`[scraper] Scraped page: ${url} (title: ${content.title}, length: ${content.content.length})`);
          }
          return content && this.isValueableContent(content) ? content : null;
        } catch (error) {
          console.error(`[scraper] Failed to scrape ${url}:`, error.message);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter(Boolean) as ScrapedDocument[];
      results.push(...validResults);
      
      // Rate limiting between batches
      await this.sleep(1000);
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

    if (highPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 10;
    }
    
    if (mediumPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 5;
    }
    
    // Prefer shorter paths
    const pathDepth = path.split('/').length;
    score += Math.max(0, 10 - pathDepth);
    
    // Root pages get higher priority
    if (path === '/' || path === '/index.html') {
      score += 15;
    }

    return score;
  }

  private async scrapePage(url: string): Promise<ScrapedDocument | null> {
    console.log(`[scraper] Scraping page: ${url}`);
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AtlanDocsBot/1.0 (Documentation Scraper)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      
      // Simple HTML parsing without external libraries
      const content = this.extractContentFromHTML(html, url);
      
      return content;

    } catch (error) {
      console.error(`Error scraping page ${url}:`, error.message);
      return null;
    }
  }

  private extractContentFromHTML(html: string, url: string): ScrapedDocument {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Remove script and style tags
    let cleanHtml = html.replace(/<script[^>]*>.*?<\/script>/gis, '');
    cleanHtml = cleanHtml.replace(/<style[^>]*>.*?<\/style>/gis, '');
    
    // Extract headings
    const headings: string[] = [];
    const headingMatches = cleanHtml.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi);
    if (headingMatches) {
      headingMatches.forEach(match => {
        const text = match.replace(/<[^>]*>/g, '').trim();
        if (text) headings.push(text);
      });
    }

    // Extract breadcrumbs
    const breadcrumbs: string[] = [];
    const breadcrumbMatches = cleanHtml.match(/class=["|'].*?breadcrumb.*?["|'][^>]*>.*?<\/[^>]+>/gi);
    if (breadcrumbMatches) {
      breadcrumbMatches.forEach(match => {
        const linkMatches = match.match(/>([^<]+)</g);
        if (linkMatches) {
          linkMatches.forEach(link => {
            const text = link.replace(/[><]/g, '').trim();
            if (text && !breadcrumbs.includes(text)) {
              breadcrumbs.push(text);
            }
          });
        }
      });
    }

    // Extract main content (remove HTML tags)
    let textContent = cleanHtml.replace(/<[^>]*>/g, ' ');
    textContent = textContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    return {
      url,
      title,
      content: textContent,
      headings,
      breadcrumbs,
      section: breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : ''
    };
  }

  private isValueableContent(content: ScrapedDocument): boolean {
    const minContentLength = 200;
    const title = content.title.toLowerCase();
    
    // Skip error pages
    if (title.includes('404') || 
        title.includes('error') || 
        title.includes('not found') ||
        content.content.length < minContentLength) {
      return false;
    }

    // Skip pages that are mostly navigation
    const contentWords = content.content.split(/\s+/).length;
    const headingWords = content.headings.join(' ').split(/\s+/).length;
    
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
}