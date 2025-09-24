const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config');
const { bootstrap } = require('./bootstrap');
const otaRouter = require('./routes/ota');
const authRouter = require('./routes/auth');
const toolsRouter = require('./routes/tools');
const firmwareRouter = require('./routes/firmware');
const catalogRouter = require('./routes/catalog');
const usersRouter = require('./routes/users');
const reportsRouter = require('./routes/reports');
const systemRouter = require('./routes/system');
const { handleDownload } = require('./server/downloadController');

const basePath = config.basePath || '';
const indexHtmlPath = path.join(config.paths.public, 'index.html');
const notFoundHtmlPath = path.join(config.paths.public, '404.html');
function prepareHtml(templatePath) {
  const raw = fs.readFileSync(templatePath, 'utf8');
  return raw
    .replace(/__BASE_PATH__/g, basePath)
    .replace(/__PUBLIC_PATH__/g, basePath || '');
}

const indexHtml = prepareHtml(indexHtmlPath);
const notFoundHtml = prepareHtml(notFoundHtmlPath);

function normalizeRoute(route) {
  if (!route || route === '') return '/';
  return route.startsWith('/') ? route : `/${route}`;
}

function withBase(route) {
  const normalized = normalizeRoute(route);
  if (!basePath) return normalized;
  if (normalized === '/') {
    return basePath || '/';
  }
  return `${basePath}${normalized}`;
}

function registerGet(app, route, handler) {
  app.get(route, handler);
  if (basePath) {
    const prefixed = withBase(route);
    if (prefixed !== route) {
      app.get(prefixed, handler);
    }
  }
}

function registerUse(app, route, middleware) {
  app.use(route, middleware);
  if (basePath) {
    const prefixed = withBase(route);
    if (prefixed !== route) {
      app.use(prefixed, middleware);
    }
  }
}

function stripBaseFromPath(p) {
  if (!basePath) return p;
  if (p && p.startsWith(basePath)) {
    const stripped = p.slice(basePath.length);
    return stripped.startsWith('/') ? stripped : `/${stripped}`;
  }
  return p;
}

async function start() {
  await bootstrap();

  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));

  registerGet(app, '/health', (req, res) => {
    res.json({ status: 'ok', baseUrl: basePath });
  });

  const downloadQueryHandler = async (req, res) => {
    const file = req.query.file;
    if (!file) {
      res.status(400).json({ error: 'file query parameter required' });
      return;
    }
    await handleDownload(req, res, file);
  };

  registerGet(app, '/download', downloadQueryHandler);

  const downloadParamHandler = async (req, res) => {
    await handleDownload(req, res, req.params.file);
  };

  registerGet(app, '/download/:file', downloadParamHandler);

  registerUse(app, '/api/auth', authRouter);
  registerUse(app, '/api/tools', toolsRouter);
  registerUse(app, '/api/firmware', firmwareRouter);
  registerUse(app, '/api/catalog', catalogRouter);
  registerUse(app, '/api/users', usersRouter);
  registerUse(app, '/api/reports', reportsRouter);
  registerUse(app, '/api/system', systemRouter);

  registerUse(app, '/api/v1', otaRouter);
  
  registerGet(app, '/admin', (req, res) => {
    res.type('html').send(indexHtml);
  });

  const adminRegex = /^\/admin(?:\/.*)?$/;
  app.get(adminRegex, (req, res) => {
    res.type('html').send(indexHtml);
  });
  if (basePath) {
    const baseAdminRegex = new RegExp(`^${basePath.replace(/\//g, '\\/')}\/admin(?:\/.*)?$`);
    app.get(baseAdminRegex, (req, res) => {
      res.type('html').send(indexHtml);
    });
  }

  app.use(express.static(config.paths.public, {
    extensions: ['html'],
    index: false
  }));
  if (basePath) {
    app.use(basePath, express.static(config.paths.public, {
      extensions: ['html'],
      index: false
    }));
  }

  app.use((req, res) => {
    const originalPath = req.path || '';
    const relativePath = stripBaseFromPath(originalPath) || originalPath;
    const isApiPath = relativePath.startsWith('/api/') || relativePath.startsWith('/api/v1');
    if (isApiPath) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (req.accepts('html')) {
      res.status(404).type('html').send(notFoundHtml);
      return;
    }
    res.status(404).send('Not Found');
  });

  app.listen(config.port, config.host, () => {
    if (basePath) {
      console.log(`OTA server listening on http://${config.host}:${config.port}${basePath}`);
    } else {
      console.log(`OTA server listening on http://${config.host}:${config.port}`);
    }
  });
}

start().catch((err) => {
  console.error('Fatal error while starting server', err);
  process.exit(1);
});
