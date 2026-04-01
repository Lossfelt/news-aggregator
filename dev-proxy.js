import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import https from 'https';
import zlib from 'zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_FILE = path.join(__dirname, '.sync-data.json');

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // Handle /sync endpoint
  if (url.pathname === '/sync') {
    return handleSync(req, res);
  }

  // Handle /extract endpoint
  if (url.pathname === '/extract') {
    return handleExtract(req, res);
  }

  // Handle /summarize endpoint
  if (url.pathname === '/summarize') {
    return handleSummarize(req, res);
  }

  // Handle proxy endpoint (default)
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing url parameter' }));
    return;
  }

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'FeedsApp/1.0 (RSS Reader)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
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

function handleSync(req, res) {
  if (req.method === 'GET') {
    try {
      const data = fs.existsSync(SYNC_FILE)
        ? JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'))
        : { readArticles: {}, lastVisit: null };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ readArticles: {}, lastVisit: null }));
    }
    return;
  }

  if (req.method === 'PUT') {
    getRequestBody(req).then((body) => {
      try {
        const data = JSON.parse(body);
        fs.writeFileSync(SYNC_FILE, JSON.stringify(data, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

async function handleExtract(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await getRequestBody(req);
    const { url, source, title, feedDescription } = JSON.parse(body);

    if (!url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'URL is required' }));
      return;
    }

    const type = detectContentType(url, source);
    let result;

    switch (type) {
      case 'youtube':
        result = await extractYouTube(url, title);
        break;
      case 'podcast':
        result = extractPodcast(url, title, feedDescription);
        break;
      case 'bluesky':
        result = await extractBluesky(url, title);
        break;
      default:
        result = await extractArticle(url, title, feedDescription);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (error) {
    console.error('Extract error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function detectContentType(url, source) {
  const lowerUrl = url.toLowerCase();
  const lowerSource = (source || '').toLowerCase();

  if (
    lowerUrl.includes('youtube.com/watch') ||
    lowerUrl.includes('youtu.be/') ||
    lowerUrl.includes('youtube.com/shorts')
  ) {
    return 'youtube';
  }

  // Bluesky posts
  if (lowerUrl.includes('bsky.app') || lowerSource.includes('bluesky')) {
    return 'bluesky';
  }

  const podcastSources = ['latent space', 'podcast', 'lex fridman', 'huberman'];
  if (podcastSources.some((p) => lowerSource.includes(p))) {
    return 'podcast';
  }

  return 'article';
}

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US)';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function httpsRequest(method, url, body, userAgent) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': userAgent || DESKTOP_UA,
        'Accept-Language': 'en-US',
        'Accept-Encoding': 'gzip, deflate',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let text;
        try {
          const enc = res.headers['content-encoding'];
          if (enc === 'gzip') text = zlib.gunzipSync(raw).toString();
          else if (enc === 'br') text = zlib.brotliDecompressSync(raw).toString();
          else text = raw.toString();
        } catch { text = raw.toString(); }
        resolve({ status: res.statusCode, body: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseCaptionXml(xml) {
  const segments = [];
  const re = /<(?:text|p)\s+[^>]*?(?:start|t)="([^"]*)"[^>]*?(?:dur|d)="([^"]*)"[^>]*>(.*?)<\/(?:text|p)>/gs;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeEntities(m[3].replace(/<[^>]*>/g, '').trim());
    if (text) segments.push(text);
  }
  return segments;
}

async function extractYouTube(url, title) {
  const videoId = extractYouTubeId(url);

  if (!videoId) {
    return { type: 'youtube', text: null, error: 'Kunne ikke finne video-ID i URL-en' };
  }

  try {
    const playerBody = JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en', gl: 'US' } },
      videoId,
    });
    const playerRes = await httpsRequest('POST',
      'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
      playerBody,
      ANDROID_UA
    );
    const player = JSON.parse(playerRes.body);

    if (player.playabilityStatus?.status !== 'OK') {
      return { type: 'youtube', text: null, error: `Video ikke tilgjengelig: ${player.playabilityStatus?.reason || 'ukjent feil'}` };
    }

    const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      return { type: 'youtube', text: null, error: 'Ingen transkripsjon tilgjengelig for denne videoen' };
    }

    const track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
      || captionTracks.find(t => t.languageCode === 'en')
      || captionTracks[0];

    const captionRes = await httpsRequest('GET', track.baseUrl);
    if (!captionRes.body || captionRes.body.length === 0) {
      return { type: 'youtube', text: null, error: 'Kunne ikke laste ned undertekster' };
    }

    const segments = parseCaptionXml(captionRes.body);
    if (segments.length === 0) {
      return { type: 'youtube', text: null, error: 'Transkripsjonen var tom' };
    }

    const text = segments.join(' ').replace(/\s+/g, ' ').trim();
    return { type: 'youtube', text, title: player.videoDetails?.title || title };
  } catch (error) {
    return { type: 'youtube', text: null, error: 'Kunne ikke hente transkripsjon: ' + error.message };
  }
}

function extractPodcast(url, title, feedDescription) {
  if (feedDescription) {
    return { type: 'podcast', text: feedDescription, title };
  }
  return {
    type: 'podcast',
    text: null,
    error: 'Podcast-transkripsjon er ikke tilgjengelig direkte. Sjekk kildenettsiden for transkripsjon.',
    fallbackUrl: url,
  };
}

async function extractBluesky(url, title) {
  const match = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/]+)/);

  if (!match) {
    return { type: 'bluesky', text: null, error: 'Kunne ikke parse Bluesky-URL' };
  }

  const [, handle, postId] = match;

  try {
    const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://${handle}/app.bsky.feed.post/${postId}&depth=0`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      return await extractArticle(url, title);
    }

    const data = await response.json();
    const post = data?.thread?.post;

    if (!post?.record?.text) {
      return { type: 'bluesky', text: null, error: 'Kunne ikke hente Bluesky-innlegg' };
    }

    return { type: 'bluesky', text: post.record.text, title };
  } catch (error) {
    return { type: 'bluesky', text: null, error: `Feil ved henting av Bluesky-innlegg: ${error.message}` };
  }
}

async function extractArticle(url, title, feedDescription) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,no;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { type: 'article', text: null, error: `Kunne ikke hente artikkel: HTTP ${response.status}` };
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {
      if (feedDescription) {
        return { type: 'article', text: feedDescription, title };
      }
      return { type: 'article', text: null, error: 'Kunne ikke ekstrahere artikkelinnhold. Nettsiden kan være blokkert eller ha uvanlig struktur.' };
    }

    const cleanedText = article.textContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return { type: 'article', text: cleanedText, title: article.title || title };
  } catch (error) {
    if (feedDescription) {
      return { type: 'article', text: feedDescription, title };
    }
    return { type: 'article', text: null, error: `Feil ved henting av artikkel: ${error.message}` };
  }
}

const MODELS = [
  'stepfun/step-3.5-flash:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-27b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

const MODEL_TIMEOUT_MS = 5000;

async function callModel(model, prompt, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Feeds',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content;
    if (!summary) throw new Error('Tomt svar');

    return summary;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSummarize(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    // Load .env file for local development
    const { readFileSync } = await import('fs');
    let apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      try {
        const envContent = readFileSync('.env', 'utf-8');
        const match = envContent.match(/OPENROUTER_API_KEY=(.+)/);
        if (match) apiKey = match[1].trim();
      } catch {}
    }

    if (!apiKey) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENROUTER_API_KEY ikke konfigurert' }));
      return;
    }

    const body = await getRequestBody(req);
    const { text, title, type } = JSON.parse(body);

    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Tekst er påkrevd' }));
      return;
    }

    const typeLabel = type === 'youtube' ? 'videoen'
      : type === 'podcast' ? 'podcasten'
      : type === 'bluesky' ? 'Bluesky-innlegget'
      : 'artikkelen';

    const truncatedText = text.length > 15000 ? text.substring(0, 15000) + '...' : text;
    const prompt = `Oppsummer ${typeLabel} på norsk.\n\nTittel: ${title}\n\n${truncatedText}\n\nGi meg:\n1. Kort oppsummering (2-3 setninger)\n2. Hovedpunkter (3-5 kulepunkter)\n3. Viktigste innsikter`;

    for (const model of MODELS) {
      try {
        console.log(`Prøver modell: ${model}`);
        const summary = await callModel(model, prompt, apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ summary, model }));
        return;
      } catch (err) {
        console.log(`${model} feilet: ${err.message}`);
      }
    }

    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ingen tilgjengelige modeller kunne oppsummere akkurat nå. Prøv igjen om litt.' }));
  } catch (error) {
    console.error('Summarize error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

server.listen(3001, () => {
  console.log('Proxy server running on http://localhost:3001');
});
