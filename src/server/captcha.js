const crypto = require('crypto');

const TTL_MS = 1000 * 60 * 5; // 5 minutes
const captchas = new Map();

function hashAnswer(answer) {
  return crypto.createHash('sha256').update(String(answer).trim().toLowerCase()).digest('hex');
}

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of captchas.entries()) {
    if (entry.expiresAt < now) {
      captchas.delete(id);
    }
  }
}

function generateCaptcha() {
  cleanup();
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const operator = Math.random() > 0.5 ? '+' : '-';
  const answer = operator === '+' ? a + b : a - b;
  const id = crypto.randomBytes(12).toString('hex');
  captchas.set(id, {
    hash: hashAnswer(answer),
    expiresAt: Date.now() + TTL_MS
  });
  return { id, question: `${a} ${operator} ${b} = ?` };
}

function verifyCaptcha(id, answer) {
  cleanup();
  const entry = captchas.get(id);
  if (!entry) return false;
  const matches = entry.hash === hashAnswer(answer);
  captchas.delete(id);
  return matches;
}

module.exports = { generateCaptcha, verifyCaptcha };
