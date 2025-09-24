const userStore = require('../stores/userStore');
const { appendAdminLog } = require('../stores/logStore');
const { generateCaptcha, verifyCaptcha } = require('./captcha');
const {
  createSession,
  getSessionFromRequest,
  destroySession,
  setSessionCookie,
  clearSessionCookie
} = require('./sessionManager');
const { sendJson } = require('./httpUtils');
const { extractRequestMeta } = require('./requestMeta');
const config = require('../config');

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    disabled: Boolean(user.disabled),
    lastLoginAt: user.lastLoginAt || null
  };
}

async function handleCaptcha(req, res) {
  const captcha = generateCaptcha();
  sendJson(res, 200, captcha);
}

async function handleSession(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 200, { authenticated: false, siteName: config.siteName, version: config.appVersion });
    return;
  }
  const user = await userStore.findByUsername(session.username);
  if (!user) {
    sendJson(res, 200, { authenticated: false, siteName: config.siteName, version: config.appVersion });
    return;
  }
  sendJson(res, 200, { authenticated: true, user: sanitizeUser(user), siteName: config.siteName, version: config.appVersion });
}

async function handleLogin(req, res) {
  const { username, password, captchaId, captchaAnswer } = req.body || {};
  if (!username || !password || !captchaId || !captchaAnswer) {
    sendJson(res, 400, { error: 'Missing username, password, or captcha' });
    return;
  }

  if (!verifyCaptcha(captchaId, captchaAnswer)) {
    sendJson(res, 400, { error: 'Invalid captcha' });
    return;
  }

  const user = await userStore.authenticate(username, password);
  if (!user) {
    sendJson(res, 401, { error: 'Invalid credentials' });
    return;
  }

  const session = createSession(user);
  setSessionCookie(res, session);
  await appendAdminLog({
    action: 'login',
    username: user.username,
    ...extractRequestMeta(req)
  });

  sendJson(res, 200, {
    authenticated: true,
    user: sanitizeUser(user),
    siteName: config.siteName,
    version: config.appVersion
  });
}

async function handleLogout(req, res) {
  const session = getSessionFromRequest(req);
  if (session) {
    destroySession(session.id);
  }
  clearSessionCookie(res);
  await appendAdminLog({
    action: 'logout',
    username: session ? session.username : 'unknown',
    ...extractRequestMeta(req)
  });
  sendJson(res, 200, { success: true });
}

async function handleChangePassword(req, res) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return;
  }

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    sendJson(res, 400, { error: 'Missing currentPassword or newPassword' });
    return;
  }
  if (newPassword.length < 8) {
    sendJson(res, 400, { error: 'Password must be at least 8 characters' });
    return;
  }

  const valid = await userStore.verifyPassword(session.username, currentPassword);
  if (!valid) {
    sendJson(res, 401, { error: 'Invalid current password' });
    return;
  }

  const updatedUser = await userStore.updateUser(session.username, {
    password: newPassword,
    mustChangePassword: false
  });

  destroySession(session.id);
  const newSession = createSession(updatedUser);
  setSessionCookie(res, newSession);

  await appendAdminLog({
    action: 'change-password',
    username: session.username,
    ...extractRequestMeta(req)
  });

  sendJson(res, 200, {
    success: true,
    user: sanitizeUser(updatedUser),
    siteName: config.siteName,
    version: config.appVersion
  });
}

module.exports = {
  handleCaptcha,
  handleSession,
  handleLogin,
  handleLogout,
  handleChangePassword
};
