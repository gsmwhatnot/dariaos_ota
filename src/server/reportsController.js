const { requireAuth } = require('./authMiddleware');
const { sendJson } = require('./httpUtils');
const { appendAdminLog } = require('../stores/logStore');
const { extractRequestMeta } = require('./requestMeta');
const { ensureCache, getCodenameReport } = require('../stores/reportCache');

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

function buildGraphData(daily, days) {
  const today = new Date();
  const cutoff = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const graph = [];
  const dateKeys = Object.keys(daily).sort();
  dateKeys.forEach((dateKey) => {
    const date = new Date(dateKey);
    if (Number.isNaN(date.getTime())) return;
    if (date < cutoff) return;
    graph.push({
      date: dateKey,
      versions: (daily[dateKey] || []).map(({ incremental, count }) => ({ incremental, count }))
    });
  });
  // Ensure we return exactly `days` entries (fill missing with zero counts)
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    const key = current.toISOString().slice(0, 10);
    const existing = graph.find((entry) => entry.date === key);
    if (existing) {
      result.push(existing);
    } else {
      result.push({ date: key, versions: [] });
    }
  }
  return result;
}

async function handleReport(req, res, params) {
  const auth = await requireAuth(req, res, 'viewer');
  if (!auth) return;

  await ensureCache();

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const daysParam = Number(url.searchParams.get('days'));
  let days = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : DEFAULT_DAYS;
  days = Math.max(1, Math.min(days, MAX_DAYS));

  const codenameReport = await getCodenameReport(params.codename);
  const summary = codenameReport.summary || {
    totalDevices: 0,
    versions: [],
    channels: []
  };

  const graph = buildGraphData(codenameReport.daily || {}, days);

  await appendAdminLog({
    action: 'view-report',
    username: auth.user.username,
    codename: params.codename,
    days,
    ...extractRequestMeta(req)
  });

  sendJson(res, 200, {
    summary,
    graph,
    codename: params.codename,
    days
  });
}

module.exports = { handleReport };
