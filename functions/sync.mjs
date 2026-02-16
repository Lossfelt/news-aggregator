import { getStore } from '@netlify/blobs';

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      },
    });
  }

  const store = getStore('feeds-state');
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (req.method === 'GET') {
    try {
      const readArticles = await store.get('read-articles');
      const lastVisit = await store.get('last-visit');
      const sources = await store.get('sources');

      return new Response(JSON.stringify({
        readArticles: readArticles ? JSON.parse(readArticles) : {},
        lastVisit: lastVisit || null,
        sources: sources ? JSON.parse(sources) : null,
      }), { headers });
    } catch (error) {
      console.error('Sync GET error:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }
  }

  if (req.method === 'PUT') {
    try {
      const { readArticles, lastVisit, sources } = await req.json();

      if (readArticles !== undefined) {
        await store.set('read-articles', JSON.stringify(readArticles));
      }
      if (lastVisit !== undefined) {
        await store.set('last-visit', String(lastVisit));
      }
      if (sources !== undefined) {
        await store.set('sources', JSON.stringify(sources));
      }

      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch (error) {
      console.error('Sync PUT error:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};
