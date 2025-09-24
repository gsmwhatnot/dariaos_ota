const fs = require('fs/promises');
const path = require('path');
const config = require('../config');

function formatEntry(payload) {
  const enriched = {
    timestamp: new Date().toISOString(),
    ...payload
  };
  return JSON.stringify(enriched) + '\n';
}

function buildLogPath(prefix) {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(config.paths.logs, `${prefix}_${date}.jsonl`);
}

async function appendApiLog(payload) {
  const filePath = buildLogPath('api');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

async function appendAdminLog(payload) {
  const filePath = buildLogPath('audit');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

async function appendDownloadLog(payload) {
  const filePath = buildLogPath('download');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

module.exports = { appendApiLog, appendAdminLog, appendDownloadLog };
