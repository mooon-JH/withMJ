// 운영자(우리) 화면 API: 학원 관리 · 서비스 온오프 · 정산 · 영업 리스트
const express = require('express');
const t = require('../lib/time');
const { tx } = require('../db');
const { hashPassword } = require('../lib/auth');
const billing = require('../services/billing');
const leads = require('../services/leads');
const { seedDefaultMetrics } = require('../services/defaults');

module.exports = function adminRoutes(db, ctx) {
  const r = express.Router();

  r.get('/stats', (_req, res) => {
    const today = t.todayKST();
    const month = t.firstDayOfMonth(today);
    const g = (sql, ...p) => db.prepare(sql).get(...p);
    const active = g(`SELECT COUNT(*) AS n, COALESCE(SUM(plan_price),0) AS mrr FROM academies
                      WHERE status = 'active' AND service_enabled = 1 AND (trial_ends_at IS NULL OR trial_ends_at < ?)`, today);
    const sent = g(`SELECT COUNT(*) AS n FROM report_sends WHERE status = 'sent' AND sent_at >= ?`, month).n;
    res.json({
      today,
      payingAcademies: active.n,
      mrr: active.mrr,
      trialAcademies: g(`SELECT COUNT(*) AS n FROM academies WHERE status = 'active' AND trial_ends_at >= ?`, today).n,
      suspended: g(`SELECT COUNT(*) AS n FROM academies WHERE status = 'suspended' OR service_enabled = 0`).n,
      collectedThisMonth: g(`SELECT COALESCE(SUM(amount),0) AS n FROM invoices WHERE status = 'paid' AND paid_at >= ?`, month).n,
      unpaid: g(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM invoices WHERE status = 'pending'`),
      messagesThisMonth: sent,
      // 알림톡 단가(딜러사·물량마다 다름)를 대략 9원으로 잡은 추정 원가
      messageCostEstimate: sent * 9,
      leads: db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all(),
    });
  });

  // ---- 학원 ----
  r.get('/academies', (_req, res) => {
    res.json(db.prepare(`
      SELECT a.*, u.email AS login_email,
        (SELECT COUNT(*) FROM students s WHERE s.academy_id = a.id AND s.active = 1) AS student_count,
        (SELECT COUNT(*) FROM invoices i WHERE i.academy_id = a.id AND i.status = 'pending') AS pending_invoices,
        (SELECT MAX(rs.sent_at) FROM report_sends rs JOIN students s ON s.id = rs.student_id WHERE s.academy_id = a.id) AS last_sent_at
      FROM academies a LEFT JOIN users u ON u.academy_id = a.id AND u.role = 'academy'
      GROUP BY a.id ORDER BY a.id DESC`).all().map(({ billing_key, ...a }) => ({ ...a, has_billing_key: !!billing_key })));
  });

  // 계약 → 학원 계정 생성 (영업 리드에서 바로 전환 가능)
  r.post('/academies', (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.email || !b.password) return res.status(400).json({ error: '학원명, 로그인 이메일, 초기 비밀번호는 필수입니다.' });
    const email = String(b.email).trim().toLowerCase();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: '이미 사용 중인 이메일입니다.' });
    const dates = b.skipTrial
      ? { trial_ends_at: null, next_billing_date: t.todayKST() }
      : billing.newAcademyBillingDates();
    const id = tx(db, () => {
      const info = db.prepare(`INSERT INTO academies (name, owner_name, phone, region, plan_price, trial_ends_at, next_billing_date, lead_id)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(b.name, b.owner_name || '', b.phone || '', b.region || '', Number(b.plan_price) || 30000,
          dates.trial_ends_at, dates.next_billing_date, b.lead_id || null);
      const academyId = Number(info.lastInsertRowid);
      db.prepare(`INSERT INTO users (academy_id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'academy')`)
        .run(academyId, email, hashPassword(String(b.password)), b.owner_name || b.name);
      seedDefaultMetrics(db, academyId);
      if (b.lead_id) db.prepare(`UPDATE leads SET status = 'won', updated_at = datetime('now') WHERE id = ?`).run(b.lead_id);
      return academyId;
    });
    res.json({ id });
  });

  r.put('/academies/:id', (req, res) => {
    const b = req.body || {};
    const a = db.prepare('SELECT * FROM academies WHERE id = ?').get(req.params.id);
    if (!a) return res.status(404).json({ error: '학원을 찾을 수 없습니다.' });
    db.prepare(`UPDATE academies SET name = ?, owner_name = ?, phone = ?, region = ?, plan_price = ?, next_billing_date = ?, billing_key = ?
                WHERE id = ?`).run(
      b.name ?? a.name, b.owner_name ?? a.owner_name, b.phone ?? a.phone, b.region ?? a.region,
      Number(b.plan_price ?? a.plan_price), b.next_billing_date ?? a.next_billing_date,
      b.billing_key === undefined ? a.billing_key : b.billing_key || null, a.id);
    res.json({ ok: true });
  });

  // 서비스 온/오프 스위치
  r.post('/academies/:id/toggle', (req, res) => {
    const on = req.body?.enabled ? 1 : 0;
    db.prepare('UPDATE academies SET service_enabled = ? WHERE id = ?').run(on, req.params.id);
    res.json({ ok: true, enabled: !!on });
  });

  // 상태 변경: active(재개) / cancelled(해지)
  r.post('/academies/:id/status', (req, res) => {
    const status = req.body?.status;
    if (!['active', 'suspended', 'cancelled'].includes(status)) return res.status(400).json({ error: '잘못된 상태' });
    db.prepare('UPDATE academies SET status = ?, suspend_reason = ? WHERE id = ?')
      .run(status, status === 'active' ? null : req.body.reason || (status === 'cancelled' ? '해지' : '운영자 정지'), req.params.id);
    res.json({ ok: true });
  });

  r.post('/academies/:id/reset-password', (req, res) => {
    const pw = String(req.body?.password || '');
    if (pw.length < 8) return res.status(400).json({ error: '8자 이상' });
    db.prepare(`UPDATE users SET password_hash = ? WHERE academy_id = ? AND role = 'academy'`).run(hashPassword(pw), req.params.id);
    res.json({ ok: true });
  });

  // ---- 정산 ----
  r.get('/invoices', (req, res) => {
    const status = req.query.status || '';
    res.json(db.prepare(`SELECT i.*, a.name AS academy_name, a.phone AS academy_phone FROM invoices i JOIN academies a ON a.id = i.academy_id
                         WHERE (? = '' OR i.status = ?) ORDER BY i.billing_date DESC, i.id DESC LIMIT 300`).all(status, status));
  });

  r.post('/invoices/:id/paid', (req, res) => {
    billing.markPaid(db, Number(req.params.id), { method: req.body?.method || 'transfer' });
    res.json({ ok: true });
  });

  r.post('/invoices/:id/void', (req, res) => {
    db.prepare(`UPDATE invoices SET status = 'void' WHERE id = ? AND status = 'pending'`).run(req.params.id);
    res.json({ ok: true });
  });

  r.post('/billing/run', async (_req, res) => {
    res.json({ created: await billing.runBilling(db, ctx.payments) });
  });

  r.post('/dispatch/run', async (_req, res) => {
    res.json(await ctx.runDispatchNow());
  });

  r.get('/sends', (_req, res) => {
    res.json(db.prepare(`SELECT rs.id, rs.period_type, rs.period_start, rs.period_end, rs.status, rs.error, rs.sent_at, rs.viewed_at, rs.provider,
                                s.name AS student_name, a.name AS academy_name
                         FROM report_sends rs JOIN students s ON s.id = rs.student_id JOIN academies a ON a.id = s.academy_id
                         ORDER BY rs.id DESC LIMIT 200`).all());
  });

  // ---- 영업 리드 ----
  r.get('/leads', (req, res) => {
    const { status = '', q = '', region = '', noWebsite = '' } = req.query;
    res.json({
      statuses: leads.LEAD_STATUSES,
      rows: db.prepare(`SELECT * FROM leads WHERE (? = '' OR status = ?) AND (? = '' OR region = ?)
                        AND (? = '' OR name LIKE '%' || ? || '%' OR address LIKE '%' || ? || '%')
                        AND (? = '' OR link = '' OR link IS NULL)
                        ORDER BY CASE WHEN next_action_date IS NULL THEN 1 ELSE 0 END, next_action_date, id DESC LIMIT 1000`)
        .all(status, status, region, region, q, q, q, noWebsite),
      regions: db.prepare(`SELECT DISTINCT region FROM leads WHERE region != '' ORDER BY 1`).all().map((x) => x.region),
    });
  });

  r.post('/leads', (req, res) => {
    const added = leads.saveLeads(db, [{ ...req.body, source: 'manual' }]);
    res.json({ added });
  });

  r.put('/leads/:id', (req, res) => {
    const b = req.body || {};
    const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: '없음' });
    if (b.status && !leads.LEAD_STATUSES[b.status]) return res.status(400).json({ error: '잘못된 상태' });
    db.prepare(`UPDATE leads SET name=?, phone=?, address=?, region=?, status=?, next_action_date=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .run(b.name ?? l.name, b.phone ?? l.phone, b.address ?? l.address, b.region ?? l.region, b.status ?? l.status,
        b.next_action_date === undefined ? l.next_action_date : b.next_action_date || null, b.notes ?? l.notes, l.id);
    res.json({ ok: true });
  });

  // 통화 기록 한 줄 추가 (메모 맨 위에 날짜와 함께 쌓임)
  r.post('/leads/:id/call', (req, res) => {
    const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!l) return res.status(404).json({ error: '없음' });
    const b = req.body || {};
    const line = `[${t.todayKST()}] ${b.note || '통화'}`;
    db.prepare(`UPDATE leads SET notes = ?, call_count = call_count + 1, status = ?, next_action_date = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(l.notes ? `${line}\n${l.notes}` : line, b.status || (l.status === 'new' ? 'called' : l.status), b.next_action_date || null, l.id);
    res.json({ ok: true });
  });

  r.delete('/leads/:id', (req, res) => {
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  r.post('/leads/import', express.text({ type: '*/*', limit: '5mb' }), (req, res) => {
    const rows = leads.parseCsv(typeof req.body === 'string' ? req.body : '');
    const region = req.query.region || '';
    res.json({ added: leads.saveLeads(db, rows.map((x) => ({ ...x, region: x.region || region, source: 'csv' }))), total: rows.length });
  });

  r.post('/leads/naver', async (req, res) => {
    const { region, dongs = '', keywords = '' } = req.body || {};
    if (!region) return res.status(400).json({ error: '지역(시/군)을 입력해 주세요.' });
    try {
      const found = await leads.collectLeads({
        region,
        dongs: String(dongs).split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
        keywords: keywords ? String(keywords).split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : undefined,
      });
      res.json({ found: found.length, added: leads.saveLeads(db, found), noWebsite: found.filter((x) => !x.link).length });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.get('/leads.csv', (_req, res) => {
    const rows = db.prepare('SELECT * FROM leads ORDER BY region, name').all()
      .map((x) => ({ ...x, status: leads.LEAD_STATUSES[x.status] }));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
    res.send('﻿' + leads.toCsv(rows, ['name', 'phone', 'address', 'region', 'category', 'link', 'status', 'call_count', 'next_action_date', 'notes']));
  });

  return r;
};
