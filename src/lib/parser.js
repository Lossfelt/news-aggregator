function getTextContent(element, selector) {
  const el = element.querySelector(selector);
  return el ? el.textContent?.trim() || '' : '';
}

function getTextByTagName(element, tagName) {
  // Works for namespaced tags like "media:description" (getElementsByTagName
  // matches the qualified name, unlike querySelector which treats : as CSS pseudo).
  const els = element.getElementsByTagName(tagName);
  return els.length > 0 ? els[0].textContent?.trim() || '' : '';
}

function getAttrContent(element, selector, attr) {
  const el = element.querySelector(selector);
  return el ? el.getAttribute(attr) || '' : '';
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function cleanHtmlText(html, { preserveLineBreaks = false } = {}) {
  let s = html || '';
  if (preserveLineBreaks) {
    // Convert block-level tags and <br> to newlines before stripping
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<\/(ul|ol|blockquote)>/gi, '\n\n');
  }
  s = s.replace(/<[^>]*>/g, '');
  s = decodeHtmlEntities(s);
  // Remove invisible formatting characters (word joiner, zero-width spaces, etc.)
  s = s.replace(/[\u2060\u200B-\u200D\uFEFF]/g, '');
  if (preserveLineBreaks) {
    // Collapse spaces/tabs only (keep newlines), then cap consecutive newlines
    s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  } else {
    s = s.replace(/\s+/g, ' ').trim();
  }
  return s;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

function generateId(title, link, pubDate) {
  const str = `${title}-${link}-${pubDate}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function parseRSSItem(item, source) {
  const title = getTextContent(item, 'title');
  const link = getTextContent(item, 'link') || getAttrContent(item, 'link', 'href');
  const description = getTextContent(item, 'description') || getTextContent(item, 'summary');
  const pubDateStr = getTextContent(item, 'pubDate') || getTextContent(item, 'published') || getTextContent(item, 'date');
  const pubDate = parseDate(pubDateStr);

  const cleanDescription = cleanHtmlText(description).substring(0, 300);
  const fullDescription = cleanHtmlText(description, { preserveLineBreaks: true });

  return {
    id: generateId(title, link, pubDateStr),
    title,
    link,
    description: cleanDescription,
    fullDescription: fullDescription.length > 300 ? fullDescription : undefined,
    pubDate,
    source: source.name,
  };
}

function parseAtomEntry(entry, source) {
  const title = getTextContent(entry, 'title');
  const link = getAttrContent(entry, 'link[rel="alternate"]', 'href') ||
               getAttrContent(entry, 'link', 'href') ||
               getTextContent(entry, 'link');
  // YouTube feeds use media:description (namespaced); fall back to standard Atom fields
  const description = getTextByTagName(entry, 'media:description') ||
                      getTextContent(entry, 'summary') ||
                      getTextContent(entry, 'content');
  const pubDateStr = getTextContent(entry, 'published') || getTextContent(entry, 'updated');
  const pubDate = parseDate(pubDateStr);

  const cleanDescription = cleanHtmlText(description).substring(0, 300);
  const fullDescription = cleanHtmlText(description, { preserveLineBreaks: true });

  return {
    id: generateId(title, link, pubDateStr),
    title,
    link,
    description: cleanDescription,
    fullDescription: fullDescription.length > 300 ? fullDescription : undefined,
    pubDate,
    source: source.name,
  };
}

export function parseFeed(xml, source) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    console.warn(`Parse error for ${source.name}:`, parseError.textContent);
    return [];
  }

  const articles = [];

  // Try RSS format
  const rssItems = doc.querySelectorAll('item');
  if (rssItems.length > 0) {
    rssItems.forEach(item => {
      const article = parseRSSItem(item, source);
      if (article.title && article.link) {
        articles.push(article);
      }
    });
    return articles;
  }

  // Try Atom format
  const atomEntries = doc.querySelectorAll('entry');
  if (atomEntries.length > 0) {
    atomEntries.forEach(entry => {
      const article = parseAtomEntry(entry, source);
      if (article.title && article.link) {
        articles.push(article);
      }
    });
    return articles;
  }

  console.warn(`No items found in feed: ${source.name}`);
  return articles;
}

export function sortByDate(articles) {
  return [...articles].sort((a, b) => {
    if (!a.pubDate && !b.pubDate) return 0;
    if (!a.pubDate) return 1;
    if (!b.pubDate) return -1;
    return b.pubDate.getTime() - a.pubDate.getTime();
  });
}
