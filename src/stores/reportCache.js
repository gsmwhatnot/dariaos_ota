const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');
const { buildReportCache } = require('../utils/reportAggregator');

const CACHE_PATH = path.join(config.paths.data, 'report-cache.json');
const LOG_PREFIX = 'api_';

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
  return files.map(({ path: fp, mtimeMs }) => `${path.basename(fp)}:${mtimeMs}`).join('|');
}

let buildPromise = null;

async function ensureCache() {
  let cache = await readJson(CACHE_PATH, {
    generatedAt: null,
    logSignature: '',
    perCodename: {}
  });

  const logFiles = await listLogFiles();
  const signature = buildSignature(logFiles);

  if (!signature) {
    if (!cache.generatedAt) {
      cache.generatedAt = new Date().toISOString();
      cache.perCodename = {};
      cache.logSignature = '';
      await writeJson(CACHE_PATH, cache);
    }
    return cache;
  }

  if (cache.logSignature !== signature) {
    if (!buildPromise) {
      const logPaths = logFiles.map((file) => file.path);
      buildPromise = buildReportCache(logPaths)
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
