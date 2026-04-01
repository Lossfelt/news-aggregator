const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GEMINI_API_KEY ikke konfigurert' }) };
  }

  try {
    const { text, title, type } = JSON.parse(event.body);

    if (!text) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Tekst er påkrevd' }) };
    }

    const typeLabel = type === 'youtube' ? 'videoen'
      : type === 'podcast' ? 'podcasten'
      : type === 'bluesky' ? 'Bluesky-innlegget'
      : 'artikkelen';

    const truncatedText = text.length > 15000 ? text.substring(0, 15000) + '...' : text;
    const prompt = `Oppsummer ${typeLabel} på norsk.\n\nTittel: ${title}\n\n${truncatedText}\n\nGi meg:\n1. Kort oppsummering (2-3 setninger)\n2. Hovedpunkter (3-5 kulepunkter)\n3. Viktigste innsikter`;

    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini error:', response.status, errBody);
      return { statusCode: 502, headers, body: JSON.stringify({ error: `Gemini-feil: HTTP ${response.status}` }) };
    }

    const data = await response.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!summary) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Tomt svar fra Gemini' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ summary }) };
  } catch (error) {
    console.error('Summarize error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
