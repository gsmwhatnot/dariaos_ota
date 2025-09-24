const fs = require('fs');
const fsp = require('fs/promises');
const readline = require('readline');

function ensureCodenameMap(map, codename) {
  if (!map.has(codename)) {
    map.set(codename, new Map());
  }
  return map.get(codename);
}

function ensureDayMap(map, codename, dayKey) {
  const codenameMap = ensureCodenameMap(map, codename);
  if (!codenameMap.has(dayKey)) {
    codenameMap.set(dayKey, new Map());
  }
  return codenameMap.get(dayKey);
}

function toDateKey(timestampMs) {
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function parseTimestamp(entry) {
  const candidate = entry.timestamp || entry.loggedAt || entry.datetime;
  if (!candidate) return null;
  if (typeof candidate === 'number') {
    return candidate * 1000; // assume seconds
  }
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

async function processLogFile(logPath, summaryPerCodename, dailyPerCodename) {
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(logPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line) return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (err) {
        return;
      }
      const { codename, serial, currentIncremental, channel } = entry;
      if (!codename || !serial || !currentIncremental) {
        return;
      }
      const timestampMs = parseTimestamp(entry);
      const dayKey = toDateKey(timestampMs);

      const summaryMap = ensureCodenameMap(summaryPerCodename, codename);
      const existing = summaryMap.get(serial);
      if (!existing || (timestampMs && timestampMs > existing.timestamp)) {
        summaryMap.set(serial, {
          version: currentIncremental,
          channel: channel || 'unknown',
          timestamp: timestampMs || Date.now()
        });
      }

      if (dayKey) {
        const dayMap = ensureDayMap(dailyPerCodename, codename, dayKey);
        const existingDaily = dayMap.get(serial);
        if (!existingDaily || (timestampMs && timestampMs > existingDaily.timestamp)) {
          dayMap.set(serial, {
            version: currentIncremental,
            timestamp: timestampMs || Date.now()
          });
        }
      }
    });

    rl.once('close', resolve);
    rl.once('error', reject);
  });
}

async function buildReportCache(logPaths) {
  const summaryPerCodename = new Map(); // codename -> Map(serial -> { version, channel, timestamp })
  const dailyPerCodename = new Map(); // codename -> Map(day -> Map(serial -> { version, timestamp }))

  const paths = Array.isArray(logPaths) ? logPaths : [logPaths];
  for (const logPath of paths) {
    if (!logPath) continue;
    try {
      await fsp.access(logPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        continue;
      }
      throw err;
    }

    try {
      await processLogFile(logPath, summaryPerCodename, dailyPerCodename);
    } catch (err) {
      if (err.code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }

  const perCodename = {};

  summaryPerCodename.forEach((serialMap, codename) => {
    const versionCounts = new Map();
    const channelCounts = new Map();
    serialMap.forEach(({ version, channel }) => {
      versionCounts.set(version, (versionCounts.get(version) || 0) + 1);
      channelCounts.set(channel, (channelCounts.get(channel) || 0) + 1);
    });

    const summary = {
      totalDevices: serialMap.size,
      versions: Array.from(versionCounts.entries()).map(([incremental, count]) => ({ incremental, count })),
      channels: Array.from(channelCounts.entries()).map(([chan, count]) => ({ channel: chan, count }))
    };

    const dailyMap = dailyPerCodename.get(codename) || new Map();
    const daily = {};
    dailyMap.forEach((serialDailyMap, dayKey) => {
      const counts = new Map();
      serialDailyMap.forEach(({ version }) => {
        counts.set(version, (counts.get(version) || 0) + 1);
      });
      daily[dayKey] = Array.from(counts.entries()).map(([incremental, count]) => ({ incremental, count }));
    });

    perCodename[codename] = {
      summary,
      daily
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    perCodename
  };
}

module.exports = { buildReportCache };
