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
