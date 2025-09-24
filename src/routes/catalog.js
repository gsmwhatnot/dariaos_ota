const express = require('express');
const {
  handleListCodenames,
  handleListBuilds,
  handleUpdateBuild
} = require('../server/buildsController');

const router = express.Router();

router.get('/codenames', handleListCodenames);
router.get('/:codename/:channel', (req, res) => {
  const { codename, channel } = req.params;
  handleListBuilds(req, res, { codename, channel });
});
router.patch('/:codename/:channel/:buildId', (req, res) => {
  const { codename, channel, buildId } = req.params;
  handleUpdateBuild(req, res, { codename, channel, buildId });
});

module.exports = router;
