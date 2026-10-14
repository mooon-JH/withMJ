const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { sessionMiddleware, requireRole, hashPassword } = require('./lib/auth');
const { createKakao } = require('./services/kakao');
const { createPayments, runBilling } = require('./services/billing');
const { runDispatch } = require('./services/dispatcher');
const t = require('./lib/time');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  try {
    for (const line of require('node:fs').readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* .env 없음 */ }
}

function ensureAdmin(db) {
  const email = (process.env.ADMIN_EMAIL || 'admin@withmj.kr').toLowerCase();
  if (!db.prepare(`SELECT 1 FROM users WHERE role = 'superadmin'`).get()) {
    const pw = process.env.ADMIN_PASSWORD || 'change-me';
    db.prepare(`INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, '운영자', 'superadmin')`).run(email, hashPassword(pw));
    console.log(`운영자 계정 생성: ${email} / ${pw === 'change-me' ? 'change-me (바로 바꾸세요!)' : '(환경변수 값)'}`);
  }
}

function createApp(db, ctx) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(sessionMiddleware(db));

  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/admin', requireRole('superadmin'), require('./routes/admin')(db, ctx));
  app.use('/api/academy', requireRole('academy'), require('./routes/academy')(db, ctx));
  app.use('/api/public', require('./routes/public')(db));

  const pub = path.join(__dirname, '..', 'public');
  const page = (f) => (_req, res) => res.sendFile(path.join(pub, f));
  app.get('/admin', page('admin.html'));
  app.get('/academy', page('academy.html'));
  app.get('/r/:token', page('report.html'));
  app.get('/print', page('report.html')); // 학원용 미리보기·일괄 인쇄 (같은 렌더러 사용)
  app.get('/sw.js', (_req, res) => { // 서비스 워커는 항상 최신본을 받도록 (앱 업데이트 반영)
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'sw.js'));
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(express.static(pub));

  app.use((err, _req, res, _next) => {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    res.status(400).json({ error: err.message || '오류가 발생했습니다.' });
  });
  return app;
}

function startJobs(db, ctx) {
  // 1분마다: 발송 시각이 된 리포트 발송 / 하루 한 번: 정산
  let lastBillingDay = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await ctx.runDispatchNow();
      if (s.sent || s.failed) console.log(`[발송] 성공 ${s.sent}, 실패 ${s.failed}`);
      const today = t.todayKST();
      if (lastBillingDay !== today && t.hourKST() >= 9) {
        lastBillingDay = today;
        const created = await runBilling(db, ctx.payments, today);
        if (created.length) console.log(`[정산] 청구서 ${created.length}건 발행`);
      }
    } catch (e) {
      console.error('[작업 오류]', e);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 60 * 1000).unref();
  setTimeout(tick, 3000).unref();
}

if (require.main === module) {
  loadEnv();
  const db = openDb();
  ensureAdmin(db);
  if (process.env.DEMO_SEED === '1' || process.env.DEMO_SEED === 'true') {
    const { seedDemo, hasDemo, DEMO_EMAIL, DEMO_PASSWORD } = require('../scripts/seed');
    if (!hasDemo(db)) seedDemo(db);
    console.log(`데모 모드: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }
  const ctx = {
    // Render 같은 호스팅은 RENDER_EXTERNAL_URL 로 자기 주소를 알려준다
    baseUrl: (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
    kakao: createKakao(),
    payments: createPayments(),
  };
  ctx.runDispatchNow = () => runDispatch(db, ctx.kakao, { baseUrl: ctx.baseUrl });
  createApp(db, ctx).listen(Number(process.env.PORT) || 3000, () => {
    console.log(`withMJ 실행 중 → ${ctx.baseUrl}  (알림톡: ${ctx.kakao.name}, 결제: ${ctx.payments.name})`);
  });
  startJobs(db, ctx);
}

module.exports = { createApp, ensureAdmin };
