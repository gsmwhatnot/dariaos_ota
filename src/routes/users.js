const express = require('express');
const {
  handleListUsers,
  handleCreateUser,
  handleUpdateUser
} = require('../server/usersController');

const router = express.Router();

router.get('/', handleListUsers);
router.post('/', handleCreateUser);
router.patch('/:username', async (req, res, next) => {
  try {
    await handleUpdateUser(req, res, { username: req.params.username });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
