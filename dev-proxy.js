import http from 'http';

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url parameter' }));
    return;
  }

  try {
    // Use fetch which automatically follows redirects
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'FeedsApp/1.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || 'application/xml';
    const body = await response.text();

    res.writeHead(response.status, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(3001, () => {
  console.log('Proxy server running on http://localhost:3001');
});
