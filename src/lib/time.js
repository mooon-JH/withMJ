// 모든 날짜 계산은 한국 시간(KST, UTC+9, 서머타임 없음) 기준 'YYYY-MM-DD' 문자열로 다룬다.
const KST_OFFSET = 9 * 3600 * 1000;

function toKst(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET);
}

function todayKST(now = new Date()) {
  return toKst(now).toISOString().slice(0, 10);
}

function hourKST(now = new Date()) {
  return toKst(now).getUTCHours();
}

function parse(ymd) {
  return new Date(ymd + 'T00:00:00Z');
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(ymd, n) {
  const d = parse(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

// 1월 31일 + 1개월 = 2월 28/29일 처럼 말일을 넘지 않게 자른다.
function addMonths(ymd, n) {
  const d = parse(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = lastDayOfMonth(fmt(d));
  d.setUTCDate(Math.min(day, Number(last.slice(8))));
  return fmt(d);
}

function dayOfWeek(ymd) {
  return parse(ymd).getUTCDay(); // 0=일 ... 6=토
}

function firstDayOfMonth(ymd) {
  return ymd.slice(0, 8) + '01';
}

function lastDayOfMonth(ymd) {
  const d = parse(firstDayOfMonth(ymd));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fmt(d);
}

function diffDays(a, b) {
  return Math.round((parse(a) - parse(b)) / 86400000);
}

module.exports = {
  todayKST, hourKST, addDays, addMonths, dayOfWeek,
  firstDayOfMonth, lastDayOfMonth, diffDays,
};
