const crypto = require('crypto');
const config = require('../config');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const sessions = new Map();

function sign(value) {
  const hmac = crypto.createHmac('sha256', config.sessionSecret);
  hmac.update(value);
  return hmac.digest('hex');
}

function encodeCookieValue(sessionId) {
  const signature = sign(sessionId);
  return `${sessionId}.${signature}`;
}

function decodeCookieValue(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length < 2) return null;
  const signature = parts.pop();
  const sessionId = parts.join('.');
  const expected = sign(sessionId);
  let providedBuf;
  let expectedBuf;
  try {
    providedBuf = Buffer.from(signature, 'hex');
    expectedBuf = Buffer.from(expected, 'hex');
  } catch (err) {
    return null;
  }
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }
  return sessionId;
}

function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const session = {
    id: sessionId,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  sessions.set(sessionId, session);
  return session;
}

function touchSession(session) {
  session.lastSeenAt = Date.now();
  session.expiresAt = session.lastSeenAt + SESSION_TTL_MS;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  touchSession(session);
  return { ...session };
}

function destroySession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, pair) => {
    const [key, value] = pair.split('=');
    if (key && value) {
      acc[key.trim()] = decodeURIComponent(value.trim());
    }
    return acc;
  }, {});
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  const encoded = cookies.session;
  const sessionId = decodeCookieValue(encoded);
  if (!sessionId) return null;
  return getSession(sessionId);
}

function setSessionCookie(res, session) {
  const encoded = encodeCookieValue(session.id);
  const cookie = `session=${encodeURIComponent(encoded)}; HttpOnly; Path=/; SameSite=Lax`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

module.exports = {
  createSession,
  getSessionFromRequest,
  destroySession,
  setSessionCookie,
  clearSessionCookie
};
