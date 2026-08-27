const config = require('./config');
const { team } = require('./team');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (typeof req.query?.token === 'string') {
    return req.query.token;
  }
  return null;
}

function resolveMember(token) {
  return team.resolveByToken(token);
}

function authMiddleware(req, res, next) {
  const token = extractToken(req);
  const member = resolveMember(token);
  if (!member) {
    return res.status(401).json({
      error: 'Não autorizado. Envie Authorization: Bearer <token do admin ou membro da equipe>.'
    });
  }
  req.member = member;
  req.authToken = token;
  return next();
}

function authenticateWs(info) {
  try {
    const url = new URL(info.req.url, 'http://localhost');
    const queryToken = url.searchParams.get('token');
    const proto = info.req.headers['sec-websocket-protocol'];
    const headerAuth = info.req.headers.authorization;
    let token = queryToken;
    if (!token && headerAuth?.startsWith('Bearer ')) {
      token = headerAuth.slice(7).trim();
    }
    if (!token && proto) {
      const parts = String(proto).split(',').map((p) => p.trim());
      token = parts[0] === 'bearer' ? parts[1] : parts[0];
    }
    return Boolean(resolveMember(token));
  } catch {
    return false;
  }
}

module.exports = {
  authMiddleware,
  authenticateWs,
  extractToken,
  resolveMember
};
