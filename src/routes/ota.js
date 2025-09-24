const express = require('express');
const { handleOtaRequest } = require('../server/otaController');

const router = express.Router();

router.get('/:codename/:channel/:currentVersion/:serial', (req, res) => {
  const { codename, channel, currentVersion, serial } = req.params;
  handleOtaRequest(req, res, { codename, channel, currentVersion, serial });
});

module.exports = router;
