// 세션 기록 실측 집계(FR-10, FR-11, PRD §6.1, engine-cli.md §8). 합성 픽스처만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  SENTINELS, analyze, engine, exampleInterpretation, makeProject, makeSessionLogs, readJson, readTree,
} from './helpers.mjs';
import { appendResponse, writeSyntheticLogs } from './support/synth-sessions.mjs';
import { aggregateSessions } from '../engine/src/session-aggregate.mjs';

const NOW = '2026-11-27T09:00:00Z';

function prepare(p, configDir, extra = [], now = NOW) {
  const r = engine(['prepare', '--project', p.project, '--out', p.out, '--now', now, '--json', ...extra], { configDir });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const dir = path.dirname(r.json.compactInventoryPath);
  return { r, dir, draft: readJson(path.join(dir, 'draft.json')), sessions: readJson(path.join(dir, 'sessions.json')) };
}

const loc = (s, name) => s.tokens.byLocation.find((l) => l.location === name);
const four = (b) => [b.freshInput, b.cacheWrite, b.cacheRead, b.output];

test('전체 스캔 범위는 무관한 옛 기록을 포함하지만 컨텍스트는 귀속 관측일만 쓰며 구성 시각과 봇 매핑에 불변이다', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'trend-config');
  const dir = path.join(configDir, 'projects', '-synthetic');
  const bots = path.join(p.base, 'bots');
  const bot = path.join(bots, 'old-bot');
  mkdirSync(dir, { recursive: true });
  mkdirSync(bot, { recursive: true });
  mkdirSync(p.out, { recursive: true });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 40 };
  for (const [sid, project, date] of [
    ['excluded', path.join(p.base, 'another-project'), '2026-11-02'],
    ['old-bot', bot, '2026-11-03'],
    ['target-26', p.project, '2026-11-26'],
    ['target-27', p.project, '2026-11-27'],
  ]) appendResponse(path.join(dir, sid + '.jsonl'), { sid, project, id: sid, t: Date.parse(date + 'T12:00:00Z'), usage });
  const config = { orcaPaths: { bots, workspaces: path.join(p.base, 'workspaces') } };
  writeFileSync(path.join(p.out, 'config.json'), JSON.stringify(config));
  const baseline = prepare(p, configDir, [], '2026-11-28T09:00:00Z').sessions;
  assert.deepEqual(baseline.window, { from: '2026-11-02', to: '2026-11-27', rawLogsFrom: '2026-11-02' });
  assert.deepEqual(baseline.contextPerTurn.series.map((x) => x.date), ['2026-11-26', '2026-11-27']);
  assert.equal(baseline.contextPerTurn.requests, 2);
  assert.equal(baseline.coverage.sessionsExcluded, 1);
  assert.deepEqual(four(baseline.tokens.total), [20, 40, 60, 80]);
  assert.deepEqual(four(baseline.tokens.unattributed.tokens), [10, 20, 30, 40]);
  const noConfigSince = aggregateSessions({ configDir, projectRoot: p.project, out: p.out, nowMs: Date.parse('2026-11-28T09:00:00Z'), configSinceMs: null }).sessions;
  assert.equal(noConfigSince.coverage.configSince, null);
  assert.deepEqual(noConfigSince.contextPerTurn, baseline.contextPerTurn);
  assert.equal(noConfigSince.axisMetrics.find((m) => m.metricId === 'context_p90_tokens').sampleSize, 2);
  for (const date of ['2026-11-26', '2026-11-27']) {
    const ts = new Date(date + 'T00:00:00Z');
    utimesSync(path.join(p.project, 'CLAUDE.md'), ts, ts);
    const s = prepare(p, configDir, [], '2026-11-28T09:00:00Z').sessions;
    assert.deepEqual(s.contextPerTurn, baseline.contextPerTurn);
    assert.equal(s.axisMetrics.find((m) => m.metricId === 'context_p90_tokens').sampleSize, date.endsWith('26') ? 2 : 1);
  }
  config.sessionAttribution = { bots: { 'old-bot': p.project } };
  writeFileSync(path.join(p.out, 'config.json'), JSON.stringify(config));
  const mapped = prepare(p, configDir, [], '2026-11-28T09:00:00Z').sessions;
  assert.deepEqual(mapped.contextPerTurn, baseline.contextPerTurn);
  assert.deepEqual(four(mapped.tokens.total), [30, 60, 90, 120]);
});

test('중복 제거: message.id로 묶어 필드별 최댓값, 합성·API 오류·잘린 줄·부모 요약 수치 제외', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const { sessions: s } = prepare(p, logs.configDir);
  assert.equal(s.status, 'available');
  // msg_A(2줄) + msg_B(3줄, 첫 줄은 스트리밍 중간값) + requestId만 있는 응답 + resume 복사 줄(전역 중복)
  assert.deepEqual(four(loc(s, 'direct').tokens), [3 + 5 + 10, 1200 + 500, 45000 + 46000 + 47000, 310 + 180 + 50]);
  // 서브에이전트는 별개 응답이라 합산하되 부모 위치에 섞지 않는다.
  assert.deepEqual(four(loc(s, 'subagent').tokens), [7, 100, 18100, 160]);
  assert.equal(s.dedup.excludedSynthetic, 1);
  assert.equal(s.dedup.excludedApiError, 1);
  assert.equal(s.coverage.linesSkipped, 2, '모르는 레코드 타입과 깨진 JSON 줄');
  assert.deepEqual(s.clientVersions, { min: '2.1.309', max: '2.1.321' });
  // 환산값: opus 5.5 기준 새 입력 1, 1h 캐시 쓰기 2, 5m 1.25, 캐시 읽기 0.05, 출력 5
  assert.equal(loc(s, 'direct').tokens.weighted, 18 + 1200 * 2 + 500 * 1.25 + 138000 * 0.05 + 540 * 5);
  const sumW = s.tokens.byLocation.reduce((a, l) => a + l.tokens.weighted, 0);
  assert.ok(Math.abs(sumW - s.tokens.total.weighted) <= 0.5);
  assert.equal(s.contextPerTurn.p50, 46005);
  assert.equal(s.contextPerTurn.max, 47510);
  assert.equal(s.contextPerTurn.compactions, 1);
  assert.ok(s.tokens.weighting.basis === 'reference_model_fresh_input_equivalent');
});

test('귀속: cwd 기준 direct·worker(gitdir·추정)·subagent, 매핑 없는 봇은 경로 언급 시에만 auto', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const { sessions: s, draft } = prepare(p, logs.configDir);
  assert.deepEqual(loc(s, 'direct').attribution, { direct: 2, worktree: 0, inferred: 0, configured: 0, auto: 0 });
  assert.deepEqual(loc(s, 'worker').attribution, { direct: 0, worktree: 1, inferred: 1, configured: 0, auto: 0 });
  assert.deepEqual(four(loc(s, 'worker').tokens), [150, 2000, 15000, 500]);
  assert.deepEqual(loc(s, 'bot').attribution, { direct: 0, worktree: 0, inferred: 0, configured: 0, auto: 1 });
  assert.deepEqual(four(loc(s, 'bot').tokens), [1, 0, 100000, 50]);
  // 매핑 없는 봇 2개(그중 하나는 `<project>-other`라는 비슷한 경로만 언급)만 미귀속(불확실)이다.
  assert.equal(s.tokens.unattributed.sessions, 2);
  assert.equal(s.tokens.unattributed.botSessions, 2);
  assert.deepEqual(four(s.tokens.unattributed.tokens), [5, 3000, 900000, 390]);
  // 다른 프로젝트 세션(cwd /elsewhere/...)은 합계·미귀속 어디에도 넣지 않고 개수만 남긴다(§8.3 5행).
  assert.equal(s.coverage.sessionsExcluded, 1);
  assert.equal(s.coverage.sessionsUnattributed, 2);
  assert.deepEqual(four(s.tokens.total), [176, 3800, 271100, 1250], '미귀속·제외는 합계에 섞지 않는다');
  assert.equal(draft.meta.analysisType, 'static_with_sessions');
  assert.ok(draft.engine.limitations.some((l) => l.code === 'estimated_attribution_included'));
  assert.ok(draft.engine.limitations.some((l) => l.code === 'unattributed_sessions'));
  // #9(0.3): 위치별 환산값 비중을 CE 참고 지표(대역 없음, 누적 전체)로 싣는다. measured finding이 인용할 수 있다.
  const share = (id) => s.axisMetrics.find((m) => m.metricId === id);
  assert.deepEqual(share('bot_weighted_share'), { axis: 'cost_efficiency', metricId: 'bot_weighted_share', value: loc(s, 'bot').weightedShare, unit: 'ratio', sampleSize: 1, sinceConfig: false });
  assert.deepEqual(share('worker_weighted_share'), { axis: 'cost_efficiency', metricId: 'worker_weighted_share', value: loc(s, 'worker').weightedShare, unit: 'ratio', sampleSize: 2, sinceConfig: false });
  const ex = draft.engine.limitations.find((l) => l.code === 'unrelated_sessions_excluded');
  assert.ok(ex && ex.message.includes('1개'), '제외 세션 수를 limitations에 투명하게 남긴다');
});

test('귀속: 설정의 봇↔저장소 매핑이 우선한다', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p, { mapping: true });
  const { sessions: s } = prepare(p, logs.configDir);
  assert.deepEqual(loc(s, 'bot').attribution, { direct: 0, worktree: 0, inferred: 0, configured: 1, auto: 1 });
  assert.deepEqual(four(loc(s, 'bot').tokens), [5, 3000, 920000, 400]);
  assert.equal(s.tokens.unattributed.sessions, 1);
  assert.equal(s.tokens.unattributed.botSessions, 1);
  assert.equal(s.coverage.sessionsExcluded, 1);
  // 봇 채팅은 축 지표(조율 비용 제외)에 들어가지 않는다: 도구 호출은 direct 4 + worker 1 + subagent 1
  assert.equal(s.axisMetrics.find((m) => m.metricId === 'tool_error_rate').sampleSize, 6);
});

test('귀속: 다른 저장소에 매핑된 봇은 미귀속이 아니라 제외한다', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p, { botMap: { 'other-bot': '/elsewhere/another-project' } });
  const { sessions: s } = prepare(p, logs.configDir);
  // other-bot(S-bot-3)은 매핑으로 무관함이 확실하다. 남은 미귀속은 매핑·언급 없는 mapped-bot 하나뿐이다.
  assert.equal(s.coverage.sessionsExcluded, 2);
  assert.equal(s.tokens.unattributed.sessions, 1);
  assert.equal(s.tokens.unattributed.botSessions, 1);
  assert.deepEqual(four(s.tokens.unattributed.tokens), [4, 3000, 820000, 350]);
  assert.deepEqual(four(s.tokens.total), [176, 3800, 271100, 1250]);
});

test('원문 누출 없음: 출력 어디에도 본문·코드·도구 입력·제목·식별자·경로 원문이 없다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p, { mapping: true });
  const res = analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before'), configDir: logs.configDir });
  assert.equal(res.fin.code, 0, res.fin.stdout);
  const agg = engine(['aggregate-sessions', '--project', p.project, '--out', p.out, '--json'], { configDir: logs.configDir });
  // config.json은 사용자가 쓴 입력이라 검사에서 뺀다.
  writeFileSync(path.join(p.out, 'config.json'), '{}');
  const all = readTree(p.out) + agg.stdout + agg.stderr;
  assert.ok(existsSync(path.join(p.out, 'sessions', 'cursor.json')));
  for (const s of SENTINELS) assert.ok(!all.includes(s), `출력에 ${s}가 있다`);
  for (const raw of ['/elsewhere/another-project', 'S-direct-1', 'msg_B', 'mapped-bot', logs.worktree, p.project]) {
    assert.ok(!all.includes(raw), `출력에 원문 ${raw}가 있다`);
  }
});

test('증분 재실행 결과가 같은 파일의 전체 재집계와 같다(잘린 줄·이어 쓴 줄 포함)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const [file] = writeSyntheticLogs(logs.configDir, { project: p.project, sessions: 3 });
  const base = readJson(exampleInterpretation('harness-before'));
  let runs = 0;
  const fin = (now) => {
    // 두 번째 분석부터는 이전 스냅샷과 비교하므로 변경 트레이드오프가 빈 배열이어야 한다.
    const interp = runs++ ? { ...base, changeTradeoffs: [] } : base;
    const r = analyze({ project: p.project, out: p.out, now, interpretation: interp, configDir: logs.configDir });
    assert.equal(r.fin.code, 0, r.fin.stdout);
  };
  fin('2026-11-26T09:00:00Z');
  const t0 = Date.parse('2026-11-25T12:00:00Z');
  const usage = { input_tokens: 4, cache_creation_input_tokens: 10, cache_read_input_tokens: 30000, output_tokens: 70 };
  const line = appendResponse(file, { sid: 'syn-session-0', project: p.project, id: 'msg_inc_1', t: t0, usage, partial: true });
  fin('2026-11-26T10:00:00Z');
  appendFileSync(file, `${line.slice(Math.floor(line.length / 2))}\n`);
  appendResponse(file, { sid: 'syn-session-0', project: p.project, id: 'msg_inc_1', t: t0, usage: { ...usage, output_tokens: 90 } });
  const inc = prepare(p, logs.configDir, [], '2026-11-26T11:00:00Z');
  assert.equal(inc.sessions.coverage.incremental, true);
  const full = prepare(p, logs.configDir, ['--full-rescan'], '2026-11-26T11:00:00Z');
  assert.equal(full.sessions.coverage.incremental, false);
  const strip = (s) => ({ ...s, coverage: { ...s.coverage, incremental: null } });
  assert.deepEqual(strip(inc.sessions), strip(full.sessions));
  assert.equal(inc.sessions.dedup.uniqueResponses, full.sessions.dedup.uniqueResponses);
});

test('검증에 실패하면 세션 커서가 전진하지 않는다(FR-09)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const first = prepare(p, logs.configDir);
  writeFileSync(path.join(first.dir, 'interpretation.json'), '{"summary": []}');
  const bad = engine(['finalize', '--project', p.project, '--out', p.out, '--run', first.r.json.runId, '--now', NOW, '--no-open', '--json'], { configDir: logs.configDir });
  assert.equal(bad.code, 30);
  assert.ok(!existsSync(path.join(p.out, 'sessions')), '커서·누적 집계를 확정하지 않는다');
  const again = prepare(p, logs.configDir);
  assert.equal(again.sessions.coverage.incremental, false, '다음 실행은 같은 구간을 처음부터 다시 읽는다');
  assert.deepEqual(again.sessions.tokens, first.sessions.tokens);
  const ok = analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before'), configDir: logs.configDir });
  assert.equal(ok.fin.code, 0);
  assert.ok(existsSync(path.join(p.out, 'sessions', 'cursor.json')));
});

test('원본 기록이 정리돼도 누적 집계가 남는다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const r = analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before'), configDir: logs.configDir });
  assert.equal(r.fin.code, 0);
  const before = readJson(r.fin.json.analysisPath).engine.sessions;
  const empty = path.join(p.base, 'empty-config');
  mkdirSync(path.join(empty, 'projects'), { recursive: true });
  const after = prepare(p, empty, [], '2026-11-28T09:00:00Z').sessions;
  assert.deepEqual(after.tokens.total, before.tokens.total);
  assert.equal(after.coverage.filesScanned, 0);
  assert.equal(after.window.rawLogsFrom, null);
});

test('모르는 형식·읽을 수 없는 파일은 멈추지 않고 사유와 함께 unavailable/partial로 낮춘다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'weird-config');
  const dir = path.join(configDir, 'projects', '-weird');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'a.jsonl'), '{"type":"brand-new-record","x":1}\n[1,2]\nnot json\n{"type":"assistant","message":{"id":"m","usage":{"input_tokens":"many"}}}\n');
  const s = prepare(p, configDir).sessions;
  assert.equal(s.status, 'unavailable');
  assert.equal(s.reason, 'session_format_unsupported');
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    writeFileSync(path.join(dir, 'b.jsonl'), '{}\n');
    chmodSync(path.join(dir, 'b.jsonl'), 0o000);
    const r = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json'], { configDir });
    assert.equal(r.code, 0);
  }
  const off = prepare(p, configDir, ['--no-sessions']).sessions;
  assert.equal(off.status, 'disabled');
});

test('성숙도: 표본이 요구량에 닿은 축만 실측으로 바뀌고, 범위가 좁아지며 직전 예측과의 차이를 남긴다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  writeSyntheticLogs(logs.configDir, { project: p.project, sessions: 12 });
  const few = prepare(p, logs.configDir).draft.engine.axes;
  const tp = few.find((a) => a.axis === 'throughput');
  assert.equal(tp.maturity.state, 'predicted');
  assert.equal(tp.maturity.blockedReason, 'insufficient_samples');
  assert.equal(tp.maturity.current, 12 + 4);
  assert.equal(tp.maturity.progress, 0.8);

  writeSyntheticLogs(logs.configDir, { project: p.project, sessions: 30, prefix: 'more' });
  // 0.3: 실측 상태가 된 축(throughput 수준 0)은 빈 영역에서 빠진다.
  const r = analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before'), configDir: logs.configDir, align: true });
  assert.equal(r.fin.code, 0, r.fin.stdout);
  assert.ok(!readJson(r.prep.json.interpretationTemplatePath).currentTradeoffs.emptyAreas.some((e) => e.axis === 'throughput'), '실측 축은 빈 영역이 아니다');
  const axes = readJson(r.fin.json.analysisPath).engine.axes;
  const measured = axes.filter((a) => a.maturity.state === 'measured').map((a) => a.axis).sort();
  assert.deepEqual(measured, ['autonomy', 'context_efficiency', 'execution_stability', 'throughput']);
  // 0.3: CE는 대역 지표가 정해질 때까지 예측(cache_hit_ratio는 참고 지표).
  const ce = axes.find((a) => a.axis === 'cost_efficiency');
  assert.deepEqual([ce.maturity.measurable, ce.maturity.state, ce.maturity.blockedReason], [false, 'predicted', 'band_metric_undefined']);
  for (const a of axes.filter((x) => !x.maturity.measurable)) assert.equal(a.maturity.state, 'predicted');
  for (const a of axes.filter((x) => x.measured)) {
    assert.equal(a.measured.heuristic, true);
    assert.equal(a.measured.predictedLevel, a.level);
    assert.equal(a.measured.deltaFromPredicted, a.measured.band - a.level);
    assert.ok(a.range.reasonCodes.includes('measured_band'));
    const req = a.maturity.requirement.required;
    if (a.measured.sampleSize >= 2 * req) assert.equal(a.range.max - a.range.min, 0, `${a.axis} 2배 이상이면 범위가 한 점`);
    else assert.ok(a.range.max - a.range.min <= 2);
  }
});

test('직전 분석의 LLM 토큰·시간을 세션 구간으로 측정한다(자기 비용)', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const T1 = '2026-11-26T10:00:00Z';
  const T2 = '2026-11-26T10:10:00Z';
  const first = prepare(p, logs.configDir, [], T1);
  writeFileSync(path.join(first.dir, 'interpretation.json'), readFileSync(exampleInterpretation('harness-before')));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', first.r.json.runId, '--now', T2, '--no-open', '--json'], { configDir: logs.configDir });
  assert.equal(fin.code, 0, fin.stdout);
  // 분석 구간 안에 이 프로젝트에서 일어난 응답(분석을 수행한 에이전트의 호출)
  const dir = path.join(logs.configDir, 'projects', '-analysis');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'S-analysis.jsonl');
  writeFileSync(file, '');
  appendResponse(file, { sid: 'S-analysis', project: p.project, id: 'msg_an_1', t: Date.parse('2026-11-26T10:03:00Z'), usage: { input_tokens: 100, cache_creation_input_tokens: 20000, cache_read_input_tokens: 50000, output_tokens: 3000 } });
  appendResponse(file, { sid: 'S-analysis', project: p.project, id: 'msg_an_2', t: Date.parse('2026-11-26T11:00:00Z'), usage: { input_tokens: 9, cache_creation_input_tokens: 9, cache_read_input_tokens: 9, output_tokens: 9 } });
  const second = prepare(p, logs.configDir, [], '2026-11-27T09:00:00Z');
  const sc = second.draft.engine.selfCost;
  assert.equal(sc.previousAnalysis.wallClockMs, 600000);
  assert.equal(sc.previousAnalysis.method, 'session_window');
  assert.deepEqual(four(sc.previousAnalysis.llmTokens), [100, 20000, 50000, 3000]);
  const b = sc.budgets.find((x) => x.budgetId === 'llm_tokens_per_analysis');
  assert.equal(b.observed, 100 + 20000 + 3000);
  assert.equal(b.status, 'within');
});

test('CLAUDE_CONFIG_DIR을 따르고 --config-dir가 우선한다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const viaEnv = engine(['aggregate-sessions', '--project', p.project, '--out', p.out, '--json'], { configDir: logs.configDir });
  assert.equal(viaEnv.json.status, 'available');
  const viaFlag = engine(['aggregate-sessions', '--project', p.project, '--out', p.out, '--config-dir', logs.configDir, '--json']);
  assert.equal(viaFlag.json.status, 'available');
  assert.ok(!existsSync(path.join(p.out, 'sessions')), 'aggregate-sessions 단독 실행은 아무것도 확정하지 않는다');
});

test('귀속: POSIX의 역슬래시는 파일명 문자라 /a\\b 형태를 프로젝트 언급으로 보지 않는다(Windows에서는 구분자)', (t) => {
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const file = path.join(logs.configDir, 'projects', '-bot-auto', 'S-bot-2.jsonl');
  const enc = (s) => JSON.stringify(s).slice(1, -1);
  const backslashed = `${path.dirname(p.project)}\\${path.basename(p.project)}`;
  writeFileSync(file, readFileSync(file, 'utf8').split(enc(p.project)).join(enc(backslashed)));
  const { sessions: s } = prepare(p, logs.configDir);
  if (process.platform === 'win32') {
    assert.equal(loc(s, 'bot').attribution.auto, 1);
    assert.equal(s.tokens.unattributed.sessions, 2);
  } else {
    assert.equal(loc(s, 'bot')?.attribution.auto ?? 0, 0);
    assert.equal(s.tokens.unattributed.sessions, 3);
  }
});

test('파서 버전 5: 버전 4 커서(이전 botMention)는 재사용하지 않아 증분 결과가 --full-rescan과 같다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const logs = makeSessionLogs(p);
  const r = analyze({ project: p.project, out: p.out, now: NOW, interpretation: exampleInterpretation('harness-before'), configDir: logs.configDir, align: true });
  assert.equal(r.fin.code, 0, r.fin.stdout);
  // 버전 4 엔진이 남긴 상태를 흉내 낸다: 언급 판정 결과가 모두 false인 커서.
  const cursorPath = path.join(p.out, 'sessions', 'cursor.json');
  const cursor = readJson(cursorPath);
  cursor.parserVersion = '4';
  for (const f of Object.values(cursor.files)) f.botMention = false;
  writeFileSync(cursorPath, JSON.stringify(cursor));
  const inc = prepare(p, logs.configDir, [], '2026-11-28T09:00:00Z');
  assert.ok(inc.draft.engine.limitations.some((l) => l.code === 'session_state_reset'));
  const full = prepare(p, logs.configDir, ['--full-rescan'], '2026-11-28T09:00:00Z');
  assert.deepEqual(inc.sessions, full.sessions);
  assert.equal(loc(inc.sessions, 'bot').attribution.auto, 1);
});
