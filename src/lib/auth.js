const crypto = require('node:crypto');

const SESSION_DAYS = 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

function sessionMiddleware(db) {
  return (req, _res, next) => {
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) {
      const row = db.prepare(`
        SELECT u.id, u.email, u.name, u.role, u.academy_id, s.expires_at
        FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(sid);
      if (row && row.expires_at > Date.now()) {
        req.user = row;
        req.sid = sid;
      }
    }
    next();
  };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    if (req.user.role !== role) return res.status(403).json({ error: '권한이 없습니다.' });
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, randomToken, createSession, sessionMiddleware, requireRole,
};
