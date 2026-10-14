// 인바디식 학습 성취 리포트 렌더러 (학부모 카톡 링크 / 학원 미리보기·일괄 인쇄 공용)
const NS = 'http://www.w3.org/2000/svg';
const COLORS = ['#2f6bff', '#f08c00', '#16a36a', '#9c36b5', '#e0444e', '#0b7285'];
const GRADE_COLOR = { A: '#16a36a', B: '#2f6bff', C: '#5d6575', D: '#f08c00', E: '#e0444e' };
const LEVEL_LABEL = { low: '표준이하', normal: '표준', high: '표준이상' };

function S(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const fmt = (v) => (v == null ? '-' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const norm = (it, v) => {
  const p = ((v - it.min) / (it.max - it.min || 1)) * 100;
  return Math.max(0, Math.min(100, it.higherIsBetter ? p : 100 - p));
};

// ---- 종합 점수 링 ----
function ring(score, grade) {
  const r = 52, c = 2 * Math.PI * r, p = (score ?? 0) / 100;
  const col = grade ? GRADE_COLOR[grade.letter] : '#d7dbe2';
  return h('div.ring',
    S('svg', { viewBox: '0 0 130 130', width: 130, height: 130 },
      S('circle', { cx: 65, cy: 65, r, fill: 'none', stroke: '#e9ecf1', 'stroke-width': 12 }),
      S('circle', { cx: 65, cy: 65, r, fill: 'none', stroke: col, 'stroke-width': 12, 'stroke-linecap': 'round',
        'stroke-dasharray': `${c * p} ${c}`, transform: 'rotate(-90 65 65)' }),
      S('text', { x: 65, y: 66, 'text-anchor': 'middle', 'font-size': 34, 'font-weight': 800, fill: '#161b26' }, score == null ? '-' : Math.round(score)),
      S('text', { x: 65, y: 88, 'text-anchor': 'middle', 'font-size': 11, fill: '#5d6575' }, '종합 점수 / 100')),
    grade ? h('div.grade', { style: `color:${col}` }, `${grade.letter}등급 · ${grade.label}`) : h('div.grade', '기록 없음'));
}

// ---- 인바디식 막대: 표준 구간이 항상 가운데 1/3 칸에 오도록 구간별로 늘리고 줄인다 ----
function ibBar(it) {
  const W = 300;
  let { min, max, stdLow: lo, stdHigh: hi } = it;
  let v = it.value, avg = it.avg;
  if (!it.higherIsBetter) { // 낮을수록 좋은 항목은 뒤집어서 '오른쪽 = 좋음' 으로 통일
    const f = (x) => (x == null ? null : min + max - x);
    [lo, hi] = [f(hi), f(lo)];
    v = f(v); avg = f(avg);
  }
  const pos = (x) => {
    if (x == null) return null;
    const seg = (a, b, x0) => (b - a <= 0 ? x0 : x0 + ((Math.min(Math.max(x, a), b) - a) / (b - a)) * (W / 3));
    if (x <= lo) return seg(min, lo, 0);
    if (x <= hi) return seg(lo, hi, W / 3);
    return seg(hi, max, (2 * W) / 3);
  };
  const vx = pos(v), ax = pos(avg);
  return S('svg', { viewBox: `0 0 ${W} 34`, preserveAspectRatio: 'none' },
    S('rect', { x: W / 3, y: 4, width: W / 3, height: 26, fill: 'var(--band)' }),
    S('line', { x1: W / 3, x2: W / 3, y1: 2, y2: 32, stroke: '#9aa3b5', 'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke' }),
    S('line', { x1: (2 * W) / 3, x2: (2 * W) / 3, y1: 2, y2: 32, stroke: '#9aa3b5', 'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke' }),
    vx != null ? S('rect', { x: 0, y: 11, width: Math.max(2, vx), height: 12, fill: '#161b26' }) : null,
    ax != null ? S('polygon', { points: `${ax - 4},32 ${ax + 4},32 ${ax},25`, fill: 'var(--avg)' }) : null);
}

function ibTable(items) {
  return h('div',
    h('div.ib-head', h('span', '항목'), h('div.zones', h('span', '표준이하'), h('span', '표준'), h('span', '표준이상')), h('span', { style: 'text-align:right' }, '결과')),
    items.map((it) => h('div.ib-row',
      h('div.name', h('b', it.name), h('span', `${it.category} · 표준 ${fmt(it.stdLow)}~${fmt(it.stdHigh)}${it.unit}`)),
      ibBar(it),
      h('div.val', it.value == null ? h('span', { style: 'color:#9aa3b5' }, '-') : [
        fmt(it.value), h('small.lvl-' + it.level, LEVEL_LABEL[it.level]),
      ]))));
}

// ---- 레이더 (과목 안 영역) ----
function radar(cats, color) {
  const n = cats.length, R = 70, cx = 100, cy = 92;
  const pt = (i, val) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + Math.cos(a) * R * (val / 100), cy + Math.sin(a) * R * (val / 100)];
  };
  const poly = (vals) => vals.map((v, i) => pt(i, v ?? 0).join(',')).join(' ');
  return S('svg', { viewBox: '-28 0 256 190', width: '100%', style: 'max-width:230px' },
    [25, 50, 75, 100].map((l) => S('polygon', { points: poly(cats.map(() => l)), fill: 'none', stroke: '#e1e5eb' })),
    cats.map((_, i) => { const [x, y] = pt(i, 100); return S('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: '#e1e5eb' }); }),
    cats.some((c) => c.avg != null) ? S('polygon', { points: poly(cats.map((c) => c.avg)), fill: 'none', stroke: '#8a93a6', 'stroke-dasharray': '3 3', 'stroke-width': 1.5 }) : null,
    S('polygon', { points: poly(cats.map((c) => c.score)), fill: color, 'fill-opacity': 0.18, stroke: color, 'stroke-width': 2 }),
    cats.map((c, i) => {
      const [x, y] = pt(i, 122);
      return S('text', { x, y: y + 4, 'text-anchor': 'middle', 'font-size': 10.5, fill: '#161b26', 'font-weight': 700 },
        `${c.name} ${c.score == null ? '-' : Math.round(c.score)}`);
    }));
}

function catBars(cats, color) {
  return h('div', cats.map((c) => h('div', { style: 'margin:6px 0;text-align:left' },
    h('div', { style: 'display:flex;justify-content:space-between;font-size:11.5px' }, h('b', c.name), h('span', c.score == null ? '-' : Math.round(c.score))),
    h('div', { style: 'height:8px;background:#eef0f3;position:relative' },
      h('div', { style: `height:8px;width:${c.score ?? 0}%;background:${color}` }),
      c.avg != null ? h('div', { style: `position:absolute;top:-2px;left:${c.avg}%;width:2px;height:12px;background:#8a93a6` }) : null))));
}

// ---- 추이 선 그래프 ----
function trend(r) {
  const meta = Object.fromEntries(r.items.map((i) => [i.id, i]));
  const subjects = r.subjects.map((s) => s.name);
  const pts = r.history.map((hh) => {
    const bySub = {};
    for (const s of subjects) {
      const vs = r.items.filter((i) => i.subject === s && hh.values[i.id] != null).map((i) => norm(meta[i.id], hh.values[i.id]));
      bySub[s] = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    }
    return { date: hh.date, total: hh.total, bySub };
  });
  if (pts.length < 2) return h('div', { style: 'color:#5d6575;padding:16px 0' }, '기록이 2회 이상 쌓이면 변화 그래프가 나타납니다.');
  const W = 700, H = 170, L = 30, B = 22, T = 10, Rr = 16;
  // 변화가 잘 보이도록 세로축 아래쪽을 기록 최저점 근처에서 자른다
  const all = pts.flatMap((p) => [p.total, ...Object.values(p.bySub)]).filter((v) => v != null);
  const lo = Math.max(0, Math.floor((Math.min(...all) - 5) / 10) * 10);
  const y = (v) => T + (1 - (v - lo) / (100 - lo)) * (H - T - B);
  const x = (i) => L + (i * (W - L - Rr)) / (pts.length - 1);
  const line = (get, color, width, dash) => {
    let d = '';
    pts.forEach((p, i) => { const v = get(p); if (v != null) d += (d ? 'L' : 'M') + x(i) + ',' + y(v); });
    return d ? S('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round' }) : null;
  };
  return h('div',
    S('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%' },
      [lo, Math.round((lo + 100) / 2), 100].map((g) => [S('line', { x1: L, x2: W - Rr, y1: y(g), y2: y(g), stroke: '#e9ecf1' }),
        S('text', { x: L - 6, y: y(g) + 4, 'text-anchor': 'end', 'font-size': 10, fill: '#5d6575' }, g)]),
      pts.map((p, i) => S('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 10, fill: '#5d6575' }, p.date.slice(5).replace('-', '/'))),
      subjects.map((s, i) => line((p) => p.bySub[s], COLORS[i % COLORS.length], 1.6, '4 3')),
      line((p) => p.total, '#161b26', 2.6),
      pts.map((p, i) => (p.total == null ? null : S('circle', { cx: x(i), cy: y(p.total), r: 3.2, fill: '#161b26' })))),
    h('div.legend', h('span', h('i', { style: 'background:#161b26;height:3px' }), '종합'),
      subjects.map((s, i) => h('span', h('i', { style: `background:${COLORS[i % COLORS.length]}` }), s))));
}

function delta(now, prev) {
  if (now == null || prev == null) return h('span', { style: 'color:#9aa3b5' }, '-');
  const d = Math.round(now - prev);
  return h('span.' + (d > 0 ? 'up' : d < 0 ? 'down' : ''), d > 0 ? `▲ ${d}` : d < 0 ? `▼ ${-d}` : '–');
}

function sheet(r) {
  const s = r.student;
  const subjects = r.subjects;
  const node = h('section.sheet',
    h('div.head',
      h('div', h('div.academy', r.academy.name), h('h1', '학습 성취 리포트')),
      h('div.period', h('span.badge', `${r.period.typeLabel} 리포트`), h('b', r.period.label))),
    h('div.info',
      h('div', h('span', '이름'), h('b', s.name)),
      h('div', h('span', '학년'), h('b', s.schoolGrade || '-')),
      h('div', h('span', '반'), h('b', s.className || '-')),
      h('div', h('span', '기간 내 수업'), h('b', `${r.sessionCount}회`)),
      h('div', h('span', '비교 기준'), h('b', r.groupLabel))));

  if (r.total == null) {
    node.append(h('div.empty', '이 기간에 입력된 기록이 없습니다.'));
    return node;
  }

  // 1. 종합
  node.append(h('div.sec',
    h('div.sec-title', '종합 평가'),
    h('div.summary',
      ring(r.total, r.grade),
      h('div.stat-box', h('div.k', `${r.groupLabel} 평균과 비교`),
        h('div.v', Math.round(r.total), h('small', ` / 평균 ${r.groupAvg == null ? '-' : Math.round(r.groupAvg)}`)),
        h('div', { style: 'margin-top:6px' }, '지난 기간 대비 ', delta(r.total, r.prevTotal))),
      h('div.stat-box', h('div.k', `${r.groupLabel} 내 위치`),
        r.rank ? [h('div.v', `상위 ${r.rank.topPercent}%`), h('div', { style: 'margin-top:6px;color:#5d6575' }, `${r.rank.of}명 중 ${r.rank.position}등`)]
          : h('div.v', h('small', '비교 인원 부족'))))));

  // 2. 과목별 성취
  node.append(h('div.sec',
    h('div.sec-title', '과목별 성취', h('small', '▲ 회색 표시는 평균')),
    h('table.subj',
      h('thead', h('tr', h('th', '과목'), h('th', { style: 'width:42%' }, '점수'), h('th.num', '등급'), h('th.num.hide-m', '평균'), h('th.num', '위치'), h('th.num', '지난 대비'))),
      h('tbody', subjects.map((sub, i) => h('tr',
        h('td', h('b', sub.name)),
        h('td', h('div', { style: 'display:flex;align-items:center;gap:8px' },
          h('div', { style: 'flex:1;height:12px;background:#eef0f3;position:relative' },
            h('div', { style: `height:12px;width:${sub.score}%;background:${COLORS[i % COLORS.length]}` }),
            sub.avg != null ? h('div', { style: `position:absolute;top:-3px;left:calc(${sub.avg}% - 1px);width:2px;height:18px;background:#5d6575` }) : null),
          h('b', { style: 'width:30px;text-align:right' }, Math.round(sub.score)))),
        h('td.num', h('span.gl', { style: `background:${GRADE_COLOR[sub.grade.letter]}` }, sub.grade.letter)),
        h('td.num.hide-m', sub.avg == null ? '-' : Math.round(sub.avg)),
        h('td.num', sub.rank ? `상위 ${sub.rank.topPercent}%` : '-'),
        h('td.num', delta(sub.score, sub.prevScore))))))));

  // 3. 과목별 상세 (인바디 막대 + 영역 레이더)
  subjects.forEach((sub, i) => {
    const color = COLORS[i % COLORS.length];
    const items = r.items.filter((it) => it.subject === sub.name);
    node.append(h('div.sec',
      h('div.sec-title', { style: `background:${color}` }, `${sub.name} 성취 분석`, h('small', `${Math.round(sub.score)}점 · ${sub.grade.label}`)),
      h('div.subject-grid',
        ibTable(items),
        h('div.radar-box',
          h('div', { style: 'font-weight:700;color:#161b26;margin-bottom:2px' }, '영역별 균형'),
          sub.categories.length >= 3 ? radar(sub.categories, color) : catBars(sub.categories, color),
          h('div.legend', h('span', h('i', { style: `background:${color}` }), '우리 아이'), h('span', h('i', { style: 'background:#8a93a6' }), '평균'))))));
  });

  // 4. 추이
  node.append(h('div.sec.trend', h('div.sec-title', '성취 변화 추이', h('small', '최근 10회 수업')), trend(r)));

  // 5. 코멘트
  node.append(h('div.sec.two',
    h('div', h('div.sec-title', '선생님 코멘트'),
      h('div.comment-box', r.comments.length ? r.comments.map((c) => h('div', h('span.d', c.date.slice(5).replace('-', '/')), c.comment)) : h('span', { style: 'color:#9aa3b5' }, '코멘트가 없습니다.'))),
    h('div', h('div.sec-title', '강점 · 보완점'),
      h('div.comment-box',
        h('div', h('b', '잘하고 있어요'), h('div.tags', r.strengths.map((x) => h('span.tag.s', x)))),
        r.weaknesses.length ? h('div', { style: 'margin-top:10px' }, h('b', '조금 더 연습해요'), h('div.tags', r.weaknesses.map((x) => h('span.tag.w', x)))) : null))));

  node.append(h('div.foot',
    h('span', `${r.academy.name}${r.academy.phone ? ' · ☎ ' + r.academy.phone : ''}`),
    h('span', `표준 구간은 ${r.groupLabel} 원생의 평균±표준편차 기준입니다 · 발행일 ${todayKST()}`)));
  return node;
}

// 인쇄 직전: 학생 한 명 리포트가 A4 한 장을 넘으면 그만큼 축소해서 한 장에 맞춘다.
// A4(210×297mm) - 여백 10mm×2 = 190×277mm ≈ 718×1047px (96dpi)
const PRINT_W = 718, PRINT_H = 1040;
function fitSheetsForPrint() {
  document.body.classList.add('printing'); // 인쇄용 촘촘한 스타일을 화면에서도 적용한 채로 높이를 잰다
  for (const el of document.querySelectorAll('.sheet')) {
    let z = 1;
    el.style.zoom = '';
    el.style.width = PRINT_W + 'px';
    for (let i = 0; i < 4; i++) { // 축소하면 폭이 넓어져 높이가 달라지므로 몇 번 다시 잰다
      const next = Math.max(0.55, Math.min(1, PRINT_H / el.scrollHeight)); // scrollHeight 는 축소 전 높이
      if (Math.abs(next - z) < 0.005) break;
      z = next;
      el.style.width = PRINT_W / z + 'px';
    }
    el.style.zoom = z < 1 ? String(z) : '';
  }
}
function unfitSheets() {
  document.body.classList.remove('printing');
  for (const el of document.querySelectorAll('.sheet')) { el.style.zoom = ''; el.style.width = ''; }
}
window.addEventListener('beforeprint', fitSheetsForPrint);
window.addEventListener('afterprint', unfitSheets);

(async () => {
  const root = document.getElementById('root');
  const info = document.getElementById('barInfo');
  try {
    let reports;
    const m = location.pathname.match(/^\/r\/([\w-]+)/);
    const qs = new URLSearchParams(location.search);
    if (m) {
      reports = [await api('/api/public/r/' + m[1])];
    } else if (qs.get('ids') && !qs.get('ids').includes(',') && !qs.get('class')) {
      reports = [await api(`/api/academy/report/${qs.get('ids')}?${qs}`)];
    } else {
      reports = (await api('/api/academy/reports?' + qs)).reports;
    }
    if (!reports.length) {
      info.textContent = '인쇄할 리포트가 없습니다';
      root.append(h('section.sheet', h('div.empty', '선택한 기간에 기록이 있는 학생이 없습니다.')));
      return;
    }
    document.title = reports.length === 1 ? `${reports[0].student.name} · ${reports[0].period.label} 리포트` : `성적표 ${reports.length}명`;
    info.textContent = reports.length === 1 ? `${reports[0].student.name} · ${reports[0].period.label}` : `${reports.length}명 · ${reports[0].period.label} (한 장에 한 명씩 인쇄됩니다)`;
    root.append(...reports.map(sheet));
    if (qs.get('print') === '1') setTimeout(() => window.print(), 400);
  } catch (e) {
    info.textContent = '오류';
    root.append(h('section.sheet', h('div.empty', e.message)));
  }
})();
