const path = require('path');
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

async function start() {
  await bootstrap();

  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/download', async (req, res) => {
    const file = req.query.file;
    if (!file) {
      res.status(400).json({ error: 'file query parameter required' });
      return;
    }
    await handleDownload(req, res, file);
  });

  app.get('/download/:file', async (req, res) => {
    await handleDownload(req, res, req.params.file);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/tools', toolsRouter);
  app.use('/api/firmware', firmwareRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/system', systemRouter);

  app.use('/ota/api/v1', otaRouter);
  app.use('/api/v1', otaRouter);

  app.get('/', (req, res) => {
    res.status(404).sendFile(path.join(config.paths.public, '404.html'));
  });

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(config.paths.public, 'index.html'));
  });

  app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
    res.sendFile(path.join(config.paths.public, 'index.html'));
  });

  app.use(express.static(config.paths.public, {
    extensions: ['html'],
    index: false
  }));

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }
    if (req.accepts('html')) {
      res.status(404).sendFile(path.join(config.paths.public, '404.html'));
      return;
    }
    res.status(404).send('Not Found');
  });

  app.listen(config.port, config.host, () => {
    console.log(`OTA server listening on http://${config.host}:${config.port}`);
  });
}

start().catch((err) => {
  console.error('Fatal error while starting server', err);
  process.exit(1);
});
