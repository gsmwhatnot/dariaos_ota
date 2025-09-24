const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const userStore = require('./stores/userStore');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function ensureFile(filePath, defaultValue) {
  try {
    await fs.access(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.writeFile(filePath, defaultValue, 'utf8');
      return;
    }
    throw err;
  }
}

async function bootstrap() {
  const uploadsFull = path.join(config.paths.uploads, 'full');
  const uploadsDelta = path.join(config.paths.uploads, 'delta');
  const uploadsTmp = path.join(config.paths.uploads, 'tmp');

  await Promise.all([
    ensureDir(config.paths.data),
    ensureDir(config.paths.logs),
    ensureDir(config.paths.uploads),
    ensureDir(uploadsFull),
    ensureDir(uploadsDelta),
    ensureDir(uploadsTmp),
    ensureDir(config.paths.public)
  ]);

  await ensureFile(path.join(config.paths.data, 'catalog.json'), JSON.stringify({ codenames: {} }, null, 2));
  await ensureFile(path.join(config.paths.data, 'users.json'), JSON.stringify({ users: [] }, null, 2));
  await ensureFile(path.join(config.paths.data, 'report-cache.json'), JSON.stringify({ generatedAt: null, logMTime: 0, perCodename: {} }, null, 2));
  await ensureFile(path.join(config.paths.data, 'download-cache.json'), JSON.stringify({ generatedAt: null, logMTime: 0, totals: {}, daily: {} }, null, 2));
  await userStore.ensureDefaultAdmin();
}

module.exports = { bootstrap };
