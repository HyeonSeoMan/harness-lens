// 압축 인벤토리 생략 규칙과 예산(engine-cli.md §4.4, §12; DiceForge 결함 #8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { compactInventory } from '../engine/src/cli.mjs';
import { engine, makeProject, readJson } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';
const tokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);

function hasNullOrEmpty(v) {
  if (Array.isArray(v)) return v.some(hasNullOrEmpty);
  if (!v || typeof v !== 'object') return false;
  return Object.values(v).some((x) => x === null || (Array.isArray(x) && x.length === 0) || hasNullOrEmpty(x));
}

test('압축 인벤토리: contentHash와 null·빈 배열 키를 빼고, 예산 안이면 fact를 그대로 둔다', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json', '--no-sessions']);
  assert.equal(prep.code, 0, prep.stderr);
  const compact = readJson(prep.json.compactInventoryPath);
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  assert.ok(compact.engine.inventory.components.every((c) => !('contentHash' in c)));
  assert.ok(draft.engine.inventory.components.every((c) => c.contentHash), '스냅샷(draft)에는 그대로 남는다');
  assert.equal(hasNullOrEmpty(compact), false);
  assert.deepEqual(compact.compaction, { omitted: ['contentHash', 'null_and_empty_array_keys'], omittedFacts: 0 });
  assert.equal(compact.engine.evidence.length, draft.engine.evidence.length);
  assert.ok(compact.engine.evidence.every((e) => e.fact));
  assert.ok(prep.json.estimatedInventoryTokens <= 6000);
});

// 근거가 많은 하네스(DiceForge 규모)를 흉내 낸 초안.
function bigDraft(perAxis, factBytes) {
  const axesIds = ['spec_clarity', 'execution_stability', 'safety_boundary'];
  const evidence = [];
  let n = 0;
  for (const axis of axesIds) {
    for (let i = 0; i < perAxis; i++) {
      const lvl = i % 4;
      evidence.push({
        id: `ev_${String(n++).padStart(12, '0')}`, componentId: 'c_000000000001', path: 'CLAUDE.md', line: i + 1, keyPath: null,
        fact: `${axis} ${i} ${'가'.repeat(factBytes)}`, mechanism: 'instruction', primaryAxis: axis, secondaryAxes: [],
        ruleIds: [`${axis === 'spec_clarity' ? 'SC' : axis === 'execution_stability' ? 'ES' : 'SB'}-L${lvl}-0${i % 3}`], void: null, levelCap: null,
      });
    }
  }
  const axes = axesIds.map((axis) => ({ axis, level: 3, source: { ruleId: evidence.find((e) => e.primaryAxis === axis && e.ruleIds[0].includes('-L3-')).ruleIds[0], evidenceIds: [], capRuleIds: [] } }));
  return {
    draft: {
      schemaVersion: '0.1', rubricVersion: '0.3', meta: { snapshotId: 'x' },
      engine: {
        inventory: { components: [{ id: 'c_000000000001', kind: 'claude_md', name: 'CLAUDE.md', contentHash: `sha256:${'0'.repeat(64)}`, attributes: { a: null } }], sources: [] },
        evidence, axes, tensionCandidates: [], sessions: { status: 'disabled', contextPerTurn: null, tokens: null }, comparison: null, limitations: [],
        selfCost: { componentId: 'c_000000000001', alwaysLoadedTokens: { value: 1 } },
      },
    },
    evidence,
  };
}

test('압축 인벤토리: 예산을 넘으면 근거 fact를 축별 상위 N개로 줄여 6,000토큰 안에 넣는다(결정론)', () => {
  const { draft } = bigDraft(20, 120);
  const text = compactInventory(draft, []);
  assert.equal(text, compactInventory(draft, []), '같은 입력이면 같은 결과');
  assert.ok(tokens(text) <= 5400, `${tokens(text)}: 10% 여유 목표`);
  const c = JSON.parse(text);
  const N = c.compaction.factLimitPerAxis;
  assert.ok(N >= 1 && N < 20);
  assert.equal(c.engine.evidence.length, 60, '근거는 빠지지 않고 fact만 생략한다');
  for (const axis of ['spec_clarity', 'execution_stability', 'safety_boundary']) {
    const list = c.engine.evidence.filter((e) => e.primaryAxis === axis);
    const kept = list.filter((e) => e.fact);
    assert.equal(kept.length, N, axis);
    // 축 수준을 정한 규칙의 근거가 먼저 남는다.
    const decisive = draft.engine.axes.find((a) => a.axis === axis).source.ruleId;
    assert.ok(kept.some((e) => e.ruleIds.includes(decisive)));
    assert.ok(list.every((e) => e.id && e.path && e.ruleIds.length), 'ID·경로·규칙은 남는다');
  }
  assert.equal(c.compaction.omittedFacts, 60 - 3 * N);
  // 자르지 않으면 예산을 넘는 입력이다(자르기가 실제로 필요했다).
  const full = JSON.parse(text);
  const facts = new Map(draft.engine.evidence.map((e) => [e.id, e.fact]));
  full.engine.evidence.forEach((e) => { e.fact = facts.get(e.id); });
  assert.ok(tokens(`${JSON.stringify(full)}\n`) > 6000);
});

test('N1: 커진 인벤토리의 중복 경로·read 출처를 복원 가능하게 압축해 추가 데이터 여유를 확보한다', () => {
  const { draft } = bigDraft(20, 120);
  const comp = draft.engine.inventory.components[0];
  comp.origin = 'project_shared';
  comp.paths = ['.claude/skills/project-with-long-name/requirements/SKILL.md', '.claude/helpers/other.mjs'];
  comp.name = comp.paths[0];
  draft.engine.inventory.sources = [
    { path: comp.paths[0], origin: comp.origin, status: 'read' },
    { path: comp.paths[0], origin: 'user', status: 'out_of_scope', reason: 'user_scope_not_collected' },
    { path: '.claude/helpers/unlisted.mjs', origin: comp.origin, status: 'read' },
  ];
  draft.engine.evidence.forEach((e) => { e.path = comp.paths[0]; });
  draft.engine.evidence[0].path = comp.paths[1];
  draft.engine.evidence[1].path = '.claude/helpers/unlisted.mjs';
  draft.engine.sessions.axisMetrics = [{ metricId: 'test_metric', value: 0.4, sampleSize: 24, models: 'm'.repeat(7500) }];
  const original = structuredClone(draft);
  const text = compactInventory(draft, []);
  const compact = JSON.parse(text);
  assert.ok(compact.compaction.omitted.includes('evidence_path_equal_first_component_path'));
  assert.equal(text, compactInventory(draft, []), '추가 압축도 결정론적');
  assert.ok(compact.compaction.omitted.includes('read_sources_in_components'));
  assert.ok(tokens(text) <= 5400, `${tokens(text)}`);
  const restored = compact.engine.evidence.map((e) => ({ ...e, path: e.path ?? compact.engine.inventory.components.find((c) => c.id === e.componentId).paths[0] }));
  assert.deepEqual(restored.map((e) => [e.id, e.path, e.ruleIds]), original.engine.evidence.map((e) => [e.id, e.path, e.ruleIds]));
  assert.deepEqual(compact.engine.inventory.sources, original.engine.inventory.sources.slice(1), '다른 출처·미등록 경로는 유지');
  assert.deepEqual(compact.engine.sessions.axisMetrics, original.engine.sessions.axisMetrics);
  assert.deepEqual(draft, original, '추가 압축은 원본 전체를 보존');
  // 최종 단계에 이미 도달한 뒤에도 300토큰의 데이터 증가를 상한 안에서 수용한다.
  draft.engine.sessions.axisMetrics.push({ metricId: 'growth', value: 'x'.repeat(1200), sampleSize: 30 });
  assert.ok(tokens(compactInventory(draft, [])) <= 6000);
  assert.deepEqual(original.engine.evidence, draft.engine.evidence, '원본 근거 보존');
});

test('실측 요약이 커 fact 최소치로도 넘으면 설명 속성·재구성 가능한 중복만 생략한다', () => {
  const { draft } = bigDraft(4, 40);
  const comp = draft.engine.inventory.components[0];
  comp.paths = ['CLAUDE.md'];
  comp.attributes = { description: '설명'.repeat(5000), command: 'npm test', headings: ['title'], active: false };
  draft.engine.axes.forEach((a) => { a.source.evidenceIds = draft.engine.evidence.filter((e) => e.primaryAxis === a.axis).map((e) => e.id); });
  draft.engine.sessions.axisMetrics = [{ metricId: 'example_metric', value: 0.4, sampleSize: 24 }];
  const original = structuredClone(draft);
  const text = compactInventory(draft, []);
  const compact = JSON.parse(text);
  assert.ok(tokens(text) <= 6000);
  assert.ok(compact.compaction.omitted.includes('descriptive_component_attributes'));
  assert.equal(compact.engine.inventory.components[0].name, undefined);
  assert.deepEqual(compact.engine.inventory.components[0].attributes, { active: false });
  assert.ok(compact.engine.axes.every((a) => !('evidenceIds' in a.source)));
  assert.deepEqual(compact.engine.sessions.axisMetrics, original.engine.sessions.axisMetrics);
  assert.deepEqual(compact.engine.evidence.map((e) => e.id), original.engine.evidence.map((e) => e.id));
  assert.deepEqual(draft, original, '정식 인벤토리·스냅샷은 바꾸지 않는다');
});
