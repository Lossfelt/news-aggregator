function getTextContent(element, selector) {
  const el = element.querySelector(selector);
  return el ? el.textContent?.trim() || '' : '';
}

function getAttrContent(element, selector, attr) {
  const el = element.querySelector(selector);
  return el ? el.getAttribute(attr) || '' : '';
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

  // Clean HTML from description
  const cleanDescription = description
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .substring(0, 300);

  return {
    id: generateId(title, link, pubDateStr),
    title,
    link,
    description: cleanDescription,
    pubDate,
    source: source.name,
  };
}

function parseAtomEntry(entry, source) {
  const title = getTextContent(entry, 'title');
  const link = getAttrContent(entry, 'link[rel="alternate"]', 'href') ||
               getAttrContent(entry, 'link', 'href') ||
               getTextContent(entry, 'link');
  const description = getTextContent(entry, 'summary') || getTextContent(entry, 'content');
  const pubDateStr = getTextContent(entry, 'published') || getTextContent(entry, 'updated');
  const pubDate = parseDate(pubDateStr);

  const cleanDescription = description
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .substring(0, 300);

  return {
    id: generateId(title, link, pubDateStr),
    title,
    link,
    description: cleanDescription,
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
