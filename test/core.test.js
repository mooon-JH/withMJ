process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const t = require('../src/lib/time');
const { duePeriods, isPeriodEnd, periodEndingOn } = require('../src/services/periods');
const { buildReport } = require('../src/services/report');
const { runDispatch } = require('../src/services/dispatcher');
const { MockKakao } = require('../src/services/kakao');
const billing = require('../src/services/billing');
const { parseCsv, collectLeads } = require('../src/services/leads');

// KST 기준 시각을 만드는 헬퍼: kst('2026-10-17', 21) = 2026-10-17 21:00 KST
const kst = (ymd, hour) => new Date(Date.parse(ymd + 'T00:00:00Z') + (hour - 9) * 3600e3);

function setup() {
  const db = openDb(':memory:');
  const aid = Number(db.prepare(`INSERT INTO academies (name, send_hour, weekly_end_dow) VALUES ('테스트학원', 21, 6)`).run().lastInsertRowid);
  const m = (subject, category, name, hib = 1) =>
    Number(db.prepare(`INSERT INTO metrics (academy_id, subject, category, name, higher_is_better) VALUES (?, ?, ?, ?, ?)`)
      .run(aid, subject, category, name, hib).lastInsertRowid);
  const metrics = { m1: m('수학', '연산', '연산'), m2: m('수학', '개념', '개념'), e1: m('영어', '어휘', '단어') };
  const student = (name, freq = 'weekly', cls = 'A') =>
    Number(db.prepare(`INSERT INTO students (academy_id, name, class_name, parent_phone, frequency) VALUES (?, ?, ?, '010-0000-0000', ?)`)
      .run(aid, name, cls, freq).lastInsertRowid);
  const record = (sid, date, values, status = 'completed') => {
    const a = Number(db.prepare(`INSERT INTO assessments (student_id, date, status) VALUES (?, ?, ?)`).run(sid, date, status).lastInsertRowid);
    for (const [k, v] of Object.entries(values)) db.prepare('INSERT INTO scores VALUES (?, ?, ?)').run(a, metrics[k], v);
  };
  return { db, aid, metrics, student, record };
}

test('시간 계산', () => {
  assert.equal(t.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(t.lastDayOfMonth('2028-02-10'), '2028-02-29');
  assert.equal(t.todayKST(new Date('2026-10-14T15:30:00Z')), '2026-10-15'); // UTC 15:30 = KST 다음날 00:30
});

test('주기별 기간', () => {
  assert.ok(isPeriodEnd('weekly', '2026-10-17', 6)); // 토요일
  assert.ok(!isPeriodEnd('weekly', '2026-10-16', 6));
  assert.ok(isPeriodEnd('quarterly', '2026-09-30'));
  assert.ok(!isPeriodEnd('quarterly', '2026-10-31'));
  assert.deepEqual(periodEndingOn('quarterly', '2026-09-30'), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(periodEndingOn('weekly', '2026-10-17'), { start: '2026-10-11', end: '2026-10-17' });
  // 발송 시각 전에는 오늘 기간이 아직 아님
  assert.equal(duePeriods('daily', kst('2026-10-17', 20), { lookbackDays: 0 }).length, 0);
  assert.equal(duePeriods('daily', kst('2026-10-17', 21), { lookbackDays: 0 }).length, 1);
  // 일요일 아침이면 어제(토) 끝난 주간 기간을 따라잡아 보낸다
  assert.deepEqual(duePeriods('weekly', kst('2026-10-18', 8)).map((p) => p.end), ['2026-10-17']);
});

test('리포트: 과목별 점수, 표준 구간, 순위', () => {
  const { db, student, record } = setup();
  const ids = ['가', '나', '다', '라'].map((n) => student(n));
  const scores = [90, 70, 60, 50];
  ids.forEach((id, i) => record(id, '2026-10-13', { m1: scores[i], m2: scores[i], e1: 100 - scores[i] }));
  const r = buildReport(db, ids[0], '2026-10-11', '2026-10-17', 'weekly');
  assert.deepEqual(r.subjects.map((s) => s.name), ['수학', '영어']);
  const math = r.subjects.find((s) => s.name === '수학');
  assert.equal(math.score, 90);
  assert.equal(math.rank.position, 1);
  assert.equal(r.subjects.find((s) => s.name === '영어').rank.position, 4);
  assert.equal(r.total, 50); // (수학 90 + 영어 10) / 2 — 과목마다 같은 비중
  const it = r.items.find((x) => x.name === '연산');
  assert.equal(it.level, 'high'); // 평균 67.5 + 표준편차 ≈ 84 보다 높음
  assert.equal(r.groupLabel, 'A 반');
});

test('리포트: 낮을수록 좋은 항목은 뒤집어서 계산', () => {
  const { db, student, metrics } = setup();
  const late = Number(db.prepare(`INSERT INTO metrics (academy_id, subject, category, name, min_value, max_value, higher_is_better)
    SELECT academy_id, '태도', '출결', '지각', 0, 10, 0 FROM metrics WHERE id = ?`).run(metrics.m1).lastInsertRowid);
  const sid = student('가');
  const a = Number(db.prepare(`INSERT INTO assessments (student_id, date, status) VALUES (?, '2026-10-13', 'completed')`).run(sid).lastInsertRowid);
  db.prepare('INSERT INTO scores VALUES (?, ?, ?)').run(a, late, 1);
  const r = buildReport(db, sid, '2026-10-13', '2026-10-13', 'daily');
  assert.equal(r.subjects.find((s) => s.name === '태도').score, 90);
});

test('자동 발송: 완료된 기록만, 기간당 한 번만, 정지 학원 제외', async () => {
  const { db, aid, student, record } = setup();
  const s1 = student('가', 'weekly');
  const s2 = student('나', 'weekly');
  record(s1, '2026-10-13', { m1: 80 });
  record(s2, '2026-10-13', { m1: 80 }, 'draft'); // 완료 안 누름
  const kakao = new MockKakao();
  const now = kst('2026-10-17', 21);
  const r1 = await runDispatch(db, kakao, { now, baseUrl: 'http://x' });
  assert.equal(r1.sent, 1);
  assert.match(kakao.sent[0].text, /가 학생의 주간/);
  assert.match(kakao.sent[0].text, /http:\/\/x\/r\//);
  const r2 = await runDispatch(db, kakao, { now, baseUrl: 'http://x' });
  assert.equal(r2.sent, 0);
  assert.equal(r2.skipped, 1);

  db.prepare(`UPDATE academies SET service_enabled = 0 WHERE id = ?`).run(aid);
  record(s1, '2026-10-20', { m1: 90 });
  const r3 = await runDispatch(db, kakao, { now: kst('2026-10-24', 22), baseUrl: 'http://x' });
  assert.equal(r3.sent, 0);
});

test('정산: 청구 → 미납 정지 → 입금 시 재개, 카드는 자동결제', async () => {
  const { db, aid } = setup();
  db.prepare(`UPDATE academies SET next_billing_date = '2026-10-01', plan_price = 30000 WHERE id = ?`).run(aid);
  const pay = new billing.createPayments({});
  const created = await billing.runBilling(db, pay, '2026-10-01');
  assert.equal(created.length, 1);
  assert.equal(db.prepare('SELECT next_billing_date FROM academies').get().next_billing_date, '2026-11-01');
  await billing.runBilling(db, pay, '2026-10-05');
  assert.equal(db.prepare('SELECT status FROM academies').get().status, 'active'); // 유예기간 내
  await billing.runBilling(db, pay, '2026-10-09');
  assert.equal(db.prepare('SELECT status FROM academies').get().status, 'suspended');
  const inv = db.prepare('SELECT id FROM invoices').get();
  billing.markPaid(db, inv.id, { today: '2026-10-09' });
  assert.equal(db.prepare('SELECT status FROM academies').get().status, 'active');

  db.prepare(`UPDATE academies SET billing_key = 'mock-key' WHERE id = ?`).run(aid);
  await billing.runBilling(db, pay, '2026-11-01');
  const nov = db.prepare(`SELECT * FROM invoices WHERE billing_date = '2026-11-01'`).get();
  assert.equal(nov.status, 'paid');
  assert.equal(nov.method, 'card');
});

test('영업: CSV 파싱과 네이버 수집 중복 제거', async () => {
  const rows = parseCsv('학원명,전화번호,주소\n"A, 수학",041-1,홍성읍\nB학원,,광천읍\n');
  assert.deepEqual(rows[0], { name: 'A, 수학', phone: '041-1', address: '홍성읍' });
  assert.equal(rows.length, 2);
  const fake = async (q) => [
    { name: '같은학원', address: '주소1', category: '교육,학문>학원', link: '' },
    { name: '카페', address: '주소2', category: '음식점>카페', link: '' },
    { name: q, address: q, category: '보습학원', link: 'http://a' },
  ];
  const found = await collectLeads({ region: '홍성군', dongs: ['홍성읍'], keywords: ['학원', '공부방'] }, fake);
  assert.equal(found.filter((f) => f.name === '같은학원').length, 1);
  assert.ok(!found.some((f) => f.name === '카페'));
  assert.equal(found.length, 3);
});
