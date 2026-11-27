// 모델별 컨텍스트 창 크기(루브릭 §1.9 CX-M-02, 0.3). 컨텍스트 대역을 창 대비 비율로 정할 때 쓴다.
// 출처: Anthropic Claude Platform 문서 Models overview(https://platform.claude.com/docs/en/models/overview, 확인일 2026-11-27).
// 표에 없는 모델의 요청은 비율 계산에서 뺀다(실측 보류). 바뀌면 CONTEXT_WINDOW_TABLE_VERSION과 함께 고친다.
import { modelKey } from './pricing.mjs';

export const CONTEXT_WINDOW_TABLE_VERSION = '2026-11-27';

const M = 1000000;
const WINDOWS = {
  'claude-fable-5-2': M,
  'claude-fable-5-1': M,
  'claude-mythos-5-1': M,
  'claude-fable-5': M,
  'claude-mythos-5': M,
  'claude-opus-5-5': M,
  'claude-opus-5': M,
  'claude-opus-4-8': M,
  'claude-opus-4-7': M,
  'claude-opus-4-6': M,
  'claude-sonnet-5-5': M,
  'claude-sonnet-5': M,
  'claude-sonnet-4-6': M,
  'claude-haiku-5-5': M,
  'claude-haiku-4-5': 200000,
};

// 모르는 모델이면 null.
export function contextWindow(model) {
  const k = modelKey(model);
  return k !== null && Object.hasOwn(WINDOWS, k) ? WINDOWS[k] : null;
}
