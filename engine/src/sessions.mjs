// 세션 기록 실측 집계(FR-10, PRD §6.1, engine-cli.md §4.3, §8).
// Claude Code 기록(<config-dir>/projects/**/*.jsonl)을 읽기 전용·줄 단위로 읽어 숫자만 남긴다.
// 메시지 본문·코드·도구 입력·경로 원문은 저장하지 않는다. 식별자와 경로는 해시로만 남긴다(R6).
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SESSION_PARSER_VERSION } from './constants.mjs';
import { atomicWrite, writeJson } from './store.mjs';
import { createHash } from 'node:crypto';
import { redactString } from './redact.mjs';
import { compareCodeUnits } from './util.mjs';

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

// 모델명·버전처럼 원문 그대로 저장하는 집계 문자열에도 비밀정보 제거(R3)를 적용한다.
// 형식에 맞아도 비밀정보 패턴·고엔트로피 토큰이면 버린다. 값 종류가 적어 결과를 캐시한다.
const labelCache = new Map();
export function safeLabel(value, re) {
  if (typeof value !== 'string' || !re.test(value)) return null;
  let ok = labelCache.get(value);
  if (ok === undefined) {
    ok = redactString(value, null, { wholeValue: true }) === value;
    if (labelCache.size < 4096) labelCache.set(value, ok);
  }
  return ok ? value : null;
}

// sha256 앞 8바이트(16진수 16자). 긴 해시 문자열을 잘라 붙잡지 않도록 바로 16자만 만든다.
export const h16 = (s) => createHash('sha256').update(String(s)).digest().toString('hex', 0, 8);
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
// 응답 저장소. 응답마다 객체를 만들지 않고 열 단위 typed array에 둔다(메모리 예산 200MiB, 응답 십수만 개).
// 수치 열: [freshInput, cacheCreation 총량, 그중 1시간 캐시 쓰기, cacheRead, output, 시각(ms)].
// 1시간 분할은 줄마다 최댓값으로 병합하고 읽을 때 총량으로 자른다. 분할 합은 병합 총량을 넘지 않는다.
const NCOL = 6;
const F_SIDE = 1;
export class ResponseStore {
  constructor() {
    this.index = new Map();
    this.keys = [];
    this.num = new Float64Array(NCOL * 1024);
    this.meta = new Int32Array(3 * 1024); // 모델 id, 세션 id, 플래그
    this.n = 0;
    this.strs = [];
    this.strId = new Map();
    this.sorted = null;
  }

  get size() { return this.index.size; }

  intern(s) {
    let id = this.strId.get(s);
    if (id === undefined) { id = this.strs.length; this.strs.push(s); this.strId.set(s, id); }
    return id;
  }

  // 같은 키는 필드별 최댓값. 문자열 필드는 순서에 무관하게 최솟값으로 정해 증분·전체 결과를 같게 한다.
  merge(key, fresh, cw, w1, cr, out, model, session, side, t) {
    let i = this.index.get(key);
    if (i === undefined) {
      i = this.n++;
      if (i * NCOL >= this.num.length) {
        const num = new Float64Array(this.num.length * 2); num.set(this.num); this.num = num;
        const meta = new Int32Array(this.meta.length * 2); meta.set(this.meta); this.meta = meta;
      }
      this.index.set(key, i);
      this.keys[i] = key;
      const b = i * NCOL;
      this.num[b] = fresh; this.num[b + 1] = cw; this.num[b + 2] = w1; this.num[b + 3] = cr; this.num[b + 4] = out; this.num[b + 5] = t;
      this.meta[i * 3] = this.intern(model); this.meta[i * 3 + 1] = this.intern(session); this.meta[i * 3 + 2] = side ? F_SIDE : 0;
      this.sorted = null;
      return;
    }
    const b = i * NCOL;
    const nu = this.num;
    nu[b] = Math.max(nu[b], fresh); nu[b + 1] = Math.max(nu[b + 1], cw); nu[b + 2] = Math.max(nu[b + 2], w1);
    nu[b + 3] = Math.max(nu[b + 3], cr); nu[b + 4] = Math.max(nu[b + 4], out); nu[b + 5] = Math.max(nu[b + 5], t);
    if (compareCodeUnits(model, this.model(i)) < 0) this.meta[i * 3] = this.intern(model);
    if (compareCodeUnits(session, this.session(i)) < 0) this.meta[i * 3 + 1] = this.intern(session);
    if (!side) this.meta[i * 3 + 2] &= ~F_SIDE;
  }

  remove(i) {
    this.index.delete(this.keys[i]);
    this.keys[i] = null;
    this.sorted = null;
  }

  // 살아 있는 슬롯을 키 순서로. 결과는 바뀌기 전까지 재사용한다.
  slots() {
    if (!this.sorted) {
      const list = [];
      for (let i = 0; i < this.n; i++) if (this.keys[i] !== null) list.push(i);
      const keys = this.keys;
      list.sort((a, b) => compareCodeUnits(keys[a], keys[b]));
      this.sorted = list;
    }
    return this.sorted;
  }

  // [freshInput, cacheWrite5m, cacheWrite1h, cacheRead, output]
  vec(i) {
    const b = i * NCOL;
    const nu = this.num;
    const w1 = Math.min(nu[b + 2], nu[b + 1]);
    return [nu[b], nu[b + 1] - w1, w1, nu[b + 3], nu[b + 4]];
  }

  ctx(i) { const b = i * NCOL; return this.num[b] + this.num[b + 1] + this.num[b + 3]; }
  t(i) { return this.num[i * NCOL + 5]; }
  model(i) { return this.strs[this.meta[i * 3]]; }
  session(i) { return this.strs[this.meta[i * 3 + 1]]; }
  side(i) { return (this.meta[i * 3 + 2] & F_SIDE) !== 0; }

  row(i) {
    const b = i * NCOL;
    const nu = this.num;
    return [this.keys[i], nu[b], nu[b + 1], nu[b + 2], nu[b + 3], nu[b + 4], this.model(i), this.session(i), this.side(i) ? 1 : 0, nu[b + 5]];
  }
}

// 해시 키(h16, 8바이트) 집합. 확정된 키는 정렬된 Uint32Array 쌍으로, 이번 실행에 더한 키는 Set으로 둔다.
// archive로 접힌 응답과 이미 센 도구 호출·결과 등 이벤트의 중복 식별에 쓴다.
export class KeySet {
  constructor(sorted = new Uint32Array(0)) {
    this.sorted = sorted;
    this.added = new Set();
  }

  static fromBuffer(buf) {
    const n = Math.floor(buf.length / 8);
    const a = new Uint32Array(n * 2);
    for (let i = 0; i < n * 2; i++) a[i] = buf.readUInt32BE(i * 4);
    return new KeySet(a);
  }

  get size() { return this.sorted.length / 2 + this.added.size; }

  has(hex) {
    if (this.added.has(hex)) return true;
    const hi = Number.parseInt(hex.slice(0, 8), 16);
    const lo = Number.parseInt(hex.slice(8, 16), 16);
    const a = this.sorted;
    let l = 0;
    let r = a.length / 2 - 1;
    while (l <= r) {
      const m = (l + r) >>> 1;
      const h = a[m * 2];
      const x = a[m * 2 + 1];
      if (h === hi && x === lo) return true;
      if (h < hi || (h === hi && x < lo)) l = m + 1; else r = m - 1;
    }
    return false;
  }

  add(hex) { if (!this.has(hex)) this.added.add(hex); }

  toBuffer() {
    const extra = [...this.added].sort(compareCodeUnits);
    const a = this.sorted;
    const out = Buffer.allocUnsafe((a.length / 2 + extra.length) * 8);
    let i = 0;
    let j = 0;
    let o = 0;
    const put = (hi, lo) => { out.writeUInt32BE(hi, o); out.writeUInt32BE(lo, o + 4); o += 8; };
    while (i < a.length || j < extra.length) {
      const eh = j < extra.length ? Number.parseInt(extra[j].slice(0, 8), 16) : Infinity;
      const el = j < extra.length ? Number.parseInt(extra[j].slice(8, 16), 16) : Infinity;
      if (i < a.length && (a[i] < eh || (a[i] === eh && a[i + 1] < el))) { put(a[i], a[i + 1]); i += 2; } else { put(eh, el); j++; }
    }
    return out;
  }
}

function emptyState(rootHash) {
  return {
    parserVersion: SESSION_PARSER_VERSION, rootPathHash: rootHash, files: {}, attribution: {}, responses: new ResponseStore(),
    archive: { days: {}, responses: 0 }, archivedKeys: new KeySet(), events: new KeySet(),
  };
}

function stateDir(out) { return path.join(out, 'sessions'); }

// 파일을 줄 단위로 읽는다(한 번에 문자열 하나로 올리지 않는다).
function forEachLine(file, fn) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let carry = '';
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + buf.toString('utf8', 0, n);
      const parts = text.split('\n');
      carry = parts.pop();
      for (const l of parts) if (l) fn(l);
    }
    if (carry) fn(carry);
  } finally {
    closeSync(fd);
  }
}

export function loadState(dir, rootHash) {
  try {
    if (!existsSync(path.join(dir, 'cursor.json'))) return { state: emptyState(rootHash), had: false };
    const cursor = JSON.parse(readFileSync(path.join(dir, 'cursor.json'), 'utf8'));
    if (cursor.parserVersion !== SESSION_PARSER_VERSION || cursor.rootPathHash !== rootHash) return { state: emptyState(rootHash), had: false };
    const state = emptyState(rootHash);
    const rdir = path.join(dir, 'responses');
    if (existsSync(rdir)) {
      for (const f of readdirSync(rdir).sort(compareCodeUnits)) {
        if (!f.endsWith('.jsonl')) continue;
        forEachLine(path.join(rdir, f), (l) => {
          const [k, fresh, cw, w1, cr, out, model, session, side, t] = JSON.parse(l);
          state.responses.merge(k, fresh, cw, w1, cr, out, model, session, side === 1, t);
        });
      }
    }
    const read = (f, d) => (existsSync(path.join(dir, f)) ? JSON.parse(readFileSync(path.join(dir, f), 'utf8')) : d);
    const keys = (f) => (existsSync(path.join(dir, f)) ? KeySet.fromBuffer(readFileSync(path.join(dir, f))) : new KeySet());
    Object.assign(state, {
      files: cursor.files ?? {}, attribution: read('attribution-cache.json', {}), archive: read('archive.json', { days: {}, responses: 0 }),
      archivedKeys: keys('archived-keys.bin'), events: keys('events.bin'),
    });
    return { state, had: true };
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
  atomicWrite(path.join(dir, 'archived-keys.bin'), state.archivedKeys.toBuffer());
  atomicWrite(path.join(dir, 'events.bin'), state.events.toBuffer());
  const rs = state.responses;
  const months = new Map();
  for (const i of rs.slots()) {
    const m = monthOf(rs.t(i));
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(i);
  }
  // 응답 맵은 크므로 월별 JSON Lines로 나눠 조금씩 쓴다(키 정렬 유지).
  for (const [m, list] of months) {
    const file = path.join(dir, 'responses', `${m}.jsonl`);
    const fd = openSync(file, 'w');
    try {
      for (let s = 0; s < list.length; s += 2000) {
        writeSync(fd, `${list.slice(s, s + 2000).map((i) => JSON.stringify(rs.row(i))).join('\n')}\n`);
      }
    } finally {
      closeSync(fd);
    }
  }
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
    kind, gen: 0, inode: null, size: 0, mtimeMs: 0, offset: 0, fp: null, present: true, session: null, cwdHash: null, cls: null, botMention: false,
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
    this.pending = new Set(); // 지금 읽는 파일에서 처음 본 이벤트 키. 파일을 다 읽은 뒤에만 확정한다.
  }

  // 도구 호출·결과·프롬프트·시스템 이벤트를 전역으로 한 번만 센다(resume/fork 복사, 회전, 같은 줄 반복).
  // id가 없으면 구분할 수 없으니 센다.
  once(kind, id) {
    if (typeof id !== 'string' || !id) return true;
    const k = h16(`${kind}:${id}`);
    if (this.pending.has(k) || this.state.events.has(k)) return false;
    this.pending.add(k);
    return true;
  }

  commit() {
    for (const k of this.pending) this.state.events.add(k);
    this.pending.clear();
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
    const version = safeLabel(o.version, VERSION_RE);
    if (version) {
      if (!fs.versions) fs.versions = [version, version];
      else {
        if (compareVersions(version, fs.versions[0]) < 0) fs.versions[0] = version;
        if (compareVersions(version, fs.versions[1]) > 0) fs.versions[1] = version;
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
    else if (!this.once(`${o.type}:${o.subtype ?? ''}`, o.uuid)) return;
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
        if (!fs.botMention && fs.cls?.kind === 'bot' && mentionsRoot(b.input, this.env.roots)) fs.botMention = true;
        if (!this.once('tool_use', b.id)) continue;
        if (side) c.subToolUse++;
        else {
          c.toolUse++;
          if (fs.openGap !== null) fs.openGap++;
        }
      }
    }
    const u = msg.usage;
    if (!u || typeof u !== 'object') return;
    const fresh = u.input_tokens;
    const cw = u.cache_creation_input_tokens;
    const cr = u.cache_read_input_tokens;
    const out = u.output_tokens;
    if (![fresh, cw, cr, out].every(isInt)) { c.badUsage++; return; }
    // 1시간 분할이 없는 줄은 0으로 둔다. 병합 뒤 분할은 병합 총량으로 자른다(ResponseStore.vec).
    const w1 = u.cache_creation && typeof u.cache_creation === 'object' && isInt(u.cache_creation.ephemeral_1h_input_tokens)
      ? u.cache_creation.ephemeral_1h_input_tokens : 0;
    const rawKey = (typeof msg.id === 'string' && msg.id) || (typeof o.requestId === 'string' && o.requestId) || `${fileHash}#${o.uuid ?? c.lines}`;
    const key = h16(rawKey);
    // archive로 접힌 응답은 이미 정확히 한 번 반영했다.
    if (this.state.archivedKeys.has(key)) return;
    const model = safeLabel(msg.model, MODEL_RE) ?? 'unknown';
    const session = typeof o.sessionId === 'string' && o.sessionId ? h16(o.sessionId) : (fs.session ?? `f:${fileHash}`);
    this.state.responses.merge(key, fresh, cw, w1, cr, out, model, session, side, Number.isFinite(ts) ? ts : 0);
  }

  user(o, fs, side) {
    const c = fs.c;
    const content = o.message && typeof o.message === 'object' ? o.message.content : undefined;
    let hasResult = false;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== 'tool_result') continue;
        hasResult = true;
        if (!this.once('tool_result', b.tool_use_id)) continue;
        if (side) { if (b.is_error === true) c.subToolErrors++; continue; }
        if (b.is_error === true) { c.toolErrors++; fs.pendingError = true; } else if (fs.pendingError) { c.recovered++; fs.pendingError = false; }
      }
    }
    if (side) return;
    let human;
    if (o.origin && typeof o.origin === 'object') human = o.origin.kind === 'human';
    else human = o.isMeta !== true && !hasResult && (typeof content === 'string' || (Array.isArray(content) && content.some((b) => b && b.type === 'text')));
    if (!human || !this.once('human', o.uuid)) return;
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
    fs.fp = fingerprint(fd, fs.offset);
  } finally {
    closeSync(fd);
  }
}

// 커서까지 읽은 앞부분의 지문: 파일 첫 4KiB와 커서 직전 4KiB의 해시.
// copytruncate 뒤 다시 자라 크기만으로 구분되지 않는 경우나 같은 경로로 회전한 파일을 알아본다.
const FP_BYTES = 4096;
function fingerprint(fd, offset) {
  if (!offset) return null;
  const part = (from, len) => {
    const b = Buffer.alloc(len);
    const n = readSync(fd, b, 0, len, from);
    return h16(b.subarray(0, n).toString('latin1'));
  };
  const len = Math.min(FP_BYTES, offset);
  return `${part(0, len)}:${part(offset - len, len)}`;
}

// 확정된 커서까지의 바이트가 그대로인가. 그대로면 커서부터 이어 읽는다.
function prefixIntact(abs, fs, size) {
  if (size < fs.offset) return false;
  if (!fs.offset) return true;
  const fd = openSync(abs, 'r');
  try { return fingerprint(fd, fs.offset) === fs.fp; } finally { closeSync(fd); }
}

// 상태에 새 바이트를 반영한다. 반환: { files, unreadable, rescanned }
// 같은 경로의 앞부분이 바뀌었으면(회전·truncate·재작성) 새 세대로 처음부터 읽고, 이전 세대는 `<경로 해시>~g<n>`로
// 남겨 그 세션의 귀속·카운터를 보존한다. 응답과 이벤트는 전역으로 한 번만 세므로 같은 내용을 다시 읽어도 늘지 않는다.
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
    const prev = fullRescan ? undefined : state.files[fh];
    if (prev && st.ino === prev.inode && st.size === prev.size && st.mtimeMs === prev.mtimeMs) { prev.present = true; continue; }
    let fs;
    let retire = false;
    if (!prev) fs = newFileState(f.kind);
    else {
      try { retire = !prefixIntact(f.abs, prev, st.size); } catch { unreadable++; continue; }
      if (retire) { fs = newFileState(f.kind); fs.gen = prev.gen + 1; } else fs = JSON.parse(JSON.stringify(prev));
    }
    try {
      readFrom(f.abs, fs, st.size, parser, fh);
    } catch {
      // 읽다 실패하면 이 파일의 상태와 이벤트는 그대로 두고 다음 실행에서 다시 읽는다.
      unreadable++;
      parser.pending.clear();
      continue;
    }
    parser.commit();
    if (retire) state.files[`${fh}~g${prev.gen}`] = { ...prev, present: false };
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
