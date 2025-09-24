const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');
const { buildReportCache } = require('../utils/reportAggregator');

const CACHE_PATH = path.join(config.paths.data, 'report-cache.json');
const LOG_PATH = path.join(config.paths.logs, 'api-access.jsonl');

let buildPromise = null;

async function ensureCache() {
  let cache = await readJson(CACHE_PATH, {
    generatedAt: null,
    logMTime: 0,
    perCodename: {}
  });

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
      buildPromise = buildReportCache(LOG_PATH)
        .then(async (newCache) => {
          await writeJson(CACHE_PATH, newCache);
          cache = newCache;
          return newCache;
        })
        .finally(() => {
          buildPromise = null;
        });
    }
    cache = await buildPromise;
  }

  return cache;
}

async function getCodenameReport(codename) {
  const cache = await ensureCache();
  return cache.perCodename[codename] || {
    summary: {
      totalDevices: 0,
      versions: [],
      channels: []
    },
    daily: {}
  };
}

module.exports = {
  ensureCache,
  getCodenameReport
};
