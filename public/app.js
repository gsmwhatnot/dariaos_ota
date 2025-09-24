(() => {
  const appEl = document.getElementById('app');

  function createUploadState(overrides = {}) {
    return {
      step: 0,
      propFile: null,
      propMeta: null,
      changelogFile: null,
      changelogContent: '',
      fullFile: null,
      fullMeta: null,
      deltaFile: null,
      deltaMeta: null,
      publishFull: false,
      publishDelta: false,
      mandatory: false,
      confirmed: false,
      status: null,
      ...overrides
    };
  }

const state = {
  siteName: 'DariaOS OTA Console',
  user: null,
  view: 'dashboard',
    loading: false,
    error: null,
    flash: null,
    version: null,
    captcha: null,
    codenames: [],
    selectedCodename: null,
    selectedChannel: null,
    builds: [],
    uploading: createUploadState(),
    report: {
      codename: null,
      days: 7,
      data: null,
      loading: false
    },
  users: {
    list: [],
    loading: false
  }
};

const BASE_URL = (window.__BASE_URL__ || '').replace(/\/$/, '');

function resolveUrl(path) {
  if (!path) {
    return BASE_URL || '';
  }
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return BASE_URL ? `${BASE_URL}${normalized}` : normalized;
}

  const DEFAULT_REPORT_DAYS = 7;
  const MAX_REPORT_DAYS = 30;
  let reportChart = null;

  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Overview', minRole: 'viewer' },
    { id: 'builds', label: 'Builds', minRole: 'viewer' },
    { id: 'upload', label: 'Upload Firmware', minRole: 'maintainer' },
    { id: 'reports', label: 'Reports', minRole: 'viewer' },
    { id: 'users', label: 'User Management', minRole: 'admin' },
    { id: 'profile', label: 'My Profile', minRole: 'viewer' }
  ];

  const ROLE_PRIORITY = { viewer: 1, maintainer: 2, admin: 3 };
  const METRICS_INTERVAL = 1000;
  const METRICS_MAX_POINTS = 60 * 60; // keep up to 60 minutes of 1 Hz samples
  const metricsState = {
    timer: null,
    data: {
      cpu: [],
      memory: [],
      disk: [],
      netRx: [],
      netTx: []
    },
    charts: {},
    elements: {},
    downloads: null
  };

  function canAccessUploadStep(index) {
    if (index === 0) return true;
    if (index === 1) return Boolean(state.uploading.propMeta);
    if (index === 2) return Boolean(state.uploading.changelogContent);
    if (index === 3) return Boolean(state.uploading.fullFile);
    if (index === 4) {
      return Boolean(state.uploading.propMeta && state.uploading.changelogContent && state.uploading.fullFile);
    }
    return false;
  }

  function highestAccessibleUploadStep() {
    for (let i = 4; i >= 0; i -= 1) {
      if (canAccessUploadStep(i)) {
        return i;
      }
    }
    return 0;
  }

  function parseFullFirmwareName(filename) {
    if (!/\.zip$/i.test(filename)) {
      throw new Error('Full OTA file must have .zip extension');
    }
    const base = filename.slice(0, -4);
    const segments = base.split('-');
    if (segments.length < 8) {
      throw new Error('Full OTA filename format is invalid');
    }
    const osName = segments[0];
    const osMajorVersion = segments[1];
    const buildDate = segments[2];
    const channel = segments[3].toLowerCase();
    const codename = segments.slice(4, segments.length - 3).join('-');
    const incremental = segments[segments.length - 3];
    const buildType = segments[segments.length - 2];
    const signedTag = segments[segments.length - 1];
    if (!/^\d{8}$/.test(buildDate)) {
      throw new Error('Build date in full OTA filename must be YYYYMMDD');
    }
    return {
      osName,
      osMajorVersion,
      buildDate,
      channel,
      codename,
      incremental,
      buildType,
      signedTag
    };
  }

  function parseDeltaFirmwareName(filename) {
    if (!/\.zip$/i.test(filename)) {
      throw new Error('Delta OTA file must have .zip extension');
    }
    const base = filename.slice(0, -4);
    const segments = base.split('-');
    if (segments.length < 8) {
      throw new Error('Delta OTA filename format is invalid');
    }
    const osName = segments[0];
    const osMajorVersion = segments[1];
    const buildDate = segments[2];
    const channel = segments[3].toLowerCase();
    const codename = segments.slice(4, segments.length - 3).join('-');
    const transition = segments[segments.length - 3];
    const buildType = segments[segments.length - 2];
    const signedTag = segments[segments.length - 1];
    const delimiter = transition.includes('+') ? '+' : '>';
    const [baseIncremental, incremental] = transition.split(delimiter);
    if (!baseIncremental || !incremental) {
      throw new Error('Delta OTA filename must include previous+current incremental values');
    }
    if (!/^\d{8}$/.test(buildDate)) {
      throw new Error('Build date in delta OTA filename must be YYYYMMDD');
    }
    return {
      osName,
      osMajorVersion,
      buildDate,
      channel,
      codename,
      baseIncremental,
      incremental,
      buildType,
      signedTag
    };
  }

  function createHtmlEditor(initialHtml, onChange) {
    let current = initialHtml || '';
    const wrapper = document.createElement('div');
    wrapper.className = 'html-editor';

    const toolbar = document.createElement('div');
    toolbar.className = 'html-editor__toolbar';
    const buttons = [
      { icon: 'H1', cmd: 'formatBlock', arg: '<h1>', title: 'Heading 1' },
      { icon: 'H2', cmd: 'formatBlock', arg: '<h2>', title: 'Heading 2' },
      { icon: 'H3', cmd: 'formatBlock', arg: '<h3>', title: 'Heading 3' },
      { icon: 'Tx', cmd: 'formatBlock', arg: '<p>', title: 'Paragraph' },
      { icon: '<strong>B</strong>', cmd: 'bold', title: 'Bold' },
      { icon: '<em>I</em>', cmd: 'italic', title: 'Italic' },
      { icon: '<u>U</u>', cmd: 'underline', title: 'Underline' },
      { icon: '&#8226;', cmd: 'insertUnorderedList', title: 'Bullet list' },
      { icon: '1.', cmd: 'insertOrderedList', title: 'Numbered list' },
      { icon: '&#128279;', cmd: 'createLink', title: 'Insert link', prompt: 'Enter link URL' },
      { icon: '&#10006;', cmd: 'removeFormat', title: 'Clear formatting' }
    ];

    const editor = document.createElement('div');
    editor.className = 'html-editor__surface';
    editor.contentEditable = 'true';
    editor.innerHTML = current;

    buttons.forEach((button) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'html-editor__button';
      btn.innerHTML = button.icon;
      btn.title = button.title;
      btn.addEventListener('click', () => {
        editor.focus();
        if (button.cmd === 'createLink') {
          const url = window.prompt(button.prompt || 'Enter URL');
          if (url) {
            document.execCommand('createLink', false, url);
          }
        } else if (button.cmd === 'formatBlock') {
          const blockArg = button.arg || '<p>';
          document.execCommand('formatBlock', false, blockArg);
        } else {
          document.execCommand(button.cmd, false, button.arg || null);
        }
        current = editor.innerHTML;
        onChange(current);
      });
      toolbar.appendChild(btn);
    });

    editor.addEventListener('input', () => {
      current = editor.innerHTML;
      onChange(current);
    });

    wrapper.appendChild(toolbar);
    wrapper.appendChild(editor);
    return wrapper;
  }

  function createFilePicker({ buttonLabel, accept, file, onSelect, helperText }) {
    const container = document.createElement('div');
    container.className = 'file-picker';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button file-picker__button';
    button.textContent = buttonLabel;

    const fileName = document.createElement('span');
    fileName.className = 'file-picker__name';
    fileName.textContent = file ? file.name : 'No file chosen';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;

    const hint = document.createElement('div');
    hint.className = 'file-picker__hint';
    if (helperText) {
      hint.textContent = helperText;
    }

    button.addEventListener('click', () => input.click());

    input.addEventListener('change', async (ev) => {
      const selected = ev.target.files && ev.target.files[0];
      if (!selected) return;
      try {
        await onSelect(selected);
        fileName.textContent = selected.name;
        fileName.classList.remove('file-picker__name--error');
        clearError();
        input.value = '';
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        fileName.textContent = 'No file chosen';
        fileName.classList.add('file-picker__name--error');
        setError(message);
        input.value = '';
      }
    });

    container.append(button, fileName, input);
    if (helperText) {
      container.appendChild(hint);
    }
    return container;
  }

  function createToggle({ checked = false, onChange, disabled = false, ariaLabel, name }) {
    const container = document.createElement('label');
    container.className = 'toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    if (name) {
      input.name = name;
    }
    if (ariaLabel) {
      input.setAttribute('aria-label', ariaLabel);
    }
    input.disabled = Boolean(disabled);
    if (typeof onChange === 'function') {
      input.addEventListener('change', (event) => {
        onChange(event.target.checked, event);
      });
    }
    const slider = document.createElement('span');
    container.append(input, slider);
    return { element: container, input };
  }

  function createToggleField({
    label,
    checked = false,
    onChange,
    disabled = false,
    important = false,
    description = null,
    name
  }) {
    const wrapper = document.createElement('label');
    wrapper.className = `toggle-field${important ? ' toggle-field--important' : ''}`;
    const { element: toggleEl, input } = createToggle({
      checked,
      onChange,
      disabled,
      ariaLabel: label,
      name
    });
    wrapper.appendChild(toggleEl);

    const textBlock = document.createElement('div');
    textBlock.className = 'toggle-field__text';
    const textLabel = document.createElement('span');
    textLabel.className = 'toggle-field__label';
    textLabel.textContent = label;
    textBlock.appendChild(textLabel);
    if (description) {
      const descriptionEl = document.createElement('span');
      descriptionEl.className = 'toggle-field__description';
      descriptionEl.textContent = description;
      textBlock.appendChild(descriptionEl);
    }
    wrapper.appendChild(textBlock);
    return { element: wrapper, input };
  }

  const metricConfigs = [
    { key: 'cpu', label: 'CPU Usage', color: '#4f8cff', unit: '%' },
    { key: 'memory', label: 'RAM Usage', color: '#f5a524', unit: '%' },
    { key: 'disk', label: 'Disk Usage', color: '#ff6b6b', unit: '%' }
  ];

  function formatTimeLabel(date = new Date()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function pushMetricSample(seriesKey, value, timestamp = new Date()) {
    const series = metricsState.data[seriesKey];
    if (!series) return;
    series.push({ label: formatTimeLabel(timestamp), value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0 });
    while (series.length > METRICS_MAX_POINTS) {
      series.shift();
    }
  }

  function initializeMetricCharts() {
    if (typeof window.Chart === 'undefined') {
      return;
    }
    metricConfigs.forEach((config) => {
      const canvas = metricsState.elements[config.key];
      if (!canvas) return;
      const existing = metricsState.charts[config.key];
      if (existing) {
        existing.destroy();
      }
      const ctx = canvas.getContext('2d');
      metricsState.charts[config.key] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: config.label,
            data: [],
            borderColor: config.color,
            backgroundColor: withAlpha(config.color, 0.25),
            tension: 0.3,
            pointRadius: 0,
            fill: true
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              suggestedMax: 100,
              ticks: { stepSize: 20 },
              title: { display: true, text: config.unit }
            },
            x: {
              ticks: { maxRotation: 45, minRotation: 45 }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    });

    if (metricsState.elements.network) {
      const canvas = metricsState.elements.network;
      const existing = metricsState.charts.network;
      if (existing) existing.destroy();
      const ctx = canvas.getContext('2d');
      metricsState.charts.network = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Receive (KB/s)',
              data: [],
              borderColor: '#3ad29f',
              backgroundColor: withAlpha('#3ad29f', 0.2),
              tension: 0.3,
              pointRadius: 0,
              fill: true
            },
            {
              label: 'Transmit (KB/s)',
              data: [],
              borderColor: '#c084fc',
              backgroundColor: withAlpha('#c084fc', 0.2),
              tension: 0.3,
              pointRadius: 0,
              fill: true
            }
          ]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              title: { display: true, text: 'KB/s' }
            },
            x: {
              ticks: { maxRotation: 45, minRotation: 45 }
            }
          }
        }
      });
    }
  }

  function updateMetricsCharts() {
    const { charts, data } = metricsState;
    metricConfigs.forEach((config) => {
      const chart = charts[config.key];
      if (!chart) return;
      const series = data[config.key];
      chart.data.labels = series.map((sample) => sample.label);
      chart.data.datasets[0].data = series.map((sample) => sample.value);
      chart.update('none');
    });
    if (charts.network) {
      const labels = data.netRx.map((sample) => sample.label);
      charts.network.data.labels = labels;
      charts.network.data.datasets[0].data = data.netRx.map((sample) => sample.value);
      charts.network.data.datasets[1].data = data.netTx.map((sample) => sample.value);
      charts.network.update('none');
    }
  }

  function updateDownloadsPanel() {
    const container = metricsState.elements.downloadsBody;
    if (!container) return;
    container.innerHTML = '';
    const downloads = metricsState.downloads;
    if (!downloads) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'muted';
      cell.textContent = 'No download activity yet';
      row.appendChild(cell);
      container.appendChild(row);
      return;
    }
    const aggregate = new Map();
    downloads.daily.forEach(({ entries }) => {
      entries.forEach(({ codename, version, count }) => {
        const key = `${codename}__${version}`;
        aggregate.set(key, (aggregate.get(key) || 0) + count);
      });
    });
    const rows = Array.from(aggregate.entries()).map(([key, count]) => {
      const [codename, version] = key.split('__');
      return { codename, version, count };
    });
    rows.sort((a, b) => {
      if (a.codename === b.codename) {
        if (a.version === b.version) return 0;
        return a.version < b.version ? -1 : 1;
      }
      return a.codename < b.codename ? -1 : 1;
    });
    if (!rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.className = 'muted';
      cell.textContent = 'No download activity in the past 7 days';
      row.appendChild(cell);
      container.appendChild(row);
      return;
    }
    rows.forEach((item) => {
      const row = document.createElement('tr');
      const codenameCell = document.createElement('td');
      codenameCell.textContent = item.codename;
      const versionCell = document.createElement('td');
      versionCell.textContent = item.version;
      const countCell = document.createElement('td');
      countCell.textContent = item.count;
      row.appendChild(codenameCell);
      row.appendChild(versionCell);
      row.appendChild(countCell);
      container.appendChild(row);
    });
  }

  async function fetchSystemMetrics() {
    try {
      const metrics = await apiRequest('/api/system/metrics');
      const timestamp = new Date();
      pushMetricSample('cpu', metrics.cpu.percent, timestamp);
      pushMetricSample('memory', metrics.memory.usedPercent, timestamp);
      pushMetricSample('disk', metrics.disk.usedPercent, timestamp);
      const rxKb = metrics.network.rxRate / 1024;
      const txKb = metrics.network.txRate / 1024;
      pushMetricSample('netRx', rxKb, timestamp);
      pushMetricSample('netTx', txKb, timestamp);
      metricsState.downloads = metrics.downloads;
      updateMetricsCharts();
      updateDownloadsPanel();
    } catch (err) {
      // fail silently but stop timer if unauthorized
      if (err.message && err.message.includes('Not authenticated')) {
        stopMetricsPolling();
      }
    }
  }

  function startMetricsPolling() {
    if (metricsState.timer) return;
    fetchSystemMetrics();
    metricsState.timer = setInterval(fetchSystemMetrics, METRICS_INTERVAL);
  }

  function stopMetricsPolling() {
    if (metricsState.timer) {
      clearInterval(metricsState.timer);
      metricsState.timer = null;
    }
    Object.values(metricsState.charts).forEach((chart) => {
      if (chart) chart.destroy();
    });
    metricsState.charts = {};
    metricsState.elements = {};
    Object.keys(metricsState.data).forEach((key) => {
      metricsState.data[key] = [];
    });
    metricsState.downloads = null;
  }

  function hasRole(required) {
    if (!state.user) return false;
    return ROLE_PRIORITY[state.user.role] >= ROLE_PRIORITY[required];
  }

  async function apiRequest(path, options = {}) {
    const opts = {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
      },
      ...options
    };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    let requestUrl = path;
    if (typeof path === 'string') {
      requestUrl = resolveUrl(path);
    }
    try {
      res = await fetch(requestUrl, opts);
    } catch (err) {
      throw new Error(`Network error: ${err.message || err}`);
    }
    const contentType = res.headers.get('content-type') || '';
    let payload = null;
    if (contentType.includes('application/json')) {
      payload = await res.json();
    }
    if (!res.ok) {
      const error = (payload && (payload.error || payload.message)) || `Request failed (${res.status})`;
      throw new Error(error);
    }
    return payload;
  }

  function setFlash(message, tone = 'info') {
    state.flash = { message, tone, ts: Date.now() };
    render();
    if (message) {
      setTimeout(() => {
        if (state.flash && Date.now() - state.flash.ts >= 4000) {
          state.flash = null;
          render();
        }
      }, 4200);
    }
  }

  function setError(error) {
    state.error = error;
    render();
  }

  function clearError() {
    state.error = null;
  }

  function setView(view) {
    state.view = view;
    if (view === 'dashboard') {
      startMetricsPolling();
    } else {
      stopMetricsPolling();
    }
    if (view === 'builds') {
      ensureCodenames().then(() => {
        if (!state.selectedCodename && state.codenames.length) {
          state.selectedCodename = state.codenames[0].codename;
          state.selectedChannel = state.codenames[0].channels[0] || null;
        }
        if (state.selectedCodename && state.selectedChannel) {
          loadBuilds(state.selectedCodename, state.selectedChannel);
        }
      }).catch((err) => setError(err.message));
    }
    if (view === 'reports') {
      ensureCodenames().then(() => {
        if (!state.report.codename && state.codenames.length) {
          state.report.codename = state.codenames[0].codename;
        }
        if (!state.report.days) {
          state.report.days = DEFAULT_REPORT_DAYS;
        }
        if (state.report.codename) {
          loadReport(state.report.codename, state.report.days);
        }
      }).catch((err) => setError(err.message));
    }
    if (view === 'users' && hasRole('admin')) {
      loadUsers();
    }
    render();
  }

  async function loadSession() {
    try {
      const data = await apiRequest('/api/auth/session');
      state.siteName = data.siteName || state.siteName;
      state.version = data.version || state.version;
      if (data.authenticated) {
        state.user = data.user;
        if (state.user.mustChangePassword) {
          state.view = 'profile';
        }
        await ensureCodenames();
      } else {
        state.user = null;
        await refreshCaptcha();
      }
    } catch (err) {
      setError(err.message);
    }
    render();
  }

  async function refreshCaptcha() {
    try {
      state.captcha = await apiRequest('/api/auth/captcha');
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleLogin(formData) {
    try {
      clearError();
      state.loading = true;
      render();
      const payload = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: formData
      });
      state.user = payload.user;
      state.siteName = payload.siteName || state.siteName;
      state.version = payload.version || state.version;
      state.loading = false;
      state.view = state.user.mustChangePassword ? 'profile' : 'dashboard';
      setFlash('Signed in successfully', 'success');
      state.report.days = DEFAULT_REPORT_DAYS;
      await ensureCodenames();
      render();
    } catch (err) {
      state.loading = false;
      setError(err.message);
      await refreshCaptcha();
      render();
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout failed', err);
    }
    stopMetricsPolling();
    state.user = null;
    state.view = 'dashboard';
    state.codenames = [];
    state.builds = [];
    state.uploading = createUploadState();
    state.report = {
      codename: null,
      days: DEFAULT_REPORT_DAYS,
      data: null,
      loading: false
    };
    await refreshCaptcha();
    render();
  }

  async function ensureCodenames() {
    if (!state.user || state.codenames.length) return;
    try {
      const data = await apiRequest('/api/catalog/codenames');
      state.codenames = data.codenames || [];
      if (state.codenames.length) {
        state.selectedCodename = state.codenames[0].codename;
        state.selectedChannel = state.codenames[0].channels[0] || 'release';
      }
    } catch (err) {
      throw err;
    }
  }

  async function loadBuilds(codename, channel) {
    try {
      const data = await apiRequest(`/api/catalog/${encodeURIComponent(codename)}/${encodeURIComponent(channel)}`);
      state.builds = data.builds || [];
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function togglePublish(build, value) {
    try {
      const data = await apiRequest(`/api/catalog/${encodeURIComponent(state.selectedCodename)}/${encodeURIComponent(state.selectedChannel)}/${encodeURIComponent(build.id)}`, {
        method: 'PATCH',
        body: { publish: value }
      });
      const updated = data && data.build ? data.build : { ...build, publish: value };
      const index = state.builds.findIndex((item) => item.id === build.id);
      if (index !== -1) {
        state.builds[index] = updated;
      }
      setFlash(`Publish state updated for ${build.payload.incremental}`, 'success');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleMandatory(build, value) {
    try {
      const data = await apiRequest(`/api/catalog/${encodeURIComponent(state.selectedCodename)}/${encodeURIComponent(state.selectedChannel)}/${encodeURIComponent(build.id)}`, {
        method: 'PATCH',
        body: { mandatory: value }
      });
      const updated = data && data.build ? data.build : { ...build, mandatory: value };
      const index = state.builds.findIndex((item) => item.id === build.id);
      if (index !== -1) {
        state.builds[index] = updated;
      }
      setFlash(`Mandatory status updated for ${build.payload.incremental}`, 'info');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateBuild(build, updates) {
    try {
      const payload = {};
      if (typeof updates.publish === 'boolean') {
        payload.publish = updates.publish;
      }
      if (updates.url !== undefined) {
        payload.url = updates.url;
      }
      if (updates.changesHtml !== undefined) {
        payload.changesHtml = updates.changesHtml;
      }
      const data = await apiRequest(`/api/catalog/${encodeURIComponent(state.selectedCodename)}/${encodeURIComponent(state.selectedChannel)}/${encodeURIComponent(build.id)}`, {
        method: 'PATCH',
        body: payload
      });
      const updated = data.build;
      const index = state.builds.findIndex((b) => b.id === build.id);
      if (index !== -1) {
        state.builds[index] = updated;
      }
      setFlash('Build updated', 'success');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadReport(codename, days) {
    if (!codename) return;
    try {
      state.report.loading = true;
      state.report.data = null;
      render();
      const effectiveDays = Math.max(1, Math.min(days ?? state.report.days ?? DEFAULT_REPORT_DAYS, MAX_REPORT_DAYS));
      state.report.days = effectiveDays;
      const query = `?days=${encodeURIComponent(effectiveDays)}`;
      const data = await apiRequest(`/api/reports/${encodeURIComponent(codename)}${query}`);
      if (typeof data.days === 'number') {
        state.report.days = Math.max(1, Math.min(data.days, MAX_REPORT_DAYS));
      }
      state.report.data = data;
    } catch (err) {
      setError(err.message);
    } finally {
      state.report.loading = false;
      render();
    }
  }

  async function loadUsers() {
    if (!hasRole('admin')) return;
    try {
      state.users.loading = true;
      render();
      const data = await apiRequest('/api/users');
      state.users.list = data.users || [];
    } catch (err) {
      setError(err.message);
    } finally {
      state.users.loading = false;
      render();
    }
  }

  async function createUser(payload) {
    try {
      const data = await apiRequest('/api/users', {
        method: 'POST',
        body: payload
      });
      state.users.list.push(data.user);
      setFlash('User created', 'success');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function updateUser(username, updates) {
    try {
      const data = await apiRequest(`/api/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        body: updates
      });
      const idx = state.users.list.findIndex((u) => u.username === username);
      if (idx !== -1) {
        state.users.list[idx] = data.user;
      }
      setFlash('User updated', 'success');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePassword(currentPassword, newPassword) {
    try {
      const data = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword }
      });
      state.user = data.user;
      state.version = data.version || state.version;
      setFlash('Password updated', 'success');
      render();
    } catch (err) {
      setError(err.message);
    }
  }

  function getPlannedUploadSize() {
    const up = state.uploading;
    const fullSize = up.fullFile ? up.fullFile.size : 0;
    const deltaSize = up.deltaFile ? up.deltaFile.size : 0;
    return fullSize + deltaSize;
  }

  async function verifyDiskCapacityForUpload(totalBytes) {
    if (!totalBytes || totalBytes <= 0) {
      return;
    }
    const metrics = await apiRequest('/api/system/metrics');
    const disk = metrics && metrics.disk ? metrics.disk : {};
    const total = Number(disk.total) || 0;
    const free = Number(disk.free) || 0;
    if (!total) {
      return;
    }
    const projectedFree = free - totalBytes;
    if (projectedFree < 0) {
      throw new Error(`Upload requires ${humanFileSize(totalBytes)} but only ${humanFileSize(Math.max(free, 0))} is free.`);
    }
    const projectedPercent = (projectedFree / total) * 100;
    if (projectedPercent < 5) {
      const remainingText = humanFileSize(Math.max(projectedFree, 0));
      throw new Error(`Insufficient disk space: uploading would leave ${remainingText} free (~${projectedPercent.toFixed(2)}% of total).`);
    }
  }

  async function ensureCatalogDoesNotAlreadyContain(fullMeta, deltaMeta) {
    if (!fullMeta) {
      return;
    }
    const codename = fullMeta.codename;
    const channel = fullMeta.channel;
    if (!codename || !channel) {
      return;
    }
    const data = await apiRequest(`/api/catalog/${encodeURIComponent(codename)}/${encodeURIComponent(channel)}`);
    const builds = Array.isArray(data && data.builds) ? data.builds : [];
    const duplicateFull = builds.some((build) => build
      && build.type === 'full'
      && build.payload
      && build.payload.incremental === fullMeta.incremental);
    if (duplicateFull) {
      throw new Error(`A full build for ${fullMeta.incremental} already exists in ${codename}/${channel}.`);
    }
    if (deltaMeta) {
      const duplicateDelta = builds.some((build) => build
        && build.type === 'delta'
        && build.baseIncremental === deltaMeta.baseIncremental
        && build.payload
        && build.payload.incremental === deltaMeta.incremental);
      if (duplicateDelta) {
        throw new Error(`A delta from ${deltaMeta.baseIncremental} to ${deltaMeta.incremental} already exists in ${codename}/${channel}.`);
      }
    }
  }

  async function runUploadPreflightChecks() {
    const up = state.uploading;
    if (!up.fullFile || !up.fullMeta) {
      throw new Error('Full OTA package metadata is missing. Please re-select the full OTA zip.');
    }
    const totalBytes = getPlannedUploadSize();
    await verifyDiskCapacityForUpload(totalBytes);
    await ensureCatalogDoesNotAlreadyContain(up.fullMeta, up.deltaMeta);
  }

  async function submitFirmwareUpload() {
    if (state.uploading.status && state.uploading.status.loading) {
      return;
    }
    try {
      await runUploadPreflightChecks();
    } catch (err) {
      state.uploading.status = { loading: false, error: err.message || 'Pre-upload checks failed', result: null };
      render();
      return;
    }
    const up = state.uploading;
    const fd = new FormData();
    fd.append('prop', up.propFile);
    const changelogBlob = new Blob([up.changelogContent], { type: 'text/html' });
    fd.append('changelog', changelogBlob, up.changelogFile ? up.changelogFile.name : 'changelog.html');
    fd.append('full', up.fullFile);
    if (up.deltaFile) {
      fd.append('delta', up.deltaFile);
    }
    fd.append('publishFull', up.publishFull ? 'true' : 'false');
    fd.append('publishDelta', up.publishDelta ? 'true' : 'false');
    fd.append('mandatoryFull', up.mandatory ? 'true' : 'false');

    state.uploading.status = { loading: true, error: null, result: null, progress: 0 };
    render();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', resolveUrl('/api/firmware/upload'));

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 100);
        state.uploading.status = { ...state.uploading.status, loading: true, progress };
        render();
      }
    });

    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let response = null;
        try {
          response = JSON.parse(xhr.responseText || '{}');
        } catch (err) {
          response = { success: true };
        }
        state.uploading = createUploadState({ status: { loading: false, error: null, result: response } });
        await loadBuilds(state.selectedCodename, state.selectedChannel);
        setFlash('Firmware uploaded', 'success');
        render();
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const payload = JSON.parse(xhr.responseText || '{}');
          if (payload && payload.error) {
            message = payload.error;
          }
        } catch (err) {
          // ignore
        }
        state.uploading.status = { loading: false, error: message, result: null };
        render();
      }
    });

    xhr.addEventListener('error', () => {
      state.uploading.status = { loading: false, error: 'Network error while uploading firmware', result: null };
      render();
    });

    xhr.send(fd);
  }

  function render() {
    if (!state.user) {
      renderLogin();
    } else {
      renderMain();
    }
  }

  function renderLogin() {
    const wrapper = document.createElement('div');
    wrapper.className = 'login-wrapper';

    const card = document.createElement('div');
    card.className = 'login-card';

    const title = document.createElement('h1');
    title.textContent = state.siteName;
    card.appendChild(title);

    if (state.error) {
      const alert = document.createElement('div');
      alert.className = 'alert';
      alert.textContent = state.error;
      card.appendChild(alert);
    }

    const form = document.createElement('form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const formData = {
        username: form.elements.username.value.trim(),
        password: form.elements.password.value,
        captchaId: state.captcha ? state.captcha.id : '',
        captchaAnswer: form.elements.captchaAnswer.value.trim()
      };
      handleLogin(formData);
    });

    const userLabel = document.createElement('label');
    userLabel.textContent = 'Username';
    userLabel.className = 'sr-only';
    const userInput = document.createElement('input');
    userInput.type = 'text';
    userInput.name = 'username';
    userInput.required = true;
    userInput.autocomplete = 'username';
    userInput.placeholder = 'Username';
    form.appendChild(userLabel);
    form.appendChild(userInput);

    const passLabel = document.createElement('label');
    passLabel.textContent = 'Password';
    passLabel.className = 'sr-only';
    const passInput = document.createElement('input');
    passInput.type = 'password';
    passInput.name = 'password';
    passInput.required = true;
    passInput.autocomplete = 'current-password';
    passInput.placeholder = 'Password';
    form.appendChild(passLabel);
    form.appendChild(passInput);

    const captchaGroup = document.createElement('div');
    captchaGroup.className = 'captcha-group';

    const captchaFieldWrapper = document.createElement('div');
    captchaFieldWrapper.className = 'captcha-field';
    const captchaLabel = document.createElement('label');
    captchaLabel.textContent = 'Captcha';
    captchaLabel.className = 'sr-only';
    captchaFieldWrapper.appendChild(captchaLabel);
    const captchaQuestion = document.createElement('span');
    captchaQuestion.className = 'captcha-question';
    captchaQuestion.textContent = state.captcha ? state.captcha.question : 'Loading…';
    captchaFieldWrapper.appendChild(captchaQuestion);
    const captchaField = document.createElement('input');
    captchaField.type = 'text';
    captchaField.name = 'captchaAnswer';
    captchaField.required = true;
    captchaField.placeholder = 'Enter answer';
    captchaFieldWrapper.appendChild(captchaField);
    captchaGroup.appendChild(captchaFieldWrapper);

    const captchaBtn = document.createElement('button');
    captchaBtn.type = 'button';
    captchaBtn.className = 'captcha-refresh';
    captchaBtn.innerHTML = '&#x21bb;';
    captchaBtn.setAttribute('aria-label', 'Refresh captcha');
    captchaBtn.addEventListener('click', async () => {
      await refreshCaptcha();
      renderLogin();
    });
    captchaFieldWrapper.appendChild(captchaBtn);

    form.appendChild(captchaGroup);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'button';
    submit.style.width = '100%';
    submit.disabled = state.loading;
    submit.textContent = state.loading ? 'Signing in…' : 'Sign In';
    form.appendChild(submit);

    card.appendChild(form);

    const helper = document.createElement('p');
    helper.className = 'muted';
    helper.style.marginTop = '16px';
    helper.textContent = 'Use your administrator credentials to access the OTA console.';
    card.appendChild(helper);

    wrapper.appendChild(card);

    const year = new Date().getFullYear();
    const footer = document.createElement('div');
    footer.className = 'app-footer';
    const copyrightLine = document.createElement('div');
    copyrightLine.textContent = `© ${year} - ${state.siteName} - All rights reserved.`;
    footer.appendChild(copyrightLine);
    if (state.version) {
      const footerVersion = document.createElement('div');
      footerVersion.className = 'app-version';
      footerVersion.textContent = `Version ${state.version}`;
      footer.appendChild(footerVersion);
    }
    wrapper.appendChild(footer);
    appEl.innerHTML = '';
    appEl.appendChild(wrapper);
  }

  function renderMain() {
    const shell = document.createElement('div');
    shell.className = 'app-shell';

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';

    const heading = document.createElement('h1');
    heading.textContent = state.siteName;
    sidebar.appendChild(heading);

    NAV_ITEMS.filter((item) => hasRole(item.minRole)).forEach((item) => {
      const nav = document.createElement('div');
      nav.className = `nav-item ${state.view === item.id ? 'active' : ''}`;
      nav.textContent = item.label;
      nav.addEventListener('click', () => setView(item.id));
      sidebar.appendChild(nav);
    });

    const footer = document.createElement('div');
    footer.className = 'nav-footer';
    const footerLabel = document.createElement('div');
    footerLabel.textContent = `You are logged in as ${state.user.role.toUpperCase()}`;
    footer.appendChild(footerLabel);
    const year = new Date().getFullYear();
    const copyright = document.createElement('div');
    copyright.className = 'app-footer';
    const copyrightLine = document.createElement('div');
    copyrightLine.textContent = `© ${year} - ${state.siteName} - All rights reserved.`;
    copyright.appendChild(copyrightLine);
    if (state.version) {
      const footerVersion = document.createElement('div');
      footerVersion.className = 'app-version';
      footerVersion.textContent = `Version ${state.version}`;
      copyright.appendChild(footerVersion);
    }
    footer.appendChild(copyright);
    sidebar.appendChild(footer);

    shell.appendChild(sidebar);

    const mainArea = document.createElement('div');
    mainArea.className = 'main-area';

    const topbar = document.createElement('header');
    topbar.className = 'topbar';

    const breadcrumb = document.createElement('div');
    breadcrumb.textContent = viewTitle(state.view);
    topbar.appendChild(breadcrumb);

    const userChip = document.createElement('div');
    userChip.className = 'user-chip';
    const dot = document.createElement('span');
    dot.className = 'status-dot online';
    const name = document.createElement('span');
    name.textContent = state.user.username;
    userChip.appendChild(dot);
    userChip.appendChild(name);

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'icon-button logout-button';
    logoutBtn.setAttribute('aria-label', 'Sign out');
    logoutBtn.innerHTML = '<svg viewBox="0 0 24 24" class="logout-icon" aria-hidden="true" role="img"><title>Logout</title><path d="M17 16L21 12M21 12L17 8M21 12L7 12M13 16V17C13 18.6569 11.6569 20 10 20H6C4.34315 20 3 18.6569 3 17V7C3 5.34315 4.34315 4 6 4H10C11.6569 4 13 5.34315 13 7V8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';
    logoutBtn.addEventListener('click', handleLogout);
    userChip.appendChild(logoutBtn);

    topbar.appendChild(userChip);

    mainArea.appendChild(topbar);

    const content = document.createElement('main');
    content.className = 'content';

    if (state.flash) {
      const flash = document.createElement('div');
      flash.className = state.flash.tone === 'success' ? 'success' : 'alert';
      flash.textContent = state.flash.message;
      content.appendChild(flash);
    }

    if (state.error) {
      const alert = document.createElement('div');
      alert.className = 'alert';
      alert.textContent = state.error;
      content.appendChild(alert);
    }

    switch (state.user.mustChangePassword ? 'profile' : state.view) {
      case 'dashboard':
        content.appendChild(renderDashboard());
        break;
      case 'builds':
        content.appendChild(renderBuilds());
        break;
      case 'upload':
        content.appendChild(renderUpload());
        break;
      case 'reports':
        content.appendChild(renderReports());
        break;
      case 'users':
        content.appendChild(renderUsers());
        break;
      case 'profile':
      default:
        content.appendChild(renderProfile());
        break;
    }

    mainArea.appendChild(content);
    shell.appendChild(mainArea);

    appEl.innerHTML = '';
    appEl.appendChild(shell);

    if (state.uploading.status && state.uploading.status.loading) {
      const overlay = document.createElement('div');
      overlay.className = 'upload-overlay';
      const panel = document.createElement('div');
      panel.className = 'upload-overlay__panel';

      const heading = document.createElement('p');
      heading.className = 'upload-overlay__title';
      heading.textContent = 'Uploading firmware…';
      panel.appendChild(heading);

      if (typeof state.uploading.status.progress === 'number') {
        const progressBar = document.createElement('div');
        progressBar.className = 'upload-overlay__progress';
        const progressInner = document.createElement('div');
        progressInner.style.width = `${Math.min(state.uploading.status.progress, 100)}%`;
        progressBar.appendChild(progressInner);
        panel.appendChild(progressBar);

        const progressText = document.createElement('span');
        progressText.className = 'upload-overlay__percent';
        progressText.textContent = `${Math.min(state.uploading.status.progress, 100)}%`;
        panel.appendChild(progressText);
      }

      overlay.appendChild(panel);
      appEl.appendChild(overlay);
    }
  }

  function viewTitle(view) {
    const map = {
      dashboard: 'Overview',
      builds: 'Firmware Builds',
      upload: 'Upload Firmware',
      reports: 'Device Reports',
      users: 'User Management',
      profile: 'Account'
    };
    return map[view] || 'Overview';
  }

  function renderDashboard() {
    const container = document.createElement('div');

    metricsState.elements = {};

    const metricsCard = document.createElement('div');
    metricsCard.className = 'card metrics-card';
    const metricsHeader = document.createElement('div');
    metricsHeader.className = 'metrics-card__header';
    const metricsTitle = document.createElement('h2');
    metricsTitle.textContent = 'System Resources';
    const metricsSubtitle = document.createElement('span');
    metricsSubtitle.className = 'muted';
    metricsSubtitle.textContent = 'Refreshed every 10 seconds';
    metricsHeader.append(metricsTitle, metricsSubtitle);
    metricsCard.appendChild(metricsHeader);

    const metricsGrid = document.createElement('div');
    metricsGrid.className = 'metrics-grid';
    metricConfigs.forEach((config) => {
      const panel = document.createElement('div');
      panel.className = 'metrics-panel';
      const panelTitle = document.createElement('h3');
      panelTitle.textContent = config.label;
      const panelCanvasWrapper = document.createElement('div');
      panelCanvasWrapper.className = 'metrics-panel__canvas';
      const panelCanvas = document.createElement('canvas');
      panelCanvasWrapper.appendChild(panelCanvas);
      panel.appendChild(panelTitle);
      panel.appendChild(panelCanvasWrapper);
      metricsGrid.appendChild(panel);
      metricsState.elements[config.key] = panelCanvas;
    });

    const networkPanel = document.createElement('div');
    networkPanel.className = 'metrics-panel metrics-panel--wide';
    const networkTitle = document.createElement('h3');
    networkTitle.textContent = 'Network Throughput';
    const networkCanvasWrapper = document.createElement('div');
    networkCanvasWrapper.className = 'metrics-panel__canvas metrics-panel__canvas--wide';
    const networkCanvas = document.createElement('canvas');
    networkCanvasWrapper.appendChild(networkCanvas);
    networkPanel.appendChild(networkTitle);
    networkPanel.appendChild(networkCanvasWrapper);
    metricsGrid.appendChild(networkPanel);
    metricsState.elements.network = networkCanvas;

    metricsCard.appendChild(metricsGrid);
    container.appendChild(metricsCard);

    const downloadsCard = document.createElement('div');
    downloadsCard.className = 'card metrics-card';
    const downloadsTitle = document.createElement('h2');
    downloadsTitle.textContent = 'Downloads (Last 7 Days)';
    downloadsCard.appendChild(downloadsTitle);

    const downloadsTable = document.createElement('table');
    downloadsTable.className = 'table';
    const downloadsHead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Codename', 'Version', 'Downloads'].forEach((label) => {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    });
    downloadsHead.appendChild(headRow);
    downloadsTable.appendChild(downloadsHead);

    const downloadsBody = document.createElement('tbody');
    downloadsTable.appendChild(downloadsBody);
    downloadsCard.appendChild(downloadsTable);
    container.appendChild(downloadsCard);

    metricsState.elements.downloadsBody = downloadsBody;
    initializeMetricCharts();
    updateMetricsCharts();
    updateDownloadsPanel();
    startMetricsPolling();

    return container;
  }

  function renderBuilds() {
    const container = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '16px';

    const title = document.createElement('h2');
    title.textContent = 'Build Catalog';
    header.appendChild(title);

    const selectors = document.createElement('div');
    selectors.style.display = 'flex';
    selectors.style.gap = '12px';

    const codenameSelect = document.createElement('select');
    state.codenames.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.codename;
      option.textContent = item.codename;
      if (item.codename === state.selectedCodename) option.selected = true;
      codenameSelect.appendChild(option);
    });
    codenameSelect.addEventListener('change', (ev) => {
      state.selectedCodename = ev.target.value;
      const item = state.codenames.find((c) => c.codename === state.selectedCodename);
      state.selectedChannel = item && item.channels.length ? item.channels[0] : 'release';
      loadBuilds(state.selectedCodename, state.selectedChannel);
    });
    selectors.appendChild(codenameSelect);

    const channelSelect = document.createElement('select');
    const selectedCodenameEntry = state.codenames.find((c) => c.codename === state.selectedCodename);
    (selectedCodenameEntry ? selectedCodenameEntry.channels : ['release']).forEach((channel) => {
      const option = document.createElement('option');
      option.value = channel;
      option.textContent = channel;
      if (channel === state.selectedChannel) option.selected = true;
      channelSelect.appendChild(option);
    });
    channelSelect.addEventListener('change', (ev) => {
      state.selectedChannel = ev.target.value;
      loadBuilds(state.selectedCodename, state.selectedChannel);
    });
    selectors.appendChild(channelSelect);

    header.appendChild(selectors);
    card.appendChild(header);

    const tzOffsetMinutes = new Date().getTimezoneOffset();
    const offsetHours = Math.trunc(Math.abs(tzOffsetMinutes) / 60);
    const offsetMinutes = Math.abs(tzOffsetMinutes) % 60;
    const sign = tzOffsetMinutes <= 0 ? '+' : '-';
    const formattedOffset = `${sign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;

    if (!state.builds.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No builds found for the selected codename and channel yet.';
      card.appendChild(empty);
    } else {
      const table = document.createElement('table');
      table.className = 'table';
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      ['Incremental', 'OS Version', 'Publish', 'Mandatory', 'URL', 'Size', `Updated (${formattedOffset})`, 'Actions'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      state.builds.forEach((build) => {
        const row = document.createElement('tr');

        const incremental = document.createElement('td');
        let incrementalText = build.payload.incremental;
        if (build.type === 'delta' && build.baseIncremental) {
          incrementalText = `${build.baseIncremental} &gt; ${build.payload.incremental}`;
        }
        incremental.innerHTML = `<span class="tag ${build.type}">${build.type}</span> ${incrementalText}`;
        row.appendChild(incremental);

        const typeCell = document.createElement('td');
        typeCell.textContent = build.payload.version;
        row.appendChild(typeCell);

        const publishCell = document.createElement('td');
        const { element: publishToggle } = createToggle({
          checked: build.publish,
          onChange: (value) => togglePublish(build, value),
          ariaLabel: `Publish ${build.payload.incremental}`
        });
        publishCell.appendChild(publishToggle);
        row.appendChild(publishCell);

        const mandatoryCell = document.createElement('td');
        if (build.type === 'full') {
          const { element: mandatoryToggle } = createToggle({
            checked: Boolean(build.mandatory),
            onChange: (value) => toggleMandatory(build, value),
            ariaLabel: `Mandatory ${build.payload.incremental}`
          });
          mandatoryCell.appendChild(mandatoryToggle);
        } else {
          const dash = document.createElement('span');
          dash.className = 'muted';
          dash.textContent = '—';
          mandatoryCell.appendChild(dash);
        }
        row.appendChild(mandatoryCell);

        const urlCell = document.createElement('td');
        const link = document.createElement('a');
        link.href = build.payload.url;
        link.textContent = 'Download';
        link.target = '_blank';
        urlCell.appendChild(link);
        row.appendChild(urlCell);

        const sizeCell = document.createElement('td');
        sizeCell.textContent = humanFileSize(build.payload.size);
        row.appendChild(sizeCell);

        const updatedCell = document.createElement('td');
        const updated = build.updatedAt ? new Date(build.updatedAt).toLocaleString() : '';
        updatedCell.textContent = updated;
        row.appendChild(updatedCell);

        const actions = document.createElement('td');
        actions.className = 'table-actions';
        const editBtn = document.createElement('button');
        editBtn.className = 'button secondary';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => openEditModal(build));
        actions.appendChild(editBtn);
        row.appendChild(actions);

        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      card.appendChild(table);
    }

    container.appendChild(card);
    return container;
  }

  function openEditModal(build) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const title = document.createElement('h3');
    title.textContent = `Edit ${build.payload.incremental}`;
    modal.appendChild(title);

    const form = document.createElement('form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const updates = {
        url: form.elements.url.value.trim()
      };
      if (build.type === 'full' && form.dataset.changesHtml) {
        updates.changesHtml = form.dataset.changesHtml;
      }
      updateBuild(build, updates);
      document.body.removeChild(backdrop);
    });

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'Download URL';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.name = 'url';
    urlInput.value = build.payload.url;
    urlInput.placeholder = 'Download URL';
    form.appendChild(urlLabel);
    form.appendChild(urlInput);

    if (build.type === 'full') {
      let editorValue = decodeBase64(build.payload.changes);
      form.dataset.changesHtml = editorValue;
      const changesLabel = document.createElement('label');
      changesLabel.textContent = 'Changelog';
      form.appendChild(changesLabel);
      const editor = createHtmlEditor(editorValue, (html) => {
        editorValue = html;
        form.dataset.changesHtml = html;
      });
      form.appendChild(editor);
    }

    const actionRow = document.createElement('div');
    actionRow.className = 'form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => document.body.removeChild(backdrop));
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'button';
    save.textContent = 'Save Changes';
    actionRow.appendChild(cancel);
    actionRow.appendChild(save);
    form.appendChild(actionRow);

    modal.appendChild(form);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  function renderUpload() {
    const up = state.uploading;
    const maxStep = highestAccessibleUploadStep();
    if (up.step > maxStep) {
      up.step = maxStep;
    }
    const container = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Firmware Upload Wizard';
    card.appendChild(title);

    const steps = ['Upload prop', 'Changelog', 'Full OTA', 'Delta OTA', 'Review'];
    const indicator = document.createElement('div');
    indicator.className = 'step-indicator';
    steps.forEach((label, index) => {
      const stepButton = document.createElement('button');
      stepButton.type = 'button';
      stepButton.className = `step ${up.step === index ? 'active' : ''}`;
      if (index < up.step && canAccessUploadStep(index)) {
        stepButton.classList.add('completed');
      }
      stepButton.textContent = `${index + 1}. ${label}`;
      const enabled = canAccessUploadStep(index);
      if (!enabled) {
        stepButton.disabled = true;
      } else {
        stepButton.addEventListener('click', () => {
          state.uploading.step = index;
          if (index !== steps.length - 1) {
            state.uploading.confirmed = false;
          }
          render();
        });
      }
      indicator.appendChild(stepButton);
    });
    card.appendChild(indicator);

    if (up.status && up.status.error) {
      const alert = document.createElement('div');
      alert.className = 'alert';
      alert.textContent = up.status.error;
      card.appendChild(alert);
    }
    const forms = [renderPropStep, renderChangelogStep, renderFullStep, renderDeltaStep, renderReviewStep];
    card.appendChild(forms[up.step]());

    container.appendChild(card);
    return container;
  }

  function renderPropStep() {
    const wrapper = document.createElement('div');
    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent = 'Upload the extracted build.prop file to inspect firmware metadata.';
    wrapper.appendChild(description);

    const picker = createFilePicker({
      buttonLabel: state.uploading.propFile ? 'Replace build.prop file' : 'Choose build.prop file',
      accept: '.prop,text/plain',
      file: state.uploading.propFile,
      helperText: 'Accepted formats: .prop',
      onSelect: async (file) => {
        const fd = new FormData();
        fd.append('prop', file);
        const data = await apiRequest('/api/tools/parse-prop', {
          method: 'POST',
          body: fd
        });
        state.uploading.propFile = file;
        state.uploading.propMeta = data.properties;
        state.uploading.changelogFile = null;
        state.uploading.changelogContent = '';
        state.uploading.fullFile = null;
        state.uploading.fullMeta = null;
        state.uploading.deltaFile = null;
        state.uploading.deltaMeta = null;
        state.uploading.publishFull = false;
        state.uploading.publishDelta = false;
        state.uploading.mandatory = false;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        state.uploading.step = 1;
        render();
      }
    });
    wrapper.appendChild(picker);

    if (state.uploading.propMeta) {
      const table = document.createElement('table');
      table.className = 'table';
      const tbody = document.createElement('tbody');
      Object.entries(state.uploading.propMeta).forEach(([key, value]) => {
        const row = document.createElement('tr');
        const k = document.createElement('td');
        k.textContent = key;
        const v = document.createElement('td');
        v.textContent = value;
        row.appendChild(k);
        row.appendChild(v);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      wrapper.appendChild(table);
    }

    return wrapper;
  }

  function renderChangelogStep() {
    const wrapper = document.createElement('div');
    const picker = createFilePicker({
      buttonLabel: state.uploading.changelogFile ? 'Replace changelog HTML' : 'Choose changelog HTML',
      accept: '.html,text/html',
      file: state.uploading.changelogFile,
      helperText: 'Upload HTML-formatted changelog (will be editable)',
      onSelect: async (file) => {
        const text = await file.text();
        state.uploading.changelogFile = file;
        state.uploading.changelogContent = text;
        state.uploading.fullFile = null;
        state.uploading.fullMeta = null;
        state.uploading.deltaFile = null;
        state.uploading.deltaMeta = null;
        state.uploading.publishFull = false;
        state.uploading.publishDelta = false;
        state.uploading.mandatory = false;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        render();
      }
    });
    wrapper.appendChild(picker);

    if (state.uploading.changelogContent) {
      const editor = createHtmlEditor(state.uploading.changelogContent, (html) => {
        state.uploading.changelogContent = html;
        state.uploading.confirmed = false;
        state.uploading.status = null;
      });
      wrapper.appendChild(editor);

      const next = document.createElement('button');
      next.className = 'button';
      next.textContent = 'Next';
      next.type = 'button';
      next.disabled = !state.uploading.changelogContent;
      next.addEventListener('click', () => {
        if (!state.uploading.changelogContent) return;
        state.uploading.step = 2;
        state.uploading.confirmed = false;
        render();
      });
      wrapper.appendChild(next);
    }

    return wrapper;
  }

  function renderFullStep() {
    const wrapper = document.createElement('div');
    const picker = createFilePicker({
      buttonLabel: state.uploading.fullFile ? 'Replace full OTA zip' : 'Choose full OTA zip',
      accept: '.zip',
      file: state.uploading.fullFile,
      helperText: 'Expected format: {OS}-{VERSION}-{DATE}-{CHANNEL}-{CODENAME}-{INCREMENTAL}-{TYPE}-{SIGNED}.zip',
      onSelect: async (file) => {
        const meta = parseFullFirmwareName(file.name);
        if (state.uploading.propMeta) {
          const expectedCodename = state.uploading.propMeta.device;
          const expectedIncremental = state.uploading.propMeta.incremental;
          if (meta.codename !== expectedCodename) {
            throw new Error(`Full OTA filename codename ${meta.codename} does not match prop device ${expectedCodename}`);
          }
          if (meta.incremental !== expectedIncremental) {
            throw new Error(`Full OTA incremental ${meta.incremental} does not match prop incremental ${expectedIncremental}`);
          }
        }
        state.uploading.fullFile = file;
        state.uploading.fullMeta = meta;
        state.uploading.deltaFile = null;
        state.uploading.deltaMeta = null;
        state.uploading.publishDelta = false;
        state.uploading.publishFull = false;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        state.uploading.mandatory = false;
        render();
      }
    });
    wrapper.appendChild(picker);

    if (state.uploading.fullFile) {
      const metaCard = document.createElement('div');
      metaCard.className = 'file-meta';
      const lines = [
        `<strong>File:</strong> ${state.uploading.fullFile.name} (${humanFileSize(state.uploading.fullFile.size)})`
      ];
      if (state.uploading.fullMeta) {
        lines.push(`<strong>Incremental:</strong> ${state.uploading.fullMeta.incremental}`);
        lines.push(`<strong>Channel:</strong> ${state.uploading.fullMeta.channel}`);
        lines.push(`<strong>Build type:</strong> ${state.uploading.fullMeta.buildType}`);
      }
      metaCard.innerHTML = lines.join('<br>');
      wrapper.appendChild(metaCard);

      const next = document.createElement('button');
      next.className = 'button';
      next.type = 'button';
      next.textContent = 'Next';
      next.disabled = !state.uploading.fullFile;
      next.addEventListener('click', () => {
        if (!state.uploading.fullFile) return;
        state.uploading.step = 3;
        state.uploading.confirmed = false;
        render();
      });
      wrapper.appendChild(next);
    }

    return wrapper;
  }

  function renderDeltaStep() {
    const wrapper = document.createElement('div');
    const description = document.createElement('p');
    description.className = 'muted';
    description.textContent = 'Optional: upload a delta OTA zip that connects the previous incremental to the new build.';
    wrapper.appendChild(description);

    const picker = createFilePicker({
      buttonLabel: state.uploading.deltaFile ? 'Replace delta OTA zip' : 'Choose delta OTA zip',
      accept: '.zip',
      file: state.uploading.deltaFile,
      helperText: 'Optional; format: {OS}-{VERSION}-{DATE}-{CHANNEL}-{CODENAME}-{PREV}>{CURRENT}-{TYPE}-{SIGNED}.zip',
      onSelect: async (file) => {
        state.uploading.publishDelta = false;
        const meta = parseDeltaFirmwareName(file.name);
        if (state.uploading.propMeta) {
          const expectedCodename = state.uploading.propMeta.device;
          const expectedIncremental = state.uploading.propMeta.incremental;
          if (meta.codename !== expectedCodename) {
            throw new Error(`Delta OTA filename codename ${meta.codename} does not match prop device ${expectedCodename}`);
          }
          if (meta.incremental !== expectedIncremental) {
            throw new Error(`Delta OTA target incremental ${meta.incremental} must match prop incremental ${expectedIncremental}`);
          }
        }
        if (meta.baseIncremental === meta.incremental) {
          throw new Error('Delta OTA base incremental must differ from target incremental');
        }
        state.uploading.deltaFile = file;
        state.uploading.deltaMeta = meta;
        state.uploading.publishDelta = false;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        render();
      }
    });
    wrapper.appendChild(picker);

    if (state.uploading.deltaFile) {
      const metaCard = document.createElement('div');
      metaCard.className = 'file-meta';
      const lines = [
        `<strong>File:</strong> ${state.uploading.deltaFile.name} (${humanFileSize(state.uploading.deltaFile.size)})`
      ];
      if (state.uploading.deltaMeta) {
        lines.push(`<strong>Base incremental:</strong> ${state.uploading.deltaMeta.baseIncremental}`);
        lines.push(`<strong>Target incremental:</strong> ${state.uploading.deltaMeta.incremental}`);
      }
      metaCard.innerHTML = lines.join('<br>');
      wrapper.appendChild(metaCard);
    }

    const next = document.createElement('button');
    next.className = 'button';
    next.type = 'button';
    next.textContent = 'Continue';
    next.addEventListener('click', () => {
      state.uploading.step = 4;
      state.uploading.confirmed = false;
      render();
    });
    wrapper.appendChild(next);

    return wrapper;
  }

  function renderReviewStep() {
    const wrapper = document.createElement('div');

    const summaryGrid = document.createElement('div');
    summaryGrid.className = 'grid two';

    const metaBlock = document.createElement('div');
    metaBlock.className = 'summary-block';
    const metaTitle = document.createElement('h3');
    metaTitle.textContent = 'Firmware Metadata';
    metaBlock.appendChild(metaTitle);
    const metaList = document.createElement('dl');
    metaList.className = 'summary-list';
    const meta = state.uploading.propMeta || {};
    Object.entries(meta).forEach(([key, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = key;
      const dd = document.createElement('dd');
      dd.textContent = value;
      metaList.appendChild(dt);
      metaList.appendChild(dd);
    });
    if (state.uploading.fullMeta) {
      const entries = [
        ['Channel', state.uploading.fullMeta.channel],
        ['Build type', state.uploading.fullMeta.buildType],
        ['Signed tag', state.uploading.fullMeta.signedTag]
      ];
      entries.forEach(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        metaList.appendChild(dt);
        metaList.appendChild(dd);
      });
    }
    metaBlock.appendChild(metaList);
    summaryGrid.appendChild(metaBlock);

    const packageBlock = document.createElement('div');
    packageBlock.className = 'summary-block';
    const packageTitle = document.createElement('h3');
    packageTitle.textContent = 'Packages';
    packageBlock.appendChild(packageTitle);

    const fullInfo = document.createElement('p');
    fullInfo.innerHTML = `<strong>Full OTA:</strong> ${state.uploading.fullFile ? state.uploading.fullFile.name : '—'} (${state.uploading.fullFile ? humanFileSize(state.uploading.fullFile.size) : 'n/a'})`;
    packageBlock.appendChild(fullInfo);

    const deltaInfo = document.createElement('p');
    if (state.uploading.deltaFile) {
      const base = state.uploading.deltaMeta ? state.uploading.deltaMeta.baseIncremental : 'unknown base';
      deltaInfo.innerHTML = `<strong>Delta OTA:</strong> ${state.uploading.deltaFile.name} (${humanFileSize(state.uploading.deltaFile.size)})<br><span class="muted">Base incremental: ${base}</span>`;
    } else {
      deltaInfo.innerHTML = '<strong>Delta OTA:</strong> not provided';
    }
    packageBlock.appendChild(deltaInfo);

    summaryGrid.appendChild(packageBlock);
    wrapper.appendChild(summaryGrid);

    const controlsBlock = document.createElement('div');
    controlsBlock.className = 'summary-block';

    const publishFullField = createToggleField({
      label: 'Publish full OTA immediately',
      checked: state.uploading.publishFull,
      onChange: (value) => {
        state.uploading.publishFull = value;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        render();
      }
    });
    controlsBlock.appendChild(publishFullField.element);

    const mandatoryField = createToggleField({
      label: 'Mark as mandatory update',
      checked: state.uploading.mandatory,
      onChange: (value) => {
        state.uploading.mandatory = value;
        state.uploading.confirmed = false;
        state.uploading.status = null;
        render();
      },
      description: 'Devices must install this version before receiving newer builds.'
    });
    controlsBlock.appendChild(mandatoryField.element);

    if (state.uploading.deltaFile) {
      const publishDeltaField = createToggleField({
        label: 'Publish delta OTA',
        checked: state.uploading.publishDelta,
        onChange: (value) => {
          state.uploading.publishDelta = value;
          state.uploading.confirmed = false;
          state.uploading.status = null;
          render();
        }
      });
      controlsBlock.appendChild(publishDeltaField.element);
    }

    const acknowledgement = createToggleField({
      label: 'I have reviewed the summary and understand the risks of publishing this firmware.',
      checked: state.uploading.confirmed,
      onChange: (value) => {
        state.uploading.confirmed = value;
        render();
      },
      important: true
    });
    controlsBlock.appendChild(acknowledgement.element);

    wrapper.appendChild(controlsBlock);

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const submit = document.createElement('button');
    submit.className = 'button';
    submit.type = 'button';
    const loading = state.uploading.status && state.uploading.status.loading;
    submit.textContent = loading ? 'Uploading…' : 'Submit Firmware';
    submit.disabled = loading || !state.uploading.confirmed;
    submit.addEventListener('click', submitFirmwareUpload);
    actions.appendChild(submit);
    wrapper.appendChild(actions);

    return wrapper;
  }

  function renderReports() {
    const container = document.createElement('div');
    const controlsCard = document.createElement('div');
    controlsCard.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Device Adoption';
    controlsCard.appendChild(title);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '12px';

    const codenameSelect = document.createElement('select');
    state.codenames.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.codename;
      option.textContent = item.codename;
      if (item.codename === state.report.codename) option.selected = true;
      codenameSelect.appendChild(option);
    });
    codenameSelect.setAttribute('aria-label', 'Codename');
    codenameSelect.addEventListener('change', (ev) => {
      state.report.codename = ev.target.value;
      loadReport(state.report.codename, state.report.days);
    });
    controls.appendChild(codenameSelect);

    const daysInput = document.createElement('input');
    daysInput.type = 'number';
    daysInput.min = '1';
    daysInput.max = String(MAX_REPORT_DAYS);
    daysInput.placeholder = 'Days (max 30)';
    daysInput.value = state.report.days || DEFAULT_REPORT_DAYS;
    daysInput.setAttribute('aria-label', 'Number of days');
    daysInput.addEventListener('change', (ev) => {
      let value = Number(ev.target.value);
      if (!Number.isFinite(value) || value <= 0) {
        value = DEFAULT_REPORT_DAYS;
      }
      value = Math.min(Math.max(1, Math.floor(value)), MAX_REPORT_DAYS);
      state.report.days = value;
      ev.target.value = value;
      loadReport(state.report.codename, state.report.days);
    });
    controls.appendChild(daysInput);

    controlsCard.appendChild(controls);

    if (state.report.loading) {
      const loading = document.createElement('p');
      loading.className = 'muted';
      loading.textContent = 'Loading report…';
      controlsCard.appendChild(loading);
    }

    if (state.report.data && state.report.data.summary) {
      const summary = document.createElement('div');
      summary.className = 'grid two';

      const totalCard = document.createElement('div');
      totalCard.className = 'card';
      const totalTitle = document.createElement('h3');
      totalTitle.textContent = 'Active Devices';
      const totalValue = document.createElement('p');
      totalValue.style.fontSize = '2rem';
      totalValue.style.margin = '0';
      const totalDevices = state.report.data.summary.totalDevices ?? 0;
      totalValue.textContent = totalDevices;
      totalCard.appendChild(totalTitle);
      totalCard.appendChild(totalValue);

      const versionCard = document.createElement('div');
      versionCard.className = 'card';
      const versionTitle = document.createElement('h3');
      versionTitle.textContent = 'By Version';
      versionCard.appendChild(versionTitle);
      const versionList = document.createElement('ul');
      versionList.className = 'muted';
      const versionsSummary = Array.isArray(state.report.data.summary.versions)
        ? [...state.report.data.summary.versions]
        : [];
      versionsSummary.sort((a, b) => b.count - a.count).slice(0, 4).forEach((item) => {
        const li = document.createElement('li');
        li.textContent = `${item.incremental}: ${item.count}`;
        versionList.appendChild(li);
      });
      versionCard.appendChild(versionList);

      summary.appendChild(totalCard);
      summary.appendChild(versionCard);
      controlsCard.appendChild(summary);

      const canvasWrapper = document.createElement('div');
      canvasWrapper.className = 'canvas-wrapper';
      canvasWrapper.style.height = '320px';
      const canvas = document.createElement('canvas');
      canvasWrapper.appendChild(canvas);
      controlsCard.appendChild(canvasWrapper);
      renderReportChart(canvas, state.report.data.graph || []);
    } else if (!state.report.loading) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.style.marginTop = '16px';
      empty.textContent = 'No report data available yet for the selected codename.';
      controlsCard.appendChild(empty);
    }

    container.appendChild(controlsCard);
    return container;
  }

  function renderReportChart(canvas, graphData) {
    if (reportChart) {
      reportChart.destroy();
      reportChart = null;
    }

    if (!graphData || !graphData.length || typeof window.Chart === 'undefined') {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#96a1b7';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No graph data available', canvas.width / 2, canvas.height / 2);
      return;
    }

    const labels = graphData.map((day) => day.date.slice(5));
    const totals = new Map();
    graphData.forEach((day) => {
      (day.versions || []).forEach((version) => {
        const key = version.incremental;
        if (!key) return;
        totals.set(key, (totals.get(key) || 0) + (version.count || 0));
      });
    });
    const versions = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key]) => key);
    if (!versions.length) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#96a1b7';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No version data available for the selected range', canvas.width / 2, canvas.height / 2);
      return;
    }

    const datasets = versions.map((version) => {
      const baseColor = colorForString(version);
      const data = graphData.map((day) => {
        const entry = day.versions.find((v) => v.incremental === version);
        return entry ? entry.count : 0;
      });
      return {
        label: version,
        data,
        fill: false,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        borderColor: baseColor,
        backgroundColor: withAlpha(baseColor, 0.2),
        stack: undefined,
        spanGaps: true
      };
    });

    const ctx = canvas.getContext('2d');
    reportChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 60,
              minRotation: 45
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Devices'
            }
          }
        }
      }
    });
  }

  function renderUsers() {
    if (!hasRole('admin')) {
      const denied = document.createElement('p');
      denied.className = 'muted';
      denied.textContent = 'Administrator access required.';
      return denied;
    }

    const container = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Users';
    card.appendChild(title);

    if (state.users.loading) {
      const loading = document.createElement('p');
      loading.className = 'muted';
      loading.textContent = 'Loading users…';
      card.appendChild(loading);
    }

    if (state.users.list.length) {
      const table = document.createElement('table');
      table.className = 'table';
      const head = document.createElement('thead');
      const row = document.createElement('tr');
      ['Username', 'Role', 'Must Change', 'Disabled', 'Last Login', 'Actions'].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        row.appendChild(th);
      });
      head.appendChild(row);
      table.appendChild(head);

      const body = document.createElement('tbody');
      state.users.list.forEach((user) => {
        const tr = document.createElement('tr');

        const name = document.createElement('td');
        name.textContent = user.username;
        tr.appendChild(name);

        const roleCell = document.createElement('td');
        const roleSelect = document.createElement('select');
        ['viewer', 'maintainer', 'admin'].forEach((role) => {
          const option = document.createElement('option');
          option.value = role;
          option.textContent = role;
          if (role === user.role) option.selected = true;
          roleSelect.appendChild(option);
        });
        roleSelect.setAttribute('aria-label', 'User role');
        roleSelect.addEventListener('change', (ev) => updateUser(user.username, { role: ev.target.value }));
        roleCell.appendChild(roleSelect);
        tr.appendChild(roleCell);

        const mustChange = document.createElement('td');
        const { element: mustToggleEl, input: mustToggleInput } = createToggle({
          checked: user.mustChangePassword,
          onChange: (value) => updateUser(user.username, { mustChangePassword: value }),
          ariaLabel: `Require password update for ${user.username}`
        });
        mustChange.appendChild(mustToggleEl);
        tr.appendChild(mustChange);

        const disabled = document.createElement('td');
        const { element: disabledToggleEl, input: disabledToggleInput } = createToggle({
          checked: user.disabled,
          onChange: (value) => updateUser(user.username, { disabled: value }),
          ariaLabel: `Disable account ${user.username}`
        });
        disabled.appendChild(disabledToggleEl);
        tr.appendChild(disabled);

        const lastLogin = document.createElement('td');
        lastLogin.textContent = user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—';
        tr.appendChild(lastLogin);

        const actions = document.createElement('td');
        const isDefaultAdmin = user.username === 'admin';
        if (isDefaultAdmin) {
          roleSelect.disabled = true;
          mustToggleInput.disabled = true;
          disabledToggleInput.disabled = true;
          const note = document.createElement('span');
          note.className = 'muted';
          note.textContent = 'Protected account';
          actions.appendChild(note);
        } else {
          const resetBtn = document.createElement('button');
          resetBtn.className = 'button secondary';
          resetBtn.textContent = 'Reset Password';
          resetBtn.addEventListener('click', () => {
            const newPassword = window.prompt('Enter new password for ' + user.username);
            if (newPassword && newPassword.length >= 8) {
              updateUser(user.username, { password: newPassword, mustChangePassword: true });
            } else if (newPassword) {
              setError('Password must be at least 8 characters');
            }
          });
          actions.appendChild(resetBtn);
        }
        tr.appendChild(actions);

        body.appendChild(tr);
      });

      table.appendChild(body);
      card.appendChild(table);
    }

    const formTitle = document.createElement('h3');
    formTitle.textContent = 'Create User';
    card.appendChild(formTitle);

    const form = document.createElement('form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const payload = {
        username: form.elements.username.value.trim(),
        password: form.elements.password.value,
        role: form.elements.role.value,
        mustChangePassword: form.elements.mustChange.checked
      };
      if (!payload.username || payload.password.length < 8) {
        setError('Username and 8+ character password required');
        return;
      }
      createUser(payload);
      form.reset();
    });

    const username = document.createElement('input');
    username.type = 'text';
    username.name = 'username';
    username.placeholder = 'Username';
    form.appendChild(username);

    const password = document.createElement('input');
    password.type = 'password';
    password.name = 'password';
    password.placeholder = 'Password';
    form.appendChild(password);

    const role = document.createElement('select');
    role.name = 'role';
    ['viewer', 'maintainer', 'admin'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      role.appendChild(option);
    });
    form.appendChild(role);

    const createMustChangeField = createToggleField({
      label: 'Require password update at next login',
      name: 'mustChange'
    });
    form.appendChild(createMustChangeField.element);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'button';
    submit.textContent = 'Create User';
    form.appendChild(submit);

    card.appendChild(form);
    container.appendChild(card);
    return container;
  }

  function renderProfile() {
    const container = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('h2');
    title.textContent = 'Change Password';
    card.appendChild(title);

    if (state.user.mustChangePassword) {
      const notice = document.createElement('div');
      notice.className = 'alert';
      notice.textContent = 'You must update your password before accessing the rest of the console.';
      card.appendChild(notice);
    }

    const form = document.createElement('form');
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const current = form.elements.current.value;
      const next = form.elements.next.value;
      const confirm = form.elements.confirm.value;
      if (next !== confirm) {
        setError('Passwords do not match');
        return;
      }
      changePassword(current, next);
      form.reset();
    });

    ['current', 'next', 'confirm'].forEach((name) => {
      const label = document.createElement('label');
      label.textContent = name === 'current' ? 'Current Password' : name === 'next' ? 'New Password' : 'Confirm Password';
      label.className = 'sr-only';
      const input = document.createElement('input');
      input.type = 'password';
      input.name = name;
      input.required = true;
      input.placeholder = label.textContent;
      form.appendChild(label);
      form.appendChild(input);
    });

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'button';
    submit.textContent = 'Update Password';
    form.appendChild(submit);

    card.appendChild(form);
    container.appendChild(card);
    return container;
  }

  function decodeBase64(value) {
    try {
      if (!value) return '';
      const binary = window.atob(value);
      if (window.TextDecoder) {
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder('utf-8').decode(bytes);
      }
      // Fallback for older browsers
      let result = '';
      for (let i = 0; i < binary.length; i += 1) {
        result += `%${(`00${binary.charCodeAt(i).toString(16)}`).slice(-2)}`;
      }
      return decodeURIComponent(result);
    } catch (err) {
      return '';
    }
  }

  function humanFileSize(size) {
    if (!size) return '—';
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return `${(size / (1024 ** i)).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][i]}`;
  }

  function colorForString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  function withAlpha(color, alpha) {
    if (color.startsWith('hsl')) {
      return color.replace('hsl', 'hsla').replace(')', `, ${alpha})`);
    }
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map((ch) => ch + ch).join('');
      }
      const intVal = parseInt(hex, 16);
      const r = (intVal >> 16) & 255;
      const g = (intVal >> 8) & 255;
      const b = intVal & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    return color;
  }

  loadSession();
})();
