const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const https = require('https');
const zlib = require('zlib');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    };
  }

  try {
    const { url, source, title, feedDescription } = JSON.parse(event.body);

    if (!url) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'URL is required' }),
      };
    }

    // Detect content type
    const type = detectContentType(url, source);

    let result;
    switch (type) {
      case 'youtube':
        result = await extractYouTube(url, title, feedDescription);
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ...result }),
    };
  } catch (error) {
    console.error('Extract error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};

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
const YT_CONSENT_COOKIE = 'SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMwODI5LjA3X3AxGgJlbiACGgYIgJnOqQY';

function httpsRequest(method, url, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US',
        'Accept-Encoding': 'gzip, deflate',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...extraHeaders,
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
  const isMillis = xml.includes('<p ');
  const re = /<(?:text|p)\s+[^>]*?(?:start|t)="([^"]*)"[^>]*?(?:dur|d)="([^"]*)"[^>]*>(.*?)<\/(?:text|p)>/gs;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeEntities(m[3].replace(/<[^>]*>/g, '').trim());
    if (text) segments.push(text);
  }
  return segments;
}

async function tryYouTubeInnertube(videoId) {
  const playerBody = JSON.stringify({
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en', gl: 'US' } },
    videoId,
  });
  const playerRes = await httpsRequest('POST',
    'https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    playerBody,
    { 'User-Agent': ANDROID_UA, 'Cookie': YT_CONSENT_COOKIE }
  );
  const player = JSON.parse(playerRes.body);

  if (player.playabilityStatus?.status !== 'OK') {
    throw new Error(player.playabilityStatus?.reason || 'ikke tilgjengelig');
  }

  const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('ingen captions');
  }

  const track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || captionTracks.find(t => t.languageCode === 'en')
    || captionTracks[0];

  const captionRes = await httpsRequest('GET', track.baseUrl, null, { 'User-Agent': ANDROID_UA });
  if (!captionRes.body || captionRes.body.length === 0) throw new Error('tomt caption-svar');

  const segments = parseCaptionXml(captionRes.body);
  if (segments.length === 0) throw new Error('tomme segmenter');

  return {
    text: segments.join(' ').replace(/\s+/g, ' ').trim(),
    title: player.videoDetails?.title,
  };
}

async function tryYouTubeSupadata(videoId) {
  const apiKey = process.env.SUPADATA_API_KEY;
  if (!apiKey) throw new Error('SUPADATA_API_KEY ikke satt');

  const response = await fetch(
    `https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=${videoId}`,
    { headers: { 'x-api-key': apiKey } }
  );

  if (!response.ok) {
    throw new Error(`Supadata HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
    throw new Error('tomt Supadata-svar');
  }

  return {
    text: data.content.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim(),
  };
}

async function extractYouTube(url, title, feedDescription) {
  const videoId = extractYouTubeId(url);

  if (!videoId) {
    return { type: 'youtube', text: null, error: 'Kunne ikke finne video-ID i URL-en' };
  }

  // Try Supadata first (paid service, bypasses IP blocking)
  try {
    const result = await tryYouTubeSupadata(videoId);
    return { type: 'youtube', text: result.text, title };
  } catch (err) {
    console.log('Supadata feilet:', err.message);
  }

  // Fall back to direct innertube (works from residential IPs)
  try {
    const result = await tryYouTubeInnertube(videoId);
    return { type: 'youtube', text: result.text, title: result.title || title };
  } catch (err) {
    console.log('Innertube feilet:', err.message);
  }

  // Last resort: use feed description (often promotional but better than nothing)
  if (feedDescription) {
    return { type: 'youtube', text: feedDescription, title };
  }

  return {
    type: 'youtube',
    text: null,
    error: 'Kunne ikke hente transkripsjon fra noen kilde. YouTube blokkerer server-IPs og videoen har ingen feedbeskrivelse.',
  };
}

function extractPodcast(url, title, feedDescription) {
  if (feedDescription) {
    return {
      type: 'podcast',
      text: feedDescription,
      title,
    };
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
    return {
      type: 'bluesky',
      text: null,
      error: 'Kunne ikke parse Bluesky-URL',
    };
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
      if (feedDescription) {
        return {
          type: 'article',
          text: feedDescription,
          title,
        };
      }
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
    if (feedDescription) {
      return {
        type: 'article',
        text: feedDescription,
        title,
      };
    }
    return {
      type: 'article',
      text: null,
      error: `Feil ved henting av artikkel: ${error.message}`,
    };
  }
}
