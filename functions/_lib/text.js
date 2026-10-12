'use strict';

// &amp; må dekodes SIST. Ellers blir "&amp;lt;" først til "&lt;" og deretter
// til "<" (dobbel dekoding).
function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// Ett pass er ikke nok: "<<b>script>" blir "<script>" etter ett pass.
// Gjentar til teksten ikke endrer seg.
function stripTags(html) {
  let current = html;
  let previous;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current;
}

module.exports = { decodeEntities, stripTags };
