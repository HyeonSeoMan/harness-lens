// PR #8 독립 검수(병합 전 필수 수정 1~8)의 반례를 그대로 재현하는 회귀 테스트. 합성 기록만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { aggregateSessions } from '../engine/src/session-aggregate.mjs';
import { KeySet } from '../engine/src/sessions.mjs';
import { engine, exampleInterpretation, makeProject, readJson, readTree, tempDir } from './helpers.mjs';

const NOW = '2026-11-27T09:00:00Z';

// 검수 재현 스크립트와 같은 형태: 프로젝트 하나, 기록 디렉터리 하나, 확정 상태는 out/sessions에 바로 쓴다.
function setup(t) {
  const base = tempDir('hl-pr8-');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const projectRoot = path.join(base, 'project');
  const configDir = path.join(base, 'config');
  const out = path.join(base, 'out');
  const dir = path.join(configDir, 'projects', '-project');
  mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(out, { recursive: true });
  const file = path.join(dir, 'a.jsonl');
  const opts = { configDir, projectRoot, out, nowMs: Date.parse(NOW), configSinceMs: null };
  const row = (id, extra = {}) => ({
    type: 'assistant', sessionId: 'S', cwd: projectRoot, timestamp: '2026-11-20T00:00:00Z', uuid: `u-${id}`,
    message: {
      id, model: 'claude-opus-5-5', usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Read', input: {} }],
    },
    ...extra,
  });
  const lines = (rows) => rows.map((x) => `${JSON.stringify(x)}\n`).join('');
  const write = (rows, f = file) => writeFileSync(f, lines(rows));
  // 같은 경로에 새 inode로 바꿔 넣는다(회전·원자적 저장).
  const replace = (rows, f = file) => { writeFileSync(`${f}.tmp`, lines(rows)); renameSync(`${f}.tmp`, f); };
  // persist: 이번 결과를 확정 상태로 남긴다(prepare → finalize 성공과 같다).
  const agg = (persist = false, extra = {}) => aggregateSessions({ ...opts, ...extra, ...(persist ? { stagingDir: path.join(out, 'sessions') } : {}) }).sessions;
  return { base, projectRoot, configDir, out, dir, file, row, lines, write, replace, agg };
}

const metric = (s, id) => s.axisMetrics.find((m) => m.metricId === id);
const direct = (s) => s.tokens.byLocation.find((l) => l.location === 'direct');

test('N3. 같은 파일·세션을 반복 교체해도 보존 세대는 하나이며 coverage 줄은 최신 세대만 센다', (t) => {
  const p = setup(t);
  for (let i = 0; i < 12; i++) {
    p.replace([p.row(`rotated-${i}`)]);
    const s = p.agg(true);
    assert.equal(s.coverage.linesRead, 1);
    assert.equal(s.tokens.total.freshInput, (i + 1) * 100);
    assert.equal(metric(s, 'tool_error_rate').sampleSize, i + 1);
  }
  const cursor = readJson(path.join(p.out, 'sessions', 'cursor.json'));
  assert.equal(Object.keys(cursor.files).length, 2);
});

test('N4. archive·event 중복 제거 키는 원시 응답의 90일 보존 기한 후에도 유지한다', (t) => {
  const p = setup(t);
  const old = p.row('old', { timestamp: '2025-01-01T00:00:00Z' });
  p.write([old]);
  p.agg(true);
  p.replace([old]);
  const s = p.agg(true, { nowMs: Date.parse('2027-11-27T00:00:00Z') });
  assert.equal(s.tokens.total.freshInput, 100);
  assert.equal(readFileSync(path.join(p.out, 'sessions', 'archived-keys.bin')).length, 8);
  assert.equal(readFileSync(path.join(p.out, 'sessions', 'events.bin')).length, 8);
});

test('N5. 구버전 parser 상태와 v1 archive는 재사용하지 않고 현재 원본에서 다시 집계한다', (t) => {
  const p = setup(t);
  p.write([p.row('current')]);
  p.agg(true);
  const cursorPath = path.join(p.out, 'sessions', 'cursor.json');
  const cursor = readJson(cursorPath);
  cursor.parserVersion = '1';
  writeFileSync(cursorPath, JSON.stringify(cursor));
  writeFileSync(path.join(p.out, 'sessions', 'archive.json'), JSON.stringify({ days: { '2020-01-01': { bad: true } }, responses: 999 }));
  const result = aggregateSessions({ configDir: p.configDir, projectRoot: p.projectRoot, out: p.out, nowMs: Date.parse(NOW), configSinceMs: null });
  assert.equal(result.info.stateReset, true);
  assert.equal(result.sessions.tokens.total.freshInput, 100);
  assert.equal(result.sessions.coverage.incremental, false);
});

// ---------- 1. 캐시 분할 ----------
test('1. 같은 message.id에서 1시간 분할이 있는 줄과 총량만 있는 줄을 병합해도 cacheWrite는 병합 총량이다(순서 무관)', (t) => {
  const p = setup(t);
  const withSplit = (id, w1) => {
    const r = p.row(id);
    r.message.usage.cache_creation_input_tokens = 1200;
    r.message.usage.cache_creation = { ephemeral_1h_input_tokens: w1, ephemeral_5m_input_tokens: 1200 - w1 };
    return r;
  };
  const totalOnly = (id) => { const r = p.row(id); r.message.usage.cache_creation_input_tokens = 1200; return r; };
  // 연구 문서 §7의 예: 첫 줄은 1h 1200, 다음 줄은 총량 1200만
  for (const rows of [[withSplit('m', 1200), totalOnly('m')], [totalOnly('m'), withSplit('m', 1200)]]) {
    p.write(rows);
    const s = p.agg();
    assert.equal(s.tokens.total.cacheWrite, 1200);
    // 환산: 새 입력 100 + 출력 10×5 + 1시간 쓰기 1200×2
    assert.equal(s.tokens.total.weighted, 100 + 50 + 2400);
    assert.equal(s.contextPerTurn.max, 100 + 1200);
  }
  // 일부만 1시간: 분할(1h 500 + 5m 700)의 합이 병합 총량 1200을 넘지 않는다.
  for (const rows of [[withSplit('m', 500), totalOnly('m')], [totalOnly('m'), withSplit('m', 500)]]) {
    p.write(rows);
    const s = p.agg();
    assert.equal(s.tokens.total.cacheWrite, 1200);
    assert.equal(s.tokens.total.weighted, 100 + 50 + 500 * 2 + 700 * 1.25);
  }
});

// ---------- 2. archive 후 재스캔 ----------
test('2. 90일 지나 archive로 접힌 응답은 inode 교체·다른 파일명 복사·재실행 뒤에도 정확히 한 번만 더한다', (t) => {
  const p = setup(t);
  p.write([p.row('m', { timestamp: '2026-01-01T00:00:00Z' })]);
  const a = p.agg(true);
  assert.equal(a.tokens.total.freshInput, 100);
  assert.equal(a.dedup.uniqueResponses, 1);
  // 같은 내용으로 inode만 교체
  p.replace([p.row('m', { timestamp: '2026-01-01T00:00:00Z' })]);
  const b = p.agg(true);
  assert.equal(b.tokens.total.freshInput, 100);
  assert.equal(b.dedup.uniqueResponses, 1);
  // 원본을 다른 파일명으로 복사(resume/fork 복사)
  copyFileSync(p.file, path.join(p.dir, 'b.jsonl'));
  const c = p.agg(true);
  assert.equal(c.tokens.total.freshInput, 100);
  assert.equal(c.dedup.uniqueResponses, 1);
  assert.equal(metric(c, 'tool_error_rate').sampleSize, 1, '복사한 도구 호출도 한 번만 센다');
  const d = p.agg();
  assert.equal(d.tokens.total.freshInput, 100);
  assert.equal(d.dedup.uniqueResponses, 1);
});

// ---------- 3. 집계 문자열의 비밀정보 ----------
test('3. message.model·version의 비밀정보는 raw sessions.json·aggregate stdout·staging·확정 상태·리포트 어디에도 남지 않는다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'config');
  const dir = path.join(configDir, 'projects', '-p');
  mkdirSync(dir, { recursive: true });
  const secret = 'sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
  const vsecret = 'sk-ant-abcdefghijklmnopqrst';
  writeFileSync(path.join(dir, 's.jsonl'), `${JSON.stringify({
    type: 'assistant', sessionId: 's', cwd: p.project, timestamp: '2026-11-20T00:00:00Z', version: `2.1.3-${vsecret}`,
    message: { id: 'm', model: secret, content: [], usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
  })}\n`);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json'], { configDir });
  assert.equal(prep.code, 0, prep.stdout);
  const runDir = path.dirname(prep.json.compactInventoryPath);
  const sessions = readJson(path.join(runDir, 'sessions.json'));
  assert.deepEqual(sessions.tokens.byModel.map((m) => m.model), ['unknown']);
  const staged = readTree(path.join(runDir, 'sessions.staging'));
  const agg = engine(['aggregate-sessions', '--project', p.project, '--out', p.out, '--json'], { configDir });
  assert.equal(agg.code, 0);
  writeFileSync(prep.json.interpretationPath, readFileSync(exampleInterpretation('harness-before')));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', prep.json.runId, '--now', NOW, '--no-open', '--json'], { configDir });
  assert.equal(fin.code, 0, fin.stdout);
  const places = {
    rawSessions: readFileSync(path.join(runDir, 'sessions.json'), 'utf8'), staging: staged, aggregateStdout: agg.stdout + agg.stderr,
    committedState: readTree(path.join(p.out, 'sessions')), everything: readTree(p.out),
  };
  for (const [where, text] of Object.entries(places)) {
    assert.ok(!text.includes(secret), `${where}에 모델명 비밀정보가 있다`);
    assert.ok(!text.includes(vsecret), `${where}에 버전 비밀정보가 있다`);
  }
});

// ---------- 4. 이벤트 표본 중복 ----------
test('4. 같은 tool_use·tool_result·turn_duration·사람 프롬프트 줄의 반복은 표본을 늘리지 않고, 같은 응답 안의 서로 다른 도구는 센다', (t) => {
  const p = setup(t);
  const prompt = { type: 'user', sessionId: 'S', cwd: p.projectRoot, timestamp: '2026-11-20T00:00:00Z', uuid: 'u-prompt', origin: { kind: 'human' }, message: { role: 'user', content: 'go' } };
  const result = { type: 'user', sessionId: 'S', cwd: p.projectRoot, timestamp: '2026-11-20T00:00:01Z', uuid: 'u-res', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-m', is_error: true, content: 'x' }] } };
  const dur = { type: 'system', subtype: 'turn_duration', durationMs: 20000, sessionId: 'S', uuid: 'u-dur', timestamp: '2026-11-20T00:00:02Z' };
  const r = p.row('m');
  p.write([prompt, r, result, dur]);
  const a = p.agg(true);
  assert.equal(metric(a, 'tool_error_rate').sampleSize, 1);
  assert.equal(metric(a, 'tool_error_rate').value, 1);
  assert.equal(metric(a, 'turn_duration_p50_ms').sampleSize, 1);
  assert.equal(metric(a, 'human_prompts_per_session').value, 1);
  // 검수 시나리오: 같은 message.id·tool_use.id 줄을 한 번 더 append(결과·시간·프롬프트 줄도)
  appendFileSync(p.file, p.lines([r, result, dur, prompt]));
  const b = p.agg(true);
  assert.equal(b.tokens.total.freshInput, 100);
  assert.equal(metric(b, 'tool_error_rate').sampleSize, 1);
  assert.equal(metric(b, 'tool_error_rate').value, 1);
  assert.equal(metric(b, 'turn_duration_p50_ms').sampleSize, 1);
  assert.equal(metric(b, 'human_prompts_per_session').value, 1);
  assert.equal(metric(b, 'tool_calls_between_prompts_p50').sampleSize, 1);
  // 정상 형태: 같은 message.id의 줄마다 서로 다른 tool_use 블록 → 각각 센다
  const two = p.row('m');
  two.message.content = [{ type: 'tool_use', id: 'tu-m-2', name: 'Edit', input: {} }];
  appendFileSync(p.file, p.lines([two]));
  const c = p.agg();
  assert.equal(c.tokens.total.freshInput, 100, '토큰은 여전히 한 응답');
  assert.equal(metric(c, 'tool_error_rate').sampleSize, 2);
});

// ---------- 5. 같은 경로 회전 ----------
test('5. 같은 경로로 새 세션 파일이 회전해 와도 이전 세션의 귀속·카운터를 보존한다', (t) => {
  const p = setup(t);
  p.write([p.row('m1')]);
  const a = p.agg(true);
  assert.equal(direct(a).tokens.freshInput, 100);
  p.replace([p.row('m2', { sessionId: 'S2' })]);
  const b = p.agg(true);
  assert.equal(direct(b).tokens.freshInput, 200, '누적 귀속값');
  assert.equal(b.tokens.unattributed.tokens.freshInput, 0);
  assert.equal(b.coverage.sessionsAttributed, 2);
  assert.equal(metric(b, 'tool_error_rate').sampleSize, 2, '이전 세대의 도구 카운터');
  const c = p.agg();
  assert.deepEqual(c.tokens, b.tokens, '다시 실행해도 같다');
});

// ---------- 6. copytruncate 뒤 재성장 ----------
test('6. copytruncate 뒤 이전 offset보다 크게 다시 자란 파일은 처음부터 다시 읽는다', (t) => {
  const p = setup(t);
  p.write([p.row('A'), p.row('B')]);
  const a = p.agg(true);
  assert.equal(a.dedup.uniqueResponses, 2);
  // 같은 inode를 비우고(copytruncate) 새 세 줄을 쓴다. 크기 감소를 직접 관측하지 못한다.
  p.write([p.row('C'), p.row('D'), p.row('E')]);
  const b = p.agg(true);
  assert.equal(b.dedup.uniqueResponses, 5);
  assert.equal(b.tokens.total.freshInput, 500);
  assert.equal(metric(b, 'tool_error_rate').sampleSize, 5);
  // 이어 쓰기만 하면 세대를 바꾸지 않는다.
  appendFileSync(p.file, p.lines([p.row('F')]));
  const c = p.agg(true);
  assert.equal(c.dedup.uniqueResponses, 6);
  assert.equal(c.coverage.linesRead, 3 + 1, 'coverage는 최신 세대만 세며 과거 세대 줄 수를 다시 더하지 않는다');
});

// ---------- 8. archive만 남은 컨텍스트 추이 ----------
test('8. 모든 응답이 archive로 접혀도 일별 컨텍스트 추이가 남고, 분포는 미확인(null)으로 구분한다', (t) => {
  const p = setup(t);
  p.write([p.row('old', { timestamp: '2026-01-01T00:00:00Z' })]);
  const s = p.agg(true);
  assert.equal(s.tokens.total.freshInput, 100);
  assert.ok(s.contextPerTurn, 'contextPerTurn이 남는다');
  assert.equal(s.contextPerTurn.requests, 0);
  assert.equal(s.contextPerTurn.p50, null);
  assert.equal(s.contextPerTurn.p90, null);
  assert.deepEqual(s.contextPerTurn.distribution, { from: null, to: null, retentionDays: 90 });
  assert.deepEqual(s.contextPerTurn.series, [{ date: '2026-01-01', requests: 1, p50: 100, max: 100, source: 'archive' }]);
  // 원본이 정리되고 새 세션도 없는 재분석
  rmSync(p.file);
  const again = p.agg();
  assert.deepEqual(again.contextPerTurn.series, s.contextPerTurn.series);
  // 최근 응답이 생기면 분포는 그 원시 응답 범위에서만 낸다.
  p.write([p.row('new', { sessionId: 'S3' })]);
  const mixed = p.agg();
  assert.equal(mixed.contextPerTurn.requests, 1);
  assert.deepEqual(mixed.contextPerTurn.distribution, { from: '2026-11-20', to: '2026-11-20', retentionDays: 90 });
  assert.deepEqual(mixed.contextPerTurn.series.map((x) => [x.date, x.source]), [['2026-01-01', 'archive'], ['2026-11-20', 'raw']]);
});

test('8. archive만 남은 결과도 스키마·의미 검증을 통과하고 리포트를 만든다', (t) => {
  const p = makeProject('harness-before');
  t.after(p.cleanup);
  const configDir = path.join(p.base, 'config');
  const dir = path.join(configDir, 'projects', '-p');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 's.jsonl'), `${JSON.stringify({
    type: 'assistant', sessionId: 's', cwd: p.project, timestamp: '2026-01-01T00:00:00Z',
    message: { id: 'm', model: 'claude-opus-5-5', content: [], usage: { input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
  })}\n`);
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', NOW, '--json'], { configDir });
  assert.equal(prep.code, 0, prep.stdout);
  writeFileSync(prep.json.interpretationPath, readFileSync(exampleInterpretation('harness-before')));
  const fin = engine(['finalize', '--project', p.project, '--out', p.out, '--run', prep.json.runId, '--now', NOW, '--no-open', '--json'], { configDir });
  assert.equal(fin.code, 0, fin.stdout);
  const cpt = readJson(fin.json.analysisPath).engine.sessions.contextPerTurn;
  assert.equal(cpt.p50, null);
  assert.equal(cpt.series[0].source, 'archive');
});

// ---------- 재검증 N2. 키 파일 손상 ----------
test('N2. events.bin·archived-keys.bin이 잘리거나 비거나 덮이거나 정렬이 깨지면 손상으로 보고 다시 만들어 과다 집계하지 않는다', (t) => {
  const p = setup(t);
  const rows = [p.row('old', { timestamp: '2026-01-01T00:00:00Z' }), p.row('m1'), p.row('m2')];
  const keyFile = (f) => path.join(p.out, 'sessions', f);
  const corruptions = {
    'events.bin 3바이트 잘림': () => { const b = readFileSync(keyFile('events.bin')); writeFileSync(keyFile('events.bin'), b.subarray(0, b.length - 3)); },
    'events.bin 비움': () => writeFileSync(keyFile('events.bin'), ''),
    'events.bin 바이트 역순': () => writeFileSync(keyFile('events.bin'), Buffer.from(readFileSync(keyFile('events.bin'))).reverse()),
    'events.bin 삭제': () => rmSync(keyFile('events.bin')),
    'archived-keys.bin 쓰레기 값': () => writeFileSync(keyFile('archived-keys.bin'), Buffer.alloc(8, 0x5a)),
    'archived-keys.bin 비움': () => writeFileSync(keyFile('archived-keys.bin'), ''),
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    rmSync(p.out, { recursive: true, force: true });
    mkdirSync(p.out, { recursive: true });
    rmSync(path.join(p.dir, 'b.jsonl'), { force: true });
    p.write(rows);
    const base = p.agg(true);
    assert.equal(base.tokens.total.freshInput, 300);
    assert.equal(metric(base, 'tool_error_rate').sampleSize, 3);
    assert.equal(readFileSync(keyFile('archived-keys.bin')).length, 8, '접힌 응답 키 1개');
    corrupt();
    // resume 복사 형태: 같은 내용의 파일이 하나 더 생긴다.
    copyFileSync(p.file, path.join(p.dir, 'b.jsonl'));
    const r = aggregateSessions({ configDir: p.configDir, projectRoot: p.projectRoot, out: p.out, nowMs: Date.parse(NOW), configSinceMs: null });
    assert.equal(r.info.stateCorrupted, true, `${name}: 손상 감지`);
    assert.equal(r.sessions.coverage.incremental, false, `${name}: 처음부터 다시 만든다`);
    assert.equal(r.sessions.tokens.total.freshInput, 300, `${name}: 토큰`);
    assert.equal(metric(r.sessions, 'tool_error_rate').sampleSize, 3, `${name}: 도구 표본`);
  }
  // 손상이 없으면 그대로 증분으로 읽는다.
  rmSync(path.join(p.dir, 'b.jsonl'));
  p.agg(true);
  copyFileSync(p.file, path.join(p.dir, 'b.jsonl'));
  const ok = aggregateSessions({ configDir: p.configDir, projectRoot: p.projectRoot, out: p.out, nowMs: Date.parse(NOW), configSinceMs: null });
  assert.equal(ok.info.stateCorrupted, undefined);
  assert.equal(ok.sessions.coverage.incremental, true);
  assert.equal(ok.sessions.tokens.total.freshInput, 300);
  assert.equal(metric(ok.sessions, 'tool_error_rate').sampleSize, 3);
});

test('N1. 이벤트 키 집합(typed array 해시): 확정 키와 새 키를 정렬·병합해 쓰고 다시 읽어도 같은 집합이다', () => {
  let x = 12345;
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x; };
  const first = new KeySet();
  const all = new Set();
  for (let i = 0; i < 5000; i++) { const hi = rnd(); const lo = rnd(); first.add(hi, lo); all.add(`${hi}:${lo}`); }
  first.add(0, 0); all.add('0:0');
  const again = KeySet.fromBuffer(first.toBuffer());
  for (let i = 0; i < 3000; i++) { const hi = rnd() & 0xff; const lo = rnd(); again.add(hi, lo); all.add(`${hi}:${lo}`); }
  const buf = again.toBuffer();
  assert.equal(buf.length, all.size * 8);
  const back = KeySet.fromBuffer(buf); // 정렬·중복 검사를 통과한다
  for (const k of all) { const [hi, lo] = k.split(':').map(Number); assert.ok(back.has(hi, lo)); }
  assert.ok(!back.has(1, 2));
});
