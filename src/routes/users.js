const express = require('express');
const {
  handleListUsers,
  handleCreateUser,
  handleUpdateUser
} = require('../server/usersController');

const router = express.Router();

router.get('/', handleListUsers);
router.post('/', handleCreateUser);
router.patch('/:username', (req, res) => {
  handleUpdateUser(req, res, { username: req.params.username });
});

module.exports = router;
