// 검증 실패는 정상 결과로 저장하지 않는다(FR-04, FR-09, engine-cli.md §4.5·§11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { engine, exampleInterpretation, makeProject, readJson } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

function prepared(t) {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json']);
  assert.equal(prep.code, 0, prep.stderr);
  const finalize = () => engine(['finalize', '--project', p.project, '--out', p.out, '--run', prep.json.runId, '--now', NOW, '--no-open', '--json']);
  const snapshots = () => (existsSync(path.join(p.out, 'snapshots')) ? readdirSync(path.join(p.out, 'snapshots')) : []);
  const good = () => readJson(exampleInterpretation('harness-before'));
  return { p, prep, finalize, snapshots, good, write: (v) => writeFileSync(prep.json.interpretationPath, typeof v === 'string' ? v : JSON.stringify(v)) };
}

function failedIds(result) {
  return result.json.checks.filter((c) => c.status === 'fail').map((c) => c.checkId);
}

test('해석이 없거나 JSON이 아니면 30으로 실패하고 스냅샷을 만들지 않는다', (t) => {
  const c = prepared(t);
  assert.equal(c.finalize().code, 30);
  c.write('{ not json');
  const r = c.finalize();
  assert.equal(r.code, 30);
  assert.deepEqual(failedIds(r), ['V-SCHEMA']);
  assert.deepEqual(c.snapshots(), []);
});

test('LLM이 수준을 쓰거나 없는 근거를 참조하면 거부한다', (t) => {
  const c = prepared(t);
  const bad = c.good();
  bad.axisNotes[0].level = 3;
  c.write(bad);
  let r = c.finalize();
  assert.equal(r.code, 30);
  assert.deepEqual(failedIds(r), ['V-SCHEMA']);

  const badRef = c.good();
  badRef.findings[0].evidenceIds = ['ev_000000000000'];
  badRef.currentTradeoffs.investForgo.invested.push('throughput');
  badRef.currentTradeoffs.emptyAreas = [];
  c.write(badRef);
  r = c.finalize();
  assert.equal(r.code, 30);
  assert.deepEqual(failedIds(r).sort(), ['V-EMPTY-AREAS', 'V-INVEST-FORGO', 'V-REF-EVIDENCE']);
  assert.deepEqual(c.snapshots(), []);
  const runAnalysis = readJson(path.join(c.p.out, 'runs', c.prep.json.runId, 'analysis.json'));
  assert.equal(runAnalysis.validation.status, 'invalid', '실패 결과는 runs/에만 남는다');
  assert.equal(readJson(path.join(c.p.out, 'runs', c.prep.json.runId, 'run.json')).status, 'failed');
});

test('해석에 비밀정보가 들어가면 V-SECRET-RESCAN으로 실패한다', (t) => {
  const c = prepared(t);
  const bad = c.good();
  bad.limitations.push('토큰 sk-ant-fixture-0000FAKE0000FAKE0000FAKE를 확인함');
  c.write(bad);
  const r = c.finalize();
  assert.equal(r.code, 30);
  assert.deepEqual(failedIds(r), ['V-SECRET-RESCAN']);
  assert.deepEqual(c.snapshots(), []);
});

test('엔진 영역이 바뀌면 31로 거부하고, 고친 해석은 다시 통과한다', (t) => {
  const c = prepared(t);
  const draftFile = path.join(c.p.out, 'runs', c.prep.json.runId, 'draft.json');
  const original = readFileSync(draftFile, 'utf8');
  const tampered = JSON.parse(original);
  tampered.engine.axes[3].level = 3;
  writeFileSync(draftFile, JSON.stringify(tampered));
  c.write(c.good());
  assert.equal(c.finalize().code, 31);
  writeFileSync(draftFile, original);
  const r = c.finalize();
  assert.equal(r.code, 0, r.stdout);
  assert.equal(c.snapshots().filter((d) => !d.startsWith('.')).length, 2, 'index.json + 스냅샷 디렉터리');
  // 같은 스냅샷 ID는 덮어쓰지 않는다.
  assert.equal(engine(['snapshot', '--out', c.p.out, '--project', c.p.project, '--run', c.prep.json.runId]).code, 40);
});

test('스키마 검사 대상 예시(examples/analysis.example.json)도 엔진 검증기를 통과한다', async () => {
  const { validateDocument } = await import('../engine/src/validate.mjs');
  const example = JSON.parse(readFileSync(new URL('../examples/analysis.example.json', import.meta.url), 'utf8'));
  const { validation, ...doc } = example;
  assert.deepEqual(validateDocument(doc).filter((x) => x.status === 'fail'), []);
});
