const { sendJson } = require('./httpUtils');
const { requireAuth } = require('./authMiddleware');
const catalogStore = require('../stores/catalogStore');
const { appendAdminLog } = require('../stores/logStore');
const { extractRequestMeta } = require('./requestMeta');
const { normalizeDownloadUrl } = require('../utils/url');

function normalizeBuild(build) {
  return {
    ...build,
    updatetype: build.type,
    payload: {
      ...build.payload,
      url: normalizeDownloadUrl(build.payload.url)
    }
  };
}

async function handleListCodenames(req, res) {
  const auth = await requireAuth(req, res, 'viewer');
  if (!auth) return;
  const codenames = await catalogStore.listCodenames();
  const result = await Promise.all(codenames.map(async (codename) => {
    const channels = await catalogStore.listChannels(codename);
    return { codename, channels };
  }));
  sendJson(res, 200, { codenames: result });
}

async function handleListBuilds(req, res, params) {
  const auth = await requireAuth(req, res, 'viewer');
  if (!auth) return;
  const builds = await catalogStore.listBuilds(params.codename, params.channel);
  const normalized = builds.map((build) => normalizeBuild(build));
  sendJson(res, 200, { builds: normalized });
}

async function handleUpdateBuild(req, res, params) {
  const auth = await requireAuth(req, res, 'maintainer');
  if (!auth) return;
  const body = req.body || {};
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, 'publish')) {
    updates.publish = Boolean(body.publish);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'mandatory')) {
    updates.mandatory = Boolean(body.mandatory);
  }
  const payloadUpdates = {};
  if (Object.prototype.hasOwnProperty.call(body, 'url')) {
    const trimmedUrl = String(body.url || '').trim();
    payloadUpdates.url = trimmedUrl ? normalizeDownloadUrl(trimmedUrl) : trimmedUrl;
  }
  if (body.changesHtml) {
    payloadUpdates.changes = Buffer.from(body.changesHtml, 'utf8').toString('base64');
  }
  if (Object.keys(payloadUpdates).length > 0) {
    updates.payload = payloadUpdates;
  }

  const build = await catalogStore.getBuild(params.codename, params.channel, params.buildId);
  if (!build) {
    sendJson(res, 404, { error: 'Build not found' });
    return;
  }

  if (build.type === 'delta' && body.changesHtml) {
    sendJson(res, 400, { error: 'Delta changelog is derived from full OTA and cannot be edited directly' });
    return;
  }

  const updatedBuild = await catalogStore.updateBuild(params.codename, params.channel, params.buildId, updates);

  if (build.type === 'full' && body.changesHtml) {
    const builds = await catalogStore.listBuilds(params.codename, params.channel);
    const deltas = builds.filter((b) => b.type === 'delta' && b.changelogSourceId === build.id);
    await Promise.all(deltas.map((delta) => catalogStore.updateBuild(params.codename, params.channel, delta.id, {
      payload: { changes: updatedBuild.payload.changes }
    })));
  }

  await appendAdminLog({
    action: 'update-build',
    username: auth.user.username,
    codename: params.codename,
    channel: params.channel,
    buildId: params.buildId,
    fields: Object.keys(body),
    ...extractRequestMeta(req)
  });

  sendJson(res, 200, { build: normalizeBuild(updatedBuild) });
}

module.exports = {
  handleListCodenames,
  handleListBuilds,
  handleUpdateBuild
};
