// 새 학원 가입 시 기본 평가 항목 (원장님이 화면에서 자유롭게 고칠 수 있음)
const DEFAULT_METRICS = [
  // 과목, 영역, 항목, 단위, 최소, 최대, 높을수록좋음
  ['수학', '개념', '개념 이해도', '점', 0, 100, 1],
  ['수학', '연산', '연산 정확도', '점', 0, 100, 1],
  ['수학', '응용', '서술형·응용', '점', 0, 100, 1],
  ['수학', '태도', '과제 수행', '점', 0, 100, 1],
  ['영어', '어휘', '단어 테스트', '점', 0, 100, 1],
  ['영어', '독해', '독해', '점', 0, 100, 1],
  ['영어', '문법', '문법', '점', 0, 100, 1],
  ['영어', '태도', '과제 수행', '점', 0, 100, 1],
];

function seedDefaultMetrics(db, academyId) {
  const ins = db.prepare(`INSERT INTO metrics (academy_id, subject, category, name, unit, min_value, max_value, higher_is_better, sort)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  DEFAULT_METRICS.forEach((m, i) => ins.run(academyId, ...m, i));
}

module.exports = { DEFAULT_METRICS, seedDefaultMetrics };
