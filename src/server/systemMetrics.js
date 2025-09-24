const os = require('os');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config');
const { getDownloadStats } = require('../stores/downloadStats');

let previousCpu = null;
let previousNet = null;
let previousNetTime = 0;

function calculateCpuUsage() {
  const cpus = os.cpus();
  const aggregate = cpus.reduce((acc, cpu) => {
    const times = cpu.times;
    acc.idle += times.idle;
    acc.total += times.user + times.nice + times.sys + times.irq + times.idle;
    return acc;
  }, { idle: 0, total: 0 });

  if (!previousCpu) {
    previousCpu = aggregate;
    return 0;
  }

  const idleDiff = aggregate.idle - previousCpu.idle;
  const totalDiff = aggregate.total - previousCpu.total;
  previousCpu = aggregate;
  if (totalDiff <= 0) return 0;
  const usage = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(usage, 100));
}

async function getDiskUsage() {
  try {
    const stats = await fs.statfs(config.paths.uploads);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;
    return {
      total,
      free,
      used,
      usedPercent: total ? (used / total) * 100 : 0
    };
  } catch (err) {
    return {
      total: 0,
      free: 0,
      used: 0,
      usedPercent: 0
    };
  }
}

async function getNetworkStats() {
  let data;
  try {
    data = await fs.readFile('/proc/net/dev', 'utf8');
  } catch (err) {
    return { rxRate: 0, txRate: 0 };
  }
  const lines = data.trim().split('\n').slice(2);
  let rx = 0;
  let tx = 0;
  lines.forEach((line) => {
    const parts = line.replace(/\s+/g, ' ').trim().split(' ');
    const iface = parts[0].replace(':', '');
    if (!iface || iface === 'lo') return;
    const rxBytes = Number(parts[1]);
    const txBytes = Number(parts[9]);
    if (Number.isFinite(rxBytes)) rx += rxBytes;
    if (Number.isFinite(txBytes)) tx += txBytes;
  });
  const now = Date.now();
  if (!previousNet) {
    previousNet = { rx, tx };
    previousNetTime = now;
    return { rxRate: 0, txRate: 0 };
  }
  const intervalSec = (now - previousNetTime) / 1000;
  if (intervalSec <= 0) {
    previousNet = { rx, tx };
    previousNetTime = now;
    return { rxRate: 0, txRate: 0 };
  }
  const rxRate = Math.max(0, (rx - previousNet.rx) / intervalSec);
  const txRate = Math.max(0, (tx - previousNet.tx) / intervalSec);
  previousNet = { rx, tx };
  previousNetTime = now;
  return { rxRate, txRate };
}

async function getSystemMetrics() {
  const cpuPercent = calculateCpuUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memory = {
    total: totalMem,
    free: freeMem,
    used: usedMem,
    usedPercent: totalMem ? (usedMem / totalMem) * 100 : 0
  };
  const disk = await getDiskUsage();
  const network = await getNetworkStats();
  let downloads;
  try {
    downloads = await getDownloadStats(7);
  } catch (err) {
    downloads = { totals: {}, daily: [] };
  }
  return {
    cpu: {
      percent: cpuPercent
    },
    memory,
    disk,
    network,
    downloads
  };
}

module.exports = { getSystemMetrics };
