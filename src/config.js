const path = require('path');
const pkg = require('../package.json');

const rootDir = path.resolve(__dirname, '..');

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isNaN(value) ? fallback : value;
}

const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');

module.exports = {
  port: envInt('PORT', 8080),
  host: process.env.HOST || '0.0.0.0',
  siteName: process.env.SITE_NAME || 'DariaOS OTA Console',
  maximumDeltaDistance: envInt('MAXIMUM_DELTA_DISTANCE', 4),
  baseUrl,
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',
  appVersion: pkg.version || '0.0.0',
  defaultAdmin: {
    username: process.env.DEFAULT_ADMIN_USER || 'admin',
    password: process.env.DEFAULT_ADMIN_PASSWORD || 'admin1234'
  },
  paths: {
    root: rootDir,
    data: path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data')),
    logs: path.resolve(process.env.LOG_DIR || path.join(rootDir, 'logs')),
    uploads: path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, 'uploads')),
    public: path.resolve(path.join(rootDir, 'public'))
  }
};
