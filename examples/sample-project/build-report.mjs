// 합성 샘플 프로젝트(project/)로 실제 리포트를 만든다. README 스크린샷용이다.
// 1) 첫 분석: Stop 검증 Hook을 붙이기 전 구성(v1) + 10월 합성 세션 기록
// 2) 재분석: 현재 구성(project/ 그대로, v2) + 11월 합성 세션 기록 → 변경 비교가 붙은 리포트
// 모든 데이터는 이 스크립트가 고정 시드로 만든 합성 값이다. 실제 사용자 기록·경로를 읽지 않는다.
//
// 사용: node examples/sample-project/build-report.mjs [--work <빈 디렉터리>]
// 결과: <work>/out/report.html (경로를 stdout에 출력)
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(here, '../../skills/harness-analyze/scripts/harness-lens.mjs');

const argWork = process.argv.indexOf('--work');
const work = argWork > 0 ? path.resolve(process.argv[argWork + 1]) : mkdtempSync(path.join(tmpdir(), 'hl-sample-'));
const project = path.join(work, 'todo-api');
const out = path.join(work, 'out');
const configDir = path.join(work, 'claude-config');
const sessionsDir = path.join(configDir, 'projects', '-todo-api');
rmSync(project, { recursive: true, force: true });
rmSync(out, { recursive: true, force: true });
rmSync(configDir, { recursive: true, force: true });
mkdirSync(sessionsDir, { recursive: true });

const V1_MTIME = new Date('2026-10-01T00:00:00Z');
const V2_MTIME = new Date('2026-11-01T00:00:00Z');

function pin(dir, when) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pin(p, when);
    else utimesSync(p, when, when);
  }
}

// 현재 구성을 복사한다. v1이면 Stop Hook과 그 스크립트를 뺀다.
function placeProject(version) {
  rmSync(project, { recursive: true, force: true });
  cpSync(path.join(here, 'project'), project, { recursive: true });
  pin(project, V1_MTIME);
  const settingsPath = path.join(project, '.claude/settings.json');
  if (version === 1) {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    delete settings.hooks.Stop;
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    rmSync(path.join(project, '.claude/hooks/verify-on-stop.sh'));
    utimesSync(settingsPath, V1_MTIME, V1_MTIME);
  } else {
    utimesSync(settingsPath, V2_MTIME, V2_MTIME);
    utimesSync(path.join(project, '.claude/hooks/verify-on-stop.sh'), V2_MTIME, V2_MTIME);
  }
}

// 고정 시드 난수(mulberry32). 같은 입력이면 같은 기록이 나온다.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOOLS = ['Read', 'Read', 'Grep', 'Edit', 'Edit', 'Bash', 'Glob', 'Read'];

// 합성 세션 하나를 JSONL 줄 배열로 만든다. 본문은 모두 고정 문구다(원문 없음).
// v2는 Stop Hook이 생겨 턴이 길어지고, 가끔 검증 실패로 종료가 막힌다(hook_blocking_error).
function session(id, start, version, rand) {
  const lines = [];
  const base = { sessionId: id, isSidechain: false, cwd: project, version: '2.1.310' };
  let t = start.getTime();
  const ts = () => new Date(t).toISOString();
  let n = 0;
  const uid = () => `${id}-${++n}`;
  let context = 18000 + Math.floor(rand() * 4000);
  const prompts = 2 + Math.floor(rand() * 3);
  for (let p = 0; p < prompts; p++) {
    const turnStart = t;
    lines.push({ type: 'user', uuid: uid(), ...base, timestamp: ts(), origin: { kind: 'human' }, message: { role: 'user', content: '합성 요청' } });
    const steps = 4 + Math.floor(rand() * 5);
    for (let s = 0; s < steps; s++) {
      t += 2000 + Math.floor(rand() * 6000);
      const msgId = `msg_${uid()}`;
      const tool = TOOLS[Math.floor(rand() * TOOLS.length)];
      const toolId = `toolu_${uid()}`;
      const fresh = 3 + Math.floor(rand() * 40);
      const write = Math.floor(rand() * 2500);
      context += write + Math.floor(rand() * 1500);
      lines.push({
        type: 'assistant', uuid: uid(), ...base, timestamp: ts(), requestId: `req_${msgId}`,
        message: {
          id: msgId, model: s % 3 === 2 ? 'claude-sonnet-5-5' : 'claude-opus-5-5', role: 'assistant',
          content: [{ type: 'text', text: '합성 응답' }, { type: 'tool_use', id: toolId, name: tool, input: {} }],
          usage: { input_tokens: fresh, cache_creation_input_tokens: write, cache_read_input_tokens: context, output_tokens: 80 + Math.floor(rand() * 600), cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: write } },
        },
      });
      t += 500 + Math.floor(rand() * (tool === 'Bash' ? 9000 : 1500));
      const isError = rand() < (tool === 'Bash' ? 0.12 : 0.03);
      lines.push({ type: 'user', uuid: uid(), ...base, timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, is_error: isError, content: '합성 결과' }] } });
    }
    if (version === 2) {
      // Stop Hook이 검증 스크립트를 돌리는 시간
      t += 25000 + Math.floor(rand() * 35000);
      if (rand() < 0.3) {
        lines.push({ type: 'attachment', uuid: uid(), ...base, timestamp: ts(), attachment: { type: 'hook_blocking_error', hookEvent: 'Stop', exitCode: 2 } });
        t += 15000 + Math.floor(rand() * 20000);
      }
    }
    t += 1000;
    lines.push({ type: 'system', subtype: 'turn_duration', uuid: uid(), ...base, timestamp: ts(), durationMs: t - turnStart });
    t += 60000 + Math.floor(rand() * 600000);
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function writeSessions(version, firstDay, count, seed) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const day = new Date(firstDay.getTime() + i * 86400000 + Math.floor(rand() * 8) * 3600000);
    const id = `sample-v${version}-${String(i + 1).padStart(2, '0')}`;
    writeFileSync(path.join(sessionsDir, `${id}.jsonl`), session(id, day, version, rand));
  }
}

function engine(args) {
  const r = spawnSync(process.execPath, [bundle, ...args, '--quiet'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: configDir } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 비어 있을 수 있다 */ }
  if (r.status !== 0) {
    process.stderr.write(`engine ${args[0]} 실패(${r.status})\n${r.stdout}\n${r.stderr}\n`);
    process.exit(1);
  }
  return json;
}

// prepare → 해석 복사 → finalize. 해석 파일이 없으면 prepare 결과 경로만 알리고 멈춘다(해석 작성용).
function analyze(now, interpretationName) {
  const prep = engine(['prepare', '--project', project, '--out', out, '--now', now, '--json']);
  const interpretation = path.join(here, 'interpretations', `${interpretationName}.json`);
  let body;
  try { body = readFileSync(interpretation, 'utf8'); } catch {
    process.stdout.write(`해석 없음: ${interpretation}\ncompact: ${prep.compactInventoryPath}\ntemplate: ${prep.interpretationTemplatePath}\n`);
    process.exit(2);
  }
  writeFileSync(prep.interpretationPath, body);
  engine(['finalize', '--project', project, '--out', out, '--run', prep.runId, '--now', now, '--agent', 'claude-code', '--no-open', '--json']);
}

placeProject(1);
writeSessions(1, new Date('2026-10-03T01:00:00Z'), 24, 11);
analyze('2026-10-31T09:00:00Z', 'first');

placeProject(2);
writeSessions(2, new Date('2026-11-02T01:00:00Z'), 24, 22);
analyze('2026-11-27T09:00:00Z', 'second');

process.stdout.write(`${path.join(out, 'report.html')}\n`);
