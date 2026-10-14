// 공용 유틸: API 호출, DOM 생성, 알림
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body !== undefined && typeof opts.body !== 'string' ? { 'Content-Type': 'application/json' } : opts.headers,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && location.pathname !== '/' && !path.startsWith('/api/public')) {
    location.href = '/';
    throw new Error('로그인이 필요합니다.');
  }
  if (!res.ok) throw new Error(data.error || `오류 (${res.status})`);
  return data;
}

// h('div.card', {onclick}, child1, 'text', ...)
function h(tag, attrs, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg, type = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) document.body.append((box = h('div', { id: 'toasts' })));
  const el = h('div.toast.' + type, msg);
  box.append(el);
  setTimeout(() => el.remove(), 3500);
}

async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, 'err');
    throw e;
  }
}

const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';
const FREQ = { daily: '일간', weekly: '주간', monthly: '월간', quarterly: '분기', manual: '수시' };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function todayKST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

// 간단 모달: openModal(title, bodyNode, [{label, primary, onClick}])
function openModal(title, body, actions = []) {
  const close = () => back.remove();
  const back = h('div.modal-back', { onclick: (e) => e.target === back && close() },
    h('div.modal', h('div.modal-head', h('h3', title), h('button.icon', { onclick: close, 'aria-label': '닫기' }, '×')),
      h('div.modal-body', body),
      actions.length ? h('div.modal-foot', actions.map((a) =>
        h('button' + (a.primary ? '.primary' : a.danger ? '.danger' : ''), {
          onclick: async () => { if ((await a.onClick?.()) !== false) close(); },
        }, a.label))) : null));
  document.body.append(back);
  back.querySelector('input,select,textarea')?.focus();
  return close;
}

function field(label, input, hint) {
  return h('label.field', h('span', label), input, hint ? h('small', hint) : null);
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  location.href = '/';
}

// ================= 앱(PWA) · 모바일 =================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // 크롬 기본 배너 대신 우리 버튼으로 설치
  deferredInstall = e;
  document.dispatchEvent(new Event('installable'));
});
window.addEventListener('appinstalled', () => document.querySelectorAll('.install-card').forEach((x) => x.remove()));

const isMobile = () => matchMedia('(max-width: 800px)').matches;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInApp = () => /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);

// "휴대폰에 앱으로 설치" 안내 카드. 이미 앱으로 실행 중이면 null
function installCard() {
  if (isStandalone()) return null;
  const steps = h('div.install-steps');
  const btn = h('button.primary', { type: 'button' }, '앱 설치하기');
  const card = h('div.card.install-card', h('div.install-row', h('img', { src: '/icons/icon-192.png', alt: '', width: 44, height: 44 }),
    h('div', { style: 'flex:1;min-width:0' }, h('b', '휴대폰에 앱으로 설치'), h('div.muted', { style: 'font-size:13px' }, '홈 화면 아이콘으로 바로 열려요. 스토어 설치 필요 없음')), btn), steps);
  const guide = (...lines) => steps.replaceChildren(h('ol', lines.map((l) => h('li', l))));
  const refresh = () => {
    if (isInApp()) {
      btn.style.display = 'none';
      guide('카카오톡·네이버 앱 안의 브라우저에서는 설치가 안 돼요.', '오른쪽 위(또는 아래) ⋮ 메뉴 → 「다른 브라우저로 열기」', isIOS() ? 'Safari 에서 다시 이 화면을 열어 주세요.' : 'Chrome 에서 다시 이 화면을 열어 주세요.');
    } else if (deferredInstall) {
      btn.style.display = '';
      steps.replaceChildren();
    } else if (isIOS()) {
      btn.style.display = 'none';
      guide('Safari 아래쪽 공유 버튼(네모에 ↑) 누르기', '「홈 화면에 추가」 누르기', '오른쪽 위 「추가」 → 홈 화면에 성취리포트 아이콘 생성');
    } else {
      btn.style.display = 'none';
      guide('Chrome 오른쪽 위 ⋮ 메뉴 누르기', '「앱 설치」 또는 「홈 화면에 추가」 누르기');
    }
  };
  btn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    refresh();
  });
  document.addEventListener('installable', refresh);
  refresh();
  return card;
}

const ICONS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2M7 14h10v7H7z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  building: 'M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4',
  won: 'M3 7l3 10 3-10 3 10 3-10 3 10 3-10M2 11h20M2 14h20',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${ICONS[name] || ''}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg;
}

// 사이드 메뉴 → 모바일에서는 하단 탭바. data-tab 이 붙은 메뉴만 탭에 보이고 나머지는 '더보기' 시트로
function setupNav(go) {
  const nav = document.getElementById('nav');
  nav.querySelectorAll('.nav[data-icon]').forEach((b) => {
    const full = b.textContent.trim();
    b.replaceChildren(icon(b.dataset.icon), h('span.lbl-full', full), h('span.lbl-short', b.dataset.short || full));
  });
  const more = h('button.nav.more-tab', { type: 'button' }, icon('more'), '더보기');
  more.addEventListener('click', () => {
    const items = [...nav.querySelectorAll('.nav:not([data-tab]):not(.more-tab)')];
    const close = openModal('메뉴', h('div.sheet-menu', items.map((b) => h('button', {
      onclick: () => { close(); b.dataset.page ? go(b.dataset.page) : b.click(); },
    }, icon(b.dataset.icon || 'list'), b.querySelector('.lbl-full')?.textContent || b.textContent))));
  });
  nav.append(more);
}

// 표 → 모바일에서는 카드 목록으로 보이도록 각 칸에 머리글 이름을 달아둔다
function cardify(root) {
  root.querySelectorAll('table:not(.entry)').forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    table.classList.add('cards');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => td.setAttribute('data-label', heads[i] || ''));
    });
  });
}
