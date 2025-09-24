const config = require('../config');

const basePath = (config.basePath || '').replace(/\/$/, '');

function normalizePath(path) {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeDownloadUrl(url) {
  if (!url) return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const base = config.baseUrl || basePath || '';
  const normalizedPath = normalizePath(trimmed);
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

function buildDownloadUrl(filename) {
  const encoded = encodeURIComponent(filename);
  return normalizeDownloadUrl(`/download/${encoded}`);
}

module.exports = {
  normalizeDownloadUrl,
  buildDownloadUrl
};
