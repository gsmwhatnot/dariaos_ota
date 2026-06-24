function parseSerialAllowlist(value) {
  const rawItems = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const serials = [];

  rawItems.forEach((item) => {
    const serial = String(item || '').trim();
    if (!serial || seen.has(serial)) {
      return;
    }
    seen.add(serial);
    serials.push(serial);
  });

  return serials;
}

function isSerialAllowed(build, serial) {
  const allowlist = Array.isArray(build && build.serialAllowlist) ? build.serialAllowlist : [];
  if (!allowlist.length) {
    return true;
  }
  const normalizedSerial = String(serial || '').trim();
  return normalizedSerial ? allowlist.includes(normalizedSerial) : false;
}

module.exports = {
  parseSerialAllowlist,
  isSerialAllowed
};
