function stripZipExtension(filename) {
  if (!filename.toLowerCase().endsWith('.zip')) {
    throw new Error('Firmware file must have .zip extension');
  }
  return filename.slice(0, -4);
}

function parseSegments(filename) {
  const name = stripZipExtension(filename);
  const segments = name.split('-');
  if (segments.length < 8) {
    throw new Error('Unexpected firmware filename format');
  }
  return segments;
}

function parseFullFilename(filename) {
  const segments = parseSegments(filename);
  const buildType = segments[segments.length - 2];
  const signedTag = segments[segments.length - 1];
  const incremental = segments[segments.length - 3];
  const codename = segments.slice(4, segments.length - 3).join('-');
  return {
    osName: segments[0],
    osMajorVersion: segments[1],
    buildDate: segments[2],
    channel: segments[3].toLowerCase(),
    codename,
    incremental,
    buildType,
    signedTag
  };
}

function parseDeltaFilename(filename) {
  const segments = parseSegments(filename);
  const buildType = segments[segments.length - 2];
  const signedTag = segments[segments.length - 1];
  const transition = segments[segments.length - 3];
  const delimiter = transition.includes('+') ? '+' : '>';
  const [from, to] = transition.split(delimiter);
  if (!from || !to) {
    throw new Error('Delta filename must include previous+target incremental values');
  }
  const codename = segments.slice(4, segments.length - 3).join('-');
  return {
    osName: segments[0],
    osMajorVersion: segments[1],
    buildDate: segments[2],
    channel: segments[3].toLowerCase(),
    codename,
    baseIncremental: from,
    incremental: to,
    buildType,
    signedTag
  };
}

module.exports = {
  parseFullFilename,
  parseDeltaFilename
};
