// 자동 발송: 주기가 끝난 학생에게 리포트 링크를 알림톡으로 보낸다.
const { duePeriods, periodLabel } = require('./periods');
const { buildReport, summaryLine } = require('./report');
const { buildMessage } = require('./kakao');
const { randomToken } = require('../lib/auth');

// 운영 중이고 운영자 스위치가 켜진 학원만 발송한다 (미납 정지 시 status='suspended')
function academyCanSend(a) {
  return a.status === 'active' && a.service_enabled === 1;
}

async function sendReport(db, kakao, { student, academy, type, start, end, baseUrl, startKey = start }) {
  const token = randomToken(12);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO report_sends (student_id, period_type, period_start, period_end, send_key, token, to_phone, provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(student.id, type, start, end, startKey, token, student.parent_phone, kakao.name);
  if (ins.changes === 0) return { skipped: 'already-sent' };
  const sendId = Number(ins.lastInsertRowid);

  const report = buildReport(db, student.id, start, end, type);
  const url = `${baseUrl}/r/${token}`;
  const { text, variables } = buildMessage({
    academyName: academy.name,
    studentName: student.name,
    periodLabel: (type === 'manual' ? '' : report.period.typeLabel + ' ') + periodLabel(type, start, end),
    summary: summaryLine(report),
    url,
  });
  let result;
  try {
    result = await kakao.send({ to: student.parent_phone, text, variables });
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  db.prepare(`UPDATE report_sends SET status = ?, message = ?, provider_msg_id = ?, error = ?,
              sent_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?`)
    .run(result.ok ? 'sent' : 'failed', text, result.messageId || null, result.error || null, result.ok ? 1 : 0, sendId);
  return { id: sendId, ok: result.ok, error: result.error, token };
}

function hasCompleted(db, studentId, start, end) {
  return !!db.prepare(`SELECT 1 FROM assessments WHERE student_id = ? AND status = 'completed' AND date BETWEEN ? AND ? LIMIT 1`)
    .get(studentId, start, end);
}

async function runDispatch(db, kakao, { now = new Date(), baseUrl }) {
  const stats = { sent: 0, failed: 0, skipped: 0 };
  const academies = db.prepare('SELECT * FROM academies').all().filter(academyCanSend);
  for (const academy of academies) {
    const students = db.prepare(`
      SELECT * FROM students WHERE academy_id = ? AND active = 1 AND send_enabled = 1
        AND parent_phone IS NOT NULL AND parent_phone != ''`).all(academy.id);
    for (const student of students) {
      const periods = duePeriods(student.frequency, now, { sendHour: academy.send_hour, weeklyEndDow: academy.weekly_end_dow });
      for (const p of periods) {
        if (!hasCompleted(db, student.id, p.start, p.end)) continue; // 기록 없는 기간은 보내지 않음
        const r = await sendReport(db, kakao, { student, academy, type: p.type, start: p.start, end: p.end, baseUrl });
        if (r.skipped) stats.skipped++;
        else if (r.ok) stats.sent++;
        else stats.failed++;
      }
    }
  }
  return stats;
}

module.exports = { runDispatch, sendReport, academyCanSend };
