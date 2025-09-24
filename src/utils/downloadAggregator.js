const fs = require('fs');
const readline = require('readline');
const { parseFullFilename, parseDeltaFilename } = require('./firmwareNaming');

function parseDownloadMetadata(filename) {
  try {
    const full = parseFullFilename(filename);
    return { codename: full.codename, version: full.incremental, type: 'full' };
  } catch (err) {
    try {
      const delta = parseDeltaFilename(filename);
      return { codename: delta.codename, version: `${delta.baseIncremental}->${delta.incremental}`, target: delta.incremental, type: 'delta' };
    } catch (err2) {
      return null;
    }
  }
}

function toDateKey(tsMs) {
  const date = new Date(tsMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function buildDownloadCache(logPath) {
  const totals = new Map(); // codename -> Map(version -> count)
  const daily = new Map(); // day -> Map(codename::version -> count)

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
      if (entry.partial) return;
      const { file } = entry;
      if (!file) return;
      const meta = parseDownloadMetadata(file);
      if (!meta) return;
      const timestamp = Date.parse(entry.timestamp || 0) || Date.now();
      const dayKey = toDateKey(timestamp);

      const codenameKey = meta.codename;
      if (!totals.has(codenameKey)) totals.set(codenameKey, new Map());
      const versionKey = meta.version;
      const versionMap = totals.get(codenameKey);
      versionMap.set(versionKey, (versionMap.get(versionKey) || 0) + 1);

      if (dayKey) {
        if (!daily.has(dayKey)) daily.set(dayKey, new Map());
        const dayMap = daily.get(dayKey);
        const comboKey = `${meta.codename}__${meta.version}`;
        dayMap.set(comboKey, (dayMap.get(comboKey) || 0) + 1);
      }
    });

    rl.once('close', resolve);
    rl.once('error', reject);
  });

  const totalsObj = {};
  totals.forEach((versionMap, codename) => {
    totalsObj[codename] = {
      versions: Array.from(versionMap.entries()).map(([version, count]) => ({ version, count }))
    };
  });

  const dailyObj = {};
  daily.forEach((map, day) => {
    dailyObj[day] = Array.from(map.entries()).map(([combo, count]) => {
      const [codename, version] = combo.split('__');
      return { codename, version, count };
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: totalsObj,
    daily: dailyObj
  };
}

module.exports = { buildDownloadCache };
