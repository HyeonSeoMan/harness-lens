// 루브릭 0.2 소유자 결정: 가능 범위, ES-L3-04, 자기 구성 요소 라벨, T1 트리거.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { engine, makeProject, readJson, tempDir } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

function draftOf(p, opts = {}) {
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json'], opts);
  assert.equal(prep.code, 0, prep.stderr);
  return readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
}

test('사용자 설정 파일이 없으면 가능 범위를 프로젝트 근거로만 좁힌다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const d = draftOf(p);
  // 0.2 결정(가능 범위)은 0.3에서도 그대로다.
  assert.equal(d.rubricVersion, '0.4');
  for (const a of d.engine.axes) {
    assert.equal(a.range.max, a.level, `${a.axis} ${JSON.stringify(a.range)}`);
    assert.ok(!a.range.reasonCodes.includes('user_scope_not_collected'));
  }
  assert.ok(d.engine.limitations.some((l) => l.code === 'user_scope_absent'));
});

test('수집하지 않은 사용자 설정 파일이 실제로 있으면 범위를 넓히고 출처로 보고한다(열지 않음)', (t) => {
  const p = makeProject('harness-before');
  const configDir = tempDir('hl-user-');
  t.after(() => { p.cleanup(); rmSync(configDir, { recursive: true, force: true }); });
  writeFileSync(path.join(configDir, 'settings.json'), '{"permissions":{"allow":["Bash"]},"env":{"SECRET_TOKEN":"never-read-value"}}');
  const d = draftOf(p, { configDir });
  for (const a of d.engine.axes) {
    assert.equal(a.range.max, a.axis === 'throughput' ? 2 : 3, a.axis);
    assert.equal(a.range.reasonCodes.includes('user_scope_not_collected'), a.level < a.range.max, a.axis);
  }
  const src = d.engine.inventory.sources.find((s) => s.origin === 'user');
  assert.deepEqual([src.status, src.reason], ['out_of_scope', 'user_scope_not_collected']);
  assert.equal(d.meta.scope.preset, 'project');
  assert.ok(!JSON.stringify(d).includes('never-read-value'));
});

test('Harness Lens 자신만 설치된 사용자 skills 디렉터리는 범위를 넓히지 않는다', (t) => {
  const p = makeProject('harness-before');
  const configDir = tempDir('hl-user-');
  t.after(() => { p.cleanup(); rmSync(configDir, { recursive: true, force: true }); });
  mkdirSync(path.join(configDir, 'skills', 'harness-analyze'), { recursive: true });
  const d = draftOf(p, { configDir });
  assert.ok(d.engine.axes.every((a) => !a.range.reasonCodes.includes('user_scope_not_collected')));
});

test('Subagent가 하나뿐이면 maxTurns가 있어도 실행 안정성은 2다(ES-L3-03 폐기, ES-L3-04)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const es = draftOf(p).engine.axes.find((a) => a.axis === 'execution_stability');
  assert.deepEqual([es.level, es.source.ruleId], [2, 'ES-L2-01']);
});

test('자기 구성 요소는 설치 위치와 무관한 고정 라벨을 쓴다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const self = draftOf(p).engine.inventory.components.find((c) => c.kind === 'harness_lens');
  assert.deepEqual(self.paths, ['harness-lens/SKILL.md']);
});

test('PostToolUse 차단 테스트 Hook(VG-L2-03)이 T1(검증 ↔ 속도) 후보를 만든다', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const d = draftOf(p);
  const t1 = d.engine.tensionCandidates.find((x) => x.tensionId === 'T1');
  assert.ok(t1, 'T1 후보가 있어야 한다');
  assert.deepEqual(t1.axes, ['verification_gate_strength', 'throughput']);
  const hook = d.engine.evidence.find((e) => e.ruleIds.includes('VG-L2-03'));
  assert.deepEqual(t1.evidenceIds, [hook.id]);
});
