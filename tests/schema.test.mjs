// 실행: node --test tests/*.test.mjs (또는 engine/에서 npm test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createValidator } from '../engine/src/schema-validator.mjs';
import { runSemanticChecks } from '../engine/src/checks.mjs';

const root = new URL('../', import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, root)), 'utf8'));

const schema = readJson('skills/harness-analyze/schemas/analysis.schema.json');
const example = readJson('examples/analysis.example.json');
const validate = createValidator(schema);

const clone = () => structuredClone(example);
const failedChecks = (doc) => runSemanticChecks(doc).filter((r) => r.status === 'fail').map((r) => r.checkId);

test('스키마는 draft 2020-12이고 schemaVersion 0.1을 고정한다', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, '0.1');
});

test('예시가 스키마를 통과한다', () => {
  assert.deepEqual(validate(example), []);
});

test('예시가 의미 검사(V-*)를 모두 통과한다', () => {
  const failures = runSemanticChecks(example).filter((r) => r.status === 'fail');
  assert.deepEqual(failures, []);
});

test('예시의 validation.checks는 참조 검사 결과와 어긋나지 않는다', () => {
  const recorded = new Map(example.validation.checks.map((c) => [c.checkId, c.status]));
  for (const r of runSemanticChecks(example)) {
    if (recorded.has(r.checkId)) assert.equal(recorded.get(r.checkId), r.status, r.checkId);
  }
});

test('LLM 영역에 수준을 쓰면 스키마가 거부한다', () => {
  const doc = clone();
  doc.interpretation.axisNotes[0].level = 3;
  assert.ok(validate(doc).some((e) => e.includes('interpretation.axisNotes[0].level')));
});

test('축 순서가 바뀌거나 축이 빠지면 거부한다', () => {
  const swapped = clone();
  [swapped.engine.axes[0], swapped.engine.axes[1]] = [swapped.engine.axes[1], swapped.engine.axes[0]];
  assert.notDeepEqual(validate(swapped), []);
  const missing = clone();
  missing.engine.axes.pop();
  assert.notDeepEqual(validate(missing), []);
});

test('판정 불가 축은 level이 null이어야 한다', () => {
  const doc = clone();
  doc.engine.axes[3].levelStatus = 'unknown';
  assert.notDeepEqual(validate(doc), []);
  doc.engine.axes[3].level = null;
  doc.engine.axes[3].source.ruleId = null;
  assert.deepEqual(validate(doc), []);
  assert.ok(failedChecks(doc).includes('V-EMPTY-AREAS'), '빈 영역 종류가 unknown으로 바뀌어야 한다');
});

test('관찰 사실 finding은 근거가 있어야 하고, 추정은 조건과 검증 방법이 필요하다', () => {
  const observed = clone();
  observed.interpretation.findings[0].evidenceIds = [];
  assert.notDeepEqual(validate(observed), []);
  const inferred = clone();
  inferred.interpretation.findings[1].condition = null;
  assert.notDeepEqual(validate(inferred), []);
});

test('실측 상태 축은 measured 값이 있어야 한다', () => {
  const doc = clone();
  doc.engine.axes[2].measured = null;
  assert.notDeepEqual(validate(doc), []);
});

test('근거 하나를 두 축 판정에 쓰면 V-SINGLE-ATTRIBUTION이 실패한다', () => {
  const doc = clone();
  doc.engine.axes[0].source.evidenceIds.push('ev_000000000008');
  assert.ok(failedChecks(doc).includes('V-SINGLE-ATTRIBUTION'));
});

test('후보에 없는 긴장을 LLM이 만들면 V-REF-TENSION이 실패한다', () => {
  const doc = clone();
  doc.interpretation.currentTradeoffs.axisTensions[0].tensionId = 'T7';
  assert.ok(failedChecks(doc).includes('V-REF-TENSION'));
});

test('수준 2 미만 축을 투자 축으로 쓰면 V-INVEST-FORGO가 실패한다', () => {
  const doc = clone();
  doc.interpretation.currentTradeoffs.investForgo.invested.push('throughput');
  assert.ok(failedChecks(doc).includes('V-INVEST-FORGO'));
});

test('변경 트레이드오프가 변경을 덮지 않으면 V-CHANGE-COVERAGE가 실패한다', () => {
  const doc = clone();
  doc.interpretation.changeTradeoffs = [];
  assert.ok(failedChecks(doc).includes('V-CHANGE-COVERAGE'));
});

test('스키마 검사기는 모르는 키워드를 만나면 예외를 던진다', () => {
  const v = createValidator({ type: 'object', patternProperties: {} });
  assert.throws(() => v({}), /patternProperties/);
});
