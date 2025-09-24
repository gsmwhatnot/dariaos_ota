const express = require('express');
const { requireAuth } = require('../server/authMiddleware');
const { sendJson } = require('../server/httpUtils');
const { getSystemMetrics } = require('../server/systemMetrics');

const router = express.Router();

router.get('/metrics', async (req, res) => {
  const auth = await requireAuth(req, res, 'viewer');
  if (!auth) return;
  const metrics = await getSystemMetrics();
  sendJson(res, 200, metrics);
});

module.exports = router;
