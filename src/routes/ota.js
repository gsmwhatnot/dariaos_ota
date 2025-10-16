const express = require('express');
const { handleOtaRequest } = require('../server/otaController');

const router = express.Router();

router.get('/:codename/:channel/:currentVersion{/:serial}', async (req, res, next) => {
  try {
    const { codename, channel, currentVersion, serial } = req.params;
    await handleOtaRequest(req, res, { codename, channel, currentVersion, serial });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
