// 카카오 알림톡 발송기
// 알림톡은 카카오가 직접 API 를 열어주지 않아 '공식 딜러사'(솔라피, NHN Cloud, 알리고 등)를 거쳐 보낸다.
// 여기서는 솔라피 어댑터와, 개발/시연용 mock 어댑터를 제공한다.
const crypto = require('node:crypto');

// 템플릿 예시 (카카오 비즈니스 채널에서 검수 승인을 받아야 함)
//   [#{학원명}] #{학생명} 학생의 #{기간} 성취 리포트가 도착했습니다.
//
//   #{요약}
//
//   아래 버튼을 눌러 그래프로 확인해 주세요.
//   [버튼: 리포트 보기 → #{링크}]
function buildMessage({ academyName, studentName, periodLabel, summary, url }) {
  const text =
    `[${academyName}] ${studentName} 학생의 ${periodLabel} 성취 리포트가 도착했습니다.\n\n` +
    `${summary}\n\n아래 버튼을 눌러 그래프로 확인해 주세요.\n${url}`;
  const variables = {
    '#{학원명}': academyName,
    '#{학생명}': studentName,
    '#{기간}': periodLabel,
    '#{요약}': summary,
    '#{링크}': url,
  };
  return { text, variables };
}

function normalizePhone(p) {
  return String(p || '').replace(/[^0-9]/g, '');
}

class MockKakao {
  constructor() { this.name = 'mock'; this.sent = []; }
  async send({ to, text }) {
    const id = 'mock-' + crypto.randomBytes(6).toString('hex');
    this.sent.push({ id, to, text });
    if (process.env.NODE_ENV !== 'test') console.log(`[알림톡:mock] → ${to}\n${text}\n`);
    return { ok: true, messageId: id };
  }
}

class SolapiKakao {
  constructor(env = process.env) {
    this.name = 'solapi';
    this.apiKey = env.SOLAPI_API_KEY;
    this.apiSecret = env.SOLAPI_API_SECRET;
    this.pfId = env.SOLAPI_PF_ID;
    this.templateId = env.SOLAPI_TEMPLATE_ID;
    this.from = env.SOLAPI_SENDER_PHONE;
  }
  authHeader() {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(16).toString('hex');
    const signature = crypto.createHmac('sha256', this.apiSecret).update(date + salt).digest('hex');
    return `HMAC-SHA256 apiKey=${this.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }
  async send({ to, text, variables }) {
    const body = {
      message: {
        to: normalizePhone(to),
        from: normalizePhone(this.from),
        text, // 알림톡 실패 시 문자로 대체 발송될 본문
        kakaoOptions: { pfId: this.pfId, templateId: this.templateId, variables },
      },
    };
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.errorMessage || `HTTP ${res.status}` };
    return { ok: true, messageId: data.messageId || data.groupId || null };
  }
}

function createKakao(env = process.env) {
  return env.KAKAO_PROVIDER === 'solapi' ? new SolapiKakao(env) : new MockKakao();
}

module.exports = { createKakao, buildMessage, normalizePhone, MockKakao, SolapiKakao };
