// 합성 세션 기록 생성기. 실제 기록 내용은 쓰지 않는다. 키 이름과 타입만 실측 형식(docs/research/02-session-logs.md §7)을 따른다.
// 성숙도 전환(세션 20회·도구 호출 500회)과 성능 예산(큰 기록) 테스트에 쓴다.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 결정론적 난수(LCG). 같은 seed면 같은 기록이 나온다.
function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 2 ** 32; };
}

const iso = (ms) => new Date(ms).toISOString();

// opts: { project, sessions, toolsPerSession, startMs, endMs, seed, errorRate, botDir, padBytes, version }
// padBytes: 응답마다 붙이는 의미 없는 본문 길이(큰 기록 성능 테스트용).
// 세션 시작은 [startMs, endMs) 안에 둔다. 세션이 많으면 간격(기본 18시간)을 좁혀 분석 시각 이후로 넘어가지 않게 한다.
export function writeSyntheticLogs(configDir, opts) {
  const {
    project, sessions = 24, toolsPerSession = 25, startMs = Date.parse('2026-11-05T09:00:00Z'), endMs = Date.parse('2026-11-26T09:00:00Z'),
    seed = 7, errorRate = 0.03,
    botDir = null, padBytes = 0, version = '2.1.320', prefix = 'syn',
  } = opts;
  const rand = rng(seed);
  const dir = path.join(configDir, 'projects', `-${prefix}-project`);
  mkdirSync(dir, { recursive: true });
  const pad = padBytes ? 'x'.repeat(padBytes) : '';
  const files = [];
  const gap = Math.min(18 * 3600 * 1000, Math.floor((endMs - startMs) / Math.max(1, sessions)));
  for (let s = 0; s < sessions; s++) {
    const sid = `${prefix}-session-${s}`;
    const file = path.join(dir, `${sid}.jsonl`);
    const lines = [];
    let t = startMs + s * gap;
    let ctx = 18000 + Math.floor(rand() * 4000);
    const common = { sessionId: sid, isSidechain: false, cwd: project, version, entrypoint: 'cli' };
    let msg = 0;
    const prompts = 3;
    for (let p = 0; p < prompts; p++) {
      lines.push({ type: 'user', uuid: `${sid}-u${p}`, ...common, timestamp: iso(t), origin: { kind: 'human' }, message: { role: 'user', content: 'synthetic prompt' } });
      const tools = Math.round(toolsPerSession / prompts);
      for (let k = 0; k < tools; k++) {
        t += 4000 + Math.floor(rand() * 9000);
        const id = `msg_${prefix}_${s}_${msg++}`;
        const fresh = 2 + Math.floor(rand() * 8);
        const write = Math.floor(rand() * 1500);
        ctx += write + 300;
        const usage = { input_tokens: fresh, cache_creation_input_tokens: write, cache_read_input_tokens: ctx, output_tokens: 80 + Math.floor(rand() * 400) };
        // 한 응답이 두 줄로 기록되는 형식(텍스트 + tool_use, usage 반복)
        lines.push({ type: 'assistant', uuid: `${id}-a`, ...common, timestamp: iso(t), requestId: `req_${id}`, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: `synthetic ${pad}` }], usage } });
        lines.push({ type: 'assistant', uuid: `${id}-b`, ...common, timestamp: iso(t), requestId: `req_${id}`, message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: `tu_${id}`, name: 'Read', input: { file_path: 'synthetic' } }], usage } });
        const err = rand() < errorRate;
        lines.push({ type: 'user', uuid: `${id}-r`, ...common, timestamp: iso(t + 500), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${id}`, is_error: err, content: 'synthetic' }] } });
      }
      lines.push({ type: 'system', subtype: 'turn_duration', durationMs: 20000 + Math.floor(rand() * 40000), sessionId: sid, uuid: `${sid}-d${p}`, timestamp: iso(t + 1000) });
      t += 60000;
    }
    writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    files.push(file);
  }
  if (botDir) {
    const bdir = path.join(configDir, 'projects', `-${prefix}-bot`);
    mkdirSync(bdir, { recursive: true });
    const lines = [];
    const sid = `${prefix}-bot-session`;
    for (let i = 0; i < 40; i++) {
      const id = `msg_${prefix}_bot_${i}`;
      lines.push({
        type: 'assistant', uuid: id, sessionId: sid, isSidechain: false, cwd: botDir, version, timestamp: iso(startMs + i * 3600 * 1000),
        message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: `tu_${id}`, name: 'Bash', input: { command: `orca dispatch ${project}` } }],
          usage: { input_tokens: 3, cache_creation_input_tokens: 800, cache_read_input_tokens: 600000 + i * 9000, output_tokens: 120 } },
      });
    }
    writeFileSync(path.join(bdir, `${sid}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
  return files;
}

// 최근 며칠에 몰린 고유 응답이 많은 기록(응답 상태 자체의 메모리 확장을 본다). 응답마다 한 줄, 본문 textBytes.
// 기본값은 검수 재현 규모: 7일 안 400세션 × 300응답 = 12만 응답, 약 166MB.
// events: 응답마다 사람 프롬프트 1·tool_use 2·tool_result 2·turn_duration 1(실제 이력 비율, 응답당 이벤트 약 6.2개)을 넣는다.
export function writeDenseLogs(configDir, { project, sessions = 400, responses = 300, endMs = Date.parse('2026-11-27T08:00:00Z'), spanDays = 7, textBytes = 1000, events = false }) {
  const dir = path.join(configDir, 'projects', '-dense-project');
  mkdirSync(dir, { recursive: true });
  const text = 'x'.repeat(textBytes);
  const span = spanDays * 24 * 3600 * 1000;
  let bytes = 0;
  for (let s = 0; s < sessions; s++) {
    const start = endMs - span + Math.floor((s * span) / sessions);
    const lines = [];
    for (let m = 0; m < responses; m++) {
      const id = `m-${s}-${m}`;
      const common = { sessionId: `dense-${s}`, cwd: project, timestamp: iso(start + m * 1000), version: '2.1.320' };
      const tools = events ? [0, 1].map((k) => ({ type: 'tool_use', id: `tu-${id}-${k}`, name: 'Read', input: { file_path: 'synthetic' } })) : [];
      if (events) lines.push(JSON.stringify({ type: 'user', uuid: `p-${id}`, ...common, origin: { kind: 'human' }, message: { role: 'user', content: 'synthetic prompt' } }));
      lines.push(JSON.stringify({
        type: 'assistant', uuid: `a-${id}`, ...common,
        message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 20000, output_tokens: 100 }, content: [{ type: 'text', text }, ...tools] },
      }));
      if (events) {
        lines.push(JSON.stringify({ type: 'user', uuid: `r-${id}`, ...common, message: { role: 'user', content: tools.map((tu) => ({ type: 'tool_result', tool_use_id: tu.id, is_error: false, content: 'synthetic' })) } }));
        lines.push(JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 20000, uuid: `d-${id}`, ...common }));
      }
    }
    const body = `${lines.join('\n')}\n`;
    bytes += Buffer.byteLength(body);
    writeFileSync(path.join(dir, `dense-${s}.jsonl`), body);
  }
  return { bytes, responses: sessions * responses };
}

// 기존 세션 파일 끝에 응답 하나를 덧붙인다(증분 재실행 테스트).
export function appendResponse(file, { sid, project, id, t, usage, partial = false }) {
  const line = JSON.stringify({ type: 'assistant', uuid: id, sessionId: sid, isSidechain: false, cwd: project, version: '2.1.322', timestamp: iso(t), message: { id, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id: `tu_${id}`, name: 'Edit', input: {} }], usage } });
  appendFileSync(file, partial ? line.slice(0, Math.floor(line.length / 2)) : `${line}\n`);
  return line;
}
