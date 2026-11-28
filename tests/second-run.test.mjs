import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { diffAnalyses } from '../engine/src/diff.mjs';
import { renderReport } from '../engine/src/render.mjs';
import { aggregateSessions } from '../engine/src/session-aggregate.mjs';
import { computeMaturity } from '../engine/src/rubric.mjs';
import { makeProject, repoRoot } from './helpers.mjs';
import { appendResponse, writeSyntheticLogs } from './support/synth-sessions.mjs';

const example = () => JSON.parse(readFileSync(path.join(repoRoot, 'examples/analysis.example.json')));

test('N3: 엔진 변경 때 수집 신규·삭제·해시 변경은 unknown, 같은 엔진은 added·removed·modified', () => {
  const prev = example();
  const cur = structuredClone(prev);
  cur.meta.snapshotId = '20261128T140600Z-0ab0c1ca';
  const comps = cur.engine.inventory.components;
  comps[0].contentHash = 'changed';
  comps.pop();
  comps.push({ ...comps[0], id: 'c_new', name: 'new', paths: ['new'] });
  // 마지막을 교체했으므로 동일 엔진에서는 세 가지 변경 모두 관측된다.
  const same = diffAnalyses(prev, cur);
  assert.deepEqual(new Set(same.componentChanges.map((x) => x.change)), new Set(['added', 'removed', 'modified']));
  cur.meta.engineInfo.version = 'next';
  const changed = diffAnalyses(prev, cur);
  assert.equal(changed.comparability, 'limited');
  assert.ok(changed.componentChanges.every((x) => x.change === 'unknown'));
  assert.ok(changed.limitations.some((x) => x.code === 'collector_version_changed'));
});

test('N6: 루트와 스냅샷 양쪽의 analysis.json 위치 안내', () => {
  const a = example();
  assert.ok(renderReport(a).includes(`snapshots/${a.meta.snapshotId}/analysis.json`));
  assert.match(renderReport(a), /스냅샷 폴더에서 열었다면 같은 폴더의 analysis.json/);
});

test('N2: 귀속된 봇도 자기 비용에 포함하고 대상 밖 cwd 응답은 제외한다', (t) => {
  const p = makeProject('harness-before'); t.after(p.cleanup);
  const configDir = path.join(p.base, 'config');
  const bots = path.join(p.base, 'bots');
  const botDir = path.join(bots, 'analysis-bot');
  mkdirSync(botDir, { recursive: true }); mkdirSync(p.out, { recursive: true });
  writeFileSync(path.join(p.out, 'config.json'), JSON.stringify({ orcaPaths: { bots }, sessionAttribution: { bots: { 'analysis-bot': p.project } } }));
  const startMs = Date.parse('2026-11-25T00:00:00Z');
  writeSyntheticLogs(configDir, { project: p.project, sessions: 0, botDir, startMs });
  appendResponse(path.join(configDir, 'projects', '-syn-bot', 'outside.jsonl'), { sid: 'outside', project: path.join(p.base, 'another'), id: 'outside', t: startMs + 1000, usage: { input_tokens: 99999, output_tokens: 99999 } });
  const r = aggregateSessions({ projectRoot: p.project, configDir, out: p.out, nowMs: startMs + 48 * 3600000, previousWindow: { startMs, endMs: startMs + 48 * 3600000 } });
  assert.equal(r.previousTokens.freshInput, 40 * 3);
  assert.equal(r.previousTokens.output, 40 * 120);
  assert.equal(r.sessions.coverage.sessionsExcluded, 1);
});

test('N8: 도구 없는 19세션은 사용량에 남고 작업 표본은 9세션만 센다', (t) => {
  const p = makeProject('harness-before'); t.after(p.cleanup);
  const configDir = path.join(p.base, 'config');
  writeSyntheticLogs(configDir, { project: p.project, sessions: 19, toolsPerSession: 0, prefix: 'empty' });
  writeSyntheticLogs(configDir, { project: p.project, sessions: 9, toolsPerSession: 3, prefix: 'work' });
  const r = aggregateSessions({ projectRoot: p.project, configDir, out: p.out, configSinceMs: Date.parse('2026-11-01T00:00:00Z'), nowMs: Date.parse('2026-11-28T00:00:00Z') });
  assert.equal(r.sessions.coverage.sessionsAttributed, 28);
  assert.equal(r.info.samples.active_sessions, 9);
  assert.equal(r.sessions.axisMetrics.find((x) => x.metricId === 'session_duration_p50_ms').sampleSize, 9);
  const axes = computeMaturity(example().engine.axes, r.sessions, r.info);
  for (const id of ['throughput', 'autonomy']) {
    const a = axes.find((x) => x.axis === id);
    assert.equal(a.maturity.current, id === 'throughput' ? 9 : 27, '자율성 요구량은 세션 수가 아니라 도구 호출 수');
    assert.equal(a.maturity.state, 'predicted');
    assert.equal(a.maturity.blockedReason, 'insufficient_samples');
  }
  assert.equal(axes.find((x) => x.axis === 'context_efficiency').maturity.current, 28, '컨텍스트 세션 표본은 유지');
});
