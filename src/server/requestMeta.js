function extractRequestMeta(req) {
  return {
    ip: (req.socket && req.socket.remoteAddress) || '',
    xForwardedFor: req.headers['x-forwarded-for'] || '',
    userAgent: req.headers['user-agent'] || ''
  };
}

module.exports = { extractRequestMeta };
