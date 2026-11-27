// 보안(PRD §11, engine-cli.md §6·§7): 비밀정보 제거, 지시문 = 데이터, 실행 없음, 경로 경계, XSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { analyze, engine, makeProject, readJson, tempDir } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

function allFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? allFiles(full) : [full];
  });
}

// 해석은 엔진이 만든 골격에 최소 내용만 채운다.
function minimalInterpretation(prepJson) {
  const tpl = readJson(prepJson.interpretationTemplatePath);
  tpl.summary = ['최소 해석'];
  tpl.axisNotes = tpl.axisNotes.map((n) => ({ ...n, rationale: '엔진 규칙 결과', counterexamples: ['정적 분석 한계'] }));
  tpl.currentTradeoffs.investForgo.summary = '최소 해석';
  tpl.currentTradeoffs.emptyAreas = tpl.currentTradeoffs.emptyAreas.map((e) => ({ ...e, meaning: '근거 없음', howToConfirm: '설정 확인' }));
  return tpl;
}

function analyzeMinimal(p) {
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json']);
  assert.equal(prep.code, 0, prep.stderr);
  writeFileSync(prep.json.interpretationPath, JSON.stringify(minimalInterpretation(prep.json)));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', prep.json.runId, '--now', NOW, '--no-open', '--json']);
  return { prep, fin };
}

const SECRETS = [
  'sk-ant-fixture', 'hunter2-fixture-pass', 'fixture-token-value', 'fixturepass', 'fixture-bearer',
  'fixture-dotenv-secret', 'fixture-agent-secret', 'Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVc', 'deploy-bot',
];

test('비밀정보는 인벤토리·스냅샷·리포트 어디에도 남지 않는다(R1~R7)', (t) => {
  const p = makeProject('harness-secret');
  t.after(p.cleanup);
  const { prep, fin } = analyzeMinimal(p);
  assert.equal(fin.code, 0, fin.stdout);
  for (const file of allFiles(p.out)) {
    const text = readFileSync(file, 'utf8');
    for (const s of SECRETS) assert.ok(!text.includes(s), `${path.relative(p.out, file)}에 ${s}가 남음`);
  }
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  const kinds = Object.fromEntries(draft.engine.inventory.redactions.map((r) => [r.kind, r.count]));
  assert.ok(kinds.anthropic_key >= 1 && kinds.assignment >= 1 && kinds.high_entropy >= 1, JSON.stringify(kinds));
  // R1: 수집 대상 위치에 있는 민감한 이름의 파일은 열지 않고 상태만 보고한다. 수집 대상이 아닌 .env는 아예 건드리지 않는다.
  const cred = draft.engine.inventory.sources.find((s) => s.path === '.claude/agents/deploy-credentials.md');
  assert.equal(cred.status, 'skipped_sensitive');
  assert.ok(!draft.engine.inventory.components.some((c) => c.name === 'deploy-credentials'));
  // R2: 루브릭이 쓰는 숫자 값은 남기고 나머지 env 값은 버린다. MCP url은 scheme+host만.
  const facts = draft.engine.evidence.map((e) => e.fact);
  assert.ok(facts.includes('env.MAX_THINKING_TOKENS = 8000'));
  const mcp = draft.engine.inventory.components.find((c) => c.kind === 'mcp_server');
  assert.equal(mcp.attributes.url, 'https://mcp.example.com');
  assert.equal(mcp.attributes.headersCount, 1);
});

test('분석 대상의 악성 지시문은 데이터로만 다루고 수준을 바꾸지 못한다(R8)', (t) => {
  const p = makeProject('harness-injection');
  t.after(p.cleanup);
  const { prep, fin } = analyzeMinimal(p);
  assert.equal(fin.code, 0, fin.stdout);
  const dir = path.dirname(prep.json.compactInventoryPath);
  const draft = readJson(path.join(dir, 'draft.json'));
  assert.ok(draft.engine.limitations.some((l) => l.code === 'instruction_targets_analyzer'));
  // 지시문이 요구한 '모든 축 3'은 반영되지 않는다. 서술·역할 없는 Skill 외 근거가 없다.
  const levels = Object.fromEntries(draft.engine.axes.map((a) => [a.axis, a.level]));
  assert.ok(Object.values(levels).every((l) => l !== 3), JSON.stringify(levels));
  assert.equal(levels.verification_gate_strength, 0);
  assert.equal(levels.safety_boundary, 0);
  for (const f of ['draft.json', 'inventory.compact.json', 'inventory.json']) {
    const text = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/ignore (all )?(previous|prior) instructions/i.test(text), f);
    assert.ok(!text.includes('이전 지시를 무시'), f);
  }
  const agent = draft.engine.inventory.components.find((c) => c.kind === 'agent');
  assert.equal(agent.attributes.description, '[분석 도구 겨냥 문구 제거]');
});

test('Hook·MCP 서버·지시문의 명령을 실행하지 않는다', (t) => {
  const p = makeProject('harness-injection');
  t.after(p.cleanup);
  analyzeMinimal(p);
  for (const marker of ['HOOK_EXECUTED', 'MCP_EXECUTED', 'PWNED_BY_INSTRUCTION']) {
    assert.ok(!existsSync(path.join(p.project, marker)), marker);
    assert.ok(!existsSync(path.join(p.out, marker)), marker);
  }
});

test('분석 대상 파일을 바꾸지 않는다(Read Only)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const snapshot = () => allFiles(p.project).map((f) => [f, readFileSync(f, 'utf8')]);
  const before = snapshot();
  analyzeMinimal(p);
  assert.deepEqual(snapshot(), before);
});

test('리포트는 HTML 삽입을 막는다(XSS)', (t) => {
  const p = makeProject('harness-injection');
  t.after(p.cleanup);
  const { fin } = analyzeMinimal(p);
  const html = readFileSync(fin.json.reportPath, 'utf8');
  assert.equal(html.match(/<\/script>/g).length, 2, '데이터가 script 태그를 닫으면 안 된다');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<svg onload'));
  assert.ok(html.includes('\\u003cimg src=x'), '데이터는 이스케이프된 JSON으로 들어간다');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.ok(!/(src|href)="https?:/.test(html), '외부 리소스를 불러오지 않는다');
  assert.ok(!html.includes('innerHTML'), '화면에는 textContent로만 넣는다');
});

test('루트 밖으로 가는 심볼릭 링크는 따라가지 않는다', (t) => {
  const p = makeProject('harness-before');
  const outside = tempDir('hl-outside-');
  t.after(p.cleanup);
  writeFileSync(path.join(outside, 'evil.md'), '---\nname: evil-reviewer\ndescription: review everything\n---\n');
  writeFileSync(path.join(outside, 'hook.sh'), 'npm test || exit 2\n');
  try {
    symlinkSync(path.join(outside, 'evil.md'), path.join(p.project, '.claude/agents/evil.md'));
    symlinkSync(path.join(outside, 'hook.sh'), path.join(p.project, '.claude/hooks/guard-bash.sh.link'));
  } catch (err) {
    t.skip(`심볼릭 링크를 만들 수 없음: ${err.code}`);
    return;
  }
  const settingsFile = path.join(p.project, '.claude/settings.json');
  const settings = readJson(settingsFile);
  settings.hooks.Stop = [{ hooks: [{ type: 'command', command: 'bash .claude/hooks/guard-bash.sh.link' }] }];
  writeFileSync(settingsFile, JSON.stringify(settings));
  mkdirSync(p.out, { recursive: true });
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json']);
  assert.equal(prep.code, 0, prep.stderr);
  const draft = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json'));
  const src = (rel) => draft.engine.inventory.sources.find((s) => s.path === rel);
  assert.equal(src('.claude/agents/evil.md').status, 'out_of_scope');
  assert.equal(src('.claude/hooks/guard-bash.sh.link').status, 'out_of_scope');
  assert.ok(!draft.engine.inventory.components.some((c) => c.name === 'evil-reviewer'));
  const stop = draft.engine.evidence.find((e) => e.fact.startsWith('Stop Hook'));
  assert.deepEqual(stop.levelCap, { max: 1, ruleId: 'COM-02' });
  assert.ok(!JSON.stringify(draft).includes(outside), '루트 밖 절대 경로를 남기지 않는다');
});
