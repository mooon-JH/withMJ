// 학원(원장님/선생님) 화면 API
const express = require('express');
const { tx } = require('../db');
const t = require('../lib/time');
const { buildReport } = require('../services/report');
const { sendReport, academyCanSend } = require('../services/dispatcher');
const { FREQUENCIES, periodEndingOn } = require('../services/periods');
const { verifyPassword, hashPassword } = require('../lib/auth');

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

module.exports = function academyRoutes(db, ctx) {
  const r = express.Router();
  const A = (req) => req.user.academy_id;

  const ownStudent = (req, id) => db.prepare('SELECT * FROM students WHERE id = ? AND academy_id = ?').get(id, A(req));

  r.get('/dashboard', (req, res) => {
    const id = A(req);
    const academy = db.prepare('SELECT * FROM academies WHERE id = ?').get(id);
    const today = t.todayKST();
    const q = (sql, ...p) => db.prepare(sql).get(...p).n;
    res.json({
      academy: {
        name: academy.name, status: academy.status, serviceEnabled: !!academy.service_enabled,
        canSend: academyCanSend(academy), trialEndsAt: academy.trial_ends_at, nextBillingDate: academy.next_billing_date,
        planPrice: academy.plan_price, sendHour: academy.send_hour, suspendReason: academy.suspend_reason,
      },
      students: q('SELECT COUNT(*) AS n FROM students WHERE academy_id = ? AND active = 1', id),
      todayCompleted: q(`SELECT COUNT(*) AS n FROM assessments a JOIN students s ON s.id = a.student_id
                         WHERE s.academy_id = ? AND a.date = ? AND a.status = 'completed'`, id, today),
      sentThisMonth: q(`SELECT COUNT(*) AS n FROM report_sends rs JOIN students s ON s.id = rs.student_id
                        WHERE s.academy_id = ? AND rs.status = 'sent' AND rs.sent_at >= ?`, id, t.firstDayOfMonth(today)),
      viewedThisMonth: q(`SELECT COUNT(*) AS n FROM report_sends rs JOIN students s ON s.id = rs.student_id
                          WHERE s.academy_id = ? AND rs.viewed_at IS NOT NULL AND rs.sent_at >= ?`, id, t.firstDayOfMonth(today)),
      pendingInvoices: db.prepare(`SELECT billing_date, amount FROM invoices WHERE academy_id = ? AND status = 'pending'`).all(id),
      today,
    });
  });

  // ---- 학생 ----
  r.get('/students', (req, res) => {
    res.json(db.prepare(`
      SELECT s.*, (SELECT MAX(date) FROM assessments a WHERE a.student_id = s.id AND a.status='completed') AS last_date
      FROM students s WHERE s.academy_id = ? AND s.active = 1 ORDER BY s.class_name, s.name`).all(A(req)));
  });

  const studentFields = (b) => {
    if (!b.name || !String(b.name).trim()) throw new Error('학생 이름을 입력해 주세요.');
    if (b.frequency && !FREQUENCIES.includes(b.frequency)) throw new Error('발송 주기가 올바르지 않습니다.');
    return [String(b.name).trim(), b.school_grade || '', b.class_name || '', b.parent_name || '', b.parent_phone || '',
      b.frequency || 'weekly', b.send_enabled === false || b.send_enabled === 0 ? 0 : 1, b.memo || ''];
  };

  r.post('/students', (req, res) => {
    const f = studentFields(req.body);
    const info = db.prepare(`INSERT INTO students (name, school_grade, class_name, parent_name, parent_phone, frequency, send_enabled, memo, academy_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...f, A(req));
    res.json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/students/:id', (req, res) => {
    if (!ownStudent(req, req.params.id)) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    const f = studentFields(req.body);
    db.prepare(`UPDATE students SET name=?, school_grade=?, class_name=?, parent_name=?, parent_phone=?, frequency=?, send_enabled=?, memo=?
                WHERE id = ?`).run(...f, req.params.id);
    res.json({ ok: true });
  });

  r.delete('/students/:id', (req, res) => {
    db.prepare('UPDATE students SET active = 0 WHERE id = ? AND academy_id = ?').run(req.params.id, A(req));
    res.json({ ok: true });
  });

  // ---- 평가 항목 ----
  r.get('/metrics', (req, res) => {
    res.json(db.prepare('SELECT * FROM metrics WHERE academy_id = ? AND active = 1 ORDER BY subject, sort, id').all(A(req)));
  });

  const metricFields = (b) => {
    if (!b.subject || !b.category || !b.name) throw new Error('과목, 영역, 항목 이름을 모두 입력해 주세요.');
    const min = num(b.min_value) ?? 0, max = num(b.max_value) ?? 100;
    if (max <= min) throw new Error('최대값은 최소값보다 커야 합니다.');
    return [b.subject.trim(), b.category.trim(), b.name.trim(), b.unit || '점', min, max, num(b.std_low), num(b.std_high),
      b.higher_is_better === false || b.higher_is_better === 0 ? 0 : 1, num(b.sort) ?? 0];
  };

  r.post('/metrics', (req, res) => {
    const info = db.prepare(`INSERT INTO metrics (subject, category, name, unit, min_value, max_value, std_low, std_high, higher_is_better, sort, academy_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...metricFields(req.body), A(req));
    res.json({ id: Number(info.lastInsertRowid) });
  });

  r.put('/metrics/:id', (req, res) => {
    const info = db.prepare(`UPDATE metrics SET subject=?, category=?, name=?, unit=?, min_value=?, max_value=?, std_low=?, std_high=?, higher_is_better=?, sort=?
                             WHERE id = ? AND academy_id = ?`).run(...metricFields(req.body), req.params.id, A(req));
    if (!info.changes) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json({ ok: true });
  });

  r.delete('/metrics/:id', (req, res) => {
    db.prepare('UPDATE metrics SET active = 0 WHERE id = ? AND academy_id = ?').run(req.params.id, A(req));
    res.json({ ok: true });
  });

  // ---- 성적 입력 (반 단위 표) ----
  r.get('/grid', (req, res) => {
    const date = req.query.date || t.todayKST();
    const cls = req.query.class || '';
    const students = db.prepare(`SELECT id, name, class_name FROM students WHERE academy_id = ? AND active = 1
                                 AND (? = '' OR class_name = ?) ORDER BY class_name, name`).all(A(req), cls, cls);
    const subject = req.query.subject || '';
    const metrics = db.prepare(`SELECT * FROM metrics WHERE academy_id = ? AND active = 1 AND (? = '' OR subject = ?)
                                ORDER BY subject, sort, id`).all(A(req), subject, subject);
    const subjects = db.prepare('SELECT DISTINCT subject FROM metrics WHERE academy_id = ? AND active = 1 ORDER BY 1')
      .all(A(req)).map((x) => x.subject);
    const rows = students.map((s) => {
      const a = db.prepare('SELECT * FROM assessments WHERE student_id = ? AND date = ?').get(s.id, date);
      const values = {};
      if (a) for (const sc of db.prepare('SELECT metric_id, value FROM scores WHERE assessment_id = ?').all(a.id)) values[sc.metric_id] = sc.value;
      return { student: s, status: a?.status || null, comment: a?.comment || '', values };
    });
    const classes = db.prepare(`SELECT DISTINCT class_name FROM students WHERE academy_id = ? AND active = 1 AND class_name != '' ORDER BY 1`)
      .all(A(req)).map((x) => x.class_name);
    res.json({ date, subject, metrics, rows, classes, subjects });
  });

  // body: { date, complete: bool, metricIds: [표에 보인 항목], rows: [{ studentId, comment, values: {metricId: value} }] }
  // 값이 하나도 없는 학생은 건너뛴다 (결석 등)
  r.post('/grid', (req, res) => {
    const { date, complete, rows = [], metricIds = [] } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: '날짜가 올바르지 않습니다.' });
    const metrics = new Map(db.prepare('SELECT * FROM metrics WHERE academy_id = ? AND active = 1').all(A(req)).map((m) => [m.id, m]));
    const shown = metricIds.map(Number).filter((id) => metrics.has(id));
    let saved = 0;
    tx(db, () => {
      for (const row of rows) {
        if (!ownStudent(req, row.studentId)) continue;
        const entries = Object.entries(row.values || {})
          .map(([k, v]) => [Number(k), num(v)])
          .filter(([k, v]) => metrics.has(k) && v != null);
        for (const [k, v] of entries) {
          const m = metrics.get(k);
          if (v < m.min_value || v > m.max_value) throw new Error(`${m.name} 값은 ${m.min_value}~${m.max_value} 사이여야 합니다.`);
        }
        if (!entries.length && !row.comment) continue;
        db.prepare(`INSERT INTO assessments (student_id, date, comment, status, completed_at) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(student_id, date) DO UPDATE SET comment = excluded.comment,
                      status = CASE WHEN excluded.status = 'completed' THEN 'completed' ELSE assessments.status END,
                      completed_at = COALESCE(assessments.completed_at, excluded.completed_at)`)
          .run(row.studentId, date, row.comment || '', complete ? 'completed' : 'draft', complete ? new Date().toISOString() : null);
        const a = db.prepare('SELECT id FROM assessments WHERE student_id = ? AND date = ?').get(row.studentId, date);
        // 표에 보이는 항목(=선택한 과목)의 점수만 갈아끼운다. 다른 과목 점수는 그대로 둔다.
        const del = db.prepare('DELETE FROM scores WHERE assessment_id = ? AND metric_id = ?');
        for (const id of shown) del.run(a.id, id);
        const ins = db.prepare('INSERT INTO scores (assessment_id, metric_id, value) VALUES (?, ?, ?)');
        for (const [k, v] of entries) ins.run(a.id, k, v);
        saved++;
      }
    });
    res.json({ saved });
  });

  // ---- 리포트 미리보기 / 인쇄 ----
  const range = (q) => {
    const type = FREQUENCIES.includes(q.type) ? q.type : 'manual';
    if (type !== 'manual') return { type, ...periodEndingOn(type, lastEndOnOrAfter(type, q.end || t.todayKST(), q.weeklyEndDow)) };
    const end = q.end || t.todayKST();
    return { type, start: q.start || t.addDays(end, -29), end };
  };
  const lastEndOnOrAfter = (type, day, wd = 6) => {
    // 선택한 날짜가 포함된 기간의 마지막 날
    const { isPeriodEnd } = require('../services/periods');
    let d = day;
    for (let i = 0; i < 100 && !isPeriodEnd(type, d, Number(wd)); i++) d = t.addDays(d, 1);
    return d;
  };

  r.get('/report/:studentId', (req, res) => {
    if (!ownStudent(req, req.params.studentId)) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    const academy = db.prepare('SELECT weekly_end_dow FROM academies WHERE id = ?').get(A(req));
    const p = range({ ...req.query, weeklyEndDow: academy.weekly_end_dow });
    res.json(buildReport(db, Number(req.params.studentId), p.start, p.end, p.type));
  });

  // 일괄 인쇄용: ?class=중2A&type=monthly&end=2026-10-31  또는 ?ids=1,2,3
  r.get('/reports', (req, res) => {
    const academy = db.prepare('SELECT weekly_end_dow FROM academies WHERE id = ?').get(A(req));
    const p = range({ ...req.query, weeklyEndDow: academy.weekly_end_dow });
    let students;
    if (req.query.ids) {
      const ids = String(req.query.ids).split(',').map(Number).filter(Boolean);
      students = ids.map((id) => ownStudent(req, id)).filter(Boolean);
    } else {
      const cls = req.query.class || '';
      students = db.prepare(`SELECT * FROM students WHERE academy_id = ? AND active = 1 AND (? = '' OR class_name = ?)
                             ORDER BY class_name, name`).all(A(req), cls, cls);
    }
    const reports = students.map((s) => buildReport(db, s.id, p.start, p.end, p.type))
      .filter((rep) => req.query.includeEmpty === '1' || rep.sessionCount > 0);
    res.json({ reports });
  });

  // 지금 바로 발송 (수시)
  r.post('/send/:studentId', async (req, res) => {
    const s = ownStudent(req, req.params.studentId);
    if (!s) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    if (!s.parent_phone) return res.status(400).json({ error: '학부모 연락처가 없습니다.' });
    const academy = db.prepare('SELECT * FROM academies WHERE id = ?').get(A(req));
    if (!academyCanSend(academy)) return res.status(403).json({ error: '서비스가 정지된 상태라 발송할 수 없습니다.' });
    const p = range({ ...req.body, weeklyEndDow: academy.weekly_end_dow });
    // 수시 발송은 같은 날 여러 번 보낼 수 있도록 시작일에 시각을 붙여 중복키를 피한다
    const startKey = p.type === 'manual' ? `${p.start}#${Date.now()}` : p.start;
    const out = await sendReport(db, ctx.kakao, { student: s, academy, type: p.type, start: p.start, end: p.end, baseUrl: ctx.baseUrl, startKey });
    if (out.skipped) return res.status(409).json({ error: '이미 이 기간 리포트를 발송했습니다.' });
    res.json(out);
  });

  r.get('/sends', (req, res) => {
    res.json(db.prepare(`
      SELECT rs.id, rs.period_type, rs.period_start, rs.period_end, rs.status, rs.error, rs.sent_at, rs.viewed_at,
             rs.created_at, rs.token, rs.to_phone, s.name AS student_name
      FROM report_sends rs JOIN students s ON s.id = rs.student_id
      WHERE s.academy_id = ? ORDER BY rs.id DESC LIMIT 200`).all(A(req)));
  });

  r.get('/settings', (req, res) => {
    res.json(db.prepare('SELECT name, owner_name, phone, send_hour, weekly_end_dow FROM academies WHERE id = ?').get(A(req)));
  });

  r.put('/settings', (req, res) => {
    const b = req.body || {};
    const hour = Math.min(23, Math.max(0, Number(b.send_hour) || 21));
    const dow = Math.min(6, Math.max(0, Number(b.weekly_end_dow ?? 6)));
    db.prepare('UPDATE academies SET name = ?, owner_name = ?, phone = ?, send_hour = ?, weekly_end_dow = ? WHERE id = ?')
      .run(b.name, b.owner_name || '', b.phone || '', hour, dow, A(req));
    res.json({ ok: true });
  });

  r.put('/password', (req, res) => {
    const { current, next } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(current || ''), u.password_hash)) return res.status(400).json({ error: '현재 비밀번호가 틀립니다.' });
    if (String(next || '').length < 8) return res.status(400).json({ error: '새 비밀번호는 8자 이상이어야 합니다.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
    res.json({ ok: true });
  });

  return r;
};
