const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');
const crypto = require('crypto');

async function saveStreamToFile(stream, targetPath) {
  const hash = crypto.createHash('md5');
  let size = 0;
  const checksumStream = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      size += chunk.length;
      callback(null, chunk);
    }
  });
  await pipeline(stream, checksumStream, fs.createWriteStream(targetPath));
  return {
    size,
    md5: hash.digest('hex')
  };
}

module.exports = { saveStreamToFile };
