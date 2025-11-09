/**
 * Universal Feed Parser - Supports multiple feed formats
 * Handles RSS 2.0, RSS 1.0, Atom, RDF, and JSON Feed formats
 */

/**
 * Parse any feed format and return normalized items
 * @param {string} content - The feed content (XML or JSON)
 * @param {string} contentType - The content type header (optional)
 * @returns {Array} Array of normalized feed items
 */
export function parseFeed(content, contentType = '') {
  // Try to detect format
  const trimmed = content.trim();

  // Check if it's JSON Feed
  if (trimmed.startsWith('{') || contentType.includes('json')) {
    return parseJsonFeed(trimmed);
  }

  // Otherwise, parse as XML
  return parseXmlFeed(trimmed);
}

/**
 * Parse XML-based feeds (RSS, Atom, RDF)
 */
function parseXmlFeed(xml) {
  const items = [];

  // Detect feed type
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');
  const isRss1 = xml.includes('<rdf:RDF') || xml.includes('xmlns="http://purl.org/rss/1.0/"');
  const isRss2 = xml.includes('<rss') && xml.includes('version="2.0"');

  // Try multiple parsing strategies
  if (isAtom || xml.includes('<entry')) {
    items.push(...parseAtomEntries(xml));
  }

  if (isRss2 || xml.includes('<item>')) {
    items.push(...parseRss2Items(xml));
  }

  if (isRss1 || xml.includes('<item ')) {
    items.push(...parseRss1Items(xml));
  }

  // If no specific format detected, try all parsers
  if (items.length === 0) {
    items.push(...parseRss2Items(xml));
    items.push(...parseAtomEntries(xml));
    items.push(...parseRss1Items(xml));
  }

  // Deduplicate by URL
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

/**
 * Parse RSS 2.0 items
 */
function parseRss2Items(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const item = extractFieldsFromXml(block, {
      title: ['title'],
      url: ['link', 'guid[isPermaLink="true"]', 'guid'],
      guid: ['guid', 'link'],
      pubDate: ['pubDate', 'dc:date', 'published'],
      description: ['description', 'content:encoded', 'summary'],
      author: ['author', 'dc:creator', 'creator'],
      categories: ['category'],
      enclosure: ['enclosure']
    });

    if (item.url) {
      items.push(normalizeItem(item));
    }
  }

  return items;
}

/**
 * Parse Atom entries
 */
function parseAtomEntries(xml) {
  const items = [];
  const entryRegex = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    // Extract link URL (handle multiple link elements)
    let url = '';
    const linkMatches = block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi);
    for (const linkMatch of linkMatches) {
      const attrs = linkMatch[1];
      const rel = (attrs.match(/rel=["']([^"']+)["']/i) || [])[1] || 'alternate';
      const href = (attrs.match(/href=["']([^"']+)["']/i) || [])[1] || '';

      if (href && (rel === 'alternate' || !url)) {
        url = href;
        if (rel === 'alternate') break; // Prefer alternate link
      }
    }

    const item = extractFieldsFromXml(block, {
      title: ['title'],
      guid: ['id', 'guid'],
      pubDate: ['updated', 'published', 'modified'],
      description: ['summary', 'content', 'subtitle'],
      author: ['author/name', 'author', 'dc:creator'],
      categories: ['category']
    });

    item.url = url || item.guid;

    if (item.url) {
      items.push(normalizeItem(item));
    }
  }

  return items;
}

/**
 * Parse RSS 1.0/RDF items
 */
function parseRss1Items(xml) {
  const items = [];
  // RSS 1.0 uses namespaced items
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const item = extractFieldsFromXml(block, {
      title: ['title', 'dc:title'],
      url: ['link', 'rdf:about'],
      guid: ['guid', 'dc:identifier', 'link'],
      pubDate: ['dc:date', 'pubDate', 'dcterms:created'],
      description: ['description', 'dc:description', 'content:encoded'],
      author: ['dc:creator', 'author'],
      categories: ['dc:subject', 'category']
    });

    // Check rdf:about attribute on item element
    if (!item.url) {
      const aboutMatch = match[0].match(/rdf:about=["']([^"']+)["']/i);
      if (aboutMatch) item.url = aboutMatch[1];
    }

    if (item.url) {
      items.push(normalizeItem(item));
    }
  }

  return items;
}

/**
 * Parse JSON Feed format
 */
function parseJsonFeed(jsonStr) {
  try {
    const feed = JSON.parse(jsonStr);
    const items = [];

    // Check if it's a valid JSON Feed
    if (feed.version && feed.version.startsWith('https://jsonfeed.org/version/')) {
      const feedItems = feed.items || [];

      for (const item of feedItems) {
        const normalizedItem = {
          title: item.title || item.summary || '',
          url: item.url || item.external_url || item.id || '',
          guid: item.id || item.url || '',
          pubDate: item.date_published || item.date_modified || '',
          description: item.content_html || item.content_text || item.summary || '',
          author: item.author?.name || item.authors?.[0]?.name || '',
          categories: item.tags || [],
          enclosure: item.attachments?.[0]?.url || ''
        };

        if (normalizedItem.url) {
          items.push(normalizeItem(normalizedItem));
        }
      }
    }

    return items;
  } catch (error) {
    console.error('Failed to parse JSON Feed:', error);
    return [];
  }
}

/**
 * Extract fields from XML block using multiple possible paths
 */
function extractFieldsFromXml(xmlBlock, fieldMappings) {
  const item = {};

  for (const [field, paths] of Object.entries(fieldMappings)) {
    for (const path of paths) {
      if (item[field]) break; // Already found this field

      // Handle nested paths (e.g., "author/name")
      if (path.includes('/')) {
        const parts = path.split('/');
        let pattern = '';
        for (let i = 0; i < parts.length; i++) {
          if (i === 0) {
            pattern = `<${parts[i]}\\b[^>]*>([\\s\\S]*?)<\\/${parts[i]}>`;
          } else {
            const parentMatch = xmlBlock.match(new RegExp(pattern, 'i'));
            if (parentMatch) {
              const parentBlock = parentMatch[1];
              const childPattern = `<${parts[i]}\\b[^>]*>([\\s\\S]*?)<\\/${parts[i]}>`;
              const childMatch = parentBlock.match(new RegExp(childPattern, 'i'));
              if (childMatch) {
                item[field] = cleanText(childMatch[1]);
              }
            }
            break;
          }
        }
      } else {
        // Simple path
        const pattern = `<${path}\\b[^>]*>([\\s\\S]*?)<\\/${path}>`;
        const match = xmlBlock.match(new RegExp(pattern, 'i'));
        if (match) {
          if (field === 'categories' && !Array.isArray(item[field])) {
            // Handle multiple categories
            item[field] = [];
            const catRegex = new RegExp(pattern, 'gi');
            let catMatch;
            while ((catMatch = catRegex.exec(xmlBlock)) !== null) {
              item[field].push(cleanText(catMatch[1]));
            }
          } else if (!item[field]) {
            item[field] = cleanText(match[1]);
          }
        }

        // Also check for self-closing tags with attributes
        if (!item[field] && field === 'enclosure') {
          const enclosureMatch = xmlBlock.match(/<enclosure\b([^>]*)\/?>/i);
          if (enclosureMatch) {
            const url = (enclosureMatch[1].match(/url=["']([^"']+)["']/i) || [])[1];
            if (url) item[field] = url;
          }
        }
      }
    }

    // Ensure default values
    if (!item[field]) {
      if (field === 'categories') {
        item[field] = [];
      } else {
        item[field] = '';
      }
    }
  }

  return item;
}

/**
 * Clean and normalize text content
 */
function cleanText(text) {
  if (!text) return '';

  // Remove CDATA sections
  let cleaned = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

  // Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // Remove HTML tags for plain text fields
  cleaned = cleaned.replace(/<[^>]+>/g, '');

  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&#160;': ' ',
    '&mdash;': '—',
    '&ndash;': '–',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™'
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }

  // Decode numeric entities
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => String.fromCharCode(parseInt(num)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));

  return decoded;
}

/**
 * Normalize feed item structure
 */
function normalizeItem(item) {
  return {
    url: normalizeUrl(item.url || ''),
    title: item.title || 'Untitled',
    guid: item.guid || item.url || '',
    pubDate: normalizeDateString(item.pubDate || ''),
    description: truncateDescription(item.description || ''),
    author: item.author || '',
    categories: Array.isArray(item.categories) ? item.categories : [],
    enclosure: item.enclosure || ''
  };
}

/**
 * Normalize URL format
 */
function normalizeUrl(url) {
  if (!url) return '';

  let normalized = url.trim();

  // Remove common URL wrappers
  normalized = normalized.replace(/^<(.+)>$/, '$1');
  normalized = normalized.replace(/^\[(.+)\]$/, '$1');

  // Ensure protocol
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.href;
  } catch {
    return normalized;
  }
}

/**
 * Normalize date strings to ISO format
 */
function normalizeDateString(dateStr) {
  if (!dateStr) return new Date().toISOString();

  try {
    // Handle common date formats
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Fall through
  }

  // Try parsing RFC 822 date format (common in RSS)
  const rfc822Match = dateStr.match(/(\w+),\s+(\d+)\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (rfc822Match) {
    const [, , day, month, year, hour, minute, second] = rfc822Match;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.findIndex(m => month.startsWith(m));
    if (monthIndex !== -1) {
      const date = new Date(year, monthIndex, day, hour, minute, second);
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * Truncate description to reasonable length
 */
function truncateDescription(description, maxLength = 500) {
  if (!description || description.length <= maxLength) {
    return description;
  }

  // Try to truncate at a word boundary
  const truncated = description.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Detect feed type from content
 */
export function detectFeedType(content) {
  const trimmed = content.trim();

  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed);
      if (json.version && json.version.includes('jsonfeed.org')) {
        return 'json-feed';
      }
    } catch {
      // Not JSON
    }
  }

  if (trimmed.includes('xmlns="http://www.w3.org/2005/Atom"')) {
    return 'atom';
  }

  if (trimmed.includes('<rdf:RDF') || trimmed.includes('xmlns="http://purl.org/rss/1.0/"')) {
    return 'rss-1.0';
  }

  if (trimmed.includes('<rss') && trimmed.includes('version="2.0"')) {
    return 'rss-2.0';
  }

  if (trimmed.includes('<rss')) {
    return 'rss';
  }

  if (trimmed.includes('<feed')) {
    return 'atom';
  }

  return 'unknown';
}

/**
 * Validate feed URL
 */
export function isValidFeedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}