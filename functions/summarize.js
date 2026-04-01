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
        'HTTP-Referer': 'https://feeds-app.netlify.app',
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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'OPENROUTER_API_KEY ikke konfigurert' }) };
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

    for (const model of MODELS) {
      try {
        console.log(`Prøver modell: ${model}`);
        const summary = await callModel(model, prompt, apiKey);
        return { statusCode: 200, headers, body: JSON.stringify({ summary, model }) };
      } catch (err) {
        console.log(`${model} feilet: ${err.message}`);
      }
    }

    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Ingen tilgjengelige modeller kunne oppsummere akkurat nå. Prøv igjen om litt.' }) };
  } catch (error) {
    console.error('Summarize error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
