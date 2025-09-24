function stripSuffix(incremental) {
  if (!incremental) return '';
  const stringValue = String(incremental).trim();
  const idx = stringValue.lastIndexOf('.');
  const base = idx === -1 ? stringValue : stringValue.slice(0, idx);
  return base.replace(/^V/i, '');
}

function parseVersion(incremental) {
  const noSuffix = stripSuffix(incremental);
  if (!noSuffix) return [];
  return noSuffix.split('.').map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const length = Math.max(av.length, bv.length);
  for (let i = 0; i < length; i += 1) {
    const ai = av[i] || 0;
    const bi = bv[i] || 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function isNewerThan(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

module.exports = {
  parseVersion,
  compareVersions,
  isNewerThan
};
