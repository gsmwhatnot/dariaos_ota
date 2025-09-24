const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');
const config = require('../config');
const { sendJson } = require('./httpUtils');
const { extractRequestMeta } = require('./requestMeta');
const { appendDownloadLog } = require('../stores/logStore');

function resolveFile(filename) {
  const safeName = path.basename(filename);
  const fullPath = path.join(config.paths.uploads, 'full', safeName);
  const deltaPath = path.join(config.paths.uploads, 'delta', safeName);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  if (fs.existsSync(deltaPath)) {
    return deltaPath;
  }
  return null;
}

function streamFile(res, filePath, { filename, start, end } = {}) {
  if (filename) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  }
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/zip');
  }
  const options = {};
  if (typeof start === 'number') {
    options.start = start;
  }
  if (typeof end === 'number') {
    options.end = end;
  }
  const stream = fs.createReadStream(filePath, Object.keys(options).length ? options : undefined);
  stream.on('error', (err) => {
    console.error('Error streaming download', err);
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

async function handleDownload(req, res, filename) {
  const filePath = resolveFile(filename);
  if (!filePath) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  let stats;
  try {
    stats = await fsp.stat(filePath);
  } catch (err) {
    console.error('Unable to stat download', err);
    sendJson(res, 500, { error: 'Unable to process download' });
    return;
  }
  const fileSize = stats.size;
  const rangeHeader = req.headers.range;
  const isHeadRequest = req.method === 'HEAD';
  let parsedRange = null;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }
    let [ , startStr, endStr ] = match;
    let start;
    let end;
    if (startStr === '' && endStr !== '') {
      const suffixLength = Number.parseInt(endStr, 10);
      if (!Number.isFinite(suffixLength)) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return;
      }
      start = Math.max(fileSize - suffixLength, 0);
      end = fileSize - 1;
    } else {
      start = Number.parseInt(startStr, 10);
      end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      res.end();
      return;
    }

    parsedRange = { start, end };
    const chunkSize = end - start + 1;
    const fileBasename = path.basename(filename);
    const isInitialRange = start === 0;
    if (!isHeadRequest) {
      await appendDownloadLog({
        file: fileBasename,
        requestedPath: filename,
        partial: !isInitialRange,
        ...extractRequestMeta(req)
      });
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.status(206);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    if (isHeadRequest) {
      res.end();
      return;
    }
    streamFile(res, filePath, { filename: fileBasename, start, end });
    return;
  }

  const fileBasename = path.basename(filename);
  if (!isHeadRequest) {
    await appendDownloadLog({
      file: fileBasename,
      requestedPath: filename,
      partial: false,
      ...extractRequestMeta(req)
    });
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Last-Modified', stats.mtime.toUTCString());
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Length', fileSize);
  if (isHeadRequest) {
    res.status(200).end();
    return;
  }
  res.status(200);
  if (parsedRange) {
    streamFile(res, filePath, { filename: fileBasename, start: parsedRange.start, end: parsedRange.end });
  } else {
    streamFile(res, filePath, { filename: fileBasename });
  }
}

module.exports = { handleDownload };
