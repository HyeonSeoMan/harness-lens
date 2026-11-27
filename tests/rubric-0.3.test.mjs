// 루브릭 0.3 소유자 결정: 차단 표지 어휘·import 스캔(#1), 역할 부정문(#2), 빈 영역·CE 실측(#4),
// 컨텍스트 창 비율(#5), 도구별 오류율(#6), 위치별 비중 참고 지표(#9). 결함 번호는 docs/reviews/2026-11-27-diceforge-defects.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blockingExports, hookImports } from '../engine/src/collect.mjs';
import { detectRole, hasBlockMarker } from '../engine/src/lexicon.mjs';
import { contextWindow } from '../engine/src/model-windows.mjs';
import { emptyAreaKind } from '../engine/src/rubric.mjs';
import { BAND_RULES } from '../engine/src/session-metrics.mjs';
import { toolCategory } from '../engine/src/sessions.mjs';
import { engine, makeProject, readJson, tempDir } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

function draftOf(p, opts = {}, extra = []) {
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json', ...extra], opts);
  assert.equal(prep.code, 0, prep.stderr);
  return { draft: readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json')), prep: prep.json };
}

test('#1 LEX-BLOCK: 언어별 exit 2 관례와 따옴표 없는 키를 차단 표지로 본다', () => {
  for (const t of ['process.exit(2)', 'process.exitCode = 2', 'sys.exit(2)', 'os.Exit(2)', 'emit({ decision: "block", reason })',
    "print({'decision': 'block'})", "{ permissionDecision: 'deny' }", '{"decision":"block"}', 'exit 2']) {
    assert.equal(hasBlockMarker(t), true, t);
  }
  for (const t of ['process.exit(0)', 'sys.exit(1)', 'emit({ decision: "approve" })', 'for (;;) { continue; }']) assert.equal(hasBlockMarker(t), false, t);
});

test('#1 import 스캔: 상대 import·source를 1단계 찾고, 이름 import는 표지가 든 export만 차단으로 본다', () => {
  const imps = hookImports([
    'import { readInput, block as deny } from "./lib.mjs";',
    'import fs from "node:fs";',
    'const h = require("../shared/h.js");',
    'source "$CLAUDE_PROJECT_DIR/.claude/hooks/common.sh"',
    '. ./util.sh',
    'from .helpers import check',
  ].join('\n'));
  assert.deepEqual(imps.map((i) => [i.spec, i.names, i.rootRel]), [
    ['./lib.mjs', ['readInput', 'block'], false],
    ['../shared/h.js', null, false],
    ['.claude/hooks/common.sh', null, true],
    ['./util.sh', null, false],
    ['./helpers.py', null, false],
  ]);
  // 다음 export를 설명하는 주석의 "exit 2"는 앞 export에 붙지 않는다.
  const lib = 'export function emit(o) {\n  out(o);\n}\n\n/** exit 2: 차단 */\nexport function block(m) {\n  process.exit(2);\n}\n';
  assert.deepEqual([...blockingExports(lib)], ['block']);
  assert.deepEqual([...blockingExports('if (bad) process.exit(2);\nexport const x = 1;\n')], ['*']);
});

test('#1 공용 헬퍼 경유 차단(DiceForge lib.mjs·emit 형태)을 스냅샷에서 차단으로 인식한다', (t) => {
  const p = makeProject('harness-shared-helper');
  t.after(p.cleanup);
  const { draft } = draftOf(p, {}, ['--no-sessions']);
  const hooks = Object.fromEntries(draft.engine.inventory.components.filter((c) => c.kind === 'hook').map((c) => [c.name, c]));
  const via = (name) => [hooks[name].attributes.blockingMarker, hooks[name].attributes.blockingMarkerVia];
  // import { block } from "./lib.mjs" 후 block(...) 호출 → lib.mjs의 process.exit(2)
  assert.deepEqual(via('PreToolUse(Bash) pre-tool-use.mjs'), [true, 'import']);
  assert.ok(hooks['PreToolUse(Bash) pre-tool-use.mjs'].paths.includes('.claude/hooks/lib.mjs'));
  // 같은 lib.mjs에서 emit만 쓰면 차단이 아니다(오탐 방지).
  assert.deepEqual(via('PostToolUse(Edit) post-tool-use.mjs'), [false, null]);
  // JS 객체의 따옴표 없는 키 emit({ decision: "block" })
  assert.deepEqual(via('Stop stop.mjs'), [true, 'script']);
  // Python sys.exit(2), 셸 source한 공용 함수의 exit 2
  assert.deepEqual(via('UserPromptSubmit prompt.py'), [true, 'script']);
  assert.deepEqual(via('PreToolUse(Write) guard.sh'), [true, 'import']);
  const ev = (comp) => draft.engine.evidence.find((e) => e.componentId === comp.id && e.fact.includes('Hook:'));
  assert.deepEqual(ev(hooks['PreToolUse(Bash) pre-tool-use.mjs']).ruleIds, ['SB-L2-02']);
  assert.ok(ev(hooks['PreToolUse(Bash) pre-tool-use.mjs']).fact.includes('import lib.mjs'));
  assert.deepEqual(ev(hooks['Stop stop.mjs']).ruleIds, ['VG-L3-01']);
  assert.deepEqual(ev(hooks['PostToolUse(Edit) post-tool-use.mjs']).ruleIds, ['VG-L1-02']);
  // 불러온 파일은 읽은 출처로 남고 구성 해시에 들어간다.
  const read = draft.engine.inventory.sources.filter((s) => s.status === 'read').map((s) => s.path);
  assert.ok(read.includes('.claude/hooks/lib.mjs') && read.includes('.claude/hooks/common.sh'));
  assert.equal(draft.rubricVersion, '0.3');
});

test('#2 LEX-ROLE: name을 먼저 보고 description의 부정 절 일치는 무시한다', (t) => {
  assert.equal(detectRole('diceforge-elephant', 'DiceForge 프로젝트 맥락을 불러온다. 작업을 시작할 때 사용. 독립 리뷰어는 쓰지 않는다.'), null);
  assert.equal(detectRole('helper', 'Does not review code. Plans the work.'), 'spec');
  assert.equal(detectRole('x', 'Reviews diffs, never edits files'), 'reviewer');
  assert.equal(detectRole('code-review', '이전 결론은 읽지 않는다.'), 'reviewer');
  const p = makeProject('harness-shared-helper');
  t.after(p.cleanup);
  const { draft } = draftOf(p, {}, ['--no-sessions']);
  const skill = (n) => draft.engine.inventory.components.find((c) => c.kind === 'skill' && c.name === n);
  const axisOf = (c) => draft.engine.evidence.filter((e) => e.componentId === c.id).map((e) => e.primaryAxis);
  assert.ok(!axisOf(skill('context-loader')).includes('verification_gate_strength'), '부정문 "리뷰어는 쓰지 않는다"로 reviewer가 되지 않는다');
  assert.ok(axisOf(skill('code-review')).includes('verification_gate_strength'));
});

test('#4 빈 영역: 실측 상태 축은 수준 0이어도 unconfigured가 아니다. CE는 대역 지표가 없어 실측 불가', () => {
  const ax = (o) => ({ levelStatus: 'assessed', level: 0, maturity: { state: 'predicted' }, ...o });
  assert.equal(emptyAreaKind(ax()), 'unconfigured');
  assert.equal(emptyAreaKind(ax({ maturity: { state: 'measured' } })), null);
  assert.equal(emptyAreaKind(ax({ levelStatus: 'unknown', level: null })), 'unknown');
  assert.equal(emptyAreaKind(ax({ level: 1 })), null);
  assert.equal(BAND_RULES.cost_efficiency, undefined, 'CE-M-01(cache_hit_ratio) 폐기');
});

test('#5 CX-M-02: 컨텍스트 대역은 모델 창 크기 대비 p90 비율이다. 모르는 모델은 보류', () => {
  assert.equal(contextWindow('claude-opus-5-5'), 1000000);
  assert.equal(contextWindow('us.anthropic.claude-sonnet-5-5-20261001[1m]'), 1000000);
  assert.equal(contextWindow('claude-haiku-4-5-20251001'), 200000);
  assert.equal(contextWindow('some-other-model'), null);
  const band = (v, m = {}) => BAND_RULES.context_efficiency.band(v, m);
  // DiceForge 재실행: p90 168,315 토큰 / 1M → 0.17 → 3 (절대값 기준이면 0이었다)
  assert.deepEqual([band(0.17), band(0.25), band(0.4), band(0.6), band(0.9)], [3, 3, 2, 1, 0]);
  assert.equal(band(0.1, { compactions_per_session: 0.6 }), 1, '압축이 잦으면 최대 1');
  assert.equal(BAND_RULES.context_efficiency.ruleId, 'CX-M-02');
});

// 도구 호출·결과가 든 짧은 세션 하나를 쓴다.
function writeToolSession(configDir, project, tools) {
  const dir = path.join(configDir, 'projects', '-tools');
  mkdirSync(dir, { recursive: true });
  const common = { sessionId: 'S-tools', isSidechain: false, cwd: project, version: '2.1.330' };
  const lines = [{ type: 'user', uuid: 'u0', ...common, timestamp: '2026-11-26T09:00:00.000Z', origin: { kind: 'human' }, message: { role: 'user', content: 'p' } }];
  tools.forEach(([name, err], i) => {
    const ts = new Date(Date.parse('2026-11-26T09:00:01Z') + i * 1000).toISOString();
    lines.push({ type: 'assistant', uuid: `a${i}`, ...common, timestamp: ts, message: { id: `m${i}`, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: `tu${i}`, name, input: {} }], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 100000 * (i + 1), output_tokens: 1 } } });
    lines.push({ type: 'user', uuid: `r${i}`, ...common, timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${i}`, is_error: err, content: 'x' }] } });
  });
  writeFileSync(path.join(dir, 'S-tools.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

test('#6·#5·#9 도구별 오류 집계, Bash 분리, 창 비율 지표, 위치별 비중 참고 지표', (t) => {
  assert.deepEqual(['Bash', 'Read', 'mcp__srv__q', 'weird name', 42].map(toolCategory), ['Bash', 'Read', 'mcp', 'other', 'other']);
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = tempDir('hl-tools-');
  t.after(() => import('node:fs').then((fs) => fs.rmSync(configDir, { recursive: true, force: true })));
  writeToolSession(configDir, p.project, [['Bash', true], ['Bash', true], ['Bash', false], ['Bash', false], ['Read', true], ['Read', false], ['Read', false], ['mcp__srv__q', false]]);
  const { draft } = draftOf(p, { configDir });
  const s = draft.engine.sessions;
  assert.deepEqual(s.toolUsage, [
    { tool: 'Bash', calls: 4, errors: 2 },
    { tool: 'Read', calls: 3, errors: 1 },
    { tool: 'mcp', calls: 1, errors: 0 },
  ]);
  const m = Object.fromEntries(s.axisMetrics.map((x) => [x.metricId, x]));
  assert.equal(m.non_bash_tool_error_rate.value, 0.25);
  assert.equal(m.non_bash_tool_error_rate.sampleSize, 4);
  assert.equal(m.bash_error_rate.value, 0.5);
  assert.equal(m.tool_error_rate.value, 0.375, '참고 지표로 전체 오류율도 남긴다');
  // 메인 요청 8개의 입력 크기 100k..800k, 창 1M → p90 = 0.8
  assert.equal(m.context_p90_window_ratio.value, 0.8);
  assert.equal(m.context_p90_tokens.value, 800001);
  // 위치별 비중 참고 지표: 누적 전체 기준(sinceConfig false), 대역 없음. 봇 세션이 없으면 싣지 않는다.
  assert.equal(m.worker_weighted_share, undefined);
  assert.equal(m.bot_weighted_share, undefined);
  const es = draft.engine.axes.find((a) => a.axis === 'execution_stability');
  assert.equal(es.maturity.current, 4, 'ES 표본은 Bash를 뺀 도구 호출 수');
  const ce = draft.engine.axes.find((a) => a.axis === 'cost_efficiency');
  assert.deepEqual([ce.maturity.measurable, ce.maturity.blockedReason], [false, 'band_metric_undefined']);
  assert.ok(m.cache_hit_ratio, 'cache_hit_ratio는 참고 지표로 남는다');
});
