const express = require('express');
const { handleReport } = require('../server/reportsController');

const router = express.Router();

router.get('/:codename', async (req, res, next) => {
  try {
    await handleReport(req, res, { codename: req.params.codename });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
