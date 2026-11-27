// 엔진 전역 상수. 버전과 축 정의는 스키마·루브릭 문서와 함께 바꾼다.

export const ENGINE_VERSION = '0.4.0';
export const VALIDATOR_VERSION = '0.4.0';
export const SCHEMA_VERSION = '0.1';
export const RUBRIC_VERSION = '0.3';
// 세션 기록 파서 규칙 버전(engine-cli.md §8). 규칙이 바뀌면 올리고, 누적 상태를 처음부터 다시 만든다.
export const SESSION_PARSER_VERSION = '3';
export { PRICING_TABLE_VERSION } from './pricing.mjs';

export const MIN_NODE_MAJOR = 20;
export const SUPPORTED_PLATFORMS = ['darwin', 'linux', 'win32'];

export const AXES = [
  'spec_clarity',
  'verification_gate_strength',
  'execution_stability',
  'throughput',
  'cost_efficiency',
  'context_efficiency',
  'autonomy',
  'safety_boundary',
];

export const AXIS_PREFIX = {
  spec_clarity: 'SC',
  verification_gate_strength: 'VG',
  execution_stability: 'ES',
  throughput: 'TP',
  cost_efficiency: 'CE',
  context_efficiency: 'CX',
  autonomy: 'AU',
  safety_boundary: 'SB',
};

export const PREFIX_AXIS = Object.fromEntries(Object.entries(AXIS_PREFIX).map(([a, p]) => [p, a]));

// 축 최대 수준. TP는 L3 예약(루브릭 §2.4).
export const AXIS_MAX = Object.fromEntries(AXES.map((a) => [a, a === 'throughput' ? 2 : 3]));

// 루브릭 §1.9 실측 전환 표.
export const MATURITY_RULES = {
  spec_clarity: { measurable: false, blockedReason: 'needs_ci_pr_data' },
  verification_gate_strength: { measurable: false, blockedReason: 'needs_ci_pr_data' },
  execution_stability: { measurable: true, unit: 'tool_calls', required: 500 },
  throughput: { measurable: true, unit: 'sessions', required: 20 },
  // 0.3: cache_hit_ratio를 참고 지표로 내렸다(클라이언트 동작 영향이 커서 하네스 축 실측으로 약하다). 대역 지표가 정해질 때까지 예측.
  cost_efficiency: { measurable: false, blockedReason: 'band_metric_undefined' },
  context_efficiency: { measurable: true, unit: 'sessions', required: 20 },
  autonomy: { measurable: true, unit: 'tool_calls', required: 500 },
  safety_boundary: { measurable: false, blockedReason: 'session_format_unconfirmed' },
};

export const BUDGETS = {
  always_loaded_tokens: { target: 100, unit: 'tokens' },
  background_processes: { target: 0, unit: 'count' },
  reanalysis_engine_ms: { target: 5000, unit: 'ms' },
  engine_max_rss_bytes: { target: 200 * 1024 * 1024, unit: 'bytes' },
  llm_input_inventory_tokens: { target: 6000, unit: 'tokens' },
  llm_tokens_per_analysis: { target: 120000, unit: 'tokens' },
};

export const EXIT = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  RUNTIME: 10,
  LOCKED: 11,
  NO_PROJECT: 12,
  INVALID: 30,
  VERSION_MISMATCH: 31,
  SNAPSHOT_WRITE: 40,
  NOT_FOUND: 41,
  RENDER: 50,
  BUDGET: 60,
};

export const TEXT_LIMIT_BYTES = 1024 * 1024;
export const SCRIPT_LIMIT_BYTES = 256 * 1024;
export const MAX_IMPORT_DEPTH = 5;
export const RUNS_TO_KEEP = 5;
