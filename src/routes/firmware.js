const express = require('express');
const { handleFirmwareUpload } = require('../server/uploadController');

const router = express.Router();

router.post('/upload', handleFirmwareUpload);

module.exports = router;
