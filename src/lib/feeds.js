export const feedSources = [
  // AI/Tech blogs
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/' },
  { name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { name: 'Microsoft News', url: 'https://news.microsoft.com/source/feed/' },
  { name: 'ZSA Blog', url: 'https://blog.zsa.io/posts.rss' },
  { name: 'One Useful Thing', url: 'https://www.oneusefulthing.org/feed' },
  { name: 'Simon Willison', url: 'https://simonwillison.net/atom/entries/' },
  { name: 'Zvi Mowshowitz', url: 'https://thezvi.substack.com/feed' },
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },

  // YouTube
  { name: 'Matthew Berman', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCawZsQWqfGSbCI5yjkdVkTA' },
  { name: 'Two Minute Papers', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg' },

  // Podcasts
  { name: 'Latent Space Podcast', url: 'https://api.substack.com/feed/podcast/69345.rss' },
  { name: 'Practical AI Podcast', url: 'https://feeds.transistor.fm/practical-ai-machine-learning-data-science-llm' },
  { name: 'Cognitive Revolution Podcast', url: 'https://api.substack.com/feed/podcast/1084089.rss' },
  { name: 'Forward Future Podcast', url: 'https://anchor.fm/s/f7cac464/podcast/rss' },

  // Bluesky
  { name: 'Ethan Mollick (Bluesky)', url: 'https://bluestream.deno.dev/emollick.bsky.social?reply=exclude' },

  // Via Olshansk repo
  { name: 'Anthropic News', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml' },
];

export async function fetchFeed(feedSource) {
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(feedSource.url)}`;
  const response = await fetch(proxyUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${feedSource.name}: ${response.status}`);
  }

  const xml = await response.text();
  return { xml, source: feedSource };
}

export async function fetchAllFeeds(onProgress) {
  const results = [];
  const errors = [];

  for (const source of feedSources) {
    try {
      const result = await fetchFeed(source);
      results.push(result);
      if (onProgress) onProgress(source.name, true);
    } catch (error) {
      errors.push({ source, error: error.message });
      if (onProgress) onProgress(source.name, false);
    }
  }

  return { results, errors };
}
