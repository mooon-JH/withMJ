// 영업 리스트업
// 목표: 군·시 단위 지역에서 '네이버 지도에만 간신히 등록된' 작은 학원을 찾아 전화 영업.
// 네이버 지역검색 API 는 한 번에 최대 5건만 주므로, '동 이름 × 학원 종류' 로 잘게 쪼개 여러 번 검색한다.
// 홈페이지(link)가 없는 곳 = 온라인 관리가 약한 곳 = 우리 고객 후보 1순위.

const LEAD_STATUSES = {
  new: '미연락', called: '통화함', interested: '관심', demo: '시연예정', won: '계약', lost: '거절', hold: '보류',
};

const DEFAULT_KEYWORDS = ['학원', '수학학원', '영어학원', '보습학원', '공부방', '교습소'];

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
}

async function naverLocalSearch(query, env = process.env) {
  if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
    throw new Error('NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다 (developers.naver.com 에서 발급).');
  }
  const url = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&start=1&sort=random`;
  const res = await fetch(url, {
    headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
  });
  if (!res.ok) throw new Error(`네이버 검색 실패: HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((it) => ({
    name: stripTags(it.title),
    phone: it.telephone || '',
    address: it.roadAddress || it.address || '',
    category: it.category || '',
    link: it.link || '',
  }));
}

// region: '홍성군', dongs: ['홍성읍', '광천읍'], keywords: 학원 종류
async function collectLeads({ region, dongs = [], keywords = DEFAULT_KEYWORDS }, search = naverLocalSearch) {
  const areas = dongs.length ? dongs.map((d) => `${region} ${d}`) : [region];
  const seen = new Map();
  for (const area of areas) {
    for (const kw of keywords) {
      const items = await search(`${area} ${kw}`);
      for (const it of items) {
        if (!/학원|교습|공부방|교육/.test(it.category + it.name)) continue;
        const key = it.name + '|' + it.address;
        if (!seen.has(key)) seen.set(key, { ...it, region, source: 'naver' });
      }
    }
  }
  return [...seen.values()];
}

function saveLeads(db, leads) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO leads (name, phone, address, region, category, link, source)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let added = 0;
  for (const l of leads) {
    if (!l.name) continue;
    added += stmt.run(l.name, l.phone || '', l.address || '', l.region || '', l.category || '', l.link || '', l.source || 'manual').changes;
  }
  return added;
}

// 간단 CSV 파서 (따옴표 지원). 첫 줄은 헤더: name,phone,address,region,category,link
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim()));
  if (!nonEmpty.length) return [];
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  const alias = { 이름: 'name', 학원명: 'name', 전화: 'phone', 전화번호: 'phone', 주소: 'address', 지역: 'region', 분류: 'category', 홈페이지: 'link' };
  const keys = header.map((h) => alias[h] || h);
  return nonEmpty.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] || '').trim()])));
}

function toCsv(rows, cols) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

module.exports = { LEAD_STATUSES, DEFAULT_KEYWORDS, naverLocalSearch, collectLeads, saveLeads, parseCsv, toCsv };
