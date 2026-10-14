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
