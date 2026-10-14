// 월 구독(3만원) 정산
// 1) 결제일이 된 학원에 청구서 발행 → 빌링키가 있으면 카드 자동결제 시도
// 2) 미납 상태로 유예기간(GRACE_DAYS)이 지나면 서비스 자동 정지
// 3) 입금 확인(수동) 또는 결제 성공 시 다시 활성화
const crypto = require('node:crypto');
const t = require('../lib/time');

const GRACE_DAYS = 7;
const TRIAL_DAYS = 14;

class MockPayments {
  constructor() { this.name = 'mock'; }
  async charge({ billingKey }) {
    if (!billingKey) return { ok: false, error: 'no billing key' };
    if (billingKey.startsWith('fail')) return { ok: false, error: '카드 한도 초과(mock)' };
    return { ok: true, paymentKey: 'mockpay-' + crypto.randomBytes(6).toString('hex') };
  }
}

// 토스페이먼츠 자동결제(빌링) 승인 API
// 빌링키는 학원 원장님이 결제창에서 카드를 등록하면 발급된다 (/v1/billing/authorizations/issue).
class TossPayments {
  constructor(env = process.env) { this.name = 'toss'; this.secret = env.TOSS_SECRET_KEY; }
  async charge({ billingKey, customerKey, amount, orderId, orderName }) {
    const res = await fetch(`https://api.tosspayments.com/v1/billing/${encodeURIComponent(billingKey)}`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(this.secret + ':').toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ customerKey, amount, orderId, orderName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.message || `HTTP ${res.status}` };
    return { ok: true, paymentKey: data.paymentKey };
  }
}

function createPayments(env = process.env) {
  return env.PAYMENT_PROVIDER === 'toss' ? new TossPayments(env) : new MockPayments();
}

async function runBilling(db, payments, today = t.todayKST()) {
  const log = [];
  const due = db.prepare(`SELECT * FROM academies WHERE status != 'cancelled'
                          AND next_billing_date IS NOT NULL AND next_billing_date <= ?`).all(today);
  for (const a of due) {
    const ins = db.prepare(`INSERT OR IGNORE INTO invoices (academy_id, billing_date, amount) VALUES (?, ?, ?)`)
      .run(a.id, a.next_billing_date, a.plan_price);
    db.prepare('UPDATE academies SET next_billing_date = ? WHERE id = ?').run(t.addMonths(a.next_billing_date, 1), a.id);
    if (ins.changes === 0) continue;
    const invoiceId = Number(ins.lastInsertRowid);
    log.push({ academy: a.name, invoiceId, amount: a.plan_price });
    if (a.billing_key) {
      const r = await payments.charge({
        billingKey: a.billing_key,
        customerKey: `academy-${a.id}`,
        amount: a.plan_price,
        orderId: `inv-${invoiceId}-${Date.now()}`,
        orderName: `성취리포트 월 구독 (${a.next_billing_date.slice(0, 7)})`,
      });
      if (r.ok) markPaid(db, invoiceId, { method: 'card', paymentKey: r.paymentKey, today });
      else db.prepare(`UPDATE invoices SET error = ? WHERE id = ?`).run(r.error, invoiceId);
    }
  }
  suspendOverdue(db, today);
  return log;
}

function suspendOverdue(db, today) {
  const cutoff = t.addDays(today, -GRACE_DAYS);
  const overdue = db.prepare(`
    SELECT DISTINCT a.id FROM academies a JOIN invoices i ON i.academy_id = a.id
    WHERE a.status = 'active' AND i.status = 'pending' AND i.billing_date < ?`).all(cutoff);
  for (const { id } of overdue) {
    db.prepare(`UPDATE academies SET status = 'suspended', suspend_reason = '미납' WHERE id = ?`).run(id);
  }
  return overdue.length;
}

function markPaid(db, invoiceId, { method = 'manual', paymentKey = null, today = t.todayKST() } = {}) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new Error('청구서를 찾을 수 없습니다.');
  db.prepare(`UPDATE invoices SET status = 'paid', method = ?, pg_payment_key = ?, paid_at = ?, error = NULL WHERE id = ?`)
    .run(method, paymentKey, today, invoiceId);
  // 남은 연체가 없으면 미납 정지 해제
  const still = db.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE academy_id = ? AND status = 'pending' AND billing_date < ?`)
    .get(inv.academy_id, t.addDays(today, -GRACE_DAYS)).n;
  if (!still) {
    db.prepare(`UPDATE academies SET status = 'active', suspend_reason = NULL WHERE id = ? AND status = 'suspended' AND suspend_reason = '미납'`)
      .run(inv.academy_id);
  }
}

function newAcademyBillingDates(today = t.todayKST()) {
  const trialEnd = t.addDays(today, TRIAL_DAYS);
  return { trial_ends_at: trialEnd, next_billing_date: t.addDays(trialEnd, 1) };
}

module.exports = { runBilling, markPaid, suspendOverdue, createPayments, newAcademyBillingDates, GRACE_DAYS, TRIAL_DAYS };
