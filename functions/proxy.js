// Helper function to fetch with timeout and retry
async function fetchWithRetry(url, options = {}, retries = 2, timeout = 10000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // If we got a response, return it (even if it's an error status)
      return response;
    } catch (error) {
      // If this was the last retry, throw the error
      if (i === retries) {
        throw error;
      }

      // If it's a timeout or network error, wait before retrying
      if (error.name === 'AbortError' || error.message.includes('fetch')) {
        console.log(`Retry ${i + 1}/${retries} for ${url}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } else {
        throw error; // For other errors, don't retry
      }
    }
  }
}

// Buffered Netlify Function responses are limited to 6 MB. Keep a margin for
// function-response serialization while retaining the newest RSS items.
const MAX_PROXY_BODY_BYTES = 4 * 1024 * 1024;

function limitRssResponseSize(xml, maxBytes = MAX_PROXY_BODY_BYTES) {
  if (Buffer.byteLength(xml, 'utf8') <= maxBytes) return xml;

  const firstItemIndex = xml.search(/<item\b/i);
  const channelEndMatch = /<\/channel\s*>/i.exec(xml);
  if (firstItemIndex === -1 || !channelEndMatch || channelEndMatch.index <= firstItemIndex) {
    return xml;
  }

  const itemSection = xml.slice(firstItemIndex, channelEndMatch.index);
  const items = itemSection.match(/<item\b[\s\S]*?<\/item\s*>/gi);
  if (!items?.length) return xml;

  const prefix = xml.slice(0, firstItemIndex);
  const suffix = xml.slice(channelEndMatch.index);
  let limited = prefix;

  for (const item of items) {
    if (Buffer.byteLength(limited + item + suffix, 'utf8') > maxBytes) break;
    limited += item;
  }

  return limited + suffix;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const feedUrl = event.queryStringParameters?.url;

  if (!feedUrl) {
    return {
      statusCode: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing url parameter' }),
    };
  }

  try {
    console.log('Fetching feed:', feedUrl);

    const response = await fetchWithRetry(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FeedsApp/1.0; +https://feeds.netlify.app)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      redirect: 'follow',
    }, 2, 15000); // 2 retries, 15 second timeout

    if (!response.ok) {
      console.error(`Failed to fetch ${feedUrl}: ${response.status}`);
      return {
        statusCode: response.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Failed to fetch feed: ${response.status}` }),
      };
    }

    const contentType = response.headers.get('content-type') || 'application/xml';
    const body = limitRssResponseSize(await response.text());

    console.log(`Successfully fetched ${feedUrl}, length: ${body.length}`);

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
      },
      body,
    };
  } catch (error) {
    console.error('Error fetching feed:', error);
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.name === 'AbortError' ? 'Request timeout' : error.message
      }),
    };
  }
};
