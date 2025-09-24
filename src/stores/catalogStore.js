const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { readJson, writeJson } = require('../utils/jsonFile');

const DEFAULT_DATA = { codenames: {} };

class CatalogStore {
  constructor() {
    this.filePath = path.join(config.paths.data, 'catalog.json');
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

  async listCodenames() {
    return this._withData(async (data) => {
      return { value: Object.keys(data.codenames) };
    });
  }

  async listChannels(codename) {
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: [] };
      }
      return { value: Object.keys(codenameEntry.channels || {}) };
    });
  }

  async _ensureChannel(data, codename, channel) {
    if (!data.codenames[codename]) {
      data.codenames[codename] = { channels: {} };
    }
    const channels = data.codenames[codename].channels;
    if (!channels[channel]) {
      channels[channel] = { builds: [] };
    }
    return channels[channel];
  }

  async listBuilds(codename, channel) {
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: [] };
      }
      const channelEntry = codenameEntry.channels[channel];
      if (!channelEntry) {
        return { value: [] };
      }
      const builds = [...channelEntry.builds];
      builds.sort((a, b) => b.payload.timestamp - a.payload.timestamp);
      return { value: builds };
    });
  }

  async getBuild(codename, channel, buildId) {
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: null };
      }
      const channelEntry = codenameEntry.channels[channel];
      if (!channelEntry) {
        return { value: null };
      }
      const found = channelEntry.builds.find((b) => b.id === buildId);
      return { value: found || null };
    });
  }

  async findBuildByIncremental(codename, channel, incremental, type = 'full') {
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: null };
      }
      const channelEntry = codenameEntry.channels[channel];
      if (!channelEntry) {
        return { value: null };
      }
      const build = channelEntry.builds.find((b) => b.payload.incremental === incremental && b.type === type);
      return { value: build || null };
    });
  }

  async addBuild(build) {
    const timestamp = Date.now();
    const id = crypto.randomBytes(16).toString('hex');
    const payload = { ...build.payload, id };
    const record = {
      id,
      codename: build.codename,
      channel: build.channel,
      type: build.type || 'full',
      baseIncremental: build.baseIncremental || null,
      payload,
      publish: Boolean(build.publish),
      mandatory: Boolean(build.mandatory),
      file: build.file || null,
      changelogSourceId: build.changelogSourceId || null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: build.createdBy || 'system'
    };

    return this._withData(async (data) => {
      const channelEntry = await this._ensureChannel(data, build.codename, build.channel);
      channelEntry.builds.push(record);
      return { value: record, modified: true };
    });
  }

  async updateBuild(codename, channel, buildId, updates) {
    const timestamp = Date.now();
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: null };
      }
      const channelEntry = codenameEntry.channels[channel];
      if (!channelEntry) {
        return { value: null };
      }
      const idx = channelEntry.builds.findIndex((b) => b.id === buildId);
      if (idx === -1) {
        return { value: null };
      }
      const build = channelEntry.builds[idx];
      const originalPayload = build.payload;
      const updatedPayload = { ...originalPayload, ...(updates.payload || {}) };
      const updatedBuild = {
        ...build,
        payload: updatedPayload,
        publish: typeof updates.publish === 'boolean' ? updates.publish : build.publish,
        mandatory: typeof updates.mandatory === 'boolean' ? updates.mandatory : build.mandatory,
        file: updates.file ? { ...build.file, ...updates.file } : build.file,
        changelogSourceId: typeof updates.changelogSourceId === 'string' ? updates.changelogSourceId : build.changelogSourceId,
        updatedAt: timestamp
      };
      channelEntry.builds[idx] = updatedBuild;
      return { value: updatedBuild, modified: true };
    });
  }

  async deleteBuild(codename, channel, buildId) {
    return this._withData(async (data) => {
      const codenameEntry = data.codenames[codename];
      if (!codenameEntry) {
        return { value: false };
      }
      const channelEntry = codenameEntry.channels[channel];
      if (!channelEntry) {
        return { value: false };
      }
      const before = channelEntry.builds.length;
      channelEntry.builds = channelEntry.builds.filter((b) => b.id !== buildId);
      return { value: channelEntry.builds.length !== before, modified: before !== channelEntry.builds.length };
    });
  }
}

module.exports = new CatalogStore();
