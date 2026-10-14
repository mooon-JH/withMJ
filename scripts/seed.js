// 시연용 데모 데이터: 학원 1곳, 학생 12명(2개 반), 최근 8주 수학·영어 기록, 영업 리드 몇 곳
// 사용: npm run seed  (기존 데모 학원은 지우고 다시 만듦)
const { openDb, tx } = require('../src/db');
const { hashPassword } = require('../src/lib/auth');
const { seedDefaultMetrics } = require('../src/services/defaults');
const { saveLeads } = require('../src/services/leads');
const t = require('../src/lib/time');

const db = openDb(process.env.DB_PATH);
const EMAIL = 'demo@academy.kr';
const PASSWORD = 'demo1234';

// 같은 결과가 나오도록 고정 시드 난수
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const clamp = (x) => Math.max(0, Math.min(100, Math.round(x)));

tx(db, () => {
  const old = db.prepare('SELECT academy_id FROM users WHERE email = ?').get(EMAIL);
  if (old) db.prepare('DELETE FROM academies WHERE id = ?').run(old.academy_id);
  const today = t.todayKST();
  const academyId = Number(db.prepare(`INSERT INTO academies (name, owner_name, phone, region, trial_ends_at, next_billing_date)
    VALUES ('해솔수학영어학원', '김해솔', '041-632-0000', '충남 홍성군', ?, ?)`).run(t.addDays(today, 10), t.addDays(today, 11)).lastInsertRowid);
  db.prepare(`INSERT INTO users (academy_id, email, password_hash, name, role) VALUES (?, ?, ?, '김해솔', 'academy')`)
    .run(academyId, EMAIL, hashPassword(PASSWORD));
  seedDefaultMetrics(db, academyId);
  const metrics = db.prepare('SELECT * FROM metrics WHERE academy_id = ?').all(academyId);

  const names = ['김민준', '이서연', '박도윤', '최하은', '정시우', '강지유', '조하준', '윤서아', '장예준', '임지아', '한유준', '오수아'];
  const freqs = ['weekly', 'weekly', 'monthly', 'daily', 'weekly', 'monthly', 'weekly', 'quarterly', 'weekly', 'monthly', 'weekly', 'weekly'];
  const students = names.map((name, i) => {
    const id = Number(db.prepare(`INSERT INTO students (academy_id, name, school_grade, class_name, parent_name, parent_phone, frequency)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(academyId, name, i < 6 ? '중2' : '중3', i < 6 ? '중2A' : '중3A',
      name[0] + '○○ 어머님', `010-${String(1000 + i * 37).slice(-4)}-${String(5000 + i * 91).slice(-4)}`, freqs[i]).lastInsertRowid);
    // 학생마다 기본 실력, 성장 속도, 항목별 강약이 다르게
    const bias = Object.fromEntries(metrics.map((m) => [m.id, (rand() - 0.5) * 30]));
    return { id, base: 50 + rand() * 35, growth: (rand() - 0.25) * 3, bias };
  });

  const comments = ['집중력이 좋았어요.', '오답 노트 꼼꼼히 정리함', '숙제 일부 누락, 다음 시간 보충', '서술형 풀이 과정이 깔끔해졌어요.', '단어 시험 만점!', ''];
  // 최근 8주, 주 2회 (화/목)
  for (let d = t.addDays(today, -56); d <= today; d = t.addDays(d, 1)) {
    if (![2, 4].includes(t.dayOfWeek(d))) continue;
    const week = t.diffDays(d, t.addDays(today, -56)) / 7;
    for (const s of students) {
      if (rand() < 0.08) continue; // 결석
      const a = Number(db.prepare(`INSERT INTO assessments (student_id, date, comment, status, completed_at) VALUES (?, ?, ?, 'completed', ?)`)
        .run(s.id, d, comments[Math.floor(rand() * comments.length)], d + 'T12:00:00Z').lastInsertRowid);
      for (const m of metrics) {
        db.prepare('INSERT INTO scores (assessment_id, metric_id, value) VALUES (?, ?, ?)')
          .run(a, m.id, clamp(s.base + s.growth * week + s.bias[m.id] + (rand() - 0.5) * 14));
      }
    }
  }

  saveLeads(db, [
    { name: '푸른솔보습학원', phone: '041-631-1111', address: '충남 홍성군 홍성읍 의사로 12', region: '충남 홍성군', category: '교육,학문>보습학원', link: '', source: 'demo' },
    { name: '한빛수학교습소', phone: '041-632-2222', address: '충남 홍성군 홍북읍 청사로 50', region: '충남 홍성군', category: '교육,학문>수학학원', link: '', source: 'demo' },
    { name: '예산잉글리시', phone: '041-333-3333', address: '충남 예산군 예산읍 천변로 7', region: '충남 예산군', category: '교육,학문>영어학원', link: 'https://example.com', source: 'demo' },
  ]);
});

console.log(`데모 학원 생성 완료 → 로그인: ${EMAIL} / ${PASSWORD}`);
