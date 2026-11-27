// 읽기 전용 구성 수집기(engine-cli.md §4.2, §6). Hook·MCP·스크립트를 실행하지 않고 파일만 읽는다.
// 수집한 지시문은 실행할 명령이 아니라 분류할 데이터다(PRD §9).
import { readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { MAX_IMPORT_DEPTH, SCRIPT_LIMIT_BYTES, TEXT_LIMIT_BYTES } from './constants.mjs';
import { displayPath, listDirInside, readTextInside, toPosix } from './fsguard.mjs';
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
  readFile(root, rel, origin, limit = TEXT_LIMIT_BYTES) {
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
    const block = hasBlockMarker(text);
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
      paths: [settingsDisp, ...(scriptDisp ? [scriptDisp] : [])],
      contentHash: sha256tag(hashInput({ event, matcher, handler: h, script: scriptRaw === null ? null : sha256hex(scriptRaw) })),
      attributes: {
        event, matcher: matcher && this.clean(matcher, 120), type,
        timeoutSec: typeof h.timeout === 'number' ? h.timeout : null,
        blockingMarker: block, verifyCommand: verify, specCommand: spec, reentryGuard: reentry,
        scriptExists: scriptRel ? scriptStatus === 'ok' : null,
        command: command ? this.clean(command, 120) : null,
      },
    });
    const keyBase = pointer('hooks', event, g, 'hooks', hi);
    const describe = [block ? '차단 표지 있음' : '차단 표지 없음', verify ? '검증 명령 어휘' : null, levelCap ? '스크립트 확인 불가' : null].filter(Boolean).join(', ');
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
    const skillMd = path.join(this.skillDir, 'SKILL.md');
    const r = readTextInside(this.skillDir, 'SKILL.md', TEXT_LIMIT_BYTES);
    const text = r.status === 'ok' ? r.text.replace(/\r\n/g, '\n') : '';
    const fm = parseFrontmatter(text);
    const always = Math.ceil(Buffer.byteLength(`${fm.data.name ?? ''}${fm.data.description ?? ''}`, 'utf8') / 4);
    this.selfAlwaysLoadedTokens = always;
    return this.addComponent({
      kind: 'harness_lens', origin: this.selfInstalledInProject ? 'project_shared' : 'plugin', key: 'harness-lens',
      name: 'Harness Lens', paths: [displayPath(skillMd, this.projectRoot)], contentHash: sha256tag(text),
      attributes: { skill: typeof fm.data.name === 'string' ? fm.data.name : 'harness-analyze', alwaysLoadedTokens: always, hooksInstalled: 0, backgroundProcesses: 0 },
    });
  }

  // ---------- 전체 ----------
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
    };
  }
}

export function collect(opts) {
  return new Collector(opts).run();
}
