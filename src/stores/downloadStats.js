const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');
const { buildDownloadCache } = require('../utils/downloadAggregator');

const CACHE_PATH = path.join(config.paths.data, 'download-cache.json');
const LOG_PREFIX = 'download_';

async function listLogFiles() {
  let entries;
  try {
    entries = await fs.readdir(config.paths.logs);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const candidates = entries.filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith('.jsonl'));
  candidates.sort();

  const stats = [];
  for (const name of candidates) {
    const fullPath = path.join(config.paths.logs, name);
    try {
      const stat = await fs.stat(fullPath);
      stats.push({ path: fullPath, mtimeMs: stat.mtimeMs });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
  return stats;
}

function buildSignature(files) {
  if (!files.length) return '';
  return files
    .map(({ path: filePath, mtimeMs }) => `${path.basename(filePath)}:${mtimeMs}`)
    .join('|');
}

let buildPromise = null;

async function ensureCache() {
  let cache = await readJson(CACHE_PATH, { generatedAt: null, logSignature: '', totals: {}, daily: {} });
  const logFiles = await listLogFiles();
  const signature = buildSignature(logFiles);

  if (!signature) {
    if (!cache.generatedAt) {
      cache.generatedAt = new Date().toISOString();
      cache.totals = {};
      cache.daily = {};
      cache.logSignature = '';
      await writeJson(CACHE_PATH, cache);
    }
    return cache;
  }

  if (cache.logSignature !== signature) {
    if (!buildPromise) {
      const logPaths = logFiles.map((file) => file.path);
      buildPromise = buildDownloadCache(logPaths)
        .then(async (newCache) => {
          const enriched = { ...newCache, logSignature: signature };
          await writeJson(CACHE_PATH, enriched);
          cache = enriched;
          return enriched;
        })
        .finally(() => {
          buildPromise = null;
        });
    }
    cache = await buildPromise;
  }

  return cache;
}

async function getDownloadStats(days = 7) {
  const cache = await ensureCache();
  const dailyEntries = Object.entries(cache.daily || {});
  dailyEntries.sort(([a], [b]) => (a < b ? -1 : 1));
  const cutoff = Math.max(1, Math.floor(days));
  const slice = dailyEntries.slice(-cutoff);
  const daily = slice.map(([date, entries]) => ({ date, entries }));
  return {
    totals: cache.totals || {},
    daily
  };
}

module.exports = { ensureCache, getDownloadStats };
