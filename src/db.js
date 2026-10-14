const path = require('node:path');
const fs = require('node:fs');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  throw new Error(`Node.js ${process.version} 에는 내장 SQLite 가 없습니다. Node 22.13 이상으로 실행해 주세요 (Render: 환경변수 NODE_VERSION=22.22.0).`);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS academies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  owner_name TEXT,
  phone TEXT,
  region TEXT,
  status TEXT NOT NULL DEFAULT 'active',          -- active | suspended | cancelled
  suspend_reason TEXT,
  service_enabled INTEGER NOT NULL DEFAULT 1,     -- 운영자가 켜고 끄는 스위치
  plan_price INTEGER NOT NULL DEFAULT 30000,
  trial_ends_at TEXT,
  next_billing_date TEXT,
  billing_key TEXT,                               -- 토스 자동결제 빌링키
  send_hour INTEGER NOT NULL DEFAULT 21,          -- 알림톡 발송 시각(KST)
  weekly_end_dow INTEGER NOT NULL DEFAULT 6,      -- 주간 리포트 마감 요일(6=토)
  lead_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  academy_id INTEGER REFERENCES academies(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL,                             -- superadmin | academy
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- 평가 항목 (인바디의 '체수분/근육량' 같은 측정 항목). 과목 > 영역 > 항목 의 3단 구조.
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY,
  academy_id INTEGER NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '공통',            -- 과목 (수학/영어/국어 ...)
  category TEXT NOT NULL,                         -- 과목 안의 영역 (연산/서술형/태도 ...)
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '점',
  min_value REAL NOT NULL DEFAULT 0,
  max_value REAL NOT NULL DEFAULT 100,
  std_low REAL,                                   -- 비워두면 원생 평균±표준편차로 자동 계산
  std_high REAL,
  higher_is_better INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  academy_id INTEGER NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  school_grade TEXT,
  class_name TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  frequency TEXT NOT NULL DEFAULT 'weekly',       -- daily | weekly | monthly | quarterly
  send_enabled INTEGER NOT NULL DEFAULT 1,
  memo TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 한 번의 평가(수업일) 기록. '완료' 되어야 리포트/발송 대상이 된다.
CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'draft',           -- draft | completed
  completed_at TEXT,
  UNIQUE (student_id, date)
);

CREATE TABLE IF NOT EXISTS scores (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  metric_id INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  value REAL NOT NULL,
  PRIMARY KEY (assessment_id, metric_id)
);

-- 학부모에게 나간 리포트. (학생, 주기, send_key) 가 같으면 중복 발송하지 않는다.
CREATE TABLE IF NOT EXISTS report_sends (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL,                      -- daily | weekly | monthly | quarterly | manual
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  send_key TEXT NOT NULL,                         -- 중복 발송 방지 키 (정기: 기간시작일, 수시: 시각 포함)
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',          -- queued | sent | failed
  to_phone TEXT,
  message TEXT,
  provider TEXT,
  provider_msg_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  viewed_at TEXT,
  UNIQUE (student_id, period_type, send_key)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  academy_id INTEGER NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
  billing_date TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | paid | failed | void
  method TEXT,                                    -- card | transfer | manual
  paid_at TEXT,
  pg_payment_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (academy_id, billing_date)
);

-- 영업 리스트 (네이버 지도 등록 학원)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  region TEXT,
  category TEXT,
  link TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',             -- new | called | interested | demo | won | lost | hold
  next_action_date TEXT,
  notes TEXT,
  call_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, address)
);

CREATE INDEX IF NOT EXISTS idx_students_academy ON students(academy_id);
CREATE INDEX IF NOT EXISTS idx_assess_student_date ON assessments(student_id, date);
CREATE INDEX IF NOT EXISTS idx_sends_student ON report_sends(student_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
`;

function openDb(file = process.env.DB_PATH || 'data/withmj.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// 여러 쿼리를 하나로 묶어 '전부 성공 or 전부 취소' 로 처리
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, tx };
