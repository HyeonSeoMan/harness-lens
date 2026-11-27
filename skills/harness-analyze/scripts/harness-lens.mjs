// Harness Lens 엔진 번들. 생성 파일이므로 직접 고치지 말고 engine/src를 고친 뒤 npm run build 하세요.
if (Number(process.versions.node.split('.')[0]) < 20) {
  var hlMsg = 'Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요.';
  if (process.argv.indexOf('--json') >= 0) process.stdout.write(JSON.stringify({ ok: false, code: 'node_too_old', message: hlMsg }) + '\n');
  else process.stderr.write(hlMsg + '\n');
  process.exit(10);
}

// src/cli.mjs
import { spawn } from "child_process";
import { accessSync, constants as fsc, existsSync as existsSync5, readdirSync as readdirSync4, realpathSync as realpathSync3, rmSync as rmSync2, statSync as statSync4, writeFileSync as writeFileSync2 } from "fs";
import { homedir as homedir3 } from "os";
import path6 from "path";
import { performance } from "perf_hooks";
import { pathToFileURL } from "url";

// src/constants.mjs
var ENGINE_VERSION = "0.2.0";
var VALIDATOR_VERSION = "0.2.0";
var SCHEMA_VERSION = "0.1";
var RUBRIC_VERSION = "0.2";
var SESSION_PARSER_VERSION = null;
var PRICING_TABLE_VERSION = null;
var MIN_NODE_MAJOR = 20;
var SUPPORTED_PLATFORMS = ["darwin", "linux", "win32"];
var AXES = [
  "spec_clarity",
  "verification_gate_strength",
  "execution_stability",
  "throughput",
  "cost_efficiency",
  "context_efficiency",
  "autonomy",
  "safety_boundary"
];
var AXIS_PREFIX = {
  spec_clarity: "SC",
  verification_gate_strength: "VG",
  execution_stability: "ES",
  throughput: "TP",
  cost_efficiency: "CE",
  context_efficiency: "CX",
  autonomy: "AU",
  safety_boundary: "SB"
};
var PREFIX_AXIS = Object.fromEntries(Object.entries(AXIS_PREFIX).map(([a, p]) => [p, a]));
var AXIS_MAX = Object.fromEntries(AXES.map((a) => [a, a === "throughput" ? 2 : 3]));
var MATURITY_RULES = {
  spec_clarity: { measurable: false, blockedReason: "needs_ci_pr_data" },
  verification_gate_strength: { measurable: false, blockedReason: "needs_ci_pr_data" },
  execution_stability: { measurable: true, unit: "tool_calls", required: 500 },
  throughput: { measurable: true, unit: "sessions", required: 20 },
  cost_efficiency: { measurable: true, unit: "sessions", required: 20 },
  context_efficiency: { measurable: true, unit: "sessions", required: 20 },
  autonomy: { measurable: true, unit: "tool_calls", required: 500 },
  safety_boundary: { measurable: false, blockedReason: "session_format_unconfirmed" }
};
var BUDGETS = {
  always_loaded_tokens: { target: 100, unit: "tokens" },
  background_processes: { target: 0, unit: "count" },
  reanalysis_engine_ms: { target: 5e3, unit: "ms" },
  engine_max_rss_bytes: { target: 200 * 1024 * 1024, unit: "bytes" },
  llm_input_inventory_tokens: { target: 6e3, unit: "tokens" },
  llm_tokens_per_analysis: { target: 12e4, unit: "tokens" }
};
var EXIT = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  RUNTIME: 10,
  LOCKED: 11,
  NO_PROJECT: 12,
  INVALID: 30,
  VERSION_MISMATCH: 31,
  SNAPSHOT_WRITE: 40,
  NOT_FOUND: 41,
  RENDER: 50,
  BUDGET: 60
};
var TEXT_LIMIT_BYTES = 1024 * 1024;
var SCRIPT_LIMIT_BYTES = 256 * 1024;
var MAX_IMPORT_DEPTH = 5;
var RUNS_TO_KEEP = 5;

// src/collect.mjs
import { existsSync, readdirSync as readdirSync2, realpathSync as realpathSync2, statSync as statSync2 } from "fs";
import { homedir as homedir2 } from "os";
import path2 from "path";

// src/fsguard.mjs
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";

// src/util.mjs
import { createHash } from "crypto";
function sha256hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
function sha256tag(input) {
  return `sha256:${sha256hex(input)}`;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) {
      if (value[key] !== void 0) out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareTuples(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return compareCodeUnits(String(x), String(y));
  }
  return 0;
}
function stableStringify(value) {
  return `${JSON.stringify(canonical(value), null, 2)}
`;
}
function hashInput(value) {
  return JSON.stringify(canonical(value));
}
function hashJson(value) {
  return sha256tag(hashInput(value));
}
var componentId = (kind, origin, key) => `c_${sha256hex(`${kind}|${origin}|${key}`).slice(0, 12)}`;
var evidenceId = (cid, keyPath, line, family) => `ev_${sha256hex(`${cid}|${keyPath ?? ""}|${line ?? ""}|${family}`).slice(0, 12)}`;
var changeId = (from, to, cid, change) => `chg_${sha256hex(`${from}|${to}|${cid}|${change}`).slice(0, 12)}`;
function compactUtc(iso) {
  return iso.replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "");
}
function isoSeconds(date) {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}
function truncate(text, max) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort(compareCodeUnits);
}

// src/fsguard.mjs
function toPosix(p) {
  return p.split(path.sep).join("/");
}
function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
function displayPath(abs, projectRoot) {
  if (projectRoot && within(projectRoot, abs)) {
    const rel = toPosix(path.relative(projectRoot, abs));
    return rel === "" ? "." : rel;
  }
  const home = homedir();
  if (within(home, abs)) return `~/${toPosix(path.relative(home, abs))}`;
  return `<abs:${sha256hex(toPosix(abs)).slice(0, 8)}>`;
}
function resolveInside(root, rel) {
  if (path.isAbsolute(rel) || toPosix(rel).split("/").includes("..")) return { status: "escape" };
  const abs = path.join(root, rel);
  let lst;
  try {
    lst = lstatSync(abs);
  } catch (err) {
    return { status: err.code === "ENOENT" || err.code === "ENOTDIR" ? "absent" : "unreadable", abs };
  }
  let real;
  let rootReal;
  try {
    real = realpathSync(abs);
    rootReal = realpathSync(root);
  } catch {
    return { status: lst.isSymbolicLink() ? "escape" : "unreadable", abs };
  }
  if (!within(rootReal, real)) return { status: "escape", abs };
  try {
    const st = statSync(real);
    return { status: "ok", abs, real, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return { status: "unreadable", abs };
  }
}
function readTextInside(root, rel, limit) {
  const r = resolveInside(root, rel);
  if (r.status !== "ok") return r;
  if (r.isDir) return { ...r, status: "unsupported", reason: "is_directory" };
  if (r.size > limit) return { ...r, status: "unsupported", reason: "too_large" };
  try {
    return { ...r, text: readFileSync(r.real, "utf8") };
  } catch {
    return { ...r, status: "unreadable" };
  }
}
function listDirInside(root, rel) {
  const r = resolveInside(root, rel);
  if (r.status !== "ok" || !r.isDir) return { status: r.status === "ok" ? "absent" : r.status, entries: [] };
  try {
    return { status: "ok", entries: readdirSync(r.real).sort() };
  } catch {
    return { status: "unreadable", entries: [] };
  }
}

// src/frontmatter.mjs
function scalar(raw) {
  const v = raw.trim();
  if (v === "") return null;
  if (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== null).map(String);
  }
  return v;
}
function parseFrontmatter(text) {
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") return { ok: false, data: {}, body: text, bodyStartLine: 1 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { ok: false, data: {}, body: text, bodyStartLine: 1 };
  const data = {};
  let ok = true;
  let listKey = null;
  let blockKey = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (blockKey && /^\s+/.test(line)) {
      data[blockKey] = data[blockKey] ? `${data[blockKey]} ${line.trim()}` : line.trim();
      continue;
    }
    blockKey = null;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(String(scalar(item[1])));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!kv) {
      ok = false;
      continue;
    }
    const [, key, rest] = kv;
    listKey = null;
    if (rest.trim() === "") {
      data[key] = [];
      listKey = key;
    } else if (/^[|>][-+]?$/.test(rest.trim())) {
      data[key] = "";
      blockKey = key;
    } else {
      data[key] = scalar(rest);
    }
  }
  return { ok, data, body: lines.slice(end + 1).join("\n"), bodyStartLine: end + 2 };
}

// src/lexicon.mjs
var NARRATIVE = [
  ["safety_boundary", ["금지", "비밀", ".env", "rm -rf", "force push", "secret", "credential", "never commit", "do not push"]],
  ["verification_gate_strength", ["테스트를 실행", "테스트 실행", "타입 검사", "리뷰", "검증", "run tests", "run the tests", "lint", "typecheck", "review", "verify"]],
  ["spec_clarity", ["수용 기준", "완료 정의", "요구사항", "명세", "코딩 규약", "acceptance criteria", "definition of done", "requirement", "spec", "convention", "style guide"]],
  ["execution_stability", ["실패하면", "실패 시", "재시도", "롤백", "복구", "on failure", "retry", "rollback", "recover"]],
  ["autonomy", ["묻지 말고", "확인 없이", "승인을 받", "without asking", "autonomously", "ask before"]],
  ["cost_efficiency", ["비용", "토큰 예산", "cost", "token budget", "cheaper model"]],
  ["context_efficiency", ["컨텍스트", "/clear", "/compact", "context window", "subagent로 위임", "delegate to a subagent"]],
  ["throughput", ["병렬", "동시에", "parallel", "concurrently", "in the background"]]
];
var ROLES = [
  ["reviewer", ["review", "verif", "audit", "qa", "critic", "검토", "리뷰", "검증"]],
  ["spec", ["spec", "plan", "prd", "requirement", "명세", "계획", "요구사항"]],
  ["recovery", ["rollback", "recover", "checkpoint", "restore", "복구", "롤백"]],
  ["parallel", ["parallel", "fan-out", "dispatch", "병렬"]],
  ["explorer", ["explore", "search", "research", "investigat", "탐색", "조사"]]
];
var VERIFY_CMD = ["test", "lint", "eslint", "prettier --check", "tsc", "typecheck", "pytest", "ruff", "cargo clippy", "go vet", "mvn verify", "gradle check"];
var SPEC_CMD = ["spec", "prd", "acceptance", "requirements", "명세"];
var BLOCK = ["exit 2", '"decision": "block"', '"permissionDecision": "deny"', '"continue": false'];
var REENTRY = ["stop_hook_active"];
var norm = (s) => s.normalize("NFC").toLowerCase();
function hasAny(text, words) {
  const t = norm(text);
  return words.some((w) => t.includes(norm(w)));
}
function hasBlockMarker(text) {
  const t = norm(text).replace(/\s+/g, "");
  return BLOCK.some((w) => t.includes(norm(w).replace(/\s+/g, "")));
}
function narrativeAxes(line) {
  return NARRATIVE.filter(([, words]) => hasAny(line, words)).map(([axis]) => axis);
}
function detectRole(name, description) {
  const text = `${name ?? ""} ${description ?? ""}`;
  for (const [role, words] of ROLES) if (hasAny(text, words)) return role;
  return null;
}
var AXIS_LABEL = {
  spec_clarity: "명세 명확성",
  verification_gate_strength: "검증 게이트 강도",
  execution_stability: "실행 안정성",
  throughput: "처리 속도",
  cost_efficiency: "비용 효율",
  context_efficiency: "컨텍스트 효율",
  autonomy: "자율성",
  safety_boundary: "안전 경계"
};

// src/redact.mjs
var SENSITIVE_NAMES = [
  /^\.env$/i,
  /^\.env\..*/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /credentials/i,
  /^\.netrc$/i
];
function isSensitiveFile(name) {
  const base = name.split("/").pop();
  return SENSITIVE_NAMES.some((re) => re.test(base));
}
var PATTERNS = [
  ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["anthropic_key", /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai_key", /sk-[A-Za-z0-9]{20,}/g],
  ["github_token", /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/g],
  ["slack_token", /xox[abpr]-[A-Za-z0-9-]{10,}/g],
  ["aws_access_key", /AKIA[0-9A-Z]{16}/g],
  ["jwt", /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g],
  ["url_credentials", /:\/\/[^/\s:@]+:[^/\s@]+@/g],
  ["assignment", /(api[_-]?key|token|secret|password|passwd|authorization|bearer)["']?\s*[:=]\s*["']?[^\s"']{8,}/gi]
];
var TOKEN_RUN = /^[A-Za-z0-9+/=_-]{32,}$/;
var QUOTED_RUN = /(["'])([A-Za-z0-9+/=_-]{32,})\1/g;
function shannonEntropy(s) {
  const counts = /* @__PURE__ */ new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
var marker = (kind) => `[REDACTED:${kind}]`;
var RedactionCounter = class {
  constructor() {
    this.counts = /* @__PURE__ */ new Map();
  }
  add(kind, n = 1) {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + n);
  }
  toArray() {
    return [...this.counts.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([kind, count]) => ({ kind, count }));
  }
};
function redactString(text, counter, { wholeValue = false } = {}) {
  let out = text;
  for (const [kind, re] of PATTERNS) {
    out = out.replace(re, (m) => {
      if (m.includes("[REDACTED:")) return m;
      counter == null ? void 0 : counter.add(kind);
      return kind === "url_credentials" ? `://${marker(kind)}@` : marker(kind);
    });
  }
  out = out.replace(QUOTED_RUN, (m, q, run) => {
    if (shannonEntropy(run) < 4) return m;
    counter == null ? void 0 : counter.add("high_entropy");
    return `${q}${marker("high_entropy")}${q}`;
  });
  if (wholeValue && TOKEN_RUN.test(out) && shannonEntropy(out) >= 4) {
    counter == null ? void 0 : counter.add("high_entropy");
    out = marker("high_entropy");
  }
  return out;
}
function detectSecrets(text) {
  const kinds = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    const m = text.match(re);
    if (m && m.some((x) => !x.includes("[REDACTED:"))) kinds.push(kind);
  }
  for (const m of text.matchAll(QUOTED_RUN)) if (shannonEntropy(m[2]) >= 4) kinds.push("high_entropy");
  return kinds;
}
function mapStrings(value, fn, path7 = "") {
  if (typeof value === "string") return fn(value, path7);
  if (Array.isArray(value)) return value.map((v, i) => mapStrings(v, fn, `${path7}/${i}`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn, `${path7}/${k}`);
    return out;
  }
  return value;
}
function rescanAndRedact(value) {
  const hits = [];
  const out = mapStrings(value, (s, p) => {
    if (detectSecrets(s).length === 0) return s;
    hits.push(p);
    return redactString(s, null);
  });
  return { value: out, hits };
}
var NUMERIC_KEEP = /* @__PURE__ */ new Set([
  "MAX_THINKING_TOKENS",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "MAX_MCP_OUTPUT_TOKENS",
  "BASH_MAX_OUTPUT_LENGTH",
  "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION"
]);
function keepEnvValue(key, value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value);
  if (NUMERIC_KEEP.has(key) && /^[0-9]+$/.test(s)) return s;
  if (key === "CLAUDE_CODE_SUBAGENT_MODEL" && /^[a-z0-9.-]{1,60}$/.test(s)) return s;
  return null;
}
function urlSchemeHost(url) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/@\s]*@)?([^/:?#\s]+)/i.exec(String(url));
  return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null;
}
var ANALYZER_TARGETING = [
  /ignore (all )?(previous|prior) instructions/i,
  /harness[ -]?lens/i,
  /analysis tool/i,
  /이전 지시를 무시/
];
function targetsAnalyzer(line) {
  return ANALYZER_TARGETING.some((re) => re.test(line));
}

// src/collect.mjs
var ORIGIN_RANK = { managed: 0, project_local: 1, project_shared: 2, user: 3, plugin: 4 };
var HIGH_COST_TOOLS = /* @__PURE__ */ new Set(["WebSearch", "WebFetch", "Task", "Agent"]);
var INTERPRETERS = /* @__PURE__ */ new Set(["bash", "sh", "zsh", "node", "python", "python3", "deno", "bun"]);
var A_MODES = /* @__PURE__ */ new Set(["acceptEdits", "auto", "dontAsk", "bypassPermissions"]);
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", "vendor", "dist", "build", "target", "coverage"]);
var CX_ENV = ["MAX_MCP_OUTPUT_TOKENS", "BASH_MAX_OUTPUT_LENGTH", "CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS"];
var CE_ENV = ["MAX_THINKING_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_SUBAGENT_MODEL"];
var R8_PLACEHOLDER = "[분석 도구 겨냥 문구 제거]";
var pointer = (...parts) => parts.map((p) => `/${String(p).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
function managedSettingsPath(platform) {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}
function splitCommand(command) {
  const out = [];
  for (const m of command.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g)) out.push(m[0].replace(/["']/g, ""));
  return out;
}
function hookScriptPath(command) {
  const tokens = splitCommand(command).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  let i = 0;
  if (tokens[0] && INTERPRETERS.has(path2.basename(tokens[0]))) {
    i = 1;
    while (tokens[i] && tokens[i].startsWith("-")) i++;
  }
  const raw = tokens[i];
  if (!raw) return null;
  const sub = raw.replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, ".").replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, ".");
  if (!sub.includes("/") && !/\.(sh|bash|js|mjs|cjs|ts|py|rb)$/.test(sub)) return null;
  return sub;
}
var Collector = class {
  constructor({ projectRoot, scope, configDir, skillDir: skillDir2, platform = process.platform }) {
    this.projectRoot = projectRoot;
    this.scope = scope;
    this.configDir = configDir;
    this.skillDir = skillDir2;
    this.platform = platform;
    this.counter = new RedactionCounter();
    this.sources = /* @__PURE__ */ new Map();
    this.fileCache = /* @__PURE__ */ new Map();
    this.hashEntries = /* @__PURE__ */ new Map();
    this.components = /* @__PURE__ */ new Map();
    this.evidence = /* @__PURE__ */ new Map();
    this.alwaysLoaded = [];
    this.r8Hits = 0;
    this.plugins = [];
    this.selfInstalledInProject = false;
  }
  // 개수는 파일을 읽을 때 한 번만 센다(countJsonSecrets·readFile). 여기서는 치환만 한다.
  red(text, opts) {
    return redactString(String(text), null, opts);
  }
  countJsonSecrets(raw) {
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const walk = (v) => {
      if (typeof v === "string") redactString(v, this.counter, { wholeValue: true });
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => {
        redactString(k, this.counter);
        walk(x);
      });
    };
    walk(json);
  }
  // 화면·출력용 짧은 문자열: R3 → R8 → 길이 제한
  clean(text, max) {
    const s = String(text ?? "");
    if (targetsAnalyzer(s)) {
      this.r8Hits++;
      return R8_PLACEHOLDER;
    }
    return truncate(this.red(s).replace(/\s+/g, " ").trim(), max) || "-";
  }
  addSource(disp, origin, status, reason = null) {
    const key = `${disp}|${origin}`;
    const prev = this.sources.get(key);
    if (prev && prev.status === "read") return;
    this.sources.set(key, { path: disp, origin, status, reason });
  }
  // root 기준 rel 파일을 읽는다. R1·크기·경계 검사를 모두 거친다.
  readFile(root, rel, origin, limit = TEXT_LIMIT_BYTES) {
    const abs = path2.join(root, rel);
    const disp = displayPath(abs, this.projectRoot);
    const cacheKey = `${disp}|${origin}`;
    if (this.fileCache.has(cacheKey)) return this.fileCache.get(cacheKey);
    let result = null;
    if (isSensitiveFile(toPosix(rel))) {
      this.addSource(disp, origin, "skipped_sensitive", "sensitive_filename");
      result = { status: "sensitive", disp };
    } else {
      const r = readTextInside(root, rel, limit);
      if (r.status === "ok") {
        const raw = r.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
        this.addSource(disp, origin, "read");
        this.hashEntries.set(disp, sha256hex(raw));
        const text = /\.json$/i.test(rel) ? raw : redactString(raw, this.counter);
        if (/\.json$/i.test(rel)) this.countJsonSecrets(raw);
        result = { text, raw, disp, status: "ok" };
      } else if (r.status === "absent") {
        this.addSource(disp, origin, "absent");
        result = { status: "absent", disp };
      } else if (r.status === "escape") {
        this.addSource(disp, origin, "out_of_scope", "outside_root_or_symlink_escape");
        result = { status: "escape", disp };
      } else if (r.status === "unsupported") {
        this.addSource(disp, origin, "unsupported", r.reason);
        result = { status: "unsupported", disp };
      } else {
        this.addSource(disp, origin, "unreadable", "read_error");
        this.hashEntries.set(disp, "unreadable");
        result = { status: "unreadable", disp };
      }
    }
    this.fileCache.set(cacheKey, result);
    return result;
  }
  addComponent({ kind, origin, key, name, paths, contentHash, attributes }) {
    const id = componentId(kind, origin, key);
    const attrs = {};
    for (const [k, v] of Object.entries(attributes ?? {})) {
      if (Array.isArray(v)) attrs[k] = v.slice(0, 50).map((x) => truncate(String(x), 120));
      else if (typeof v === "string") attrs[k] = truncate(v, 200);
      else attrs[k] = v ?? null;
    }
    const comp = { id, kind, name: truncate(name, 200), origin, paths: [...new Set(paths)], contentHash, attributes: attrs, _key: key };
    this.components.set(id, comp);
    return comp;
  }
  addEvidence({ comp, path: p, line = null, keyPath = null, family, fact, mechanism, primaryAxis = null, secondaryAxes = [], ruleIds = [], levelCap = null, tags = {} }) {
    const id = evidenceId(comp.id, keyPath, line, family);
    const ev = {
      id,
      componentId: comp.id,
      path: p,
      line,
      keyPath,
      fact: truncate(this.red(fact), 200),
      mechanism,
      primaryAxis,
      secondaryAxes: [...new Set(secondaryAxes)].filter((a) => a !== primaryAxis),
      ruleIds: [...ruleIds],
      void: null,
      levelCap,
      _tags: { ...tags, kind: comp.kind, origin: comp.origin, family }
    };
    this.evidence.set(id, ev);
    return ev;
  }
  // ---------- 지침 ----------
  collectInstructions(root, rel, origin, { alwaysLoaded, subdir = false, depth = 0, visited = /* @__PURE__ */ new Set() }) {
    const f = this.readFile(root, rel, origin);
    if (!f || f.status !== "ok" || visited.has(f.disp)) return;
    visited.add(f.disp);
    const lines = f.text.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    const headings = [];
    const imports = [];
    const perAxis = /* @__PURE__ */ new Map();
    let fence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (targetsAnalyzer(line)) {
        this.r8Hits++;
        return;
      }
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h && !fence && headings.length < 50) headings.push(truncate(this.red(h[1].trim()), 120));
      if (!fence) {
        for (const m of line.matchAll(/(?:^|\s)@([~\w./-]+)/g)) if (/[./]/.test(m[1])) imports.push(m[1]);
      }
      if (!alwaysLoaded) return;
      const axes = narrativeAxes(line);
      if (!axes.length) return;
      const [primary, ...rest] = axes;
      let rec = perAxis.get(primary);
      if (!rec) {
        rec = { line: i + 1, count: 0, excerpt: line.trim(), secondary: /* @__PURE__ */ new Set() };
        perAxis.set(primary, rec);
      }
      rec.count++;
      rest.forEach((a) => rec.secondary.add(a));
    });
    const comp = this.addComponent({
      kind: "instructions",
      origin,
      key: f.disp,
      name: f.disp,
      paths: [f.disp],
      contentHash: sha256tag(f.raw),
      attributes: { lines: lines.length, imports: imports.length, headings, alwaysLoaded, bytes: Buffer.byteLength(f.text, "utf8") }
    });
    for (const [axis, rec] of perAxis) {
      const prefix = { safety_boundary: "SB", verification_gate_strength: "VG", spec_clarity: "SC", execution_stability: "ES", autonomy: "AU", cost_efficiency: "CE", throughput: "TP" }[axis];
      this.addEvidence({
        comp,
        path: f.disp,
        line: rec.line,
        family: `nar:${axis}`,
        mechanism: "narrative",
        fact: `${f.disp}:${rec.line} ${AXIS_LABEL[axis]} 서술 ${rec.count}줄 — "${truncate(this.red(rec.excerpt), 160)}"`,
        primaryAxis: axis,
        secondaryAxes: [...rec.secondary],
        ruleIds: prefix ? [`${prefix}-L1-01`] : [],
        tags: { narrativeLines: rec.count }
      });
    }
    if (alwaysLoaded) {
      this.alwaysLoaded.push({ disp: f.disp, lines: lines.length, bytes: Buffer.byteLength(f.text, "utf8") });
      this.addEvidence({
        comp,
        path: f.disp,
        family: "size",
        mechanism: "narrative",
        fact: `상시 로드 지침 ${f.disp} ${lines.length}줄`,
        primaryAxis: "context_efficiency",
        tags: { alwaysLoadedLines: lines.length }
      });
    }
    if (subdir) {
      this.addEvidence({
        comp,
        path: f.disp,
        family: "subdir",
        mechanism: "narrative",
        fact: `하위 디렉터리 지침 ${f.disp}(필요 시 로드)`,
        primaryAxis: "context_efficiency",
        ruleIds: ["CX-L2-04"]
      });
    }
    if (depth >= MAX_IMPORT_DEPTH) return;
    const dir = path2.posix.dirname(toPosix(rel));
    for (const imp of imports) {
      if (imp.startsWith("~/") || path2.isAbsolute(imp)) {
        const disp = imp.startsWith("~/") ? imp : displayPath(imp, this.projectRoot);
        this.addSource(disp, origin, "out_of_scope", "import_outside_root");
        continue;
      }
      const target = path2.posix.normalize(path2.posix.join(dir, imp));
      if (target.startsWith("..")) {
        this.addSource(truncate(`<import:${sha256hex(imp).slice(0, 8)}>`, 40), origin, "out_of_scope", "import_outside_root");
        continue;
      }
      this.collectInstructions(root, target, origin, { alwaysLoaded, depth: depth + 1, visited });
    }
  }
  findSubdirInstructions() {
    const found = [];
    const walk = (absDir, rel, depth) => {
      let entries;
      try {
        entries = readdirSync2(absDir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      for (const e of entries) {
        if (e.isSymbolicLink() || !e.isDirectory()) continue;
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const childAbs = path2.join(absDir, e.name);
        try {
          if (readdirSync2(childAbs).includes("CLAUDE.md")) found.push(`${childRel}/CLAUDE.md`);
        } catch {
          continue;
        }
        if (depth < 3) walk(childAbs, childRel, depth + 1);
      }
    };
    walk(this.projectRoot, "", 1);
    return found;
  }
  // ---------- 설정 ----------
  collectSettings(root, rel, origin) {
    var _a, _b;
    const f = this.readFile(root, rel, origin);
    if (!f || f.status !== "ok") return;
    let json;
    try {
      json = JSON.parse(f.text);
    } catch {
      this.addSource(f.disp, origin, "unsupported", "invalid_json");
      return;
    }
    if (!json || typeof json !== "object") return;
    const perms = json.permissions && typeof json.permissions === "object" ? json.permissions : {};
    const list = (k) => Array.isArray(perms[k]) ? perms[k].map(String) : [];
    const allow = list("allow");
    const ask = list("ask");
    const deny = list("deny");
    const env = json.env && typeof json.env === "object" ? json.env : {};
    const defaultMode = typeof perms.defaultMode === "string" ? perms.defaultMode : null;
    const disableBypass = perms.disableBypassPermissionsMode ?? json.disableBypassPermissionsMode ?? null;
    const comp = this.addComponent({
      kind: "settings",
      origin,
      key: f.disp,
      name: f.disp,
      paths: [f.disp],
      contentHash: sha256tag(f.raw),
      attributes: {
        allowRules: allow.length,
        askRules: ask.length,
        denyRules: deny.length,
        defaultMode: defaultMode && this.clean(defaultMode, 40),
        model: typeof json.model === "string" ? this.clean(json.model, 80) : null,
        sandboxEnabled: ((_a = json.sandbox) == null ? void 0 : _a.enabled) === true,
        disableAllHooks: json.disableAllHooks === true,
        envKeys: Object.keys(env).sort().map((k) => this.clean(k, 80))
      }
    });
    const ev = (o) => this.addEvidence({ comp, path: f.disp, mechanism: "harness_enforced", ...o });
    if (allow.length) {
      const bareBash = allow.some((r) => r === "Bash" || r === "Bash(*)");
      ev({ keyPath: "/permissions/allow", family: "allow", fact: `permissions.allow 규칙 ${allow.length}개${bareBash ? "(인자 없는 Bash 포함)" : ""}`, primaryAxis: "autonomy", tags: { a: true, bareBash } });
    }
    if (ask.length) ev({ keyPath: "/permissions/ask", family: "ask", fact: `permissions.ask 규칙 ${ask.length}개`, primaryAxis: "autonomy", secondaryAxes: ["safety_boundary"], tags: { b: "ask", askCount: ask.length } });
    if (deny.length) ev({ keyPath: "/permissions/deny", family: "deny", fact: `permissions.deny 규칙 ${deny.length}개`, primaryAxis: "safety_boundary", ruleIds: ["SB-L2-03"], tags: { deny: true } });
    if (defaultMode) {
      const base = { keyPath: "/permissions/defaultMode", family: "defaultMode", fact: `permissions.defaultMode = ${this.clean(defaultMode, 40)}`, tags: { scalarKey: "defaultMode", defaultMode } };
      if (defaultMode === "plan") ev({ ...base, primaryAxis: "spec_clarity", ruleIds: ["SC-L2-03"] });
      else ev({ ...base, primaryAxis: "autonomy", tags: { ...base.tags, a: A_MODES.has(defaultMode) } });
    }
    if (disableBypass === "disable") ev({ keyPath: json.disableBypassPermissionsMode ? "/disableBypassPermissionsMode" : "/permissions/disableBypassPermissionsMode", family: "disableBypass", mechanism: "org_enforced", fact: "disableBypassPermissionsMode = disable", primaryAxis: "safety_boundary", ruleIds: ["SB-L3-02"], tags: { scalarKey: "disableBypassPermissionsMode" } });
    if (((_b = json.sandbox) == null ? void 0 : _b.enabled) === true) ev({ keyPath: "/sandbox/enabled", family: "sandbox", mechanism: "org_enforced", fact: "sandbox.enabled = true", primaryAxis: "safety_boundary", ruleIds: ["SB-L3-01"], tags: { scalarKey: "sandbox.enabled" } });
    if (typeof json.model === "string") ev({ keyPath: "/model", family: "model", fact: `최상위 model = ${this.clean(json.model, 60)}`, primaryAxis: "cost_efficiency", ruleIds: ["CE-L1-02"], tags: { scalarKey: "model" } });
    for (const key of Object.keys(env).sort()) {
      const kept = keepEnvValue(key, env[key]);
      const shown = kept === null ? "(값 제거됨)" : kept;
      const base = { keyPath: pointer("env", key), family: `env:${key}`, fact: `env.${key} = ${shown}`, tags: { scalarKey: `env.${key}`, envKey: key, envValue: kept } };
      if (CE_ENV.includes(key)) ev({ ...base, primaryAxis: "cost_efficiency", ruleIds: ["CE-L2-02"] });
      else if (key === "CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION") ev({ ...base, primaryAxis: "cost_efficiency", ruleIds: ["CE-L3-01"] });
      else if (CX_ENV.includes(key)) {
        const ok = key !== "MAX_MCP_OUTPUT_TOKENS" || kept !== null && Number(kept) < 25e3;
        ev({ ...base, primaryAxis: "context_efficiency", ruleIds: ok ? ["CX-L3-01"] : [] });
      }
    }
    if (json.disableAllHooks === true) this.disableAllHooks.push({ origin });
    if (json.hooks && typeof json.hooks === "object") this.collectHooks(json.hooks, f.disp, origin);
    if (json.enabledPlugins && typeof json.enabledPlugins === "object") {
      for (const [name, enabled] of Object.entries(json.enabledPlugins).sort()) {
        if (enabled !== true) continue;
        const cleanName = this.clean(name, 120);
        this.plugins.push(cleanName);
        this.addComponent({
          kind: "plugin",
          origin,
          key: name,
          name: cleanName,
          paths: [f.disp],
          contentHash: hashJson({ name, enabled }),
          attributes: { enabled: true, contentsCollected: false }
        });
      }
    }
  }
  // ---------- Hook ----------
  collectHooks(hooks, settingsDisp, origin) {
    const scriptRoot = origin === "user" ? homedir2() : this.projectRoot;
    const ordinals = /* @__PURE__ */ new Map();
    for (const event of Object.keys(hooks).sort()) {
      const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
      groups.forEach((group, g) => {
        const matcher = typeof (group == null ? void 0 : group.matcher) === "string" && group.matcher !== "" ? group.matcher : null;
        const handlers = Array.isArray(group == null ? void 0 : group.hooks) ? group.hooks : [];
        handlers.forEach((h, hi) => {
          const ordKey = `${event}|${matcher ?? ""}`;
          const ord = ordinals.get(ordKey) ?? 0;
          ordinals.set(ordKey, ord + 1);
          this.collectHook({ event, matcher, h: h ?? {}, g, hi, ord, settingsDisp, origin, scriptRoot });
        });
      });
    }
  }
  collectHook({ event, matcher, h, g, hi, ord, settingsDisp, origin, scriptRoot }) {
    const type = typeof h.type === "string" ? h.type : "command";
    const command = typeof h.command === "string" ? h.command : "";
    const promptText = typeof h.prompt === "string" ? h.prompt : "";
    const scriptRel = command ? hookScriptPath(command) : null;
    let script = null;
    let scriptRaw = null;
    let scriptStatus = null;
    let scriptDisp = null;
    if (scriptRel) {
      if (path2.isAbsolute(scriptRel)) {
        scriptStatus = "escape";
        scriptDisp = displayPath(scriptRel, this.projectRoot);
        this.addSource(scriptDisp, origin, "out_of_scope", "outside_root_or_symlink_escape");
      } else {
        const f = this.readFile(scriptRoot, path2.posix.normalize(scriptRel), origin, SCRIPT_LIMIT_BYTES);
        scriptStatus = f.status;
        scriptDisp = f.disp;
        if (f.status === "ok") {
          script = f.text;
          scriptRaw = f.raw;
        }
      }
    }
    const text = `${command}
${script ?? ""}
${promptText}`;
    const block = hasBlockMarker(text);
    const verify = hasAny(text, VERIFY_CMD);
    const spec = hasAny(text, SPEC_CMD);
    const reentry = hasAny(`${command}
${script ?? ""}`, REENTRY);
    const matchers = (matcher ?? "").split("|").map((m) => m.trim()).filter(Boolean);
    const writeEdit = matchers.some((m) => /^(Write|Edit|MultiEdit)$/.test(m));
    const highCostOnly = matchers.length > 0 && matchers.every((m) => HIGH_COST_TOOLS.has(m));
    let primaryAxis = null;
    let ruleIds = [];
    const tags = { event, block, verify, reentry, hook: true };
    if (event === "PreToolUse" || event === "UserPromptSubmit") {
      if (block) {
        if (spec && (event === "UserPromptSubmit" || writeEdit)) {
          primaryAxis = "spec_clarity";
          ruleIds = ["SC-L3-01"];
        } else if (verify && event === "PreToolUse") {
          primaryAxis = "verification_gate_strength";
          ruleIds = ["VG-L3-02"];
        } else if (highCostOnly && event === "PreToolUse") {
          primaryAxis = "cost_efficiency";
          ruleIds = ["CE-L3-02"];
        } else {
          primaryAxis = "safety_boundary";
          ruleIds = event === "PreToolUse" ? ["SB-L2-02"] : [];
        }
      }
    } else if (event === "Stop" || event === "SubagentStop") {
      if (type === "prompt" || type === "agent") {
        primaryAxis = "verification_gate_strength";
        ruleIds = ["VG-L3-03"];
      } else if (verify && block) {
        primaryAxis = "verification_gate_strength";
        ruleIds = ["VG-L3-01"];
      }
      tags.blockingStop = block;
    } else if (event === "PostToolUse") {
      if (block) {
        primaryAxis = "verification_gate_strength";
        ruleIds = ["VG-L2-03"];
      } else if (verify) {
        primaryAxis = "verification_gate_strength";
        ruleIds = ["VG-L1-02"];
      }
    } else if (event.includes("Failure")) {
      primaryAxis = "execution_stability";
      ruleIds = ["ES-L3-01"];
    } else if (event === "PreCompact") {
      primaryAxis = "context_efficiency";
      ruleIds = ["CX-L3-02"];
    } else if (event === "Notification") {
      primaryAxis = "autonomy";
      tags.b = "notification";
    }
    const label = scriptDisp ? path2.posix.basename(scriptDisp) : command ? this.clean(command, 60) : type;
    const levelCap = scriptRel && scriptStatus !== "ok" ? { max: 1, ruleId: "COM-02" } : null;
    const comp = this.addComponent({
      kind: "hook",
      origin,
      key: `${event}|${matcher ?? ""}|${ord}`,
      name: `${event}${matcher ? `(${this.clean(matcher, 60)})` : ""} ${label}`,
      paths: [settingsDisp, ...scriptDisp ? [scriptDisp] : []],
      contentHash: sha256tag(hashInput({ event, matcher, handler: h, script: scriptRaw === null ? null : sha256hex(scriptRaw) })),
      attributes: {
        event,
        matcher: matcher && this.clean(matcher, 120),
        type,
        timeoutSec: typeof h.timeout === "number" ? h.timeout : null,
        blockingMarker: block,
        verifyCommand: verify,
        specCommand: spec,
        reentryGuard: reentry,
        scriptExists: scriptRel ? scriptStatus === "ok" : null,
        command: command ? this.clean(command, 120) : null
      }
    });
    const keyBase = pointer("hooks", event, g, "hooks", hi);
    const describe = [block ? "차단 표지 있음" : "차단 표지 없음", verify ? "검증 명령 어휘" : null, levelCap ? "스크립트 확인 불가" : null].filter(Boolean).join(", ");
    this.addEvidence({
      comp,
      path: settingsDisp,
      keyPath: keyBase,
      family: "hook",
      mechanism: "harness_enforced",
      fact: `${event}${matcher ? `(${this.clean(matcher, 60)})` : ""} Hook: ${label} (${describe})`,
      primaryAxis,
      ruleIds,
      levelCap,
      tags
    });
    if (typeof h.timeout === "number") {
      this.addEvidence({
        comp,
        path: settingsDisp,
        keyPath: `${keyBase}/timeout`,
        family: "timeout",
        mechanism: "harness_enforced",
        fact: `${event} Hook timeout ${h.timeout}초`,
        primaryAxis: "execution_stability",
        ruleIds: ["ES-L2-03"],
        levelCap,
        tags: { hook: true }
      });
    }
    if (reentry && (event === "Stop" || event === "SubagentStop") && script) {
      const line = script.split("\n").findIndex((l) => l.includes(REENTRY[0])) + 1;
      this.addEvidence({
        comp,
        path: scriptDisp,
        line: line || null,
        family: "reentry",
        mechanism: "harness_enforced",
        fact: `${label}에 재진입 방지(stop_hook_active) 확인`,
        primaryAxis: "execution_stability",
        ruleIds: ["ES-L3-02"],
        levelCap,
        tags: { hook: true }
      });
    }
  }
  // ---------- MCP ----------
  collectMcp(root, rel, origin, servers = null) {
    var _a;
    let disp;
    if (!servers) {
      const f = this.readFile(root, rel, origin);
      if (!f || f.status !== "ok") return;
      disp = f.disp;
      try {
        servers = (_a = JSON.parse(f.text)) == null ? void 0 : _a.mcpServers;
      } catch {
        this.addSource(f.disp, origin, "unsupported", "invalid_json");
        return;
      }
    } else {
      disp = displayPath(path2.join(root, rel), this.projectRoot);
    }
    if (!servers || typeof servers !== "object") return;
    for (const name of Object.keys(servers).sort()) {
      const s = servers[name] ?? {};
      const transport = typeof s.type === "string" ? s.type : s.url ? "http" : "stdio";
      const cmd = typeof s.command === "string" ? path2.posix.basename(splitCommand(s.command)[0] ?? "") : null;
      const cleanName = this.clean(name, 80);
      const comp = this.addComponent({
        kind: "mcp_server",
        origin,
        key: name,
        name: cleanName,
        paths: [disp],
        contentHash: hashJson(s),
        attributes: {
          transport: this.clean(transport, 20),
          command: cmd ? this.clean(cmd, 60) : null,
          args: Array.isArray(s.args) ? s.args.length : 0,
          url: s.url ? urlSchemeHost(s.url) : null,
          envCount: s.env && typeof s.env === "object" ? Object.keys(s.env).length : 0,
          headersCount: s.headers && typeof s.headers === "object" ? Object.keys(s.headers).length : 0
        }
      });
      this.addEvidence({
        comp,
        path: disp,
        keyPath: pointer("mcpServers", name),
        family: "mcp",
        mechanism: "harness_enforced",
        fact: `MCP 서버 '${cleanName}' 선언 (${this.clean(transport, 20)})`,
        secondaryAxes: ["context_efficiency", "safety_boundary"],
        tags: { mcp: true }
      });
    }
  }
  // ---------- Agent·Skill ----------
  scanBody(text) {
    for (const line of text.split("\n")) if (targetsAnalyzer(line)) this.r8Hits++;
  }
  collectAgents(root, relDir, origin) {
    const dir = listDirInside(root, relDir);
    if (dir.status !== "ok") {
      this.addSource(displayPath(path2.join(root, relDir), this.projectRoot), origin, dir.status === "escape" ? "out_of_scope" : "absent", null);
      return;
    }
    for (const entry of dir.entries) {
      if (!entry.endsWith(".md")) continue;
      const f = this.readFile(root, `${relDir}/${entry}`, origin);
      if (!f || f.status !== "ok") continue;
      const fm = parseFrontmatter(f.text);
      this.scanBody(fm.body);
      const d = fm.data;
      const name = typeof d.name === "string" ? d.name : entry.replace(/\.md$/, "");
      const description = typeof d.description === "string" ? d.description : "";
      const role = detectRole(name, description);
      const asList = (v) => Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : null;
      const tools = asList(d.tools);
      const disallowed = asList(d.disallowedTools);
      const model = typeof d.model === "string" ? d.model : null;
      const maxTurns = typeof d.maxTurns === "number" ? d.maxTurns : null;
      const independent = role === "reviewer" && tools ? !tools.some((t) => /^(Write|Edit|MultiEdit|Bash)/.test(t)) : null;
      const cap = fm.ok ? null : { max: 1, ruleId: "COM-02" };
      const comp = this.addComponent({
        kind: "agent",
        origin,
        key: f.disp,
        name: this.clean(name, 80),
        paths: [f.disp],
        contentHash: sha256tag(f.raw),
        attributes: {
          role,
          description: description ? this.clean(description, 200) : null,
          tools: tools ? tools.map((t) => this.clean(t, 60)) : null,
          disallowedTools: disallowed ? disallowed.map((t) => this.clean(t, 60)) : null,
          model: model && this.clean(model, 60),
          maxTurns,
          isolation: typeof d.isolation === "string" ? this.clean(d.isolation, 40) : null,
          background: d.background === true,
          permissionMode: typeof d.permissionMode === "string" ? this.clean(d.permissionMode, 40) : null,
          independent,
          frontmatterParsed: fm.ok
        }
      });
      const roleRule = { reviewer: ["verification_gate_strength", "VG-L2-01"], spec: ["spec_clarity", "SC-L2-02"], recovery: ["execution_stability", "ES-L2-04"], parallel: ["throughput", "TP-L2-02"], explorer: ["context_efficiency", "CX-L2-03"] }[role];
      const ev = (o) => this.addEvidence({ comp, path: f.disp, levelCap: cap, ...o });
      ev({
        family: "role",
        mechanism: "procedure",
        fact: `Subagent '${this.clean(name, 60)}' 정의${role ? ` (역할: ${role})` : " (역할 어휘 없음)"}`,
        primaryAxis: (roleRule == null ? void 0 : roleRule[0]) ?? null,
        ruleIds: roleRule ? [roleRule[1]] : [],
        tags: { agent: true, role, noMaxTurns: maxTurns === null }
      });
      if (tools || disallowed) ev({ keyPath: tools ? "/tools" : "/disallowedTools", family: "tools", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' ${tools ? `tools 허용 목록 ${tools.length}개` : `disallowedTools ${disallowed.length}개`}`, primaryAxis: "safety_boundary", ruleIds: ["SB-L2-01"] });
      if (model && model !== "inherit") ev({ keyPath: "/model", family: "model", mechanism: "procedure", fact: `Subagent '${this.clean(name, 60)}' model = ${this.clean(model, 40)}`, primaryAxis: "cost_efficiency", ruleIds: ["CE-L2-01"], tags: { reviewerHaiku: role === "reviewer" && /haiku/i.test(model) } });
      if (maxTurns !== null) ev({ keyPath: "/maxTurns", family: "maxTurns", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' maxTurns = ${maxTurns}`, primaryAxis: "execution_stability", secondaryAxes: ["cost_efficiency"], ruleIds: ["ES-L2-01"], tags: { maxTurns: true } });
      if (d.isolation === "worktree") ev({ keyPath: "/isolation", family: "isolation", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' isolation = worktree`, primaryAxis: "execution_stability", ruleIds: ["ES-L2-02"] });
      if (d.background === true) ev({ keyPath: "/background", family: "background", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' background = true`, primaryAxis: "throughput", ruleIds: ["TP-L2-01"] });
      if (typeof d.permissionMode === "string" && d.permissionMode !== "default") ev({ keyPath: "/permissionMode", family: "permissionMode", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' permissionMode = ${this.clean(d.permissionMode, 40)}`, primaryAxis: "autonomy", tags: { a: true } });
      if (d.omitClaudeMd === true) ev({ keyPath: "/omitClaudeMd", family: "omitClaudeMd", mechanism: "harness_enforced", fact: `Subagent '${this.clean(name, 60)}' omitClaudeMd = true`, secondaryAxes: ["context_efficiency", "spec_clarity"], tags: { omitClaudeMd: true } });
    }
  }
  isSelfSkill(root, relDir, name) {
    if (name === "harness-analyze") return true;
    return readTextInside(root, `${relDir}/scripts/harness-lens.mjs`, 1).status !== "absent";
  }
  collectSkills(root, relDir, origin) {
    const dir = listDirInside(root, relDir);
    if (dir.status !== "ok") {
      this.addSource(displayPath(path2.join(root, relDir), this.projectRoot), origin, dir.status === "escape" ? "out_of_scope" : "absent", null);
      return;
    }
    for (const entry of dir.entries) {
      if (this.isSelfSkill(root, `${relDir}/${entry}`, entry)) {
        if (origin === "project_shared") this.selfInstalledInProject = true;
        continue;
      }
      const f = this.readFile(root, `${relDir}/${entry}/SKILL.md`, origin);
      if (!f || f.status !== "ok") continue;
      const fm = parseFrontmatter(f.text);
      this.scanBody(fm.body);
      const d = fm.data;
      const name = typeof d.name === "string" ? d.name : entry;
      const description = typeof d.description === "string" ? d.description : "";
      const role = detectRole(name, description);
      const model = typeof d.model === "string" ? d.model : null;
      const fork = d.context === "fork";
      const cap = fm.ok ? null : { max: 1, ruleId: "COM-02" };
      const comp = this.addComponent({
        kind: "skill",
        origin,
        key: f.disp,
        name: this.clean(name, 80),
        paths: [f.disp],
        contentHash: sha256tag(f.raw),
        attributes: { role, description: description ? this.clean(description, 200) : null, model: model && this.clean(model, 60), contextFork: fork, frontmatterParsed: fm.ok }
      });
      const roleRule = { reviewer: ["verification_gate_strength", "VG-L2-02"], spec: ["spec_clarity", "SC-L2-01"], recovery: ["execution_stability", "ES-L2-04"], parallel: ["throughput", "TP-L2-02"] }[role] ?? ["context_efficiency", "CX-L2-01"];
      const ev = (o) => this.addEvidence({ comp, path: f.disp, levelCap: cap, ...o });
      ev({ family: "role", mechanism: "procedure", fact: `Skill '${this.clean(name, 60)}' 정의${role ? ` (역할: ${role})` : " (역할 없음, 본문 지연 로드)"}`, primaryAxis: roleRule[0], ruleIds: [roleRule[1]], tags: { skill: true, role } });
      if (model && model !== "inherit") ev({ keyPath: "/model", family: "model", mechanism: "procedure", fact: `Skill '${this.clean(name, 60)}' model = ${this.clean(model, 40)}`, primaryAxis: "cost_efficiency", ruleIds: ["CE-L2-01"] });
      if (fork) ev({ keyPath: "/context", family: "context", mechanism: "procedure", fact: `Skill '${this.clean(name, 60)}' context = fork`, primaryAxis: "context_efficiency", ruleIds: ["CX-L2-02"], tags: { fork: true } });
    }
  }
  collectSelf() {
    const r = readTextInside(this.skillDir, "SKILL.md", TEXT_LIMIT_BYTES);
    const text = r.status === "ok" ? r.text.replace(/\r\n/g, "\n") : "";
    const fm = parseFrontmatter(text);
    const always = Math.ceil(Buffer.byteLength(`${fm.data.name ?? ""}${fm.data.description ?? ""}`, "utf8") / 4);
    this.selfAlwaysLoadedTokens = always;
    return this.addComponent({
      kind: "harness_lens",
      origin: this.selfInstalledInProject ? "project_shared" : "plugin",
      key: "harness-lens",
      // 설치 위치와 무관하게 고정 라벨을 쓴다(루브릭 0.2). 설치 경로는 리포트에 남기지 않는다.
      name: "Harness Lens",
      paths: ["harness-lens/SKILL.md"],
      contentHash: sha256tag(text),
      attributes: { skill: typeof fm.data.name === "string" ? fm.data.name : "harness-analyze", alwaysLoadedTokens: always, hooksInstalled: 0, backgroundProcesses: 0 }
    });
  }
  // project 범위에서 수집하지 않은 사용자·관리형 설정 파일이 실제로 있는지만 확인한다(루브릭 §1.8).
  // 파일을 열지 않고 존재 여부만 본다. 있으면 out_of_scope 출처로 남겨 가능 범위를 넓히는 근거로 쓴다.
  probeUnscopedSettings() {
    const c = this.configDir;
    const present = (abs) => {
      try {
        return existsSync(abs);
      } catch {
        return false;
      }
    };
    const nonEmptyDir = (abs, keep) => {
      try {
        return statSync2(abs).isDirectory() && readdirSync2(abs).some(keep);
      } catch {
        return false;
      }
    };
    const found = [];
    if (present(path2.join(c, "settings.json"))) found.push("settings.json");
    if (present(path2.join(c, "CLAUDE.md"))) found.push("CLAUDE.md");
    if (nonEmptyDir(path2.join(c, "agents"), (e) => e.endsWith(".md"))) found.push("agents");
    if (nonEmptyDir(path2.join(c, "skills"), (e) => e !== "harness-analyze" && !e.startsWith("."))) found.push("skills");
    for (const rel of found) this.addSource(displayPath(path2.join(c, rel), this.projectRoot), "user", "out_of_scope", "user_scope_not_collected");
    const managed = managedSettingsPath(this.platform);
    if (present(managed)) this.addSource(displayPath(managed, this.projectRoot), "managed", "out_of_scope", "managed_settings_not_collected");
  }
  // ---------- 전체 ----------
  run() {
    var _a, _b;
    this.disableAllHooks = [];
    const p = this.projectRoot;
    this.collectInstructions(p, "CLAUDE.md", "project_shared", { alwaysLoaded: true });
    this.collectInstructions(p, ".claude/CLAUDE.md", "project_shared", { alwaysLoaded: true });
    this.collectInstructions(p, "CLAUDE.local.md", "project_local", { alwaysLoaded: true });
    for (const rel of this.findSubdirInstructions()) this.collectInstructions(p, rel, "project_shared", { alwaysLoaded: false, subdir: true });
    this.collectSettings(p, ".claude/settings.json", "project_shared");
    this.collectSettings(p, ".claude/settings.local.json", "project_local");
    this.collectAgents(p, ".claude/agents", "project_shared");
    this.collectSkills(p, ".claude/skills", "project_shared");
    this.collectMcp(p, ".mcp.json", "project_shared");
    const origins = ["project_shared", "project_local"];
    if (this.scope === "project_and_user") {
      const c = this.configDir;
      this.collectInstructions(c, "CLAUDE.md", "user", { alwaysLoaded: true });
      this.collectSettings(c, "settings.json", "user");
      this.collectAgents(c, "agents", "user");
      this.collectSkills(c, "skills", "user");
      const home = homedir2();
      const cj = this.readFile(home, ".claude.json", "user");
      if ((cj == null ? void 0 : cj.status) === "ok") {
        try {
          const json = JSON.parse(cj.text);
          this.collectMcp(home, ".claude.json", "user", json.mcpServers ?? {});
          let realRoot = p;
          try {
            realRoot = realpathSync2(p);
          } catch {
          }
          const proj = ((_a = json.projects) == null ? void 0 : _a[p]) ?? ((_b = json.projects) == null ? void 0 : _b[realRoot]);
          if (proj == null ? void 0 : proj.mcpServers) this.collectMcp(home, ".claude.json", "project_local", proj.mcpServers);
        } catch {
          this.addSource(cj.disp, "user", "unsupported", "invalid_json");
        }
      }
      const managed = managedSettingsPath(this.platform);
      this.collectSettings(path2.dirname(managed), path2.basename(managed), "managed");
      origins.push("user", "managed");
    } else {
      this.probeUnscopedSettings();
    }
    if (this.plugins.length) origins.push("plugin");
    const self = this.collectSelf();
    this.applyCommonRules();
    return this.result(origins, self);
  }
  // COM-03(Hook 무력화), COM-09(스칼라 병합), COM-11(적용되지 않는 설정)
  applyCommonRules() {
    const evs = [...this.evidence.values()];
    const scalarGroups = /* @__PURE__ */ new Map();
    for (const ev of evs) {
      const k = ev._tags.scalarKey;
      if (!k) continue;
      if (!scalarGroups.has(k)) scalarGroups.set(k, []);
      scalarGroups.get(k).push(ev);
    }
    for (const group of scalarGroups.values()) {
      group.sort((a, b) => ORIGIN_RANK[a._tags.origin] - ORIGIN_RANK[b._tags.origin]);
      group.slice(1).forEach((ev) => {
        ev.void = { ruleId: "COM-09", reason: "우선순위가 높은 설정 출처가 같은 키를 덮는다" };
      });
    }
    for (const ev of evs) {
      const mode = ev._tags.defaultMode;
      if ((mode === "auto" || mode === "bypassPermissions") && (ev._tags.origin === "project_shared" || ev._tags.origin === "project_local")) {
        ev.void = { ruleId: "COM-11", reason: `프로젝트 설정의 defaultMode ${mode}는 적용되지 않는다` };
      }
    }
    const effectiveDisable = this.disableAllHooks.sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin])[0];
    if (effectiveDisable) {
      for (const ev of evs) if (ev._tags.hook) ev.void = { ruleId: "COM-03", reason: "유효 설정 disableAllHooks = true" };
    }
  }
  result(origins, self) {
    const components = [...this.components.values()].sort((a, b) => compareTuples([a.kind, a.origin, a._key], [b.kind, b.origin, b._key]));
    const evidence = [...this.evidence.values()].sort((a, b) => compareTuples([a.path, a.line, a.keyPath, a.id], [b.path, b.line, b.keyPath, b.id]));
    const sources = [...this.sources.values()].sort((a, b) => compareTuples([a.path, a.origin], [b.path, b.origin]));
    const hashPairs = [...this.hashEntries.entries()].sort((a, b) => compareTuples(a, b));
    const configurationHash = sha256tag(hashInput(hashPairs));
    const al = this.alwaysLoaded;
    const bytes = al.reduce((s, f) => s + f.bytes, 0);
    return {
      components,
      evidence,
      sources,
      origins: [...new Set(origins)],
      configurationHash,
      alwaysLoaded: { files: al.length, lines: al.reduce((s, f) => s + f.lines, 0), bytes, estimatedTokens: Math.ceil(bytes / 4) },
      alwaysLoadedFiles: al,
      redactions: this.counter.toArray(),
      r8Hits: this.r8Hits,
      plugins: this.plugins,
      selfComponentId: self.id,
      selfAlwaysLoadedTokens: this.selfAlwaysLoadedTokens
    };
  }
};
function collect(opts) {
  return new Collector(opts).run();
}

// src/diff.mjs
var CHANGE_ORDER = { added: 0, removed: 1, modified: 2, unknown: 3 };
function blindPaths(doc) {
  return new Set(doc.engine.inventory.sources.filter((s) => s.status === "unreadable" || s.status === "out_of_scope").map((s) => s.path));
}
function diffAnalyses(prev, cur) {
  const from = prev.meta.snapshotId;
  const to = cur.meta.snapshotId;
  const limitations = [];
  let comparability = "full";
  const reasonAll = [];
  const limit = (code, message) => {
    if (comparability === "full") comparability = "limited";
    limitations.push({ code, message });
  };
  if (prev.schemaVersion !== cur.schemaVersion) {
    comparability = "none";
    limitations.push({ code: "schema_version_changed", message: `스키마 버전이 달라(${prev.schemaVersion} → ${cur.schemaVersion}) 변경 목록만 비교한다.` });
  } else {
    if (prev.rubricVersion !== cur.rubricVersion) {
      limit("rubric_version_changed", `루브릭 버전이 달라(${prev.rubricVersion} → ${cur.rubricVersion}) 축 수준을 비교할 수 없다.`);
      reasonAll.push("rubric_version_changed");
    }
    if (prev.meta.scope.preset !== cur.meta.scope.preset) {
      limit("scope_changed", `분석 범위가 달라(${prev.meta.scope.preset} → ${cur.meta.scope.preset}) 범위 밖 출처의 변경은 미확인이다.`);
    }
    if (prev.meta.engineInfo.sessionParserVersion !== cur.meta.engineInfo.sessionParserVersion) {
      limit("session_parser_changed", "세션 파서 버전이 달라 실측 상태 축은 비교할 수 없다.");
    }
  }
  const prevComps = new Map(prev.engine.inventory.components.map((c) => [c.id, c]));
  const curComps = new Map(cur.engine.inventory.components.map((c) => [c.id, c]));
  const prevBlind = blindPaths(prev);
  const curBlind = blindPaths(cur);
  const scopeChanged = prev.meta.scope.preset !== cur.meta.scope.preset;
  const outOfProject = (c) => c.origin === "user" || c.origin === "managed";
  const changes = [];
  const push = (c, change) => changes.push({
    changeId: changeId(from, to, c.id, change),
    componentId: c.id,
    kind: c.kind,
    name: c.name,
    change,
    paths: c.paths
  });
  for (const c of curComps.values()) {
    const p = prevComps.get(c.id);
    if (!p) {
      const blind = c.paths.some((x) => prevBlind.has(x)) || scopeChanged && outOfProject(c);
      push(c, blind ? "unknown" : "added");
    } else if (p.contentHash !== c.contentHash) {
      push(c, "modified");
    }
  }
  for (const p of prevComps.values()) {
    if (curComps.has(p.id)) continue;
    const blind = p.paths.some((x) => curBlind.has(x)) || scopeChanged && outOfProject(p);
    push(p, blind ? "unknown" : "removed");
  }
  changes.sort((a, b) => compareTuples([CHANGE_ORDER[a.change], a.kind, a.name, a.componentId], [CHANGE_ORDER[b.change], b.kind, b.name, b.componentId]));
  const axisDeltas = comparability === "none" ? [] : cur.engine.axes.map((a) => {
    var _a, _b;
    const p = prev.engine.axes.find((x) => x.axis === a.axis);
    const previousState = ((_a = p == null ? void 0 : p.maturity) == null ? void 0 : _a.state) ?? "predicted";
    const currentState = ((_b = a.maturity) == null ? void 0 : _b.state) ?? "predicted";
    let comparable = true;
    let reason = null;
    if (reasonAll.length) {
      comparable = false;
      reason = reasonAll[0];
    } else if (limitations.some((l) => l.code === "session_parser_changed") && (previousState === "measured" || currentState === "measured")) {
      comparable = false;
      reason = "session_parser_changed";
    } else if (previousState !== currentState) reason = "maturity_changed";
    return { axis: a.axis, previousLevel: (p == null ? void 0 : p.level) ?? null, currentLevel: a.level, previousState, currentState, comparable, reason };
  });
  return {
    previousSnapshotId: from,
    previousAnalyzedAt: prev.meta.analyzedAt,
    comparability,
    limitations,
    componentChanges: changes,
    axisDeltas
  };
}

// src/render.mjs
import { createHash as createHash2 } from "crypto";

// src/report/client.mjs
function reportClient() {
  "use strict";
  var data = JSON.parse(document.getElementById("hl-data").textContent);
  var doc = data.analysis;
  var meta = doc.meta;
  var eng = doc.engine;
  var interp = doc.interpretation;
  var cmp = eng.comparison;
  var SVGNS = "http://www.w3.org/2000/svg";
  var AXIS = {
    spec_clarity: "명세 명확성",
    verification_gate_strength: "검증 게이트 강도",
    execution_stability: "실행 안정성",
    throughput: "처리 속도",
    cost_efficiency: "비용 효율",
    context_efficiency: "컨텍스트 효율",
    autonomy: "자율성",
    safety_boundary: "안전 경계"
  };
  var LEVEL = ["0 미구성", "1 일부 구성", "2 명시적 구성", "3 강제 검증"];
  var KIND = {
    instructions: "지침",
    settings: "설정",
    hook: "Hook",
    skill: "Skill",
    agent: "Subagent",
    mcp_server: "MCP 서버",
    plugin: "플러그인",
    harness_lens: "Harness Lens"
  };
  var ORIGIN = { project_shared: "프로젝트(공유)", project_local: "프로젝트(로컬)", user: "사용자", managed: "관리형", plugin: "플러그인" };
  var CHANGE = { added: "추가", removed: "삭제", modified: "수정", unknown: "미확인" };
  var CHANGE_MARK = { added: "+", removed: "−", modified: "~", unknown: "?" };
  var CONF = { low: "신뢰 낮음", medium: "신뢰 중간", high: "신뢰 높음" };
  var DIR = { increase: "↑ 증가", decrease: "↓ 감소", unclear: "? 불명" };
  var STATUS = { observed: "관찰 사실", inferred: "구조적 추정", measured: "실측", unknown: "미확인" };
  var FDIR = { potential_positive: "잠재적 이점", potential_negative: "잠재적 손실", mixed: "혼재", neutral: "중립", unknown: "불명" };
  var SRC = { read: "읽음", absent: "없음", unreadable: "읽지 못함", unsupported: "지원 안 함", out_of_scope: "범위 밖", skipped_sensitive: "민감 파일이라 열지 않음" };
  var BUDGET = {
    always_loaded_tokens: "평소 세션 상시 로드",
    background_processes: "백그라운드 프로세스",
    reanalysis_engine_ms: "재분석 엔진 시간",
    engine_max_rss_bytes: "엔진 최대 메모리",
    llm_input_inventory_tokens: "LLM 입력 인벤토리",
    llm_tokens_per_analysis: "분석 1회 LLM 토큰"
  };
  var BSTATUS = { within: "예산 이내", exceeded: "초과", unmeasured: "미측정" };
  var BLOCKED = {
    needs_ci_pr_data: "CI·PR 데이터 필요(MVP 3)",
    session_format_unconfirmed: "세션 기록 형식 미확인",
    session_aggregation_not_implemented: "세션 집계 미구현(다음 단계)",
    sessions_disabled: "세션 집계 꺼짐",
    no_session_logs: "세션 기록 없음"
  };
  var evidence = {};
  eng.evidence.forEach(function(e) {
    evidence[e.id] = e;
  });
  var components = {};
  eng.inventory.components.forEach(function(c) {
    components[c.id] = c;
  });
  var changes = {};
  (cmp ? cmp.componentChanges : []).forEach(function(c) {
    changes[c.changeId] = c;
  });
  var axisById = {};
  eng.axes.forEach(function(a) {
    axisById[a.axis] = a;
  });
  var prevLevel = {};
  var showPrev = !!(cmp && cmp.comparability !== "none");
  if (cmp) cmp.axisDeltas.forEach(function(d) {
    prevLevel[d.axis] = d;
  });
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k) {
      node.setAttribute(k, attrs[k]);
    });
    append(node, children);
    return node;
  }
  function append(node, children) {
    if (children === void 0 || children === null) return node;
    (Array.isArray(children) ? children : [children]).forEach(function(c) {
      if (c === null || c === void 0 || c === false) return;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function s(tag, attrs, children) {
    var node = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function(k) {
      node.setAttribute(k, attrs[k]);
    });
    append(node, children);
    return node;
  }
  function code(t) {
    return el("code", null, t);
  }
  function axisName(a) {
    return a ? AXIS[a] || a : "축 없음";
  }
  function levelText(a) {
    if (a.levelStatus === "unknown") return "판정 불가(미확인)";
    if (a.levelStatus === "undefined") return "기준 없음";
    return "수준 " + LEVEL[a.level];
  }
  function stateText(a) {
    return a.maturity.state === "measured" ? "실측" : "예측";
  }
  function evList(ids) {
    if (!ids || !ids.length) return el("p", { class: "muted" }, "근거 없음");
    return el("ul", { class: "tight" }, ids.map(function(id) {
      var e = evidence[id];
      if (!e) return el("li", null, [code(id), " (알 수 없는 근거)"]);
      return el("li", null, [e.fact, " ", el("span", { class: "muted" }, "— " + e.path + (e.line ? ":" + e.line : "") + (e.keyPath ? " " + e.keyPath : "")), e.void ? el("span", { class: "tag" }, "무력화 " + e.void.ruleId) : null]);
    }));
  }
  function section(title, id) {
    var sec = el("section", { id });
    sec.appendChild(el("h2", null, title));
    app.appendChild(sec);
    return sec;
  }
  function table(headers, rows) {
    return el("div", { class: "tablewrap" }, el("table", null, [
      el("thead", null, el("tr", null, headers.map(function(h) {
        return el("th", { scope: "col" }, h);
      }))),
      el("tbody", null, rows.map(function(r) {
        return el("tr", null, r.map(function(c) {
          return el("td", null, c);
        }));
      }))
    ]));
  }
  var app = document.getElementById("app");
  app.textContent = "";
  app.appendChild(el("h1", null, "Harness Lens 리포트 — " + meta.project.displayName));
  app.appendChild(el("p", { class: "muted" }, "하네스 구성의 구조적 지원 수준과 트레이드오프. 최적화 방향은 사람이 결정합니다."));
  var typeText = meta.analysisType === "static" ? "정적 구성 분석(세션 실측 없음)" : "정적 구성 + 세션 기록 집계";
  app.appendChild(el("div", { class: "meta panel" }, [
    ["프로젝트", meta.project.displayName],
    ["분석 시점", meta.analyzedAt],
    ["스냅샷 ID", meta.snapshotId],
    ["분석 기준 버전", "스키마 " + doc.schemaVersion + " · 루브릭 " + doc.rubricVersion + " · 엔진 " + meta.engineInfo.version],
    ["데이터 유형", typeText],
    ["분석 범위", (meta.scope.preset === "project" ? "프로젝트" : "프로젝트+사용자") + " (" + meta.scope.sources.map(function(x) {
      return ORIGIN[x] || x;
    }).join(", ") + ")"],
    ["구성 해시", meta.configurationHash.slice(0, 19) + "…"],
    ["해석 작성", meta.analyzer.agent + " · " + (meta.analyzer.model || "모델 미확인")]
  ].map(function(kv) {
    return el("div", null, [el("b", null, kv[0]), kv[1]]);
  })));
  var measuredCount = eng.axes.filter(function(a) {
    return a.maturity.state === "measured";
  }).length;
  var bar = el("div", { class: "bar", role: "img", "aria-label": "실측 " + measuredCount + " / 전체 " + eng.axes.length + "축" }, el("span", { style: "width:" + Math.round(measuredCount / eng.axes.length * 100) + "%" }));
  app.appendChild(el("div", { class: "panel maturity" }, [
    el("b", null, "근거 성숙도"),
    bar,
    el("span", null, "실측 " + measuredCount + " / 전체 " + eng.axes.length + "축"),
    measuredCount === 0 ? el("span", { class: "muted" }, "지금은 구성 기반 예측입니다. 실제 성능 측정이 아닙니다.") : null
  ]));
  if (eng.sessions.status !== "available") {
    app.appendChild(el("p", { class: "notice" }, "세션 기록 실측: " + (BLOCKED[eng.sessions.reason] || eng.sessions.reason || eng.sessions.status) + ". 모든 축은 구성 기반 예측으로 표시합니다."));
  }
  if (interp.summary && interp.summary.length) {
    app.appendChild(el("div", { class: "panel" }, [el("b", null, "요약"), el("ul", { class: "summary tight" }, interp.summary.map(function(l) {
      return el("li", null, l);
    }))]));
  }
  var radarSec = section("구조 프로필", "profile");
  var W = 560, C = 280, R = 170;
  var n = eng.axes.length;
  function pt(i, level) {
    var ang = (-90 + i * 360 / n) * Math.PI / 180;
    var r = R * level / 3;
    return [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  }
  function value(a) {
    return a.measured ? a.measured.band : a.level;
  }
  var svg = s("svg", { class: "radar main", viewBox: "0 0 " + W + " " + W, role: "img", "aria-labelledby": "radar-title" });
  svg.appendChild(s("title", { id: "radar-title" }, "8개 축 구조 프로필 레이더 차트. 정확한 값은 아래 상세 수치 표에 있습니다."));
  [1, 2, 3].forEach(function(lv) {
    svg.appendChild(s("polygon", { class: "grid", points: eng.axes.map(function(_, i) {
      return pt(i, lv).join(",");
    }).join(" ") }));
    var p = pt(0, lv);
    svg.appendChild(s("text", { class: "ringlabel", x: p[0] + 4, y: p[1] + 12 }, String(lv)));
  });
  eng.axes.forEach(function(a, i) {
    var end = pt(i, 3);
    svg.appendChild(s("line", { class: "spoke", x1: C, y1: C, x2: end[0], y2: end[1] }));
    var lp = pt(i, 3.62);
    var anchor = Math.abs(lp[0] - C) < 10 ? "middle" : lp[0] > C ? "start" : "end";
    var label = AXIS[a.axis] + (a.levelStatus === "unknown" ? " (판정 불가)" : a.axis === "throughput" ? " (최대 2)" : "");
    svg.appendChild(s("text", { x: lp[0], y: lp[1] + 4, "text-anchor": anchor }, label));
    var b0 = pt(i, a.range.min), b1 = pt(i, a.range.max);
    svg.appendChild(s("line", { class: "band", x1: b0[0], y1: b0[1], x2: b1[0], y2: b1[1] }, s("title", null, AXIS[a.axis] + " 가능 범위 " + a.range.min + "–" + a.range.max)));
  });
  function drawProfile(getValue, cls, isSolidEdge) {
    eng.axes.forEach(function(a, i) {
      var j = (i + 1) % n;
      var v1 = getValue(eng.axes[i]), v2 = getValue(eng.axes[j]);
      if (v1 === null || v1 === void 0 || v2 === null || v2 === void 0) return;
      var p1 = pt(i, v1), p2 = pt(j, v2);
      var solid = isSolidEdge(eng.axes[i], eng.axes[j]);
      svg.appendChild(s("line", { class: cls + (solid ? "" : " predicted"), x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }));
    });
  }
  if (showPrev) {
    drawProfile(function(a) {
      var d = prevLevel[a.axis];
      return d ? d.previousLevel : null;
    }, "prev", function() {
      return true;
    });
    eng.axes.forEach(function(a, i) {
      var d = prevLevel[a.axis];
      if (!d || d.previousLevel === null) return;
      var p = pt(i, d.previousLevel);
      svg.appendChild(s("rect", { class: "pt-prev", x: p[0] - 4, y: p[1] - 4, width: 8, height: 8 }, s("title", null, "이전 " + AXIS[a.axis] + " 수준 " + d.previousLevel)));
    });
  }
  drawProfile(value, "cur", function(x, y) {
    return x.maturity.state === "measured" && y.maturity.state === "measured";
  });
  eng.axes.forEach(function(a, i) {
    var v = value(a);
    if (v === null) {
      var q = pt(i, 0.45);
      svg.appendChild(s("circle", { class: "unknown", cx: q[0], cy: q[1], r: 9 }));
      svg.appendChild(s("text", { class: "unknown-label", x: q[0], y: q[1] + 4, "text-anchor": "middle" }, "?"));
      return;
    }
    var p = pt(i, v);
    var measured = a.maturity.state === "measured";
    svg.appendChild(s("circle", { class: measured ? "pt-meas" : "pt-pred", cx: p[0], cy: p[1], r: 5.5 }, s("title", null, AXIS[a.axis] + " " + levelText(a) + " (" + stateText(a) + ")")));
  });
  function legendIcon(kind) {
    var g = s("svg", { width: 46, height: 16, viewBox: "0 0 46 16", "aria-hidden": "true" });
    g.setAttribute("class", "radar");
    if (kind === "pred") {
      g.appendChild(s("line", { class: "cur predicted", x1: 2, y1: 8, x2: 34, y2: 8 }));
      g.appendChild(s("circle", { class: "pt-pred", cx: 38, cy: 8, r: 5 }));
    }
    if (kind === "meas") {
      g.appendChild(s("line", { class: "cur", x1: 2, y1: 8, x2: 34, y2: 8 }));
      g.appendChild(s("circle", { class: "pt-meas", cx: 38, cy: 8, r: 5 }));
    }
    if (kind === "prev") {
      g.appendChild(s("line", { class: "prev", x1: 2, y1: 8, x2: 34, y2: 8 }));
      g.appendChild(s("rect", { class: "pt-prev", x: 34, y: 4, width: 8, height: 8 }));
    }
    if (kind === "band") {
      g.appendChild(s("line", { class: "band", x1: 8, y1: 8, x2: 38, y2: 8 }));
    }
    if (kind === "unknown") {
      g.appendChild(s("circle", { class: "unknown", cx: 23, cy: 8, r: 6 }));
      g.appendChild(s("text", { class: "unknown-label", x: 23, y: 12, "text-anchor": "middle" }, "?"));
    }
    return g;
  }
  var legend = el("ul", { class: "legend" }, [
    el("li", null, [legendIcon("pred"), "현재 · 예측(구성 기반): 점선, 빈 원"]),
    el("li", null, [legendIcon("meas"), "현재 · 실측: 실선, 채운 점 (변은 양 끝이 모두 실측일 때만 실선)"]),
    showPrev ? el("li", null, [legendIcon("prev"), "이전 스냅샷 " + cmp.previousSnapshotId + ": 점 무늬 선, 네모"]) : null,
    el("li", null, [legendIcon("band"), "가능 범위: 수집 범위 밖·미확인 출처가 바꿀 수 있는 수준"]),
    el("li", null, [legendIcon("unknown"), "판정 불가: 관련 출처를 읽지 못함(0점이 아님)"])
  ]);
  var axisList = el("ul", { class: "tight" }, eng.axes.map(function(a) {
    var m = a.maturity;
    var mt = m.measurable ? "실측까지: " + (m.requirement.unit === "sessions" ? "세션 " : "도구 호출 ") + m.requirement.required + "회 · " + (m.progress === null ? BLOCKED[m.blockedReason] || m.blockedReason : Math.round(m.progress * 100) + "%") : "실측 불가: " + (BLOCKED[m.blockedReason] || m.blockedReason);
    var d = prevLevel[a.axis];
    var delta = d && d.comparable && d.previousLevel !== d.currentLevel ? " · 이전 " + (d.previousLevel === null ? "?" : d.previousLevel) + " → 현재 " + (d.currentLevel === null ? "?" : d.currentLevel) : "";
    return el("li", null, [el("b", null, AXIS[a.axis]), " ", levelText(a), " (" + stateText(a) + ") · 가능 범위 " + a.range.min + "–" + a.range.max + delta, el("br"), el("span", { class: "muted" }, mt)]);
  }));
  radarSec.appendChild(el("div", { class: "radar-wrap" }, [
    el("div", { class: "panel" }, svg),
    el("div", null, [legend, el("p", { class: "notice" }, "레이더의 면적은 종합 점수가 아닙니다. 수준(0~3)은 구조적 지원 수준이며 실제 성능이 아닙니다. 축끼리 더하거나 하네스 간 순위를 매기지 마세요."), axisList])
  ]));
  if (cmp) {
    var chSec = section("변경 내역", "changes");
    var compText = { full: "전체 비교 가능", limited: "일부만 비교 가능", none: "비교 불가(변경 목록만)" }[cmp.comparability];
    chSec.appendChild(el("p", null, ["이전 스냅샷 ", code(cmp.previousSnapshotId), " (" + cmp.previousAnalyzedAt + ") 대비 · ", el("b", null, compText)]));
    cmp.limitations.forEach(function(l) {
      chSec.appendChild(el("p", { class: "notice" }, l.message));
    });
    if (!cmp.componentChanges.length) chSec.appendChild(el("p", { class: "muted" }, "구성 요소 변경이 없습니다."));
    else chSec.appendChild(table(["변경", "종류", "구성 요소", "근거 파일"], cmp.componentChanges.map(function(c) {
      return [el("span", { class: "chg-" + c.change }, CHANGE_MARK[c.change] + " " + CHANGE[c.change]), KIND[c.kind] || c.kind, c.name, c.paths.join(", ")];
    })));
    var moved = cmp.axisDeltas.filter(function(d) {
      return d.previousLevel !== d.currentLevel || d.reason;
    });
    if (moved.length) chSec.appendChild(el("ul", { class: "tight" }, moved.map(function(d) {
      return el("li", null, AXIS[d.axis] + ": " + (d.previousLevel === null ? "?" : d.previousLevel) + " → " + (d.currentLevel === null ? "?" : d.currentLevel) + (d.comparable ? "" : " (비교 불가: " + d.reason + ")"));
    })));
  }
  var ct = interp.currentTradeoffs;
  var tSec = section("현재 구성의 트레이드오프", "tradeoffs");
  tSec.appendChild(el("h3", null, "투자와 포기"));
  tSec.appendChild(el("div", { class: "panel" }, [
    el("p", null, ct.investForgo.summary),
    el("div", { class: "grid2" }, [
      el("div", null, [el("b", null, "투자한 축"), el("ul", { class: "tight" }, ct.investForgo.invested.map(function(a) {
        return el("li", null, AXIS[a] + " — " + levelText(axisById[a]));
      }))]),
      el("div", null, [el("b", null, "내준 축"), el("ul", { class: "tight" }, ct.investForgo.forgone.map(function(a) {
        return el("li", null, AXIS[a] + " — " + levelText(axisById[a]));
      }))])
    ]),
    el("details", null, [el("summary", null, "근거"), evList(ct.investForgo.evidenceIds)])
  ]));
  tSec.appendChild(el("h3", null, "구성 요소별 득실"));
  if (!ct.componentTradeoffs.length) tSec.appendChild(el("p", { class: "muted" }, "득실이 함께 있는 구성 요소가 없습니다."));
  else tSec.appendChild(table(["구성 요소", "얻는 것", "치르는 비용", "신뢰"], ct.componentTradeoffs.map(function(c) {
    var comp = components[c.componentId];
    var fx = function(list) {
      return el("ul", { class: "tight" }, list.map(function(x) {
        return el("li", null, AXIS[x.axis] + ": " + x.text);
      }));
    };
    return [comp ? (KIND[comp.kind] || comp.kind) + " " + comp.name : c.componentId, fx(c.gains), fx(c.costs), CONF[c.confidence]];
  })));
  tSec.appendChild(el("h3", null, "축 간 긴장"));
  var cand = {};
  eng.tensionCandidates.forEach(function(t) {
    cand[t.tensionId] = t;
  });
  if (!ct.axisTensions.length) tSec.appendChild(el("p", { class: "muted" }, "현재 구성에서 근거가 있는 긴장 조합이 없습니다."));
  ct.axisTensions.forEach(function(t) {
    var c = cand[t.tensionId];
    var axesTxt = c ? c.axes.map(axisName).join(c.kind === "synergy" ? " → " : " ↔ ") : "";
    tSec.appendChild(el("div", { class: "panel" }, [
      el("b", null, [code(t.tensionId), " ", (c && c.kind === "synergy" ? "시너지 " : "긴장 ") + axesTxt]),
      el("p", null, t.explanation),
      el("p", { class: "muted" }, "조건: " + t.condition + " · " + CONF[t.confidence]),
      el("details", null, [el("summary", null, "근거"), evList(t.evidenceIds)])
    ]));
  });
  tSec.appendChild(el("h3", null, "빈 영역"));
  if (!ct.emptyAreas.length) tSec.appendChild(el("p", { class: "muted" }, "미구성이거나 판정 불가인 축이 없습니다."));
  else tSec.appendChild(table(["축", "상태", "의미", "확인 방법"], ct.emptyAreas.map(function(e) {
    return [AXIS[e.axis], e.kind === "unknown" ? "판정 불가(미확인)" : "미구성(수준 0)", e.meaning, e.howToConfirm];
  })));
  if (cmp && interp.changeTradeoffs) {
    var cSec = section("변경 트레이드오프", "change-tradeoffs");
    interp.changeTradeoffs.forEach(function(c) {
      var fx = function(title, list) {
        if (!list.length) return null;
        return el("div", null, [el("b", null, title), el("ul", { class: "tight" }, list.map(function(x) {
          return el("li", null, [AXIS[x.axis] + " " + DIR[x.direction] + ": " + x.text, el("br"), el("span", { class: "muted" }, "조건: " + x.condition + " · " + CONF[x.confidence])]);
        }))]);
      };
      cSec.appendChild(el("div", { class: "panel" }, [
        el("p", null, [el("b", null, "대상 변경: "), c.changeIds.map(function(id) {
          var ch = changes[id];
          return ch ? CHANGE_MARK[ch.change] + " " + (KIND[ch.kind] || ch.kind) + " " + ch.name : id;
        }).join(", ")]),
        c.multiChangeCaveat ? el("p", { class: "notice" }, "여러 구성 요소가 함께 바뀌어 개별 효과를 확정할 수 없습니다.") : null,
        el("div", { class: "grid2" }, [fx("기대 효과", c.expectedEffects), fx("잠재적 손실", c.potentialLosses)]),
        c.unknownImpacts.length ? el("div", null, [el("b", null, "영향 불명"), el("ul", { class: "tight" }, c.unknownImpacts.map(function(u) {
          return el("li", null, (u.axis ? AXIS[u.axis] + ": " : "") + u.text);
        }))]) : null,
        el("div", null, [el("b", null, "검증 방법"), el("ul", { class: "tight" }, c.validation.map(function(v) {
          return el("li", null, v);
        }))])
      ]));
    });
  }
  var aSec = section("축 상세", "axes");
  var notes = {};
  interp.axisNotes.forEach(function(x) {
    notes[x.axis] = x;
  });
  eng.axes.forEach(function(a) {
    var note = notes[a.axis];
    var fs = interp.findings.filter(function(f) {
      return f.axis === a.axis;
    });
    var list = function(title, arr) {
      return arr && arr.length ? el("div", null, [el("b", null, title), el("ul", { class: "tight" }, arr.map(function(x) {
        return el("li", null, x);
      }))]) : null;
    };
    aSec.appendChild(el("div", { class: "panel axis-card", id: "axis-" + a.axis }, [
      el("h3", null, [AXIS[a.axis], el("span", { class: "tag" }, levelText(a)), el("span", { class: "tag" }, stateText(a)), a.source.ruleId ? code(a.source.ruleId) : null].concat(a.source.capRuleIds.map(function(r) {
        return el("span", { class: "tag" }, "상한 " + r);
      }))),
      note ? el("p", null, [el("b", null, "판단 근거: "), note.rationale]) : null,
      note ? list("조건", note.conditions) : null,
      note ? list("반례 가능성", note.counterexamples) : null,
      note ? list("추가 검증 방법", note.validation) : null,
      fs.length ? el("div", null, [el("b", null, "발견"), el("ul", { class: "tight" }, fs.map(findingItem))]) : null,
      el("details", null, [el("summary", null, "엔진 근거 " + a.source.evidenceIds.length + "개 · 가능 범위 " + a.range.min + "–" + a.range.max + (a.range.reasonCodes.length ? " (" + a.range.reasonCodes.join(", ") + ")" : "")), evList(a.source.evidenceIds)])
    ]));
  });
  function findingItem(f) {
    return el("li", null, [
      el("span", { class: "tag" }, STATUS[f.status]),
      el("span", { class: "tag" }, FDIR[f.direction]),
      f.statement,
      f.condition ? el("span", { class: "muted" }, " — 조건: " + f.condition) : null,
      f.validation ? el("span", { class: "muted" }, " · 확인: " + f.validation) : null,
      f.unknownReason ? el("span", { class: "muted" }, " · 미확인 사유: " + f.unknownReason) : null,
      el("span", { class: "muted" }, " · " + CONF[f.confidence])
    ]);
  }
  var general = interp.findings.filter(function(f) {
    return f.axis === null;
  });
  if (general.length) {
    aSec.appendChild(el("h3", null, "축에 속하지 않는 발견"));
    aSec.appendChild(el("ul", { class: "tight" }, general.map(findingItem)));
  }
  var dSec = section("상세 수치 표", "data");
  dSec.appendChild(el("p", { class: "muted" }, "레이더 차트와 같은 데이터입니다."));
  dSec.appendChild(table(["축", "수준", "상태", "가능 범위", "결정 규칙", "근거 수", "이전 수준", "비교"], eng.axes.map(function(a) {
    var d = prevLevel[a.axis];
    return [
      AXIS[a.axis],
      a.level === null ? "판정 불가" : String(a.level),
      stateText(a) + (a.levelStatus === "unknown" ? " · 미확인" : ""),
      a.range.min + "–" + a.range.max,
      a.source.ruleId ? code(a.source.ruleId) : "—",
      String(a.source.evidenceIds.length),
      d ? d.previousLevel === null ? "판정 불가" : String(d.previousLevel) : "—",
      d ? d.comparable ? d.previousLevel === d.currentLevel ? "같음" : "변경" : "비교 불가" : "첫 분석"
    ];
  })));
  var role = {};
  interp.components.forEach(function(c) {
    role[c.componentId] = c;
  });
  dSec.appendChild(el("h3", null, "구성 요소"));
  dSec.appendChild(table(["종류", "이름", "출처", "경로", "역할(해석)"], eng.inventory.components.map(function(c) {
    var r = role[c.componentId];
    return [KIND[c.kind] || c.kind, c.name, ORIGIN[c.origin] || c.origin, c.paths.join(", "), r ? r.role : el("span", { class: "muted" }, "—")];
  })));
  var sc = eng.selfCost;
  var sSec = section("Harness Lens 자기 비용", "self-cost");
  sSec.appendChild(el("p", null, "Harness Lens도 하네스의 구성 요소입니다. 평소 세션 상시 로드 약 " + sc.alwaysLoadedTokens.value + "토큰(추정), 상주 프로세스·상시 Hook 없음."));
  sSec.appendChild(table(["예산", "목표", "관측", "상태"], sc.budgets.map(function(b) {
    var fmt = function(v) {
      return v === null ? "—" : b.unit === "bytes" ? (v / 1048576).toFixed(1) + " MiB" : v + " " + b.unit;
    };
    return [BUDGET[b.budgetId] || b.budgetId, fmt(b.target), fmt(b.observed), BSTATUS[b.status]];
  })));
  if (sc.currentRun.length) sSec.appendChild(el("p", { class: "muted" }, "이번 분석 엔진 실행: " + sc.currentRun.map(function(r) {
    return r.subcommand + " " + r.durationMs + "ms";
  }).join(" · ")));
  sSec.appendChild(el("p", { class: "muted" }, sc.previousAnalysis ? "직전 분석(" + sc.previousAnalysis.snapshotId + ")의 LLM 토큰: " + (sc.previousAnalysis.llmTokens ? JSON.stringify(sc.previousAnalysis.llmTokens) : "미측정(세션 집계 필요)") : "직전 분석 기록 없음."));
  var lSec = section("한계와 미확인 영역", "limitations");
  var lims = eng.limitations.map(function(l) {
    return l.message;
  }).concat(interp.limitations);
  lSec.appendChild(el("ul", { class: "tight" }, lims.map(function(l) {
    return el("li", null, l);
  })));
  var notRead = eng.inventory.sources.filter(function(x) {
    return x.status !== "read" && x.status !== "absent";
  });
  if (notRead.length) {
    lSec.appendChild(el("h3", null, "읽지 않았거나 읽지 못한 출처"));
    lSec.appendChild(table(["경로", "출처", "상태", "사유"], notRead.map(function(x) {
      return [x.path, ORIGIN[x.origin] || x.origin, SRC[x.status] || x.status, x.reason || "—"];
    })));
  }
  if (eng.inventory.redactions.length) {
    lSec.appendChild(el("p", null, "비밀정보 제거: " + eng.inventory.redactions.map(function(r) {
      return r.kind + " " + r.count + "건";
    }).join(", ") + " (값은 저장하지 않음)"));
  }
  app.appendChild(el("footer", null, "Harness Lens 엔진 " + meta.engineInfo.version + " · 검증 " + doc.validation.status + " (" + doc.validation.checkedAt + ") · 이 리포트는 외부 리소스 없이 오프라인에서 동작합니다."));
}

// src/report/style.mjs
var REPORT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #5f5f5a; --line: #d8d8d2;
  --grid: #c9c9c2; --current: #1f5fbf; --previous: #7a7a72; --band: rgba(31, 95, 191, 0.16);
  --warn-bg: #fff4dc; --warn-line: #c98a00; --added: #1d7a3a; --removed: #b3261e; --modified: #8a5a00;
  --code-bg: #efefea;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --panel: #1f1f1d; --text: #ecece6; --muted: #a3a39b; --line: #3a3a36;
    --grid: #4a4a45; --current: #7fb0ff; --previous: #9c9c94; --band: rgba(127, 176, 255, 0.20);
    --warn-bg: #3a2f14; --warn-line: #e0a830; --added: #6fcf8a; --removed: #ff8a80; --modified: #e6b450;
    --code-bg: #2a2a27;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 16px; margin: 18px 0 8px; }
p { margin: 6px 0; }
.muted { color: var(--muted); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px 18px; margin: 12px 0; }
.meta div { font-size: 13px; }
.meta b { display: block; color: var(--muted); font-weight: 600; font-size: 12px; }
.notice { border-left: 4px solid var(--warn-line); background: var(--warn-bg); padding: 8px 12px; border-radius: 4px; margin: 8px 0; }
.maturity { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bar { width: 220px; height: 12px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--panel); }
.bar span { display: block; height: 100%; background: var(--current); }
.summary li { margin: 4px 0; }
.radar-wrap { display: grid; grid-template-columns: minmax(280px, 520px) 1fr; gap: 20px; align-items: start; }
@media (max-width: 760px) { .radar-wrap { grid-template-columns: 1fr; } }
svg.radar.main { width: 100%; height: auto; display: block; }
.legend svg.radar { width: 46px; height: 16px; }
svg.radar text { fill: var(--text); font-size: 13px; }
svg.radar .grid { stroke: var(--grid); fill: none; }
svg.radar .spoke { stroke: var(--grid); }
svg.radar .ringlabel { fill: var(--muted); font-size: 10px; }
svg.radar .band { stroke: var(--band); stroke-width: 12; stroke-linecap: round; }
svg.radar .cur { stroke: var(--current); stroke-width: 2.5; fill: none; }
svg.radar .cur.predicted { stroke-dasharray: 7 5; }
svg.radar .prev { stroke: var(--previous); stroke-width: 2; fill: none; stroke-dasharray: 2 4; opacity: 0.9; }
svg.radar .pt-pred { fill: var(--panel); stroke: var(--current); stroke-width: 2.5; }
svg.radar .pt-meas { fill: var(--current); stroke: var(--current); }
svg.radar .pt-prev { fill: var(--previous); }
svg.radar .unknown { fill: none; stroke: var(--warn-line); stroke-width: 2; stroke-dasharray: 3 3; }
svg.radar .unknown-label { fill: var(--warn-line); font-weight: 700; }
.legend { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.legend svg { flex: none; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.tablewrap { overflow-x: auto; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: var(--code-bg); padding: 1px 4px; border-radius: 3px; word-break: break-all; }
.tag { display: inline-block; font-size: 12px; padding: 0 6px; border: 1px solid var(--line); border-radius: 10px; margin-right: 4px; }
.chg-added { color: var(--added); font-weight: 700; }
.chg-removed { color: var(--removed); font-weight: 700; }
.chg-modified { color: var(--modified); font-weight: 700; }
.chg-unknown { color: var(--warn-line); font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
ul.tight { margin: 4px 0; padding-left: 20px; }
details summary { cursor: pointer; font-weight: 600; }
.axis-card h3 { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
`;

// src/render.mjs
function serializeForScript(value) {
  return JSON.stringify(canonical(value)).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
var escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function renderReport(analysis) {
  const { value: safe } = rescanAndRedact(analysis);
  const script = `(${reportClient.toString()})();`;
  const hash = createHash2("sha256").update(script, "utf8").digest("base64");
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:`;
  const title = `Harness Lens — ${safe.meta.project.displayName} (${safe.meta.snapshotId})`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main id="app"><p>이 리포트는 JavaScript로 그립니다. 브라우저에서 스크립트를 허용하면 내용을 볼 수 있습니다. 원본 데이터는 같은 폴더의 analysis.json에 있습니다.</p></main>
<script type="application/json" id="hl-data">${serializeForScript({ analysis: safe })}</script>
<script>${script}</script>
</body>
</html>
`;
}

// src/resources.mjs
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import path3 from "path";
import { fileURLToPath } from "url";
var cachedSkillDir = null;
function skillDir() {
  if (cachedSkillDir) return cachedSkillDir;
  const here = path3.dirname(fileURLToPath(import.meta.url));
  const candidates = [path3.resolve(here, ".."), path3.resolve(here, "../../skills/harness-analyze")];
  cachedSkillDir = candidates.find((d) => existsSync2(path3.join(d, "schemas", "analysis.schema.json"))) ?? candidates[0];
  return cachedSkillDir;
}
function loadSchema() {
  return JSON.parse(readFileSync2(path3.join(skillDir(), "schemas", "analysis.schema.json"), "utf8"));
}

// src/rubric.mjs
var ruleLevel = (ruleId) => {
  var _a;
  return Number(((_a = /-L([0-3])-/.exec(ruleId)) == null ? void 0 : _a[1]) ?? -1);
};
function addRule(ev, ruleId) {
  if (!ev.ruleIds.includes(ruleId)) ev.ruleIds.push(ruleId);
}
function axisCandidates(axis, prim, ctx) {
  const cands = [];
  const push = (ruleId, evs) => {
    const capMax = Math.min(3, ...evs.map((e) => {
      var _a;
      return ((_a = e.levelCap) == null ? void 0 : _a.max) ?? 3;
    }));
    cands.push({ level: Math.min(ruleLevel(ruleId), capMax), ruleId });
  };
  const prefix = AXIS_PREFIX[axis];
  for (const ev of prim) for (const r of ev.ruleIds) if (r.startsWith(`${prefix}-L`)) push(r, [ev]);
  if (axis === "context_efficiency") {
    const sizes = prim.filter((e) => e._tags.family === "size");
    if (sizes.length && sizes.every((e) => e._tags.alwaysLoadedLines <= 200)) {
      sizes.forEach((e) => addRule(e, "CX-L1-01"));
      push("CX-L1-01", sizes);
    }
  }
  if (axis === "execution_stability") {
    const agents = ctx.allEvidence.filter((e) => e._tags.agent && !e.void);
    const maxTurns = prim.filter((e) => e._tags.maxTurns);
    if (agents.length >= 2 && agents.every((a) => !a._tags.noMaxTurns) && maxTurns.length) {
      maxTurns.forEach((e) => addRule(e, "ES-L3-04"));
      push("ES-L3-04", maxTurns);
    }
  }
  if (axis === "autonomy") {
    const a = prim.filter((e) => e._tags.a);
    const ask = prim.filter((e) => e._tags.b === "ask");
    const notif = prim.filter((e) => e._tags.b === "notification");
    if (a.length && ask.length) {
      [...a, ...ask].forEach((e) => addRule(e, "AU-L3-01"));
      push("AU-L3-01", [...a, ...ask]);
    } else if (a.length && notif.length) {
      [...a, ...notif].forEach((e) => addRule(e, "AU-L2-01"));
      push("AU-L2-01", [...a, ...notif]);
    } else if (a.length || ask.length || notif.length) {
      const evs = [...a, ...ask, ...notif];
      evs.forEach((e) => addRule(e, "AU-L1-02"));
      push("AU-L1-02", evs);
    }
  }
  if (axis === "safety_boundary") {
    const managed = prim.filter((e) => e._tags.origin === "managed" && (e.ruleIds.includes("SB-L2-02") || e.ruleIds.includes("SB-L2-03")));
    if (managed.length) {
      managed.forEach((e) => addRule(e, "SB-L3-03"));
      push("SB-L3-03", managed);
    }
  }
  return cands;
}
function computeAxes(col, { scope }) {
  const allEvidence = col.evidence;
  const ctx = { allEvidence };
  const unreadable = col.sources.some((s) => s.status === "unreadable");
  const unscopedUser = col.sources.some((s) => s.reason === "user_scope_not_collected");
  const unscopedManaged = col.sources.some((s) => s.reason === "managed_settings_not_collected");
  const outOfScope = col.sources.some((s) => s.status === "out_of_scope" && s.reason !== "user_scope_not_collected" && s.reason !== "managed_settings_not_collected");
  const totalAlwaysLines = col.alwaysLoaded.lines;
  return AXES.map((axis) => {
    const prefix = AXIS_PREFIX[axis];
    const prim = allEvidence.filter((e) => e.primaryAxis === axis && !e.void);
    const cands = axisCandidates(axis, prim, ctx);
    let level = null;
    let ruleId = null;
    let levelStatus = "assessed";
    const capRuleIds = [];
    if (cands.length) {
      const best = Math.max(...cands.map((c) => c.level));
      ruleId = cands.filter((c) => c.level === best).map((c) => c.ruleId).sort(compareCodeUnits)[0];
      level = best;
      if (axis === "context_efficiency" && totalAlwaysLines > 400 && level > 1) {
        level = 1;
        capRuleIds.push("CX-CAP-01");
      }
    } else if (unreadable) {
      levelStatus = "unknown";
    } else {
      level = 0;
      ruleId = `${prefix}-L0-00`;
    }
    const axisMax = AXIS_MAX[axis];
    const reasons = [];
    let max = level ?? 0;
    if (scope === "project" && unscopedUser) {
      max = axisMax;
      reasons.push("user_scope_not_collected");
    }
    if (scope === "project" && unscopedManaged && axis === "safety_boundary") {
      max = axisMax;
      reasons.push("managed_settings_not_collected");
    }
    if (unreadable) {
      max = axisMax;
      reasons.push("source_unreadable");
    }
    if (outOfScope) {
      max = axisMax;
      reasons.push("source_out_of_scope");
    }
    if (levelStatus === "unknown") max = axisMax;
    if (axis === "throughput") reasons.push("level3_reserved");
    const m = MATURITY_RULES[axis];
    return {
      axis,
      level,
      levelStatus,
      source: { ruleId, evidenceIds: uniqueSorted(prim.map((e) => e.id)), capRuleIds },
      range: { min: level ?? 0, max: Math.max(max, level ?? 0), reasonCodes: uniqueSorted(reasons) },
      maturity: null,
      // prepare 단계에서 채운다
      measured: null,
      _measurable: m.measurable
    };
  });
}
function computeMaturity(axes, sessions) {
  const blocked = sessions.status === "disabled" ? "sessions_disabled" : sessions.reason ?? "no_session_logs";
  for (const a of axes) {
    const m = MATURITY_RULES[a.axis];
    a.maturity = m.measurable ? { state: "predicted", measurable: true, requirement: { unit: m.unit, required: m.required, heuristic: true }, current: null, progress: null, blockedReason: blocked } : { state: "predicted", measurable: false, requirement: null, current: null, progress: null, blockedReason: m.blockedReason };
    delete a._measurable;
  }
  return axes;
}
function computeTensions(col, axes) {
  const evs = col.evidence.filter((e) => !e.void);
  const has = (ev, ...rules) => rules.some((r) => ev.ruleIds.includes(r));
  const ids = (list) => uniqueSorted(list.map((e) => e.id));
  const out = [];
  const add = (tensionId, kind, axesList, list) => {
    if (list.length) out.push({ tensionId, kind, axes: axesList, evidenceIds: ids(list) });
  };
  const level = Object.fromEntries(axes.map((a) => [a.axis, a.level]));
  const aSet = evs.filter((e) => e._tags.a);
  const A = "autonomy";
  const VG = "verification_gate_strength";
  const SB = "safety_boundary";
  const TP = "throughput";
  const CE = "cost_efficiency";
  const CX = "context_efficiency";
  const ES = "execution_stability";
  const SC = "spec_clarity";
  add("T1", "tension", [VG, TP], evs.filter((e) => e._tags.hook && has(e, "VG-L1-02", "VG-L2-03", "VG-L3-01", "VG-L3-02")));
  add("T2", "tension", [VG, CE], evs.filter((e) => has(e, "VG-L2-01", "VG-L2-02", "VG-L3-03")));
  {
    const risky = aSet.filter((e) => ["auto", "dontAsk", "bypassPermissions"].includes(e._tags.defaultMode) || e._tags.bareBash);
    const guard = evs.some((e) => has(e, "SB-L2-02", "SB-L2-03"));
    if (!guard) add("T3", "tension", [A, VG, SB], risky);
  }
  {
    const asks = evs.filter((e) => e._tags.b === "ask");
    const askCount = asks.reduce((s, e) => s + (e._tags.askCount ?? 0), 0);
    const notif = evs.filter((e) => e._tags.b === "notification");
    add("T4", "tension", [VG, SB, A], [...askCount >= 3 ? asks : [], ...notif]);
  }
  add("T5", "tension", [A, CE, ES], evs.filter((e) => e._tags.agent && e._tags.noMaxTurns || e._tags.blockingStop && !e._tags.reentry));
  {
    const forks = evs.filter((e) => e._tags.fork);
    add("T6", "tension", [CX, SC], [...forks.length >= 3 ? forks : [], ...evs.filter((e) => e._tags.omitClaudeMd)]);
  }
  add("T7", "tension", [SC, CX], evs.filter((e) => e._tags.family === "size" && e._tags.alwaysLoadedLines > 200));
  add("T8", "tension", [TP, CE], evs.filter((e) => has(e, "TP-L2-01", "TP-L2-02")));
  add("T9", "tension", [CE, VG], evs.filter((e) => e._tags.reviewerHaiku || e._tags.envKey === "MAX_THINKING_TOKENS"));
  {
    const mcp = evs.filter((e) => e._tags.mcp);
    const limited = evs.some((e) => e._tags.envKey === "MAX_MCP_OUTPUT_TOKENS");
    if (!limited) add("T10", "tension", [CX, SB], mcp);
  }
  if ((level[CX] ?? 0) >= 2) add("S1", "synergy", [CX, CE], evs.filter((e) => e.primaryAxis === CX));
  add("S2", "synergy", [VG, ES], evs.filter((e) => e.ruleIds.some((r) => r.startsWith("VG-L3-"))));
  {
    const deny = evs.filter((e) => has(e, "SB-L2-03"));
    if (deny.length && aSet.length) add("S3", "synergy", [SB, A], [...deny, ...aSet]);
  }
  return out;
}
function knowledgeBaseKeys(col) {
  const keys = /* @__PURE__ */ new Set();
  const kinds = new Set(col.components.map((c) => c.kind));
  if (kinds.has("hook")) keys.add("hooks");
  if (kinds.has("skill")) keys.add("skills");
  if (kinds.has("agent")) keys.add("subagents");
  if (kinds.has("mcp_server")) keys.add("mcp");
  for (const e of col.evidence) {
    if (e.void) continue;
    if (e.ruleIds.some((r) => r === "VG-L2-01" || r === "VG-L2-02")) keys.add("independent-review");
    if (e.ruleIds.some((r) => r.startsWith("VG-L3-"))) keys.add("verification-loop");
    if (e.ruleIds.includes("CX-L3-02")) keys.add("context-compaction");
    if (e.ruleIds.some((r) => r.startsWith("TP-L2-"))) keys.add("parallel-execution");
    if (e.ruleIds.some((r) => r === "CE-L2-01" || r === "CE-L2-02")) keys.add("model-routing");
  }
  return [...keys].sort(compareCodeUnits);
}

// src/sessions.mjs
var SESSIONS_NOT_IMPLEMENTED = "session_aggregation_not_implemented";
function aggregateSessions({ disabled = false } = {}) {
  return {
    status: disabled ? "disabled" : "unavailable",
    reason: disabled ? null : SESSIONS_NOT_IMPLEMENTED,
    clientVersions: null,
    window: null,
    coverage: {
      filesScanned: 0,
      linesRead: 0,
      linesSkipped: 0,
      skippedRatio: 0,
      sessionsAttributed: 0,
      sessionsUnattributed: 0,
      incremental: false,
      configSince: null
    },
    dedup: { assistantLines: 0, uniqueResponses: 0, excludedSynthetic: 0, excludedApiError: 0 },
    tokens: null,
    contextPerTurn: null,
    axisMetrics: []
  };
}

// src/store.mjs
import {
  closeSync,
  existsSync as existsSync3,
  mkdirSync,
  openSync,
  readFileSync as readFileSync3,
  readdirSync as readdirSync3,
  renameSync,
  rmSync,
  statSync as statSync3,
  writeFileSync,
  writeSync
} from "fs";
import path4 from "path";
var EngineError = class extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
};
function atomicWrite(file, content) {
  mkdirSync(path4.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}
var writeJson = (file, value) => atomicWrite(file, stableStringify(value));
var readJson = (file) => JSON.parse(readFileSync3(file, "utf8"));
function ensureOutDir(out) {
  const fresh = !existsSync3(out);
  mkdirSync(out, { recursive: true });
  if (fresh || !existsSync3(path4.join(out, ".gitignore"))) atomicWrite(path4.join(out, ".gitignore"), "*\n");
}
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function acquireLock(out, now) {
  const file = path4.join(out, "lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw new EngineError(11, "결과 디렉터리에 쓸 수 없습니다.");
      let stale = true;
      try {
        const info = JSON.parse(readFileSync3(file, "utf8"));
        const age = Date.now() - Date.parse(info.startedAt);
        stale = !pidAlive(info.pid) || !(age < 10 * 60 * 1e3);
      } catch {
        stale = statSync3(file).mtimeMs < Date.now() - 10 * 60 * 1e3;
      }
      if (!stale) throw new EngineError(11, "다른 Harness Lens 분석이 진행 중입니다. 끝난 뒤 다시 시도하세요.");
      rmSync(file, { force: true });
    }
  }
  throw new EngineError(11, "결과 디렉터리 잠금을 얻지 못했습니다.");
}
var runDir = (out, runId) => path4.join(out, "runs", runId);
var snapshotDir = (out, id) => path4.join(out, "snapshots", id);
function readIndex(out) {
  const file = path4.join(out, "snapshots", "index.json");
  return existsSync3(file) ? readJson(file) : [];
}
function latestSnapshotId(out) {
  const file = path4.join(out, "latest.json");
  if (existsSync3(file)) return readJson(file).snapshotId;
  const idx = readIndex(out);
  return idx.length ? idx[idx.length - 1].snapshotId : null;
}
function loadSnapshot(out, id) {
  const file = path4.join(snapshotDir(out, id), "analysis.json");
  if (!existsSync3(file)) throw new EngineError(41, `스냅샷 ${id}이 없습니다.`);
  return readJson(file);
}
function commitSnapshot(out, analysis) {
  const id = analysis.meta.snapshotId;
  const finalDir = snapshotDir(out, id);
  if (existsSync3(finalDir)) throw new EngineError(40, `스냅샷 ${id}이 이미 있습니다.`);
  const staging = path4.join(out, "snapshots", `.staging-${id}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    writeFileSync(path4.join(staging, "analysis.json"), stableStringify(analysis));
    renameSync(staging, finalDir);
    const index = readIndex(out).filter((e) => e.snapshotId !== id);
    index.push({
      snapshotId: id,
      analyzedAt: analysis.meta.analyzedAt,
      configurationHash: analysis.meta.configurationHash,
      schemaVersion: analysis.schemaVersion,
      rubricVersion: analysis.rubricVersion,
      scope: analysis.meta.scope.preset
    });
    index.sort((a, b) => compareCodeUnits(a.analyzedAt + a.snapshotId, b.analyzedAt + b.snapshotId));
    writeJson(path4.join(out, "snapshots", "index.json"), index);
    writeJson(path4.join(out, "latest.json"), { snapshotId: id });
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    if (err instanceof EngineError) throw err;
    throw new EngineError(40, "스냅샷을 저장하지 못했습니다. 이전 상태를 유지합니다.");
  }
  return finalDir;
}
function pruneRuns(out, keepId) {
  const dir = path4.join(out, "runs");
  if (!existsSync3(dir)) return;
  const runs = readdirSync3(dir).filter((d) => d !== keepId).sort(compareCodeUnits);
  for (const old of runs.slice(0, Math.max(0, runs.length - (RUNS_TO_KEEP - 1)))) {
    rmSync(path4.join(dir, old), { recursive: true, force: true });
  }
}

// src/validate.mjs
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "fs";
import path5 from "path";

// src/checks.mjs
var AXES2 = [
  "spec_clarity",
  "verification_gate_strength",
  "execution_stability",
  "throughput",
  "cost_efficiency",
  "context_efficiency",
  "autonomy",
  "safety_boundary"
];
var TOKEN_FIELDS = ["freshInput", "cacheWrite", "cacheRead", "output"];
function sumBuckets(buckets) {
  const total = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 };
  for (const b of buckets) for (const k of Object.keys(total)) total[k] += b[k];
  return total;
}
function bucketsMatch(a, b) {
  return TOKEN_FIELDS.every((k) => a[k] === b[k]) && Math.abs(a.weighted - b.weighted) <= 0.5;
}
function runSemanticChecks(doc) {
  var _a, _b;
  const { engine, interpretation: llm } = doc;
  const results = [];
  const record = (checkId, problems) => results.push({
    checkId,
    status: problems.length ? "fail" : "pass",
    message: problems.length ? problems.join("; ") : null
  });
  const evidenceById = new Map(engine.evidence.map((e) => [e.id, e]));
  const componentIds = new Set(engine.inventory.components.map((c) => c.id));
  const axisById = new Map(engine.axes.map((a) => [a.axis, a]));
  {
    const refs = [];
    engine.axes.forEach((a) => refs.push(...a.source.evidenceIds));
    engine.tensionCandidates.forEach((t) => refs.push(...t.evidenceIds));
    llm.components.forEach((c) => c.risks.forEach((r) => refs.push(...r.evidenceIds)));
    llm.findings.forEach((f) => refs.push(...f.evidenceIds));
    const ct = llm.currentTradeoffs;
    refs.push(...ct.investForgo.evidenceIds);
    ct.componentTradeoffs.forEach((c) => [...c.gains, ...c.costs].forEach((e) => refs.push(...e.evidenceIds)));
    ct.axisTensions.forEach((t) => refs.push(...t.evidenceIds));
    (llm.changeTradeoffs ?? []).forEach((c) => [...c.expectedEffects, ...c.potentialLosses].forEach((e) => refs.push(...e.evidenceIds)));
    record("V-REF-EVIDENCE", [...new Set(refs.filter((id) => !evidenceById.has(id)))].map((id) => `없는 근거 ${id}`));
  }
  {
    const refs = [
      ...engine.evidence.map((e) => e.componentId),
      ...llm.components.flatMap((c) => [c.componentId, ...c.dependsOn]),
      ...llm.findings.flatMap((f) => f.componentIds),
      ...llm.currentTradeoffs.componentTradeoffs.map((c) => c.componentId)
    ];
    if (engine.selfCost.componentId) refs.push(engine.selfCost.componentId);
    (((_a = engine.comparison) == null ? void 0 : _a.componentChanges) ?? []).filter((c) => c.change !== "removed").forEach((c) => refs.push(c.componentId));
    record("V-REF-COMPONENT", [...new Set(refs.filter((id) => !componentIds.has(id)))].map((id) => `없는 구성 요소 ${id}`));
  }
  {
    const problems = [];
    const changeIds = new Set((((_b = engine.comparison) == null ? void 0 : _b.componentChanges) ?? []).map((c) => c.changeId));
    if (engine.comparison === null && llm.changeTradeoffs !== null) problems.push("comparison이 없는데 changeTradeoffs가 있음");
    if (engine.comparison !== null && llm.changeTradeoffs === null) problems.push("comparison이 있는데 changeTradeoffs가 null");
    const covered = /* @__PURE__ */ new Set();
    for (const c of llm.changeTradeoffs ?? []) {
      for (const id of c.changeIds) {
        if (!changeIds.has(id)) problems.push(`없는 변경 ${id}`);
        covered.add(id);
      }
    }
    record("V-REF-CHANGE", problems);
    record("V-CHANGE-COVERAGE", [...changeIds].filter((id) => !covered.has(id)).map((id) => `트레이드오프가 없는 변경 ${id}`));
  }
  {
    const candidates = new Set(engine.tensionCandidates.map((t) => t.tensionId));
    record("V-REF-TENSION", llm.currentTradeoffs.axisTensions.filter((t) => !candidates.has(t.tensionId)).map((t) => `후보에 없는 긴장 ${t.tensionId}`));
  }
  {
    const metricIds = new Set((engine.sessions.axisMetrics ?? []).map((m) => m.metricId));
    record("V-REF-METRIC", llm.findings.flatMap((f) => f.metricRefs).filter((m) => !metricIds.has(m)).map((m) => `없는 지표 ${m}`));
  }
  {
    const problems = [];
    const usedBy = /* @__PURE__ */ new Map();
    for (const a of engine.axes) {
      for (const id of a.source.evidenceIds) {
        const ev = evidenceById.get(id);
        if (!ev) continue;
        if (ev.primaryAxis !== a.axis) problems.push(`${id}의 주 축은 ${ev.primaryAxis}인데 ${a.axis} 판정에 쓰임`);
        if (ev.void) problems.push(`무력화된 근거 ${id}가 ${a.axis} 판정에 쓰임`);
        if (usedBy.has(id)) problems.push(`${id}가 ${usedBy.get(id)}와 ${a.axis}에 중복 사용`);
        usedBy.set(id, a.axis);
      }
    }
    record("V-SINGLE-ATTRIBUTION", problems);
  }
  {
    const seen = llm.axisNotes.map((n) => n.axis);
    const problems = AXES2.filter((a) => !seen.includes(a)).map((a) => `축 상세 누락 ${a}`);
    if (new Set(seen).size !== seen.length) problems.push("축 상세 중복");
    record("V-AXIS-NOTES", problems);
  }
  {
    const expected = /* @__PURE__ */ new Map();
    for (const a of engine.axes) {
      if (a.levelStatus === "assessed" && a.level === 0) expected.set(a.axis, "unconfigured");
      if (a.levelStatus === "unknown") expected.set(a.axis, "unknown");
    }
    const problems = [];
    const actual = new Map(llm.currentTradeoffs.emptyAreas.map((e) => [e.axis, e.kind]));
    for (const [axis, kind] of expected) if (actual.get(axis) !== kind) problems.push(`빈 영역 ${axis}(${kind}) 누락 또는 종류 불일치`);
    for (const axis of actual.keys()) if (!expected.has(axis)) problems.push(`빈 영역이 아닌 축 ${axis}`);
    record("V-EMPTY-AREAS", problems);
  }
  {
    const { invested, forgone } = llm.currentTradeoffs.investForgo;
    const problems = [];
    for (const axis of invested) {
      const a = axisById.get(axis);
      if (!(a.level !== null && a.level >= 2)) problems.push(`투자 축 ${axis}의 수준이 2 미만`);
    }
    for (const axis of forgone) {
      const a = axisById.get(axis);
      if (a.level !== null && a.level >= 2) problems.push(`포기 축 ${axis}의 수준이 2 이상`);
      if (invested.includes(axis)) problems.push(`${axis}가 투자와 포기에 모두 있음`);
    }
    record("V-INVEST-FORGO", problems);
  }
  {
    const range = [];
    const maturity = [];
    for (const a of engine.axes) {
      const shown = a.measured ? a.measured.band : a.level;
      if (a.range.min > a.range.max) range.push(`${a.axis} 범위 역전`);
      if (shown !== null && (shown < a.range.min || shown > a.range.max)) range.push(`${a.axis} 표시 값 ${shown}이 범위 밖`);
      const m = a.maturity;
      if (m.requirement && m.current !== null) {
        const expected = Math.min(1, m.current / m.requirement.required);
        if (Math.abs(expected - m.progress) > 5e-3) maturity.push(`${a.axis} 진행도 ${m.progress} ≠ ${expected.toFixed(3)}`);
        if (m.state === "measured" !== m.current >= m.requirement.required) maturity.push(`${a.axis} 상태와 진행도 불일치`);
      }
      if (a.measured && a.measured.predictedLevel !== null && a.measured.deltaFromPredicted !== a.measured.band - a.measured.predictedLevel) {
        maturity.push(`${a.axis} deltaFromPredicted 계산 불일치`);
      }
    }
    record("V-RANGE", range);
    record("V-MATURITY", maturity);
  }
  {
    const problems = [];
    const tokens = engine.sessions.tokens;
    if (tokens) {
      if (!bucketsMatch(tokens.total, sumBuckets(tokens.byLocation.map((l) => l.tokens)))) problems.push("위치별 합 ≠ total");
      if (!bucketsMatch(tokens.total, sumBuckets(tokens.byModel.map((m) => m.tokens)))) problems.push("모델별 합 ≠ total");
      const share = tokens.byLocation.reduce((s, l) => s + l.weightedShare, 0);
      if (Math.abs(share - 1) > 5e-3) problems.push(`위치별 비중 합 ${share}`);
    }
    record("V-TOKEN-SUM", problems);
  }
  return results;
}

// src/schema-validator.mjs
var ANNOTATIONS = /* @__PURE__ */ new Set(["$schema", "$id", "$comment", "title", "description", "$defs"]);
var SUPPORTED = /* @__PURE__ */ new Set([
  "type",
  "enum",
  "const",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else"
]);
var DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}
function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}
function deepEqual(a, b) {
  return JSON.stringify(canonical2(a)) === JSON.stringify(canonical2(b));
}
function canonical2(value) {
  if (Array.isArray(value)) return value.map(canonical2);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical2(value[k])]));
  }
  return value;
}
function createValidator(rootSchema) {
  const regexCache = /* @__PURE__ */ new Map();
  const regex = (pattern) => {
    if (!regexCache.has(pattern)) regexCache.set(pattern, new RegExp(pattern, "u"));
    return regexCache.get(pattern);
  };
  function resolve(ref) {
    if (!ref.startsWith("#/")) throw new Error(`지원하지 않는 $ref: ${ref}`);
    let node = rootSchema;
    for (const part of ref.slice(2).split("/")) {
      node = node == null ? void 0 : node[part];
      if (node === void 0) throw new Error(`해석할 수 없는 $ref: ${ref}`);
    }
    return node;
  }
  function check(schema, value, path7) {
    if (schema === true) return [];
    if (schema === false) return [`${path7}: 허용되지 않는 값`];
    const errors = [];
    for (const key of Object.keys(schema)) {
      if (!ANNOTATIONS.has(key) && !SUPPORTED.has(key)) {
        throw new Error(`지원하지 않는 스키마 키워드 '${key}' (${path7})`);
      }
    }
    if (schema.$ref) errors.push(...check(resolve(schema.$ref), value, path7));
    if (schema.type !== void 0) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t2) => matchesType(value, t2))) {
        return [...errors, `${path7}: 타입 ${types.join("|")} 필요, 실제 ${typeOf(value)}`];
      }
    }
    if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
      errors.push(`${path7}: ${JSON.stringify(value)}는 enum ${JSON.stringify(schema.enum)}에 없음`);
    }
    if ("const" in schema && !deepEqual(schema.const, value)) {
      errors.push(`${path7}: const ${JSON.stringify(schema.const)} 필요`);
    }
    const t = typeOf(value);
    if (t === "string") {
      const len = [...value].length;
      if (schema.minLength !== void 0 && len < schema.minLength) errors.push(`${path7}: 길이 ${len} < ${schema.minLength}`);
      if (schema.maxLength !== void 0 && len > schema.maxLength) errors.push(`${path7}: 길이 ${len} > ${schema.maxLength}`);
      if (schema.pattern !== void 0 && !regex(schema.pattern).test(value)) errors.push(`${path7}: 패턴 ${schema.pattern} 불일치`);
      if (schema.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path7}: date-time 형식 아님`);
    }
    if (t === "integer" || t === "number") {
      if (schema.minimum !== void 0 && value < schema.minimum) errors.push(`${path7}: ${value} < ${schema.minimum}`);
      if (schema.maximum !== void 0 && value > schema.maximum) errors.push(`${path7}: ${value} > ${schema.maximum}`);
    }
    if (t === "array") {
      if (schema.minItems !== void 0 && value.length < schema.minItems) errors.push(`${path7}: 항목 ${value.length} < ${schema.minItems}`);
      if (schema.maxItems !== void 0 && value.length > schema.maxItems) errors.push(`${path7}: 항목 ${value.length} > ${schema.maxItems}`);
      if (schema.uniqueItems) {
        const seen = new Set(value.map((v) => JSON.stringify(canonical2(v))));
        if (seen.size !== value.length) errors.push(`${path7}: 중복 항목`);
      }
      const prefix = schema.prefixItems ?? [];
      prefix.forEach((s, i) => {
        if (i < value.length) errors.push(...check(s, value[i], `${path7}[${i}]`));
      });
      if (schema.items !== void 0) {
        for (let i = prefix.length; i < value.length; i++) errors.push(...check(schema.items, value[i], `${path7}[${i}]`));
      }
    }
    if (t === "object") {
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${path7}: 필수 속성 '${key}' 없음`);
      }
      const props = schema.properties ?? {};
      for (const [key, v] of Object.entries(value)) {
        if (key in props) errors.push(...check(props[key], v, `${path7}.${key}`));
        else if (schema.additionalProperties !== void 0) errors.push(...check(schema.additionalProperties, v, `${path7}.${key}`));
      }
    }
    for (const s of schema.allOf ?? []) errors.push(...check(s, value, path7));
    if (schema.anyOf && !schema.anyOf.some((s) => check(s, value, path7).length === 0)) {
      errors.push(`${path7}: anyOf 중 일치하는 스키마 없음`);
    }
    if (schema.oneOf && schema.oneOf.filter((s) => check(s, value, path7).length === 0).length !== 1) {
      errors.push(`${path7}: oneOf 중 정확히 하나가 일치해야 함`);
    }
    if (schema.not && check(schema.not, value, path7).length === 0) errors.push(`${path7}: not 조건 위반`);
    if (schema.if !== void 0) {
      const branch = check(schema.if, value, path7).length === 0 ? schema.then : schema.else;
      if (branch !== void 0) errors.push(...check(branch, value, path7));
    }
    return errors;
  }
  return (value) => check(rootSchema, value, "$");
}

// src/validate.mjs
var PLACEHOLDER_VALIDATION = { status: "valid", validatorVersion: VALIDATOR_VERSION, checkedAt: "1970-01-01T00:00:00Z", checks: [] };
var msg = (problems) => problems.length ? truncate(problems.join("; "), 600) : null;
function draftHash(draft) {
  return hashJson(draft);
}
function validateDocument(doc, schema = loadSchema()) {
  const checks = [];
  const validator = createValidator(schema);
  const schemaErrors = validator({ ...doc, validation: PLACEHOLDER_VALIDATION });
  checks.push({ checkId: "V-SCHEMA", status: schemaErrors.length ? "fail" : "pass", message: msg(schemaErrors.slice(0, 8)) });
  if (schemaErrors.length === 0) {
    checks.push(...runSemanticChecks(doc));
  }
  const secretHits = [];
  if (doc.interpretation && typeof doc.interpretation === "object") {
    mapStrings(doc.interpretation, (s, p) => {
      const kinds = detectSecrets(s);
      if (kinds.length) secretHits.push(`interpretation${p}: ${kinds.join(",")}`);
      return s;
    });
  }
  checks.push({ checkId: "V-SECRET-RESCAN", status: secretHits.length ? "fail" : "pass", message: msg(secretHits) });
  return checks;
}
function validateRun({ out, runId, agent, model, now }) {
  const dir = runDir(out, runId);
  if (!existsSync4(path5.join(dir, "run.json"))) throw new EngineError(41, `run ${runId}이 없습니다.`);
  const run = readJson(path5.join(dir, "run.json"));
  const draft = readJson(path5.join(dir, "draft.json"));
  if (draftHash(draft) !== run.draftHash) {
    throw new EngineError(31, "V-ENGINE-INTEGRITY: draft.json이 prepare 산출과 다릅니다. prepare부터 다시 실행하세요.");
  }
  if (run.engineVersion !== ENGINE_VERSION || draft.schemaVersion !== SCHEMA_VERSION || draft.rubricVersion !== RUBRIC_VERSION) {
    throw new EngineError(31, "V-VERSION: run의 엔진·스키마·루브릭 버전이 현재 엔진과 다릅니다. prepare부터 다시 실행하세요.");
  }
  const checks = [
    { checkId: "V-VERSION", status: "pass", message: null },
    { checkId: "V-ENGINE-INTEGRITY", status: "pass", message: null }
  ];
  let interpretation = null;
  const interpFile = path5.join(dir, "interpretation.json");
  if (!existsSync4(interpFile)) {
    checks.push({ checkId: "V-SCHEMA", status: "fail", message: "interpretation.json이 없습니다." });
  } else {
    try {
      interpretation = JSON.parse(readFileSync4(interpFile, "utf8"));
    } catch {
      checks.push({ checkId: "V-SCHEMA", status: "fail", message: "interpretation.json이 올바른 JSON이 아닙니다." });
    }
  }
  const meta = {
    ...draft.meta,
    analyzer: {
      agent: agent ?? draft.meta.analyzer.agent,
      model: model ?? null,
      modelSource: model ? "reported_by_agent" : "unknown"
    }
  };
  const doc = { schemaVersion: draft.schemaVersion, rubricVersion: draft.rubricVersion, meta, engine: draft.engine, interpretation };
  if (interpretation !== null) checks.push(...validateDocument(doc));
  const status = checks.some((c) => c.status === "fail") ? "invalid" : "valid";
  const validation = { status, validatorVersion: VALIDATOR_VERSION, checkedAt: now, checks };
  const analysis = { ...doc, validation };
  writeJson(path5.join(dir, "analysis.json"), analysis);
  writeJson(path5.join(dir, "validation.json"), validation);
  writeJson(path5.join(dir, "run.json"), { ...run, status: status === "valid" ? "validated" : "failed" });
  return { status, checks, analysis };
}

// src/cli.mjs
var FLAGS = /* @__PURE__ */ new Set(["json", "strict-budget", "quiet", "no-sessions", "full-rescan", "open", "no-open"]);
var VALUED = /* @__PURE__ */ new Set(["project", "out", "scope", "config-dir", "now", "run", "model", "agent", "from", "to", "snapshot"]);
var COMMANDS = ["check-runtime", "collect", "aggregate-sessions", "prepare", "validate", "snapshot", "diff", "render", "finalize"];
var NODE_MESSAGE = "Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요.";
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new EngineError(EXIT.USAGE, `알 수 없는 인자: ${a}`);
    const key = a.slice(2);
    if (FLAGS.has(key)) opts[key] = true;
    else if (VALUED.has(key)) {
      if (rest[i + 1] === void 0) throw new EngineError(EXIT.USAGE, `--${key}에 값이 필요합니다.`);
      opts[key] = rest[++i];
    } else throw new EngineError(EXIT.USAGE, `알 수 없는 옵션: ${a}`);
  }
  if (!COMMANDS.includes(command)) throw new EngineError(EXIT.USAGE, `사용법: harness-lens.mjs <${COMMANDS.join("|")}> [옵션]`);
  if (opts.scope && !["project", "project_and_user"].includes(opts.scope)) throw new EngineError(EXIT.USAGE, "--scope는 project 또는 project_and_user입니다.");
  if (opts.now && Number.isNaN(Date.parse(opts.now))) throw new EngineError(EXIT.USAGE, "--now는 ISO 8601 시각이어야 합니다.");
  return { command, opts };
}
var Ctx = class {
  constructor(opts) {
    this.opts = opts;
    this.timings = [];
    this.now = isoSeconds(opts.now ? new Date(opts.now) : /* @__PURE__ */ new Date());
  }
  log(message) {
    if (!this.opts.quiet) process.stderr.write(`${message}
`);
  }
  time(subcommand, fn) {
    const t0 = performance.now();
    const result = fn();
    this.timings.push({ subcommand, durationMs: Math.round(performance.now() - t0), maxRssBytes: process.resourceUsage().maxRSS * 1024 });
    return result;
  }
  get projectRoot() {
    if (this._root) return this._root;
    let root;
    if (this.opts.project) {
      root = path6.resolve(this.opts.project);
    } else {
      let dir = process.cwd();
      for (; ; ) {
        if (existsSync5(path6.join(dir, ".git"))) {
          root = dir;
          break;
        }
        const up = path6.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    try {
      if (!root || !statSync4(root).isDirectory()) throw new Error("not dir");
      accessSync(root, fsc.R_OK);
    } catch {
      throw new EngineError(EXIT.NO_PROJECT, "프로젝트 루트를 찾을 수 없거나 읽을 수 없습니다. --project로 지정하세요.");
    }
    this._root = root;
    return root;
  }
  get out() {
    return path6.resolve(this.opts.out ?? path6.join(this.projectRoot, ".harness-lens"));
  }
  get scope() {
    return this.opts.scope ?? "project";
  }
  get configDir() {
    return path6.resolve(this.opts["config-dir"] ?? process.env.CLAUDE_CONFIG_DIR ?? path6.join(homedir3(), ".claude"));
  }
};
function checkRuntime(ctx) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) return { ok: false, code: "node_too_old", message: NODE_MESSAGE };
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) return { ok: false, code: "platform_unsupported", message: `지원하지 않는 플랫폼입니다: ${process.platform}` };
  let dir = ctx.out;
  while (!existsSync5(dir)) dir = path6.dirname(dir);
  try {
    accessSync(dir, fsc.W_OK);
  } catch {
    return { ok: false, code: "out_not_writable", message: "결과 디렉터리에 쓸 수 없습니다.", exit: EXIT.LOCKED };
  }
  return { ok: true, node: process.version, platform: process.platform };
}
function requireRuntime(ctx) {
  const r = ctx.time("check-runtime", () => checkRuntime(ctx));
  if (!r.ok) throw new EngineError(r.exit ?? EXIT.RUNTIME, r.message);
}
function engineLimitations(col, ctx, sessions, extra = []) {
  const out = [{ code: "static_analysis_only", message: "정적 구성만 분석했습니다. 실제 성능·비용 절감을 확정하지 않으며 수준은 구조적 지원 수준입니다." }];
  if (sessions.status === "disabled") out.push({ code: "sessions_disabled", message: "세션 기록 집계를 껐습니다(--no-sessions). 모든 축이 구성 기반 예측입니다." });
  else if (sessions.reason === SESSIONS_NOT_IMPLEMENTED) out.push({ code: SESSIONS_NOT_IMPLEMENTED, message: "세션 기록 실측 집계는 아직 구현되지 않았습니다(다음 단계). 모든 축이 구성 기반 예측이고 토큰 지표는 미확인입니다." });
  if (ctx.scope === "project") {
    const unscoped = col.sources.filter((s) => s.reason === "user_scope_not_collected" || s.reason === "managed_settings_not_collected");
    out.push(unscoped.length ? { code: "user_scope_not_collected", message: `수집하지 않은 사용자·관리형 설정 파일 ${unscoped.length}개가 있습니다. 실제 유효 설정은 다를 수 있으며 가능 범위로 표시합니다.` } : { code: "user_scope_absent", message: "사용자·관리형 설정 파일이 없어 가능 범위를 프로젝트 근거로만 정했습니다(파일 존재만 확인하고 열지 않았습니다)." });
  }
  if (col.r8Hits > 0) out.push({ code: "instruction_targets_analyzer", message: `분석 도구를 겨냥한 것으로 보이는 지시문 ${col.r8Hits}곳을 발견했습니다. 원문은 남기지 않았고 데이터로만 취급했으며 수준 계산에 쓰지 않았습니다.` });
  if (col.plugins.length) out.push({ code: "plugin_contents_not_collected", message: `활성 플러그인 ${col.plugins.length}개의 내용(skills·agents·hooks)은 v0.1에서 수집하지 않았습니다.` });
  if (col.sources.some((s) => s.status === "unreadable")) out.push({ code: "source_unreadable", message: "읽지 못한 출처가 있어 일부 축은 판정 불가이거나 범위가 넓습니다." });
  if (col.sources.some((s) => s.status === "out_of_scope" && s.origin !== "user" && s.origin !== "managed")) out.push({ code: "source_out_of_scope", message: "수집 루트 밖을 가리키는 경로(심볼릭 링크·import 등)는 따라가지 않았습니다." });
  if (col.sources.some((s) => s.status === "skipped_sensitive")) out.push({ code: "sensitive_files_skipped", message: "민감한 이름의 파일(.env, 키 파일 등)은 열지 않았습니다." });
  return [...out, ...extra];
}
function runCollect(ctx) {
  return ctx.time("collect", () => {
    const col = collect({ projectRoot: ctx.projectRoot, scope: ctx.scope, configDir: ctx.configDir, skillDir: skillDir() });
    const axes = computeAxes(col, { scope: ctx.scope });
    const tensionCandidates = computeTensions(col, axes);
    const kbKeys = knowledgeBaseKeys(col);
    const runId = `${compactUtc(ctx.now)}-${col.configurationHash.slice(7, 15)}`;
    let rootReal = ctx.projectRoot;
    try {
      rootReal = realpathSync3(rootReal);
    } catch {
    }
    const meta = {
      snapshotId: runId,
      analyzedAt: ctx.now,
      analysisType: "static",
      scope: { preset: ctx.scope, sources: col.origins },
      configurationHash: col.configurationHash,
      project: { displayName: truncate(path6.basename(rootReal) || "project", 200), rootPathHash: sha256tag(rootReal.split(path6.sep).join("/")) },
      analyzer: { agent: "unknown", model: null, modelSource: "unknown" },
      engineInfo: { version: ENGINE_VERSION, nodeVersion: process.version, platform: process.platform, sessionParserVersion: SESSION_PARSER_VERSION, pricingTableVersion: PRICING_TABLE_VERSION }
    };
    const strip = (list) => list.map(({ _tags, _key, ...rest }) => rest);
    const inventory = { components: strip(col.components), sources: col.sources, alwaysLoaded: col.alwaysLoaded, redactions: col.redactions };
    return { col, axes, tensionCandidates, kbKeys, runId, meta, inventory, evidence: strip(col.evidence) };
  });
}
function budget(id, observed) {
  const b = BUDGETS[id];
  return { budgetId: id, target: b.target, unit: b.unit, observed, status: observed === null ? "unmeasured" : observed <= b.target ? "within" : "exceeded" };
}
function compactInventory(draft, kbKeys) {
  const e = draft.engine;
  const sessions = { ...e.sessions, contextPerTurn: e.sessions.contextPerTurn && { ...e.sessions.contextPerTurn, series: void 0 } };
  if (sessions.tokens) sessions.tokens = { ...sessions.tokens, byModel: void 0 };
  return {
    schemaVersion: draft.schemaVersion,
    rubricVersion: draft.rubricVersion,
    meta: draft.meta,
    engine: {
      ...e,
      inventory: { ...e.inventory, sources: e.inventory.sources.filter((s) => s.status !== "absent") },
      sessions,
      selfCost: { componentId: e.selfCost.componentId, alwaysLoadedTokens: e.selfCost.alwaysLoadedTokens }
    },
    knowledgeBaseKeys: kbKeys
  };
}
function interpretationTemplate(axes, comparison) {
  return {
    summary: [],
    components: [],
    findings: [],
    axisNotes: AXES.map((axis) => ({ axis, rationale: "", conditions: [], counterexamples: [], validation: [] })),
    currentTradeoffs: {
      investForgo: { summary: "", invested: [], forgone: [], evidenceIds: [] },
      componentTradeoffs: [],
      axisTensions: [],
      emptyAreas: axes.filter((a) => a.levelStatus === "assessed" && a.level === 0 || a.levelStatus === "unknown").map((a) => ({ axis: a.axis, kind: a.levelStatus === "unknown" ? "unknown" : "unconfigured", meaning: "", howToConfirm: "" }))
    },
    changeTradeoffs: comparison ? [] : null,
    limitations: []
  };
}
function cmdPrepare(ctx) {
  const t0 = performance.now();
  requireRuntime(ctx);
  const out = ctx.out;
  ensureOutDir(out);
  const unlock = acquireLock(out);
  try {
    ctx.log("Harness Lens: 구성 수집 중(읽기 전용)…");
    const c = runCollect(ctx);
    const sessions = ctx.time("aggregate-sessions", () => aggregateSessions({ disabled: !!ctx.opts["no-sessions"] }));
    const axes = computeMaturity(c.axes, sessions);
    const prevId = latestSnapshotId(out);
    const dir = runDir(out, c.runId);
    rmSync2(dir, { recursive: true, force: true });
    const rescanWarnings = [];
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      rubricVersion: RUBRIC_VERSION,
      meta: c.meta,
      engine: {
        inventory: c.inventory,
        evidence: c.evidence,
        axes,
        tensionCandidates: c.tensionCandidates,
        sessions,
        selfCost: null,
        comparison: null,
        limitations: engineLimitations(c.col, ctx, sessions)
      }
    };
    if (prevId) {
      ctx.log(`Harness Lens: 이전 스냅샷 ${prevId}과 비교 중…`);
      draft.engine.comparison = ctx.time("diff", () => diffAnalyses(loadSnapshot(out, prevId), draft));
    }
    const finishSelfCost = (inventoryTokens2) => {
      const prepareMs = Math.round(performance.now() - t0);
      const currentRun = [...ctx.timings, { subcommand: "prepare", durationMs: prepareMs, maxRssBytes: process.resourceUsage().maxRSS * 1024 }];
      draft.engine.selfCost = {
        componentId: c.col.selfComponentId,
        alwaysLoadedTokens: { value: c.col.selfAlwaysLoadedTokens, method: "estimate_utf8_bytes" },
        currentRun,
        previousAnalysis: prevId ? { snapshotId: prevId, wallClockMs: null, llmTokens: null, method: "unknown" } : null,
        budgets: [
          budget("always_loaded_tokens", c.col.selfAlwaysLoadedTokens),
          budget("background_processes", 0),
          budget("reanalysis_engine_ms", prevId ? prepareMs : null),
          budget("engine_max_rss_bytes", Math.max(...currentRun.map((r) => r.maxRssBytes))),
          budget("llm_input_inventory_tokens", inventoryTokens2),
          budget("llm_tokens_per_analysis", null)
        ]
      };
    };
    const rescanned = rescanAndRedact(draft.engine);
    if (rescanned.hits.length) {
      draft.engine = rescanned.value;
      draft.engine.limitations.push({ code: "engine_output_redacted", message: `출력 직전 재검사에서 비밀정보 패턴 ${rescanned.hits.length}건을 추가로 제거했습니다.` });
      rescanWarnings.push(...rescanned.hits);
    }
    finishSelfCost(null);
    const compact = `${JSON.stringify(compactInventory(draft, c.kbKeys))}
`;
    const inventoryTokens = Math.ceil(Buffer.byteLength(compact, "utf8") / 4);
    finishSelfCost(inventoryTokens);
    const { axes: _ignored, ...engineNoAxes } = draft.engine;
    writeJson(path6.join(dir, "inventory.json"), {
      meta: draft.meta,
      inventory: engineNoAxes.inventory,
      evidence: engineNoAxes.evidence,
      axes: draft.engine.axes.map(({ maturity, measured, ...a }) => a),
      tensionCandidates: draft.engine.tensionCandidates,
      limitations: draft.engine.limitations,
      knowledgeBaseKeys: c.kbKeys
    });
    writeJson(path6.join(dir, "sessions.json"), sessions);
    writeJson(path6.join(dir, "draft.json"), draft);
    atomicWrite(path6.join(dir, "inventory.compact.json"), compact);
    writeJson(path6.join(dir, "interpretation.template.json"), interpretationTemplate(axes, draft.engine.comparison));
    writeJson(path6.join(dir, "run.json"), {
      runId: c.runId,
      status: "prepared",
      startedAt: ctx.now,
      finishedAt: ctx.now,
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      rubricVersion: RUBRIC_VERSION,
      timings: draft.engine.selfCost.currentRun,
      draftHash: draftHash(draft),
      previousSnapshotId: prevId
    });
    pruneRuns(out, c.runId);
    for (const w of rescanWarnings) ctx.log(`경고: 엔진 출력 ${w}에서 비밀정보 패턴을 제거했습니다.`);
    const exceeded = draft.engine.selfCost.budgets.filter((b) => b.status === "exceeded");
    for (const b of exceeded) ctx.log(`경고: 성능 예산 초과 ${b.budgetId} (${b.observed} > ${b.target})`);
    const result = {
      ok: true,
      runId: c.runId,
      compactInventoryPath: path6.join(dir, "inventory.compact.json"),
      interpretationTemplatePath: path6.join(dir, "interpretation.template.json"),
      interpretationPath: path6.join(dir, "interpretation.json"),
      hasComparison: draft.engine.comparison !== null,
      sessionsStatus: sessions.status,
      estimatedInventoryTokens: inventoryTokens
    };
    if (ctx.opts["strict-budget"] && exceeded.length) return { result: { ...result, ok: false, exceededBudgets: exceeded.map((b) => b.budgetId) }, exit: EXIT.BUDGET };
    ctx.log(`Harness Lens: 준비 완료 (run ${c.runId}). 해석을 ${result.interpretationPath}에 쓴 뒤 finalize를 실행하세요.`);
    return { result };
  } finally {
    unlock();
  }
}
function cmdCollect(ctx) {
  requireRuntime(ctx);
  ensureOutDir(ctx.out);
  const c = runCollect(ctx);
  writeJson(path6.join(runDir(ctx.out, c.runId), "inventory.json"), {
    meta: c.meta,
    inventory: c.inventory,
    evidence: c.evidence,
    axes: c.axes.map(({ maturity, measured, _measurable, ...a }) => a),
    tensionCandidates: c.tensionCandidates,
    knowledgeBaseKeys: c.kbKeys
  });
  return {
    result: {
      ok: true,
      runId: c.runId,
      configurationHash: c.meta.configurationHash,
      components: c.inventory.components.length,
      evidence: c.evidence.length,
      unreadable: c.inventory.sources.filter((s) => s.status === "unreadable").map((s) => s.path)
    }
  };
}
function cmdValidate(ctx) {
  if (!ctx.opts.run) throw new EngineError(EXIT.USAGE, "--run <runId>가 필요합니다.");
  const r = ctx.time("validate", () => validateRun({ out: ctx.out, runId: ctx.opts.run, agent: ctx.opts.agent, model: ctx.opts.model, now: ctx.now }));
  const checks = r.checks.filter((c) => c.status !== "pass");
  return { result: { ok: r.status === "valid", status: r.status, checks }, exit: r.status === "valid" ? 0 : EXIT.INVALID, analysis: r.analysis };
}
function cmdSnapshot(ctx) {
  var _a;
  if (!ctx.opts.run) throw new EngineError(EXIT.USAGE, "--run <runId>가 필요합니다.");
  const file = path6.join(runDir(ctx.out, ctx.opts.run), "analysis.json");
  if (!existsSync5(file)) throw new EngineError(EXIT.NOT_FOUND, `run ${ctx.opts.run}의 analysis.json이 없습니다. validate를 먼저 실행하세요.`);
  const analysis = readJson(file);
  if (((_a = analysis.validation) == null ? void 0 : _a.status) !== "valid") throw new EngineError(EXIT.INVALID, "검증을 통과하지 못한 결과는 스냅샷으로 저장하지 않습니다.");
  const { value: safe } = rescanAndRedact(analysis);
  ctx.time("snapshot", () => commitSnapshot(ctx.out, safe));
  const runFile = path6.join(runDir(ctx.out, ctx.opts.run), "run.json");
  if (existsSync5(runFile)) writeJson(runFile, { ...readJson(runFile), status: "snapshotted" });
  return { result: { ok: true, snapshotId: safe.meta.snapshotId, analysisPath: path6.join(snapshotDir(ctx.out, safe.meta.snapshotId), "analysis.json") } };
}
function openInBrowser(file) {
  const target = pathToFileURL(file).href;
  try {
    const [cmd, args] = process.platform === "darwin" ? ["open", [target]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', target]] : ["xdg-open", [target]];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
function cmdRender(ctx) {
  const id = ctx.opts.snapshot ?? latestSnapshotId(ctx.out);
  if (!id) throw new EngineError(EXIT.NOT_FOUND, "렌더링할 스냅샷이 없습니다.");
  const analysis = loadSnapshot(ctx.out, id);
  let html;
  try {
    html = ctx.time("render", () => renderReport(analysis));
    atomicWrite(path6.join(snapshotDir(ctx.out, id), "report.html"), html);
    atomicWrite(path6.join(ctx.out, "report.html"), html);
  } catch {
    throw new EngineError(EXIT.RENDER, "리포트를 만들지 못했습니다. 스냅샷은 저장돼 있습니다.");
  }
  const reportPath = path6.join(ctx.out, "report.html");
  const opened = ctx.opts.open ? openInBrowser(reportPath) : false;
  return { result: { ok: true, snapshotId: id, reportPath, opened } };
}
function cmdFinalize(ctx) {
  const out = ctx.out;
  if (!existsSync5(out)) throw new EngineError(EXIT.NOT_FOUND, "결과 디렉터리가 없습니다. prepare를 먼저 실행하세요.");
  const unlock = acquireLock(out);
  try {
    const v = cmdValidate(ctx);
    if (v.exit) return { result: { ok: false, status: v.result.status, checks: v.result.checks }, exit: v.exit };
    const snap = cmdSnapshot(ctx);
    const saved = ctx.opts;
    ctx.opts = { ...saved, snapshot: snap.result.snapshotId, open: !saved["no-open"] };
    let r;
    try {
      r = cmdRender(ctx);
    } finally {
      ctx.opts = saved;
    }
    ctx.log(`Harness Lens: 리포트 ${r.result.reportPath}`);
    return {
      result: { ok: true, status: "valid", snapshotId: snap.result.snapshotId, analysisPath: snap.result.analysisPath, reportPath: r.result.reportPath, opened: r.result.opened, checks: v.result.checks }
    };
  } finally {
    unlock();
  }
}
function resolveTo(ctx) {
  const to = ctx.opts.to;
  if (to && !to.startsWith("run:")) return loadSnapshot(ctx.out, to);
  let runId = to == null ? void 0 : to.slice(4);
  if (!runId) {
    const dir = path6.join(ctx.out, "runs");
    const runs = existsSync5(dir) ? readdirSync4(dir).filter((d) => existsSync5(path6.join(dir, d, "draft.json"))).sort() : [];
    runId = runs[runs.length - 1];
  }
  const file = runId && path6.join(runDir(ctx.out, runId), "draft.json");
  if (!file || !existsSync5(file)) throw new EngineError(EXIT.NOT_FOUND, "비교할 run이 없습니다.");
  return readJson(file);
}
function cmdDiff(ctx) {
  const toDoc = resolveTo(ctx);
  let fromId = ctx.opts.from;
  if (!fromId) {
    const idx = readIndex(ctx.out).map((e) => e.snapshotId).filter((id) => id !== toDoc.meta.snapshotId);
    fromId = idx[idx.length - 1];
  }
  if (!fromId) throw new EngineError(EXIT.NOT_FOUND, "비교할 이전 스냅샷이 없습니다.");
  const comparison = ctx.time("diff", () => diffAnalyses(loadSnapshot(ctx.out, fromId), toDoc));
  return { result: { ok: true, comparison } };
}
function cmdAggregateSessions(ctx) {
  const s = aggregateSessions({ disabled: !!ctx.opts["no-sessions"] });
  ctx.log("aggregate-sessions: 세션 기록 실측 집계는 아직 구현되지 않았습니다(다음 단계). 세션 기록을 읽지 않았습니다.");
  return { result: { ok: true, implemented: false, status: s.status, reason: s.reason } };
}
var HANDLERS = {
  "check-runtime": (ctx) => {
    const r = checkRuntime(ctx);
    if (!r.ok) return { result: { ok: false, code: r.code, message: r.message }, exit: r.exit ?? EXIT.RUNTIME };
    return { result: r };
  },
  collect: cmdCollect,
  "aggregate-sessions": cmdAggregateSessions,
  prepare: cmdPrepare,
  validate: cmdValidate,
  snapshot: cmdSnapshot,
  diff: cmdDiff,
  render: cmdRender,
  finalize: cmdFinalize
};
function main(argv) {
  let ctx = null;
  let json = argv.includes("--json");
  try {
    const { command, opts } = parseArgs(argv);
    json = !!opts.json;
    ctx = new Ctx(opts);
    const { result, exit = 0 } = HANDLERS[command](ctx);
    if (json) process.stdout.write(`${JSON.stringify(result)}
`);
    else if (command === "diff" || command === "check-runtime" || command === "collect") process.stdout.write(stableStringify(result));
    if (!json && exit === EXIT.INVALID) {
      for (const c of result.checks ?? []) process.stderr.write(`${c.checkId}: ${c.status} ${c.message ?? ""}
`);
    }
    return exit;
  } catch (err) {
    const code = err instanceof EngineError ? err.exitCode : EXIT.INTERNAL;
    let message = err instanceof EngineError ? err.message : "내부 오류가 발생했습니다.";
    if (code === EXIT.INTERNAL && ctx) {
      try {
        const file = path6.join(ctx.out, ctx.opts.run ? path6.join("runs", ctx.opts.run) : "", "error.json");
        if (existsSync5(path6.dirname(file))) {
          writeFileSync2(file, stableStringify({ message: String((err == null ? void 0 : err.message) ?? err).slice(0, 300), engineVersion: ENGINE_VERSION, at: ctx.now }));
          message = `${message} ${file}`;
        }
      } catch {
      }
      if (process.env.HARNESS_LENS_DEBUG) process.stderr.write(`${err == null ? void 0 : err.stack}
`);
    }
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, code, message })}
`);
    process.stderr.write(`${message}
`);
    return code;
  }
}

// src/main.mjs
process.exitCode = main(process.argv.slice(2));
