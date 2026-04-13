const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function callGemini(model, prompt, apiKey) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    const err = new Error(`HTTP ${response.status}: ${errBody}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!summary) throw new Error('Tomt svar');
  return summary;
}

async function getSummary(prompt, apiKey) {
  for (const model of MODELS) {
    // Try twice per model (retry once on 503/overload)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(model, prompt, apiKey);
      } catch (err) {
        const retryable = err.status === 503 || err.status === 429;
        console.log(`${model} forsøk ${attempt + 1} feilet: ${err.message}`);
        if (retryable && attempt === 0) {
          await sleep(1500);
          continue;
        }
        break;
      }
    }
  }
  throw new Error('Alle Gemini-modeller er utilgjengelige akkurat nå. Prøv igjen om litt.');
}

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

    const summary = await getSummary(prompt, apiKey);
    return { statusCode: 200, headers, body: JSON.stringify({ summary }) };
  } catch (error) {
    console.error('Summarize error:', error);
    return { statusCode: 502, headers, body: JSON.stringify({ error: error.message }) };
  }
};
