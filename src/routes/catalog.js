const express = require('express');
const {
  handleListCodenames,
  handleListBuilds,
  handleUpdateBuild
} = require('../server/buildsController');

const router = express.Router();

router.get('/codenames', handleListCodenames);
router.get('/:codename/:channel', async (req, res, next) => {
  try {
    const { codename, channel } = req.params;
    await handleListBuilds(req, res, { codename, channel });
  } catch (err) {
    next(err);
  }
});
router.patch('/:codename/:channel/:buildId', async (req, res, next) => {
  try {
    const { codename, channel, buildId } = req.params;
    await handleUpdateBuild(req, res, { codename, channel, buildId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
