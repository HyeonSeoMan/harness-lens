import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safetyHookTargets } from '../engine/src/safety-hook.mjs';
import { diffAnalyses } from '../engine/src/diff.mjs';
import { runSemanticChecks } from '../engine/src/checks.mjs';
import { engine, makeProject, readJson } from './helpers.mjs';

const pathGuard = `const p = input.tool_input.file_path;
if (p.startsWith('docs/spec/')) { process.exit(2); }`;
const gitGuard = `if (input.tool_input.command.includes('git push --force')) process.exit(2);`;

test('0.5 보호 대상·matcher·차단 분기가 일치해야 SB 후보를 만든다', () => {
  const scan = (script, matcher = 'Write', event = 'PreToolUse') => safetyHookTargets({ event, matcher, script });
  assert.deepEqual(scan(pathGuard), ['protected_path']);
  assert.deepEqual(scan(pathGuard.replace('process.exit(2)', 'process.exit ( 2 )')), ['protected_path']);
  assert.deepEqual(scan(gitGuard, 'Bash'), ['risky_git']);
  assert.deepEqual(scan(pathGuard, null), ['protected_path']);
  for (const script of [
    `// ${pathGuard.replaceAll('\n', '\n// ')}`,
    `/* ${pathGuard} */`,
    `const p = input.tool_input.file_path; if (p.startsWith('docs/spec/')) console.warn('protected'); process.exit(2);`,
    `const p = input.tool_input.file_path; if (p.startsWith('docs/spec/')) { console.warn('protected'); } else { process.exit(2); }`,
    `process.exit(2);`,
  ]) assert.deepEqual(scan(script), [], script);
  assert.deepEqual(scan(pathGuard, 'Bash'), []);
  assert.deepEqual(scan(gitGuard, 'Write'), []);
  assert.deepEqual(scan(pathGuard, 'Write', 'PostToolUse'), []);
  assert.deepEqual(scan(pathGuard, 'Write', 'UserPromptSubmit'), []);
  assert.deepEqual(scan(`const p = input.tool_input.file_path; if (p.startsWith('docs/spec/')) { emit({ decision: 'block' }); }`), ['protected_path']);
  assert.deepEqual(scan(`const p = input.tool_input.file_path; if (p.startsWith('docs/spec/')) { console.warn('process.exit(2)'); }`), []);
  const shell = `cmd="$(jq -r '.tool_input.command' input)"\ncase "$cmd" in\n*"git push --force"*) exit 2 ;;\nesac`;
  assert.deepEqual(scan(shell, 'Bash'), ['risky_git']);
  assert.deepEqual(scan(shell.replace('exit 2', 'echo blocked'), 'Bash'), []);
  assert.deepEqual(scan(shell.replace('case "$cmd"', 'case "$other"'), 'Bash'), []);
});

function prepare(t, { disabled = false, missing = false, warn = false, imported = false, matcher = 'Write|Bash' } = {}) {
  const p = makeProject('harness-injection');
  t.after(p.cleanup);
  mkdirSync(path.join(p.project, '.claude/hooks'), { recursive: true });
  writeFileSync(path.join(p.project, '.claude/settings.json'), JSON.stringify({ disableAllHooks: disabled,
    hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: 'node .claude/hooks/spec-guard.mjs' }] }] } }));
  if (!missing) writeFileSync(path.join(p.project, '.claude/hooks/spec-guard.mjs'), imported
    ? `import { block as deny } from './lib.mjs';\n${pathGuard.replace('process.exit(2)', 'deny("protected")')}`
    : warn ? pathGuard.replace('process.exit(2)', 'console.warn("blocked")') : pathGuard);
  if (imported) writeFileSync(path.join(p.project, '.claude/hooks/lib.mjs'), 'export function block(reason) { process.exit(2); }');
  const result = engine(['prepare', '--project', p.project, '--out', p.out, '--no-sessions', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const draft = readJson(path.join(path.dirname(result.json.compactInventoryPath), 'draft.json'));
  return { draft, result };
}

test('0.5 같은 Hook의 명세와 보호 사실은 서로 다른 근거로 SC와 SB 수준을 정한다', (t) => {
  const { draft, result } = prepare(t);
  assert.equal(draft.rubricVersion, '0.5');
  const axis = (name) => draft.engine.axes.find((a) => a.axis === name);
  assert.equal(axis('spec_clarity').level, 3);
  assert.equal(axis('safety_boundary').level, 2);
  assert.equal(axis('safety_boundary').source.ruleId, 'SB-L2-04');
  const sc = draft.engine.evidence.find((e) => e.ruleIds.includes('SC-L3-01'));
  const sb = draft.engine.evidence.find((e) => e.ruleIds.includes('SB-L2-04'));
  assert.equal(sc.componentId, sb.componentId);
  assert.notEqual(sc.id, sb.id);
  assert.match(sb.fact, /우회 가능/);
  assert.equal(sb.primaryAxis, 'safety_boundary');
  const checks = runSemanticChecks({ ...draft, interpretation: readJson(result.json.interpretationTemplatePath) });
  assert.equal(checks.find((c) => c.checkId === 'V-SINGLE-ATTRIBUTION').status, 'pass');
});

test('0.5 실제 호출한 차단 export의 별칭도 보호 분기에 연결한다', (t) => {
  const { draft } = prepare(t, { imported: true });
  assert.equal(draft.engine.axes.find((a) => a.axis === 'safety_boundary').level, 2);
  assert.equal(draft.engine.axes.find((a) => a.axis === 'spec_clarity').level, 3);
});

test('0.5 설정만 존재·경고만·matcher 불일치·무력화는 SB 수준 2를 주지 않는다', (t) => {
  for (const options of [{ missing: true }, { warn: true }, { matcher: 'Read' }, { disabled: true }]) {
    const { draft } = prepare(t, options);
    assert.ok(draft.engine.axes.find((a) => a.axis === 'safety_boundary').level < 2, JSON.stringify(options));
    if (options.disabled) assert.ok(draft.engine.evidence.filter((e) => e.ruleIds.includes('SB-L2-04')).every((e) => e.void));
  }
});

test('0.4 → 0.5는 limited와 모든 축 comparable:false를 표시한다', (t) => {
  const { draft } = prepare(t);
  const previous = structuredClone(draft);
  previous.rubricVersion = '0.4';
  const diff = diffAnalyses(previous, draft);
  assert.equal(diff.comparability, 'limited');
  assert.equal(diff.componentChanges.length, 0);
  assert.equal(diff.axisDeltas.length, 8);
  assert.ok(diff.axisDeltas.every((a) => !a.comparable && a.reason === 'rubric_version_changed'));
  assert.equal(diffAnalyses(draft, structuredClone(draft)).comparability, 'full');
});
