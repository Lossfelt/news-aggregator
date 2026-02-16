const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const store = getStore('feeds-state');

  if (event.httpMethod === 'GET') {
    try {
      const readArticles = await store.get('read-articles');
      const lastVisit = await store.get('last-visit');

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readArticles: readArticles ? JSON.parse(readArticles) : {},
          lastVisit: lastVisit || null,
        }),
      };
    } catch (error) {
      console.error('Sync GET error:', error);
      return {
        statusCode: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  if (event.httpMethod === 'PUT') {
    try {
      const { readArticles, lastVisit } = JSON.parse(event.body);

      if (readArticles !== undefined) {
        await store.set('read-articles', JSON.stringify(readArticles));
      }
      if (lastVisit !== undefined) {
        await store.set('last-visit', lastVisit);
      }

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    } catch (error) {
      console.error('Sync PUT error:', error);
      return {
        statusCode: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' }),
  };
};
