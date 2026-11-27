// 어휘 사전 LEX-*(evaluation-rubric.md §1.7, 휴리스틱). 바꾸면 rubricVersion을 올린다.

// 서술 어휘. 순서는 귀속 순서(§1.5)와 같다.
export const NARRATIVE = [
  ['safety_boundary', ['금지', '비밀', '.env', 'rm -rf', 'force push', 'secret', 'credential', 'never commit', 'do not push']],
  ['verification_gate_strength', ['테스트를 실행', '테스트 실행', '타입 검사', '리뷰', '검증', 'run tests', 'run the tests', 'lint', 'typecheck', 'review', 'verify']],
  ['spec_clarity', ['수용 기준', '완료 정의', '요구사항', '명세', '코딩 규약', 'acceptance criteria', 'definition of done', 'requirement', 'spec', 'convention', 'style guide']],
  ['execution_stability', ['실패하면', '실패 시', '재시도', '롤백', '복구', 'on failure', 'retry', 'rollback', 'recover']],
  ['autonomy', ['묻지 말고', '확인 없이', '승인을 받', 'without asking', 'autonomously', 'ask before']],
  ['cost_efficiency', ['비용', '토큰 예산', 'cost', 'token budget', 'cheaper model']],
  ['context_efficiency', ['컨텍스트', '/clear', '/compact', 'context window', 'subagent로 위임', 'delegate to a subagent']],
  ['throughput', ['병렬', '동시에', 'parallel', 'concurrently', 'in the background']],
];

export const ROLES = [
  ['reviewer', ['review', 'verif', 'audit', 'qa', 'critic', '검토', '리뷰', '검증']],
  ['spec', ['spec', 'plan', 'prd', 'requirement', '명세', '계획', '요구사항']],
  ['recovery', ['rollback', 'recover', 'checkpoint', 'restore', '복구', '롤백']],
  ['parallel', ['parallel', 'fan-out', 'dispatch', '병렬']],
  ['explorer', ['explore', 'search', 'research', 'investigat', '탐색', '조사']],
];

export const VERIFY_CMD = ['test', 'lint', 'eslint', 'prettier --check', 'tsc', 'typecheck', 'pytest', 'ruff', 'cargo clippy', 'go vet', 'mvn verify', 'gradle check'];
export const SPEC_CMD = ['spec', 'prd', 'acceptance', 'requirements', '명세'];
// 0.3: 언어별 종료 관례와 따옴표 없는·작은따옴표 키(JS 객체, Python dict)를 더했다.
const BLOCK_KEYS = [['decision', 'block'], ['permissionDecision', 'deny']];
export const BLOCK = [
  'exit 2', 'process.exit(2)', 'process.exitCode = 2', 'sys.exit(2)', 'os.Exit(2)',
  ...BLOCK_KEYS.flatMap(([k, v]) => [`"${k}": "${v}"`, `'${k}': '${v}'`, `${k}: "${v}"`, `${k}: '${v}'`]),
  '"continue": false', "'continue': False", 'continue: false',
];
export const REENTRY = ['stop_hook_active'];

const norm = (s) => s.normalize('NFC').toLowerCase();

export function hasAny(text, words) {
  const t = norm(text);
  return words.some((w) => t.includes(norm(w)));
}

// 차단 표지는 공백 차이를 무시한다.
export function hasBlockMarker(text) {
  const t = norm(text).replace(/\s+/g, '');
  return BLOCK.some((w) => t.includes(norm(w).replace(/\s+/g, '')));
}

export function narrativeAxes(line) {
  return NARRATIVE.filter(([, words]) => hasAny(line, words)).map(([axis]) => axis);
}

// 부정 표현(LEX-NEG, 0.3). 이 표현이 든 설명 절은 역할 판정에서 뺀다("독립 리뷰어는 쓰지 않는다").
export const NEGATION = /않|없이|없다|없음|말고|말 것|아니|n't\b|\b(?:not|never|without|no)\b/i;

// 설명을 절(문장 부호·줄바꿈·쉼표)로 나누고 부정 표현이 든 절을 버린다.
export function affirmativeClauses(text) {
  return String(text ?? '').split(/[.!?;。\n]+|,\s+/).filter((c) => !NEGATION.test(c.normalize('NFC'))).join(' ');
}

// 0.3: name을 먼저 본다. name에 역할이 없을 때만 부정 절을 뺀 description을 본다.
export function detectRole(name, description) {
  for (const text of [name ?? '', affirmativeClauses(description)]) {
    for (const [role, words] of ROLES) if (hasAny(text, words)) return role;
  }
  return null;
}

export const AXIS_LABEL = {
  spec_clarity: '명세 명확성',
  verification_gate_strength: '검증 게이트 강도',
  execution_stability: '실행 안정성',
  throughput: '처리 속도',
  cost_efficiency: '비용 효율',
  context_efficiency: '컨텍스트 효율',
  autonomy: '자율성',
  safety_boundary: '안전 경계',
};
