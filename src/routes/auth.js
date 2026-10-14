const express = require('express');
const { verifyPassword, createSession } = require('../lib/auth');

module.exports = function authRoutes(db) {
  const r = express.Router();

  r.post('/login', (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const { token, maxAge } = createSession(db, user.id);
    res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: maxAge * 1000, secure: req.secure });
    res.json({ role: user.role, redirect: user.role === 'superadmin' ? '/admin' : '/academy' });
  });

  r.post('/logout', (req, res) => {
    if (req.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sid);
    res.clearCookie('sid');
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const academy = req.user.academy_id
      ? db.prepare('SELECT id, name, status, service_enabled, trial_ends_at FROM academies WHERE id = ?').get(req.user.academy_id)
      : null;
    res.json({ user: { email: req.user.email, name: req.user.name, role: req.user.role }, academy });
  });

  return r;
};
