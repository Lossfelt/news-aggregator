const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const { YoutubeTranscript } = require('youtube-transcript');

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
    const { url, source, title } = JSON.parse(event.body);

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

  // YouTube detection
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

  // Podcast detection - common podcast sources
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
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcript || transcript.length === 0) {
      return {
        type: 'youtube',
        text: null,
        error: 'Ingen transkripsjon tilgjengelig for denne videoen',
      };
    }

    // Combine transcript segments
    const text = transcript.map((segment) => segment.text).join(' ');

    return {
      type: 'youtube',
      text: text,
      title: title,
    };
  } catch (error) {
    return {
      type: 'youtube',
      text: null,
      error: `Kunne ikke hente transkripsjon: ${error.message}`,
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

    // Clean up the text
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
