// 비밀정보 제거 규칙 R1~R8(engine-cli.md §7). 값은 어디에도 남기지 않고 종류별 개수만 센다.

// R1: 열지 않는 파일
const SENSITIVE_NAMES = [
  /^\.env$/i, /^\.env\..*/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i,
  /^id_rsa/i, /^id_ed25519/i, /credentials/i, /^\.netrc$/i,
];

export function isSensitiveFile(name) {
  const base = name.split('/').pop();
  return SENSITIVE_NAMES.some((re) => re.test(base));
}

// R3: 패턴 치환. 순서가 중요하다(구체적인 패턴 먼저).
const PATTERNS = [
  ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai_key', /sk-[A-Za-z0-9]{20,}/g],
  ['github_token', /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/g],
  ['slack_token', /xox[abpr]-[A-Za-z0-9-]{10,}/g],
  ['aws_access_key', /AKIA[0-9A-Z]{16}/g],
  ['jwt', /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
  ['url_credentials', /:\/\/[^/\s:@]+:[^/\s@]+@/g],
  ['assignment', /(api[_-]?key|token|secret|password|passwd|authorization|bearer)["']?\s*[:=]\s*["']?[^\s"']{8,}/gi],
];

const TOKEN_RUN = /^[A-Za-z0-9+/=_-]{32,}$/;
const QUOTED_RUN = /(["'])([A-Za-z0-9+/=_-]{32,})\1/g;

export function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const marker = (kind) => `[REDACTED:${kind}]`;

export class RedactionCounter {
  constructor() { this.counts = new Map(); }
  add(kind, n = 1) { this.counts.set(kind, (this.counts.get(kind) ?? 0) + n); }
  toArray() {
    return [...this.counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([kind, count]) => ({ kind, count }));
  }
}

// 문자열 하나에 R3를 적용한다. wholeValue면 따옴표 없이도 문자열 전체를 고엔트로피 토큰으로 본다(JSON 값).
export function redactString(text, counter, { wholeValue = false } = {}) {
  let out = text;
  for (const [kind, re] of PATTERNS) {
    out = out.replace(re, (m) => {
      if (m.includes('[REDACTED:')) return m;
      counter?.add(kind);
      return kind === 'url_credentials' ? `://${marker(kind)}@` : marker(kind);
    });
  }
  out = out.replace(QUOTED_RUN, (m, q, run) => {
    if (shannonEntropy(run) < 4.0) return m;
    counter?.add('high_entropy');
    return `${q}${marker('high_entropy')}${q}`;
  });
  if (wholeValue && TOKEN_RUN.test(out) && shannonEntropy(out) >= 4.0) {
    counter?.add('high_entropy');
    out = marker('high_entropy');
  }
  return out;
}

// R3 검출만 한다(R7 재검사). 걸린 종류 목록을 돌려준다.
export function detectSecrets(text) {
  const kinds = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m && m.some((x) => !x.includes('[REDACTED:'))) kinds.push(kind);
  }
  for (const m of text.matchAll(QUOTED_RUN)) if (shannonEntropy(m[2]) >= 4.0) kinds.push('high_entropy');
  return kinds;
}

// 객체의 모든 문자열에 함수를 적용한 사본을 만든다.
export function mapStrings(value, fn, path = '') {
  if (typeof value === 'string') return fn(value, path);
  if (Array.isArray(value)) return value.map((v, i) => mapStrings(v, fn, `${path}/${i}`));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn, `${path}/${k}`);
    return out;
  }
  return value;
}

// R7: 출력 직전 재검사. 엔진 영역에서 걸리면 치환하고 경로 목록을 돌려준다.
export function rescanAndRedact(value) {
  const hits = [];
  const out = mapStrings(value, (s, p) => {
    if (detectSecrets(s).length === 0) return s;
    hits.push(p);
    return redactString(s, null);
  });
  return { value: out, hits };
}

// R2: 남겨도 되는 env 키와 값 형식.
const NUMERIC_KEEP = new Set([
  'MAX_THINKING_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'MAX_MCP_OUTPUT_TOKENS', 'BASH_MAX_OUTPUT_LENGTH',
  'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION',
]);

export function keepEnvValue(key, value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value);
  if (NUMERIC_KEEP.has(key) && /^[0-9]+$/.test(s)) return s;
  if (key === 'CLAUDE_CODE_SUBAGENT_MODEL' && /^[a-z0-9.-]{1,60}$/.test(s)) return s;
  return null;
}

// R2: MCP url은 scheme과 host만 남긴다.
export function urlSchemeHost(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@\s]*@)?([^/:?#\s]+)/i.exec(String(url));
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null;
}

// R8: 분석 도구를 겨냥한 지시문(휴리스틱).
const ANALYZER_TARGETING = [
  /ignore (all )?(previous|prior) instructions/i,
  /harness[ -]?lens/i,
  /analysis tool/i,
  /이전 지시를 무시/,
];

export function targetsAnalyzer(line) {
  return ANALYZER_TARGETING.some((re) => re.test(line));
}
