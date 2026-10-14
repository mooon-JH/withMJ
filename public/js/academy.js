const main = document.getElementById('main');
const pages = {};
let current = 'home';

function go(page) {
  current = page;
  history.replaceState(null, '', '#' + page);
  document.querySelectorAll('#nav .nav').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  main.replaceChildren(h('div.empty', '불러오는 중…'));
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  window.scrollTo(0, 0);
  pages[page]().then(() => cardify(main)).catch((e) => main.replaceChildren(h('div.banner.bad', e.message)));
}
document.querySelectorAll('#nav .nav[data-page]').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
setupNav(go);

api('/api/auth/me').then((me) => {
  if (me.user.role !== 'academy') location.href = '/admin';
  document.getElementById('academyName').firstChild.textContent = me.academy.name;
});

function printUrl(params) {
  return '/print?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
}

// ---------------- 홈 ----------------
pages.home = async () => {
  const d = await api('/api/academy/dashboard');
  const a = d.academy;
  const banners = [];
  if (!a.canSend) banners.push(h('div.banner.bad', `서비스가 정지된 상태입니다${a.suspendReason ? ` (${a.suspendReason})` : ''}. 자동 발송이 멈춰 있어요. 문의: 운영팀`));
  if (a.trialEndsAt && a.trialEndsAt >= d.today) banners.push(h('div.banner.info', `무료 체험 중 · ${a.trialEndsAt} 까지. 이후 월 ${won(a.planPrice)} 이 청구됩니다.`));
  if (d.pendingInvoices.length) banners.push(h('div.banner.warn', `미결제 청구서 ${d.pendingInvoices.length}건 (${d.pendingInvoices.map((i) => `${i.billing_date} ${won(i.amount)}`).join(', ')})`));
  const viewRate = d.sentThisMonth ? Math.round((d.viewedThisMonth / d.sentThisMonth) * 100) : 0;
  main.replaceChildren(
    h('div.page-head', h('h2', '오늘의 학원'), h('span.muted', d.today)),
    ...banners,
    installCard(),
    h('div.kpis',
      kpi('재원생', d.students + '명'),
      kpi('오늘 입력 완료', d.todayCompleted + '명'),
      kpi('이번 달 발송', d.sentThisMonth + '건'),
      kpi('학부모 열람률', viewRate + '%', `${d.viewedThisMonth}건 열람`)),
    h('div.card',
      h('h3', '사용 방법'),
      h('ol', { style: 'line-height:2;margin:8px 0 0;padding-left:20px' },
        h('li', '「평가 항목」에서 과목·영역·항목을 우리 학원에 맞게 고칩니다. (처음 한 번)'),
        h('li', '「학생 관리」에서 학생과 학부모 연락처, 발송 주기(일간/주간/월간/분기)를 등록합니다.'),
        h('li', '수업이 끝나면 「성적 입력」에서 점수를 넣고 ', h('b', '완료'), '를 누릅니다.'),
        h('li', `매일 ${a.sendHour}시, 주기가 끝난 학생의 학부모님께 리포트가 카톡으로 자동 발송됩니다.`),
        h('li', '상담·게시용 종이 성적표는 「리포트 · 인쇄」에서 반 단위로 한 번에 뽑습니다.')),
      h('div.toolbar', { style: 'margin-top:12px' },
        h('button.primary', { onclick: () => go('entry') }, '성적 입력하러 가기'),
        h('button', { onclick: () => go('print') }, '성적표 인쇄'))));
};

function kpi(k, v, s) {
  return h('div.kpi', h('div.k', k), h('div.v', v), s ? h('div.s', s) : null);
}

// ---------------- 성적 입력 ----------------
const entryState = { date: todayKST(), cls: '', subject: '' };
pages.entry = async () => {
  const q = new URLSearchParams({ date: entryState.date, class: entryState.cls, subject: entryState.subject });
  const d = await api('/api/academy/grid?' + q);
  if (!d.metrics.length && !entryState.subject) {
    main.replaceChildren(h('div.page-head', h('h2', '성적 입력')), h('div.empty', '평가 항목이 없습니다. 「평가 항목」에서 먼저 추가해 주세요.'));
    return;
  }
  const dateIn = h('input', { type: 'date', value: d.date, onchange: (e) => { entryState.date = e.target.value; go('entry'); } });
  const clsSel = h('select', { onchange: (e) => { entryState.cls = e.target.value; go('entry'); } },
    h('option', { value: '' }, '전체 반'), d.classes.map((c) => h('option', { value: c, selected: c === entryState.cls }, c)));
  const subSel = h('select', { onchange: (e) => { entryState.subject = e.target.value; go('entry'); } },
    h('option', { value: '' }, '전체 과목'), d.subjects.map((c) => h('option', { value: c, selected: c === entryState.subject }, c)));

  // 과목별 머리글 (과목 > 항목 2단)
  const bySubj = [];
  for (const m of d.metrics) {
    const last = bySubj[bySubj.length - 1];
    if (last && last.subject === m.subject) last.items.push(m);
    else bySubj.push({ subject: m.subject, items: [m] });
  }
  const head1 = h('tr', h('th', { rowSpan: 2 }, '학생'), bySubj.map((g) => h('th.subj', { colSpan: g.items.length }, g.subject)),
    h('th', { rowSpan: 2 }, '선생님 코멘트'), h('th', { rowSpan: 2 }, '상태'));
  const head2 = h('tr', d.metrics.map((m) => h('th.num', { title: `${m.category} · ${m.min_value}~${m.max_value}${m.unit}` }, m.name)));

  const inputs = [];
  const body = d.rows.map((row, ri) => h('tr',
    h('td', h('b', row.student.name), h('div.muted', { style: 'font-size:12px' }, row.student.class_name || '')),
    d.metrics.map((m, ci) => {
      const inp = h('input', {
        type: 'number', step: 'any', min: m.min_value, max: m.max_value, value: row.values[m.id] ?? '',
        'data-sid': row.student.id, 'data-mid': m.id, placeholder: '-',
        onkeydown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); (inputs[ri + 1]?.[ci] || inputs[0]?.[ci + 1])?.focus(); }
        },
      });
      (inputs[ri] ||= [])[ci] = inp;
      return h('td.num', inp);
    }),
    h('td', h('input.comment', { value: row.comment, 'data-sid': row.student.id, 'data-comment': 1, placeholder: '오늘 한 줄 코멘트' })),
    h('td', row.status === 'completed' ? h('span.pill.ok', '완료') : row.status === 'draft' ? h('span.pill.warn', '임시') : h('span.pill', '미입력'))));

  const table = h('table.entry', h('thead', head1, head2), h('tbody', body));
  const collect = (root) => {
    const rows = new Map();
    root.querySelectorAll('input[data-sid]').forEach((el) => {
      const sid = Number(el.dataset.sid);
      const r = rows.get(sid) || { studentId: sid, values: {}, comment: '' };
      if (el.dataset.comment) r.comment = el.value.trim();
      else if (el.value !== '') r.values[el.dataset.mid] = el.value;
      rows.set(sid, r);
    });
    return [...rows.values()];
  };
  const save = async (complete) => {
    const r = await run(() => api('/api/academy/grid', {
      method: 'POST', body: { date: entryState.date, complete, rows: collect(main), metricIds: d.metrics.map((m) => m.id) },
    }));
    toast(complete ? `${r.saved}명 완료 처리! 발송 주기에 맞춰 학부모님께 자동 발송됩니다.` : `${r.saved}명 임시 저장`);
    go('entry');
  };

  const head = h('div.page-head.entry-head', h('h2', '성적 입력'), dateIn, clsSel, subSel);
  const actions = h('div.toolbar.save-bar',
    h('button', { onclick: () => save(false) }, '임시 저장'),
    h('button.primary', { onclick: () => save(true) }, '완료 (발송 대상 등록)'));
  if (!d.rows.length) {
    main.replaceChildren(head, h('div.empty', '학생이 없습니다. 「학생 관리」에서 추가해 주세요.'));
    return;
  }

  if (isMobile()) {
    // 휴대폰: 학생 한 명당 카드 하나, 숫자 키패드로 입력. '다음'을 누르면 다음 칸으로
    const statusPill = (st) => (st === 'completed' ? h('span.pill.ok', '완료') : st === 'draft' ? h('span.pill.warn', '임시') : h('span.pill', '미입력'));
    const cards = d.rows.map((row) => h('div.card.student-entry',
      h('div.se-head', h('b', row.student.name), h('span.muted', row.student.class_name || ''), h('span', { style: 'flex:1' }), statusPill(row.status)),
      bySubj.map((g) => h('div.se-subject',
        h('div.se-subj-name', g.subject),
        h('div.se-grid', g.items.map((m) => h('label.se-field',
          h('span', m.name),
          h('input', { type: 'number', inputmode: 'decimal', enterkeyhint: 'next', step: 'any', min: m.min_value, max: m.max_value,
            value: row.values[m.id] ?? '', placeholder: `${m.min_value}~${m.max_value}`, 'data-sid': row.student.id, 'data-mid': m.id })))))),
      h('input.se-comment', { value: row.comment, 'data-sid': row.student.id, 'data-comment': 1, placeholder: '오늘 한 줄 코멘트', enterkeyhint: 'next' })));
    const list = h('div.entry-cards', cards);
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      const all = [...list.querySelectorAll('input')];
      const next = all[all.indexOf(e.target) + 1];
      if (next) { next.focus(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else e.target.blur();
    });
    main.replaceChildren(head, h('p.muted.entry-hint', '빈칸은 미입력(결석 등). 키보드의 「다음」으로 다음 칸으로 넘어가요.'), list, actions);
    return;
  }

  main.replaceChildren(
    head,
    h('p.muted', { style: 'margin-top:-8px' }, '빈칸은 미입력(결석 등)으로 처리됩니다. Enter 키로 아래 학생으로 이동해요. 과목을 고르면 그 과목 점수만 저장돼요.'),
    h('div.card', { style: 'padding:0' }, h('div.table-wrap', table)),
    actions);
  inputs[0]?.[0]?.focus();
};

// ---------------- 학생 관리 ----------------
pages.students = async () => {
  const list = await api('/api/academy/students');
  const rows = list.map((s) => h('tr',
    h('td', h('b', s.name), s.memo ? h('div.muted', { style: 'font-size:12px' }, s.memo) : null),
    h('td', s.school_grade || '-'), h('td', s.class_name || '-'),
    h('td', s.parent_name || '-', h('div.muted', { style: 'font-size:12px' }, s.parent_phone || '연락처 없음')),
    h('td', s.send_enabled ? h('span.pill.brand', FREQ[s.frequency]) : h('span.pill', '발송 안 함')),
    h('td', s.last_date || '-'),
    h('td', h('div.toolbar',
      h('button.small', { onclick: () => window.open(printUrl({ ids: s.id, type: 'monthly' }), '_blank') }, '리포트'),
      h('button.small', { onclick: () => sendNow(s) }, '지금 발송'),
      h('button.small', { onclick: () => editStudent(s) }, '수정')))));
  main.replaceChildren(
    h('div.page-head', h('h2', `학생 관리 (${list.length}명)`), h('button.primary', { onclick: () => editStudent() }, '+ 학생 추가')),
    list.length
      ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
        h('thead', h('tr', ['이름', '학년', '반', '학부모', '발송 주기', '최근 기록', ''].map((x) => h('th', x)))), h('tbody', rows))))
      : h('div.empty', '등록된 학생이 없습니다.'));
};

function editStudent(s = {}) {
  const form = h('form.form-grid',
    field('이름 *', h('input', { name: 'name', value: s.name || '', required: true })),
    field('학년', h('input', { name: 'school_grade', value: s.school_grade || '', placeholder: '중2' })),
    field('반', h('input', { name: 'class_name', value: s.class_name || '', placeholder: '중2A' })),
    field('학부모 이름', h('input', { name: 'parent_name', value: s.parent_name || '' })),
    field('학부모 휴대폰 *', h('input', { name: 'parent_phone', value: s.parent_phone || '', placeholder: '010-1234-5678' }), '이 번호로 카톡이 갑니다'),
    field('발송 주기', h('select', { name: 'frequency' }, Object.entries(FREQ).filter(([k]) => k !== 'manual')
      .map(([k, v]) => h('option', { value: k, selected: (s.frequency || 'weekly') === k }, v)))),
    h('label.check', h('input', { type: 'checkbox', name: 'send_enabled', checked: s.id ? !!s.send_enabled : true }), '카톡 자동 발송'),
    field('메모', h('input', { name: 'memo', value: s.memo || '' })));
  const actions = [{ label: '저장', primary: true, onClick: async () => {
    const body = formData(form);
    await run(() => (s.id ? api('/api/academy/students/' + s.id, { method: 'PUT', body }) : api('/api/academy/students', { method: 'POST', body })), '저장했습니다');
    go('students');
  } }];
  if (s.id) actions.unshift({ label: '삭제', danger: true, onClick: async () => {
    if (!confirm(`${s.name} 학생을 삭제할까요? (기록은 보존됩니다)`)) return false;
    await run(() => api('/api/academy/students/' + s.id, { method: 'DELETE' }), '삭제했습니다');
    go('students');
  } });
  openModal(s.id ? '학생 수정' : '학생 추가', form, actions);
}

function sendNow(s) {
  const end = h('input', { type: 'date', value: todayKST() });
  const start = h('input', { type: 'date', value: new Date(Date.now() + 9 * 3600e3 - 29 * 86400e3).toISOString().slice(0, 10) });
  openModal(`${s.name} 리포트 지금 발송`, h('div.grid',
    h('p.muted', { style: 'margin:0' }, `${s.parent_phone || '(연락처 없음)'} 으로 아래 기간의 리포트를 카톡으로 보냅니다.`),
    h('div.form-grid', field('시작일', start), field('종료일', end))), [
    { label: '미리보기', onClick: () => { window.open(printUrl({ ids: s.id, start: start.value, end: end.value }), '_blank'); return false; } },
    { label: '발송', primary: true, onClick: () => run(() => api('/api/academy/send/' + s.id, {
      method: 'POST', body: { start: start.value, end: end.value },
    }), '발송했습니다') },
  ]);
}

// ---------------- 리포트 · 인쇄 ----------------
pages.print = async () => {
  const [students, grid] = await Promise.all([api('/api/academy/students'), api('/api/academy/grid')]);
  const type = h('select', ['weekly', 'monthly', 'quarterly', 'manual'].map((k) =>
    h('option', { value: k, selected: k === 'monthly' }, k === 'manual' ? '직접 기간 지정' : FREQ[k] + ' 리포트')));
  const end = h('input', { type: 'date', value: todayKST() });
  const start = h('input', { type: 'date', value: todayKST().slice(0, 8) + '01' });
  const startField = field('시작일', start);
  const syncType = () => { startField.style.display = type.value === 'manual' ? '' : 'none'; };
  type.addEventListener('change', syncType);
  syncType();
  const cls = h('select', h('option', { value: '' }, '전체 반'), grid.classes.map((c) => h('option', { value: c }, c)));
  const autoPrint = h('input', { type: 'checkbox', checked: true });
  const picks = new Set();
  const pickList = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow:auto' },
    students.map((s) => h('label.pill', { style: 'cursor:pointer' },
      h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? picks.add(s.id) : picks.delete(s.id)) }),
      ` ${s.name}`, s.class_name ? h('span.muted', ` ${s.class_name}`) : null)));

  const open = () => {
    const params = { type: type.value, end: end.value, start: type.value === 'manual' ? start.value : '', print: autoPrint.checked ? 1 : '' };
    if (picks.size) params.ids = [...picks].join(',');
    else params.class = cls.value;
    window.open(printUrl(params), '_blank');
  };

  main.replaceChildren(
    h('div.page-head', h('h2', '리포트 · 인쇄')),
    h('div.card',
      h('h3', '성적표 일괄 인쇄'),
      h('p.muted', '반 전체(또는 고른 학생)의 성적표를 A4 한 장씩 이어서 인쇄합니다. 학원 프린터로 바로 뽑거나, 인쇄 창에서 「PDF로 저장」을 고르면 파일로도 저장돼요.'),
      h('div.form-grid', field('종류', type), field('기준일 (이 날이 포함된 기간)', end), startField, field('반', cls)),
      h('div', { style: 'margin-top:14px' }, h('div.field', h('span', '또는 학생 직접 선택 (선택하면 반 설정은 무시)'), pickList)),
      h('div.toolbar', { style: 'margin-top:16px' },
        h('label.check', autoPrint, '열리면 바로 인쇄 창 띄우기'),
        h('span', { style: 'flex:1' }),
        h('button.primary', { onclick: open }, '🖨  인쇄 화면 열기'))),
    h('div.card',
      h('h3', '인쇄 팁'),
      h('ul.muted', { style: 'margin:8px 0 0;line-height:1.9' },
        h('li', '용지: A4 세로 · 여백: 기본 · 「배경 그래픽」 체크하면 색이 그대로 나옵니다.'),
        h('li', '흑백 프린터여도 표준 구간이 무늬로 구분되도록 만들어 두었어요.'),
        h('li', '기록이 없는 학생은 자동으로 빠집니다.'))));
};

// ---------------- 발송 내역 ----------------
pages.sends = async () => {
  const list = await api('/api/academy/sends');
  const st = { sent: h('span.pill.ok', '발송'), failed: h('span.pill.bad', '실패'), queued: h('span.pill.warn', '대기') };
  main.replaceChildren(
    h('div.page-head', h('h2', '발송 내역')),
    list.length ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
      h('thead', h('tr', ['학생', '종류', '기간', '받는 번호', '상태', '발송 시각', '열람', ''].map((x) => h('th', x)))),
      h('tbody', list.map((r) => h('tr',
        h('td', r.student_name), h('td', FREQ[r.period_type]), h('td', `${r.period_start} ~ ${r.period_end}`), h('td', r.to_phone),
        h('td', st[r.status].cloneNode(true), r.error ? h('div.muted', { style: 'font-size:12px' }, r.error) : null),
        h('td', r.sent_at || '-'),
        h('td', r.viewed_at ? h('span.pill.ok', '열람함') : h('span.pill', '안 읽음')),
        h('td', h('a', { href: '/r/' + r.token, target: '_blank' }, '보기')))))))) : h('div.empty', '아직 발송한 리포트가 없습니다.'));
};

// ---------------- 평가 항목 ----------------
pages.metrics = async () => {
  const list = await api('/api/academy/metrics');
  const subjects = [...new Set(list.map((m) => m.subject))];
  main.replaceChildren(
    h('div.page-head', h('h2', '평가 항목'), h('button.primary', { onclick: () => editMetric() }, '+ 항목 추가')),
    h('p.muted', { style: 'margin-top:-8px' }, '과목 > 영역 > 항목 3단 구조입니다. 예) 수학 > 연산 > 연산 정확도. 리포트에서 과목별로 따로 점수·등급이 나와요.'),
    subjects.length ? subjects.map((sub) => h('div.card',
      h('h3', sub),
      h('div.table-wrap', h('table',
        h('thead', h('tr', ['영역', '항목', '범위', '표준 구간', '방향', ''].map((x) => h('th', x)))),
        h('tbody', list.filter((m) => m.subject === sub).map((m) => h('tr',
          h('td', m.category), h('td', h('b', m.name)),
          h('td', `${m.min_value} ~ ${m.max_value}${m.unit}`),
          h('td', m.std_low != null && m.std_high != null ? `${m.std_low} ~ ${m.std_high}` : h('span.muted', '자동(원생 평균 ± 표준편차)')),
          h('td', m.higher_is_better ? '높을수록 좋음' : '낮을수록 좋음'),
          h('td', h('button.small', { onclick: () => editMetric(m) }, '수정'))))))))) : h('div.empty', '항목이 없습니다.'));
};

function editMetric(m = {}) {
  const form = h('form.form-grid',
    field('과목 *', h('input', { name: 'subject', value: m.subject || '', placeholder: '수학', required: true })),
    field('영역 *', h('input', { name: 'category', value: m.category || '', placeholder: '연산' })),
    field('항목 이름 *', h('input', { name: 'name', value: m.name || '', placeholder: '연산 정확도' })),
    field('단위', h('input', { name: 'unit', value: m.unit || '점' })),
    field('최소값', h('input', { name: 'min_value', type: 'number', value: m.min_value ?? 0 })),
    field('최대값', h('input', { name: 'max_value', type: 'number', value: m.max_value ?? 100 })),
    field('표준 하한', h('input', { name: 'std_low', type: 'number', value: m.std_low ?? '' }), '비우면 원생 평균으로 자동'),
    field('표준 상한', h('input', { name: 'std_high', type: 'number', value: m.std_high ?? '' })),
    field('정렬 순서', h('input', { name: 'sort', type: 'number', value: m.sort ?? 0 })),
    h('label.check', h('input', { type: 'checkbox', name: 'higher_is_better', checked: m.id ? !!m.higher_is_better : true }), '높을수록 좋음 (지각 횟수 같은 건 해제)'));
  const actions = [{ label: '저장', primary: true, onClick: async () => {
    const body = formData(form);
    await run(() => (m.id ? api('/api/academy/metrics/' + m.id, { method: 'PUT', body }) : api('/api/academy/metrics', { method: 'POST', body })), '저장했습니다');
    go('metrics');
  } }];
  if (m.id) actions.unshift({ label: '삭제', danger: true, onClick: async () => {
    if (!confirm(`'${m.name}' 항목을 삭제할까요? 지난 기록은 리포트에서 빠집니다.`)) return false;
    await run(() => api('/api/academy/metrics/' + m.id, { method: 'DELETE' }), '삭제했습니다');
    go('metrics');
  } });
  openModal(m.id ? '항목 수정' : '항목 추가', form, actions);
}

// ---------------- 설정 ----------------
pages.settings = async () => {
  const s = await api('/api/academy/settings');
  const form = h('form.form-grid',
    field('학원명', h('input', { name: 'name', value: s.name })),
    field('원장님 성함', h('input', { name: 'owner_name', value: s.owner_name || '' })),
    field('학원 전화', h('input', { name: 'phone', value: s.phone || '' }), '리포트 하단에 표시됩니다'),
    field('카톡 발송 시각', h('select', { name: 'send_hour' }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: i === s.send_hour }, `${i}시`)))),
    field('주간 리포트 마감 요일', h('select', { name: 'weekly_end_dow' }, DOW.map((d, i) => h('option', { value: i, selected: i === s.weekly_end_dow }, d + '요일')))));
  const pw = h('form.form-grid',
    field('현재 비밀번호', h('input', { name: 'current', type: 'password' })),
    field('새 비밀번호 (8자 이상)', h('input', { name: 'next', type: 'password' })));
  main.replaceChildren(
    h('div.page-head', h('h2', '설정')),
    h('div.card', form, h('div.toolbar', { style: 'margin-top:14px;justify-content:flex-end' },
      h('button.primary', { onclick: () => run(() => api('/api/academy/settings', { method: 'PUT', body: formData(form) }), '저장했습니다') }, '저장'))),
    h('div.card', h('h3', { style: 'margin-bottom:12px' }, '비밀번호 변경'), pw, h('div.toolbar', { style: 'margin-top:14px;justify-content:flex-end' },
      h('button', { onclick: () => run(() => api('/api/academy/password', { method: 'PUT', body: formData(pw) }), '변경했습니다') }, '변경'))));
};

window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p in pages) go(p); });
go(location.hash.slice(1) in pages ? location.hash.slice(1) : 'home');
