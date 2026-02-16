const READ_ARTICLES_KEY = 'feeds_read_articles';
const LAST_VISIT_KEY = 'feeds_last_visit';

export function getReadArticles() {
  try {
    const stored = localStorage.getItem(READ_ARTICLES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function markAsRead(articleId) {
  const read = getReadArticles();
  read[articleId] = Date.now();
  localStorage.setItem(READ_ARTICLES_KEY, JSON.stringify(read));
}

export function markAsUnread(articleId) {
  const read = getReadArticles();
  delete read[articleId];
  localStorage.setItem(READ_ARTICLES_KEY, JSON.stringify(read));
}

export function isRead(articleId) {
  const read = getReadArticles();
  return articleId in read;
}

export function toggleRead(articleId) {
  if (isRead(articleId)) {
    markAsUnread(articleId);
    return false;
  } else {
    markAsRead(articleId);
    return true;
  }
}

export function getLastVisit() {
  try {
    const stored = localStorage.getItem(LAST_VISIT_KEY);
    return stored ? parseInt(stored, 10) : null;
  } catch {
    return null;
  }
}

export function updateLastVisit() {
  localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
}

export function clearAllData() {
  localStorage.removeItem(READ_ARTICLES_KEY);
  localStorage.removeItem(LAST_VISIT_KEY);
}

export async function syncFromServer() {
  try {
    const response = await fetch('/api/sync');
    if (!response.ok) return;

    const server = await response.json();
    const local = getReadArticles();

    // Merge: union of all read articles (never lose a "read" marking)
    const merged = { ...local };
    if (server.readArticles) {
      for (const [id, timestamp] of Object.entries(server.readArticles)) {
        if (!(id in merged) || timestamp > merged[id]) {
          merged[id] = timestamp;
        }
      }
    }

    localStorage.setItem(READ_ARTICLES_KEY, JSON.stringify(merged));

    // Use server lastVisit if it's newer
    if (server.lastVisit) {
      const localVisit = getLastVisit();
      if (!localVisit || Number(server.lastVisit) > localVisit) {
        localStorage.setItem(LAST_VISIT_KEY, server.lastVisit);
      }
    }

    // Push merged state back to server so both sides are in sync
    await fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readArticles: merged,
        lastVisit: localStorage.getItem(LAST_VISIT_KEY),
      }),
    });
  } catch (err) {
    console.warn('Sync from server failed:', err);
  }
}

export async function syncToServer() {
  try {
    await fetch('/api/sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        readArticles: getReadArticles(),
        lastVisit: localStorage.getItem(LAST_VISIT_KEY),
      }),
    });
  } catch (err) {
    console.warn('Sync to server failed:', err);
  }
}
