const express = require('express');
const { handleReport } = require('../server/reportsController');

const router = express.Router();

router.get('/:codename', (req, res) => {
  handleReport(req, res, { codename: req.params.codename });
});

module.exports = router;
