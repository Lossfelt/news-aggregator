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
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'FeedsApp/1.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Failed to fetch feed: ${response.status}` }),
      };
    }

    const contentType = response.headers.get('content-type') || 'application/xml';
    const body = await response.text();

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
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
