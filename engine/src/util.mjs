// 결정론적 직렬화·해시·ID 도구(engine-cli.md §10).
import { createHash } from 'node:crypto';

export function sha256hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function sha256tag(input) {
  return `sha256:${sha256hex(input)}`;
}

// 객체 키를 코드 유닛 순서로 정렬한다. 로케일 비교를 쓰지 않는다.
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      if (value[key] !== undefined) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

export function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 여러 키로 정렬할 때 쓰는 비교 함수. null은 맨 앞이다.
export function compareTuples(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return compareCodeUnits(String(x), String(y));
  }
  return 0;
}

// 파일 저장용: 2칸 들여쓰기, 키 정렬, 끝 개행 하나.
export function stableStringify(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

// 해시 입력용: 공백 없는 정렬 JSON.
export function hashInput(value) {
  return JSON.stringify(canonical(value));
}

export function hashJson(value) {
  return sha256tag(hashInput(value));
}

// 내용 정규화: CRLF → LF, UTF-8 BOM 제거.
export function normalizeContent(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

export const componentId = (kind, origin, key) => `c_${sha256hex(`${kind}|${origin}|${key}`).slice(0, 12)}`;
export const evidenceId = (cid, keyPath, line, family) => `ev_${sha256hex(`${cid}|${keyPath ?? ''}|${line ?? ''}|${family}`).slice(0, 12)}`;
export const changeId = (from, to, cid, change) => `chg_${sha256hex(`${from}|${to}|${cid}|${change}`).slice(0, 12)}`;

// 2026-11-27T09:15:00.000Z → 20261127T091500Z
export function compactUtc(iso) {
  return iso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
}

export function isoSeconds(date) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

// 반올림(half-even). 비율 4자리, 환산 토큰 1자리에 쓴다.
export function roundHalfEven(value, digits) {
  const f = 10 ** digits;
  const x = value * f;
  const r = Math.round(x);
  const diff = Math.abs(x % 1);
  if (Math.abs(diff - 0.5) < 1e-9) return (r % 2 === 0 ? r : r - 1) / f;
  return r / f;
}

export function truncate(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function uniqueSorted(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}
