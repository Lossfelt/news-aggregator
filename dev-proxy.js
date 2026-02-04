import http from 'http';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { execSync } from 'child_process';

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

  // Handle /extract endpoint
  if (url.pathname === '/extract') {
    return handleExtract(req, res);
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

async function handleExtract(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await getRequestBody(req);
    const { url, source, title } = JSON.parse(body);

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
        result = extractPodcast(url, title);
        break;
      case 'bluesky':
        result = await extractBluesky(url, title);
        break;
      default:
        result = await extractArticle(url, title);
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

async function extractYouTube(url, title) {
  const videoId = extractYouTubeId(url);

  if (!videoId) {
    return {
      type: 'youtube',
      text: null,
      error: 'Kunne ikke finne video-ID i URL-en',
    };
  }

  try {
    console.log('Using yt-dlp to fetch transcript...');

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');

    // Create temp file path
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `yt-sub-${videoId}`);

    // Download subtitles to temp file
    try {
      execSync(
        `yt-dlp --skip-download --write-auto-sub --write-sub --sub-lang en --sub-format vtt -o "${tempFile}" "${videoUrl}"`,
        { encoding: 'utf-8', timeout: 60000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (e) {
      // yt-dlp might return non-zero even on success for some warnings
      console.log('yt-dlp command completed');
    }

    // Find the subtitle file (could be .en.vtt or .en-orig.vtt etc)
    const files = fs.readdirSync(tempDir);
    const subFile = files.find(f => f.startsWith(`yt-sub-${videoId}`) && f.endsWith('.vtt'));

    if (!subFile) {
      console.log('No subtitle file found');
      return {
        type: 'youtube',
        text: null,
        error: 'Ingen transkripsjon tilgjengelig for denne videoen',
      };
    }

    const subPath = path.join(tempDir, subFile);
    console.log('Found subtitle file:', subFile);

    const vttContent = fs.readFileSync(subPath, 'utf-8');

    // Clean up temp file
    try { fs.unlinkSync(subPath); } catch (e) {}

    // Parse VTT format
    const lines = vttContent.split('\n');
    const segments = [];
    let inCue = false;

    for (const line of lines) {
      // Skip header, timestamps, and empty lines
      if (line.startsWith('WEBVTT') || line.startsWith('Kind:') || line.startsWith('Language:')) continue;
      if (line.match(/^\d{2}:\d{2}/) || line.match(/^NOTE/)) {
        inCue = true;
        continue;
      }
      if (line.trim() === '') {
        inCue = false;
        continue;
      }

      // This is actual text content
      const cleanLine = line
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();

      if (cleanLine && !segments.includes(cleanLine)) {
        segments.push(cleanLine);
      }
    }

    if (segments.length === 0) {
      return {
        type: 'youtube',
        text: null,
        error: 'Transkripsjonen var tom',
      };
    }

    const text = segments.join(' ').replace(/\s+/g, ' ').trim();
    console.log('Transcript length:', text.length);

    return { type: 'youtube', text, title };

  } catch (error) {
    console.log('yt-dlp error:', error.message);
    return {
      type: 'youtube',
      text: null,
      error: 'Kunne ikke hente transkripsjon. Sørg for at yt-dlp er installert (winget install yt-dlp).',
    };
  }
}

function extractPodcast(url, title) {
  return {
    type: 'podcast',
    text: null,
    error: 'Podcast-transkripsjon er ikke tilgjengelig direkte. Sjekk kildenettsiden for transkripsjon.',
    fallbackUrl: url,
  };
}

async function extractBluesky(url, title) {
  // Bluesky URLs look like: https://bsky.app/profile/user.bsky.social/post/abc123
  const match = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/]+)/);

  if (!match) {
    return {
      type: 'bluesky',
      text: null,
      error: 'Kunne ikke parse Bluesky-URL',
    };
  }

  const [, handle, postId] = match;

  try {
    // Use Bluesky's public API to get post content
    const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://${handle}/app.bsky.feed.post/${postId}&depth=0`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      // Fallback: try to get content from page
      return await extractArticle(url, title);
    }

    const data = await response.json();
    const post = data?.thread?.post;

    if (!post?.record?.text) {
      return {
        type: 'bluesky',
        text: null,
        error: 'Kunne ikke hente Bluesky-innlegg',
      };
    }

    return {
      type: 'bluesky',
      text: post.record.text,
      title: title,
    };
  } catch (error) {
    return {
      type: 'bluesky',
      text: null,
      error: `Feil ved henting av Bluesky-innlegg: ${error.message}`,
    };
  }
}

async function extractArticle(url, title) {
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
      return {
        type: 'article',
        text: null,
        error: `Kunne ikke hente artikkel: HTTP ${response.status}`,
      };
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url });

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent) {
      return {
        type: 'article',
        text: null,
        error: 'Kunne ikke ekstrahere artikkelinnhold. Nettsiden kan være blokkert eller ha uvanlig struktur.',
      };
    }

    const cleanedText = article.textContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    return {
      type: 'article',
      text: cleanedText,
      title: article.title || title,
    };
  } catch (error) {
    return {
      type: 'article',
      text: null,
      error: `Feil ved henting av artikkel: ${error.message}`,
    };
  }
}

server.listen(3001, () => {
  console.log('Proxy server running on http://localhost:3001');
});
