// 세션 기록 실측 집계(FR-10, PRD §6.1, engine-cli.md §4.3, §8).
// Claude Code 기록(<config-dir>/projects/**/*.jsonl)을 읽기 전용·줄 단위로 읽어 숫자만 남긴다.
// 메시지 본문·코드·도구 입력·경로 원문은 저장하지 않는다. 식별자와 경로는 해시로만 남긴다(R6).
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SESSION_PARSER_VERSION } from './constants.mjs';
import { atomicWrite, writeJson } from './store.mjs';
import { compareCodeUnits, sha256hex } from './util.mjs';

const CHUNK = 1 << 20;
// 이보다 긴 줄(요청 원문 등)은 버퍼에 모으지 않고 건너뛴다. 메모리 예산(200MiB)을 지킨다.
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const RESPONSE_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// 허용 목록(§8.1). 집계하는 타입과, 원문이 있어 해석하지 않고 넘기는 알려진 타입.
const AGGREGATED = new Set(['assistant', 'user', 'system', 'attachment']);
const KNOWN_IGNORED = new Set([
  'cost-state', 'api-request', 'api-request-shape', 'api-request-blob', 'ai-title', 'custom-title', 'last-prompt', 'agent-name',
  'queue-operation', 'mode', 'permission-mode', 'pr-link', 'frame-link', 'file-history-snapshot', 'file-history-delta',
  'session-owner', 'tools-used', 'atis-latch', 'summary', 'progress',
]);

const MODEL_RE = /^[A-Za-z0-9._:@/[\]-]{1,80}$/;
const VERSION_RE = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}$/;

export const h16 = (s) => sha256hex(String(s)).slice(0, 16);
const toPosix = (p) => p.split(path.sep).join('/').replace(/\\/g, '/');
const isInt = (v) => Number.isInteger(v) && v >= 0;

export function compareVersions(a, b) {
  const pa = a.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return compareCodeUnits(String(x), String(y));
  }
  return 0;
}

const expandHome = (p) => (p.startsWith('~/') || p === '~' ? path.join(homedir(), p.slice(1)) : p);

function realOrSelf(p) {
  try { return realpathSync(p); } catch { return p; }
}

// p가 base이거나 그 하위 경로인가(posix 문자열 비교).
function isUnder(p, base) {
  if (!base) return false;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return p === b || p.startsWith(`${b}/`);
}

// 워크트리 .git 파일의 gitdir에서 메인 저장소 경로를 구한다. 파일 하나만 읽고 git을 실행하지 않는다.
export function mainRepoOf(dir) {
  let cur = dir;
  for (let i = 0; i < 64; i++) {
    const g = path.join(cur, '.git');
    let st = null;
    try { st = statSync(g); } catch { /* 없음 */ }
    if (st) {
      if (st.isDirectory()) return { found: true, main: cur, worktree: false };
      try {
        const text = readFileSync(g, 'utf8').slice(0, 4096);
        const m = /^gitdir:\s*(.+)$/m.exec(text);
        if (m) {
          const gitdir = path.resolve(cur, m[1].trim());
          const main = toPosix(gitdir).replace(/\/\.git\/worktrees\/[^/]+\/?$/, '');
          if (main !== toPosix(gitdir)) return { found: true, main, worktree: true };
        }
      } catch { /* 읽기 실패 */ }
      return { found: true, main: null, worktree: false };
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return { found: false, main: null, worktree: false };
}

// 분석 대상 메인 저장소 경로 R. 프로젝트 루트가 워크트리면 gitdir로 메인을 찾는다.
export function resolveMainRoot(projectRoot) {
  const real = realOrSelf(projectRoot);
  const r = mainRepoOf(real);
  const main = r.worktree && r.main ? r.main : toPosix(real);
  return { main, roots: [...new Set([main, toPosix(realOrSelf(main)), toPosix(projectRoot)])] };
}

export function readSessionConfig(out) {
  const file = path.join(out, 'config.json');
  let cfg = {};
  try { if (existsSync(file)) cfg = JSON.parse(readFileSync(file, 'utf8')); } catch { cfg = {}; }
  const orca = cfg && typeof cfg.orcaPaths === 'object' && cfg.orcaPaths ? cfg.orcaPaths : {};
  const bots = cfg?.sessionAttribution?.bots && typeof cfg.sessionAttribution.bots === 'object' ? cfg.sessionAttribution.bots : {};
  const str = (v, d) => (typeof v === 'string' && v ? v : d);
  return {
    enabled: cfg?.sessions?.enabled !== false,
    botsDir: toPosix(path.resolve(expandHome(str(orca.bots, '~/.orca/bots')))),
    workspacesDir: toPosix(path.resolve(expandHome(str(orca.workspaces, '~/orca/workspaces')))),
    // 봇 이름은 해시로만 비교한다. 값(저장소 경로)은 R과 같은지만 본다.
    botMap: Object.fromEntries(Object.entries(bots).filter(([, v]) => typeof v === 'string').map(([k, v]) => [h16(k), toPosix(realOrSelf(path.resolve(expandHome(v))))])),
  };
}

// ---------- 상태 ----------
function emptyState(rootHash) {
  return { parserVersion: SESSION_PARSER_VERSION, rootPathHash: rootHash, files: {}, attribution: {}, responses: new Map(), archive: { days: {}, responses: 0 } };
}

function stateDir(out) { return path.join(out, 'sessions'); }

export function loadState(dir, rootHash) {
  try {
    if (!existsSync(path.join(dir, 'cursor.json'))) return { state: emptyState(rootHash), had: false };
    const cursor = JSON.parse(readFileSync(path.join(dir, 'cursor.json'), 'utf8'));
    if (cursor.parserVersion !== SESSION_PARSER_VERSION || cursor.rootPathHash !== rootHash) return { state: emptyState(rootHash), had: false };
    const responses = new Map();
    const rdir = path.join(dir, 'responses');
    if (existsSync(rdir)) {
      for (const f of readdirSync(rdir).sort(compareCodeUnits)) {
        if (!f.endsWith('.json')) continue;
        const obj = JSON.parse(readFileSync(path.join(rdir, f), 'utf8'));
        for (const [k, v] of Object.entries(obj)) responses.set(k, v);
      }
    }
    const read = (f, d) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) : d);
    return {
      state: {
        parserVersion: cursor.parserVersion, rootPathHash: rootHash, files: cursor.files ?? {},
        attribution: read('attribution-cache.json', {}), responses, archive: read('archive.json', { days: {}, responses: 0 }),
      },
      had: true,
    };
  } catch {
    // 누적 파일이 깨졌으면 처음부터 다시 읽는다. 원본 기록이 정리된 구간은 잃을 수 있다.
    return { state: emptyState(rootHash), had: false, corrupted: true };
  }
}

const monthOf = (ms) => (ms > 0 ? new Date(ms).toISOString().slice(0, 7) : '0000-00');

export function writeState(dir, state) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'responses'), { recursive: true });
  writeJson(path.join(dir, 'cursor.json'), { parserVersion: state.parserVersion, rootPathHash: state.rootPathHash, files: state.files });
  writeJson(path.join(dir, 'attribution-cache.json'), state.attribution);
  writeJson(path.join(dir, 'archive.json'), state.archive);
  const months = new Map();
  for (const k of [...state.responses.keys()].sort(compareCodeUnits)) {
    const v = state.responses.get(k);
    const m = monthOf(v[8]);
    if (!months.has(m)) months.set(m, {});
    months.get(m)[k] = v;
  }
  // 응답 맵은 크므로 들여쓰기 없이 쓴다(키 정렬은 유지).
  for (const [m, obj] of months) atomicWrite(path.join(dir, 'responses', `${m}.json`), `${JSON.stringify(obj)}\n`);
}

// prepare가 만든 스테이징 상태를 snapshot 성공 뒤에만 확정한다(FR-09).
export function promoteState(out, stagingDir) {
  if (!existsSync(path.join(stagingDir, 'cursor.json'))) return false;
  const dir = stateDir(out);
  const old = `${dir}.old-${process.pid}`;
  rmSync(old, { recursive: true, force: true });
  if (existsSync(dir)) renameSync(dir, old);
  try {
    renameSync(stagingDir, dir);
  } catch (err) {
    if (existsSync(old)) renameSync(old, dir);
    throw err;
  }
  rmSync(old, { recursive: true, force: true });
  return true;
}

// ---------- 파일 찾기 ----------
function listTranscripts(projectsDir) {
  const out = [];
  let dirs;
  try { dirs = readdirSync(projectsDir, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path.join(projectsDir, d.name);
    let entries;
    try { entries = readdirSync(pdir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.jsonl')) out.push({ abs: path.join(pdir, e.name), kind: 'main' });
      else if (e.isDirectory() && e.name !== 'memory') {
        const sdir = path.join(pdir, e.name, 'subagents');
        let subs;
        try { subs = readdirSync(sdir, { withFileTypes: true }); } catch { continue; }
        for (const s of subs) if (s.isFile() && /^agent-.+\.jsonl$/.test(s.name)) out.push({ abs: path.join(sdir, s.name), kind: 'subagent' });
      }
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.abs, b.abs));
}

// ---------- 줄 처리 ----------
const COUNTERS = ['lines', 'skipped', 'unknownType', 'assistantLines', 'synthetic', 'apiError', 'badUsage', 'toolUse', 'toolErrors',
  'recovered', 'subToolUse', 'subToolErrors', 'humanPrompts', 'compactions', 'hookErrors', 'hookBlocks', 'apiRetries'];

function newFileState(kind) {
  return {
    kind, inode: null, size: 0, mtimeMs: 0, offset: 0, present: true, session: null, cwdHash: null, cls: null, botMention: false,
    versions: null, firstTs: null, lastTs: null, c: Object.fromEntries(COUNTERS.map((k) => [k, 0])),
    durations: [], gaps: [], openGap: null, pendingError: false,
  };
}

// 문자열 값 어딘가에 R 경로가 경로 경계로 나오는가. 값은 저장하지 않고 불리언만 남긴다.
function mentionsRoot(value, roots, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    for (const r of roots) {
      let i = value.indexOf(r);
      while (i !== -1) {
        const next = value[i + r.length];
        if (next === undefined || !/[A-Za-z0-9._-]/.test(next)) return true;
        i = value.indexOf(r, i + 1);
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((v) => mentionsRoot(v, roots, depth + 1));
  if (typeof value === 'object') return Object.values(value).some((v) => mentionsRoot(v, roots, depth + 1));
  return false;
}

class Parser {
  constructor(state, env) {
    this.state = state;
    this.env = env; // { roots, cfg, mainRoot }
  }

  classify(cwd) {
    const key = h16(cwd);
    const cached = this.state.attribution[key];
    if (cached) return { key, cls: cached };
    const { roots, cfg, mainRoot } = this.env;
    const p = toPosix(cwd);
    const pr = toPosix(realOrSelf(cwd));
    let cls = { kind: 'none' };
    if (roots.some((r) => isUnder(p, r) || isUnder(pr, r))) cls = { kind: 'direct' };
    else if (isUnder(p, cfg.botsDir)) {
      const bot = p.slice(cfg.botsDir.length + 1).split('/')[0];
      cls = bot ? { kind: 'bot', bot: h16(bot) } : { kind: 'none' };
    } else {
      const g = existsSync(cwd) ? mainRepoOf(cwd) : { found: false };
      if (g.found) {
        if (g.worktree && g.main && roots.includes(toPosix(realOrSelf(g.main)))) cls = { kind: 'worktree' };
        else if (g.worktree && g.main && roots.includes(g.main)) cls = { kind: 'worktree' };
      } else if (!existsSync(cwd) && isUnder(p, cfg.workspacesDir)) {
        const repoName = p.slice(cfg.workspacesDir.length + 1).split('/')[0];
        if (repoName && repoName === path.posix.basename(mainRoot)) cls = { kind: 'inferred' };
      }
    }
    this.state.attribution[key] = cls;
    return { key, cls };
  }

  line(text, fs, fileHash) {
    const c = fs.c;
    c.lines++;
    let o;
    try { o = JSON.parse(text); } catch { c.skipped++; return; }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.type !== 'string') { c.skipped++; return; }
    if (!AGGREGATED.has(o.type)) {
      if (!KNOWN_IGNORED.has(o.type)) { c.unknownType++; c.skipped++; }
      return;
    }
    if (typeof o.version === 'string' && VERSION_RE.test(o.version)) {
      if (!fs.versions) fs.versions = [o.version, o.version];
      else {
        if (compareVersions(o.version, fs.versions[0]) < 0) fs.versions[0] = o.version;
        if (compareVersions(o.version, fs.versions[1]) > 0) fs.versions[1] = o.version;
      }
    }
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (fs.firstTs === null || ts < fs.firstTs) fs.firstTs = ts;
      if (fs.lastTs === null || ts > fs.lastTs) fs.lastTs = ts;
    }
    if (fs.session === null && typeof o.sessionId === 'string' && o.sessionId) fs.session = h16(o.sessionId);
    if (fs.cls === null && typeof o.cwd === 'string' && o.cwd && path.isAbsolute(o.cwd)) {
      const { key, cls } = this.classify(o.cwd);
      fs.cwdHash = key;
      fs.cls = cls;
    }
    const side = fs.kind === 'subagent' || o.isSidechain === true;
    if (o.type === 'assistant') this.assistant(o, fs, fileHash, side, ts);
    else if (o.type === 'user') this.user(o, fs, side);
    else if (o.type === 'system') this.system(o, fs);
    else this.attachment(o, fs);
  }

  assistant(o, fs, fileHash, side, ts) {
    const c = fs.c;
    const msg = o.message;
    if (!msg || typeof msg !== 'object') { c.skipped++; return; }
    c.assistantLines++;
    if (msg.model === '<synthetic>') { c.synthetic++; return; }
    if (o.isApiErrorMessage === true) { c.apiError++; return; }
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) {
        if (!b || b.type !== 'tool_use') continue;
        if (side) c.subToolUse++;
        else {
          c.toolUse++;
          if (fs.openGap !== null) fs.openGap++;
        }
        if (!fs.botMention && fs.cls?.kind === 'bot' && mentionsRoot(b.input, this.env.roots)) fs.botMention = true;
      }
    }
    const u = msg.usage;
    if (!u || typeof u !== 'object') return;
    const fresh = u.input_tokens;
    const cw = u.cache_creation_input_tokens;
    const cr = u.cache_read_input_tokens;
    const out = u.output_tokens;
    if (![fresh, cw, cr, out].every(isInt)) { c.badUsage++; return; }
    let w1 = 0;
    if (u.cache_creation && typeof u.cache_creation === 'object' && isInt(u.cache_creation.ephemeral_1h_input_tokens)) {
      w1 = Math.min(cw, u.cache_creation.ephemeral_1h_input_tokens);
    }
    const w5 = cw - w1;
    const rawKey = (typeof msg.id === 'string' && msg.id) || (typeof o.requestId === 'string' && o.requestId) || `${fileHash}#${o.uuid ?? c.lines}`;
    const key = h16(rawKey);
    const model = typeof msg.model === 'string' && MODEL_RE.test(msg.model) ? msg.model : 'unknown';
    const session = typeof o.sessionId === 'string' && o.sessionId ? h16(o.sessionId) : (fs.session ?? `f:${fileHash}`);
    const t = Number.isFinite(ts) ? ts : 0;
    const prev = this.state.responses.get(key);
    // 필드별 최댓값. 문자열 필드는 순서에 무관하게 최솟값으로 정해 증분·전체 결과를 같게 한다.
    if (!prev) this.state.responses.set(key, [fresh, w5, w1, cr, out, model, session, side ? 1 : 0, t]);
    else {
      prev[0] = Math.max(prev[0], fresh); prev[1] = Math.max(prev[1], w5); prev[2] = Math.max(prev[2], w1);
      prev[3] = Math.max(prev[3], cr); prev[4] = Math.max(prev[4], out);
      if (compareCodeUnits(model, prev[5]) < 0) prev[5] = model;
      if (compareCodeUnits(session, prev[6]) < 0) prev[6] = session;
      prev[7] = prev[7] && (side ? 1 : 0);
      prev[8] = Math.max(prev[8], t);
    }
  }

  user(o, fs, side) {
    const c = fs.c;
    const content = o.message && typeof o.message === 'object' ? o.message.content : undefined;
    let hasResult = false;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result') continue;
        hasResult = true;
        if (side) { if (b.is_error === true) c.subToolErrors++; continue; }
        if (b.is_error === true) { c.toolErrors++; fs.pendingError = true; } else if (fs.pendingError) { c.recovered++; fs.pendingError = false; }
      }
    }
    if (side) return;
    let human;
    if (o.origin && typeof o.origin === 'object') human = o.origin.kind === 'human';
    else human = o.isMeta !== true && !hasResult && (typeof content === 'string' || (Array.isArray(content) && content.some((b) => b && b.type === 'text')));
    if (!human) return;
    c.humanPrompts++;
    if (fs.openGap !== null) fs.gaps.push(fs.openGap);
    fs.openGap = 0;
  }

  system(o, fs) {
    const c = fs.c;
    if (o.subtype === 'turn_duration' && isInt(o.durationMs)) fs.durations.push(o.durationMs);
    else if (o.subtype === 'compact_boundary') c.compactions++;
    else if (o.subtype === 'api_error') c.apiRetries++;
    else if (o.subtype === 'stop_hook_summary' && Array.isArray(o.hookErrors)) c.hookErrors += o.hookErrors.length;
  }

  attachment(o, fs) {
    const a = o.attachment;
    if (!a || typeof a !== 'object' || typeof a.type !== 'string') return;
    if (a.type === 'hook_non_blocking_error') fs.c.hookErrors++;
    else if (/^hook_.*blocking_error$/.test(a.type)) fs.c.hookBlocks++;
    else if (a.type.startsWith('hook_') && Number.isInteger(a.exitCode) && a.exitCode !== 0) fs.c.hookErrors++;
  }
}

// 이보다 큰 줄은 앞부분의 "type"만 보고, 해석하지 않는 타입이면 파싱을 건너뛴다(메모리 예산).
const PEEK_LIMIT = 256 * 1024;
function ignoredByPeek(buf) {
  const m = /^\s*\{\s*"type"\s*:\s*"([^"]{1,40})"/.exec(buf.subarray(0, 120).toString('latin1'));
  return !!m && KNOWN_IGNORED.has(m[1]);
}

// 파일 하나를 offset부터 줄 단위로 읽는다. 개행으로 끝나지 않은 마지막 줄은 쓰는 중으로 보고 남긴다.
function readFrom(abs, fs, size, parser, fileHash) {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let pos = fs.offset;
    let carry = [];
    let carryLen = 0;
    let skipping = false;
    while (pos < size) {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
      if (n <= 0) break;
      let start = 0;
      for (;;) {
        const idx = buf.indexOf(10, start);
        if (idx === -1 || idx >= n) break;
        if (skipping) {
          fs.c.lines++; fs.c.skipped++;
          skipping = false;
        } else {
          const part = buf.subarray(start, idx);
          const head = carryLen ? carry[0] : part;
          if (carryLen + part.length > PEEK_LIMIT && ignoredByPeek(head)) {
            // 원문만 담긴 큰 레코드(요청 원문 등)는 문자열로 바꾸거나 파싱하지 않는다.
            fs.c.lines++;
          } else {
            const text = carryLen ? Buffer.concat([...carry, part]).toString('utf8') : part.toString('utf8');
            if (text.trim()) parser.line(text, fs, fileHash);
          }
        }
        carry = []; carryLen = 0;
        start = idx + 1;
        fs.offset = pos + start;
      }
      if (start < n && !skipping) {
        carryLen += n - start;
        if (carryLen > MAX_LINE_BYTES) { skipping = true; carry = []; carryLen = 0; } else carry.push(Buffer.from(buf.subarray(start, n)));
      }
      pos += n;
    }
  } finally {
    closeSync(fd);
  }
}

// 상태에 새 바이트를 반영한다. 반환: { files, unreadable, rescanned }
export function scanTranscripts({ configDir, state, env, fullRescan, log }) {
  const list = listTranscripts(path.join(configDir, 'projects'));
  if (list === null) return { projectsDir: false, present: 0, unreadable: 0 };
  const parser = new Parser(state, env);
  const seen = new Set();
  let unreadable = 0;
  let done = 0;
  const firstRun = !Object.keys(state.files).length;
  for (const f of list) {
    const fh = h16(toPosix(f.abs));
    seen.add(fh);
    let st;
    try { st = statSync(f.abs); } catch { unreadable++; continue; }
    let fs = state.files[fh];
    const reset = fullRescan || !fs || fs.inode !== st.ino || st.size < fs.offset || (st.size === fs.size && st.mtimeMs !== fs.mtimeMs);
    if (reset) fs = newFileState(f.kind);
    else if (st.size === fs.size && st.mtimeMs === fs.mtimeMs) { fs.present = true; state.files[fh] = fs; continue; }
    const before = JSON.stringify(fs);
    try {
      readFrom(f.abs, fs, st.size, parser, fh);
    } catch {
      unreadable++;
      if (!reset) state.files[fh] = JSON.parse(before);
      continue;
    }
    fs.inode = st.ino; fs.size = st.size; fs.mtimeMs = st.mtimeMs; fs.present = true;
    state.files[fh] = fs;
    done++;
    if (firstRun && log && done % 200 === 0) log(`Harness Lens: 세션 기록 ${done}/${list.length}개 파일 읽음…`);
  }
  // 원본이 정리된 파일도 누적 카운터는 남긴다(FR-10).
  for (const [fh, fs] of Object.entries(state.files)) if (!seen.has(fh)) fs.present = false;
  return { projectsDir: true, present: list.length - unreadable, unreadable };
}

export { stateDir, RESPONSE_RETENTION_DAYS, DAY_MS };
