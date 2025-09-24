const express = require('express');
const {
  handleCaptcha,
  handleSession,
  handleLogin,
  handleLogout,
  handleChangePassword
} = require('../server/authController');

const router = express.Router();

router.get('/captcha', handleCaptcha);
router.get('/session', handleSession);
router.post('/login', handleLogin);
router.post('/logout', handleLogout);
router.post('/change-password', handleChangePassword);

module.exports = router;
