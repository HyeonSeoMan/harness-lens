// 읽기 전용 구성 수집기(engine-cli.md §4.2, §6). Hook·MCP·스크립트를 실행하지 않고 파일만 읽는다.
// 수집한 지시문은 실행할 명령이 아니라 분류할 데이터다(PRD §9).
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { MAX_IMPORT_DEPTH, SCRIPT_LIMIT_BYTES, TEXT_LIMIT_BYTES } from './constants.mjs';
import { displayPath, listDirInside, readTextInside, resolveInside, toPosix } from './fsguard.mjs';
import { parseFrontmatter } from './frontmatter.mjs';
import {
  AXIS_LABEL, REENTRY, SPEC_CMD, VERIFY_CMD, detectRole, hasAny, hasBlockMarker, narrativeAxes,
} from './lexicon.mjs';
import {
  RedactionCounter, isSensitiveFile, keepEnvValue, redactString, targetsAnalyzer, urlSchemeHost,
} from './redact.mjs';
import {
  compareTuples, componentId, evidenceId, hashInput, hashJson, sha256hex, sha256tag, truncate,
} from './util.mjs';

const ORIGIN_RANK = { managed: 0, project_local: 1, project_shared: 2, user: 3, plugin: 4 };
const HIGH_COST_TOOLS = new Set(['WebSearch', 'WebFetch', 'Task', 'Agent']);
const INTERPRETERS = new Set(['bash', 'sh', 'zsh', 'node', 'python', 'python3', 'deno', 'bun']);
const A_MODES = new Set(['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions']);
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'coverage']);
const CX_ENV = ['MAX_MCP_OUTPUT_TOKENS', 'BASH_MAX_OUTPUT_LENGTH', 'CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS'];
const CE_ENV = ['MAX_THINKING_TOKENS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_SUBAGENT_MODEL'];
const R8_PLACEHOLDER = '[분석 도구 겨냥 문구 제거]';
const GIT_HOOK_NAME = /^(?:applypatch-msg|pre-applypatch|post-applypatch|pre-commit|pre-merge-commit|prepare-commit-msg|commit-msg|post-commit|pre-rebase|post-checkout|post-merge|pre-push|pre-receive|update|proc-receive|post-receive|post-update|reference-transaction|push-to-checkout|pre-auto-gc|post-rewrite|sendemail-validate|fsmonitor-watchman|p4-changelist|p4-prepare-changelist|p4-post-changelist|p4-pre-submit|post-index-change)$/;

const pointer = (...parts) => parts.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

function managedSettingsPath(platform) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

// 명령 문자열을 공백 기준으로 나눈다(따옴표 한 겹만 처리).
function splitCommand(command) {
  const out = [];
  for (const m of command.matchAll(/(?:"[^"]*"|'[^']*'|[^\s"']+)+/g)) out.push(m[0].replace(/["']/g, ''));
  return out;
}

// Hook 명령에서 스크립트 경로를 찾는다. 인라인 명령이면 null(루브릭 §1.7 Hook 스크립트 해석).
export function hookScriptPath(command) {
  const tokens = splitCommand(command).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  let i = 0;
  if (tokens[0] && INTERPRETERS.has(path.basename(tokens[0]))) {
    i = 1;
    while (tokens[i] && tokens[i].startsWith('-')) i++;
  }
  const raw = tokens[i];
  if (!raw) return null;
  const sub = raw
    .replace(/\$\{CLAUDE_PROJECT_DIR\}|\$CLAUDE_PROJECT_DIR/g, '.')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, '.');
  if (!sub.includes('/') && !/\.(sh|bash|js|mjs|cjs|ts|py|rb)$/.test(sub)) return null;
  return sub;
}

// Hook 스크립트가 상대 경로로 불러오는 파일(루브릭 §1.7, 0.3). 1단계만 본다.
// 결과: [{ spec, names }] — names는 ESM 이름 import의 원래 이름 목록, 파일 전체를 쓰는 형태(require·기본·부작용·source)면 null.
const MAX_HOOK_IMPORTS = 16;
export function hookImports(text) {
  const out = [];
  // rootRel: $CLAUDE_PROJECT_DIR 기준 경로(출처 루트 기준). 그 외는 스크립트 위치 기준 상대 경로만 받는다.
  const add = (spec, names, rootRel = false) => {
    if (out.length >= MAX_HOOK_IMPORTS || /[$()`*?]/.test(spec) || (!rootRel && !/^\.{1,2}\//.test(spec))) return;
    if (!out.some((o) => o.spec === spec && o.rootRel === rootRel)) out.push({ spec, names, rootRel });
  };
  for (const m of text.matchAll(/\bimport\s*(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+[\w$]+)?\s*(?:from\s*)?["']([^"'\n]+)["']/g)) {
    const named = m[2] !== undefined && !m[1] ? m[2].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter((n) => /^[\w$]+$/.test(n)) : null;
    add(m[3], named);
  }
  for (const m of text.matchAll(/\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g)) add(m[1], null);
  for (const m of text.matchAll(/^\s*(?:source|\.)\s+["']?(\$\{?CLAUDE_PROJECT_DIR\}?\/)?([^"'\s;]+)/gm)) {
    if (m[1]) add(m[2], null, true);
    else add(/^\.{1,2}\//.test(m[2]) ? m[2] : `./${m[2]}`, null);
  }
  for (const m of text.matchAll(/^\s*from\s+\.([\w.]*)\s+import\b/gm)) if (m[1] && !m[1].includes('.')) add(`./${m[1]}.py`, null);
  return out;
}

// 불러온 파일에서 차단 표지가 있는 export 이름. 표지가 export 밖(최상위 실행 코드)에 있으면 '*'를 넣는다.
// 주석은 다음 export의 설명인 경우가 많아 앞 export에 붙지 않도록 지우고 본다.
export function blockingExports(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const marks = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?\s*([\w$]+)|(?:const|let|var|class)\s+([\w$]+))/gm;
  const starts = [...text.matchAll(marks)].map((m) => ({ at: m.index, name: m[1] ?? m[2] }));
  const names = new Set();
  if (hasBlockMarker(text.slice(0, starts.length ? starts[0].at : text.length))) names.add('*');
  starts.forEach((st, i) => {
    if (hasBlockMarker(text.slice(st.at, i + 1 < starts.length ? starts[i + 1].at : text.length))) names.add(st.name);
  });
  return names;
}

export class Collector {
  constructor({ projectRoot, scope, configDir, skillDir, platform = process.platform }) {
    this.projectRoot = projectRoot;
    this.scope = scope;
    this.configDir = configDir;
    this.skillDir = skillDir;
    this.platform = platform;
    this.counter = new RedactionCounter();
    this.sources = new Map();
    this.fileCache = new Map();
    this.hashEntries = new Map();
    this.components = new Map();
    this.evidence = new Map();
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
    try { json = JSON.parse(raw); } catch { return; }
    const walk = (v) => {
      if (typeof v === 'string') redactString(v, this.counter, { wholeValue: true });
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { redactString(k, this.counter); walk(x); });
    };
    walk(json);
  }

  // 화면·출력용 짧은 문자열: R3 → R8 → 길이 제한
  clean(text, max) {
    const s = String(text ?? '');
    if (targetsAnalyzer(s)) { this.r8Hits++; return R8_PLACEHOLDER; }
    return truncate(this.red(s).replace(/\s+/g, ' ').trim(), max) || '-';
  }

  addSource(disp, origin, status, reason = null) {
    const key = `${disp}|${origin}`;
    const prev = this.sources.get(key);
    if (prev && prev.status === 'read') return;
    this.sources.set(key, { path: disp, origin, status, reason });
  }

  // root 기준 rel 파일을 읽는다. R1·크기·경계 검사를 모두 거친다.
  // probe: 확장자 후보를 찾는 시도라 없는 파일은 출처로 남기지 않는다.
  readFile(root, rel, origin, limit = TEXT_LIMIT_BYTES, probe = false) {
    const abs = path.join(root, rel);
    const disp = displayPath(abs, this.projectRoot);
    const cacheKey = `${disp}|${origin}`;
    if (this.fileCache.has(cacheKey)) return this.fileCache.get(cacheKey);
    let result = null;
    if (isSensitiveFile(toPosix(rel))) {
      this.addSource(disp, origin, 'skipped_sensitive', 'sensitive_filename');
      result = { status: 'sensitive', disp };
    } else {
      const r = readTextInside(root, rel, limit);
      if (r.status === 'ok') {
        const raw = r.text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        this.addSource(disp, origin, 'read');
        this.hashEntries.set(disp, sha256hex(raw));
        // R3을 수집 직후 파일 단위로 적용한다. JSON은 구조가 깨지지 않게 파싱한 뒤 문자열 값마다 적용한다.
        const text = /\.json$/i.test(rel) ? raw : redactString(raw, this.counter);
        if (/\.json$/i.test(rel)) this.countJsonSecrets(raw);
        result = { text, raw, disp, status: 'ok' };
      } else if (r.status === 'absent') {
        if (probe) return { status: 'absent', disp };
        this.addSource(disp, origin, 'absent');
        result = { status: 'absent', disp };
      } else if (r.status === 'escape') {
        this.addSource(disp, origin, 'out_of_scope', 'outside_root_or_symlink_escape');
        result = { status: 'escape', disp };
      } else if (r.status === 'unsupported') {
        this.addSource(disp, origin, 'unsupported', r.reason);
        result = { status: 'unsupported', disp };
      } else {
        this.addSource(disp, origin, 'unreadable', 'read_error');
        this.hashEntries.set(disp, 'unreadable');
        result = { status: 'unreadable', disp };
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
      else if (typeof v === 'string') attrs[k] = truncate(v, 200);
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
      _tags: { ...tags, kind: comp.kind, origin: comp.origin, family },
    };
    this.evidence.set(id, ev);
    return ev;
  }

  // ---------- 지침 ----------
  collectInstructions(root, rel, origin, { alwaysLoaded, subdir = false, depth = 0, visited = new Set() }) {
    const f = this.readFile(root, rel, origin);
    if (!f || f.status !== 'ok' || visited.has(f.disp)) return;
    visited.add(f.disp);
    const lines = f.text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const headings = [];
    const imports = [];
    const perAxis = new Map();
    let fence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (targetsAnalyzer(line)) { this.r8Hits++; return; }
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (h && !fence && headings.length < 50) headings.push(truncate(this.red(h[1].trim()), 120));
      if (!fence) for (const m of line.matchAll(/(?:^|\s)@([~\w./-]+)/g)) if (/[./]/.test(m[1])) imports.push(m[1]);
      if (!alwaysLoaded) return;
      const axes = narrativeAxes(line);
      if (!axes.length) return;
      const [primary, ...rest] = axes;
      let rec = perAxis.get(primary);
      if (!rec) {
        rec = { line: i + 1, count: 0, excerpt: line.trim(), secondary: new Set() };
        perAxis.set(primary, rec);
      }
      rec.count++;
      rest.forEach((a) => rec.secondary.add(a));
    });
    const comp = this.addComponent({
      kind: 'instructions', origin, key: f.disp, name: f.disp, paths: [f.disp],
      contentHash: sha256tag(f.raw),
      attributes: { lines: lines.length, imports: imports.length, headings, alwaysLoaded, bytes: Buffer.byteLength(f.text, 'utf8') },
    });
    for (const [axis, rec] of perAxis) {
      const prefix = { safety_boundary: 'SB', verification_gate_strength: 'VG', spec_clarity: 'SC', execution_stability: 'ES', autonomy: 'AU', cost_efficiency: 'CE', throughput: 'TP' }[axis];
      this.addEvidence({
        comp, path: f.disp, line: rec.line, family: `nar:${axis}`, mechanism: 'narrative',
        fact: `${f.disp}:${rec.line} ${AXIS_LABEL[axis]} 서술 ${rec.count}줄 — "${truncate(this.red(rec.excerpt), 160)}"`,
        primaryAxis: axis, secondaryAxes: [...rec.secondary],
        ruleIds: prefix ? [`${prefix}-L1-01`] : [],
        tags: { narrativeLines: rec.count },
      });
    }
    if (alwaysLoaded) {
      this.alwaysLoaded.push({ disp: f.disp, lines: lines.length, bytes: Buffer.byteLength(f.text, 'utf8') });
      this.addEvidence({
        comp, path: f.disp, family: 'size', mechanism: 'narrative',
        fact: `상시 로드 지침 ${f.disp} ${lines.length}줄`, primaryAxis: 'context_efficiency',
        tags: { alwaysLoadedLines: lines.length },
      });
    }
    if (subdir) {
      this.addEvidence({
        comp, path: f.disp, family: 'subdir', mechanism: 'narrative',
        fact: `하위 디렉터리 지침 ${f.disp}(필요 시 로드)`, primaryAxis: 'context_efficiency', ruleIds: ['CX-L2-04'],
      });
    }
    if (depth >= MAX_IMPORT_DEPTH) return;
    const dir = path.posix.dirname(toPosix(rel));
    for (const imp of imports) {
      if (imp.startsWith('~/') || path.isAbsolute(imp)) {
        const disp = imp.startsWith('~/') ? imp : displayPath(imp, this.projectRoot);
        this.addSource(disp, origin, 'out_of_scope', 'import_outside_root');
        continue;
      }
      const target = path.posix.normalize(path.posix.join(dir, imp));
      if (target.startsWith('..')) {
        this.addSource(truncate(`<import:${sha256hex(imp).slice(0, 8)}>`, 40), origin, 'out_of_scope', 'import_outside_root');
        continue;
      }
      this.collectInstructions(root, target, origin, { alwaysLoaded, depth: depth + 1, visited });
    }
  }

  findSubdirInstructions() {
    const found = [];
    const walk = (absDir, rel, depth) => {
      let entries;
      try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of entries) {
        if (e.isSymbolicLink() || !e.isDirectory()) continue;
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        const childAbs = path.join(absDir, e.name);
        try {
          if (readdirSync(childAbs).includes('CLAUDE.md')) found.push(`${childRel}/CLAUDE.md`);
        } catch { continue; }
        if (depth < 3) walk(childAbs, childRel, depth + 1);
      }
    };
    walk(this.projectRoot, '', 1);
    return found;
  }

  // ---------- 설정 ----------
  collectSettings(root, rel, origin) {
    const f = this.readFile(root, rel, origin);
    if (!f || f.status !== 'ok') return;
    let json;
    try {
      json = JSON.parse(f.text);
    } catch {
      this.addSource(f.disp, origin, 'unsupported', 'invalid_json');
      return;
    }
    if (!json || typeof json !== 'object') return;
    const perms = json.permissions && typeof json.permissions === 'object' ? json.permissions : {};
    const list = (k) => (Array.isArray(perms[k]) ? perms[k].map(String) : []);
    const allow = list('allow');
    const ask = list('ask');
    const deny = list('deny');
    const env = json.env && typeof json.env === 'object' ? json.env : {};
    const defaultMode = typeof perms.defaultMode === 'string' ? perms.defaultMode : null;
    const disableBypass = perms.disableBypassPermissionsMode ?? json.disableBypassPermissionsMode ?? null;
    const comp = this.addComponent({
      kind: 'settings', origin, key: f.disp, name: f.disp, paths: [f.disp], contentHash: sha256tag(f.raw),
      attributes: {
        allowRules: allow.length, askRules: ask.length, denyRules: deny.length,
        defaultMode: defaultMode && this.clean(defaultMode, 40),
        model: typeof json.model === 'string' ? this.clean(json.model, 80) : null,
        sandboxEnabled: json.sandbox?.enabled === true,
        disableAllHooks: json.disableAllHooks === true,
        envKeys: Object.keys(env).sort().map((k) => this.clean(k, 80)),
      },
    });
    const ev = (o) => this.addEvidence({ comp, path: f.disp, mechanism: 'harness_enforced', ...o });
    if (allow.length) {
      const bareBash = allow.some((r) => r === 'Bash' || r === 'Bash(*)');
      ev({ keyPath: '/permissions/allow', family: 'allow', fact: `permissions.allow 규칙 ${allow.length}개${bareBash ? '(인자 없는 Bash 포함)' : ''}`, primaryAxis: 'autonomy', tags: { a: true, bareBash } });
    }
    if (ask.length) ev({ keyPath: '/permissions/ask', family: 'ask', fact: `permissions.ask 규칙 ${ask.length}개`, primaryAxis: 'autonomy', secondaryAxes: ['safety_boundary'], tags: { b: 'ask', askCount: ask.length } });
    if (deny.length) ev({ keyPath: '/permissions/deny', family: 'deny', fact: `permissions.deny 규칙 ${deny.length}개`, primaryAxis: 'safety_boundary', ruleIds: ['SB-L2-03'], tags: { deny: true } });
    if (defaultMode) {
      const base = { keyPath: '/permissions/defaultMode', family: 'defaultMode', fact: `permissions.defaultMode = ${this.clean(defaultMode, 40)}`, tags: { scalarKey: 'defaultMode', defaultMode } };
      if (defaultMode === 'plan') ev({ ...base, primaryAxis: 'spec_clarity', ruleIds: ['SC-L2-03'] });
      else ev({ ...base, primaryAxis: 'autonomy', tags: { ...base.tags, a: A_MODES.has(defaultMode) } });
    }
    if (disableBypass === 'disable') ev({ keyPath: json.disableBypassPermissionsMode ? '/disableBypassPermissionsMode' : '/permissions/disableBypassPermissionsMode', family: 'disableBypass', mechanism: 'org_enforced', fact: 'disableBypassPermissionsMode = disable', primaryAxis: 'safety_boundary', ruleIds: ['SB-L3-02'], tags: { scalarKey: 'disableBypassPermissionsMode' } });
    if (json.sandbox?.enabled === true) ev({ keyPath: '/sandbox/enabled', family: 'sandbox', mechanism: 'org_enforced', fact: 'sandbox.enabled = true', primaryAxis: 'safety_boundary', ruleIds: ['SB-L3-01'], tags: { scalarKey: 'sandbox.enabled' } });
    if (typeof json.model === 'string') ev({ keyPath: '/model', family: 'model', fact: `최상위 model = ${this.clean(json.model, 60)}`, primaryAxis: 'cost_efficiency', ruleIds: ['CE-L1-02'], tags: { scalarKey: 'model' } });
    for (const key of Object.keys(env).sort()) {
      const kept = keepEnvValue(key, env[key]);
      const shown = kept === null ? '(값 제거됨)' : kept;
      const base = { keyPath: pointer('env', key), family: `env:${key}`, fact: `env.${key} = ${shown}`, tags: { scalarKey: `env.${key}`, envKey: key, envValue: kept } };
      if (CE_ENV.includes(key)) ev({ ...base, primaryAxis: 'cost_efficiency', ruleIds: ['CE-L2-02'] });
      else if (key === 'CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION') ev({ ...base, primaryAxis: 'cost_efficiency', ruleIds: ['CE-L3-01'] });
      else if (CX_ENV.includes(key)) {
        const ok = key !== 'MAX_MCP_OUTPUT_TOKENS' || (kept !== null && Number(kept) < 25000);
        ev({ ...base, primaryAxis: 'context_efficiency', ruleIds: ok ? ['CX-L3-01'] : [] });
      }
    }
    if (json.disableAllHooks === true) this.disableAllHooks.push({ origin });
    if (json.hooks && typeof json.hooks === 'object') this.collectHooks(json.hooks, f.disp, origin);
    if (json.enabledPlugins && typeof json.enabledPlugins === 'object') {
      for (const [name, enabled] of Object.entries(json.enabledPlugins).sort()) {
        if (enabled !== true) continue;
        const cleanName = this.clean(name, 120);
        this.plugins.push(cleanName);
        this.addComponent({
          kind: 'plugin', origin, key: name, name: cleanName, paths: [f.disp], contentHash: hashJson({ name, enabled }),
          attributes: { enabled: true, contentsCollected: false },
        });
      }
    }
  }

  // ---------- Hook ----------
  collectHooks(hooks, settingsDisp, origin) {
    const scriptRoot = origin === 'user' ? homedir() : this.projectRoot;
    const ordinals = new Map();
    for (const event of Object.keys(hooks).sort()) {
      const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
      groups.forEach((group, g) => {
        const matcher = typeof group?.matcher === 'string' && group.matcher !== '' ? group.matcher : null;
        const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
        handlers.forEach((h, hi) => {
          const ordKey = `${event}|${matcher ?? ''}`;
          const ord = ordinals.get(ordKey) ?? 0;
          ordinals.set(ordKey, ord + 1);
          this.collectHook({ event, matcher, h: h ?? {}, g, hi, ord, settingsDisp, origin, scriptRoot });
        });
      });
    }
  }

  collectHook({ event, matcher, h, g, hi, ord, settingsDisp, origin, scriptRoot }) {
    const type = typeof h.type === 'string' ? h.type : 'command';
    const command = typeof h.command === 'string' ? h.command : '';
    const promptText = typeof h.prompt === 'string' ? h.prompt : '';
    const scriptRel = command ? hookScriptPath(command) : null;
    let script = null;
    let scriptRaw = null;
    let scriptStatus = null;
    let scriptDisp = null;
    if (scriptRel) {
      if (path.isAbsolute(scriptRel)) {
        scriptStatus = 'escape';
        scriptDisp = displayPath(scriptRel, this.projectRoot);
        this.addSource(scriptDisp, origin, 'out_of_scope', 'outside_root_or_symlink_escape');
      } else {
        const f = this.readFile(scriptRoot, path.posix.normalize(scriptRel), origin, SCRIPT_LIMIT_BYTES);
        scriptStatus = f.status;
        scriptDisp = f.disp;
        if (f.status === 'ok') { script = f.text; scriptRaw = f.raw; }
      }
    }
    const text = `${command}\n${script ?? ''}\n${promptText}`;
    let block = hasBlockMarker(text);
    // 0.3: 스크립트가 같은 루트 안에서 상대 경로로 불러오는 파일을 1단계까지 본다(실행하지 않음, 256KB 한도).
    // ESM 이름 import는 그 이름의 export 안에 표지가 있고 스크립트가 그 이름을 호출할 때만 차단으로 본다.
    const imports = [];
    let blockVia = block ? 'script' : null;
    if (script !== null) {
      const dir = path.posix.dirname(path.posix.normalize(scriptRel));
      for (const imp of hookImports(script)) {
        const target = path.posix.normalize(imp.rootRel ? imp.spec : path.posix.join(dir, imp.spec));
        if (target.startsWith('..') || path.posix.isAbsolute(target)) continue;
        const cands = /\.[a-z]+$/i.test(target) ? [target] : ['.mjs', '.js', '.cjs', '.ts', '.sh'].map((ext) => target + ext);
        const f = cands.map((c) => [c, this.readFile(scriptRoot, c, origin, SCRIPT_LIMIT_BYTES, cands.length > 1)]).find(([, r]) => r.status === 'ok')?.[1]
          ?? this.readFile(scriptRoot, cands[0], origin, SCRIPT_LIMIT_BYTES);
        if (f.status !== 'ok') continue;
        imports.push({ disp: f.disp, hash: sha256hex(f.raw) });
        if (block) continue;
        const exported = blockingExports(f.text);
        const called = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`).test(script.replace(/^\s*import\b[^;]*?from\s*["'][^"']*["'];?/gm, ''));
        const hit = imp.names === null ? exported.size > 0 : exported.has('*') || imp.names.some((n) => exported.has(n) && called(n));
        if (hit) { block = true; blockVia = f.disp; }
      }
    }
    const verify = hasAny(text, VERIFY_CMD);
    const spec = hasAny(text, SPEC_CMD);
    const reentry = hasAny(`${command}\n${script ?? ''}`, REENTRY);
    const matchers = (matcher ?? '').split('|').map((m) => m.trim()).filter(Boolean);
    const writeEdit = matchers.some((m) => /^(Write|Edit|MultiEdit)$/.test(m));
    const highCostOnly = matchers.length > 0 && matchers.every((m) => HIGH_COST_TOOLS.has(m));

    let primaryAxis = null;
    let ruleIds = [];
    const tags = { event, block, verify, reentry, hook: true };
    if (event === 'PreToolUse' || event === 'UserPromptSubmit') {
      if (block) {
        if (spec && (event === 'UserPromptSubmit' || writeEdit)) { primaryAxis = 'spec_clarity'; ruleIds = ['SC-L3-01']; }
        else if (verify && event === 'PreToolUse') { primaryAxis = 'verification_gate_strength'; ruleIds = ['VG-L3-02']; }
        else if (highCostOnly && event === 'PreToolUse') { primaryAxis = 'cost_efficiency'; ruleIds = ['CE-L3-02']; }
        else { primaryAxis = 'safety_boundary'; ruleIds = event === 'PreToolUse' ? ['SB-L2-02'] : []; }
      }
    } else if (event === 'Stop' || event === 'SubagentStop') {
      if (type === 'prompt' || type === 'agent') { primaryAxis = 'verification_gate_strength'; ruleIds = ['VG-L3-03']; }
      else if (verify && block) { primaryAxis = 'verification_gate_strength'; ruleIds = ['VG-L3-01']; }
      tags.blockingStop = block;
    } else if (event === 'PostToolUse') {
      if (block) { primaryAxis = 'verification_gate_strength'; ruleIds = ['VG-L2-03']; }
      else if (verify) { primaryAxis = 'verification_gate_strength'; ruleIds = ['VG-L1-02']; }
    } else if (event.includes('Failure')) {
      primaryAxis = 'execution_stability'; ruleIds = ['ES-L3-01'];
    } else if (event === 'PreCompact') {
      primaryAxis = 'context_efficiency'; ruleIds = ['CX-L3-02'];
    } else if (event === 'Notification') {
      primaryAxis = 'autonomy'; tags.b = 'notification';
    }

    const label = scriptDisp ? path.posix.basename(scriptDisp) : (command ? this.clean(command, 60) : type);
    const levelCap = scriptRel && scriptStatus !== 'ok' ? { max: 1, ruleId: 'COM-02' } : null;
    const comp = this.addComponent({
      kind: 'hook', origin, key: `${event}|${matcher ?? ''}|${ord}`,
      name: `${event}${matcher ? `(${this.clean(matcher, 60)})` : ''} ${label}`,
      paths: [settingsDisp, ...(scriptDisp ? [scriptDisp] : []), ...(blockVia && blockVia !== 'script' ? [blockVia] : [])],
      contentHash: sha256tag(hashInput({ event, matcher, handler: h, script: scriptRaw === null ? null : sha256hex(scriptRaw), ...(imports.length ? { imports: imports.map((x) => x.hash) } : {}) })),
      attributes: {
        event, matcher: matcher && this.clean(matcher, 120), type,
        timeoutSec: typeof h.timeout === 'number' ? h.timeout : null,
        blockingMarker: block, blockingMarkerVia: blockVia === null ? null : blockVia === 'script' ? 'script' : 'import', verifyCommand: verify, specCommand: spec, reentryGuard: reentry,
        scriptExists: scriptRel ? scriptStatus === 'ok' : null,
        command: command ? this.clean(command, 120) : null,
      },
    });
    const keyBase = pointer('hooks', event, g, 'hooks', hi);
    // 차단 표지는 문자열 패턴 탐지임을, 검증 명령 어휘는 검증 판정에 쓰는 이벤트에서만 근거임을 fact에 드러낸다.
    const verifyEvent = event === 'PreToolUse' || event === 'PostToolUse' || event === 'Stop' || event === 'SubagentStop';
    const describe = [
      block ? (blockVia && blockVia !== 'script' ? `차단 표지(문자열 패턴) 있음(import ${path.posix.basename(blockVia)})` : '차단 표지(문자열 패턴) 있음') : '차단 표지(문자열 패턴) 없음',
      verify ? (verifyEvent ? '검증 명령 어휘' : '검증 명령 어휘 있음(이 이벤트는 검증 판정에 쓰지 않음)') : null,
      levelCap ? '스크립트 확인 불가' : null,
    ].filter(Boolean).join(', ');
    this.addEvidence({
      comp, path: settingsDisp, keyPath: keyBase, family: 'hook', mechanism: 'harness_enforced',
      fact: `${event}${matcher ? `(${this.clean(matcher, 60)})` : ''} Hook: ${label} (${describe})`,
      primaryAxis, ruleIds, levelCap, tags,
    });
    if (typeof h.timeout === 'number') {
      this.addEvidence({
        comp, path: settingsDisp, keyPath: `${keyBase}/timeout`, family: 'timeout', mechanism: 'harness_enforced',
        fact: `${event} Hook timeout ${h.timeout}초`, primaryAxis: 'execution_stability', ruleIds: ['ES-L2-03'], levelCap, tags: { hook: true },
      });
    }
    if (reentry && (event === 'Stop' || event === 'SubagentStop') && script) {
      const line = script.split('\n').findIndex((l) => l.includes(REENTRY[0])) + 1;
      this.addEvidence({
        comp, path: scriptDisp, line: line || null, family: 'reentry', mechanism: 'harness_enforced',
        fact: `${label}에 재진입 방지(stop_hook_active) 확인`, primaryAxis: 'execution_stability', ruleIds: ['ES-L3-02'], levelCap, tags: { hook: true },
      });
    }
  }

  // ---------- MCP ----------
  collectMcp(root, rel, origin, servers = null) {
    let disp;
    if (!servers) {
      const f = this.readFile(root, rel, origin);
      if (!f || f.status !== 'ok') return;
      disp = f.disp;
      try {
        servers = JSON.parse(f.text)?.mcpServers;
      } catch {
        this.addSource(f.disp, origin, 'unsupported', 'invalid_json');
        return;
      }
    } else {
      disp = displayPath(path.join(root, rel), this.projectRoot);
    }
    if (!servers || typeof servers !== 'object') return;
    for (const name of Object.keys(servers).sort()) {
      const s = servers[name] ?? {};
      const transport = typeof s.type === 'string' ? s.type : s.url ? 'http' : 'stdio';
      const cmd = typeof s.command === 'string' ? path.posix.basename(splitCommand(s.command)[0] ?? '') : null;
      const cleanName = this.clean(name, 80);
      const comp = this.addComponent({
        kind: 'mcp_server', origin, key: name, name: cleanName, paths: [disp], contentHash: hashJson(s),
        attributes: {
          transport: this.clean(transport, 20),
          command: cmd ? this.clean(cmd, 60) : null,
          args: Array.isArray(s.args) ? s.args.length : 0,
          url: s.url ? urlSchemeHost(s.url) : null,
          envCount: s.env && typeof s.env === 'object' ? Object.keys(s.env).length : 0,
          headersCount: s.headers && typeof s.headers === 'object' ? Object.keys(s.headers).length : 0,
        },
      });
      this.addEvidence({
        comp, path: disp, keyPath: pointer('mcpServers', name), family: 'mcp', mechanism: 'harness_enforced',
        fact: `MCP 서버 '${cleanName}' 선언 (${this.clean(transport, 20)})`, secondaryAxes: ['context_efficiency', 'safety_boundary'],
        tags: { mcp: true },
      });
    }
  }

  // ---------- Agent·Skill ----------
  scanBody(text) {
    for (const line of text.split('\n')) if (targetsAnalyzer(line)) this.r8Hits++;
  }

  collectAgents(root, relDir, origin) {
    const dir = listDirInside(root, relDir);
    if (dir.status !== 'ok') {
      this.addSource(displayPath(path.join(root, relDir), this.projectRoot), origin, dir.status === 'escape' ? 'out_of_scope' : 'absent', null);
      return;
    }
    for (const entry of dir.entries) {
      if (!entry.endsWith('.md')) continue;
      const f = this.readFile(root, `${relDir}/${entry}`, origin);
      if (!f || f.status !== 'ok') continue;
      const fm = parseFrontmatter(f.text);
      this.scanBody(fm.body);
      const d = fm.data;
      const name = typeof d.name === 'string' ? d.name : entry.replace(/\.md$/, '');
      const description = typeof d.description === 'string' ? d.description : '';
      const role = detectRole(name, description);
      const asList = (v) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : null);
      const tools = asList(d.tools);
      const disallowed = asList(d.disallowedTools);
      const model = typeof d.model === 'string' ? d.model : null;
      const maxTurns = typeof d.maxTurns === 'number' ? d.maxTurns : null;
      const independent = role === 'reviewer' && tools ? !tools.some((t) => /^(Write|Edit|MultiEdit|Bash)/.test(t)) : null;
      const cap = fm.ok ? null : { max: 1, ruleId: 'COM-02' };
      const comp = this.addComponent({
        kind: 'agent', origin, key: f.disp, name: this.clean(name, 80), paths: [f.disp], contentHash: sha256tag(f.raw),
        attributes: {
          role, description: description ? this.clean(description, 200) : null,
          tools: tools ? tools.map((t) => this.clean(t, 60)) : null,
          disallowedTools: disallowed ? disallowed.map((t) => this.clean(t, 60)) : null,
          model: model && this.clean(model, 60), maxTurns,
          isolation: typeof d.isolation === 'string' ? this.clean(d.isolation, 40) : null,
          background: d.background === true, permissionMode: typeof d.permissionMode === 'string' ? this.clean(d.permissionMode, 40) : null,
          independent, frontmatterParsed: fm.ok,
        },
      });
      const roleRule = { reviewer: ['verification_gate_strength', 'VG-L2-01'], spec: ['spec_clarity', 'SC-L2-02'], recovery: ['execution_stability', 'ES-L2-04'], parallel: ['throughput', 'TP-L2-02'], explorer: ['context_efficiency', 'CX-L2-03'] }[role];
      const ev = (o) => this.addEvidence({ comp, path: f.disp, levelCap: cap, ...o });
      ev({
        family: 'role', mechanism: 'procedure', fact: `Subagent '${this.clean(name, 60)}' 정의${role ? ` (역할: ${role})` : ' (역할 어휘 없음)'}`,
        primaryAxis: roleRule?.[0] ?? null, ruleIds: roleRule ? [roleRule[1]] : [],
        tags: { agent: true, role, noMaxTurns: maxTurns === null },
      });
      if (tools || disallowed) ev({ keyPath: tools ? '/tools' : '/disallowedTools', family: 'tools', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' ${tools ? `tools 허용 목록 ${tools.length}개` : `disallowedTools ${disallowed.length}개`}`, primaryAxis: 'safety_boundary', ruleIds: ['SB-L2-01'] });
      if (model && model !== 'inherit') ev({ keyPath: '/model', family: 'model', mechanism: 'procedure', fact: `Subagent '${this.clean(name, 60)}' model = ${this.clean(model, 40)}`, primaryAxis: 'cost_efficiency', ruleIds: ['CE-L2-01'], tags: { reviewerHaiku: role === 'reviewer' && /haiku/i.test(model) } });
      if (maxTurns !== null) ev({ keyPath: '/maxTurns', family: 'maxTurns', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' maxTurns = ${maxTurns}`, primaryAxis: 'execution_stability', secondaryAxes: ['cost_efficiency'], ruleIds: ['ES-L2-01'], tags: { maxTurns: true } });
      if (d.isolation === 'worktree') ev({ keyPath: '/isolation', family: 'isolation', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' isolation = worktree`, primaryAxis: 'execution_stability', ruleIds: ['ES-L2-02'] });
      if (d.background === true) ev({ keyPath: '/background', family: 'background', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' background = true`, primaryAxis: 'throughput', ruleIds: ['TP-L2-01'] });
      if (typeof d.permissionMode === 'string' && d.permissionMode !== 'default') ev({ keyPath: '/permissionMode', family: 'permissionMode', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' permissionMode = ${this.clean(d.permissionMode, 40)}`, primaryAxis: 'autonomy', tags: { a: true } });
      if (d.omitClaudeMd === true) ev({ keyPath: '/omitClaudeMd', family: 'omitClaudeMd', mechanism: 'harness_enforced', fact: `Subagent '${this.clean(name, 60)}' omitClaudeMd = true`, secondaryAxes: ['context_efficiency', 'spec_clarity'], tags: { omitClaudeMd: true } });
    }
  }

  isSelfSkill(root, relDir, name) {
    if (name === 'harness-analyze') return true;
    return readTextInside(root, `${relDir}/scripts/harness-lens.mjs`, 1).status !== 'absent';
  }

  collectSkills(root, relDir, origin) {
    const dir = listDirInside(root, relDir);
    if (dir.status !== 'ok') {
      this.addSource(displayPath(path.join(root, relDir), this.projectRoot), origin, dir.status === 'escape' ? 'out_of_scope' : 'absent', null);
      return;
    }
    for (const entry of dir.entries) {
      if (this.isSelfSkill(root, `${relDir}/${entry}`, entry)) {
        if (origin === 'project_shared') this.selfInstalledInProject = true;
        continue; // COM-08 자기 제외
      }
      const f = this.readFile(root, `${relDir}/${entry}/SKILL.md`, origin);
      if (!f || f.status !== 'ok') continue;
      const fm = parseFrontmatter(f.text);
      this.scanBody(fm.body);
      const d = fm.data;
      const name = typeof d.name === 'string' ? d.name : entry;
      const description = typeof d.description === 'string' ? d.description : '';
      const role = detectRole(name, description);
      const model = typeof d.model === 'string' ? d.model : null;
      const fork = d.context === 'fork';
      const cap = fm.ok ? null : { max: 1, ruleId: 'COM-02' };
      const comp = this.addComponent({
        kind: 'skill', origin, key: f.disp, name: this.clean(name, 80), paths: [f.disp], contentHash: sha256tag(f.raw),
        attributes: { role, description: description ? this.clean(description, 200) : null, model: model && this.clean(model, 60), contextFork: fork, frontmatterParsed: fm.ok },
      });
      const roleRule = { reviewer: ['verification_gate_strength', 'VG-L2-02'], spec: ['spec_clarity', 'SC-L2-01'], recovery: ['execution_stability', 'ES-L2-04'], parallel: ['throughput', 'TP-L2-02'] }[role] ?? ['context_efficiency', 'CX-L2-01'];
      const ev = (o) => this.addEvidence({ comp, path: f.disp, levelCap: cap, ...o });
      ev({ family: 'role', mechanism: 'procedure', fact: `Skill '${this.clean(name, 60)}' 정의${role ? ` (역할: ${role})` : ' (역할 없음, 본문 지연 로드)'}`, primaryAxis: roleRule[0], ruleIds: [roleRule[1]], tags: { skill: true, role } });
      if (model && model !== 'inherit') ev({ keyPath: '/model', family: 'model', mechanism: 'procedure', fact: `Skill '${this.clean(name, 60)}' model = ${this.clean(model, 40)}`, primaryAxis: 'cost_efficiency', ruleIds: ['CE-L2-01'] });
      if (fork) ev({ keyPath: '/context', family: 'context', mechanism: 'procedure', fact: `Skill '${this.clean(name, 60)}' context = fork`, primaryAxis: 'context_efficiency', ruleIds: ['CX-L2-02'], tags: { fork: true } });
    }
  }

  collectSelf() {
    const r = readTextInside(this.skillDir, 'SKILL.md', TEXT_LIMIT_BYTES);
    const text = r.status === 'ok' ? r.text.replace(/\r\n/g, '\n') : '';
    const fm = parseFrontmatter(text);
    const always = Math.ceil(Buffer.byteLength(`${fm.data.name ?? ''}${fm.data.description ?? ''}`, 'utf8') / 4);
    this.selfAlwaysLoadedTokens = always;
    return this.addComponent({
      kind: 'harness_lens', origin: this.selfInstalledInProject ? 'project_shared' : 'plugin', key: 'harness-lens',
      // 설치 위치와 무관하게 고정 라벨을 쓴다(루브릭 0.2). 설치 경로는 리포트에 남기지 않는다.
      name: 'Harness Lens', paths: ['harness-lens/SKILL.md'], contentHash: sha256tag(text),
      attributes: { skill: typeof fm.data.name === 'string' ? fm.data.name : 'harness-analyze', alwaysLoadedTokens: always, hooksInstalled: 0, backgroundProcesses: 0 },
    });
  }

  // project 범위에서 수집하지 않은 사용자·관리형 설정 파일이 실제로 있는지만 확인한다(루브릭 §1.8).
  // 파일을 열지 않고 존재 여부만 본다. 있으면 out_of_scope 출처로 남겨 가능 범위를 넓히는 근거로 쓴다.
  probeUnscopedSettings() {
    const c = this.configDir;
    const present = (abs) => { try { return existsSync(abs); } catch { return false; } };
    const nonEmptyDir = (abs, keep) => {
      try { return statSync(abs).isDirectory() && readdirSync(abs).some(keep); } catch { return false; }
    };
    const found = [];
    if (present(path.join(c, 'settings.json'))) found.push('settings.json');
    if (present(path.join(c, 'CLAUDE.md'))) found.push('CLAUDE.md');
    if (nonEmptyDir(path.join(c, 'agents'), (e) => e.endsWith('.md'))) found.push('agents');
    // Harness Lens 자신만 설치된 skills 디렉터리는 사용자 설정으로 보지 않는다(COM-08).
    if (nonEmptyDir(path.join(c, 'skills'), (e) => e !== 'harness-analyze' && !e.startsWith('.'))) found.push('skills');
    for (const rel of found) this.addSource(displayPath(path.join(c, rel), this.projectRoot), 'user', 'out_of_scope', 'user_scope_not_collected');
    const managed = managedSettingsPath(this.platform);
    if (present(managed)) this.addSource(displayPath(managed, this.projectRoot), 'managed', 'out_of_scope', 'managed_settings_not_collected');
  }

  // ---------- 전체 ----------
  // CI·Git Hook은 설정만 읽는다. CI 성공·필수 PR 검사 여부는 이 파일들로 알 수 없다.
  collectRepositoryGates() {
    const root = this.projectRoot;
    // core.hooksPath는 저장소 로컬 config의 정적 상대 경로만 지원한다. gitdir·include·전역 설정은 따라가지 않는다.
    let hooksDir = '.git/hooks';
    // hooksPath 판독 전용: 일반 sources·hashEntries에 넣지 않아 Git 조작이 실측 창을 바꾸지 않는다.
    const config = readTextInside(root, '.git/config', TEXT_LIMIT_BYTES);
    this.gateLimitations = [];
    const git = resolveInside(root, '.git');
    if (git.status === 'ok' && !git.isDir) this.gateLimitations.push({ code: 'git_hook_activation_unresolved', message: '워크트리·서브모듈의 외부 gitdir는 따라가지 않아 Git Hook 활성 경로를 확인하지 못했습니다. 추적된 Hook은 절차 근거로만 봅니다.' });
    if (this.platform === 'win32') this.gateLimitations.push({ code: 'git_hook_executable_unconfirmed', message: 'Windows에서는 Git Hook 실행 비트를 확인하지 못해 강제 수준으로 올리지 않습니다. 실행 비트가 다른 플랫폼과 구성 해시가 다를 수 있습니다.' });
    if (config.status === 'ok') {
      let core = false;
      for (const line of config.text.split('\n')) {
        if (/^\s*\[/.test(line)) core = /^\s*\[core\]\s*(?:[#;].*)?$/i.test(line);
        const m = core && /^\s*hooksPath\s*=\s*([^#;]+?)\s*$/i.exec(line);
        if (m) {
          const value = m[1].replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');
          hooksDir = value.split('/').includes('..') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)
            ? value : path.posix.normalize(value).replace(/\/$/, '');
        }
      }
    }
    const collectGate = (rel, kind, origin, active = false) => {
      const f = this.readFile(root, rel, origin, SCRIPT_LIMIT_BYTES, true);
      if (f.status !== 'ok') return;
      // 주석·표시 이름·환경 변수 값으로 수준을 올리지 않는다. YAML은 run/script/entry와
      // 그 블록 안의 명령만 살핀다(완전한 YAML 해석이나 include/uses 확장은 하지 않는다).
      const commands = [];
      let blockIndent = null;
      let runObject = null;
      f.text.split('\n').forEach((line, i) => {
        if (!line.trim() || /^\s*#/.test(line)) return;
        if (targetsAnalyzer(line)) { this.r8Hits++; return; }
        if (path.basename(rel) === 'Jenkinsfile') {
          const sh = /^\s*(?:sh|bat|powershell)\s*(?:\(\s*)?["']([^"']+)["']/.exec(line);
          if (sh) commands.push([i + 1, sh[1]]);
          return;
        }
        if (!/\.ya?ml$/i.test(rel)) { commands.push([i + 1, line]); return; }
        const indent = line.search(/\S/);
        if (runObject && indent <= runObject.parent) runObject = null;
        if (runObject) runObject.child ??= indent;
        if (blockIndent !== null && indent > blockIndent) { commands.push([i + 1, line]); return; }
        blockIndent = null;
        const m = /^(\s*)(-\s*)?(run|script|entry|command):\s*(.*)$/.exec(line);
        if (!m) return;
        if (m[3] === 'command' && (!runObject || indent !== runObject.child)) return;
        if (m[3] === 'run' && !m[4]) runObject = { parent: m[1].length + (m[2]?.length ?? 0), child: null };
        if (/^[|>][-+]?\s*(?:#.*)?$/.test(m[4]) || (!m[4] && m[3] === 'script')) blockIndent = m[1].length + (m[2]?.length ?? 0);
        else if (m[4]) commands.push([i + 1, m[4]]);
      });
      const comp = this.addComponent({ kind, origin, key: f.disp, name: f.disp, paths: [f.disp],
        contentHash: kind === 'git_hook' ? hashJson({ content: sha256tag(f.raw), active }) : sha256tag(f.raw), attributes: { active, executionResultsCollected: false } });
      if (kind === 'git_hook') this.hashEntries.set(f.disp, comp.contentHash);
      this.addEvidence({ comp, path: f.disp, family: 'repository-gate', mechanism: 'procedure',
        fact: `${kind === 'ci' ? 'CI' : 'Git Hook'} 설정 확인(실행 결과·PR 필수 검사 여부는 미수집)`,
        tags: { repositoryGate: true } });
      for (const [axis, words, rule] of [
        ['spec_clarity', SPEC_CMD, 'SC-L2-04'],
        ['verification_gate_strength', VERIFY_CMD, 'VG-L2-04'],
      ]) {
        // 한 명령을 두 축에 중복 귀속하지 않는다. 명세 어휘가 있으면 SC 우선이다.
        const verification = (cmd) => /(?:^|[;&|]\s*|\s)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check)(?:\b|:)|node\s+--test\b|pytest\b|ruff\b|eslint\b|tsc\b|prettier\s+--check\b|cargo\s+(?:test|clippy)\b|go\s+(?:test|vet)\b|mvn\s+(?:test|verify)\b|gradle\s+(?:test|check)\b)/i.test(cmd) && !/^\s*(?:echo|printf|export|[\w]+\s*=)\b/.test(cmd);
        const hit = commands.find(([, cmd]) => {
          const candidate = cmd.replace(/^\s*-\s+/, '').trim();
          if (/^(?:echo|printf|export|test|\[)(?:\s|$)|^[\w]+\s*=/.test(candidate)) return false;
          return (axis === 'spec_clarity' ? hasAny(candidate, words) : verification(candidate)) && (axis === 'spec_clarity' || !hasAny(candidate, SPEC_CMD));
        });
        if (!hit) continue;
        const before = commands.filter(([line]) => line < hit[0]).map(([, cmd]) => cmd).join('\n');
        const linkedFailure = /\|\|\s*exit\s+[1-9]\d*\s*$/.test(hit[1]);
        const standaloneWithErrexit = /^\s*set\s+-[a-z]*e[a-z]*\s*$/m.test(before) && !/\bset\s+\+[a-z]*e/.test(before) && !/[;&|]/.test(hit[1]);
        const enforced = kind === 'git_hook' && active && (linkedFailure || standaloneWithErrexit);
        const ruleId = enforced ? (axis === 'spec_clarity' ? 'SC-L3-02' : 'VG-L3-04') : rule;
        this.addEvidence({ comp, path: f.disp, line: hit[0], family: `repository:${axis}`, primaryAxis: axis,
          mechanism: enforced ? 'harness_enforced' : 'procedure', ruleIds: [ruleId],
          fact: `${kind === 'ci' ? 'CI' : 'Git Hook'}에 ${AXIS_LABEL[axis]} 명령 어휘 확인${enforced ? '(활성 실행 파일·실패 종료 표지)' : '(실행·강제 여부 미확인)'}`,
          tags: { repositoryGate: true } });
      }
    };
    const visited = new Set();
    for (const [dir, filter, kind, declaredOrigin] of [
      ['.github/workflows', /\.ya?ml$/i, 'ci', 'project_shared'],
      ['.circleci', /^config\.ya?ml$/i, 'ci', 'project_shared'],
      ['.husky', GIT_HOOK_NAME, 'git_hook', 'project_shared'],
      ['.githooks', GIT_HOOK_NAME, 'git_hook', 'project_shared'],
      [hooksDir, GIT_HOOK_NAME, 'git_hook', 'project_local'],
    ]) {
      if (visited.has(dir)) continue;
      visited.add(dir);
      const active = kind === 'git_hook' && dir === hooksDir && !(git.status === 'ok' && !git.isDir);
      const origin = active ? 'project_local' : declaredOrigin;
      const listed = listDirInside(root, dir);
      if (listed.status === 'escape') this.addSource(displayPath(path.resolve(root, dir), root), origin, 'out_of_scope', 'outside_root_or_symlink_escape');
      if (listed.status === 'unreadable') this.addSource(displayPath(path.resolve(root, dir), root), origin, 'unreadable', 'read_error');
      const candidates = listed.entries.filter((n) => filter.test(n));
      if (candidates.length > 100) this.addSource(dir, origin, 'unsupported', 'candidate_limit_exceeded');
      for (const name of candidates.slice(0, 100)) {
        const rel = `${dir}/${name}`;
        const r = resolveInside(root, rel);
        if (r.isDir) continue;
        const executable = active && this.platform !== 'win32' && r.status === 'ok' && !!(statSync(r.real).mode & 0o111);
        // 같은 경로가 추적용 디렉터리와 hooksPath에 겹치면 활성 설정을 우선한다.
        collectGate(rel, kind, dir === hooksDir ? 'project_local' : origin, executable);
      }
    }
    for (const rel of ['.gitlab-ci.yml', '.gitlab-ci.yaml', 'azure-pipelines.yml', 'azure-pipelines.yaml', 'Jenkinsfile']) collectGate(rel, 'ci', 'project_shared');
    collectGate('.pre-commit-config.yaml', 'git_hook', 'project_shared');
  }

  run() {
    this.disableAllHooks = [];
    const p = this.projectRoot;
    this.collectInstructions(p, 'CLAUDE.md', 'project_shared', { alwaysLoaded: true });
    this.collectInstructions(p, '.claude/CLAUDE.md', 'project_shared', { alwaysLoaded: true });
    this.collectInstructions(p, 'CLAUDE.local.md', 'project_local', { alwaysLoaded: true });
    for (const rel of this.findSubdirInstructions()) this.collectInstructions(p, rel, 'project_shared', { alwaysLoaded: false, subdir: true });
    this.collectSettings(p, '.claude/settings.json', 'project_shared');
    this.collectSettings(p, '.claude/settings.local.json', 'project_local');
    this.collectAgents(p, '.claude/agents', 'project_shared');
    this.collectSkills(p, '.claude/skills', 'project_shared');
    this.collectMcp(p, '.mcp.json', 'project_shared');
    this.collectRepositoryGates();
    const origins = ['project_shared', 'project_local'];
    if (this.scope === 'project_and_user') {
      const c = this.configDir;
      this.collectInstructions(c, 'CLAUDE.md', 'user', { alwaysLoaded: true });
      this.collectSettings(c, 'settings.json', 'user');
      this.collectAgents(c, 'agents', 'user');
      this.collectSkills(c, 'skills', 'user');
      const home = homedir();
      const cj = this.readFile(home, '.claude.json', 'user');
      if (cj?.status === 'ok') {
        try {
          const json = JSON.parse(cj.text);
          this.collectMcp(home, '.claude.json', 'user', json.mcpServers ?? {});
          let realRoot = p;
          try { realRoot = realpathSync(p); } catch { /* 그대로 */ }
          const proj = json.projects?.[p] ?? json.projects?.[realRoot];
          if (proj?.mcpServers) this.collectMcp(home, '.claude.json', 'project_local', proj.mcpServers);
        } catch {
          this.addSource(cj.disp, 'user', 'unsupported', 'invalid_json');
        }
      }
      const managed = managedSettingsPath(this.platform);
      this.collectSettings(path.dirname(managed), path.basename(managed), 'managed');
      origins.push('user', 'managed');
    } else {
      this.probeUnscopedSettings();
    }
    if (this.plugins.length) origins.push('plugin');
    const self = this.collectSelf();
    this.applyCommonRules();
    return this.result(origins, self);
  }

  // COM-03(Hook 무력화), COM-09(스칼라 병합), COM-11(적용되지 않는 설정)
  applyCommonRules() {
    const evs = [...this.evidence.values()];
    const scalarGroups = new Map();
    for (const ev of evs) {
      const k = ev._tags.scalarKey;
      if (!k) continue;
      if (!scalarGroups.has(k)) scalarGroups.set(k, []);
      scalarGroups.get(k).push(ev);
    }
    for (const group of scalarGroups.values()) {
      group.sort((a, b) => ORIGIN_RANK[a._tags.origin] - ORIGIN_RANK[b._tags.origin]);
      group.slice(1).forEach((ev) => { ev.void = { ruleId: 'COM-09', reason: '우선순위가 높은 설정 출처가 같은 키를 덮는다' }; });
    }
    for (const ev of evs) {
      const mode = ev._tags.defaultMode;
      if ((mode === 'auto' || mode === 'bypassPermissions') && (ev._tags.origin === 'project_shared' || ev._tags.origin === 'project_local')) {
        ev.void = { ruleId: 'COM-11', reason: `프로젝트 설정의 defaultMode ${mode}는 적용되지 않는다` };
      }
    }
    const effectiveDisable = this.disableAllHooks.sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin])[0];
    if (effectiveDisable) {
      for (const ev of evs) if (ev._tags.hook) ev.void = { ruleId: 'COM-03', reason: '유효 설정 disableAllHooks = true' };
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
      gateLimitations: this.gateLimitations,
    };
  }
}

export function collect(opts) {
  return new Collector(opts).run();
}
