// 수직 슬라이스 e2e: harness-before 첫 분석 → harness-after 재분석. LLM 대신 examples/interpretations의 예시 해석을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { analyze, engine, exampleInterpretation, makeProject, readJson, swapFixture } from './helpers.mjs';

const T1 = '2026-11-27T09:00:00Z';
const T2 = '2026-11-28T09:00:00Z';

function runBoth() {
  const p = makeProject('harness-before');
  const first = analyze({ project: p.project, out: p.out, now: T1, interpretation: exampleInterpretation('harness-before') });
  const firstReport = readFileSync(path.join(p.out, 'report.html'), 'utf8');
  swapFixture(p.project, 'harness-after');
  const second = analyze({ project: p.project, out: p.out, now: T2, interpretation: exampleInterpretation('harness-after') });
  return { p, first, firstReport, second };
}

test('첫 분석과 재분석이 모두 검증을 통과하고 스냅샷·리포트를 만든다', (t) => {
  const { p, first, firstReport, second } = runBoth();
  t.after(p.cleanup);
  assert.equal(first.prep.code, 0, first.prep.stderr);
  assert.equal(first.fin.code, 0, first.fin.stdout);
  assert.equal(first.prep.json.hasComparison, false);
  assert.equal(second.prep.json.hasComparison, true);
  assert.equal(second.fin.code, 0, second.fin.stdout);
  assert.equal(second.fin.json.status, 'valid');

  const index = readJson(path.join(p.out, 'snapshots/index.json'));
  assert.deepEqual(index.map((e) => e.snapshotId), [first.fin.json.snapshotId, second.fin.json.snapshotId]);
  assert.equal(readJson(path.join(p.out, 'latest.json')).snapshotId, second.fin.json.snapshotId);
  assert.ok(existsSync(path.join(p.out, 'snapshots', second.fin.json.snapshotId, 'report.html')));
  assert.equal(readFileSync(path.join(p.out, '.gitignore'), 'utf8'), '*\n');

  // 첫 리포트에는 비교 데이터가 없고, 재분석 리포트에는 있다.
  const data = (html) => JSON.parse(/<script type="application\/json" id="hl-data">(.*)<\/script>/.exec(html)[1]).analysis;
  assert.equal(data(firstReport).engine.comparison, null);
  const after = data(readFileSync(path.join(p.out, 'report.html'), 'utf8'));
  assert.equal(after.engine.comparison.previousSnapshotId, first.fin.json.snapshotId);
});

test('변경 탐지: Subagent·Hook 추가, MCP 서버 삭제, 지침·설정 수정을 구분한다', (t) => {
  const { p, second } = runBoth();
  t.after(p.cleanup);
  const a = readJson(second.fin.json.analysisPath);
  const changes = a.engine.comparison.componentChanges.map((c) => `${c.change}:${c.kind}:${c.name}`);
  assert.deepEqual(changes, [
    'added:agent:reviewer',
    'added:hook:PostToolUse(Edit|Write) run-tests.sh',
    'removed:mcp_server:browser',
    'modified:instructions:CLAUDE.md',
    'modified:settings:.claude/settings.json',
  ]);
  assert.equal(a.engine.comparison.comparability, 'full');
  const vg = a.engine.comparison.axisDeltas.find((d) => d.axis === 'verification_gate_strength');
  assert.deepEqual([vg.previousLevel, vg.currentLevel, vg.comparable], [1, 2, true]);
  const unchanged = a.engine.comparison.axisDeltas.filter((d) => d.axis !== 'verification_gate_strength');
  assert.ok(unchanged.every((d) => d.previousLevel === d.currentLevel));
});

test('엔진이 루브릭 규칙 ID로 수준을 계산한다(LLM 해석과 무관)', (t) => {
  const { p, first, second } = runBoth();
  t.after(p.cleanup);
  const rules = (file) => Object.fromEntries(readJson(file).engine.axes.map((x) => [x.axis, `${x.level}:${x.source.ruleId}`]));
  assert.deepEqual(rules(first.fin.json.analysisPath), {
    spec_clarity: '1:SC-L1-01',
    verification_gate_strength: '1:VG-L1-01',
    execution_stability: '3:ES-L3-03',
    throughput: '0:TP-L0-00',
    cost_efficiency: '2:CE-L2-01',
    context_efficiency: '2:CX-L2-01',
    autonomy: '3:AU-L3-01',
    safety_boundary: '2:SB-L2-01',
  });
  assert.equal(rules(second.fin.json.analysisPath).verification_gate_strength, '2:VG-L2-01');
});

test('세션 집계는 아직 구현되지 않았다고 보고하고 모든 축을 예측으로 둔다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const stub = engine(['aggregate-sessions', '--project', p.project, '--json']);
  assert.equal(stub.code, 0);
  assert.equal(stub.json.implemented, false);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', T1, '--json']);
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  assert.equal(draft.engine.sessions.status, 'unavailable');
  assert.equal(draft.engine.sessions.tokens, null);
  assert.equal(draft.meta.analysisType, 'static');
  assert.ok(draft.engine.axes.every((x) => x.maturity.state === 'predicted' && x.measured === null));
  assert.ok(draft.engine.limitations.some((l) => l.code === 'session_aggregation_not_implemented'));
});

test('prepare가 해석 골격과 압축 인벤토리를 만든다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', T1, '--json']);
  const dir = path.dirname(prep.json.compactInventoryPath);
  assert.deepEqual(readdirSync(dir).sort(), ['draft.json', 'interpretation.template.json', 'inventory.compact.json', 'inventory.json', 'run.json', 'sessions.json']);
  const tpl = readJson(prep.json.interpretationTemplatePath);
  assert.equal(tpl.axisNotes.length, 8);
  assert.deepEqual(tpl.currentTradeoffs.emptyAreas.map((e) => `${e.axis}:${e.kind}`), ['throughput:unconfigured']);
  assert.equal(tpl.changeTradeoffs, null);
  const compact = readJson(prep.json.compactInventoryPath);
  assert.ok(compact.engine.inventory.sources.every((s) => s.status !== 'absent'));
  assert.deepEqual(compact.knowledgeBaseKeys, ['hooks', 'mcp', 'model-routing', 'skills', 'subagents']);
});

test('check-runtime과 사용법 오류 종료 코드', () => {
  const ok = engine(['check-runtime', '--json']);
  assert.equal(ok.code, 0);
  assert.equal(ok.json.ok, true);
  assert.equal(engine(['nope']).code, 2);
  assert.equal(engine(['prepare', '--bogus']).code, 2);
});
