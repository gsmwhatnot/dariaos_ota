const express = require('express');
const { handleOtaRequest } = require('../server/otaController');

const router = express.Router();

router.get('/:codename/:channel/:currentVersion{/:serial}', async (req, res, next) => {
  try {
    const { codename, channel, currentVersion, serial } = req.params;
    const versionPattern = /^V\d{1,4}\.\d{1,4}\.\d{1,4}\.\d{1,4}\.[A-Za-z0-9]{1,10}$/;
    if (!versionPattern.test(currentVersion)) {
      res.json({ id: null, response: [] });
      return;
    }
    await handleOtaRequest(req, res, { codename, channel, currentVersion, serial });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
