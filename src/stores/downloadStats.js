const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');
const { buildDownloadCache } = require('../utils/downloadAggregator');

const CACHE_PATH = path.join(config.paths.data, 'download-cache.json');
const LOG_PATH = path.join(config.paths.logs, 'download-access.jsonl');

let buildPromise = null;

async function ensureCache() {
  let cache = await readJson(CACHE_PATH, { generatedAt: null, logMTime: 0, totals: {}, daily: {} });
  let logStat;
  try {
    logStat = await fs.stat(LOG_PATH);
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (!cache.generatedAt) {
        cache.generatedAt = new Date().toISOString();
        await writeJson(CACHE_PATH, cache);
      }
      return cache;
    }
    throw err;
  }

  if (!cache.logMTime || cache.logMTime < logStat.mtimeMs) {
    if (!buildPromise) {
      buildPromise = buildDownloadCache(LOG_PATH)
        .then(async (newCache) => {
          const enriched = { ...newCache, logMTime: logStat.mtimeMs };
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
