// Harness Lens 엔진 번들. 생성 파일이므로 직접 고치지 말고 engine/src를 고친 뒤 npm run build 하세요.
if (Number(process.versions.node.split('.')[0]) < 20) {
  var hlMsg = 'Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요.';
  if (process.argv.indexOf('--json') >= 0) process.stdout.write(JSON.stringify({ ok: false, code: 'node_too_old', message: hlMsg }) + '\n');
  else process.stderr.write(hlMsg + '\n');
  process.exit(10);
}

// src/cli.mjs
import { spawn } from "child_process";
import { accessSync, constants as fsc, existsSync as existsSync6, readdirSync as readdirSync5, realpathSync as realpathSync4, rmSync as rmSync3, statSync as statSync5, writeFileSync as writeFileSync2 } from "fs";
import { homedir as homedir4 } from "os";
import path8 from "path";
import { performance } from "perf_hooks";
import { pathToFileURL } from "url";

// src/pricing.mjs
var PRICING_TABLE_VERSION = "2026-10-06";
var REFERENCE_MODEL = "claude-opus-5-5";
var TABLE = {
  "claude-fable-5-1": [1e5, 5e5, 2500],
  "claude-mythos-5-1": [1e5, 5e5, 2500],
  "claude-fable-5": [1e5, 5e5, 1e4],
  "claude-mythos-5": [1e5, 5e5, 1e4],
  "claude-opus-5-5": [4e4, 2e5, 2e3],
  "claude-opus-5": [5e4, 25e4, 5e3],
  "claude-opus-4-8": [5e4, 25e4, 5e3],
  "claude-opus-4-7": [5e4, 25e4, 5e3],
  "claude-opus-4-6": [5e4, 25e4, 5e3],
  "claude-sonnet-5-5": [2e4, 1e5, 2e3],
  "claude-sonnet-5": [2e4, 1e5, 2e3],
  "claude-sonnet-4-6": [3e4, 15e4, 3e3],
  // Haiku 5.5는 프롬프트 10만 토큰 이하 단가다(초과 구간은 반영하지 않는다).
  "claude-haiku-5-5": [1e3, 5e3, 100],
  "claude-haiku-4-5": [1e4, 5e4, 1e3]
};
var REF_INPUT = TABLE[REFERENCE_MODEL][0];
function modelKey(model) {
  if (typeof model !== "string") return null;
  const m = model.toLowerCase().replace(/\[[^\]]*\]$/, "").replace(/@.*$/, "").replace(/^(?:[a-z]{2}\.)?anthropic\./, "");
  return m.replace(/-\d{8}$/, "").replace(/-v\d+(?::\d+)?$/, "");
}
function priceKey(model) {
  const m = modelKey(model);
  return m !== null && Object.hasOwn(TABLE, m) ? m : null;
}
function weightedUnits(model, bucket) {
  const key = priceKey(model);
  if (!key) return null;
  const [inp, out, read] = TABLE[key];
  const [fresh, w5, w1, cr, o] = bucket;
  return fresh * inp + w5 * (inp * 5 / 4) + w1 * inp * 2 + cr * read + o * out;
}
var unitsToWeighted = (units) => units / REF_INPUT;

// src/constants.mjs
var ENGINE_VERSION = "0.4.0";
var VALIDATOR_VERSION = "0.4.0";
var SCHEMA_VERSION = "0.1";
var RUBRIC_VERSION = "0.4";
var SESSION_PARSER_VERSION = "4";
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
  spec_clarity: { measurable: false, blockedReason: "needs_ci_pr_results" },
  verification_gate_strength: { measurable: false, blockedReason: "needs_ci_pr_results" },
  execution_stability: { measurable: true, unit: "tool_calls", required: 500 },
  throughput: { measurable: true, unit: "sessions", required: 20 },
  // 0.3: cache_hit_ratio를 참고 지표로 내렸다(클라이언트 동작 영향이 커서 하네스 축 실측으로 약하다). 대역 지표가 정해질 때까지 예측.
  cost_efficiency: { measurable: false, blockedReason: "band_metric_undefined" },
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
function roundHalfEven(value, digits) {
  const f = 10 ** digits;
  const x = value * f;
  const r = Math.round(x);
  const diff = Math.abs(x % 1);
  if (Math.abs(diff - 0.5) < 1e-9) return (r % 2 === 0 ? r : r - 1) / f;
  return r / f;
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
var BLOCK_KEYS = [["decision", "block"], ["permissionDecision", "deny"]];
var BLOCK = [
  "exit 2",
  "process.exit(2)",
  "process.exitCode = 2",
  "sys.exit(2)",
  "os.Exit(2)",
  ...BLOCK_KEYS.flatMap(([k, v]) => [`"${k}": "${v}"`, `'${k}': '${v}'`, `${k}: "${v}"`, `${k}: '${v}'`]),
  '"continue": false',
  "'continue': False",
  "continue: false"
];
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
var NEGATION = /않|없이|없다|없음|말고|말 것|아니|n't\b|\b(?:not|never|without|no)\b/i;
function affirmativeClauses(text) {
  return String(text ?? "").split(/[.!?;。\n]+|,\s+/).filter((c) => !NEGATION.test(c.normalize("NFC"))).join(" ");
}
function detectRole(name, description) {
  for (const text of [name ?? "", affirmativeClauses(description)]) {
    for (const [role, words] of ROLES) if (hasAny(text, words)) return role;
  }
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
function mapStrings(value, fn, path9 = "") {
  if (typeof value === "string") return fn(value, path9);
  if (Array.isArray(value)) return value.map((v, i) => mapStrings(v, fn, `${path9}/${i}`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapStrings(v, fn, `${path9}/${k}`);
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
var GIT_HOOK_NAME = /^(?:applypatch-msg|pre-applypatch|post-applypatch|pre-commit|pre-merge-commit|prepare-commit-msg|commit-msg|post-commit|pre-rebase|post-checkout|post-merge|pre-push|pre-receive|update|proc-receive|post-receive|post-update|reference-transaction|push-to-checkout|pre-auto-gc|post-rewrite|sendemail-validate|fsmonitor-watchman|p4-changelist|p4-prepare-changelist|p4-post-changelist|p4-pre-submit|post-index-change)$/;
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
function gateCommands(command) {
  const parts = [];
  let start = 0;
  let quote = null;
  let bracket = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "\\" && quote !== "'") {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (bracket) {
      if (command.startsWith(bracket, i)) {
        i += bracket.length - 1;
        bracket = null;
      }
      continue;
    }
    if (ch === "[" && (i === 0 || /\s/.test(command[i - 1]))) {
      if (command[i + 1] === "[") {
        bracket = "]]";
        i++;
        continue;
      }
      if (/\s/.test(command[i + 1] ?? "")) {
        bracket = "]";
        continue;
      }
    }
    if (ch === "#" && (i === 0 || /\s/.test(command[i - 1]))) {
      parts.push(command.slice(start, i));
      start = command.length;
      break;
    }
    if (/[;&|]/.test(ch)) {
      parts.push(command.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(command.slice(start));
  return parts.map((part) => part.trim().replace(/^-\s+/, "").replace(/^(?:(?:if|elif|while|until|then|do|else)\s+|!\s*)+/, "").trim()).filter((part) => part && !/^(?:echo|printf|export|test|\[{1,2})(?:\s|$)|^[\w]+\s*=/.test(part));
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
var MAX_HOOK_IMPORTS = 16;
function hookImports(text) {
  const out = [];
  const add = (spec, names, rootRel = false) => {
    if (out.length >= MAX_HOOK_IMPORTS || /[$()`*?]/.test(spec) || !rootRel && !/^\.{1,2}\//.test(spec)) return;
    if (!out.some((o) => o.spec === spec && o.rootRel === rootRel)) out.push({ spec, names, rootRel });
  };
  for (const m of text.matchAll(/\bimport\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+[\w$]+)?\s*(?:from\s*)?["']([^"'\n]+)["']/g)) {
    const named = m[2] !== void 0 && !m[1] ? m[2].split(",").map((x) => x.trim().split(/\s+as\s+/)[0]).filter((n) => /^[\w$]+$/.test(n)) : null;
    add(m[3], named);
  }
  for (const m of text.matchAll(/\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) add(m[1], null);
  for (const m of text.matchAll(/^\s*(?:source|\.)\s+["']?(\$\{?CLAUDE_PROJECT_DIR\}?\/)?([^"'\s;]+)/gm)) {
    if (m[1]) add(m[2], null, true);
    else add(/^\.{1,2}\//.test(m[2]) ? m[2] : `./${m[2]}`, null);
  }
  for (const m of text.matchAll(/^\s*from\s+\.([\w.]*)\s+import\b/gm)) if (m[1] && !m[1].includes(".")) add(`./${m[1]}.py`, null);
  return out;
}
function blockingExports(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
  const marks = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s*([\w$]+)|(?:const|let|var|class)\s+([\w$]+))/gm;
  const starts = [...text.matchAll(marks)].map((m) => ({ at: m.index, name: m[1] ?? m[2] }));
  const names = /* @__PURE__ */ new Set();
  if (hasBlockMarker(text.slice(0, starts.length ? starts[0].at : text.length))) names.add("*");
  starts.forEach((st, i) => {
    if (hasBlockMarker(text.slice(st.at, i + 1 < starts.length ? starts[i + 1].at : text.length))) names.add(st.name);
  });
  return names;
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
  // probe: 확장자 후보를 찾는 시도라 없는 파일은 출처로 남기지 않는다.
  readFile(root, rel, origin, limit = TEXT_LIMIT_BYTES, probe = false) {
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
        if (probe) return { status: "absent", disp };
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
    var _a;
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
    let block = hasBlockMarker(text);
    const imports = [];
    let blockVia = block ? "script" : null;
    if (script !== null) {
      const dir = path2.posix.dirname(path2.posix.normalize(scriptRel));
      for (const imp of hookImports(script)) {
        const target = path2.posix.normalize(imp.rootRel ? imp.spec : path2.posix.join(dir, imp.spec));
        if (target.startsWith("..") || path2.posix.isAbsolute(target)) continue;
        const cands = /\.[a-z]+$/i.test(target) ? [target] : [".mjs", ".js", ".cjs", ".ts", ".sh"].map((ext) => target + ext);
        const f = ((_a = cands.map((c) => [c, this.readFile(scriptRoot, c, origin, SCRIPT_LIMIT_BYTES, cands.length > 1)]).find(([, r]) => r.status === "ok")) == null ? void 0 : _a[1]) ?? this.readFile(scriptRoot, cands[0], origin, SCRIPT_LIMIT_BYTES);
        if (f.status !== "ok") continue;
        imports.push({ disp: f.disp, hash: sha256hex(f.raw) });
        if (block) continue;
        const exported = blockingExports(f.text);
        const called = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}\\s*\\(`).test(script.replace(/^\s*import\b[^;]*?from\s*["'][^"']*["'];?/gm, ""));
        const hit = imp.names === null ? exported.size > 0 : exported.has("*") || imp.names.some((n) => exported.has(n) && called(n));
        if (hit) {
          block = true;
          blockVia = f.disp;
        }
      }
    }
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
      paths: [settingsDisp, ...scriptDisp ? [scriptDisp] : [], ...blockVia && blockVia !== "script" ? [blockVia] : []],
      contentHash: sha256tag(hashInput({ event, matcher, handler: h, script: scriptRaw === null ? null : sha256hex(scriptRaw), ...imports.length ? { imports: imports.map((x) => x.hash) } : {} })),
      attributes: {
        event,
        matcher: matcher && this.clean(matcher, 120),
        type,
        timeoutSec: typeof h.timeout === "number" ? h.timeout : null,
        blockingMarker: block,
        blockingMarkerVia: blockVia === null ? null : blockVia === "script" ? "script" : "import",
        verifyCommand: verify,
        specCommand: spec,
        reentryGuard: reentry,
        scriptExists: scriptRel ? scriptStatus === "ok" : null,
        command: command ? this.clean(command, 120) : null
      }
    });
    const keyBase = pointer("hooks", event, g, "hooks", hi);
    const verifyEvent = event === "PreToolUse" || event === "PostToolUse" || event === "Stop" || event === "SubagentStop";
    const describe = [
      block ? blockVia && blockVia !== "script" ? `차단 표지(문자열 패턴) 있음(import ${path2.posix.basename(blockVia)})` : "차단 표지(문자열 패턴) 있음" : "차단 표지(문자열 패턴) 없음",
      verify ? verifyEvent ? "검증 명령 어휘" : "검증 명령 어휘 있음(이 이벤트는 검증 판정에 쓰지 않음)" : null,
      levelCap ? "스크립트 확인 불가" : null
    ].filter(Boolean).join(", ");
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
  // CI·Git Hook은 설정만 읽는다. CI 성공·필수 PR 검사 여부는 이 파일들로 알 수 없다.
  collectRepositoryGates() {
    const root = this.projectRoot;
    let hooksDir = ".git/hooks";
    const config = readTextInside(root, ".git/config", TEXT_LIMIT_BYTES);
    this.gateLimitations = [];
    const git = resolveInside(root, ".git");
    if (git.status === "ok" && !git.isDir) this.gateLimitations.push({ code: "git_hook_activation_unresolved", message: "워크트리·서브모듈의 외부 gitdir는 따라가지 않아 Git Hook 활성 경로를 확인하지 못했습니다. 추적된 Hook은 절차 근거로만 봅니다." });
    if (this.platform === "win32") this.gateLimitations.push({ code: "git_hook_executable_unconfirmed", message: "Windows에서는 Git Hook 실행 비트를 확인하지 못해 강제 수준으로 올리지 않습니다. 실행 비트가 다른 플랫폼과 구성 해시가 다를 수 있습니다." });
    if (config.status === "ok") {
      let core = false;
      for (const line of config.text.split("\n")) {
        if (/^\s*\[/.test(line)) core = /^\s*\[core\]\s*(?:[#;].*)?$/i.test(line);
        const m = core && /^\s*hooksPath\s*=\s*([^#;]+?)\s*$/i.exec(line);
        if (m) {
          const value = m[1].replace(/^"(.*)"$/, "$1").replace(/\\/g, "/");
          hooksDir = value.split("/").includes("..") || path2.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) ? value : path2.posix.normalize(value).replace(/\/$/, "");
        }
      }
    }
    const collectGate = (rel, kind, origin, active = false) => {
      const f = this.readFile(root, rel, origin, SCRIPT_LIMIT_BYTES, true);
      if (f.status !== "ok") return;
      const commands = [];
      let blockIndent = null;
      let runObject = null;
      f.text.split("\n").forEach((line, i) => {
        var _a, _b;
        if (!line.trim() || /^\s*#/.test(line)) return;
        if (targetsAnalyzer(line)) {
          this.r8Hits++;
          return;
        }
        if (path2.basename(rel) === "Jenkinsfile") {
          const sh = /^\s*(?:sh|bat|powershell)\s*(?:\(\s*)?["']([^"']+)["']/.exec(line);
          if (sh) commands.push([i + 1, sh[1]]);
          return;
        }
        if (!/\.ya?ml$/i.test(rel)) {
          commands.push([i + 1, line]);
          return;
        }
        const indent = line.search(/\S/);
        if (runObject && indent <= runObject.parent) runObject = null;
        if (runObject) runObject.child ?? (runObject.child = indent);
        if (blockIndent !== null && indent > blockIndent) {
          commands.push([i + 1, line]);
          return;
        }
        blockIndent = null;
        const m = /^(\s*)(-\s*)?(run|script|entry|command):\s*(.*)$/.exec(line);
        if (!m) return;
        if (m[3] === "command" && (!runObject || indent !== runObject.child)) return;
        if (m[3] === "run" && !m[4]) runObject = { parent: m[1].length + (((_a = m[2]) == null ? void 0 : _a.length) ?? 0), child: null };
        if (/^[|>][-+]?\s*(?:#.*)?$/.test(m[4]) || !m[4] && m[3] === "script") blockIndent = m[1].length + (((_b = m[2]) == null ? void 0 : _b.length) ?? 0);
        else if (m[4]) commands.push([i + 1, m[4]]);
      });
      const comp = this.addComponent({
        kind,
        origin,
        key: f.disp,
        name: f.disp,
        paths: [f.disp],
        contentHash: kind === "git_hook" ? hashJson({ content: sha256tag(f.raw), active }) : sha256tag(f.raw),
        attributes: { active, executionResultsCollected: false }
      });
      if (kind === "git_hook") this.hashEntries.set(f.disp, comp.contentHash);
      this.addEvidence({
        comp,
        path: f.disp,
        family: "repository-gate",
        mechanism: "procedure",
        fact: `${kind === "ci" ? "CI" : "Git Hook"} 설정 확인(실행 결과·PR 필수 검사 여부는 미수집)`,
        tags: { repositoryGate: true }
      });
      for (const [axis, words, rule] of [
        ["spec_clarity", SPEC_CMD, "SC-L2-04"],
        ["verification_gate_strength", VERIFY_CMD, "VG-L2-04"]
      ]) {
        const verification = (cmd) => /(?:^|[;&|]\s*|\s)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check)(?:\b|:)|node\s+--test\b|pytest\b|ruff\b|eslint\b|tsc\b|prettier\s+--check\b|cargo\s+(?:test|clippy)\b|go\s+(?:test|vet)\b|mvn\s+(?:test|verify)\b|gradle\s+(?:test|check)\b)/i.test(cmd) && !/^\s*(?:echo|printf|export|[\w]+\s*=)\b/.test(cmd);
        const hit = commands.find(([, cmd]) => {
          return gateCommands(cmd).some((candidate) => (axis === "spec_clarity" ? hasAny(candidate, words) : verification(candidate)) && (axis === "spec_clarity" || !hasAny(candidate, SPEC_CMD)));
        });
        if (!hit) continue;
        const before = commands.filter(([line]) => line < hit[0]).map(([, cmd]) => cmd).join("\n");
        const linkedFailure = /\|\|\s*exit\s+[1-9]\d*\s*$/.test(hit[1]);
        const standaloneWithErrexit = /^\s*set\s+-[a-z]*e[a-z]*\s*$/m.test(before) && !/\bset\s+\+[a-z]*e/.test(before) && !/[;&|]/.test(hit[1]) && !/^\s*(?:if|elif|while|until|then|do|else|!)(?:\s|$)/.test(hit[1]);
        const enforced = kind === "git_hook" && active && (linkedFailure || standaloneWithErrexit);
        const ruleId = enforced ? axis === "spec_clarity" ? "SC-L3-02" : "VG-L3-04" : rule;
        this.addEvidence({
          comp,
          path: f.disp,
          line: hit[0],
          family: `repository:${axis}`,
          primaryAxis: axis,
          mechanism: enforced ? "harness_enforced" : "procedure",
          ruleIds: [ruleId],
          fact: `${kind === "ci" ? "CI" : "Git Hook"}에 ${AXIS_LABEL[axis]} 명령 어휘 확인${enforced ? "(활성 실행 파일·실패 종료 표지)" : "(실행·강제 여부 미확인)"}`,
          tags: { repositoryGate: true }
        });
      }
    };
    const visited = /* @__PURE__ */ new Set();
    for (const [dir, filter, kind, declaredOrigin] of [
      [".github/workflows", /\.ya?ml$/i, "ci", "project_shared"],
      [".circleci", /^config\.ya?ml$/i, "ci", "project_shared"],
      [".husky", GIT_HOOK_NAME, "git_hook", "project_shared"],
      [".githooks", GIT_HOOK_NAME, "git_hook", "project_shared"],
      [hooksDir, GIT_HOOK_NAME, "git_hook", "project_local"]
    ]) {
      if (visited.has(dir)) continue;
      visited.add(dir);
      const active = kind === "git_hook" && dir === hooksDir && !(git.status === "ok" && !git.isDir);
      const origin = active ? "project_local" : declaredOrigin;
      const listed = listDirInside(root, dir);
      if (listed.status === "escape") this.addSource(displayPath(path2.resolve(root, dir), root), origin, "out_of_scope", "outside_root_or_symlink_escape");
      if (listed.status === "unreadable") this.addSource(displayPath(path2.resolve(root, dir), root), origin, "unreadable", "read_error");
      const candidates = listed.entries.filter((n) => filter.test(n));
      if (candidates.length > 100) this.addSource(dir, origin, "unsupported", "candidate_limit_exceeded");
      for (const name of candidates.slice(0, 100)) {
        const rel = `${dir}/${name}`;
        const r = resolveInside(root, rel);
        if (r.isDir) continue;
        const executable = active && this.platform !== "win32" && r.status === "ok" && !!(statSync2(r.real).mode & 73);
        collectGate(rel, kind, dir === hooksDir ? "project_local" : origin, executable);
      }
    }
    for (const rel of [".gitlab-ci.yml", ".gitlab-ci.yaml", "azure-pipelines.yml", "azure-pipelines.yaml", "Jenkinsfile"]) collectGate(rel, "ci", "project_shared");
    collectGate(".pre-commit-config.yaml", "git_hook", "project_shared");
  }
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
    this.collectRepositoryGates();
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
      selfAlwaysLoadedTokens: this.selfAlwaysLoadedTokens,
      gateLimitations: this.gateLimitations
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
    needs_ci_pr_results: "CI·PR 실행 결과 필요(설정 수집과 별개)",
    needs_ci_pr_data: "CI·PR 데이터 필요(아직 수집하지 않음)",
    session_format_unconfirmed: "세션 기록 형식 미확인",
    band_metric_undefined: "대역 지표 미정(캐시 적중률은 참고 지표)",
    sessions_disabled: "세션 집계 꺼짐",
    no_session_logs: "세션 기록 없음",
    session_format_unsupported: "세션 기록 형식 미지원",
    session_aggregation_failed: "세션 집계 오류",
    insufficient_samples: "표본 부족",
    metric_unavailable: "대역 지표 없음",
    no_attributed_sessions: "귀속된 세션 없음",
    session_lines_skipped: "해석 못 한 줄이 많음"
  };
  var REASON = {
    user_scope_not_collected: "수집하지 않은 사용자 설정 파일이 있어 실제 수준이 더 높을 수 있음",
    managed_settings_not_collected: "수집하지 않은 관리형 설정 파일이 있어 실제 수준이 더 높을 수 있음",
    source_unreadable: "읽지 못한 출처가 있어 수준이 달라질 수 있음",
    source_out_of_scope: "수집 범위 밖 출처가 있어 수준이 달라질 수 있음",
    level3_reserved: "처리 속도는 수준 3을 예약해 두어 최대 2",
    measured_band: "실측 대역 기준",
    sample_below_2x_requirement: "표본이 요구량의 2배 미만이라 실측 대역 ±1",
    outside_root_or_symlink_escape: "프로젝트 밖 경로이거나 심볼릭 링크가 밖을 가리킴",
    import_outside_root: "프로젝트 밖 파일을 불러옴",
    invalid_json: "JSON 형식 오류",
    read_error: "읽기 오류",
    sensitive_filename: "비밀정보가 들 수 있는 파일 이름"
  };
  function reasonText(c) {
    return REASON[c] || c;
  }
  var LOC = { direct: "프로젝트 세션", worker: "워커 워크트리", subagent: "서브에이전트", bot: "오케스트레이터 봇" };
  var METHOD = { direct: "작업 경로 일치", worktree: "워크트리 gitdir", inferred: "추정(삭제된 워크트리)", configured: "설정 매핑", auto: "자동 귀속" };
  var TOKTYPE = [["freshInput", "새 입력"], ["cacheWrite", "캐시 쓰기"], ["cacheRead", "캐시 읽기"], ["output", "출력"]];
  var METRIC = {
    non_bash_tool_error_rate: "도구 오류율(Bash 제외)",
    bash_error_rate: "Bash 비정상 종료율(참고)",
    tool_error_rate: "도구 오류율(전체, 참고)",
    tool_error_recovery_rate: "오류 뒤 회복률",
    hook_errors_per_session: "세션당 Hook 실패",
    api_retries_per_session: "세션당 API 재시도",
    turn_duration_p50_ms: "턴 시간 중앙값",
    session_duration_p50_ms: "세션 길이 중앙값",
    cache_hit_ratio: "캐시 적중률(참고)",
    weighted_tokens_per_session: "세션당 환산 토큰",
    context_p90_window_ratio: "요청 입력 크기 p90 ÷ 모델 창",
    context_p90_tokens: "요청 입력 크기 p90(참고)",
    compactions_per_session: "세션당 컨텍스트 압축",
    tool_calls_between_prompts_p50: "사람 입력 사이 도구 호출 중앙값",
    human_prompts_per_session: "세션당 사람 입력",
    hook_blocks_per_session: "세션당 Hook 차단(VG 대리 지표)",
    bot_weighted_share: "봇 채팅 환산값 비중(참고)",
    worker_weighted_share: "워커 환산값 비중(참고)"
  };
  function num(v) {
    if (v === null || v === void 0) return "—";
    var neg = v < 0, x = Math.abs(v), int = Math.floor(x), frac = x - int;
    var str = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (frac > 0) str += "." + String(Math.round(frac * 10) % 10);
    return (neg ? "−" : "") + str;
  }
  function pct(v) {
    return Math.round(v * 1e3) / 10 + "%";
  }
  function metricValue(m) {
    if (m.unit === "ratio") return pct(m.value);
    if (m.unit === "ms") return m.value >= 6e4 ? Math.round(m.value / 6e3) / 10 + "분" : Math.round(m.value / 100) / 10 + "초";
    if (m.unit === "tokens") return num(m.value) + " 토큰";
    if (m.unit === "per_session") return Math.round(m.value * 100) / 100 + "회";
    return String(m.value);
  }
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
  function rangeText(a) {
    var reasons = a.range.reasonCodes.filter(function(c) {
      return c !== "measured_band";
    }).map(reasonText);
    return (a.maturity.state === "measured" ? "실측 대역 범위 " : "가능 범위 ") + a.range.min + "–" + a.range.max + (reasons.length ? " (" + reasons.join(", ") + ")" : "");
  }
  function deltaText(me) {
    if (me.predictedLevel === null) return "";
    return " · 구조 수준 " + me.predictedLevel + " / 실측 대역 " + me.band + "(다른 척도라 차이를 계산하지 않음)";
  }
  function fold(title, count, unit) {
    return el("summary", null, title + " (" + count + unit + ")");
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
  var bar = el("div", { class: "bar", role: "img", "aria-label": "실측 " + measuredCount + " / " + eng.axes.length + "축" });
  eng.axes.forEach(function(a) {
    bar.appendChild(el("span", { class: a.maturity.state === "measured" ? "seg on" : "seg", title: AXIS[a.axis] + " " + stateText(a) }));
  });
  app.appendChild(el("div", { class: "panel maturity" }, [
    el("b", null, "근거 성숙도"),
    bar,
    el("span", null, "실측 " + measuredCount + " / " + eng.axes.length + "축"),
    measuredCount === 0 ? el("span", { class: "muted" }, "지금은 구성 기반 예측입니다. 실제 성능 측정이 아닙니다.") : el("span", { class: "muted" }, "실측 대역은 세션 기록 집계에 휴리스틱 임계값을 적용한 값입니다(상관관계, 인과 아님).")
  ]));
  var sess = eng.sessions;
  var usable = sess.status === "available" || sess.status === "partial";
  if (!usable) {
    app.appendChild(el("p", { class: "notice" }, "세션 기록 실측: " + (BLOCKED[sess.reason] || sess.reason || BLOCKED[sess.status === "disabled" ? "sessions_disabled" : "no_session_logs"]) + ". 모든 축은 구성 기반 예측으로 표시합니다."));
  } else if (sess.status === "partial") {
    app.appendChild(el("p", { class: "notice" }, "세션 기록 일부를 해석하지 못했습니다(" + pct(sess.coverage.skippedRatio) + "). 형식이 바뀌었을 수 있어 실측값을 조심해서 보세요."));
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
  function isMeasured(a) {
    return a.maturity.state === "measured" && !!a.measured;
  }
  drawProfile(function(a) {
    return a.level;
  }, "cur", function() {
    return false;
  });
  drawProfile(function(a) {
    return isMeasured(a) ? a.measured.band : null;
  }, "cur", function() {
    return true;
  });
  eng.axes.forEach(function(a, i) {
    if (a.level === null) {
      var q = pt(i, 0.45);
      svg.appendChild(s("circle", { class: "unknown", cx: q[0], cy: q[1], r: 9 }));
      svg.appendChild(s("text", { class: "unknown-label", x: q[0], y: q[1] + 4, "text-anchor": "middle" }, "?"));
    } else {
      var p = pt(i, a.level);
      svg.appendChild(s("circle", { class: isMeasured(a) ? "pt-pred faded" : "pt-pred", cx: p[0], cy: p[1], r: 5.5 }, s("title", null, AXIS[a.axis] + " " + levelText(a) + " (구조 예측)")));
    }
    if (isMeasured(a)) {
      var m = pt(i, a.measured.band);
      svg.appendChild(s("circle", { class: "pt-meas", cx: m[0], cy: m[1], r: 5 }, s("title", null, AXIS[a.axis] + " 실측 대역 " + a.measured.band + " (세션 지표, 구조 수준과 다른 척도)")));
    }
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
      g.appendChild(s("circle", { class: "pt-meas", cx: 38, cy: 8, r: 4.5 }));
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
    el("li", null, [legendIcon("pred"), "구조 수준(구성 기반 예측, 모든 축): 점선, 빈 원. 실측 축에서는 직전 예측이라 흐리게"]),
    measuredCount ? el("li", null, [legendIcon("meas"), "실측 대역(세션 지표, 구조 수준과 다른 척도): 채운 점. 이웃 축도 실측일 때만 실선으로 잇습니다"]) : null,
    showPrev ? el("li", null, [legendIcon("prev"), "이전 스냅샷 " + cmp.previousSnapshotId + " 구조 수준: 점 무늬 선, 네모"]) : null,
    el("li", null, [legendIcon("band"), "가능 범위: 예측 축은 수집 범위 밖·미확인 출처가 바꿀 수 있는 구조 수준, 실측 축은 실측 대역이 있을 수 있는 구간(표본이 쌓일수록 좁아짐)"]),
    el("li", null, [legendIcon("unknown"), "판정 불가: 관련 출처를 읽지 못함(0점이 아님)"])
  ]);
  var axisList = el("ul", { class: "tight" }, eng.axes.map(function(a) {
    var m = a.maturity;
    var unitName = m.requirement && (m.requirement.unit === "sessions" ? "세션 " : "도구 호출 ");
    var mt;
    if (!m.measurable) mt = "실측 불가: " + (BLOCKED[m.blockedReason] || m.blockedReason);
    else if (m.state === "measured") {
      var me = a.measured;
      mt = "실측 대역 " + me.band + " (" + me.bandRuleId + ", 휴리스틱) · " + me.metrics.map(function(x) {
        return (METRIC[x.metricId] || x.metricId) + " " + metricValue(x);
      }).join(", ") + " · 표본 " + unitName + num(me.sampleSize) + "회" + deltaText(me);
    } else if (m.current === null) mt = "실측까지: " + unitName + m.requirement.required + "회 · " + (BLOCKED[m.blockedReason] || m.blockedReason);
    else mt = "실측까지: " + unitName + num(m.current) + " / " + num(m.requirement.required) + "회 · " + Math.round(m.progress * 100) + "% (기준은 휴리스틱)";
    var d = prevLevel[a.axis];
    var delta = d && d.comparable && d.previousLevel !== d.currentLevel ? " · 이전 " + (d.previousLevel === null ? "?" : d.previousLevel) + " → 현재 " + (d.currentLevel === null ? "?" : d.currentLevel) : "";
    var prog = m.measurable && m.progress !== null ? el("span", { class: "mini", role: "img", "aria-label": "진행도 " + Math.round(m.progress * 100) + "%" }, el("span", { style: "width:" + Math.round(m.progress * 100) + "%" })) : null;
    var shownText = m.state === "measured" ? "실측 대역 " + a.measured.band + " (실측) · " + levelText(a).replace("수준", "구조 수준") : levelText(a) + " (예측)";
    return el("li", null, [el("b", null, AXIS[a.axis]), " ", shownText, " · " + rangeText(a) + delta, el("br"), prog, el("span", { class: "muted" }, mt)]);
  }));
  radarSec.appendChild(el("div", { class: "radar-wrap" }, [
    el("div", { class: "panel" }, svg),
    el("div", null, [legend, el("p", { class: "notice" }, "레이더의 면적은 종합 점수가 아닙니다. 구조 수준(0~3)은 구성이 주는 지원 수준이며 실제 성능이 아닙니다. 실측 대역(0~3)은 세션 지표를 휴리스틱 구간으로 나눈 값이라, 같은 눈금에 올렸지만 다른 척도입니다. 둘의 차이는 점수 하락·상승이 아닙니다. 축끼리 더하거나 하네스 간 순위를 매기지 마세요."), axisList])
  ]));
  function shareBar(parts, label) {
    var total = parts.reduce(function(t, x) {
      return t + x.value;
    }, 0);
    var W2 = 640, H2 = 28;
    var g = s("svg", { class: "share", viewBox: "0 0 " + W2 + " " + H2, role: "img", "aria-label": label + ": " + parts.map(function(x) {
      return x.name + " " + (total ? pct(x.value / total) : "0%");
    }).join(", ") });
    var x0 = 0;
    parts.forEach(function(x) {
      if (!total || !x.value) return;
      var w = x.value / total * W2;
      g.appendChild(s("rect", { class: "seg " + x.cls, x: x0, y: 0, width: Math.max(w - 2, 1), height: H2, rx: 3 }, s("title", null, x.name + " " + num(x.value) + " (" + pct(x.value / total) + ")")));
      x0 += w;
    });
    var legend2 = el("ul", { class: "legend inline" }, parts.map(function(x) {
      return el("li", null, [el("span", { class: "swatch " + x.cls, "aria-hidden": "true" }), x.name + " " + (total ? pct(x.value / total) : "0%")]);
    }));
    return el("div", { class: "sharewrap" }, [g, legend2]);
  }
  function day(iso) {
    return Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  }
  function spanText(ms) {
    var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    return d ? d + "일 " + h + "시간" : h ? h + "시간 " + m + "분" : m + "분";
  }
  function bucketRow(name, b) {
    return [name, num(b.freshInput), num(b.cacheWrite), num(b.cacheRead), num(b.output), num(b.weighted)];
  }
  var TOKH = ["구분", "새 입력", "캐시 쓰기", "캐시 읽기", "출력", "환산값"];
  if (usable) {
    var sSec2 = section("세션 기록 실측", "sessions");
    var cov = sess.coverage;
    var win = sess.window;
    var tokSpan = win ? Math.round((day(win.to) - day(win.from)) / 864e5 + 1) + "일(날짜 기준)" : null;
    var axisSpanMs = cov.configSince ? Math.max(0, Date.parse(meta.analyzedAt) - Date.parse(cov.configSince)) : null;
    var sessAxis = eng.axes.filter(function(a) {
      return a.maturity.requirement && a.maturity.requirement.unit === "sessions" && a.maturity.current !== null;
    })[0];
    var axisSessions = sessAxis ? sessAxis.maturity.current : null;
    var winLines = [
      "① 토큰·위치 표: " + (win ? win.from + " ~ " + win.to + " (" + tokSpan + ", 귀속 세션 " + num(cov.sessionsAttributed) + "개)" : "—"),
      cov.configSince ? "② 축별 실측 지표(집계 창 ‘현재 구성 이후’): " + cov.configSince + " 이후" + (axisSpanMs === null ? "" : " (분석 시각까지 " + spanText(axisSpanMs) + (axisSessions === null ? "" : ", 프로젝트·워커 세션 " + num(axisSessions) + "개") + ")") : "② 축별 실측 지표: 구성 기준 시각이 없어 ①과 같은 누적 창을 씁니다."
    ];
    var shortWin = axisSpanMs !== null && axisSpanMs < 7 * 864e5;
    sSec2.appendChild(el("div", { class: "notice windows" }, [
      el("b", null, "집계 창이 둘입니다"),
      el("ul", { class: "tight" }, winLines.map(function(t) {
        return el("li", null, t);
      })),
      el("span", null, "두 창의 값은 서로 비교하지 마세요." + (shortWin ? " 축 실측 창이 짧아 실측 대역이 흔들릴 수 있습니다." : ""))
    ]));
    sSec2.appendChild(el("div", { class: "meta panel" }, [
      ["토큰 집계 창(①)", win ? win.from + " ~ " + win.to + " · " + tokSpan : "—"],
      ["축 실측 창(②)", cov.configSince ? cov.configSince + " 이후" + (axisSpanMs === null ? "" : " · 분석 시각까지 " + spanText(axisSpanMs)) : "①과 같음"],
      ["원본 기록 범위", sess.window && sess.window.rawLogsFrom ? sess.window.rawLogsFrom + " 이후(오래된 기록은 Claude Code가 정리)" : "원본 기록 없음(누적값만)"],
      ["Claude Code 버전", sess.clientVersions ? sess.clientVersions.min + " ~ " + sess.clientVersions.max : "미확인"],
      ["읽은 기록", "파일 " + num(cov.filesScanned) + "개 · 줄 " + num(cov.linesRead) + " (건너뜀 " + num(cov.linesSkipped) + ")" + (cov.incremental ? " · 증분" : " · 전체")],
      ["중복 제거", "assistant 줄 " + num(sess.dedup.assistantLines) + " → 응답 " + num(sess.dedup.uniqueResponses) + " (합성 " + sess.dedup.excludedSynthetic + " · API 오류 " + sess.dedup.excludedApiError + " 제외)"],
      ["귀속", "귀속 세션 " + num(cov.sessionsAttributed) + " · 미귀속(불확실) " + num(cov.sessionsUnattributed) + (cov.sessionsExcluded ? " · 무관한 프로젝트 제외 " + num(cov.sessionsExcluded) : "") + " (① 창 기준)"]
    ].map(function(kv) {
      return el("div", null, [el("b", null, kv[0]), kv[1]]);
    })));
    sSec2.appendChild(el("p", { class: "muted" }, "원문(대화·코드·도구 입력)은 읽어 두지 않고 숫자만 집계했습니다."));
    var tk = sess.tokens;
    if (tk) {
      sSec2.appendChild(el("h3", null, "토큰 종류별"));
      sSec2.appendChild(shareBar(TOKTYPE.map(function(t, i) {
        return { name: t[1], value: tk.total[t[0]], cls: "c" + (i + 1) };
      }), "토큰 종류별 비중(토큰 수)"));
      sSec2.appendChild(el("h3", null, "위치별 (환산값 비중)"));
      sSec2.appendChild(el("p", { class: "muted" }, "환산값: 공개 가격표(" + tk.weighting.pricingTableVersion + ") 기준 " + tk.weighting.referenceModel + " 새 입력 토큰으로 환산한 상대값이며 청구액이 아닙니다. 아래 막대와 표의 ‘환산값’·‘비중’ 칸이 이 단위입니다. 프로젝트 세션은 작업 경로가 이 프로젝트 안인 메인 세션(엔진 값 direct)입니다. 이번 분석 세션은 실행한 곳에 따라 프로젝트 세션·워커 워크트리·오케스트레이터 봇 중 하나로 집계되고, 집계 시점에 기록이 없으면 빠집니다."));
      var locs = tk.byLocation.filter(function(l) {
        return l.sessions > 0 || l.tokens.weighted > 0;
      });
      sSec2.appendChild(shareBar(tk.byLocation.map(function(l, i) {
        return { name: LOC[l.location], value: l.tokens.weighted, cls: "c" + (i + 1) };
      }), "위치별 환산값 비중"));
      var bot = tk.byLocation.filter(function(l) {
        return l.location === "bot";
      })[0];
      var top = tk.byLocation.slice().sort(function(a, b) {
        return b.weightedShare - a.weightedShare;
      })[0];
      if (bot && bot.weightedShare > 0 && top.location === "bot") {
        var crShare = tk.total.cacheRead ? bot.tokens.cacheRead / tk.total.cacheRead : 0;
        sSec2.appendChild(el("p", { class: "notice" }, "오케스트레이터 봇 채팅이 환산값의 " + pct(bot.weightedShare) + "로 가장 큽니다. 캐시 읽기의 " + pct(crShare) + "가 봇 채팅에서 나왔습니다. 조율 비용이라 축 지표에서는 뺐습니다."));
      }
      sSec2.appendChild(table(TOKH.concat(["비중", "세션", "귀속 방법"]), locs.map(function(l) {
        var meth = Object.keys(l.attribution).filter(function(k) {
          return l.attribution[k] > 0;
        }).map(function(k) {
          return METHOD[k] + " " + l.attribution[k];
        }).join(", ");
        return bucketRow(LOC[l.location], l.tokens).concat([pct(l.weightedShare), num(l.sessions), meth || "—"]);
      }).concat([
        bucketRow(el("b", null, "합계(귀속분)"), tk.total).concat(["100%", num(cov.sessionsAttributed), ""]),
        bucketRow(el("span", { class: "muted" }, "미귀속(불확실, 합계 제외)"), tk.unattributed.tokens).concat(["—", num(tk.unattributed.sessions), "봇 " + tk.unattributed.botSessions])
      ])));
      if (cov.sessionsExcluded) sSec2.appendChild(el("p", { class: "muted" }, "이 프로젝트와 무관한 세션 " + num(cov.sessionsExcluded) + "개(다른 프로젝트 경로, 다른 저장소에 매핑된 봇)는 위 표 어디에도 넣지 않았습니다."));
      if (tk.byModel.length) {
        sSec2.appendChild(el("details", null, [fold("모델별", tk.byModel.length, "개 모델"), table(TOKH, tk.byModel.map(function(m) {
          return bucketRow(m.model, m.tokens);
        }))]));
      }
    }
    var cpt = sess.contextPerTurn;
    if (cpt) {
      var dist = cpt.distribution;
      sSec2.appendChild(el("h3", null, "턴별 컨텍스트 크기 (최근 " + dist.retentionDays + "일 원시 기록)"));
      if (cpt.p50 === null) sSec2.appendChild(el("p", { class: "notice" }, "최근 " + dist.retentionDays + "일 안의 원시 요청이 없어 분포(중앙값·p90·최대)는 미확인입니다. 아래 일별 추이는 접어 둔 누적 요약입니다. 컨텍스트 압축 " + cpt.compactions + "회."));
      else sSec2.appendChild(el("p", null, "메인 스레드 요청 " + num(cpt.requests) + "개(" + dist.from + " ~ " + dist.to + ", 최근 " + dist.retentionDays + "일 원시 기록)의 입력 크기(새 입력+캐시 쓰기+캐시 읽기): 중앙값 " + num(cpt.p50) + " · p90 " + num(cpt.p90) + "(이 창 기준) · 최대 " + num(cpt.max) + " 토큰. 세션 첫 요청 중앙값 " + num(cpt.firstRequestP50) + " · 컨텍스트 압축 " + cpt.compactions + "회."));
      if (cpt.series.some(function(p) {
        return p.source === "archive";
      })) sSec2.appendChild(el("p", { class: "muted" }, "‘근사’ 표시 날은 " + dist.retentionDays + "일이 지나 일별 요약으로 접은 날입니다. 요청 수·최대는 정확하고 중앙값은 근사일 수 있습니다."));
      var axisP90 = sess.axisMetrics.filter(function(m) {
        return m.metricId === "context_p90_tokens";
      })[0];
      if (cpt.p90 !== null && axisP90 && axisP90.value !== cpt.p90) sSec2.appendChild(el("p", { class: "muted" }, "축별 실측 지표의 요청 입력 크기 p90 " + num(axisP90.value) + "은 " + (axisP90.sinceConfig ? "현재 구성 이후(② 창) 요청만" : "누적 집계") + " 센 값이라 위 p90 " + num(cpt.p90) + "과 다릅니다."));
      if (cpt.series.length) sSec2.appendChild(trendChart(cpt.series));
    }
    if (sess.axisMetrics.length) {
      sSec2.appendChild(el("h3", null, "축별 실측 지표"));
      sSec2.appendChild(table(["축", "지표", "값", "표본", "집계 창"], sess.axisMetrics.map(function(m) {
        return [AXIS[m.axis], METRIC[m.metricId] || m.metricId, metricValue(m), num(m.sampleSize), m.sinceConfig ? "② 현재 구성 이후" : "① 누적"];
      })));
    }
    if (sess.toolUsage && sess.toolUsage.length) {
      sSec2.appendChild(el("details", null, [
        fold("도구별 호출·오류", sess.toolUsage.length, "개 도구"),
        el("p", { class: "muted" }, "Bash 비정상 종료는 테스트 실패처럼 명령의 정상 결과일 수 있어 실행 안정성 대역에서 뺐습니다. Hook 차단·사용자 거절도 오류로 기록될 수 있습니다."),
        table(["도구", "호출", "오류", "오류율"], sess.toolUsage.map(function(u) {
          return [u.tool, num(u.calls), num(u.errors), u.calls ? pct(u.errors / u.calls) : "—"];
        }))
      ]));
    }
  }
  function niceCeil(v) {
    var e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function trendChart(series) {
    if (series.length < 3) {
      return el("p", { class: "muted trend-text" }, "일별 추이는 " + series.length + "일치뿐이라 그래프 대신 값을 적습니다: " + series.map(function(p) {
        return p.date + " 요청 " + num(p.requests) + "개 · 중앙값 " + num(p.p50) + " · 최대 " + num(p.max) + " 토큰" + (p.source === "archive" ? "(근사)" : "");
      }).join(" / ") + ".");
    }
    var W3 = 640, H3 = 200, L = 64, Rt = 12, T = 12, B = 30;
    var maxV = niceCeil(Math.max.apply(null, series.map(function(p) {
      return p.max;
    })) || 1);
    var n3 = series.length;
    var xOf = function(i) {
      return n3 === 1 ? L + (W3 - L - Rt) / 2 : L + i * (W3 - L - Rt) / (n3 - 1);
    };
    var yOf = function(v) {
      return T + (H3 - T - B) * (1 - v / maxV);
    };
    var g = s("svg", { class: "trend", viewBox: "0 0 " + W3 + " " + H3, role: "img", "aria-label": "일별 요청 입력 크기 추이. 정확한 값은 아래 표에 있습니다." });
    [0, 0.5, 1].forEach(function(f) {
      var y = yOf(maxV * f);
      g.appendChild(s("line", { class: "gridline", x1: L, x2: W3 - Rt, y1: y, y2: y }));
      g.appendChild(s("text", { class: "axislabel", x: L - 6, y: y + 4, "text-anchor": "end" }, num(Math.round(maxV * f))));
    });
    [0, n3 - 1].filter(function(v, i, arr) {
      return arr.indexOf(v) === i;
    }).forEach(function(i) {
      g.appendChild(s("text", { class: "axislabel", x: xOf(i), y: H3 - 8, "text-anchor": i === 0 && n3 > 1 ? "start" : "end" }, series[i].date));
    });
    [["max", "line-max"], ["p50", "line-p50"]].forEach(function(k) {
      if (n3 > 1) g.appendChild(s("polyline", { class: k[1], points: series.map(function(p, i) {
        return xOf(i) + "," + yOf(p[k[0]]);
      }).join(" ") }));
      series.forEach(function(p, i) {
        g.appendChild(s("circle", { class: "dot " + k[1], cx: xOf(i), cy: yOf(p[k[0]]), r: 4 }, s("title", null, p.date + " " + (k[0] === "max" ? "최대 " : "중앙값 ") + num(p[k[0]]) + " 토큰 · 요청 " + p.requests + (p.source === "archive" ? " · 근사" : ""))));
      });
    });
    var lg = el("ul", { class: "legend inline" }, [
      el("li", null, [el("span", { class: "swatch line-p50", "aria-hidden": "true" }), "일별 중앙값(실선)"]),
      el("li", null, [el("span", { class: "swatch line-max dashed", "aria-hidden": "true" }), "일별 최대(점선)"])
    ]);
    return el("div", null, [el("div", { class: "panel" }, [g, lg]), el("details", null, [fold("일별 표", series.length, "일"), table(["날짜", "요청", "중앙값", "최대", "출처"], series.map(function(p) {
      return [p.date, num(p.requests), num(p.p50), num(p.max), p.source === "archive" ? "근사(누적 요약)" : "원시 기록"];
    }))])]);
  }
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
  function investItem(a) {
    var ax = axisById[a];
    var text = AXIS[a] + " — " + levelText(ax);
    if (ax && ax.maturity.state === "measured" && ax.measured) text += " (구조 예측) · 실측 대역 " + ax.measured.band;
    return el("li", null, text);
  }
  tSec.appendChild(el("h3", null, "투자와 포기"));
  tSec.appendChild(el("div", { class: "panel" }, [
    el("p", null, ct.investForgo.summary),
    el("div", { class: "grid2" }, [
      el("div", null, [el("b", null, "투자한 축"), el("ul", { class: "tight" }, ct.investForgo.invested.map(investItem))]),
      el("div", null, [el("b", null, "내준 축"), el("ul", { class: "tight" }, ct.investForgo.forgone.map(investItem))])
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
  if (eng.inventory.components.some(function(c) {
    return c.kind === "hook";
  })) {
    aSec.appendChild(el("p", { class: "muted" }, "Hook 근거의 ‘차단 표지’는 Hook 명령·스크립트(상대 경로 import 1단계 포함)에서 exit 2·decision: block 같은 문자열 패턴을 찾은 결과입니다. 실행해 확인한 것이 아닙니다. ‘검증 명령 어휘’는 검증 게이트 판정에 쓰는 이벤트(PreToolUse·PostToolUse·Stop·SubagentStop)에서만 근거가 됩니다."));
  }
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
      el("details", null, [el("summary", null, "엔진 근거 " + a.source.evidenceIds.length + "개 · " + rangeText(a)), evList(a.source.evidenceIds)])
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
  dSec.appendChild(el("p", { class: "muted" }, "레이더 차트와 같은 데이터입니다. 구조 수준과 실측 대역은 다른 척도입니다."));
  dSec.appendChild(table(["축", "구조 수준", "실측 대역", "상태", "가능 범위", "결정 규칙", "근거 수", "이전 구조 수준", "비교"], eng.axes.map(function(a) {
    var d = prevLevel[a.axis];
    return [
      AXIS[a.axis],
      a.level === null ? "판정 불가" : String(a.level),
      a.measured ? String(a.measured.band) : "—",
      stateText(a) + (a.levelStatus === "unknown" ? " · 미확인" : ""),
      a.range.min + "–" + a.range.max + (a.maturity.state === "measured" ? " (실측 대역 기준)" : ""),
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
    var r = role[c.id];
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
  var pa = sc.previousAnalysis;
  if (!pa) sSec.appendChild(el("p", { class: "muted" }, "직전 분석 기록 없음. 다음 분석에서 이번 분석의 토큰·시간을 세션 기록으로 측정합니다."));
  else {
    sSec.appendChild(el("p", null, "직전 분석(" + pa.snapshotId + "): 걸린 시간 " + (pa.wallClockMs === null ? "미확인" : Math.round(pa.wallClockMs / 100) / 10 + "초") + " · LLM 토큰 " + (pa.llmTokens ? "새 입력 " + num(pa.llmTokens.freshInput) + " + 캐시 쓰기 " + num(pa.llmTokens.cacheWrite) + " + 출력 " + num(pa.llmTokens.output) + " (캐시 읽기 " + num(pa.llmTokens.cacheRead) + " 별도, 환산 " + num(pa.llmTokens.weighted) + ")" : "미측정(그 구간의 귀속 세션 기록 없음)")));
    if (pa.llmTokens) sSec.appendChild(el("p", { class: "muted" }, "prepare 시작~finalize 끝 구간에 이 프로젝트에 귀속된 메인 스레드 응답을 모두 셉니다. 같은 시간에 다른 작업을 했다면 함께 들어갑니다. 프로젝트 세션과 워커 워크트리 응답을 합한 값이라 세션 기록 실측의 두 위치 합계와 겹칩니다(따로 빼지 않음). 봇에서 실행한 분석은 여기에 잡히지 않습니다."));
  }
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
      return [x.path, ORIGIN[x.origin] || x.origin, SRC[x.status] || x.status, x.reason ? reasonText(x.reason) : "—"];
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
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --panel: #1f1f1d; --text: #ecece6; --muted: #a3a39b; --line: #3a3a36;
    --grid: #4a4a45; --current: #7fb0ff; --previous: #9c9c94; --band: rgba(127, 176, 255, 0.20);
    --warn-bg: #3a2f14; --warn-line: #e0a830; --added: #6fcf8a; --removed: #ff8a80; --modified: #e6b450;
    --code-bg: #2a2a27;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 16px; margin: 18px 0 8px; }
p { margin: 6px 0; }
/* 긴 비분리 문자열(경로·식별자)이 페이지 폭을 넘기지 않게 한다. 표는 .tablewrap 가로 스크롤에 맡긴다. */
p, li, summary, .meta div { overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px 18px; margin: 12px 0; }
.meta div { font-size: 13px; }
.meta b { display: block; color: var(--muted); font-weight: 600; font-size: 12px; }
.notice { border-left: 4px solid var(--warn-line); background: var(--warn-bg); padding: 8px 12px; border-radius: 4px; margin: 8px 0; }
.maturity { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bar { width: 240px; height: 16px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--panel); }
.bar { display: flex; gap: 2px; padding: 1px; }
.bar span.seg { flex: 1; height: 100%; border-radius: 3px; background: transparent; border: 1px dashed var(--grid); }
.bar span.seg.on { background: var(--current); border: 1px solid var(--current); }
.mini { display: inline-block; vertical-align: middle; width: 80px; height: 8px; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; margin-right: 6px; }
.mini span { display: block; height: 100%; background: var(--current); }
.sharewrap { margin: 6px 0 10px; }
svg.share { width: 100%; height: auto; display: block; }
svg .c1, .swatch.c1 { fill: var(--s1); background: var(--s1); }
svg .c2, .swatch.c2 { fill: var(--s2); background: var(--s2); }
svg .c3, .swatch.c3 { fill: var(--s3); background: var(--s3); }
svg .c4, .swatch.c4 { fill: var(--s4); background: var(--s4); }
.legend.inline { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.legend.inline li { margin: 2px 0; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.swatch.line-p50 { height: 3px; width: 22px; background: var(--s1); }
.swatch.line-max { height: 0; width: 22px; border-top: 2px dashed var(--s2); background: none; }
svg.trend { width: 100%; height: auto; display: block; }
svg.trend .gridline { stroke: var(--grid); stroke-width: 1; opacity: 0.6; }
svg.trend .axislabel { fill: var(--muted); font-size: 11px; }
svg.trend polyline { fill: none; stroke-width: 2; }
svg.trend .line-p50 { stroke: var(--s1); }
svg.trend .line-max { stroke: var(--s2); stroke-dasharray: 6 4; }
svg.trend .dot.line-p50 { fill: var(--s1); stroke: var(--panel); stroke-width: 2; stroke-dasharray: none; }
svg.trend .dot.line-max { fill: var(--panel); stroke: var(--s2); stroke-width: 2; stroke-dasharray: none; }
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
svg.radar .pt-pred.faded { opacity: 0.45; }
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

// src/model-windows.mjs
var M = 1e6;
var WINDOWS = {
  "claude-fable-5-2": M,
  "claude-fable-5-1": M,
  "claude-mythos-5-1": M,
  "claude-fable-5": M,
  "claude-mythos-5": M,
  "claude-opus-5-5": M,
  "claude-opus-5": M,
  "claude-opus-4-8": M,
  "claude-opus-4-7": M,
  "claude-opus-4-6": M,
  "claude-sonnet-5-5": M,
  "claude-sonnet-5": M,
  "claude-sonnet-4-6": M,
  "claude-haiku-5-5": M,
  "claude-haiku-4-5": 2e5
};
function contextWindow(model) {
  const k = modelKey(model);
  return k !== null && Object.hasOwn(WINDOWS, k) ? WINDOWS[k] : null;
}

// src/sessions.mjs
import {
  closeSync as closeSync2,
  existsSync as existsSync4,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readFileSync as readFileSync4,
  readSync,
  readdirSync as readdirSync4,
  realpathSync as realpathSync3,
  renameSync as renameSync2,
  rmSync as rmSync2,
  statSync as statSync4,
  writeSync as writeSync2
} from "fs";
import { endianness, homedir as homedir3 } from "os";
import path5 from "path";

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

// src/sessions.mjs
import { createHash as createHash3 } from "crypto";
var CHUNK = 1 << 20;
var MAX_LINE_BYTES = 16 * 1024 * 1024;
var RESPONSE_RETENTION_DAYS = 90;
var DAY_MS = 24 * 60 * 60 * 1e3;
var AGGREGATED = /* @__PURE__ */ new Set(["assistant", "user", "system", "attachment"]);
var KNOWN_IGNORED = /* @__PURE__ */ new Set([
  "cost-state",
  "api-request",
  "api-request-shape",
  "api-request-blob",
  "ai-title",
  "custom-title",
  "last-prompt",
  "agent-name",
  "queue-operation",
  "mode",
  "permission-mode",
  "pr-link",
  "frame-link",
  "file-history-snapshot",
  "file-history-delta",
  "session-owner",
  "tools-used",
  "atis-latch",
  "summary",
  "progress"
]);
var MODEL_RE = /^[A-Za-z0-9._:@/[\]-]{1,80}$/;
var VERSION_RE = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,30}$/;
var labelCache = /* @__PURE__ */ new Map();
function safeLabel(value, re) {
  if (typeof value !== "string" || !re.test(value)) return null;
  let ok = labelCache.get(value);
  if (ok === void 0) {
    ok = redactString(value, null, { wholeValue: true }) === value;
    if (labelCache.size < 4096) labelCache.set(value, ok);
  }
  return ok ? value : null;
}
var h16 = (s) => createHash3("sha256").update(String(s)).digest().toString("hex", 0, 8);
var bufHash = (buf) => createHash3("sha256").update(buf).digest().toString("hex", 0, 8);
var toPosix2 = (p) => p.split(path5.sep).join("/").replace(/\\/g, "/");
var isInt = (v) => Number.isInteger(v) && v >= 0;
function compareVersions(a, b) {
  const pa = a.split(/[.+-]/).map((x) => /^\d+$/.test(x) ? Number(x) : x);
  const pb = b.split(/[.+-]/).map((x) => /^\d+$/.test(x) ? Number(x) : x);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return compareCodeUnits(String(x), String(y));
  }
  return 0;
}
var expandHome = (p) => p.startsWith("~/") || p === "~" ? path5.join(homedir3(), p.slice(1)) : p;
function realOrSelf(p) {
  try {
    return realpathSync3(p);
  } catch {
    return p;
  }
}
function isUnder(p, base) {
  if (!base) return false;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  return p === b || p.startsWith(`${b}/`);
}
function mainRepoOf(dir) {
  let cur = dir;
  for (let i = 0; i < 64; i++) {
    const g = path5.join(cur, ".git");
    let st = null;
    try {
      st = statSync4(g);
    } catch {
    }
    if (st) {
      if (st.isDirectory()) return { found: true, main: cur, worktree: false };
      try {
        const text = readFileSync4(g, "utf8").slice(0, 4096);
        const m = /^gitdir:\s*(.+)$/m.exec(text);
        if (m) {
          const gitdir = path5.resolve(cur, m[1].trim());
          const main2 = toPosix2(gitdir).replace(/\/\.git\/worktrees\/[^/]+\/?$/, "");
          if (main2 !== toPosix2(gitdir)) return { found: true, main: main2, worktree: true };
        }
      } catch {
      }
      return { found: true, main: null, worktree: false };
    }
    const up = path5.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return { found: false, main: null, worktree: false };
}
function resolveMainRoot(projectRoot) {
  const real = realOrSelf(projectRoot);
  const r = mainRepoOf(real);
  const main2 = r.worktree && r.main ? r.main : toPosix2(real);
  return { main: main2, roots: [.../* @__PURE__ */ new Set([main2, toPosix2(realOrSelf(main2)), toPosix2(projectRoot)])] };
}
function readSessionConfig(out) {
  var _a, _b;
  const file = path5.join(out, "config.json");
  let cfg = {};
  try {
    if (existsSync4(file)) cfg = JSON.parse(readFileSync4(file, "utf8"));
  } catch {
    cfg = {};
  }
  const orca = cfg && typeof cfg.orcaPaths === "object" && cfg.orcaPaths ? cfg.orcaPaths : {};
  const bots = ((_a = cfg == null ? void 0 : cfg.sessionAttribution) == null ? void 0 : _a.bots) && typeof cfg.sessionAttribution.bots === "object" ? cfg.sessionAttribution.bots : {};
  const str = (v, d) => typeof v === "string" && v ? v : d;
  return {
    enabled: ((_b = cfg == null ? void 0 : cfg.sessions) == null ? void 0 : _b.enabled) !== false,
    botsDir: toPosix2(path5.resolve(expandHome(str(orca.bots, "~/.orca/bots")))),
    workspacesDir: toPosix2(path5.resolve(expandHome(str(orca.workspaces, "~/orca/workspaces")))),
    // 봇 이름은 해시로만 비교한다. 값(저장소 경로)은 R과 같은지만 본다.
    botMap: Object.fromEntries(Object.entries(bots).filter(([, v]) => typeof v === "string").map(([k, v]) => [h16(k), toPosix2(realOrSelf(path5.resolve(expandHome(v))))]))
  };
}
var NCOL = 6;
var F_SIDE = 1;
var F_DEAD = 2;
var hex8 = (x) => x.toString(16).padStart(8, "0");
var ResponseStore = class {
  constructor() {
    this.ibits = 10;
    this.ipairs = new Uint32Array(2 << this.ibits);
    this.ivals = new Int32Array(1 << this.ibits).fill(-1);
    this.live = 0;
    this.khi = new Uint32Array(1024);
    this.klo = new Uint32Array(1024);
    this.num = new Float64Array(NCOL * 1024);
    this.meta = new Int32Array(3 * 1024);
    this.n = 0;
    this.strs = [];
    this.strId = /* @__PURE__ */ new Map();
    this.sorted = null;
    this.scratch = [0, 0, 0, 0, 0];
  }
  get size() {
    return this.live;
  }
  intern(s) {
    let id = this.strId.get(s);
    if (id === void 0) {
      id = this.strs.length;
      this.strs.push(s);
      this.strId.set(s, id);
    }
    return id;
  }
  islot(hi, lo) {
    const mask = (1 << this.ibits) - 1;
    let i = lo & mask;
    while (this.ivals[i] !== -1 && (this.ipairs[2 * i] !== hi || this.ipairs[2 * i + 1] !== lo)) i = i + 1 & mask;
    return i;
  }
  // 지운 슬롯(F_DEAD)도 자리는 남겨 탐사 사슬을 끊지 않는다.
  find(hi, lo) {
    const i = this.ivals[this.islot(hi, lo)];
    return i >= 0 && !(this.meta[i * 3 + 2] & F_DEAD) ? i : -1;
  }
  // 같은 키는 필드별 최댓값. 문자열 필드는 순서에 무관하게 최솟값으로 정해 증분·전체 결과를 같게 한다.
  merge(hi, lo, fresh, cw, w1, cr, out, model, session, side, t) {
    const at = this.islot(hi, lo);
    let i = this.ivals[at];
    if (i >= 0 && this.meta[i * 3 + 2] & F_DEAD) i = -1;
    if (i < 0) {
      i = this.n++;
      if (i * NCOL >= this.num.length) {
        const grow = (a) => {
          const b3 = new a.constructor(a.length * 2);
          b3.set(a);
          return b3;
        };
        this.num = grow(this.num);
        this.meta = grow(this.meta);
        this.khi = grow(this.khi);
        this.klo = grow(this.klo);
      }
      this.khi[i] = hi;
      this.klo[i] = lo;
      const b2 = i * NCOL;
      this.num[b2] = fresh;
      this.num[b2 + 1] = cw;
      this.num[b2 + 2] = w1;
      this.num[b2 + 3] = cr;
      this.num[b2 + 4] = out;
      this.num[b2 + 5] = t;
      this.meta[i * 3] = this.intern(model);
      this.meta[i * 3 + 1] = this.intern(session);
      this.meta[i * 3 + 2] = side ? F_SIDE : 0;
      this.ipairs[2 * at] = hi;
      this.ipairs[2 * at + 1] = lo;
      this.ivals[at] = i;
      this.live++;
      this.sorted = null;
      if (this.n > ((1 << this.ibits) - 1) * 0.7) this.rehash();
      return;
    }
    const b = i * NCOL;
    const nu = this.num;
    nu[b] = Math.max(nu[b], fresh);
    nu[b + 1] = Math.max(nu[b + 1], cw);
    nu[b + 2] = Math.max(nu[b + 2], w1);
    nu[b + 3] = Math.max(nu[b + 3], cr);
    nu[b + 4] = Math.max(nu[b + 4], out);
    nu[b + 5] = Math.max(nu[b + 5], t);
    if (compareCodeUnits(model, this.model(i)) < 0) this.meta[i * 3] = this.intern(model);
    if (compareCodeUnits(session, this.session(i)) < 0) this.meta[i * 3 + 1] = this.intern(session);
    if (!side) this.meta[i * 3 + 2] &= ~F_SIDE;
  }
  rehash() {
    this.ibits++;
    this.ipairs = new Uint32Array(2 << this.ibits);
    this.ivals = new Int32Array(1 << this.ibits).fill(-1);
    for (let i = 0; i < this.n; i++) {
      const at = this.islot(this.khi[i], this.klo[i]);
      this.ipairs[2 * at] = this.khi[i];
      this.ipairs[2 * at + 1] = this.klo[i];
      this.ivals[at] = i;
    }
  }
  remove(i) {
    this.meta[i * 3 + 2] |= F_DEAD;
    this.live--;
    this.sorted = null;
  }
  // 살아 있는 슬롯을 키 순서로. 결과는 바뀌기 전까지 재사용한다.
  slots() {
    if (!this.sorted) {
      const list = [];
      for (let i = 0; i < this.n; i++) if (!(this.meta[i * 3 + 2] & F_DEAD)) list.push(i);
      const { khi, klo } = this;
      list.sort((a, b) => khi[a] - khi[b] || klo[a] - klo[b]);
      this.sorted = list;
    }
    return this.sorted;
  }
  key(i) {
    return `${hex8(this.khi[i])}${hex8(this.klo[i])}`;
  }
  // [freshInput, cacheWrite5m, cacheWrite1h, cacheRead, output]. 응답마다 배열을 만들지 않도록 같은 배열을 다시 쓴다.
  // 호출자는 결과를 바로 쓰고 붙잡아 두지 않는다.
  vec(i) {
    const b = i * NCOL;
    const nu = this.num;
    const v = this.scratch;
    const w1 = Math.min(nu[b + 2], nu[b + 1]);
    v[0] = nu[b];
    v[1] = nu[b + 1] - w1;
    v[2] = w1;
    v[3] = nu[b + 3];
    v[4] = nu[b + 4];
    return v;
  }
  ctx(i) {
    const b = i * NCOL;
    return this.num[b] + this.num[b + 1] + this.num[b + 3];
  }
  t(i) {
    return this.num[i * NCOL + 5];
  }
  model(i) {
    return this.strs[this.meta[i * 3]];
  }
  session(i) {
    return this.strs[this.meta[i * 3 + 1]];
  }
  side(i) {
    return (this.meta[i * 3 + 2] & F_SIDE) !== 0;
  }
  row(i) {
    const b = i * NCOL;
    const nu = this.num;
    return [this.key(i), nu[b], nu[b + 1], nu[b + 2], nu[b + 3], nu[b + 4], this.model(i), this.session(i), this.side(i) ? 1 : 0, nu[b + 5]];
  }
};
var LE = endianness() === "LE";
var PairTable = class {
  constructor(bits = 10) {
    this.alloc(bits);
  }
  alloc(bits) {
    this.bits = bits;
    this.mask = (1 << bits) - 1;
    this.pairs = new Uint32Array(2 << bits);
    this.used = new Uint8Array(1 << bits);
    this.size = 0;
  }
  // 키는 이미 고르게 섞인 해시라 하위 비트를 그대로 자리로 쓴다(선형 탐사).
  slot(hi, lo) {
    let i = lo & this.mask;
    while (this.used[i] && (this.pairs[2 * i] !== hi || this.pairs[2 * i + 1] !== lo)) i = i + 1 & this.mask;
    return i;
  }
  has(hi, lo) {
    return this.used[this.slot(hi, lo)] === 1;
  }
  add(hi, lo) {
    const i = this.slot(hi, lo);
    if (this.used[i]) return false;
    this.used[i] = 1;
    this.pairs[2 * i] = hi;
    this.pairs[2 * i + 1] = lo;
    if (++this.size > this.mask * 0.7) this.grow();
    return true;
  }
  grow() {
    const { pairs, used } = this;
    this.alloc(this.bits + 1);
    for (let i = 0; i < used.length; i++) if (used[i]) this.add(pairs[2 * i], pairs[2 * i + 1]);
  }
  forEach(fn) {
    for (let i = 0; i < this.used.length; i++) if (this.used[i]) fn(this.pairs[2 * i], this.pairs[2 * i + 1]);
  }
  // 크기는 줄이지 않는다. 파일마다 새로 잡으면 typed array 할당이 쌓여 RSS가 는다.
  clear() {
    if (this.size) {
      this.used.fill(0);
      this.size = 0;
    }
  }
};
var hexPair = (hex) => [Number.parseInt(hex.slice(0, 8), 16), Number.parseInt(hex.slice(8, 16), 16)];
function hashPair(s) {
  let h1 = 3735928559;
  let h2 = 1103547991;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  return [h1 >>> 0, h2 >>> 0];
}
var KeySet = class _KeySet {
  constructor(sorted = new Uint32Array(0)) {
    this.sorted = sorted;
    this.added = new PairTable();
  }
  // 길이가 8의 배수이고 키가 엄격히 오름차순이어야 한다. 아니면 손상으로 보고 던진다(호출자가 상태를 다시 만든다).
  static fromBuffer(buf) {
    if (buf.length % 8 !== 0) throw new Error("key file length");
    const a = new Uint32Array(buf.length / 4);
    for (let i = 0; i < a.length; i++) a[i] = buf.readUInt32BE(i * 4);
    for (let i = 2; i < a.length; i += 2) {
      if (a[i] < a[i - 2] || a[i] === a[i - 2] && a[i + 1] <= a[i - 1]) throw new Error("key file order");
    }
    return new _KeySet(a);
  }
  get size() {
    return this.sorted.length / 2 + this.added.size;
  }
  has(hi, lo) {
    if (this.added.has(hi, lo)) return true;
    const a = this.sorted;
    let l = 0;
    let r = a.length / 2 - 1;
    while (l <= r) {
      const m = l + r >>> 1;
      const h = a[m * 2];
      const x = a[m * 2 + 1];
      if (h === hi && x === lo) return true;
      if (h < hi || h === hi && x < lo) l = m + 1;
      else r = m - 1;
    }
    return false;
  }
  add(hi, lo) {
    if (!this.has(hi, lo)) this.added.add(hi, lo);
  }
  // 정렬된 키를 큰 끝(big-endian) 8바이트씩 쓴다. 새 키는 64비트 값으로 보고 BigUint64Array.sort로 정렬한다.
  toBuffer() {
    const extra = new Uint32Array(this.added.size * 2);
    let k = 0;
    this.added.forEach((hi, lo) => {
      if (LE) {
        extra[k] = lo;
        extra[k + 1] = hi;
      } else {
        extra[k] = hi;
        extra[k + 1] = lo;
      }
      k += 2;
    });
    new BigUint64Array(extra.buffer).sort();
    const H = LE ? 1 : 0;
    const L = 1 - H;
    const a = this.sorted;
    const out = Buffer.allocUnsafe(a.length * 4 + extra.length * 4);
    let i = 0;
    let j = 0;
    let o = 0;
    const put = (hi, lo) => {
      out.writeUInt32BE(hi, o);
      out.writeUInt32BE(lo, o + 4);
      o += 8;
    };
    while (i < a.length || j < extra.length) {
      const takeA = j >= extra.length || i < a.length && (a[i] < extra[j + H] || a[i] === extra[j + H] && a[i + 1] < extra[j + L]);
      if (takeA) {
        put(a[i], a[i + 1]);
        i += 2;
      } else {
        put(extra[j + H], extra[j + L]);
        j += 2;
      }
    }
    return out;
  }
};
function emptyState(rootHash) {
  return {
    parserVersion: SESSION_PARSER_VERSION,
    rootPathHash: rootHash,
    files: {},
    attribution: {},
    responses: new ResponseStore(),
    archive: { days: {}, responses: 0 },
    archivedKeys: new KeySet(),
    events: new KeySet()
  };
}
function stateDir(out) {
  return path5.join(out, "sessions");
}
function forEachLine(file, fn) {
  const fd = openSync2(file, "r");
  try {
    const buf = Buffer.allocUnsafe(CHUNK);
    let carry = "";
    let pos = 0;
    for (; ; ) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      pos += n;
      const text = carry + buf.toString("utf8", 0, n);
      const parts = text.split("\n");
      carry = parts.pop();
      for (const l of parts) if (l) fn(l);
    }
    if (carry) fn(carry);
  } finally {
    closeSync2(fd);
  }
}
function loadState(dir, rootHash) {
  try {
    if (!existsSync4(path5.join(dir, "cursor.json"))) return { state: emptyState(rootHash), had: false };
    const cursor = JSON.parse(readFileSync4(path5.join(dir, "cursor.json"), "utf8"));
    if (cursor.parserVersion !== SESSION_PARSER_VERSION || cursor.rootPathHash !== rootHash) return { state: emptyState(rootHash), had: false, reset: true };
    const state = emptyState(rootHash);
    const rdir = path5.join(dir, "responses");
    if (existsSync4(rdir)) {
      for (const f of readdirSync4(rdir).sort(compareCodeUnits)) {
        if (!f.endsWith(".jsonl")) continue;
        forEachLine(path5.join(rdir, f), (l) => {
          const [k, fresh, cw, w1, cr, out, model, session, side, t] = JSON.parse(l);
          if (typeof k !== "string" || !/^[0-9a-f]{16}$/.test(k)) throw new Error("response key");
          const [hi, lo] = hexPair(k);
          state.responses.merge(hi, lo, fresh, cw, w1, cr, out, model, session, side === 1, t);
        });
      }
    }
    const read = (f, d) => existsSync4(path5.join(dir, f)) ? JSON.parse(readFileSync4(path5.join(dir, f), "utf8")) : d;
    const keys = (f) => {
      var _a;
      const meta = (_a = cursor.keyFiles) == null ? void 0 : _a[f];
      if (!meta) throw new Error(`missing ${f} metadata`);
      const buf = existsSync4(path5.join(dir, f)) ? readFileSync4(path5.join(dir, f)) : Buffer.alloc(0);
      if (buf.length !== meta.count * 8 || bufHash(buf) !== meta.hash) throw new Error(`${f} mismatch`);
      return KeySet.fromBuffer(buf);
    };
    Object.assign(state, {
      files: cursor.files ?? {},
      attribution: read("attribution-cache.json", {}),
      archive: read("archive.json", { days: {}, responses: 0 }),
      archivedKeys: keys("archived-keys.bin"),
      events: keys("events.bin")
    });
    return { state, had: true };
  } catch {
    return { state: emptyState(rootHash), had: false, corrupted: true };
  }
}
var monthOf = (ms) => ms > 0 ? new Date(ms).toISOString().slice(0, 7) : "0000-00";
function writeState(dir, state) {
  rmSync2(dir, { recursive: true, force: true });
  mkdirSync2(path5.join(dir, "responses"), { recursive: true });
  const keyFiles = {};
  for (const [f, set] of [["archived-keys.bin", state.archivedKeys], ["events.bin", state.events]]) {
    const buf = set.toBuffer();
    atomicWrite(path5.join(dir, f), buf);
    keyFiles[f] = { count: buf.length / 8, hash: bufHash(buf) };
  }
  writeJson(path5.join(dir, "cursor.json"), { parserVersion: state.parserVersion, rootPathHash: state.rootPathHash, files: state.files, keyFiles });
  writeJson(path5.join(dir, "attribution-cache.json"), state.attribution);
  writeJson(path5.join(dir, "archive.json"), state.archive);
  const rs = state.responses;
  const months = /* @__PURE__ */ new Map();
  for (const i of rs.slots()) {
    const m = monthOf(rs.t(i));
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(i);
  }
  for (const [m, list] of months) {
    const file = path5.join(dir, "responses", `${m}.jsonl`);
    const fd = openSync2(file, "w");
    try {
      for (let s = 0; s < list.length; s += 2e3) {
        writeSync2(fd, `${list.slice(s, s + 2e3).map((i) => JSON.stringify(rs.row(i))).join("\n")}
`);
      }
    } finally {
      closeSync2(fd);
    }
  }
}
function promoteState(out, stagingDir) {
  if (!existsSync4(path5.join(stagingDir, "cursor.json"))) return false;
  const dir = stateDir(out);
  const old = `${dir}.old-${process.pid}`;
  rmSync2(old, { recursive: true, force: true });
  if (existsSync4(dir)) renameSync2(dir, old);
  try {
    renameSync2(stagingDir, dir);
  } catch (err) {
    if (existsSync4(old)) renameSync2(old, dir);
    throw err;
  }
  rmSync2(old, { recursive: true, force: true });
  return true;
}
function listTranscripts(projectsDir) {
  const out = [];
  let dirs;
  try {
    dirs = readdirSync4(projectsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const pdir = path5.join(projectsDir, d.name);
    let entries;
    try {
      entries = readdirSync4(pdir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ abs: path5.join(pdir, e.name), kind: "main" });
      else if (e.isDirectory() && e.name !== "memory") {
        const sdir = path5.join(pdir, e.name, "subagents");
        let subs;
        try {
          subs = readdirSync4(sdir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const s of subs) if (s.isFile() && /^agent-.+\.jsonl$/.test(s.name)) out.push({ abs: path5.join(sdir, s.name), kind: "subagent" });
      }
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.abs, b.abs));
}
var COUNTERS = [
  "lines",
  "skipped",
  "unknownType",
  "assistantLines",
  "synthetic",
  "apiError",
  "badUsage",
  "toolUse",
  "toolErrors",
  "recovered",
  "subToolUse",
  "subToolErrors",
  "humanPrompts",
  "compactions",
  "hookErrors",
  "hookBlocks",
  "apiRetries"
];
function newFileState(kind) {
  return {
    kind,
    gen: 0,
    inode: null,
    size: 0,
    mtimeMs: 0,
    offset: 0,
    fp: null,
    present: true,
    session: null,
    cwdHash: null,
    cls: null,
    botMention: false,
    versions: null,
    firstTs: null,
    lastTs: null,
    c: Object.fromEntries(COUNTERS.map((k) => [k, 0])),
    durations: [],
    gaps: [],
    openGap: null,
    pendingError: false,
    // 도구 분류별 [호출, 오류](메인+서브에이전트). openTools: 결과를 아직 못 본 tool_use(id 해시 → 분류).
    tools: {},
    openTools: {}
  };
}
function toolCategory(name) {
  if (typeof name !== "string") return "other";
  if (name.startsWith("mcp__")) return "mcp";
  return /^[A-Z][A-Za-z]{1,39}$/.test(name) ? name : "other";
}
function mentionsRoot(value, roots, depth = 0) {
  if (depth > 8 || value === null || value === void 0) return false;
  if (typeof value === "string") {
    for (const r of roots) {
      let i = value.indexOf(r);
      while (i !== -1) {
        const next = value[i + r.length];
        if (next === void 0 || !/[A-Za-z0-9._-]/.test(next)) return true;
        i = value.indexOf(r, i + 1);
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((v) => mentionsRoot(v, roots, depth + 1));
  if (typeof value === "object") return Object.values(value).some((v) => mentionsRoot(v, roots, depth + 1));
  return false;
}
var Parser = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.pending = new PairTable();
    this.lastSid = null;
    this.lastSidHash = null;
  }
  // 도구 호출·결과·프롬프트·시스템 이벤트를 전역으로 한 번만 센다(resume/fork 복사, 회전, 같은 줄 반복).
  // id가 없으면 구분할 수 없으니 센다.
  once(kind, id) {
    if (typeof id !== "string" || !id) return true;
    const [hi, lo] = hashPair(`${kind}:${id}`);
    if (this.pending.has(hi, lo) || this.state.events.has(hi, lo)) return false;
    this.pending.add(hi, lo);
    return true;
  }
  sid(raw) {
    if (raw !== this.lastSid) {
      this.lastSid = raw;
      this.lastSidHash = h16(raw);
    }
    return this.lastSidHash;
  }
  commit() {
    this.pending.forEach((hi, lo) => this.state.events.add(hi, lo));
    this.pending.clear();
  }
  classify(cwd) {
    const key = h16(cwd);
    const cached = this.state.attribution[key];
    if (cached) return { key, cls: cached };
    const { roots, cfg, mainRoot } = this.env;
    const p = toPosix2(cwd);
    const pr = toPosix2(realOrSelf(cwd));
    let cls = { kind: "none" };
    if (roots.some((r) => isUnder(p, r) || isUnder(pr, r))) cls = { kind: "direct" };
    else if (isUnder(p, cfg.botsDir)) {
      const bot = p.slice(cfg.botsDir.length + 1).split("/")[0];
      cls = bot ? { kind: "bot", bot: h16(bot) } : { kind: "none" };
    } else {
      const g = existsSync4(cwd) ? mainRepoOf(cwd) : { found: false };
      if (g.found) {
        if (g.worktree && g.main && roots.includes(toPosix2(realOrSelf(g.main)))) cls = { kind: "worktree" };
        else if (g.worktree && g.main && roots.includes(g.main)) cls = { kind: "worktree" };
      } else if (!existsSync4(cwd) && isUnder(p, cfg.workspacesDir)) {
        const repoName = p.slice(cfg.workspacesDir.length + 1).split("/")[0];
        if (repoName && repoName === path5.posix.basename(mainRoot)) cls = { kind: "inferred" };
      }
    }
    this.state.attribution[key] = cls;
    return { key, cls };
  }
  line(text, fs, fileHash) {
    const c = fs.c;
    c.lines++;
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      c.skipped++;
      return;
    }
    if (!o || typeof o !== "object" || Array.isArray(o) || typeof o.type !== "string") {
      c.skipped++;
      return;
    }
    if (!AGGREGATED.has(o.type)) {
      if (!KNOWN_IGNORED.has(o.type)) {
        c.unknownType++;
        c.skipped++;
      }
      return;
    }
    const version = safeLabel(o.version, VERSION_RE);
    if (version) {
      if (!fs.versions) fs.versions = [version, version];
      else if (version !== fs.versions[0] && version !== fs.versions[1]) {
        if (compareVersions(version, fs.versions[0]) < 0) fs.versions[0] = version;
        if (compareVersions(version, fs.versions[1]) > 0) fs.versions[1] = version;
      }
    }
    const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (fs.firstTs === null || ts < fs.firstTs) fs.firstTs = ts;
      if (fs.lastTs === null || ts > fs.lastTs) fs.lastTs = ts;
    }
    if (fs.session === null && typeof o.sessionId === "string" && o.sessionId) fs.session = this.sid(o.sessionId);
    if (fs.cls === null && typeof o.cwd === "string" && o.cwd && path5.isAbsolute(o.cwd)) {
      const { key, cls } = this.classify(o.cwd);
      fs.cwdHash = key;
      fs.cls = cls;
    }
    const side = fs.kind === "subagent" || o.isSidechain === true;
    if (o.type === "assistant") this.assistant(o, fs, fileHash, side, ts);
    else if (o.type === "user") this.user(o, fs, side);
    else if (!this.once(`${o.type}:${o.subtype ?? ""}`, o.uuid)) return;
    else if (o.type === "system") this.system(o, fs);
    else this.attachment(o, fs);
  }
  assistant(o, fs, fileHash, side, ts) {
    var _a, _b;
    const c = fs.c;
    const msg2 = o.message;
    if (!msg2 || typeof msg2 !== "object") {
      c.skipped++;
      return;
    }
    c.assistantLines++;
    if (msg2.model === "<synthetic>") {
      c.synthetic++;
      return;
    }
    if (o.isApiErrorMessage === true) {
      c.apiError++;
      return;
    }
    if (Array.isArray(msg2.content)) {
      for (const b of msg2.content) {
        if (!b || b.type !== "tool_use") continue;
        if (!fs.botMention && ((_a = fs.cls) == null ? void 0 : _a.kind) === "bot" && mentionsRoot(b.input, this.env.roots)) fs.botMention = true;
        if (!this.once("tool_use", b.id)) continue;
        const cat = toolCategory(b.name);
        ((_b = fs.tools)[cat] ?? (_b[cat] = [0, 0]))[0]++;
        if (typeof b.id === "string" && b.id) fs.openTools[h16(b.id)] = cat;
        if (side) c.subToolUse++;
        else {
          c.toolUse++;
          if (fs.openGap !== null) fs.openGap++;
        }
      }
    }
    const u = msg2.usage;
    if (!u || typeof u !== "object") return;
    const fresh = u.input_tokens;
    const cw = u.cache_creation_input_tokens;
    const cr = u.cache_read_input_tokens;
    const out = u.output_tokens;
    if (![fresh, cw, cr, out].every(isInt)) {
      c.badUsage++;
      return;
    }
    const w1 = u.cache_creation && typeof u.cache_creation === "object" && isInt(u.cache_creation.ephemeral_1h_input_tokens) ? u.cache_creation.ephemeral_1h_input_tokens : 0;
    const rawKey = typeof msg2.id === "string" && msg2.id || typeof o.requestId === "string" && o.requestId || `${fileHash}#${o.uuid ?? c.lines}`;
    const [hi, lo] = hashPair(rawKey);
    if (this.state.archivedKeys.has(hi, lo)) return;
    const model = safeLabel(msg2.model, MODEL_RE) ?? "unknown";
    const session = typeof o.sessionId === "string" && o.sessionId ? this.sid(o.sessionId) : fs.session ?? `f:${fileHash}`;
    this.state.responses.merge(hi, lo, fresh, cw, w1, cr, out, model, session, side, Number.isFinite(ts) ? ts : 0);
  }
  user(o, fs, side) {
    var _a;
    const c = fs.c;
    const content = o.message && typeof o.message === "object" ? o.message.content : void 0;
    let hasResult = false;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (!b || b.type !== "tool_result") continue;
        hasResult = true;
        if (!this.once("tool_result", b.tool_use_id)) continue;
        const idh = typeof b.tool_use_id === "string" && b.tool_use_id ? h16(b.tool_use_id) : null;
        const cat = (idh && fs.openTools[idh]) ?? "unknown";
        if (idh) delete fs.openTools[idh];
        if (b.is_error === true) ((_a = fs.tools)[cat] ?? (_a[cat] = [0, 0]))[1]++;
        if (side) {
          if (b.is_error === true) c.subToolErrors++;
          continue;
        }
        if (b.is_error === true) {
          c.toolErrors++;
          fs.pendingError = true;
        } else if (fs.pendingError) {
          c.recovered++;
          fs.pendingError = false;
        }
      }
    }
    if (side) return;
    let human;
    if (o.origin && typeof o.origin === "object") human = o.origin.kind === "human";
    else human = o.isMeta !== true && !hasResult && (typeof content === "string" || Array.isArray(content) && content.some((b) => b && b.type === "text"));
    if (!human || !this.once("human", o.uuid)) return;
    c.humanPrompts++;
    if (fs.openGap !== null) fs.gaps.push(fs.openGap);
    fs.openGap = 0;
  }
  system(o, fs) {
    const c = fs.c;
    if (o.subtype === "turn_duration" && isInt(o.durationMs)) fs.durations.push(o.durationMs);
    else if (o.subtype === "compact_boundary") c.compactions++;
    else if (o.subtype === "api_error") c.apiRetries++;
    else if (o.subtype === "stop_hook_summary" && Array.isArray(o.hookErrors)) c.hookErrors += o.hookErrors.length;
  }
  attachment(o, fs) {
    const a = o.attachment;
    if (!a || typeof a !== "object" || typeof a.type !== "string") return;
    if (a.type === "hook_non_blocking_error") fs.c.hookErrors++;
    else if (/^hook_.*blocking_error$/.test(a.type)) fs.c.hookBlocks++;
    else if (a.type.startsWith("hook_") && Number.isInteger(a.exitCode) && a.exitCode !== 0) fs.c.hookErrors++;
  }
};
var PEEK_LIMIT = 256 * 1024;
function ignoredByPeek(buf) {
  const m = /^\s*\{\s*"type"\s*:\s*"([^"]{1,40})"/.exec(buf.subarray(0, 120).toString("latin1"));
  return !!m && KNOWN_IGNORED.has(m[1]);
}
function readFrom(abs, fs, size, parser, fileHash) {
  const fd = openSync2(abs, "r");
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
      for (; ; ) {
        const idx = buf.indexOf(10, start);
        if (idx === -1 || idx >= n) break;
        if (skipping) {
          fs.c.lines++;
          fs.c.skipped++;
          skipping = false;
        } else {
          const part = buf.subarray(start, idx);
          const head = carryLen ? carry[0] : part;
          if (carryLen + part.length > PEEK_LIMIT && ignoredByPeek(head)) {
            fs.c.lines++;
          } else {
            const text = carryLen ? Buffer.concat([...carry, part]).toString("utf8") : part.toString("utf8");
            if (text.trim()) parser.line(text, fs, fileHash);
          }
        }
        carry = [];
        carryLen = 0;
        start = idx + 1;
        fs.offset = pos + start;
      }
      if (start < n && !skipping) {
        carryLen += n - start;
        if (carryLen > MAX_LINE_BYTES) {
          skipping = true;
          carry = [];
          carryLen = 0;
        } else carry.push(Buffer.from(buf.subarray(start, n)));
      }
      pos += n;
    }
    fs.fp = fingerprint(fd, fs.offset);
  } finally {
    closeSync2(fd);
  }
}
var FP_BYTES = 4096;
function fingerprint(fd, offset) {
  if (!offset) return null;
  const part = (from, len2) => {
    const b = Buffer.alloc(len2);
    const n = readSync(fd, b, 0, len2, from);
    return h16(b.subarray(0, n).toString("latin1"));
  };
  const len = Math.min(FP_BYTES, offset);
  return `${part(0, len)}:${part(offset - len, len)}`;
}
function prefixIntact(abs, fs, size) {
  if (size < fs.offset) return false;
  if (!fs.offset) return true;
  const fd = openSync2(abs, "r");
  try {
    return fingerprint(fd, fs.offset) === fs.fp;
  } finally {
    closeSync2(fd);
  }
}
function scanTranscripts({ configDir, state, env, fullRescan, log }) {
  var _a;
  const list = listTranscripts(path5.join(configDir, "projects"));
  if (list === null) return { projectsDir: false, present: 0, unreadable: 0 };
  const parser = new Parser(state, env);
  const seen = /* @__PURE__ */ new Set();
  let unreadable = 0;
  let done = 0;
  const firstRun = !Object.keys(state.files).length;
  for (const f of list) {
    const fh = h16(toPosix2(f.abs));
    seen.add(fh);
    let st;
    try {
      st = statSync4(f.abs);
    } catch {
      unreadable++;
      continue;
    }
    const prev = fullRescan ? void 0 : state.files[fh];
    if (prev && st.ino === prev.inode && st.size === prev.size && st.mtimeMs === prev.mtimeMs) {
      prev.present = true;
      continue;
    }
    let fs;
    let retire = false;
    if (!prev) fs = newFileState(f.kind);
    else {
      try {
        retire = !prefixIntact(f.abs, prev, st.size);
      } catch {
        unreadable++;
        continue;
      }
      if (retire) {
        fs = newFileState(f.kind);
        fs.gen = prev.gen + 1;
      } else fs = JSON.parse(JSON.stringify(prev));
    }
    try {
      readFrom(f.abs, fs, st.size, parser, fh);
    } catch {
      unreadable++;
      parser.pending.clear();
      continue;
    }
    parser.commit();
    if (retire) {
      const retiredKey = `${fh}~g${h16(prev.session ?? "unknown-session")}`;
      const old = state.files[retiredKey];
      const retired = { ...prev, present: false };
      if (old) {
        for (const k of COUNTERS) retired.c[k] += old.c[k];
        retired.durations = [...old.durations, ...retired.durations];
        retired.gaps = [...old.gaps, ...retired.gaps];
        const first = [old.firstTs, retired.firstTs].filter((t) => t !== null);
        const last = [old.lastTs, retired.lastTs].filter((t) => t !== null);
        retired.firstTs = first.length ? Math.min(...first) : null;
        retired.lastTs = last.length ? Math.max(...last) : null;
        retired.cls ?? (retired.cls = old.cls);
        retired.botMention || (retired.botMention = old.botMention);
        if (old.versions) retired.versions = retired.versions ? [compareVersions(old.versions[0], retired.versions[0]) < 0 ? old.versions[0] : retired.versions[0], compareVersions(old.versions[1], retired.versions[1]) > 0 ? old.versions[1] : retired.versions[1]] : old.versions;
        for (const [tool, counts] of Object.entries(old.tools)) {
          (_a = retired.tools)[tool] ?? (_a[tool] = [0, 0]);
          retired.tools[tool][0] += counts[0];
          retired.tools[tool][1] += counts[1];
        }
      }
      state.files[retiredKey] = retired;
    }
    fs.inode = st.ino;
    fs.size = st.size;
    fs.mtimeMs = st.mtimeMs;
    fs.present = true;
    state.files[fh] = fs;
    done++;
    if (firstRun && log && done % 200 === 0) log(`Harness Lens: 세션 기록 ${done}/${list.length}개 파일 읽음…`);
  }
  for (const [fh, fs] of Object.entries(state.files)) if (!seen.has(fh)) fs.present = false;
  return { projectsDir: true, present: list.length - unreadable, unreadable };
}

// src/session-metrics.mjs
var LOCATIONS = ["direct", "worker", "subagent", "bot"];
var EXCLUDED = "excluded";
var METHODS = ["direct", "worktree", "inferred", "configured", "auto"];
var r4 = (x) => roundHalfEven(x, 4);
var r1 = (x) => roundHalfEven(x, 1);
var dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);
function quantile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
var sortNum = (a) => Float64Array.from(a).sort();
var zero5 = () => [0, 0, 0, 0, 0];
function add5(t, v) {
  for (let i = 0; i < 5; i++) t[i] += v[i];
}
function resolveAttribution(state, env) {
  const sessions = /* @__PURE__ */ new Map();
  const subagents = [];
  for (const fh of Object.keys(state.files).sort(compareCodeUnits)) {
    const fs = state.files[fh];
    const key = fs.session ?? `f:${fh}`;
    if (fs.kind === "subagent") {
      subagents.push([fh, fs, key]);
      continue;
    }
    let s = sessions.get(key);
    if (!s) {
      s = { files: [], cls: null, botMention: false };
      sessions.set(key, s);
    }
    s.files.push(fh);
    if (!s.cls && fs.cls) s.cls = fs.cls;
    s.botMention = s.botMention || fs.botMention;
  }
  const decide = (cls, botMention) => {
    if (!cls) return { location: null, method: null, bot: false };
    if (cls.kind === "direct") return { location: "direct", method: "direct", bot: false };
    if (cls.kind === "worktree") return { location: "worker", method: "worktree", bot: false };
    if (cls.kind === "inferred") return { location: "worker", method: "inferred", bot: false };
    if (cls.kind === "bot") {
      const mapped = env.cfg.botMap[cls.bot];
      if (mapped !== void 0) return env.roots.includes(mapped) ? { location: "bot", method: "configured", bot: true } : { location: null, method: null, bot: true, excluded: true };
      return botMention ? { location: "bot", method: "auto", bot: true } : { location: null, method: null, bot: true };
    }
    return { location: null, method: null, bot: false, excluded: true };
  };
  for (const s of sessions.values()) Object.assign(s, decide(s.cls, s.botMention));
  const subs = /* @__PURE__ */ new Map();
  for (const [fh, fs, key] of subagents) {
    const parent = sessions.get(key);
    const d = parent ?? decide(fs.cls, fs.botMention);
    subs.set(fh, { key, parentLocation: d.location, method: d.method, bot: d.bot, excluded: !!d.excluded });
  }
  return { sessions, subs };
}
function responseLocation(rs, i, attr) {
  const sk = rs.session(i);
  const s = attr.sessions.get(sk);
  const parentLoc = s ? s.excluded ? EXCLUDED : s.location : attr.subBySession.get(sk) ?? null;
  if (!parentLoc || parentLoc === EXCLUDED) return parentLoc;
  return rs.side(i) ? "subagent" : parentLoc;
}
function pruneResponses(state, env, nowMs) {
  var _a, _b, _c;
  const cutoff = nowMs - RESPONSE_RETENTION_DAYS * DAY_MS;
  const attr = withSubIndex(resolveAttribution(state, env));
  const rs = state.responses;
  const old = rs.slots().filter((i) => {
    const t = rs.t(i);
    return t > 0 && t < cutoff;
  });
  const raw = /* @__PURE__ */ new Map();
  for (const i of old) {
    const day = dateOf(rs.t(i));
    const loc = responseLocation(rs, i, attr) ?? "unattributed";
    const d = (_a = state.archive.days)[day] ?? (_a[day] = { tokens: {}, ctx: null });
    if (loc !== EXCLUDED) add5((_b = d.tokens)[_c = `${loc}|${rs.model(i)}`] ?? (_b[_c] = zero5()), rs.vec(i));
    if (!rs.side(i) && (loc === "direct" || loc === "worker")) {
      if (!raw.has(day)) raw.set(day, []);
      raw.get(day).push(rs.ctx(i));
    }
    state.archive.responses++;
    state.archivedKeys.add(rs.khi[i], rs.klo[i]);
    rs.remove(i);
  }
  for (const day of [...raw.keys()].sort(compareCodeUnits)) {
    const s = sortNum(raw.get(day));
    const cur = { requests: s.length, p50: quantile(s, 0.5), max: s[s.length - 1] };
    const d = state.archive.days[day];
    d.ctx = d.ctx ? { requests: d.ctx.requests + cur.requests, p50: d.ctx.requests >= cur.requests ? d.ctx.p50 : cur.p50, max: Math.max(d.ctx.max, cur.max) } : cur;
  }
}
function withSubIndex(attr) {
  attr.subBySession = /* @__PURE__ */ new Map();
  for (const s of attr.subs.values()) if (!attr.sessions.has(s.key) && !attr.subBySession.has(s.key)) attr.subBySession.set(s.key, s.excluded ? EXCLUDED : s.parentLocation);
  return attr;
}
function bucketOut(parts) {
  const t = zero5();
  let units = 0;
  let unknown = false;
  for (const model of [...parts.keys()].sort(compareCodeUnits)) {
    const v = parts.get(model);
    add5(t, v);
    const u = weightedUnits(model, v);
    if (u === null) {
      if (v.some((x) => x > 0)) unknown = true;
    } else units += u;
  }
  return { bucket: { freshInput: t[0], cacheWrite: t[1] + t[2], cacheRead: t[3], output: t[4], weighted: r1(unitsToWeighted(units)) }, unknown, units };
}
function emptyBucket() {
  return { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 };
}
var BAND_RULES = {
  execution_stability: { ruleId: "ES-M-02", metric: "non_bash_tool_error_rate", band: (v) => v <= 0.02 ? 3 : v <= 0.05 ? 2 : v <= 0.1 ? 1 : 0 },
  throughput: { ruleId: "TP-M-01", metric: "turn_duration_p50_ms", band: (v) => v <= 3e4 ? 3 : v <= 9e4 ? 2 : v <= 3e5 ? 1 : 0 },
  context_efficiency: {
    ruleId: "CX-M-02",
    metric: "context_p90_window_ratio",
    band: (v, m) => {
      const b = v <= 0.25 ? 3 : v <= 0.5 ? 2 : v <= 0.75 ? 1 : 0;
      const cps = m.compactions_per_session;
      return cps !== void 0 && cps > 0.5 ? Math.min(b, 1) : b;
    }
  },
  autonomy: { ruleId: "AU-M-01", metric: "tool_calls_between_prompts_p50", band: (v) => v >= 20 ? 3 : v >= 8 ? 2 : v >= 3 ? 1 : 0 }
};
function summarize(state, env, { configSinceMs: configSinceMs2, incremental, scan }) {
  const files = Object.entries(state.files).sort((a, b) => compareCodeUnits(a[0], b[0]));
  const sum = (k) => files.reduce((s, [, f]) => s + f.c[k], 0);
  const latest = files.filter(([key]) => !key.includes("~g"));
  const linesRead = latest.reduce((s, [, f]) => s + f.c.lines, 0);
  const linesSkipped = latest.reduce((s, [, f]) => s + f.c.skipped, 0);
  const skippedRatio = linesRead ? r4(linesSkipped / linesRead) : 0;
  let vmin = null;
  let vmax = null;
  for (const [, f] of files) if (f.versions) {
    if (vmin === null || compareVersions(f.versions[0], vmin) < 0) vmin = f.versions[0];
    if (vmax === null || compareVersions(f.versions[1], vmax) > 0) vmax = f.versions[1];
  }
  const attr = withSubIndex(resolveAttribution(state, env));
  const mainSessions = [...attr.sessions.entries()].sort((a, b) => compareCodeUnits(a[0], b[0]));
  const attributed = mainSessions.filter(([, s]) => s.location);
  const unattributed = mainSessions.filter(([, s]) => !s.location && !s.excluded);
  const excluded = mainSessions.filter(([, s]) => s.excluded);
  const base = {
    status: "available",
    reason: null,
    clientVersions: vmin ? { min: vmin, max: vmax } : null,
    window: null,
    coverage: {
      filesScanned: scan.present,
      linesRead,
      linesSkipped,
      skippedRatio,
      sessionsAttributed: attributed.length,
      sessionsUnattributed: unattributed.length,
      sessionsExcluded: excluded.length,
      incremental,
      configSince: configSinceMs2 === null ? null : new Date(configSinceMs2).toISOString().replace(/\.\d+Z$/, "Z")
    },
    dedup: {
      assistantLines: sum("assistantLines"),
      uniqueResponses: state.responses.size + state.archive.responses,
      excludedSynthetic: sum("synthetic"),
      excludedApiError: sum("apiError")
    },
    tokens: null,
    contextPerTurn: null,
    axisMetrics: [],
    toolUsage: []
  };
  const info = { unknownModels: false, estimatedShare: 0, samples: {}, sinceSessions: 0 };
  const unavailable = (reason) => ({ sessions: { ...base, status: "unavailable", reason }, info });
  if (!files.length) return unavailable("no_session_logs");
  if (base.dedup.uniqueResponses === 0) return unavailable(sum("assistantLines") > 0 || linesRead > 0 ? "session_format_unsupported" : "no_session_logs");
  const byLocModel = new Map(LOCATIONS.map((l) => [l, /* @__PURE__ */ new Map()]));
  const unattrModel = /* @__PURE__ */ new Map();
  const ctxAll = [];
  const ctxByDay = /* @__PURE__ */ new Map();
  const firstBySession = /* @__PURE__ */ new Map();
  const addTo = (map, model, v) => {
    const t = map.get(model) ?? zero5();
    add5(t, v);
    map.set(model, t);
  };
  const rs = state.responses;
  const slots = rs.slots();
  let rawFrom = null;
  let rawTo = null;
  for (const i of slots) {
    const v = rs.vec(i);
    const model = rs.model(i);
    const loc = responseLocation(rs, i, attr);
    if (loc === EXCLUDED) continue;
    if (!loc) {
      addTo(unattrModel, model, v);
      continue;
    }
    addTo(byLocModel.get(loc), model, v);
    if (!rs.side(i) && (loc === "direct" || loc === "worker")) {
      const size = rs.ctx(i);
      const t = rs.t(i);
      ctxAll.push(size);
      if (t > 0) {
        const day = dateOf(t);
        if (rawFrom === null || day < rawFrom) rawFrom = day;
        if (rawTo === null || day > rawTo) rawTo = day;
        if (!ctxByDay.has(day)) ctxByDay.set(day, []);
        ctxByDay.get(day).push(size);
        const sk = rs.session(i);
        const f = firstBySession.get(sk);
        if (!f || t < f[0]) firstBySession.set(sk, [t, size]);
      }
    }
  }
  const archDays = Object.keys(state.archive.days).sort(compareCodeUnits);
  for (const day of archDays) {
    const d = state.archive.days[day];
    for (const key of Object.keys(d.tokens).sort(compareCodeUnits)) {
      const [loc, model] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
      if (loc === "unattributed") addTo(unattrModel, model, d.tokens[key]);
      else if (byLocModel.has(loc)) addTo(byLocModel.get(loc), model, d.tokens[key]);
    }
  }
  const locOut = LOCATIONS.map((l) => ({ l, ...bucketOut(byLocModel.get(l)) }));
  const allModels = /* @__PURE__ */ new Map();
  for (const l of LOCATIONS) for (const [m, v] of byLocModel.get(l)) addTo(allModels, m, v);
  const total = bucketOut(allModels);
  info.unknownModels = total.unknown || locOut.some((x) => x.unknown);
  const totalUnits = locOut.reduce((s, x) => s + x.units, 0);
  const sessCount = Object.fromEntries(LOCATIONS.map((l) => [l, 0]));
  const methodCount = Object.fromEntries(LOCATIONS.map((l) => [l, Object.fromEntries(METHODS.map((m) => [m, 0]))]));
  for (const [, s] of attributed) {
    sessCount[s.location]++;
    methodCount[s.location][s.method]++;
  }
  for (const s of attr.subs.values()) if (s.parentLocation) {
    sessCount.subagent++;
    methodCount.subagent[s.method]++;
  }
  {
    const est = /* @__PURE__ */ new Map();
    for (const i of slots) {
      const s = attr.sessions.get(rs.session(i));
      if (s && (s.method === "inferred" || s.method === "auto")) addTo(est, rs.model(i), rs.vec(i));
    }
    info.estimatedShare = totalUnits ? r4(bucketOut(est).units / totalUnits) : 0;
  }
  base.tokens = {
    weighting: { pricingTableVersion: PRICING_TABLE_VERSION, referenceModel: REFERENCE_MODEL, basis: "reference_model_fresh_input_equivalent" },
    total: total.bucket,
    byLocation: locOut.map((x) => ({
      location: x.l,
      sessions: sessCount[x.l],
      tokens: x.bucket,
      weightedShare: totalUnits ? r4(x.units / totalUnits) : 0,
      attribution: methodCount[x.l]
    })),
    unattributed: {
      sessions: unattributed.length,
      botSessions: unattributed.filter(([, s]) => s.bot).length,
      tokens: unattrModel.size ? bucketOut(unattrModel).bucket : emptyBucket()
    },
    byModel: [...allModels.keys()].sort(compareCodeUnits).map((m) => ({ model: m, tokens: bucketOut(/* @__PURE__ */ new Map([[m, allModels.get(m)]])).bucket }))
  };
  const ctxSorted = sortNum(ctxAll);
  const mainAttributedFiles = (pred) => files.filter(([fh, f]) => {
    if (f.kind !== "main") return false;
    const s = attr.sessions.get(f.session ?? `f:${fh}`);
    return s && (s.location === "direct" || s.location === "worker") && pred(s, f);
  });
  const workFiles = mainAttributedFiles(() => true);
  const series = [];
  for (const day of archDays) {
    const c = state.archive.days[day].ctx;
    if (c && !ctxByDay.has(day)) series.push({ date: day, ...c, source: "archive" });
  }
  for (const day of [...ctxByDay.keys()].sort(compareCodeUnits)) {
    const s = sortNum(ctxByDay.get(day));
    series.push({ date: day, requests: s.length, p50: quantile(s, 0.5), max: s[s.length - 1], source: "raw" });
  }
  series.sort((a, b) => compareCodeUnits(a.date, b.date));
  const raw = ctxSorted.length > 0;
  base.contextPerTurn = raw || series.length ? {
    requests: ctxSorted.length,
    p50: raw ? quantile(ctxSorted, 0.5) : null,
    p90: raw ? quantile(ctxSorted, 0.9) : null,
    max: raw ? ctxSorted[ctxSorted.length - 1] : null,
    firstRequestP50: raw ? quantile(sortNum([...firstBySession.values()].map((f) => f[1])), 0.5) ?? 0 : null,
    distribution: { from: rawFrom, to: rawTo, retentionDays: RESPONSE_RETENTION_DAYS },
    compactions: workFiles.reduce((s, [, f]) => s + f.c.compactions, 0),
    series: series.slice(-90)
  } : null;
  let fromMs = null;
  let toMs = null;
  for (const i of slots) {
    const t = rs.t(i);
    if (t <= 0) continue;
    if (fromMs === null || t < fromMs) fromMs = t;
    if (toMs === null || t > toMs) toMs = t;
  }
  const presentFirst = files.filter(([, f]) => f.present && f.firstTs !== null).map(([, f]) => f.firstTs);
  const from = archDays.length ? archDays[0] : fromMs !== null ? dateOf(fromMs) : null;
  if (from) base.window = { from, to: toMs !== null ? dateOf(toMs) : archDays[archDays.length - 1], rawLogsFrom: presentFirst.length ? dateOf(presentFirst.reduce((a, b) => Math.min(a, b))) : null };
  const since = (f) => configSinceMs2 === null || f.firstTs !== null && f.firstTs >= configSinceMs2;
  const sinceSessions = /* @__PURE__ */ new Map();
  for (const [fh, f] of workFiles) if (since(f)) {
    const key = f.session ?? `f:${fh}`;
    if (!sinceSessions.has(key)) sinceSessions.set(key, []);
    sinceSessions.get(key).push(f);
  }
  const sinceFiles = [...sinceSessions.values()].flat();
  const sinceSubs = files.filter(([fh, f]) => {
    var _a;
    return f.kind === "subagent" && sinceSessions.has((_a = attr.subs.get(fh)) == null ? void 0 : _a.key);
  });
  const n = sinceSessions.size;
  const fsum = (list, k) => list.reduce((s, f) => s + f.c[k], 0);
  const mainTool = fsum(sinceFiles, "toolUse");
  const subTool = fsum(sinceFiles, "subToolUse") + sinceSubs.reduce((s, [, f]) => s + f.c.subToolUse, 0);
  const allTool = mainTool + subTool;
  const allErr = fsum(sinceFiles, "toolErrors") + fsum(sinceFiles, "subToolErrors") + sinceSubs.reduce((s, [, f]) => s + f.c.subToolErrors, 0);
  const toolCats = /* @__PURE__ */ new Map();
  for (const f of [...sinceFiles, ...sinceSubs.map(([, x]) => x)]) {
    for (const [cat, [calls, errs]] of Object.entries(f.tools ?? {})) {
      const t = toolCats.get(cat) ?? [0, 0];
      t[0] += calls;
      t[1] += errs;
      toolCats.set(cat, t);
    }
  }
  const bash = toolCats.get("Bash") ?? [0, 0];
  let nbCalls = 0;
  let nbErr = 0;
  for (const [cat, [calls, errs]] of toolCats) if (cat !== "Bash") {
    nbCalls += calls;
    nbErr += errs;
  }
  const metrics = [];
  const push = (axis, metricId, value, unit, sampleSize, sinceConfig = configSinceMs2 !== null) => {
    if (sampleSize > 0 && Number.isFinite(value)) metrics.push({ axis, metricId, value, unit, sampleSize, sinceConfig });
  };
  push("execution_stability", "non_bash_tool_error_rate", nbCalls ? r4(nbErr / nbCalls) : NaN, "ratio", nbCalls);
  push("execution_stability", "bash_error_rate", bash[0] ? r4(bash[1] / bash[0]) : NaN, "ratio", bash[0]);
  push("execution_stability", "tool_error_rate", allTool ? r4(allErr / allTool) : NaN, "ratio", allTool);
  const mainErr = fsum(sinceFiles, "toolErrors");
  push("execution_stability", "tool_error_recovery_rate", mainErr ? r4(fsum(sinceFiles, "recovered") / mainErr) : NaN, "ratio", mainErr);
  push("execution_stability", "hook_errors_per_session", r4(fsum(sinceFiles, "hookErrors") / n), "per_session", n);
  push("execution_stability", "api_retries_per_session", r4(fsum(sinceFiles, "apiRetries") / n), "per_session", n);
  const durations = sortNum(sinceFiles.flatMap((f) => f.durations));
  push("throughput", "turn_duration_p50_ms", quantile(durations, 0.5), "ms", durations.length);
  const sessionDur = sortNum([...sinceSessions.values()].map((list) => {
    const a = list.map((f) => f.firstTs).filter((x) => x !== null);
    const b = list.map((f) => f.lastTs).filter((x) => x !== null);
    return a.length ? b.reduce((x, y) => Math.max(x, y)) - a.reduce((x, y) => Math.min(x, y)) : null;
  }).filter((x) => x !== null));
  push("throughput", "session_duration_p50_ms", quantile(sessionDur, 0.5), "ms", sessionDur.length);
  const sinceKeys = new Set(sinceSessions.keys());
  let crSum = 0;
  let inSum = 0;
  let respN = 0;
  const sinceCtx = [];
  const sinceRatio = [];
  const sinceWeight = /* @__PURE__ */ new Map();
  for (const i of slots) {
    if (!sinceKeys.has(rs.session(i))) continue;
    const v = rs.vec(i);
    respN++;
    crSum += v[3];
    inSum += rs.ctx(i);
    addTo(sinceWeight, rs.model(i), v);
    if (!rs.side(i)) {
      sinceCtx.push(rs.ctx(i));
      const win = contextWindow(rs.model(i));
      if (win) sinceRatio.push(rs.ctx(i) / win);
    }
  }
  push("cost_efficiency", "cache_hit_ratio", inSum ? r4(crSum / inSum) : NaN, "ratio", respN);
  push("cost_efficiency", "weighted_tokens_per_session", r1(bucketOut(sinceWeight).bucket.weighted / n), "tokens", n);
  const sc = sortNum(sinceCtx);
  const sr = sortNum(sinceRatio);
  push("context_efficiency", "context_p90_window_ratio", sr.length ? r4(quantile(sr, 0.9)) : NaN, "ratio", sr.length);
  push("context_efficiency", "context_p90_tokens", quantile(sc, 0.9), "tokens", sc.length);
  push("context_efficiency", "compactions_per_session", r4(fsum(sinceFiles, "compactions") / n), "per_session", n);
  const gaps = sortNum(sinceFiles.flatMap((f) => f.openGap !== null ? [...f.gaps, f.openGap] : f.gaps));
  push("autonomy", "tool_calls_between_prompts_p50", quantile(gaps, 0.5), "count", gaps.length);
  push("autonomy", "human_prompts_per_session", r4(fsum(sinceFiles, "humanPrompts") / n), "per_session", n);
  push("verification_gate_strength", "hook_blocks_per_session", r4(fsum(sinceFiles, "hookBlocks") / n), "per_session", n);
  for (const l of ["bot", "worker"]) {
    const x = base.tokens.byLocation.find((b) => b.location === l);
    push("cost_efficiency", `${l}_weighted_share`, x.weightedShare, "ratio", x.sessions, false);
  }
  base.axisMetrics = metrics;
  base.toolUsage = [...toolCats.keys()].sort(compareCodeUnits).map((tool) => ({ tool, calls: toolCats.get(tool)[0], errors: toolCats.get(tool)[1] }));
  info.samples = { sessions: n, tool_calls_all: allTool, tool_calls_non_bash: nbCalls, tool_calls_main: mainTool };
  info.sinceSessions = n;
  if (skippedRatio > 0.05) {
    base.status = "partial";
    base.reason = "session_lines_skipped";
  }
  if (!attributed.length) base.reason = base.reason ?? "no_attributed_sessions";
  return { sessions: base, info };
}
function analysisWindowTokens(state, env, startMs, endMs) {
  const attr = withSubIndex(resolveAttribution(state, env));
  const parts = /* @__PURE__ */ new Map();
  let n = 0;
  const rs = state.responses;
  for (const i of rs.slots()) {
    const t = rs.t(i);
    if (rs.side(i) || t < startMs || t > endMs) continue;
    const loc = responseLocation(rs, i, attr);
    if (loc !== "direct" && loc !== "worker") continue;
    const p = parts.get(rs.model(i)) ?? zero5();
    add5(p, rs.vec(i));
    parts.set(rs.model(i), p);
    n++;
  }
  return n ? bucketOut(parts).bucket : null;
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
function computeMaturity(axes, sessions, info = {}) {
  const usable = sessions.status === "available" || sessions.status === "partial";
  const blocked = sessions.status === "disabled" ? "sessions_disabled" : sessions.reason ?? "no_session_logs";
  const samples = info.samples ?? {};
  const metric = (id) => sessions.axisMetrics.find((x) => x.metricId === id);
  for (const a of axes) {
    const m = MATURITY_RULES[a.axis];
    delete a._measurable;
    if (!m.measurable) {
      a.maturity = { state: "predicted", measurable: false, requirement: null, current: null, progress: null, blockedReason: m.blockedReason };
      continue;
    }
    const requirement = { unit: m.unit, required: m.required, heuristic: true };
    if (!usable) {
      a.maturity = { state: "predicted", measurable: true, requirement, current: null, progress: null, blockedReason: blocked };
      continue;
    }
    const current = m.unit === "sessions" ? samples.sessions ?? 0 : a.axis === "execution_stability" ? samples.tool_calls_non_bash ?? 0 : samples.tool_calls_main ?? 0;
    const progress = roundHalfEven(Math.min(1, current / m.required), 4);
    const rule = BAND_RULES[a.axis];
    const main2 = rule && metric(rule.metric);
    if (current < m.required || !main2) {
      a.maturity = { state: "predicted", measurable: true, requirement, current, progress, blockedReason: current < m.required ? "insufficient_samples" : "metric_unavailable" };
      continue;
    }
    const values = Object.fromEntries(sessions.axisMetrics.filter((x) => x.axis === a.axis).map((x) => [x.metricId, x.value]));
    const band = rule.band(main2.value, values);
    const used = [main2, ...a.axis === "context_efficiency" && metric("compactions_per_session") ? [metric("compactions_per_session")] : []];
    a.maturity = { state: "measured", measurable: true, requirement, current, progress, blockedReason: null };
    a.measured = {
      band,
      bandRuleId: rule.ruleId,
      heuristic: true,
      metrics: used.map((x) => ({ metricId: x.metricId, value: x.value, unit: x.unit })),
      predictedLevel: a.level,
      deltaFromPredicted: a.level === null ? null : band - a.level,
      sampleSize: current
    };
    const narrow = current >= 2 * m.required;
    a.range = {
      min: narrow ? band : Math.max(0, band - 1),
      max: narrow ? band : Math.min(3, band + 1),
      reasonCodes: narrow ? ["measured_band"] : ["measured_band", "sample_below_2x_requirement"]
    };
  }
  return axes;
}
function emptyAreaKind(a) {
  var _a;
  if (a.levelStatus === "unknown") return "unknown";
  if (a.levelStatus === "assessed" && a.level === 0 && ((_a = a.maturity) == null ? void 0 : _a.state) !== "measured") return "unconfigured";
  return null;
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

// src/session-aggregate.mjs
import path6 from "path";
var COUNTS0 = { filesScanned: 0, linesRead: 0, linesSkipped: 0, skippedRatio: 0, sessionsAttributed: 0, sessionsUnattributed: 0, sessionsExcluded: 0, incremental: false, configSince: null };
function emptySessions(status, reason) {
  return {
    status,
    reason,
    clientVersions: null,
    window: null,
    coverage: { ...COUNTS0 },
    dedup: { assistantLines: 0, uniqueResponses: 0, excludedSynthetic: 0, excludedApiError: 0 },
    tokens: null,
    contextPerTurn: null,
    axisMetrics: [],
    toolUsage: []
  };
}
var NO_INFO = { unknownModels: false, estimatedShare: 0, samples: {}, sinceSessions: 0 };
function aggregateSessions({ disabled = false, configDir, projectRoot, out, configSinceMs: configSinceMs2 = null, fullRescan = false, nowMs, log, stagingDir = null, previousWindow = null }) {
  if (disabled) return { sessions: emptySessions("disabled", null), info: NO_INFO, previousTokens: null };
  try {
    const cfg = readSessionConfig(out);
    if (!cfg.enabled) return { sessions: emptySessions("disabled", null), info: NO_INFO, previousTokens: null };
    const { main: main2, roots } = resolveMainRoot(projectRoot);
    const env = { roots, cfg, mainRoot: main2 };
    const loaded = fullRescan ? { state: loadState("", h16(main2)).state, had: false } : loadState(stateDir(out), h16(main2));
    const { state } = loaded;
    const scan = scanTranscripts({ configDir, state, env, fullRescan, log });
    pruneResponses(state, env, nowMs);
    const { sessions, info } = summarize(state, env, { configSinceMs: configSinceMs2, incremental: loaded.had && !fullRescan, scan });
    if (loaded.corrupted) info.stateCorrupted = true;
    if (loaded.reset) info.stateReset = true;
    if (scan.unreadable) info.unreadableFiles = scan.unreadable;
    if (stagingDir) writeState(stagingDir, state);
    const previousTokens = previousWindow && sessions.status !== "unavailable" ? analysisWindowTokens(state, env, previousWindow.startMs, previousWindow.endMs) : null;
    return { sessions, info, previousTokens };
  } catch (err) {
    if (process.env.HARNESS_LENS_DEBUG) process.stderr.write(`${err == null ? void 0 : err.stack}
`);
    return { sessions: emptySessions("unavailable", "session_aggregation_failed"), info: NO_INFO, previousTokens: null };
  }
}
var sessionsStagingDir = (runDirPath) => path6.join(runDirPath, "sessions.staging");

// src/validate.mjs
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "fs";
import path7 from "path";

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
      const kind = emptyAreaKind(a);
      if (kind) expected.set(a.axis, kind);
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
        if (m.state === "measured" && m.current < m.requirement.required) maturity.push(`${a.axis} 상태와 진행도 불일치`);
        if (m.state === "predicted" && m.current >= m.requirement.required && !m.blockedReason) maturity.push(`${a.axis} 상태와 진행도 불일치`);
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
      if (tokens.total.weighted > 0 ? Math.abs(share - 1) > 5e-3 : share !== 0) problems.push(`위치별 비중 합 ${share}`);
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
  function check(schema, value, path9) {
    if (schema === true) return [];
    if (schema === false) return [`${path9}: 허용되지 않는 값`];
    const errors = [];
    for (const key of Object.keys(schema)) {
      if (!ANNOTATIONS.has(key) && !SUPPORTED.has(key)) {
        throw new Error(`지원하지 않는 스키마 키워드 '${key}' (${path9})`);
      }
    }
    if (schema.$ref) errors.push(...check(resolve(schema.$ref), value, path9));
    if (schema.type !== void 0) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t2) => matchesType(value, t2))) {
        return [...errors, `${path9}: 타입 ${types.join("|")} 필요, 실제 ${typeOf(value)}`];
      }
    }
    if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
      errors.push(`${path9}: ${JSON.stringify(value)}는 enum ${JSON.stringify(schema.enum)}에 없음`);
    }
    if ("const" in schema && !deepEqual(schema.const, value)) {
      errors.push(`${path9}: const ${JSON.stringify(schema.const)} 필요`);
    }
    const t = typeOf(value);
    if (t === "string") {
      const len = [...value].length;
      if (schema.minLength !== void 0 && len < schema.minLength) errors.push(`${path9}: 길이 ${len} < ${schema.minLength}`);
      if (schema.maxLength !== void 0 && len > schema.maxLength) errors.push(`${path9}: 길이 ${len} > ${schema.maxLength}`);
      if (schema.pattern !== void 0 && !regex(schema.pattern).test(value)) errors.push(`${path9}: 패턴 ${schema.pattern} 불일치`);
      if (schema.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path9}: date-time 형식 아님`);
    }
    if (t === "integer" || t === "number") {
      if (schema.minimum !== void 0 && value < schema.minimum) errors.push(`${path9}: ${value} < ${schema.minimum}`);
      if (schema.maximum !== void 0 && value > schema.maximum) errors.push(`${path9}: ${value} > ${schema.maximum}`);
    }
    if (t === "array") {
      if (schema.minItems !== void 0 && value.length < schema.minItems) errors.push(`${path9}: 항목 ${value.length} < ${schema.minItems}`);
      if (schema.maxItems !== void 0 && value.length > schema.maxItems) errors.push(`${path9}: 항목 ${value.length} > ${schema.maxItems}`);
      if (schema.uniqueItems) {
        const seen = new Set(value.map((v) => JSON.stringify(canonical2(v))));
        if (seen.size !== value.length) errors.push(`${path9}: 중복 항목`);
      }
      const prefix = schema.prefixItems ?? [];
      prefix.forEach((s, i) => {
        if (i < value.length) errors.push(...check(s, value[i], `${path9}[${i}]`));
      });
      if (schema.items !== void 0) {
        for (let i = prefix.length; i < value.length; i++) errors.push(...check(schema.items, value[i], `${path9}[${i}]`));
      }
    }
    if (t === "object") {
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${path9}: 필수 속성 '${key}' 없음`);
      }
      const props = schema.properties ?? {};
      for (const [key, v] of Object.entries(value)) {
        if (key in props) errors.push(...check(props[key], v, `${path9}.${key}`));
        else if (schema.additionalProperties !== void 0) errors.push(...check(schema.additionalProperties, v, `${path9}.${key}`));
      }
    }
    for (const s of schema.allOf ?? []) errors.push(...check(s, value, path9));
    if (schema.anyOf && !schema.anyOf.some((s) => check(s, value, path9).length === 0)) {
      errors.push(`${path9}: anyOf 중 일치하는 스키마 없음`);
    }
    if (schema.oneOf && schema.oneOf.filter((s) => check(s, value, path9).length === 0).length !== 1) {
      errors.push(`${path9}: oneOf 중 정확히 하나가 일치해야 함`);
    }
    if (schema.not && check(schema.not, value, path9).length === 0) errors.push(`${path9}: not 조건 위반`);
    if (schema.if !== void 0) {
      const branch = check(schema.if, value, path9).length === 0 ? schema.then : schema.else;
      if (branch !== void 0) errors.push(...check(branch, value, path9));
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
  if (!existsSync5(path7.join(dir, "run.json"))) throw new EngineError(41, `run ${runId}이 없습니다.`);
  const run = readJson(path7.join(dir, "run.json"));
  const draft = readJson(path7.join(dir, "draft.json"));
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
  const interpFile = path7.join(dir, "interpretation.json");
  if (!existsSync5(interpFile)) {
    checks.push({ checkId: "V-SCHEMA", status: "fail", message: "interpretation.json이 없습니다." });
  } else {
    try {
      interpretation = JSON.parse(readFileSync5(interpFile, "utf8"));
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
  writeJson(path7.join(dir, "analysis.json"), analysis);
  writeJson(path7.join(dir, "validation.json"), validation);
  writeJson(path7.join(dir, "run.json"), { ...run, status: status === "valid" ? "validated" : "failed" });
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
      root = path8.resolve(this.opts.project);
    } else {
      let dir = process.cwd();
      for (; ; ) {
        if (existsSync6(path8.join(dir, ".git"))) {
          root = dir;
          break;
        }
        const up = path8.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    try {
      if (!root || !statSync5(root).isDirectory()) throw new Error("not dir");
      accessSync(root, fsc.R_OK);
    } catch {
      throw new EngineError(EXIT.NO_PROJECT, "프로젝트 루트를 찾을 수 없거나 읽을 수 없습니다. --project로 지정하세요.");
    }
    this._root = root;
    return root;
  }
  get out() {
    return path8.resolve(this.opts.out ?? path8.join(this.projectRoot, ".harness-lens"));
  }
  get scope() {
    return this.opts.scope ?? "project";
  }
  get configDir() {
    return path8.resolve(this.opts["config-dir"] ?? process.env.CLAUDE_CONFIG_DIR ?? path8.join(homedir4(), ".claude"));
  }
};
function checkRuntime(ctx) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < MIN_NODE_MAJOR) return { ok: false, code: "node_too_old", message: NODE_MESSAGE };
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) return { ok: false, code: "platform_unsupported", message: `지원하지 않는 플랫폼입니다: ${process.platform}` };
  let dir = ctx.out;
  while (!existsSync6(dir)) dir = path8.dirname(dir);
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
var SESSION_REASON = {
  no_session_logs: "세션 기록이 없습니다",
  session_format_unsupported: "세션 기록 형식을 해석하지 못했습니다(지원하지 않는 형식 또는 버전)",
  session_aggregation_failed: "세션 기록 집계 중 오류가 났습니다",
  no_attributed_sessions: "이 프로젝트에 귀속된 세션이 없습니다",
  session_lines_skipped: "해석하지 못한 줄이 5%를 넘었습니다"
};
function engineLimitations(col, ctx, sessions, info, extra = []) {
  var _a;
  const usable = sessions.status === "available" || sessions.status === "partial";
  const out = [];
  if (!usable || !sessions.coverage.sessionsAttributed) out.push({ code: "static_analysis_only", message: "정적 구성만 분석했습니다. 실제 성능·비용 절감을 확정하지 않으며 수준은 구조적 지원 수준입니다." });
  else out.push({ code: "session_measures_correlational", message: `세션 기록을 숫자로만 집계해 일부 축을 실측했습니다(귀속 세션 ${sessions.coverage.sessionsAttributed}개). 실측 대역의 임계값은 휴리스틱이고, 구성과 지표의 관계는 상관관계일 뿐 인과가 아닙니다.` });
  if (sessions.status === "disabled") out.push({ code: "sessions_disabled", message: "세션 기록 집계를 껐습니다(--no-sessions 또는 config.json). 모든 축이 구성 기반 예측입니다." });
  else if (!usable) out.push({ code: sessions.reason ?? "no_session_logs", message: `세션 기록 실측: ${SESSION_REASON[sessions.reason] ?? sessions.reason}. 모든 축이 구성 기반 예측이고 토큰 지표는 미확인입니다.` });
  else {
    if (sessions.status === "partial") out.push({ code: "session_lines_skipped", message: `세션 기록 줄의 ${(sessions.coverage.skippedRatio * 100).toFixed(1)}%를 해석하지 못해 건너뛰었습니다(모르는 레코드 타입 포함). 형식이 바뀌었을 수 있습니다.` });
    if (sessions.tokens) out.push({ code: "weighted_not_a_bill", message: `환산값은 공개 가격표(${sessions.tokens.weighting.pricingTableVersion}) 기준 ${sessions.tokens.weighting.referenceModel} 새 입력 토큰 환산 상대값이며 청구액이 아닙니다.` });
    if (info.unknownModels) out.push({ code: "unknown_model_pricing", message: "가격표에 없는 모델의 토큰은 환산값에서 뺐습니다(토큰 수에는 포함)." });
    if (sessions.coverage.sessionsUnattributed) out.push({ code: "unattributed_sessions", message: `귀속이 불확실한 세션 ${sessions.coverage.sessionsUnattributed}개(봇 ${((_a = sessions.tokens) == null ? void 0 : _a.unattributed.botSessions) ?? 0}개)는 합계에 넣지 않았습니다.` });
    if (sessions.coverage.sessionsExcluded) out.push({ code: "unrelated_sessions_excluded", message: `이 프로젝트와 무관한 세션 ${sessions.coverage.sessionsExcluded}개(다른 프로젝트 경로, 다른 저장소에 매핑된 봇)는 합계·미귀속 어디에도 넣지 않았습니다.` });
    if (info.estimatedShare > 0) out.push({ code: "estimated_attribution_included", message: `합계에 추정 귀속(삭제된 워크트리 추정·봇 자동 귀속) 환산값 ${(info.estimatedShare * 100).toFixed(1)}%가 포함돼 있습니다.` });
    if (info.unreadableFiles) out.push({ code: "session_files_unreadable", message: `세션 기록 파일 ${info.unreadableFiles}개를 읽지 못했습니다.` });
    if (info.stateCorrupted) out.push({ code: "session_state_rebuilt", message: "세션 누적 집계 파일이 손상돼 처음부터 다시 만들었습니다. 원본 기록이 정리된 구간은 빠졌을 수 있습니다." });
    if (info.stateReset) out.push({ code: "session_state_reset", message: "세션 파서 버전 또는 저장소가 바뀌어 누적 상태를 다시 만들었습니다. 구버전 archive는 재사용하지 않으며 원본 기록이 정리된 구간은 빠졌을 수 있습니다." });
  }
  if (ctx.scope === "project") {
    const unscoped = col.sources.filter((s) => s.reason === "user_scope_not_collected" || s.reason === "managed_settings_not_collected");
    out.push(unscoped.length ? { code: "user_scope_not_collected", message: `수집하지 않은 사용자·관리형 설정 파일 ${unscoped.length}개가 있습니다. 실제 유효 설정은 다를 수 있으며 가능 범위로 표시합니다.` } : { code: "user_scope_absent", message: "사용자·관리형 설정 파일이 없어 가능 범위를 프로젝트 근거로만 정했습니다(파일 존재만 확인하고 열지 않았습니다)." });
  }
  if (col.r8Hits > 0) out.push({ code: "instruction_targets_analyzer", message: `분석 도구를 겨냥한 것으로 보이는 지시문 ${col.r8Hits}곳을 발견했습니다. 원문은 남기지 않았고 데이터로만 취급했으며 수준 계산에 쓰지 않았습니다.` });
  if (col.plugins.length) out.push({ code: "plugin_contents_not_collected", message: `활성 플러그인 ${col.plugins.length}개의 내용(skills·agents·hooks)은 v0.1에서 수집하지 않았습니다.` });
  if (col.sources.some((s) => s.status === "unreadable")) out.push({ code: "source_unreadable", message: "읽지 못한 출처가 있어 일부 축은 판정 불가이거나 범위가 넓습니다." });
  if (col.sources.some((s) => s.status === "out_of_scope" && s.origin !== "user" && s.origin !== "managed")) out.push({ code: "source_out_of_scope", message: "수집 루트 밖을 가리키는 경로(심볼릭 링크·import 등)는 따라가지 않았습니다." });
  if (col.sources.some((s) => s.status === "skipped_sensitive")) out.push({ code: "sensitive_files_skipped", message: "민감한 이름의 파일(.env, 키 파일 등)은 열지 않았습니다." });
  return [...out, ...col.gateLimitations ?? [], ...extra];
}
function configSinceMs(ctx, col) {
  const nowMs = Date.parse(ctx.now);
  let best = null;
  for (const src of col.sources) {
    if (src.status !== "read" || src.origin !== "project_shared" && src.origin !== "project_local") continue;
    try {
      const m = Math.floor(statSync5(path8.join(ctx.projectRoot, src.path)).mtimeMs / 1e3) * 1e3;
      if (best === null || m > best) best = m;
    } catch {
    }
  }
  const idx = readIndex(ctx.out);
  let streak = null;
  for (let i = idx.length - 1; i >= 0 && idx[i].configurationHash === col.configurationHash; i--) streak = Date.parse(idx[i].analyzedAt);
  const cands = [best, streak].filter((x) => x !== null && Number.isFinite(x));
  return cands.length ? Math.min(nowMs, ...cands) : null;
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
      rootReal = realpathSync4(rootReal);
    } catch {
    }
    const meta = {
      snapshotId: runId,
      analyzedAt: ctx.now,
      analysisType: "static",
      scope: { preset: ctx.scope, sources: col.origins },
      configurationHash: col.configurationHash,
      project: { displayName: truncate(path8.basename(rootReal) || "project", 200), rootPathHash: sha256tag(rootReal.split(path8.sep).join("/")) },
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
var estimateTokens = (text) => Math.ceil(Buffer.byteLength(text, "utf8") / 4);
var serializeCompact = (obj) => `${JSON.stringify(obj)}
`;
function omitEmpty(v) {
  if (Array.isArray(v)) return v.map(omitEmpty);
  if (!v || typeof v !== "object") return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || x === void 0 || Array.isArray(x) && x.length === 0) continue;
    out[k] = omitEmpty(x);
  }
  return out;
}
function factRanks(evidence, axes) {
  const decisive = new Map(axes.map((a) => [a.axis, a.source.ruleId]));
  const level = (e) => Math.max(-1, ...e.ruleIds.map((r) => {
    var _a;
    return Number(((_a = /-L([0-3])-/.exec(r)) == null ? void 0 : _a[1]) ?? -1);
  }));
  const groups = /* @__PURE__ */ new Map();
  for (const e of evidence) {
    const k = e.primaryAxis ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const rank = /* @__PURE__ */ new Map();
  for (const list of groups.values()) {
    list.map((e) => [e, e.ruleIds.includes(decisive.get(e.primaryAxis)) ? 0 : 1, -level(e)]).sort((x, y) => x[1] - y[1] || x[2] - y[2] || compareCodeUnits(x[0].id, y[0].id)).forEach(([e], i) => rank.set(e.id, i));
  }
  return rank;
}
function compactInventory(draft, kbKeys) {
  const e = draft.engine;
  const sessions = { ...e.sessions, contextPerTurn: e.sessions.contextPerTurn && { ...e.sessions.contextPerTurn, series: void 0 } };
  if (sessions.tokens) sessions.tokens = { ...sessions.tokens, byModel: void 0 };
  const build = (factLimit) => {
    const rank = factLimit === null ? null : factRanks(e.evidence, e.axes);
    const evidence = e.evidence.map((ev) => rank && rank.get(ev.id) >= factLimit ? { ...ev, fact: void 0 } : ev);
    const omittedFacts = evidence.filter((ev) => ev.fact === void 0).length;
    return omitEmpty({
      schemaVersion: draft.schemaVersion,
      rubricVersion: draft.rubricVersion,
      meta: draft.meta,
      engine: {
        ...e,
        inventory: {
          ...e.inventory,
          components: e.inventory.components.map(({ contentHash, ...c }) => c),
          sources: e.inventory.sources.filter((src) => src.status !== "absent")
        },
        evidence,
        sessions,
        selfCost: { componentId: e.selfCost.componentId, alwaysLoadedTokens: e.selfCost.alwaysLoadedTokens }
      },
      knowledgeBaseKeys: kbKeys,
      compaction: { omitted: ["contentHash", "null_and_empty_array_keys"], factLimitPerAxis: factLimit, omittedFacts }
    });
  };
  const lossless = (compact) => {
    var _a, _b;
    const components = compact.engine.inventory.components ?? [];
    for (const c of components) if (c.name === ((_a = c.paths) == null ? void 0 : _a[0])) delete c.name;
    for (const a of compact.engine.axes) delete a.source.evidenceIds;
    const byId = new Map(components.map((c) => [c.id, c]));
    for (const ev of compact.engine.evidence ?? []) {
      const paths = (_b = byId.get(ev.componentId)) == null ? void 0 : _b.paths;
      if ((paths == null ? void 0 : paths.length) && ev.path === paths[0]) delete ev.path;
    }
    const readSourceRefs = [];
    const remainingSources = (compact.engine.inventory.sources ?? []).filter((src) => {
      if (src.status !== "read") return true;
      const ci = components.findIndex((c) => {
        var _a2;
        return c.origin === src.origin && ((_a2 = c.paths) == null ? void 0 : _a2.includes(src.path));
      });
      if (ci < 0) return true;
      readSourceRefs.push([ci, components[ci].paths.indexOf(src.path)]);
      return false;
    });
    if (remainingSources.length) compact.engine.inventory.sources = remainingSources;
    else delete compact.engine.inventory.sources;
    compact.compaction.omitted.push(
      "name_equal_first_path",
      "axis_source_evidenceIds",
      "evidence_path_equal_first_component_path",
      "read_sources_in_components"
    );
    if (readSourceRefs.length) compact.compaction.readSourceRefs = readSourceRefs;
    return compact;
  };
  const target = Math.floor(BUDGETS.llm_input_inventory_tokens.target * 0.9);
  let text = serializeCompact(build(null));
  if (estimateTokens(text) <= target) return text;
  text = serializeCompact(lossless(build(null)));
  if (estimateTokens(text) <= target) return text;
  const counts = /* @__PURE__ */ new Map();
  for (const ev of e.evidence) counts.set(ev.primaryAxis ?? "", (counts.get(ev.primaryAxis ?? "") ?? 0) + 1);
  for (let n = Math.max(1, ...counts.values()) - 1; n >= 1; n--) {
    text = serializeCompact(lossless(build(n)));
    if (estimateTokens(text) <= target) return text;
  }
  const lean = lossless(build(1));
  for (const c of lean.engine.inventory.components ?? []) {
    for (const key of ["command", "description", "headings"]) delete c.attributes[key];
  }
  lean.compaction.omitted.push("descriptive_component_attributes");
  return serializeCompact(lean);
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
      emptyAreas: axes.filter((a) => emptyAreaKind(a)).map((a) => ({ axis: a.axis, kind: emptyAreaKind(a), meaning: "", howToConfirm: "" }))
    },
    changeTradeoffs: comparison ? [] : null,
    limitations: []
  };
}
function previousAnalysis(prev, tokens) {
  var _a;
  const start = Date.parse(prev.meta.analyzedAt);
  const end = Date.parse(((_a = prev.validation) == null ? void 0 : _a.checkedAt) ?? prev.meta.analyzedAt);
  return {
    snapshotId: prev.meta.snapshotId,
    wallClockMs: Number.isFinite(end - start) && end >= start ? end - start : null,
    llmTokens: tokens,
    method: tokens ? "session_window" : "unknown"
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
    const prevId = latestSnapshotId(out);
    const prevSnap = prevId ? loadSnapshot(out, prevId) : null;
    const dir = runDir(out, c.runId);
    rmSync3(dir, { recursive: true, force: true });
    const agg = ctx.time("aggregate-sessions", () => {
      var _a;
      return aggregateSessions({
        disabled: !!ctx.opts["no-sessions"],
        configDir: ctx.configDir,
        projectRoot: ctx.projectRoot,
        out,
        configSinceMs: configSinceMs(ctx, c.col),
        fullRescan: !!ctx.opts["full-rescan"],
        nowMs: Date.parse(ctx.now),
        log: (m) => ctx.log(m),
        stagingDir: sessionsStagingDir(dir),
        previousWindow: prevSnap ? { startMs: Date.parse(prevSnap.meta.analyzedAt), endMs: Date.parse(((_a = prevSnap.validation) == null ? void 0 : _a.checkedAt) ?? prevSnap.meta.analyzedAt) } : null
      });
    });
    const { sessions } = agg;
    const axes = computeMaturity(c.axes, sessions, agg.info);
    if (sessions.status === "available" || sessions.status === "partial") c.meta.analysisType = "static_with_sessions";
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
        limitations: engineLimitations(c.col, ctx, sessions, agg.info)
      }
    };
    if (prevId) {
      ctx.log(`Harness Lens: 이전 스냅샷 ${prevId}과 비교 중…`);
      draft.engine.comparison = ctx.time("diff", () => diffAnalyses(prevSnap, draft));
    }
    const finishSelfCost = (inventoryTokens2) => {
      const prepareMs = Math.round(performance.now() - t0);
      const currentRun = [...ctx.timings, { subcommand: "prepare", durationMs: prepareMs, maxRssBytes: process.resourceUsage().maxRSS * 1024 }];
      draft.engine.selfCost = {
        componentId: c.col.selfComponentId,
        alwaysLoadedTokens: { value: c.col.selfAlwaysLoadedTokens, method: "estimate_utf8_bytes" },
        currentRun,
        previousAnalysis: prevSnap ? previousAnalysis(prevSnap, agg.previousTokens) : null,
        budgets: [
          budget("always_loaded_tokens", c.col.selfAlwaysLoadedTokens),
          budget("background_processes", 0),
          budget("reanalysis_engine_ms", prevId ? prepareMs : null),
          budget("engine_max_rss_bytes", Math.max(...currentRun.map((r) => r.maxRssBytes))),
          budget("llm_input_inventory_tokens", inventoryTokens2),
          budget("llm_tokens_per_analysis", agg.previousTokens ? agg.previousTokens.freshInput + agg.previousTokens.cacheWrite + agg.previousTokens.output : null)
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
    const compact = compactInventory(draft, c.kbKeys);
    const inventoryTokens = estimateTokens(compact);
    finishSelfCost(inventoryTokens);
    const { axes: _ignored, ...engineNoAxes } = draft.engine;
    writeJson(path8.join(dir, "inventory.json"), {
      meta: draft.meta,
      inventory: engineNoAxes.inventory,
      evidence: engineNoAxes.evidence,
      axes: draft.engine.axes.map(({ maturity, measured, ...a }) => a),
      tensionCandidates: draft.engine.tensionCandidates,
      limitations: draft.engine.limitations,
      knowledgeBaseKeys: c.kbKeys
    });
    writeJson(path8.join(dir, "sessions.json"), sessions);
    writeJson(path8.join(dir, "draft.json"), draft);
    atomicWrite(path8.join(dir, "inventory.compact.json"), compact);
    writeJson(path8.join(dir, "interpretation.template.json"), interpretationTemplate(axes, draft.engine.comparison));
    writeJson(path8.join(dir, "run.json"), {
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
      compactInventoryPath: path8.join(dir, "inventory.compact.json"),
      interpretationTemplatePath: path8.join(dir, "interpretation.template.json"),
      interpretationPath: path8.join(dir, "interpretation.json"),
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
  writeJson(path8.join(runDir(ctx.out, c.runId), "inventory.json"), {
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
  const file = path8.join(runDir(ctx.out, ctx.opts.run), "analysis.json");
  if (!existsSync6(file)) throw new EngineError(EXIT.NOT_FOUND, `run ${ctx.opts.run}의 analysis.json이 없습니다. validate를 먼저 실행하세요.`);
  const analysis = readJson(file);
  if (((_a = analysis.validation) == null ? void 0 : _a.status) !== "valid") throw new EngineError(EXIT.INVALID, "검증을 통과하지 못한 결과는 스냅샷으로 저장하지 않습니다.");
  const { value: safe } = rescanAndRedact(analysis);
  ctx.time("snapshot", () => commitSnapshot(ctx.out, safe));
  try {
    promoteState(ctx.out, sessionsStagingDir(runDir(ctx.out, ctx.opts.run)));
  } catch {
    ctx.log("경고: 세션 누적 집계를 확정하지 못했습니다. 다음 분석에서 같은 구간을 다시 읽습니다.");
  }
  const runFile = path8.join(runDir(ctx.out, ctx.opts.run), "run.json");
  if (existsSync6(runFile)) writeJson(runFile, { ...readJson(runFile), status: "snapshotted" });
  return { result: { ok: true, snapshotId: safe.meta.snapshotId, analysisPath: path8.join(snapshotDir(ctx.out, safe.meta.snapshotId), "analysis.json") } };
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
    atomicWrite(path8.join(snapshotDir(ctx.out, id), "report.html"), html);
    atomicWrite(path8.join(ctx.out, "report.html"), html);
  } catch {
    throw new EngineError(EXIT.RENDER, "리포트를 만들지 못했습니다. 스냅샷은 저장돼 있습니다.");
  }
  const reportPath = path8.join(ctx.out, "report.html");
  const opened = ctx.opts.open ? openInBrowser(reportPath) : false;
  return { result: { ok: true, snapshotId: id, reportPath, opened } };
}
function cmdFinalize(ctx) {
  const out = ctx.out;
  if (!existsSync6(out)) throw new EngineError(EXIT.NOT_FOUND, "결과 디렉터리가 없습니다. prepare를 먼저 실행하세요.");
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
    const dir = path8.join(ctx.out, "runs");
    const runs = existsSync6(dir) ? readdirSync5(dir).filter((d) => existsSync6(path8.join(dir, d, "draft.json"))).sort() : [];
    runId = runs[runs.length - 1];
  }
  const file = runId && path8.join(runDir(ctx.out, runId), "draft.json");
  if (!file || !existsSync6(file)) throw new EngineError(EXIT.NOT_FOUND, "비교할 run이 없습니다.");
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
  requireRuntime(ctx);
  const agg = ctx.time("aggregate-sessions", () => aggregateSessions({
    disabled: !!ctx.opts["no-sessions"],
    configDir: ctx.configDir,
    projectRoot: ctx.projectRoot,
    out: ctx.out,
    configSinceMs: null,
    fullRescan: !!ctx.opts["full-rescan"],
    nowMs: Date.parse(ctx.now),
    log: (m) => ctx.log(m)
  }));
  const s = agg.sessions;
  return { result: { ok: true, status: s.status, reason: s.reason, sessions: s } };
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
    else if (command === "diff" || command === "check-runtime" || command === "collect" || command === "aggregate-sessions") process.stdout.write(stableStringify(result));
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
        const file = path8.join(ctx.out, ctx.opts.run ? path8.join("runs", ctx.opts.run) : "", "error.json");
        if (existsSync6(path8.dirname(file))) {
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
