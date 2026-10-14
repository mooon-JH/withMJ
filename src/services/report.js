// 인바디식 성적표 데이터 계산
// - 항목별 값과 '표준 범위'(표준이하/표준/표준이상)
// - 과목별 점수·등급·석차, 과목 안 영역별 점수(레이더 차트)
// - 종합 점수와 등급, 반 내 위치(상위 %)
// - 최근 기록 추이, 직전 기간 대비 변화
const { previousPeriod, periodLabel, FREQ_LABEL } = require('./periods');

const round1 = (x) => Math.round(x * 10) / 10;

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// 0~100 으로 환산. '낮을수록 좋은' 항목(지각 횟수 등)은 뒤집는다.
function normalize(metric, v) {
  const span = metric.max_value - metric.min_value || 1;
  const p = ((v - metric.min_value) / span) * 100;
  return Math.max(0, Math.min(100, metric.higher_is_better ? p : 100 - p));
}

function gradeOf(score) {
  if (score == null) return null;
  if (score >= 90) return { letter: 'A', label: '매우 우수' };
  if (score >= 80) return { letter: 'B', label: '우수' };
  if (score >= 70) return { letter: 'C', label: '보통' };
  if (score >= 60) return { letter: 'D', label: '노력 필요' };
  return { letter: 'E', label: '집중 관리' };
}

// 기간 내 학생별·항목별 평균값 { studentId: { metricId: avg } }
function periodAverages(db, studentIds, start, end) {
  if (!studentIds.length) return {};
  const rows = db.prepare(`
    SELECT a.student_id, s.metric_id, AVG(s.value) AS v
    FROM assessments a JOIN scores s ON s.assessment_id = a.id
    WHERE a.status = 'completed' AND a.date BETWEEN ? AND ?
      AND a.student_id IN (${studentIds.map(() => '?').join(',')})
    GROUP BY a.student_id, s.metric_id`).all(start, end, ...studentIds);
  const out = {};
  for (const r of rows) (out[r.student_id] ||= {})[r.metric_id] = r.v;
  return out;
}

function totalScore(metrics, values) {
  const ps = metrics.filter((m) => values?.[m.id] != null).map((m) => normalize(m, values[m.id]));
  return ps.length ? mean(ps) : null;
}

function buildReport(db, studentId, start, end, periodType = 'manual') {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return null;
  const academy = db.prepare('SELECT id, name, phone FROM academies WHERE id = ?').get(student.academy_id);
  const metrics = db.prepare('SELECT * FROM metrics WHERE academy_id = ? AND active = 1 ORDER BY subject, sort, id').all(student.academy_id);

  // 비교 집단: 같은 반 학생이 3명 이상 기록이 있으면 반, 아니면 학원 전체
  const all = db.prepare('SELECT id, class_name FROM students WHERE academy_id = ? AND active = 1').all(student.academy_id);
  const allAvg = periodAverages(db, all.map((s) => s.id), start, end);
  const classmates = all.filter((s) => student.class_name && s.class_name === student.class_name && allAvg[s.id]);
  const useClass = classmates.length >= 3;
  const group = useClass ? classmates : all.filter((s) => allAvg[s.id]);
  const groupLabel = useClass ? `${student.class_name} 반` : '학원 전체';
  const mine = allAvg[student.id] || {};

  const items = metrics.map((m) => {
    const peers = group.map((s) => allAvg[s.id]?.[m.id]).filter((v) => v != null);
    const avg = mean(peers);
    const sd = stdev(peers);
    let low = m.std_low, high = m.std_high;
    if (low == null || high == null) {
      if (peers.length >= 3) {
        low = Math.max(m.min_value, avg - sd);
        high = Math.min(m.max_value, avg + sd);
      } else {
        const span = m.max_value - m.min_value;
        low = m.min_value + span * 0.6;
        high = m.min_value + span * 0.85;
      }
    }
    const v = mine[m.id];
    let level = null;
    if (v != null) {
      const better = m.higher_is_better ? v > high : v < low;
      const worse = m.higher_is_better ? v < low : v > high;
      level = better ? 'high' : worse ? 'low' : 'normal';
    }
    let topPercent = null;
    if (v != null && peers.length >= 2) {
      const beaten = peers.filter((p) => (m.higher_is_better ? p > v : p < v)).length;
      topPercent = Math.max(1, Math.round(((beaten + 1) / peers.length) * 100));
    }
    return {
      id: m.id, subject: m.subject, category: m.category, name: m.name, unit: m.unit,
      min: m.min_value, max: m.max_value, higherIsBetter: !!m.higher_is_better,
      value: v == null ? null : round1(v),
      avg: avg == null ? null : round1(avg),
      stdLow: round1(low), stdHigh: round1(high),
      level, topPercent, peerCount: peers.length,
    };
  });

  // 과목별 점수 → 종합 점수는 '과목 점수들의 평균' (과목마다 항목 수가 달라도 같은 비중)
  const subjectNames = [];
  for (const m of metrics) if (!subjectNames.includes(m.subject)) subjectNames.push(m.subject);
  const scoreBySubjects = (vals) => {
    const xs = subjectNames.map((sub) => totalScore(metrics.filter((m) => m.subject === sub), vals)).filter((x) => x != null);
    return xs.length ? mean(xs) : null;
  };
  const rankOf = (me, others) => {
    if (me == null || others.length < 2) return null;
    const above = others.filter((x) => x > me + 1e-9).length;
    return { position: above + 1, of: others.length, topPercent: Math.max(1, Math.round(((above + 1) / others.length) * 100)) };
  };

  const prev = previousPeriod(periodType, start);
  const prevVals = prev ? periodAverages(db, [student.id], prev.start, prev.end)[student.id] : null;

  const subjects = subjectNames.map((sub) => {
    const ms = metrics.filter((m) => m.subject === sub);
    const me = totalScore(ms, mine);
    const others = group.map((s) => totalScore(ms, allAvg[s.id])).filter((x) => x != null);
    const cats = [];
    for (const m of ms) if (!cats.includes(m.category)) cats.push(m.category);
    const prevScore = prevVals ? totalScore(ms, prevVals) : null;
    return {
      name: sub,
      score: me == null ? null : round1(me),
      avg: others.length ? round1(mean(others)) : null,
      prevScore: prevScore == null ? null : round1(prevScore),
      grade: gradeOf(me),
      rank: rankOf(me, others),
      categories: cats.map((c) => {
        const cm = ms.filter((m) => m.category === c);
        const cme = totalScore(cm, mine);
        const co = group.map((s) => totalScore(cm, allAvg[s.id])).filter((x) => x != null);
        return { name: c, score: cme == null ? null : round1(cme), avg: co.length ? round1(mean(co)) : null };
      }),
    };
  });

  const total = scoreBySubjects(mine);
  const groupTotals = group.map((s) => scoreBySubjects(allAvg[s.id])).filter((x) => x != null);
  const rank = rankOf(total, groupTotals);
  const pt = prevVals ? scoreBySubjects(prevVals) : null;
  const prevTotal = pt == null ? null : round1(pt);

  // 최근 10회 기록 추이 (기간 끝까지)
  const recent = db.prepare(`
    SELECT id, date, comment FROM assessments
    WHERE student_id = ? AND status = 'completed' AND date <= ?
    ORDER BY date DESC LIMIT 10`).all(student.id, end).reverse();
  const scoreStmt = db.prepare('SELECT metric_id, value FROM scores WHERE assessment_id = ?');
  const history = recent.map((a) => {
    const vals = {};
    for (const s of scoreStmt.all(a.id)) vals[s.metric_id] = s.value;
    const tot = scoreBySubjects(vals);
    return { date: a.date, values: vals, total: tot == null ? null : round1(tot) };
  });

  const comments = db.prepare(`
    SELECT date, comment FROM assessments
    WHERE student_id = ? AND status = 'completed' AND date BETWEEN ? AND ? AND comment IS NOT NULL AND comment != ''
    ORDER BY date`).all(student.id, start, end);
  const sessionCount = db.prepare(`
    SELECT COUNT(*) AS n FROM assessments WHERE student_id = ? AND status = 'completed' AND date BETWEEN ? AND ?`)
    .get(student.id, start, end).n;

  const scored = items.filter((i) => i.value != null);
  const byPct = (i) => normalize(metrics.find((m) => m.id === i.id), i.value);
  const label = (i) => `${i.subject} ${i.name}`;
  const strengths = [...scored].sort((a, b) => byPct(b) - byPct(a)).slice(0, 2).map(label);
  const weaknesses = [...scored].sort((a, b) => byPct(a) - byPct(b)).slice(0, 2).map(label)
    .filter((x) => !strengths.includes(x));

  return {
    academy: { name: academy.name, phone: academy.phone },
    student: { name: student.name, schoolGrade: student.school_grade, className: student.class_name },
    period: { type: periodType, typeLabel: FREQ_LABEL[periodType], start, end, label: periodLabel(periodType, start, end) },
    groupLabel,
    sessionCount,
    total: total == null ? null : round1(total),
    groupAvg: groupTotals.length ? round1(mean(groupTotals)) : null,
    prevTotal,
    grade: gradeOf(total),
    rank,
    subjects: subjects.filter((x) => x.score != null),
    items,
    metricsMeta: metrics.map((m) => ({ id: m.id, name: m.name, subject: m.subject, category: m.category })),
    history,
    comments,
    strengths,
    weaknesses,
  };
}

// 카톡 본문에 들어갈 한 줄 요약
function summaryLine(r) {
  if (r.total == null) return '이번 기간 기록이 없습니다.';
  const parts = [`종합 ${Math.round(r.total)}점(${r.grade.letter} · ${r.grade.label})`];
  if (r.prevTotal != null) {
    const d = Math.round(r.total - r.prevTotal);
    parts.push(d === 0 ? '지난 기간과 동일' : `지난 기간 대비 ${d > 0 ? '+' : ''}${d}점`);
  }
  if (r.subjects.length > 1) parts.push(r.subjects.map((x) => `${x.name} ${Math.round(x.score)}`).join(' · '));
  if (r.strengths.length) parts.push(`강점: ${r.strengths.join(', ')}`);
  return parts.join(' / ');
}

module.exports = { buildReport, summaryLine, normalize, gradeOf, mean, stdev };
