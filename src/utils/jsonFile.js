const fs = require('fs/promises');

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

async function writeJson(filePath, value) {
  const json = JSON.stringify(value, null, 2);
  await fs.writeFile(filePath, json, 'utf8');
}

module.exports = { readJson, writeJson };
