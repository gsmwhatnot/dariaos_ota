const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');

const DEFAULT_DATA = { users: [] };

function sanitizeUser(user) {
  if (!user) return null;
  const { credentials, ...rest } = user;
  return { ...rest };
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey.toString('hex'));
    });
  });
}

function verifyPassword(password, salt, hash) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      const hashed = derivedKey.toString('hex');
      const matches = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashed, 'hex'));
      resolve(matches);
    });
  });
}

class UserStore {
  constructor() {
    this.filePath = path.join(config.paths.data, 'users.json');
    this._queue = Promise.resolve();
  }

  async _withData(fn) {
    this._queue = this._queue.then(async () => {
      const data = await readJson(this.filePath, DEFAULT_DATA);
      const result = await fn(data);
      if (result && result.modified) {
        await writeJson(this.filePath, data);
      }
      return result ? result.value : undefined;
    });
    return this._queue;
  }

  async listUsers() {
    return this._withData(async (data) => {
      return { value: data.users.map((user) => sanitizeUser(user)) };
    });
  }

  async findByUsername(username) {
    return this._withData(async (data) => {
      const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      return { value: sanitizeUser(user) };
    });
  }

  async ensureDefaultAdmin() {
    const { username, password } = config.defaultAdmin;
    const existing = await this.findByUsername(username);
    if (existing) {
      return existing;
    }
    return this.createUser({
      username,
      password,
      role: 'admin',
      mustChangePassword: true,
      system: true
    });
  }

  async createUser({ username, password, role = 'viewer', mustChangePassword = false, system = false, createdBy = 'system' }) {
    const timestamp = Date.now();
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await hashPassword(password, salt);
    const user = {
      id: crypto.randomUUID(),
      username,
      role,
      credentials: { salt, hash },
      mustChangePassword,
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy,
      lastLoginAt: null
    };

    return this._withData(async (data) => {
      if (data.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
        throw new Error('User already exists');
      }
      data.users.push(user);
      return { value: sanitizeUser(user), modified: true };
    });
  }

  async updateUser(username, updates) {
    const timestamp = Date.now();
    return this._withData(async (data) => {
      const idx = data.users.findIndex((u) => u.username.toLowerCase() === username.toLowerCase());
      if (idx === -1) {
        return { value: null };
      }
      const user = data.users[idx];
      if (updates.role) {
        user.role = updates.role;
      }
      if (typeof updates.mustChangePassword === 'boolean') {
        user.mustChangePassword = updates.mustChangePassword;
      }
      if (typeof updates.disabled === 'boolean') {
        user.disabled = updates.disabled;
      }
      if (updates.password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = await hashPassword(updates.password, salt);
        user.credentials = { salt, hash };
        user.mustChangePassword = updates.mustChangePassword ?? false;
      }
      user.updatedAt = timestamp;
      data.users[idx] = user;
      return { value: sanitizeUser(user), modified: true };
    });
  }

  async authenticate(username, password) {
    return this._withData(async (data) => {
      const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!user || user.disabled) {
        return { value: null };
      }
      const matches = await verifyPassword(password, user.credentials.salt, user.credentials.hash);
      if (!matches) {
        return { value: null };
      }
      user.lastLoginAt = Date.now();
      return { value: sanitizeUser(user), modified: true };
    });
  }

  async verifyPassword(username, password) {
    return this._withData(async (data) => {
      const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!user) {
        return { value: false };
      }
      const matches = await verifyPassword(password, user.credentials.salt, user.credentials.hash);
      return { value: matches };
    });
  }
}

module.exports = new UserStore();
