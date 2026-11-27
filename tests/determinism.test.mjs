// 결정론(engine-cli.md §10, PRD §13): 같은 입력이면 수집·해시·비교 결과가 바이트 단위로 같다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, engine, exampleInterpretation, makeProject, readJson, swapFixture } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

// 실행 시간·메모리는 입력이 아니라 실행 환경에서 오므로 비교에서 뺀다.
function stripTiming(draft) {
  const d = structuredClone(draft);
  d.engine.selfCost.currentRun = [];
  for (const b of d.engine.selfCost.budgets) if (b.unit === 'ms' || b.unit === 'bytes') b.observed = null;
  return d;
}

test('같은 구성을 두 번 수집하면 엔진 산출물이 바이트 단위로 같다', (t) => {
  const a = makeProject('harness-after');
  t.after(a.cleanup);
  const ra = engine(['prepare', '--project', a.project, '--out', `${a.out}-1`, '--now', NOW, '--json']);
  const rb = engine(['prepare', '--project', a.project, '--out', `${a.out}-2`, '--now', NOW, '--json']);
  assert.equal(ra.json.runId, rb.json.runId);
  const dirA = path.dirname(ra.json.compactInventoryPath);
  const dirB = path.dirname(rb.json.compactInventoryPath);
  for (const f of ['inventory.json', 'inventory.compact.json', 'sessions.json', 'interpretation.template.json']) {
    assert.equal(readFileSync(path.join(dirA, f), 'utf8'), readFileSync(path.join(dirB, f), 'utf8'), f);
  }
  assert.deepEqual(stripTiming(readJson(path.join(dirA, 'draft.json'))), stripTiming(readJson(path.join(dirB, 'draft.json'))));
});

test('같은 변경을 두 번 분석하면 비교 결과(변경 ID 포함)가 같다', (t) => {
  const run = () => {
    const p = makeProject('harness-before');
    analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before') });
    swapFixture(p.project, 'harness-after');
    const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-28T09:00:00Z', '--json']);
    const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
    p.cleanup();
    return draft;
  };
  const x = run();
  const y = run();
  assert.equal(x.meta.configurationHash, y.meta.configurationHash);
  assert.deepEqual(x.engine.comparison, y.engine.comparison);
  assert.equal(x.engine.comparison.componentChanges.length, 5);
});

test('CRLF·BOM 차이는 구성 해시를 바꾸지 않는다', (t) => {
  const a = makeProject('harness-before');
  const b = makeProject('harness-before');
  t.after(() => { a.cleanup(); b.cleanup(); });
  const file = path.join(b.project, 'CLAUDE.md');
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, `\uFEFF${text.replace(/\n/g, '\r\n')}`);
  const ha = engine(['collect', '--project', a.project, '--out', a.out, '--now', NOW, '--json']).json.configurationHash;
  const hb = engine(['collect', '--project', b.project, '--out', b.out, '--now', NOW, '--json']).json.configurationHash;
  assert.equal(ha, hb);
});
