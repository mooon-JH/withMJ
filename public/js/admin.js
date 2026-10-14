const main = document.getElementById('main');
const pages = {};

function go(page) {
  history.replaceState(null, '', '#' + page);
  document.querySelectorAll('#nav .nav').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  main.replaceChildren(h('div.empty', '불러오는 중…'));
  document.querySelectorAll('.modal-back').forEach((m) => m.remove());
  window.scrollTo(0, 0);
  pages[page]().then(() => cardify(main)).catch((e) => main.replaceChildren(h('div.banner.bad', e.message)));
}
document.querySelectorAll('#nav .nav[data-page]').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
setupNav(go);
api('/api/auth/me').then((me) => { if (me.user.role !== 'superadmin') location.href = '/academy'; });

const kpi = (k, v, s) => h('div.kpi', h('div.k', k), h('div.v', v), s ? h('div.s', s) : null);
const LEAD = { new: '미연락', called: '통화함', interested: '관심', demo: '시연예정', won: '계약', lost: '거절', hold: '보류' };
const LEAD_PILL = { new: '', called: 'brand', interested: 'warn', demo: 'warn', won: 'ok', lost: 'bad', hold: '' };

// ---------------- 대시보드 ----------------
pages.home = async () => {
  const s = await api('/api/admin/stats');
  const leadCount = Object.fromEntries(s.leads.map((x) => [x.status, x.n]));
  const totalLeads = s.leads.reduce((a, b) => a + b.n, 0);
  main.replaceChildren(
    h('div.page-head', h('h2', '운영 대시보드'), h('span.muted', s.today),
      h('button', { onclick: () => run(() => api('/api/admin/dispatch/run', { method: 'POST', body: {} }), '발송 작업 실행 완료').then(() => go('home')) }, '발송 작업 지금 실행'),
      h('button', { onclick: () => run(() => api('/api/admin/billing/run', { method: 'POST', body: {} })).then((r) => { toast(`청구서 ${r.created.length}건 발행`); go('home'); }) }, '정산 지금 실행')),
    installCard(),
    h('div.kpis',
      kpi('월 반복 매출 (MRR)', won(s.mrr), `유료 ${s.payingAcademies}곳`),
      kpi('이번 달 입금', won(s.collectedThisMonth)),
      kpi('미수금', won(s.unpaid.amount), `${s.unpaid.n}건`),
      kpi('체험 중', s.trialAcademies + '곳'),
      kpi('정지/OFF', s.suspended + '곳'),
      kpi('이번 달 알림톡', s.messagesThisMonth + '건', `추정 원가 ${won(s.messageCostEstimate)}`)),
    h('div.card',
      h('h3', `영업 파이프라인 (리드 ${totalLeads}곳)`),
      h('div.kanban', { style: 'margin-top:10px' }, Object.entries(LEAD).map(([k, v]) =>
        h('span.pill.' + (LEAD_PILL[k] || 'x'), { style: 'font-size:13px;padding:6px 12px' }, `${v} ${leadCount[k] || 0}`))),
      h('p.muted', { style: 'margin:12px 0 0' }, `목표 예시: 2명이 월 300만원씩 → 학원 200곳 × 3만원 = 600만원. 지금 ${s.payingAcademies}곳 (${Math.round((s.payingAcademies / 200) * 100)}%)`)));
};

// ---------------- 학원 ----------------
pages.academies = async () => {
  const list = await api('/api/admin/academies');
  const today = todayKST();
  const statusPill = (a) => {
    if (a.status === 'cancelled') return h('span.pill', '해지');
    if (a.status === 'suspended') return h('span.pill.bad', `정지(${a.suspend_reason || ''})`);
    if (a.trial_ends_at && a.trial_ends_at >= today) return h('span.pill.brand', `체험 ~${a.trial_ends_at.slice(5)}`);
    return h('span.pill.ok', '이용 중');
  };
  main.replaceChildren(
    h('div.page-head', h('h2', `학원 (${list.length})`), h('button.primary', { onclick: () => newAcademy() }, '+ 학원 계정 발급')),
    list.length ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
      h('thead', h('tr', ['서비스', '학원', '로그인', '학생', '상태', '다음 결제일', '결제수단', '최근 발송', ''].map((x) => h('th', x)))),
      h('tbody', list.map((a) => h('tr',
        h('td', h('label.switch', { title: '서비스 ON/OFF' },
          h('input', { type: 'checkbox', checked: !!a.service_enabled, onchange: (e) => run(() => api(`/api/admin/academies/${a.id}/toggle`, { method: 'POST', body: { enabled: e.target.checked } }), e.target.checked ? `${a.name} 서비스 ON` : `${a.name} 서비스 OFF`) }),
          h('span'))),
        h('td', h('b', a.name), h('div.muted', { style: 'font-size:12px' }, [a.region, a.owner_name, a.phone].filter(Boolean).join(' · '))),
        h('td', a.login_email),
        h('td.num', a.student_count),
        h('td', statusPill(a), a.pending_invoices ? h('div', h('span.pill.warn', `미납 ${a.pending_invoices}`)) : null),
        h('td', a.next_billing_date || '-', h('div.muted', { style: 'font-size:12px' }, won(a.plan_price) + '/월')),
        h('td', a.has_billing_key ? h('span.pill.ok', '카드 자동') : h('span.pill', '계좌이체')),
        h('td', a.last_sent_at ? a.last_sent_at.slice(0, 10) : '-'),
        h('td', h('button.small', { onclick: () => editAcademy(a) }, '관리')))))))) : h('div.empty', '아직 학원이 없습니다. 영업 리스트에서 계약한 곳을 전환하세요.'));
};

function newAcademy(lead = {}) {
  const form = h('form.form-grid',
    field('학원명 *', h('input', { name: 'name', value: lead.name || '' })),
    field('원장님 성함', h('input', { name: 'owner_name' })),
    field('학원 전화', h('input', { name: 'phone', value: lead.phone || '' })),
    field('지역', h('input', { name: 'region', value: lead.region || '' })),
    field('로그인 이메일 *', h('input', { name: 'email', type: 'email' })),
    field('초기 비밀번호 *', h('input', { name: 'password', value: Math.random().toString(36).slice(2, 10) }), '원장님께 전달 후 변경 안내'),
    field('월 요금', h('input', { name: 'plan_price', type: 'number', value: 30000 })),
    h('label.check', h('input', { type: 'checkbox', name: 'skipTrial' }), '무료 체험 없이 바로 과금'));
  openModal(lead.id ? `계약 전환: ${lead.name}` : '학원 계정 발급', form, [{ label: '발급', primary: true, onClick: async () => {
    const body = { ...formData(form), lead_id: lead.id || null };
    await run(() => api('/api/admin/academies', { method: 'POST', body }), '학원 계정을 만들었습니다 (기본 평가 항목 포함)');
    go('academies');
  } }]);
}

function editAcademy(a) {
  const form = h('form.form-grid',
    field('학원명', h('input', { name: 'name', value: a.name })),
    field('원장님', h('input', { name: 'owner_name', value: a.owner_name || '' })),
    field('전화', h('input', { name: 'phone', value: a.phone || '' })),
    field('지역', h('input', { name: 'region', value: a.region || '' })),
    field('월 요금', h('input', { name: 'plan_price', type: 'number', value: a.plan_price })),
    field('다음 결제일', h('input', { name: 'next_billing_date', type: 'date', value: a.next_billing_date || '' })),
    field('카드 빌링키', h('input', { name: 'billing_key', placeholder: a.has_billing_key ? '(등록됨 — 바꿀 때만 입력)' : '토스 빌링키' }), '비우면 기존 값 유지'));
  const pw = h('input', { placeholder: '새 비밀번호 (8자+)' });
  openModal(`${a.name} 관리`, h('div.grid', form,
    h('div.toolbar',
      a.status !== 'active' ? h('button', { onclick: () => setStatus(a, 'active') }, '이용 재개') : h('button.danger', { onclick: () => setStatus(a, 'suspended') }, '정지'),
      a.status !== 'cancelled' ? h('button.danger', { onclick: () => confirm('해지 처리할까요? 결제·발송이 모두 멈춥니다.') && setStatus(a, 'cancelled') }, '해지') : null,
      h('span', { style: 'flex:1' }), pw,
      h('button', { onclick: () => run(() => api(`/api/admin/academies/${a.id}/reset-password`, { method: 'POST', body: { password: pw.value } }), '비밀번호 변경') }, '비번 재설정'))), [
    { label: '저장', primary: true, onClick: async () => {
      const body = formData(form);
      if (!body.billing_key) delete body.billing_key;
      await run(() => api('/api/admin/academies/' + a.id, { method: 'PUT', body }), '저장했습니다');
      go('academies');
    } },
  ]);
}

async function setStatus(a, status) {
  await run(() => api(`/api/admin/academies/${a.id}/status`, { method: 'POST', body: { status } }), '상태를 바꿨습니다');
  document.querySelector('.modal-back')?.remove();
  go('academies');
}

// ---------------- 정산 ----------------
let invoiceFilter = 'pending';
pages.billing = async () => {
  const list = await api('/api/admin/invoices?status=' + invoiceFilter);
  const st = { pending: h('span.pill.warn', '미결제'), paid: h('span.pill.ok', '결제완료'), failed: h('span.pill.bad', '실패'), void: h('span.pill', '취소') };
  const sel = h('select', { onchange: (e) => { invoiceFilter = e.target.value; go('billing'); } },
    [['pending', '미결제'], ['paid', '결제완료'], ['', '전체']].map(([v, l]) => h('option', { value: v, selected: v === invoiceFilter }, l)));
  main.replaceChildren(
    h('div.page-head', h('h2', '정산 · 결제'), sel,
      h('button', { onclick: () => run(() => api('/api/admin/billing/run', { method: 'POST', body: {} })).then((r) => { toast(`청구서 ${r.created.length}건 발행`); go('billing'); }) }, '오늘 정산 실행')),
    h('div.banner.info', '결제일이 되면 청구서가 자동 발행되고, 카드(빌링키) 등록 학원은 자동 결제됩니다. 계좌이체 학원은 입금 확인 후 「입금 확인」을 누르세요. 미납 7일이 지나면 서비스가 자동 정지되고, 입금 확인 시 자동 재개됩니다.'),
    list.length ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
      h('thead', h('tr', ['청구일', '학원', '금액', '상태', '결제', ''].map((x) => h('th', x)))),
      h('tbody', list.map((i) => h('tr',
        h('td', i.billing_date), h('td', h('b', i.academy_name), h('div.muted', { style: 'font-size:12px' }, i.academy_phone || '')),
        h('td.num', won(i.amount)),
        h('td', st[i.status].cloneNode(true), i.error ? h('div.muted', { style: 'font-size:12px' }, i.error) : null),
        h('td', i.paid_at ? `${i.paid_at} (${{ card: '카드', transfer: '계좌', manual: '수동' }[i.method] || i.method})` : '-'),
        h('td', i.status === 'pending' ? h('div.toolbar',
          h('button.small.primary', { onclick: () => run(() => api(`/api/admin/invoices/${i.id}/paid`, { method: 'POST', body: { method: 'transfer' } }), '입금 확인 처리').then(() => go('billing')) }, '입금 확인'),
          h('button.small', { onclick: () => confirm('이 청구서를 취소할까요?') && run(() => api(`/api/admin/invoices/${i.id}/void`, { method: 'POST', body: {} }), '취소').then(() => go('billing')) }, '취소')) : null)))))))
      : h('div.empty', '해당하는 청구서가 없습니다.'));
};

// ---------------- 영업 리스트 ----------------
const leadFilter = { status: '', region: '', q: '', noWebsite: '' };
pages.leads = async () => {
  const d = await api('/api/admin/leads?' + new URLSearchParams(leadFilter));
  const statusSel = h('select', { onchange: (e) => { leadFilter.status = e.target.value; go('leads'); } },
    h('option', { value: '' }, '전체 상태'), Object.entries(d.statuses).map(([k, v]) => h('option', { value: k, selected: k === leadFilter.status }, v)));
  const regionSel = h('select', { onchange: (e) => { leadFilter.region = e.target.value; go('leads'); } },
    h('option', { value: '' }, '전체 지역'), d.regions.map((r) => h('option', { value: r, selected: r === leadFilter.region }, r)));
  const q = h('input', { placeholder: '이름/주소 검색', value: leadFilter.q, onchange: (e) => { leadFilter.q = e.target.value; go('leads'); } });
  const noWeb = h('label.check', h('input', { type: 'checkbox', checked: !!leadFilter.noWebsite, onchange: (e) => { leadFilter.noWebsite = e.target.checked ? '1' : ''; go('leads'); } }), '홈페이지 없는 곳만');

  main.replaceChildren(
    h('div.page-head', h('h2', `영업 리스트 (${d.rows.length})`),
      h('button', { onclick: naverModal }, '네이버에서 수집'),
      h('button', { onclick: csvModal }, 'CSV 가져오기'),
      h('a.btn', { href: '/api/admin/leads.csv' }, 'CSV 내보내기'),
      h('button.primary', { onclick: () => editLead() }, '+ 직접 추가')),
    h('div.toolbar', { style: 'margin-bottom:12px' }, statusSel, regionSel, q, noWeb),
    d.rows.length ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
      h('thead', h('tr', ['학원', '전화', '지역/주소', '상태', '통화', '다음 액션', '최근 메모', ''].map((x) => h('th', x)))),
      h('tbody', d.rows.map((l) => h('tr',
        h('td', h('b', l.name), h('div', { style: 'font-size:12px' }, l.link ? h('a', { href: l.link, target: '_blank' }, '홈페이지') : h('span.pill.warn', '홈페이지 없음'), ' ', h('span.muted', l.category || ''))),
        h('td', l.phone ? h('a', { href: 'tel:' + l.phone }, l.phone) : h('span.muted', '-')),
        h('td', h('div', l.region), h('div.muted', { style: 'font-size:12px' }, l.address)),
        h('td', h('span.pill.' + (LEAD_PILL[l.status] || 'x'), d.statuses[l.status])),
        h('td.num', l.call_count),
        h('td', l.next_action_date ? h('span' + (l.next_action_date <= todayKST() ? '.pill.bad' : ''), l.next_action_date) : '-'),
        h('td', { style: 'max-width:240px;font-size:12px' }, (l.notes || '').split('\n')[0]),
        h('td', h('div.toolbar',
          h('button.small.primary', { onclick: () => callLog(l, d.statuses) }, '통화 기록'),
          h('button.small', { onclick: () => editLead(l, d.statuses) }, '수정'),
          l.status !== 'won' ? h('button.small', { onclick: () => newAcademy(l) }, '계약 전환') : null)))))))) : h('div.empty', '리드가 없습니다. 네이버 수집이나 CSV로 채워 보세요.'),
    h('div.card', { style: 'margin-top:16px' },
      h('h3', '영업 콜 스크립트 (30초 버전)'),
      h('ol', { style: 'line-height:1.9;margin:8px 0 0;padding-left:20px' },
        h('li', '"원장님, 학부모님들께 아이 성적 상황 어떻게 알려주고 계세요?" — 현재 방식(문자/전화/종이) 확인'),
        h('li', '"점수만 입력하시면 인바디처럼 그래프 성적표가 학부모님 카톡으로 자동으로 갑니다."'),
        h('li', '"상담 때 쓰실 종이 성적표도 반 전체 한 번에 뽑혀요."'),
        h('li', '"월 3만원이고, 2주는 무료라 써보시고 결정하시면 됩니다. 샘플 링크 문자로 보내드릴까요?"'),
        h('li', '→ 관심 시 「시연예정」 + 다음 액션 날짜 지정, 방문 시연 후 「계약 전환」'))));
};

function editLead(l = {}, statuses = LEAD) {
  const form = h('form.form-grid',
    field('학원명 *', h('input', { name: 'name', value: l.name || '' })),
    field('전화', h('input', { name: 'phone', value: l.phone || '' })),
    field('지역', h('input', { name: 'region', value: l.region || '' })),
    field('주소', h('input', { name: 'address', value: l.address || '' })),
    l.id ? field('상태', h('select', { name: 'status' }, Object.entries(statuses).map(([k, v]) => h('option', { value: k, selected: k === l.status }, v)))) : null,
    l.id ? field('다음 액션일', h('input', { name: 'next_action_date', type: 'date', value: l.next_action_date || '' })) : null,
    l.id ? h('div', { style: 'grid-column:1/-1' }, field('메모', h('textarea', { name: 'notes', value: l.notes || '', rows: 6 }))) : null);
  const actions = [{ label: '저장', primary: true, onClick: async () => {
    const body = formData(form);
    await run(() => (l.id ? api('/api/admin/leads/' + l.id, { method: 'PUT', body }) : api('/api/admin/leads', { method: 'POST', body })), '저장했습니다');
    go('leads');
  } }];
  if (l.id) actions.unshift({ label: '삭제', danger: true, onClick: async () => {
    if (!confirm('삭제할까요?')) return false;
    await run(() => api('/api/admin/leads/' + l.id, { method: 'DELETE' }));
    go('leads');
  } });
  openModal(l.id ? l.name : '리드 추가', form, actions);
}

function callLog(l, statuses) {
  const note = h('textarea', { placeholder: '예) 원장님 부재, 내일 오후 3시 재통화 / 카톡 성적표 관심 있음' });
  const status = h('select', Object.entries(statuses).map(([k, v]) => h('option', { value: k, selected: k === (l.status === 'new' ? 'called' : l.status) }, v)));
  const next = h('input', { type: 'date' });
  openModal(`통화 기록 · ${l.name}`, h('div.grid',
    l.phone ? h('a.btn', { href: 'tel:' + l.phone, style: 'text-align:center' }, `📞 ${l.phone} 전화 걸기`) : null,
    field('통화 내용', note), h('div.form-grid', field('결과 상태', status), field('다음 액션일', next)),
    l.notes ? h('div', h('div.muted', { style: 'font-size:12px;margin-bottom:4px' }, '이전 기록'), h('pre', { style: 'white-space:pre-wrap;margin:0;font:inherit;font-size:12px' }, l.notes)) : null), [
    { label: '기록', primary: true, onClick: async () => {
      await run(() => api(`/api/admin/leads/${l.id}/call`, { method: 'POST', body: { note: note.value, status: status.value, next_action_date: next.value } }), '기록했습니다');
      go('leads');
    } },
  ]);
}

function naverModal() {
  const form = h('form.grid',
    h('p.muted', { style: 'margin:0' }, '네이버 지역검색 API는 한 번에 5곳만 알려줘서, 읍·면·동 × 학원 종류로 잘게 나눠 여러 번 검색합니다. 홈페이지 없는 곳이 1순위 영업 대상이에요.'),
    field('시/군 *', h('input', { name: 'region', placeholder: '충남 홍성군' })),
    field('읍·면·동 (쉼표로 구분)', h('textarea', { name: 'dongs', placeholder: '홍성읍, 광천읍, 홍북읍' })),
    field('학원 종류 (비우면 기본값)', h('input', { name: 'keywords', placeholder: '학원, 수학학원, 영어학원, 보습학원, 공부방, 교습소' })));
  openModal('네이버에서 학원 수집', form, [{ label: '수집 시작', primary: true, onClick: async () => {
    const r = await run(() => api('/api/admin/leads/naver', { method: 'POST', body: formData(form) }));
    toast(`${r.found}곳 발견 · 새로 추가 ${r.added}곳 · 홈페이지 없음 ${r.noWebsite}곳`);
    go('leads');
  } }]);
}

function csvModal() {
  const region = h('input', { placeholder: '지역 칸이 비어있을 때 넣을 값 (선택)' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv' });
  openModal('CSV 가져오기', h('div.grid',
    h('p.muted', { style: 'margin:0' }, '첫 줄 헤더: name,phone,address,region,category,link (또는 학원명,전화번호,주소,지역,분류,홈페이지). 같은 이름+주소는 중복으로 건너뜁니다.'),
    field('파일', file), field('기본 지역', region)), [
    { label: '가져오기', primary: true, onClick: async () => {
      if (!file.files[0]) { toast('파일을 골라주세요', 'err'); return false; }
      const text = await file.files[0].text();
      const r = await run(() => api('/api/admin/leads/import?region=' + encodeURIComponent(region.value), { method: 'POST', body: text, headers: { 'Content-Type': 'text/csv' } }));
      toast(`${r.total}줄 중 ${r.added}곳 추가`);
      go('leads');
    } },
  ]);
}

// ---------------- 발송 로그 ----------------
pages.sends = async () => {
  const list = await api('/api/admin/sends');
  main.replaceChildren(h('div.page-head', h('h2', '발송 로그 (최근 200건)')),
    list.length ? h('div.card', { style: 'padding:0' }, h('div.table-wrap', h('table',
      h('thead', h('tr', ['학원', '학생', '종류', '기간', '상태', '발송', '열람', '공급사'].map((x) => h('th', x)))),
      h('tbody', list.map((r) => h('tr', h('td', r.academy_name), h('td', r.student_name), h('td', FREQ[r.period_type]),
        h('td', `${r.period_start} ~ ${r.period_end}`),
        h('td', h('span.pill.' + (r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'), r.status), r.error ? h('div.muted', { style: 'font-size:12px' }, r.error) : null),
        h('td', r.sent_at || '-'), h('td', r.viewed_at ? '✓' : ''), h('td', r.provider))))))) : h('div.empty', '발송 기록이 없습니다.'));
};

window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (p in pages) go(p); });
go(location.hash.slice(1) in pages ? location.hash.slice(1) : 'home');
