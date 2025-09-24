const config = require('../config');
const { requireAuth } = require('./authMiddleware');
const { sendJson } = require('./httpUtils');
const userStore = require('../stores/userStore');
const { appendAdminLog } = require('../stores/logStore');
const { extractRequestMeta } = require('./requestMeta');

async function handleListUsers(req, res) {
  const auth = await requireAuth(req, res, 'admin');
  if (!auth) return;
  const users = await userStore.listUsers();
  sendJson(res, 200, { users });
}

async function handleCreateUser(req, res) {
  const auth = await requireAuth(req, res, 'admin');
  if (!auth) return;
  const { username, password, role = 'viewer', mustChangePassword = false } = req.body || {};
  if (!username || !password) {
    sendJson(res, 400, { error: 'username and password are required' });
    return;
  }
  if (password.length < 8) {
    sendJson(res, 400, { error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    const user = await userStore.createUser({
      username,
      password,
      role,
      mustChangePassword,
      createdBy: auth.user.username
    });
    await appendAdminLog({
      action: 'create-user',
      username: auth.user.username,
      target: username,
      role,
      ...extractRequestMeta(req)
    });
    sendJson(res, 201, { user });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleUpdateUser(req, res, params) {
  const auth = await requireAuth(req, res, 'admin');
  if (!auth) return;
  const body = req.body || {};
  const updates = {};
  if (body.role) {
    updates.role = body.role;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'disabled')) {
    updates.disabled = Boolean(body.disabled);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'mustChangePassword')) {
    updates.mustChangePassword = Boolean(body.mustChangePassword);
  }
  if (body.password) {
    if (body.password.length < 8) {
      sendJson(res, 400, { error: 'Password must be at least 8 characters' });
      return;
    }
    updates.password = body.password;
  }

  const defaultAdminUsername = (config.defaultAdmin.username || 'admin').toLowerCase();
  const isDefaultAdmin = params.username.toLowerCase() === defaultAdminUsername;
  if (isDefaultAdmin) {
    if (updates.role && updates.role !== 'admin') {
      sendJson(res, 400, { error: 'Default admin role cannot be changed' });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'disabled') && updates.disabled) {
      sendJson(res, 400, { error: 'Default admin account cannot be disabled' });
      return;
    }
  }

  try {
    const user = await userStore.updateUser(params.username, updates);
    if (!user) {
      sendJson(res, 404, { error: 'User not found' });
      return;
    }
    await appendAdminLog({
      action: 'update-user',
      username: auth.user.username,
      target: params.username,
      fields: Object.keys(updates),
      ...extractRequestMeta(req)
    });
    sendJson(res, 200, { user });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

module.exports = {
  handleListUsers,
  handleCreateUser,
  handleUpdateUser
};
