const userStore = require('../stores/userStore');
const { getSessionFromRequest } = require('./sessionManager');
const { sendJson } = require('./httpUtils');

const ROLE_PRIORITY = {
  viewer: 1,
  maintainer: 2,
  admin: 3
};

function hasRequiredRole(userRole, minimumRole) {
  if (!minimumRole) return true;
  const current = ROLE_PRIORITY[userRole] || 0;
  const required = ROLE_PRIORITY[minimumRole] || 0;
  return current >= required;
}

async function requireAuth(req, res, minimumRole) {
  const session = getSessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }
  const user = await userStore.findByUsername(session.username);
  if (!user || user.disabled) {
    sendJson(res, 401, { error: 'Account unavailable' });
    return null;
  }
  if (!hasRequiredRole(user.role, minimumRole)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return null;
  }
  return { user, session };
}

module.exports = { requireAuth, hasRequiredRole };
