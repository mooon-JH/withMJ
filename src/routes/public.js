// 학부모용 공개 리포트 (카톡 링크로 들어옴, 로그인 없음 — 추측 불가능한 토큰으로 보호)
const express = require('express');
const { buildReport } = require('../services/report');

module.exports = function publicRoutes(db) {
  const r = express.Router();
  r.get('/r/:token', (req, res) => {
    const send = db.prepare('SELECT * FROM report_sends WHERE token = ?').get(req.params.token);
    if (!send) return res.status(404).json({ error: '리포트를 찾을 수 없습니다. 링크를 다시 확인해 주세요.' });
    if (!send.viewed_at) db.prepare(`UPDATE report_sends SET viewed_at = datetime('now') WHERE id = ?`).run(send.id);
    res.json(buildReport(db, send.student_id, send.period_start, send.period_end, send.period_type));
  });
  return r;
};
