// 성능 예산(PRD §11.1, engine-cli.md §12). 예산 초과는 테스트 실패다(--strict-budget → 종료 코드 60).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, engine, exampleInterpretation, makeProject, readJson, repoRoot, swapFixture } from './helpers.mjs';
import { appendResponse, writeDenseLogs, writeSyntheticLogs } from './support/synth-sessions.mjs';

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

test('큰 세션 기록: 최초 집계 메모리 200MiB 이하, 증분 재분석 5초 이하(--strict-budget)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'big-config');
  // 약 300세션·5.4만 줄·100MB 안팎. 한 줄짜리 거대 레코드(20MB)도 넣어 버퍼에 모으지 않고 건너뛰는지 본다.
  const files = writeSyntheticLogs(configDir, { project: p.project, sessions: 300, toolsPerSession: 60, padBytes: 1500 });
  appendFileSync(files[0], `${JSON.stringify({ type: 'api-request-blob', body: 'x'.repeat(20 * 1024 * 1024) })}\n`);
  const first = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-27T09:00:00Z', '--strict-budget', '--json'], { configDir });
  assert.equal(first.code, 0, `최초 집계 예산 초과: ${first.stdout}`);
  const draft1 = readJson(path.join(path.dirname(first.json.compactInventoryPath), 'draft.json'));
  assert.equal(draft1.engine.sessions.status, 'available');
  assert.equal(draft1.engine.sessions.coverage.sessionsAttributed, 300);
  writeFileSync(first.json.interpretationPath, readFileSync(exampleInterpretation('harness-before')));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', first.json.runId, '--now', '2026-11-27T09:00:00Z', '--no-open', '--json'], { configDir });
  assert.equal(fin.code, 0, fin.stdout);
  appendResponse(files[1], { sid: 'syn-session-1', project: p.project, id: 'msg_perf_new', t: Date.parse('2026-11-27T10:00:00Z'), usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 } });
  const second = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-28T09:00:00Z', '--strict-budget', '--json'], { configDir });
  assert.equal(second.code, 0, `재분석 예산 초과: ${second.stdout}`);
  const draft = readJson(path.join(path.dirname(second.json.compactInventoryPath), 'draft.json'));
  const budgets = Object.fromEntries(draft.engine.selfCost.budgets.map((b) => [b.budgetId, b]));
  assert.equal(draft.engine.sessions.coverage.incremental, true);
  assert.equal(budgets.reanalysis_engine_ms.status, 'within');
  assert.equal(budgets.engine_max_rss_bytes.status, 'within');
  assert.equal(budgets.llm_input_inventory_tokens.status, 'within');
  assert.equal(draft.engine.sessions.dedup.uniqueResponses, draft1.engine.sessions.dedup.uniqueResponses + 1);
});

// 최근 응답이 많은 기록의 최초·증분 집계. events면 응답마다 이벤트 6개(실제 이력 비율)를 넣어 이벤트 키 집합의 메모리도 본다.
function denseBudget(t, { events }) {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'dense-config');
  const { bytes, responses } = writeDenseLogs(configDir, { project: p.project, events });
  assert.equal(responses, 120000);
  assert.ok(bytes > 160e6, `기록 크기 ${bytes}`);
  const rss = (draft) => Math.max(...draft.engine.selfCost.currentRun.map((r) => r.maxRssBytes));
  const first = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-27T09:00:00Z', '--strict-budget', '--json'], { configDir });
  assert.equal(first.code, 0, `최초 집계 예산 초과: ${first.stdout}`);
  const draft1 = readJson(path.join(path.dirname(first.json.compactInventoryPath), 'draft.json'));
  assert.equal(draft1.engine.sessions.dedup.uniqueResponses, 120000);
  assert.ok(rss(draft1) <= 200 * 1024 * 1024, `최초 RSS ${rss(draft1)}`);
  if (events) assert.equal(draft1.engine.sessions.axisMetrics.find((m) => m.metricId === 'tool_error_rate').sampleSize, 240000);
  writeFileSync(first.json.interpretationPath, readFileSync(exampleInterpretation('harness-before')));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', first.json.runId, '--now', '2026-11-27T09:00:00Z', '--no-open', '--json'], { configDir });
  assert.equal(fin.code, 0, fin.stdout);
  // 확정 상태(응답 12만 개, 이벤트 키)를 읽어 들이는 증분 재분석
  const second = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-28T09:00:00Z', '--strict-budget', '--json'], { configDir });
  assert.equal(second.code, 0, `증분 재분석 예산 초과: ${second.stdout}`);
  const draft2 = readJson(path.join(path.dirname(second.json.compactInventoryPath), 'draft.json'));
  assert.equal(draft2.engine.sessions.coverage.incremental, true);
  assert.equal(draft2.engine.sessions.dedup.uniqueResponses, 120000);
  assert.ok(rss(draft2) <= 200 * 1024 * 1024, `증분 RSS ${rss(draft2)}`);
  const ms = (d) => d.engine.selfCost.currentRun.find((r) => r.subcommand === 'prepare').durationMs;
  t.diagnostic(`최초 RSS ${(rss(draft1) / 1048576).toFixed(1)}MiB ${ms(draft1)}ms · 증분 RSS ${(rss(draft2) / 1048576).toFixed(1)}MiB ${ms(draft2)}ms`);
}

test('최근 응답이 많은 기록(7일·400세션·12만 응답·약 166MB): 최초·증분 모두 메모리 200MiB 이하(--strict-budget)', (t) => denseBudget(t, { events: false }));

test('도구 이벤트가 있는 큰 기록(12만 응답, 응답당 이벤트 6개 = 72만): 최초·증분 모두 메모리 200MiB 이하(--strict-budget)', (t) => denseBudget(t, { events: true }));
