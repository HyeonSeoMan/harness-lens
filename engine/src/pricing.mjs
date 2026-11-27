// 토큰 환산 가중치(PRD §6.1, engine-cli.md §8.5). 공개 가격표의 상대값이며 청구액이 아니다.
// 단가는 $/MTok을 1/10,000 달러 단위 정수로 적는다(부동소수 누적 오차를 피한다).
// 캐시 쓰기는 입력 단가의 1.25배(5분)·2배(1시간), 캐시 읽기는 모델마다 다르다.
// 출처: Anthropic 공개 가격표(Claude API 기준, 확인일 2026-10-06). 바뀌면 PRICING_TABLE_VERSION과 함께 고친다.

export const PRICING_TABLE_VERSION = '2026-10-06';
export const REFERENCE_MODEL = 'claude-opus-5-5';

// [입력, 출력, 캐시 읽기] (단위: $0.0001 / MTok)
const TABLE = {
  'claude-fable-5-1': [100000, 500000, 2500],
  'claude-mythos-5-1': [100000, 500000, 2500],
  'claude-fable-5': [100000, 500000, 10000],
  'claude-mythos-5': [100000, 500000, 10000],
  'claude-opus-5-5': [40000, 200000, 2000],
  'claude-opus-5': [50000, 250000, 5000],
  'claude-opus-4-8': [50000, 250000, 5000],
  'claude-opus-4-7': [50000, 250000, 5000],
  'claude-opus-4-6': [50000, 250000, 5000],
  'claude-sonnet-5-5': [20000, 100000, 2000],
  'claude-sonnet-5': [20000, 100000, 2000],
  'claude-sonnet-4-6': [30000, 150000, 3000],
  // Haiku 5.5는 프롬프트 10만 토큰 이하 단가다(초과 구간은 반영하지 않는다).
  'claude-haiku-5-5': [1000, 5000, 100],
  'claude-haiku-4-5': [10000, 50000, 1000],
};

const REF_INPUT = TABLE[REFERENCE_MODEL][0];

// 날짜 접미사(-20251101), 플랫폼 접두사(anthropic., us.anthropic.), 컨텍스트 표기([1m]), @버전을 떼고 찾는다.
export function priceKey(model) {
  if (typeof model !== 'string') return null;
  let m = model.toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/@.*$/, '').replace(/^(?:[a-z]{2}\.)?anthropic\./, '');
  m = m.replace(/-\d{8}$/, '').replace(/-v\d+(?::\d+)?$/, '');
  return Object.hasOwn(TABLE, m) ? m : null;
}

// bucket: [freshInput, cacheWrite5m, cacheWrite1h, cacheRead, output] (정수). 모르는 모델이면 null.
export function weightedUnits(model, bucket) {
  const key = priceKey(model);
  if (!key) return null;
  const [inp, out, read] = TABLE[key];
  const [fresh, w5, w1, cr, o] = bucket;
  // 단가 단위가 4의 배수라 1.25배도 정수다.
  return fresh * inp + w5 * (inp * 5 / 4) + w1 * inp * 2 + cr * read + o * out;
}

// 정수 단위 합을 기준 모델 새 입력 토큰 환산값으로 바꾼다.
export const unitsToWeighted = (units) => units / REF_INPUT;
