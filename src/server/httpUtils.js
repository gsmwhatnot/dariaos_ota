function sendJson(res, statusCode, payload, headers = {}) {
  if (!res.headersSent) {
    Object.entries(headers).forEach(([key, value]) => {
      res.setHeader(key, value);
    });
  }
  res.status(statusCode).json(payload);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not Found' });
}

module.exports = { sendJson, notFound };
