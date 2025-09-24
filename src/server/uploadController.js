const path = require('path');
const fs = require('fs/promises');
const Busboy = require('busboy');
const config = require('../config');
const { sendJson } = require('./httpUtils');
const { requireAuth } = require('./authMiddleware');
const { parsePropContent } = require('../utils/propParser');
const { parseFullFilename, parseDeltaFilename } = require('../utils/firmwareNaming');
const { saveStreamToFile } = require('../utils/streamHelpers');
const { buildDownloadUrl, normalizeDownloadUrl } = require('../utils/url');
const catalogStore = require('../stores/catalogStore');
const { compareVersions } = require('../utils/version');
const { appendAdminLog } = require('../stores/logStore');
const { extractRequestMeta } = require('./requestMeta');

function boolField(value) {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function requiredKeys(obj, keys) {
  const missing = keys.filter((key) => !(key in obj));
  if (missing.length) {
    throw new Error(`Missing keys in prop file: ${missing.join(', ')}`);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function withUpdateType(build) {
  if (!build) return null;
  return { ...build, updatetype: build.type };
}

async function ensureDiskCapacity(requiredBytes) {
  if (requiredBytes <= 0) {
    return;
  }
  let stats;
  try {
    stats = await fs.statfs(config.paths.uploads);
  } catch (err) {
    throw new Error('Unable to inspect disk capacity');
  }
  const blockSize = stats.bsize || stats.f_bsize || 0;
  const totalBytes = (stats.blocks || stats.f_blocks || 0) * blockSize;
  const availableBytes = (stats.bavail || stats.f_bavail || 0) * blockSize;
  if (!totalBytes) return;
  const projectedAvailable = availableBytes - requiredBytes;
  if (projectedAvailable < totalBytes * 0.05) {
    const remainingPercent = totalBytes ? (projectedAvailable / totalBytes) * 100 : 0;
    throw new Error(`Insufficient disk space: only ${formatBytes(projectedAvailable)} (~${remainingPercent.toFixed(2)}% of total) would remain after upload`);
  }
}

async function handlePropPreview(req, res) {
  const auth = await requireAuth(req, res, 'maintainer');
  if (!auth) return;

  const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 512 * 1024 } });
  let propContent = '';
  let fileCount = 0;
  let hasError = false;

  busboy.on('file', (fieldname, file, info) => {
    if (fieldname !== 'prop') {
      file.resume();
      return;
    }
    fileCount += 1;
    file.setEncoding('utf8');
    file.on('data', (chunk) => {
      propContent += chunk;
    });
  });

  busboy.on('error', (err) => {
    hasError = true;
    sendJson(res, 400, { error: err.message });
  });

  busboy.on('close', () => {
    if (hasError) return;
    try {
      if (!propContent || fileCount === 0) {
        sendJson(res, 400, { error: 'prop file is required' });
        return;
      }
      const props = parsePropContent(propContent);
      requiredKeys(props, [
        'ro.system.build.date',
        'ro.system.build.fingerprint',
        'ro.system.build.version.incremental',
        'ro.product.system.brand',
        'ro.product.system.device',
        'ro.product.system.model',
        'ro.system.build.version.sdk',
        'ro.system.build.date.utc',
        'ro.dariaos.version'
      ]);
      sendJson(res, 200, {
        success: true,
        properties: {
          buildDate: props['ro.system.build.date'],
          fingerprint: props['ro.system.build.fingerprint'],
          incremental: props['ro.system.build.version.incremental'],
          brand: props['ro.product.system.brand'],
          device: props['ro.product.system.device'],
          model: props['ro.product.system.model'],
          apiLevel: props['ro.system.build.version.sdk'],
          epoch: props['ro.system.build.date.utc'],
          version: props['ro.dariaos.version']
        }
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });

  req.pipe(busboy);
}

function validateDeltaAdjacency(fullBuilds, baseIncremental, targetIncremental) {
  const baseExists = fullBuilds.some((b) => compareVersions(b.payload.incremental, baseIncremental) === 0);
  if (!baseExists) {
    throw new Error(`Base incremental ${baseIncremental} is not registered as a full build`);
  }
  const duplicateTarget = fullBuilds.some((b) => compareVersions(b.payload.incremental, targetIncremental) === 0);
  if (duplicateTarget) {
    throw new Error(`Full build ${targetIncremental} already exists`);
  }
  if (compareVersions(targetIncremental, baseIncremental) <= 0) {
    throw new Error('Delta target incremental must be newer than base incremental');
  }
  const hasIntermediate = fullBuilds.some((b) => compareVersions(b.payload.incremental, baseIncremental) > 0
    && compareVersions(b.payload.incremental, targetIncremental) < 0);
  if (hasIntermediate) {
    throw new Error(`Delta target ${targetIncremental} is not adjacent to base ${baseIncremental}`);
  }
}

async function handleFirmwareUpload(req, res) {
  const auth = await requireAuth(req, res, 'maintainer');
  if (!auth) return;

  const uploadsTmp = path.join(config.paths.uploads, 'tmp');
  const fullDir = path.join(config.paths.uploads, 'full');
  const deltaDir = path.join(config.paths.uploads, 'delta');

  const busboy = Busboy({ headers: req.headers });

  const filePromises = [];
  const files = {
    prop: null,
    changelog: null,
    full: null,
    delta: null
  };
  const fields = {};
  let aborted = false;
  let fullTargetPath = null;
  let deltaTargetPath = null;

  function handleError(err) {
    if (aborted) return;
    aborted = true;
    sendJson(res, 400, { error: err.message || String(err) });
  }

  busboy.on('field', (name, value) => {
    fields[name] = value;
  });

  busboy.on('file', (name, file, info) => {
    const { filename, mimeType } = info;
    if (!filename) {
      file.resume();
      return;
    }
    if (name === 'prop') {
      let content = '';
      file.setEncoding('utf8');
      const promise = new Promise((resolve, reject) => {
        file.on('data', (chunk) => {
          content += chunk;
          if (content.length > 1_000_000) {
            reject(new Error('prop file too large'));
            file.resume();
          }
        });
        file.on('end', () => {
          files.prop = { content, filename };
          resolve();
        });
        file.on('error', reject);
      });
      filePromises.push(promise);
    } else if (name === 'changelog') {
      let content = '';
      file.setEncoding('utf8');
      const promise = new Promise((resolve, reject) => {
        file.on('data', (chunk) => {
          content += chunk;
          if (content.length > 2_000_000) {
            reject(new Error('Changelog HTML too large'));
            file.resume();
          }
        });
        file.on('end', () => {
          files.changelog = { content, filename, mimeType };
          resolve();
        });
        file.on('error', reject);
      });
      filePromises.push(promise);
    } else if (name === 'full' || name === 'delta') {
      const tempName = `${Date.now()}-${Math.random().toString(16).slice(2)}-${filename}`;
      const tempPath = path.join(uploadsTmp, tempName);
      const promise = saveStreamToFile(file, tempPath)
        .then((meta) => {
          files[name] = {
            filename,
            tempPath,
            size: meta.size,
            md5: meta.md5
          };
        });
      filePromises.push(promise);
    } else {
      file.resume();
    }
  });

  busboy.on('error', (err) => {
    handleError(err);
  });

  busboy.on('close', async () => {
    try {
      await Promise.all(filePromises);
      if (!files.prop || !files.changelog || !files.full) {
        throw new Error('prop, changelog, and full OTA files are required');
      }

      const props = parsePropContent(files.prop.content);
      requiredKeys(props, [
        'ro.system.build.version.incremental',
        'ro.system.build.version.sdk',
        'ro.system.build.date.utc',
        'ro.system.build.date',
        'ro.system.build.fingerprint',
        'ro.product.system.brand',
        'ro.product.system.device',
        'ro.product.system.model',
        'ro.dariaos.version'
      ]);

      const fullMeta = parseFullFilename(files.full.filename);
      if (props['ro.product.system.device'] !== fullMeta.codename) {
        throw new Error('Codename in prop file does not match full OTA filename');
      }
      if (props['ro.system.build.version.incremental'] !== fullMeta.incremental) {
        throw new Error('Incremental version mismatch between prop file and full OTA filename');
      }

      const channel = fullMeta.channel;
      const codename = fullMeta.codename;

      const existingBuilds = await catalogStore.listBuilds(codename, channel);
      const existingFulls = existingBuilds.filter((b) => b.type === 'full');

      const fullExists = existingFulls.some((b) => compareVersions(b.payload.incremental, fullMeta.incremental) === 0);
      if (fullExists) {
        throw new Error(`A full build for ${fullMeta.incremental} already exists`);
      }

      const requiredBytes = files.full.size + (files.delta ? files.delta.size : 0);
      await ensureDiskCapacity(requiredBytes);

      const timestampSeconds = Math.floor(Date.now() / 1000);
      const changelogBase64 = Buffer.from(files.changelog.content, 'utf8').toString('base64');

      const fullUrl = fields.fullUrl && fields.fullUrl.trim()
        ? normalizeDownloadUrl(fields.fullUrl.trim())
        : buildDownloadUrl(files.full.filename);
      const publishFull = boolField(fields.publishFull);
      const publishDelta = boolField(fields.publishDelta);
      const mandatoryFull = boolField(fields.mandatoryFull);

      const fullTargetPath = path.join(fullDir, files.full.filename);
      try {
        await fs.access(fullTargetPath);
        throw new Error(`Full OTA file ${files.full.filename} already exists`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }

        await fs.rename(files.full.tempPath, fullTargetPath);
        files.full.tempPath = null;

      const fullPayload = {
        incremental: fullMeta.incremental,
        api_level: props['ro.system.build.version.sdk'],
        url: fullUrl,
        datetime: Number(props['ro.system.build.date.utc']),
        md5sum: files.full.md5,
        changes: changelogBase64,
        channel,
        filename: files.full.filename,
        romtype: channel,
        timestamp: timestampSeconds,
        version: props['ro.dariaos.version'],
        size: files.full.size
      };

      const fullRecord = await catalogStore.addBuild({
        codename,
        channel,
        type: 'full',
        payload: fullPayload,
        publish: publishFull,
        mandatory: mandatoryFull,
        file: {
          path: path.relative(config.paths.uploads, fullTargetPath),
          size: files.full.size,
          md5: files.full.md5
        },
        createdBy: auth.user.username
      });

      let deltaRecord = null;

      if (files.delta) {
        const deltaMeta = parseDeltaFilename(files.delta.filename);
        if (deltaMeta.codename !== codename) {
          throw new Error('Delta codename does not match full OTA');
        }
        if (deltaMeta.incremental !== fullMeta.incremental) {
          throw new Error('Delta target incremental must match full OTA incremental');
        }
        validateDeltaAdjacency(existingFulls, deltaMeta.baseIncremental, deltaMeta.incremental);
        const duplicateDelta = existingBuilds.some((b) => b.type === 'delta'
          && compareVersions(b.payload.incremental, deltaMeta.incremental) === 0
          && b.baseIncremental === deltaMeta.baseIncremental);
        if (duplicateDelta) {
          throw new Error(`A delta from ${deltaMeta.baseIncremental} to ${deltaMeta.incremental} already exists`);
        }

        deltaTargetPath = path.join(deltaDir, files.delta.filename);
        try {
          await fs.access(deltaTargetPath);
          throw new Error(`Delta OTA file ${files.delta.filename} already exists`);
        } catch (err) {
          if (err.code !== 'ENOENT') {
            throw err;
          }
        }
        await fs.rename(files.delta.tempPath, deltaTargetPath);
        files.delta.tempPath = null;

        const deltaUrl = fields.deltaUrl && fields.deltaUrl.trim()
          ? normalizeDownloadUrl(fields.deltaUrl.trim())
          : buildDownloadUrl(files.delta.filename);

        const deltaPayload = {
          incremental: deltaMeta.incremental,
          api_level: props['ro.system.build.version.sdk'],
          url: deltaUrl,
          datetime: Number(props['ro.system.build.date.utc']),
          md5sum: files.delta.md5,
          changes: fullRecord.payload.changes,
          channel,
          filename: files.delta.filename,
          romtype: channel,
          timestamp: timestampSeconds,
          version: props['ro.dariaos.version'],
          size: files.delta.size
        };

        deltaRecord = await catalogStore.addBuild({
          codename,
          channel,
          type: 'delta',
          baseIncremental: deltaMeta.baseIncremental,
          payload: deltaPayload,
          publish: publishDelta,
          mandatory: false,
          file: {
            path: path.relative(config.paths.uploads, deltaTargetPath),
            size: files.delta.size,
            md5: files.delta.md5
          },
          changelogSourceId: fullRecord.id,
          createdBy: auth.user.username
        });
      }

      await appendAdminLog({
        action: 'upload-firmware',
        username: auth.user.username,
        codename,
        channel,
        incremental: fullMeta.incremental,
        deltaBase: deltaRecord ? deltaRecord.baseIncremental : null,
        ...extractRequestMeta(req)
      });

      sendJson(res, 200, {
        success: true,
        full: withUpdateType(fullRecord),
        delta: withUpdateType(deltaRecord)
      });
    } catch (err) {
      console.error('Firmware upload failed', err);
      // cleanup temp files
      const cleanup = [];
      if (files.full && files.full.tempPath) {
        cleanup.push(fs.rm(files.full.tempPath, { force: true }));
      }
      if (files.delta && files.delta.tempPath) {
        cleanup.push(fs.rm(files.delta.tempPath, { force: true }));
      }
      if (fullTargetPath) {
        cleanup.push(fs.rm(fullTargetPath, { force: true }));
      }
      if (deltaTargetPath) {
        cleanup.push(fs.rm(deltaTargetPath, { force: true }));
      }
      await Promise.allSettled(cleanup);
      if (!aborted) {
        sendJson(res, 400, { error: err.message || String(err) });
      }
    }
  });

  req.pipe(busboy);
}

module.exports = {
  handlePropPreview,
  handleFirmwareUpload
};
