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
export const BLOCK = ['exit 2', '"decision": "block"', '"permissionDecision": "deny"', '"continue": false'];
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

export function detectRole(name, description) {
  const text = `${name ?? ''} ${description ?? ''}`;
  for (const [role, words] of ROLES) if (hasAny(text, words)) return role;
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
