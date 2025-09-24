const fs = require('fs/promises');

function parsePropContent(content) {
  const lines = content.split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

async function parsePropFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parsePropContent(content);
}

module.exports = { parsePropContent, parsePropFile };
