const catalogStore = require('../stores/catalogStore');
const { appendApiLog } = require('../stores/logStore');
const config = require('../config');
const { compareVersions, isNewerThan } = require('../utils/version');
const { sendJson } = require('./httpUtils');
const { normalizeDownloadUrl } = require('../utils/url');

function normalizeChannel(channel) {
  return String(channel || '').toLowerCase();
}

function extractHeaders(req) {
  const forwarded = req.headers['x-forwarded-for'] || '';
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : ''; 
  return { forwarded, userAgent, ip };
}

function sortFullBuilds(builds) {
  return [...builds].sort((a, b) => compareVersions(a.payload.incremental, b.payload.incremental));
}

function findLatestFull(builds) {
  return builds.reduce((latest, current) => {
    if (!latest) return current;
    return compareVersions(current.payload.incremental, latest.payload.incremental) > 0 ? current : latest;
  }, null);
}

function computeDistance(fullBuilds, currentIncremental, targetIncremental) {
  const sorted = sortFullBuilds(fullBuilds);
  const targetIndex = sorted.findIndex((b) => compareVersions(b.payload.incremental, targetIncremental) === 0);
  if (targetIndex === -1) {
    return Infinity;
  }
  const currentIndex = sorted.findIndex((b) => compareVersions(b.payload.incremental, currentIncremental) === 0);
  if (currentIndex === -1) {
    return Infinity;
  }
  return targetIndex - currentIndex;
}

async function handleOtaRequest(req, res, params) {
  const codename = params.codename;
  const channel = normalizeChannel(params.channel);
  const currentIncremental = params.currentVersion;
  const serial = params.serial;

  const builds = await catalogStore.listBuilds(codename, channel);
  const published = builds.filter((b) => b.publish);
  const fullBuilds = published.filter((b) => b.type === 'full');

  const decision = {
    type: 'none',
    payloads: [],
    mandatory: false
  };

  const mandatoryFulls = sortFullBuilds(fullBuilds.filter((b) => b.mandatory));
  const nextMandatory = mandatoryFulls.find((b) => compareVersions(currentIncremental, b.payload.incremental) < 0);

  if (nextMandatory) {
    const targetIncremental = nextMandatory.payload.incremental;
    const mandatoryCandidates = published
      .filter((b) => b.type === 'delta'
        && b.baseIncremental === currentIncremental
        && isNewerThan(b.payload.incremental, currentIncremental)
        && compareVersions(b.payload.incremental, targetIncremental) <= 0)
      .sort((a, b) => compareVersions(a.payload.incremental, b.payload.incremental));

    const mandatoryDelta = mandatoryCandidates.length ? mandatoryCandidates[mandatoryCandidates.length - 1] : null;

    if (mandatoryDelta) {
      decision.type = 'delta';
      decision.payloads = [mandatoryDelta.payload];
      decision.mandatory = true;
    } else {
      decision.type = 'full';
      decision.payloads = [nextMandatory.payload];
      decision.mandatory = true;
    }
  } else {
    const newerFulls = fullBuilds.filter((b) => isNewerThan(b.payload.incremental, currentIncremental));
    const latestFull = findLatestFull(newerFulls);

    let distance = Infinity;
    if (latestFull) {
      distance = computeDistance(fullBuilds, currentIncremental, latestFull.payload.incremental);
    }

    const deltaBuild = published.find((b) => b.type === 'delta'
      && b.baseIncremental === currentIncremental
      && isNewerThan(b.payload.incremental, currentIncremental));

    if (deltaBuild && distance !== Infinity && distance <= config.maximumDeltaDistance) {
      decision.type = 'delta';
      decision.payloads = [deltaBuild.payload];
    } else if (latestFull) {
      decision.type = 'full';
      decision.payloads = [latestFull.payload];
    }
  }

  let responsePayloads = [];
  if (decision.type !== 'none') {
    responsePayloads = decision.payloads.map((payload) => {
      const clone = { ...payload };
      clone.url = normalizeDownloadUrl(clone.url);
      const updateType = decision.type === 'delta' ? 'delta' : 'full';
      clone.updatetype = updateType;
      if (decision.mandatory) {
        clone.mandatory = true;
      }
      return clone;
    });
  }

  if (decision.type === 'none') {
    sendJson(res, 200, { id: null, response: [] });
  } else {
    sendJson(res, 200, { id: null, response: responsePayloads });
  }

  const headers = extractHeaders(req);
  const logEntry = {
    codename,
    channel,
    currentIncremental,
    serial,
    decision: decision.type,
    targetIncrementals: responsePayloads.map((p) => p.incremental),
    mandatory: decision.mandatory,
    ip: headers.ip,
    xForwardedFor: headers.forwarded,
    userAgent: headers.userAgent
  };
  await appendApiLog(logEntry);
}

module.exports = { handleOtaRequest };
