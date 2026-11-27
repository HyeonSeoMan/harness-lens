// 성능 예산(PRD §11.1, engine-cli.md §12). 예산 초과는 테스트 실패다(--strict-budget → 종료 코드 60).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, engine, exampleInterpretation, makeProject, readJson, repoRoot, swapFixture } from './helpers.mjs';

test('재분석 엔진 시간·메모리·LLM 입력 인벤토리가 예산 안에 있다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  analyze({ project: p.project, out: p.out, now: '2026-11-27T09:00:00Z', interpretation: exampleInterpretation('harness-before') });
  swapFixture(p.project, 'harness-after');
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-28T09:00:00Z', '--strict-budget', '--json']);
  assert.equal(prep.code, 0, `예산 초과: ${prep.stdout}`);
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  const budgets = Object.fromEntries(draft.engine.selfCost.budgets.map((b) => [b.budgetId, b]));
  assert.equal(budgets.reanalysis_engine_ms.status, 'within', '이전 스냅샷이 있으면 재분석 시간을 측정한다');
  assert.ok(budgets.reanalysis_engine_ms.observed < 5000);
  assert.equal(budgets.engine_max_rss_bytes.status, 'within');
  assert.equal(budgets.llm_input_inventory_tokens.status, 'within');
  assert.equal(budgets.llm_input_inventory_tokens.observed, prep.json.estimatedInventoryTokens);
  assert.ok(prep.json.estimatedInventoryTokens <= 6000);
  assert.equal(budgets.background_processes.observed, 0);
});

test('Harness Lens 설치물은 상시 Hook과 상주 프로세스를 만들지 않는다', () => {
  const plugin = readJson(path.join(repoRoot, '.claude-plugin/plugin.json'));
  assert.equal(plugin.hooks, undefined);
  assert.ok(!existsSync(path.join(repoRoot, 'hooks')));
  assert.ok(!existsSync(path.join(repoRoot, 'skills/harness-analyze/hooks')));
  const bundle = readFileSync(path.join(repoRoot, 'skills/harness-analyze/scripts/harness-lens.mjs'), 'utf8');
  assert.ok(!/\bfetch\(|node:https?|node:net|node:dgram/.test(bundle), '엔진은 네트워크 모듈을 쓰지 않는다');
});
