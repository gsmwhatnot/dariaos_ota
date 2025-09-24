const express = require('express');
const { handlePropPreview } = require('../server/uploadController');

const router = express.Router();

router.post('/parse-prop', handlePropPreview);

module.exports = router;
