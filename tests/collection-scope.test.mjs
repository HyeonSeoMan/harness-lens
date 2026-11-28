import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { collect } from '../engine/src/collect.mjs';
import { computeAxes, computeMaturity } from '../engine/src/rubric.mjs';
import { emptySessions } from '../engine/src/session-aggregate.mjs';
import { createValidator } from '../engine/src/schema-validator.mjs';
import { bundle, engine, pinMtimes, readJson, tempDir } from './helpers.mjs';
import { writeSyntheticLogs } from './support/synth-sessions.mjs';

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

test('Git Hook 활성 경로·실행 비트·실패 종료 표지를 확인하며 Claude disableAllHooks는 Git Hook을 무력화하지 않는다', { skip: process.platform === 'win32' }, (t) => {
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

test('B1: 최근 .git/config와 무관한 Git 설정 변경이 실측 창·구성 해시·measured 상태를 바꾸지 않는다', (t) => {
  const p = setup(t);
  p.write('CLAUDE.md', '# Harness\n');
  p.write('.github/workflows/ci.yml', 'steps:\n  - run: npm test\n');
  pinMtimes(p.project);
  const config = '[core]\n hooksPath = .githooks\n';
  p.write('.git/config', config);
  const configDir = path.join(p.base, 'logs');
  const logs = writeSyntheticLogs(configDir, { project: p.project, sessions: 24 });
  const prepare = () => {
    const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-28T09:00:00Z', '--json'], { configDir });
    assert.equal(prep.code, 0, prep.stderr);
    return readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  };
  const first = prepare();
  p.write('.git/config', `${config}[branch "unrelated"]\n remote = origin\n`);
  const files = ['CLAUDE.md', '.github/workflows/ci.yml', '.git/config'].map((rel) => path.join(p.project, rel)).concat(logs);
  const inputState = () => files.map((file) => [readFileSync(file, 'utf8'), statSync(file).mtimeMs, statSync(file).size]);
  const before = inputState();
  const second = prepare();
  assert.deepEqual(inputState(), before, '엔진은 Git 설정·CI·지침·세션 원본의 내용·시각·크기를 보존한다');
  assert.equal(second.meta.configurationHash, first.meta.configurationHash);
  assert.equal(first.engine.sessions.coverage.configSince, '2026-11-01T00:00:00Z');
  assert.deepEqual(second.engine.sessions, first.engine.sessions);
  for (const draft of [first, second]) {
    assert.ok(!draft.engine.inventory.sources.some((s) => s.path === '.git/config'));
    assert.equal(draft.engine.axes.find((a) => a.axis === 'context_efficiency').maturity.state, 'measured');
    assert.equal(draft.engine.axes.find((a) => a.axis === 'throughput').maturity.current, 24);
  }
});

test('R1·R6: hooksPath 표기 변형·core 주석은 한 번만 수집하고 워크트리는 활성 미확인 한계를 남긴다', (t) => {
  const p = setup(t);
  p.write('.githooks/pre-commit', 'npm test\n');
  let hash;
  for (const value of ['.githooks', '.githooks/', './.githooks', '.githooks\\']) {
    p.write('.git/config', `[core] # comment\n hooksPath = ${value}\n`);
    const col = p.collectNow();
    const hooks = col.components.filter((c) => c.kind === 'git_hook');
    assert.equal(hooks.length, 1, value);
    hash ??= col.configurationHash;
    assert.equal(col.configurationHash, hash);
    assert.equal(col.sources.filter((s) => s.path === '.githooks/pre-commit').length, 1);
  }
  rmSync(path.join(p.project, '.git'), { recursive: true });
  p.write('.git', 'gitdir: /outside/should-not-read\n');
  const col = p.collectNow();
  assert.ok(col.gateLimitations.some((l) => l.code === 'git_hook_activation_unresolved'));
  assert.ok(col.components.filter((c) => c.kind === 'git_hook').every((c) => !c.attributes.active));
});

test('R2·R3·R4: YAML 형제 키·CircleCI 이름·Jenkins stage·셸 test는 검증 근거가 아니다', (t) => {
  const p = setup(t);
  p.write('.github/workflows/ci.yml', 'steps:\n  - run: |\n      echo done\n    env:\n      MODE: npm test\n    name: npm test\n');
  p.write('.circleci/config.yml', 'steps:\n  - run:\n      name: Run unit tests\n      command: echo done\n');
  p.write('Jenkinsfile', "stage('Test') {\n  echo 'npm test'\n}\n");
  p.write('.git/hooks/pre-commit', '#!/bin/sh\nset -e\ntest -f .env && echo warn\nexit 0\n');
  chmodSync(path.join(p.project, '.git/hooks/pre-commit'), 0o755);
  const col = p.collectNow();
  assert.ok(col.evidence.every((e) => !e.ruleIds.some((r) => r.startsWith('VG-'))));
  p.write('.circleci/config.yml', 'steps:\n  - run:\n      name: only display\n      command: npm test\n');
  p.write('Jenkinsfile', "stage('Build') {\n  sh 'npm test'\n}\n");
  assert.equal(p.collectNow().evidence.filter((e) => e.ruleIds.includes('VG-L2-04')).length, 2);
});

test('R5: Windows 실행 비트는 강제 근거로 추정하지 않고 한계를 알린다', (t) => {
  const p = setup(t);
  p.write('.git/hooks/pre-commit', '#!/bin/sh\nset -e\nnpm test\n');
  const col = collect({ projectRoot: p.project, scope: 'project', configDir: path.join(p.base, 'empty'), skillDir: path.dirname(path.dirname(bundle)), platform: 'win32' });
  assert.ok(col.gateLimitations.some((l) => l.code === 'git_hook_executable_unconfirmed'));
  assert.ok(col.evidence.every((e) => !e.ruleIds.includes('VG-L3-04')));
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
