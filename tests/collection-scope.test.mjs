import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collect } from '../engine/src/collect.mjs';
import { computeAxes, computeMaturity } from '../engine/src/rubric.mjs';
import { emptySessions } from '../engine/src/session-aggregate.mjs';
import { createValidator } from '../engine/src/schema-validator.mjs';
import { bundle, engine, readJson, tempDir } from './helpers.mjs';

function setup(t) {
  const base = tempDir('hl-gates-');
  const p = { base, project: path.join(base, 'project'), out: path.join(base, 'out') };
  mkdirSync(p.project);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const write = (rel, text) => {
    const dest = path.join(p.project, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
    return dest;
  };
  const collectNow = () => collect({ projectRoot: p.project, scope: 'project', configDir: path.join(p.base, 'empty'), skillDir: path.dirname(path.dirname(bundle)) });
  return { ...p, write, collectNow };
}

test('CI·Git Hook은 읽기 전용 수집·근거·해시에 포함하고 주석·이름·환경 변수는 판정에서 뺀다', (t) => {
  const p = setup(t);
  p.write('.github/workflows/check.yml', 'name: spec test\nenv:\n  TEXT: npm test\njobs:\n  check:\n    steps:\n      - run: |\n          npm test\n          npm run acceptance\n');
  p.write('.gitlab-ci.yml', '# npm test\nname: test\nvariables:\n  X: npm test\n');
  p.write('.husky/pre-commit', '#!/bin/sh\nnpm test\n');
  const first = p.collectNow();
  const ci = first.components.find((c) => c.name === '.github/workflows/check.yml');
  assert.equal(ci.kind, 'ci');
  const evidence = first.evidence.filter((e) => e.componentId === ci.id);
  assert.ok(evidence.some((e) => e.ruleIds.includes('VG-L2-04')));
  assert.ok(evidence.some((e) => e.ruleIds.includes('SC-L2-04')));
  const gitlab = first.components.find((c) => c.name === '.gitlab-ci.yml');
  assert.ok(first.evidence.filter((e) => e.componentId === gitlab.id).every((e) => !e.ruleIds.length));
  assert.equal(first.components.find((c) => c.name === '.husky/pre-commit').attributes.active, false);
  p.write('.github/workflows/check.yml', 'jobs:\n  check:\n    steps:\n      - run: npm run lint\n');
  assert.notEqual(p.collectNow().configurationHash, first.configurationHash);
  assert.equal(readFileSync(path.join(p.project, '.husky/pre-commit'), 'utf8'), '#!/bin/sh\nnpm test\n');
});

test('Git Hook 활성 경로·실행 비트·실패 종료 표지를 확인하며 Claude disableAllHooks는 Git Hook을 무력화하지 않는다', (t) => {
  const p = setup(t);
  p.write('.git/config', '[core]\n hooksPath = .githooks\n');
  p.write('.claude/settings.json', '{"disableAllHooks":true}');
  const hook = p.write('.githooks/pre-commit', '#!/bin/sh\nset -e\nnpm test\n');
  chmodSync(hook, 0o755);
  p.write('.git/hooks/pre-push', '#!/bin/sh\nset -e\nnpm test\n');
  p.write('.githooks/pre-commit.sample', 'npm test');
  const col = p.collectNow();
  const hooks = col.components.filter((c) => c.kind === 'git_hook');
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].attributes.active, true);
  const ev = col.evidence.find((e) => e.componentId === hooks[0].id && e.primaryAxis);
  assert.deepEqual(ev.ruleIds, ['VG-L3-04']);
  assert.equal(ev.void, null);
  const axes = computeMaturity(computeAxes(col, { scope: 'project' }), emptySessions('disabled', null));
  assert.equal(axes.find((a) => a.axis === 'verification_gate_strength').level, 3);
  for (const axis of ['spec_clarity', 'verification_gate_strength']) {
    const a = axes.find((a) => a.axis === axis);
    assert.equal(a.maturity.state, 'predicted');
    assert.equal(a.maturity.blockedReason, 'needs_ci_pr_results');
  }
  chmodSync(hook, 0o644);
  const inactive = p.collectNow();
  assert.ok(inactive.evidence.some((e) => e.ruleIds.includes('VG-L2-04')));
  assert.notEqual(inactive.configurationHash, col.configurationHash, '실행 비트 변화도 구성 변경이다');
});

test('CI·Hook의 심볼릭 링크·외부 hooksPath는 루트 밖 파일을 수집하지 않는다', (t) => {
  const p = setup(t);
  const outside = path.join(p.base, 'outside.yml');
  writeFileSync(outside, 'run: npm test\n');
  p.write('.github/workflows/inside.yml', 'name: only\n');
  symlinkSync(outside, path.join(p.project, '.github/workflows/escape.yml'));
  p.write('.git/config', '[core]\n hooksPath = ../outside\n');
  const col = p.collectNow();
  assert.ok(col.sources.some((s) => s.path === '.github/workflows/escape.yml' && s.status === 'out_of_scope'));
  assert.ok(!col.components.some((c) => c.name.includes('escape')));
  assert.ok(!JSON.stringify(col).includes('run: npm test'));
});

test('새 구성 요소 종류는 prepare·validate 계약을 통과한다', (t) => {
  const p = setup(t);
  p.write('.github/workflows/ci.yml', 'steps:\n  - run: npm test\n');
  p.write('.pre-commit-config.yaml', 'repos:\n  - repo: local\n    hooks:\n      - id: check\n        entry: npm run acceptance\n');
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--no-sessions', '--json']);
  assert.equal(prep.code, 0, prep.stderr);
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  assert.ok(draft.engine.inventory.components.some((c) => c.kind === 'ci'));
  assert.ok(draft.engine.inventory.components.some((c) => c.kind === 'git_hook'));
  const skillDir = path.dirname(path.dirname(bundle));
  const schema = readJson(path.join(skillDir, 'schemas/analysis.schema.json'));
  const example = readJson(path.join(skillDir, '../../examples/analysis.example.json'));
  assert.deepEqual(createValidator(schema)({ ...draft, interpretation: example.interpretation, validation: example.validation }), []);
});
