// lib/scraper.ts
interface ScrapedDocument {
  url: string;
  title: string;
  content: string;
  headings: string[];
  breadcrumbs: string[];
  section: string;
  lastModified?: string;
  hyperlinks?: string[];
}

export class AtlanDocsScraper {
  private visited = new Set<string>();
  private readonly maxPages = 200;
  
  private readonly allowedPaths = {
    'docs.atlan.com': [
      '/guide/', '/concepts/', '/setup/', '/integrations/', 
      '/getting-started/', '/overview/', '/tutorial/', '/how-to/',
      '/best-practices/', '/glossary/', '/lineage/', '/connector/',
      '/sso/', '/authentication/', '/api/', '/sdk/', '/apps/'
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
    '.pdf', '.zip', '.jpg', '.png', '.gif', '/images/', '/assets/', '.xml'
  ];

  async scrapeDocumentation(): Promise<ScrapedDocument[]> {
    console.log('🚀 [scraper] Starting Atlan documentation scraping...');
    try {
      const startUrls = [
        'https://docs.atlan.com/apps/connectors/etl-tools/fivetran/how-tos/set-up-fivetran',
        'https://docs.atlan.com/apps/connectors/data-warehouses/amazon-redshift/how-tos/set-up-amazon-redshift',
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
      const discoveredUrls = await this.recursiveUrlDiscovery(startUrls.slice(0, 2));
      discoveredUrls.forEach(url => allUrls.add(url));
    }

    console.log(`[scraper] Discovery complete. Total URLs: ${allUrls.size}`);
    return Array.from(allUrls);
  }

  private async findSitemapUrls(baseUrl: string): Promise<string[]> {
    console.log(`[scraper] Looking for sitemaps at ${baseUrl}`);
    const sitemapUrls: string[] = [];
    const domain = new URL(baseUrl).origin;
    const potentialSitemaps = [
      `${domain}/sitemap.xml`,
      `${domain}/sitemap_index.xml`
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
    const maxDepth = 3; // Increased depth to find more pages

    while (toVisit.length > 0 && depth < maxDepth && discovered.size < this.maxPages) {
      const currentBatch = toVisit.splice(0, 8);
      
      for (const url of currentBatch) {
        if (discovered.has(url)) continue;
        
        try {
          const links = await this.extractLinksFromPage(url);
          links.forEach(link => {
            if (this.isValidDocUrl(link) && !discovered.has(link) && discovered.size < this.maxPages) {
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
        
        await this.sleep(200);
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
      return this.extractHyperlinksFromHTML(html, url);
    } catch (error) {
      console.log(`Failed to extract links from ${url}:`, error.message);
      return [];
    }
  }

  /**
   * Enhanced hyperlink extraction that handles Next.js dynamic links properly
   */
  private extractHyperlinksFromHTML(html: string, currentUrl: string): string[] {
    const links: string[] = [];
    const currentUrlObj = new URL(currentUrl);
    
    // Multiple patterns to catch different href formats
    const hrefPatterns = [
      /href\s*=\s*["']([^"']+)["']/gi,      // Standard href
      /to\s*=\s*["']([^"']+)["']/gi,        // Next.js Link component 'to' prop
      /pathname\s*=\s*["']([^"']+)["']/gi   // pathname in Link components
    ];

    for (const pattern of hrefPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const href = match[1].trim();
        const absoluteUrl = this.resolveUrl(href, currentUrlObj);
        
        if (absoluteUrl && this.isValidDocUrl(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      }
    }

    // Also look for data attributes that might contain URLs (common in SPAs)
    const dataHrefMatches = html.match(/data-href\s*=\s*["']([^"']+)["']/gi);
    if (dataHrefMatches) {
      for (const match of dataHrefMatches) {
        const hrefMatch = match.match(/data-href\s*=\s*["']([^"']+)["']/i);
        if (hrefMatch && hrefMatch[1]) {
          const absoluteUrl = this.resolveUrl(hrefMatch[1], currentUrlObj);
          if (absoluteUrl && this.isValidDocUrl(absoluteUrl)) {
            links.push(absoluteUrl);
          }
        }
      }
    }

    // Remove duplicates
    return [...new Set(links)];
  }

  /**
   * Improved URL resolution that handles various formats
   */
  private resolveUrl(href: string, baseUrl: URL): string | null {
    try {
      // Skip empty hrefs and anchors
      if (!href || href.startsWith('#') || href === '/') {
        return null;
      }

      // Handle mailto, tel, javascript: etc.
      if (href.match(/^(mailto:|tel:|javascript:|data:)/i)) {
        return null;
      }

      let resolvedUrl: URL;

      // Absolute URL
      if (href.match(/^https?:\/\//i)) {
        resolvedUrl = new URL(href);
      }
      // Protocol-relative URL
      else if (href.startsWith('//')) {
        resolvedUrl = new URL(`${baseUrl.protocol}${href}`);
      }
      // Root-relative URL (starts with /)
      else if (href.startsWith('/')) {
        resolvedUrl = new URL(href, `${baseUrl.protocol}//${baseUrl.host}`);
      }
      // Relative URL
      else {
        resolvedUrl = new URL(href, baseUrl.href);
      }

      // Clean up the URL
      resolvedUrl.hash = ''; // Remove hash
      
      // Remove trailing slash for consistency (except for root)
      let cleanUrl = resolvedUrl.href;
      if (cleanUrl.endsWith('/') && resolvedUrl.pathname !== '/') {
        cleanUrl = cleanUrl.slice(0, -1);
      }

      return cleanUrl;
    } catch (error) {
      console.log(`Failed to resolve URL: ${href} with base ${baseUrl.href}`);
      return null;
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
      
      await this.sleep(1000);
    }

    console.log(`[scraper] Crawl complete. Scraped ${results.length} valuable pages`);
    return results;
  }

  private prioritizeUrls(urls: string[]): string[] {
    return urls.sort((a, b) => {
      const scoreA = this.calculateUrlPriority(a);
      const scoreB = this.calculateUrlPriority(b);
      return scoreB - scoreA;
    });
  }

  private calculateUrlPriority(url: string): number {
    const path = new URL(url).pathname.toLowerCase();
    let score = 0;
    
    const highPriorityKeywords = [
      'getting-started', 'overview', 'introduction', 'quickstart', 'quick-start',
      'api', 'sdk', 'authentication', 'guide', 'tutorial', 'set-up', 'setup'
    ];
    
    const mediumPriorityKeywords = [
      'how-to', 'how-tos', 'best-practices', 'concepts', 
      'integration', 'connector', 'lineage', 'glossary', 'apps'
    ];

    if (highPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 10;
    }
    
    if (mediumPriorityKeywords.some(keyword => path.includes(keyword))) {
      score += 5;
    }
    
    const pathDepth = path.split('/').length;
    score += Math.max(0, 10 - pathDepth);
    
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

    // Use the enhanced hyperlink extraction
    const hyperlinks = this.extractHyperlinksFromHTML(html, url);

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
      section: breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2] : '',
      hyperlinks
    };
  }

  private isValueableContent(content: ScrapedDocument): boolean {
    const minContentLength = 200;
    const title = content.title.toLowerCase();

    // Skip error pages
    if (
      title.includes('404') ||
      title.includes('error') ||
      title.includes('not found') ||
      content.content.length < minContentLength
    ) {
      return false;
    }

    // Skip pages that are mostly navigation
    const contentWords = content.content.split(/\s+/).length;
    const headingWords = content.headings.join(' ').split(/\s+/).length;

    if (contentWords > 0 && headingWords / contentWords > 0.3) {
      // If there are enough hyperlinks, keep the page anyway
      if (content.hyperlinks && content.hyperlinks.length >= 5 && content.content.length > minContentLength / 2) {
        return true;
      }
      return false;
    }

    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}