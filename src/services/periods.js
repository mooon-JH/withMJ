// 발송 주기(일간/주간/월간/분기)별 '기간' 계산
const t = require('../lib/time');

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'];
const FREQ_LABEL = { daily: '일간', weekly: '주간', monthly: '월간', quarterly: '분기', manual: '수시' };

// 그 날이 해당 주기의 '마지막 날'(=발송일)인가?
function isPeriodEnd(type, day, weeklyEndDow = 6) {
  switch (type) {
    case 'daily': return true;
    case 'weekly': return t.dayOfWeek(day) === weeklyEndDow;
    case 'monthly': return t.lastDayOfMonth(day) === day;
    case 'quarterly': return t.lastDayOfMonth(day) === day && [3, 6, 9, 12].includes(Number(day.slice(5, 7)));
    default: return false;
  }
}

// 마지막 날(endDay)로 끝나는 기간
function periodEndingOn(type, endDay) {
  switch (type) {
    case 'daily': return { start: endDay, end: endDay };
    case 'weekly': return { start: t.addDays(endDay, -6), end: endDay };
    case 'monthly': return { start: t.firstDayOfMonth(endDay), end: endDay };
    case 'quarterly': return { start: t.firstDayOfMonth(t.addMonths(t.firstDayOfMonth(endDay), -2)), end: endDay };
    default: throw new Error('unknown period type: ' + type);
  }
}

// 지금 시점에 발송했어야 하는 기간들. 서버가 잠깐 꺼져 있었어도 lookbackDays 만큼은 따라잡는다.
function duePeriods(type, now, { sendHour = 21, weeklyEndDow = 6, lookbackDays = 3 } = {}) {
  const today = t.todayKST(now);
  const out = [];
  for (let i = 0; i <= lookbackDays; i++) {
    const day = t.addDays(today, -i);
    if (i === 0 && t.hourKST(now) < sendHour) continue;
    if (isPeriodEnd(type, day, weeklyEndDow)) out.push({ type, ...periodEndingOn(type, day) });
  }
  return out;
}

// 같은 길이의 직전 기간 (지난주/지난달 대비 비교용)
function previousPeriod(type, start) {
  if (type === 'manual') return null;
  return periodEndingOn(type, t.addDays(start, -1));
}

function periodLabel(type, start, end) {
  const md = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`;
  if (type === 'daily') return md(start);
  if (type === 'monthly') return `${start.slice(0, 4)}년 ${Number(start.slice(5, 7))}월`;
  if (type === 'quarterly') return `${start.slice(0, 4)}년 ${Math.ceil(Number(end.slice(5, 7)) / 3)}분기`;
  return `${md(start)} ~ ${md(end)}`;
}

module.exports = { FREQUENCIES, FREQ_LABEL, isPeriodEnd, periodEndingOn, duePeriods, previousPeriod, periodLabel };
