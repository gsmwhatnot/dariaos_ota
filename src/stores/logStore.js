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

async function appendApiLog(payload) {
  const filePath = path.join(config.paths.logs, 'api-access.jsonl');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

async function appendAdminLog(payload) {
  const filePath = path.join(config.paths.logs, 'admin-audit.jsonl');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

async function appendDownloadLog(payload) {
  const filePath = path.join(config.paths.logs, 'download-access.jsonl');
  await fs.appendFile(filePath, formatEntry(payload), 'utf8');
}

module.exports = { appendApiLog, appendAdminLog, appendDownloadLog };
