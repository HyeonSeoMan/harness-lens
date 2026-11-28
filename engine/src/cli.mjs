// Harness Lens 엔진 CLI(docs/spec/engine-cli.md). 사람용 메시지는 stderr, --json 결과는 stdout으로 보낸다.
import { spawn } from 'node:child_process';
import { accessSync, constants as fsc, existsSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import {
  AXES, BUDGETS, ENGINE_VERSION, EXIT, MIN_NODE_MAJOR, PRICING_TABLE_VERSION, RUBRIC_VERSION, SCHEMA_VERSION,
  SESSION_PARSER_VERSION, SUPPORTED_PLATFORMS,
} from './constants.mjs';
import { collect } from './collect.mjs';
import { diffAnalyses } from './diff.mjs';
import { rescanAndRedact } from './redact.mjs';
import { renderReport } from './render.mjs';
import { skillDir } from './resources.mjs';
import { computeAxes, computeMaturity, computeTensions, emptyAreaKind, knowledgeBaseKeys } from './rubric.mjs';
import { aggregateSessions, sessionsStagingDir } from './session-aggregate.mjs';
import { promoteState } from './sessions.mjs';
import {
  EngineError, acquireLock, atomicWrite, commitSnapshot, ensureOutDir, latestSnapshotId, loadSnapshot, pruneRuns,
  readIndex, readJson, runDir, snapshotDir, writeJson,
} from './store.mjs';
import { compactUtc, compareCodeUnits, isoSeconds, sha256tag, stableStringify, truncate } from './util.mjs';
import { draftHash, validateRun } from './validate.mjs';

const FLAGS = new Set(['json', 'strict-budget', 'quiet', 'no-sessions', 'full-rescan', 'open', 'no-open']);
const VALUED = new Set(['project', 'out', 'scope', 'config-dir', 'now', 'run', 'model', 'agent', 'from', 'to', 'snapshot']);
const COMMANDS = ['check-runtime', 'collect', 'aggregate-sessions', 'prepare', 'validate', 'snapshot', 'diff', 'render', 'finalize'];
const NODE_MESSAGE = 'Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요.';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new EngineError(EXIT.USAGE, `알 수 없는 인자: ${a}`);
    const key = a.slice(2);
    if (FLAGS.has(key)) opts[key] = true;
    else if (VALUED.has(key)) {
      if (rest[i + 1] === undefined) throw new EngineError(EXIT.USAGE, `--${key}에 값이 필요합니다.`);
      opts[key] = rest[++i];
    } else throw new EngineError(EXIT.USAGE, `알 수 없는 옵션: ${a}`);
  }
  if (!COMMANDS.includes(command)) throw new EngineError(EXIT.USAGE, `사용법: harness-lens.mjs <${COMMANDS.join('|')}> [옵션]`);
  if (opts.scope && !['project', 'project_and_user'].includes(opts.scope)) throw new EngineError(EXIT.USAGE, '--scope는 project 또는 project_and_user입니다.');
  if (opts.now && Number.isNaN(Date.parse(opts.now))) throw new EngineError(EXIT.USAGE, '--now는 ISO 8601 시각이어야 합니다.');
  return { command, opts };
}

class Ctx {
  constructor(opts) {
    this.opts = opts;
    this.timings = [];
    this.now = isoSeconds(opts.now ? new Date(opts.now) : new Date());
  }

  log(message) {
    if (!this.opts.quiet) process.stderr.write(`${message}\n`);
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
      root = path.resolve(this.opts.project);
    } else {
      let dir = process.cwd();
      for (;;) {
        if (existsSync(path.join(dir, '.git'))) { root = dir; break; }
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    try {
      if (!root || !statSync(root).isDirectory()) throw new Error('not dir');
      accessSync(root, fsc.R_OK);
    } catch {
      throw new EngineError(EXIT.NO_PROJECT, '프로젝트 루트를 찾을 수 없거나 읽을 수 없습니다. --project로 지정하세요.');
    }
    this._root = root;
    return root;
  }

  get out() {
    return path.resolve(this.opts.out ?? path.join(this.projectRoot, '.harness-lens'));
  }

  get scope() { return this.opts.scope ?? 'project'; }
  get configDir() { return path.resolve(this.opts['config-dir'] ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude')); }
}

// ---------- check-runtime ----------
function checkRuntime(ctx) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) return { ok: false, code: 'node_too_old', message: NODE_MESSAGE };
  if (!SUPPORTED_PLATFORMS.includes(process.platform)) return { ok: false, code: 'platform_unsupported', message: `지원하지 않는 플랫폼입니다: ${process.platform}` };
  let dir = ctx.out;
  while (!existsSync(dir)) dir = path.dirname(dir);
  try {
    accessSync(dir, fsc.W_OK);
  } catch {
    return { ok: false, code: 'out_not_writable', message: '결과 디렉터리에 쓸 수 없습니다.', exit: EXIT.LOCKED };
  }
  return { ok: true, node: process.version, platform: process.platform };
}

function requireRuntime(ctx) {
  const r = ctx.time('check-runtime', () => checkRuntime(ctx));
  if (!r.ok) throw new EngineError(r.exit ?? EXIT.RUNTIME, r.message);
}

// ---------- collect / prepare ----------
const SESSION_REASON = {
  no_session_logs: '세션 기록이 없습니다',
  session_format_unsupported: '세션 기록 형식을 해석하지 못했습니다(지원하지 않는 형식 또는 버전)',
  session_aggregation_failed: '세션 기록 집계 중 오류가 났습니다',
  no_attributed_sessions: '이 프로젝트에 귀속된 세션이 없습니다',
  session_lines_skipped: '해석하지 못한 줄이 5%를 넘었습니다',
};

function engineLimitations(col, ctx, sessions, info, extra = []) {
  const usable = sessions.status === 'available' || sessions.status === 'partial';
  const out = [];
  if (!usable || !sessions.coverage.sessionsAttributed) out.push({ code: 'static_analysis_only', message: '정적 구성만 분석했습니다. 실제 성능·비용 절감을 확정하지 않으며 수준은 구조적 지원 수준입니다.' });
  else out.push({ code: 'session_measures_correlational', message: `세션 기록을 숫자로만 집계해 일부 축을 실측했습니다(귀속 세션 ${sessions.coverage.sessionsAttributed}개). 실측 대역의 임계값은 휴리스틱이고, 구성과 지표의 관계는 상관관계일 뿐 인과가 아닙니다.` });
  if (sessions.status === 'disabled') out.push({ code: 'sessions_disabled', message: '세션 기록 집계를 껐습니다(--no-sessions 또는 config.json). 모든 축이 구성 기반 예측입니다.' });
  else if (!usable) out.push({ code: sessions.reason ?? 'no_session_logs', message: `세션 기록 실측: ${SESSION_REASON[sessions.reason] ?? sessions.reason}. 모든 축이 구성 기반 예측이고 토큰 지표는 미확인입니다.` });
  else {
    if (sessions.status === 'partial') out.push({ code: 'session_lines_skipped', message: `세션 기록 줄의 ${(sessions.coverage.skippedRatio * 100).toFixed(1)}%를 해석하지 못해 건너뛰었습니다(모르는 레코드 타입 포함). 형식이 바뀌었을 수 있습니다.` });
    if (sessions.tokens) out.push({ code: 'weighted_not_a_bill', message: `환산값은 공개 가격표(${sessions.tokens.weighting.pricingTableVersion}) 기준 ${sessions.tokens.weighting.referenceModel} 새 입력 토큰 환산 상대값이며 청구액이 아닙니다.` });
    if (info.unknownModels) out.push({ code: 'unknown_model_pricing', message: '가격표에 없는 모델의 토큰은 환산값에서 뺐습니다(토큰 수에는 포함).' });
    if (sessions.coverage.sessionsUnattributed) out.push({ code: 'unattributed_sessions', message: `귀속이 불확실한 세션 ${sessions.coverage.sessionsUnattributed}개(봇 ${sessions.tokens?.unattributed.botSessions ?? 0}개)는 합계에 넣지 않았습니다.` });
    if (sessions.coverage.sessionsExcluded) out.push({ code: 'unrelated_sessions_excluded', message: `이 프로젝트와 무관한 세션 ${sessions.coverage.sessionsExcluded}개(다른 프로젝트 경로, 다른 저장소에 매핑된 봇)는 합계·미귀속 어디에도 넣지 않았습니다.` });
    if (info.estimatedShare > 0) out.push({ code: 'estimated_attribution_included', message: `합계에 추정 귀속(삭제된 워크트리 추정·봇 자동 귀속) 환산값 ${(info.estimatedShare * 100).toFixed(1)}%가 포함돼 있습니다.` });
    if (info.unreadableFiles) out.push({ code: 'session_files_unreadable', message: `세션 기록 파일 ${info.unreadableFiles}개를 읽지 못했습니다.` });
    if (info.stateCorrupted) out.push({ code: 'session_state_rebuilt', message: '세션 누적 집계 파일이 손상돼 처음부터 다시 만들었습니다. 원본 기록이 정리된 구간은 빠졌을 수 있습니다.' });
    if (info.stateReset) out.push({ code: 'session_state_reset', message: '세션 파서 버전 또는 저장소가 바뀌어 누적 상태를 다시 만들었습니다. 구버전 archive는 재사용하지 않으며 원본 기록이 정리된 구간은 빠졌을 수 있습니다.' });
  }
  if (ctx.scope === 'project') {
    const unscoped = col.sources.filter((s) => s.reason === 'user_scope_not_collected' || s.reason === 'managed_settings_not_collected');
    out.push(unscoped.length
      ? { code: 'user_scope_not_collected', message: `수집하지 않은 사용자·관리형 설정 파일 ${unscoped.length}개가 있습니다. 실제 유효 설정은 다를 수 있으며 가능 범위로 표시합니다.` }
      : { code: 'user_scope_absent', message: '사용자·관리형 설정 파일이 없어 가능 범위를 프로젝트 근거로만 정했습니다(파일 존재만 확인하고 열지 않았습니다).' });
  }
  if (col.r8Hits > 0) out.push({ code: 'instruction_targets_analyzer', message: `분석 도구를 겨냥한 것으로 보이는 지시문 ${col.r8Hits}곳을 발견했습니다. 원문은 남기지 않았고 데이터로만 취급했으며 수준 계산에 쓰지 않았습니다.` });
  if (col.plugins.length) out.push({ code: 'plugin_contents_not_collected', message: `활성 플러그인 ${col.plugins.length}개의 내용(skills·agents·hooks)은 v0.1에서 수집하지 않았습니다.` });
  if (col.sources.some((s) => s.status === 'unreadable')) out.push({ code: 'source_unreadable', message: '읽지 못한 출처가 있어 일부 축은 판정 불가이거나 범위가 넓습니다.' });
  if (col.sources.some((s) => s.status === 'out_of_scope' && s.origin !== 'user' && s.origin !== 'managed')) out.push({ code: 'source_out_of_scope', message: '수집 루트 밖을 가리키는 경로(심볼릭 링크·import 등)는 따라가지 않았습니다.' });
  if (col.sources.some((s) => s.status === 'skipped_sensitive')) out.push({ code: 'sensitive_files_skipped', message: '민감한 이름의 파일(.env, 키 파일 등)은 열지 않았습니다.' });
  return [...out, ...(col.gateLimitations ?? []), ...extra];
}

// 현재 구성 해시가 처음 관측된 시각(루브릭 §1.9). 같은 해시가 이어진 마지막 스냅샷 묶음의 첫 시각과
// 수집한 프로젝트 설정 파일의 최근 수정 시각 중 이른 쪽을 쓴다. 지금보다 늦을 수는 없다.
function configSinceMs(ctx, col) {
  const nowMs = Date.parse(ctx.now);
  let best = null;
  for (const src of col.sources) {
    if (src.status !== 'read' || (src.origin !== 'project_shared' && src.origin !== 'project_local')) continue;
    try {
      const m = Math.floor(statSync(path.join(ctx.projectRoot, src.path)).mtimeMs / 1000) * 1000;
      if (best === null || m > best) best = m;
    } catch { /* 경로 라벨이 실제 파일이 아님 */ }
  }
  const idx = readIndex(ctx.out);
  let streak = null;
  for (let i = idx.length - 1; i >= 0 && idx[i].configurationHash === col.configurationHash; i--) streak = Date.parse(idx[i].analyzedAt);
  const cands = [best, streak].filter((x) => x !== null && Number.isFinite(x));
  return cands.length ? Math.min(nowMs, ...cands) : null;
}

function runCollect(ctx) {
  return ctx.time('collect', () => {
    const col = collect({ projectRoot: ctx.projectRoot, scope: ctx.scope, configDir: ctx.configDir, skillDir: skillDir() });
    const axes = computeAxes(col, { scope: ctx.scope });
    const tensionCandidates = computeTensions(col, axes);
    const kbKeys = knowledgeBaseKeys(col);
    const runId = `${compactUtc(ctx.now)}-${col.configurationHash.slice(7, 15)}`;
    let rootReal = ctx.projectRoot;
    try { rootReal = realpathSync(rootReal); } catch { /* 그대로 */ }
    const meta = {
      snapshotId: runId,
      analyzedAt: ctx.now,
      analysisType: 'static',
      scope: { preset: ctx.scope, sources: col.origins },
      configurationHash: col.configurationHash,
      project: { displayName: truncate(path.basename(rootReal) || 'project', 200), rootPathHash: sha256tag(rootReal.split(path.sep).join('/')) },
      analyzer: { agent: 'unknown', model: null, modelSource: 'unknown' },
      engineInfo: { version: ENGINE_VERSION, nodeVersion: process.version, platform: process.platform, sessionParserVersion: SESSION_PARSER_VERSION, pricingTableVersion: PRICING_TABLE_VERSION },
    };
    const strip = (list) => list.map(({ _tags, _key, ...rest }) => rest);
    const inventory = { components: strip(col.components), sources: col.sources, alwaysLoaded: col.alwaysLoaded, redactions: col.redactions };
    return { col, axes, tensionCandidates, kbKeys, runId, meta, inventory, evidence: strip(col.evidence) };
  });
}

function budget(id, observed) {
  const b = BUDGETS[id];
  return { budgetId: id, target: b.target, unit: b.unit, observed, status: observed === null ? 'unmeasured' : observed <= b.target ? 'within' : 'exceeded' };
}

// 압축 인벤토리 크기 추정(engine-cli.md §12): UTF-8 바이트 ÷ 4 올림.
const estimateTokens = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
const serializeCompact = (obj) => `${JSON.stringify(obj)}\n`;

// 값이 null이거나 빈 배열인 키를 생략한다(§4.4 생략 규칙). 배열 원소 자체는 그대로 둔다.
function omitEmpty(v) {
  if (Array.isArray(v)) return v.map(omitEmpty);
  if (!v || typeof v !== 'object') return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || x === undefined || (Array.isArray(x) && x.length === 0)) continue;
    out[k] = omitEmpty(x);
  }
  return out;
}

// 근거의 fact를 남길 우선순위(축마다): 그 축 수준을 정한 규칙의 근거 → 규칙 수준 높은 순 → ID 순.
function factRanks(evidence, axes) {
  const decisive = new Map(axes.map((a) => [a.axis, a.source.ruleId]));
  const level = (e) => Math.max(-1, ...e.ruleIds.map((r) => Number(/-L([0-3])-/.exec(r)?.[1] ?? -1)));
  const groups = new Map();
  for (const e of evidence) {
    const k = e.primaryAxis ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const rank = new Map();
  for (const list of groups.values()) {
    list.map((e) => [e, e.ruleIds.includes(decisive.get(e.primaryAxis)) ? 0 : 1, -level(e)])
      .sort((x, y) => x[1] - y[1] || x[2] - y[2] || compareCodeUnits(x[0].id, y[0].id))
      .forEach(([e], i) => rank.set(e.id, i));
  }
  return rank;
}

// 압축 인벤토리(engine-cli.md §4.4). 예산(BUDGETS.llm_input_inventory_tokens)을 넘으면 근거 fact를 축별 상위 N개로 줄인다.
export function compactInventory(draft, kbKeys) {
  const e = draft.engine;
  const sessions = { ...e.sessions, contextPerTurn: e.sessions.contextPerTurn && { ...e.sessions.contextPerTurn, series: undefined } };
  if (sessions.tokens) sessions.tokens = { ...sessions.tokens, byModel: undefined };
  const build = (factLimit) => {
    const rank = factLimit === null ? null : factRanks(e.evidence, e.axes);
    const evidence = e.evidence.map((ev) => (rank && rank.get(ev.id) >= factLimit ? { ...ev, fact: undefined } : ev));
    const omittedFacts = evidence.filter((ev) => ev.fact === undefined).length;
    return omitEmpty({
      schemaVersion: draft.schemaVersion,
      rubricVersion: draft.rubricVersion,
      meta: draft.meta,
      engine: {
        ...e,
        inventory: {
          ...e.inventory,
          components: e.inventory.components.map(({ contentHash, ...c }) => c),
          sources: e.inventory.sources.filter((src) => src.status !== 'absent'),
        },
        evidence,
        sessions,
        selfCost: { componentId: e.selfCost.componentId, alwaysLoadedTokens: e.selfCost.alwaysLoadedTokens },
      },
      knowledgeBaseKeys: kbKeys,
      compaction: { omitted: ['contentHash', 'null_and_empty_array_keys'], factLimitPerAxis: factLimit, omittedFacts },
    });
  };
  // 무손실 생략은 fact 축소 전에 적용한다. 출처는 실제 생략한 항목만
  // [구성 요소 인덱스, 경로 인덱스]로 기록해 가상 구성 요소 경로를 복원하지 않는다.
  const lossless = (compact) => {
    const components = compact.engine.inventory.components ?? [];
    for (const c of components) if (c.name === c.paths?.[0]) delete c.name;
    for (const a of compact.engine.axes) delete a.source.evidenceIds;
    const byId = new Map(components.map((c) => [c.id, c]));
    for (const ev of compact.engine.evidence ?? []) {
      const paths = byId.get(ev.componentId)?.paths;
      if (paths?.length && ev.path === paths[0]) delete ev.path;
    }
    const readSourceRefs = [];
    const remainingSources = (compact.engine.inventory.sources ?? []).filter((src) => {
      if (src.status !== 'read') return true;
      const ci = components.findIndex((c) => c.origin === src.origin && c.paths?.includes(src.path));
      if (ci < 0) return true;
      readSourceRefs.push([ci, components[ci].paths.indexOf(src.path)]);
      return false;
    });
    if (remainingSources.length) compact.engine.inventory.sources = remainingSources;
    else delete compact.engine.inventory.sources;
    compact.compaction.omitted.push('name_equal_first_path', 'axis_source_evidenceIds',
      'evidence_path_equal_first_component_path', 'read_sources_in_components');
    if (readSourceRefs.length) compact.compaction.readSourceRefs = readSourceRefs;
    return compact;
  };
  // 6,000은 실패 상한이다. 수집량 증가에 대비해 압축은 10% 여유를 목표로 한다.
  const target = Math.floor(BUDGETS.llm_input_inventory_tokens.target * 0.9);
  let text = serializeCompact(build(null));
  if (estimateTokens(text) <= target) return text;
  text = serializeCompact(lossless(build(null)));
  if (estimateTokens(text) <= target) return text;
  const counts = new Map();
  for (const ev of e.evidence) counts.set(ev.primaryAxis ?? '', (counts.get(ev.primaryAxis ?? '') ?? 0) + 1);
  for (let n = Math.max(1, ...counts.values()) - 1; n >= 1; n--) {
    text = serializeCompact(lossless(build(n)));
    if (estimateTokens(text) <= target) return text;
  }
  // fact 축당 1개로도 목표를 넘으면 비판정 설명을 마지막에 생략한다.
  const lean = lossless(build(1));
  for (const c of lean.engine.inventory.components ?? []) {
    for (const key of ['command', 'description', 'headings']) delete c.attributes[key];
  }
  lean.compaction.omitted.push('descriptive_component_attributes');
  return serializeCompact(lean);
}

function interpretationTemplate(axes, comparison) {
  return {
    summary: [],
    components: [],
    findings: [],
    axisNotes: AXES.map((axis) => ({ axis, rationale: '', conditions: [], counterexamples: [], validation: [] })),
    currentTradeoffs: {
      investForgo: { summary: '', invested: [], forgone: [], evidenceIds: [] },
      componentTradeoffs: [],
      axisTensions: [],
      emptyAreas: axes
        .filter((a) => emptyAreaKind(a))
        .map((a) => ({ axis: a.axis, kind: emptyAreaKind(a), meaning: '', howToConfirm: '' })),
    },
    changeTradeoffs: comparison ? [] : null,
    limitations: [],
  };
}

// 직전 분석의 벽시계 시간(prepare 시작 ~ finalize 끝)과 그 구간의 귀속 메인 스레드 토큰.
function previousAnalysis(prev, tokens) {
  const start = Date.parse(prev.meta.analyzedAt);
  const end = Date.parse(prev.validation?.checkedAt ?? prev.meta.analyzedAt);
  return {
    snapshotId: prev.meta.snapshotId,
    wallClockMs: Number.isFinite(end - start) && end >= start ? end - start : null,
    llmTokens: tokens,
    method: tokens ? 'session_window' : 'unknown',
  };
}

function cmdPrepare(ctx) {
  const t0 = performance.now();
  requireRuntime(ctx);
  const out = ctx.out;
  ensureOutDir(out);
  const unlock = acquireLock(out);
  try {
    ctx.log('Harness Lens: 구성 수집 중(읽기 전용)…');
    const c = runCollect(ctx);
    const prevId = latestSnapshotId(out);
    const prevSnap = prevId ? loadSnapshot(out, prevId) : null;
    const dir = runDir(out, c.runId);
    rmSync(dir, { recursive: true, force: true });
    const agg = ctx.time('aggregate-sessions', () => aggregateSessions({
      disabled: !!ctx.opts['no-sessions'], configDir: ctx.configDir, projectRoot: ctx.projectRoot, out,
      configSinceMs: configSinceMs(ctx, c.col), fullRescan: !!ctx.opts['full-rescan'], nowMs: Date.parse(ctx.now),
      log: (m) => ctx.log(m), stagingDir: sessionsStagingDir(dir),
      previousWindow: prevSnap ? { startMs: Date.parse(prevSnap.meta.analyzedAt), endMs: Date.parse(prevSnap.validation?.checkedAt ?? prevSnap.meta.analyzedAt) } : null,
    }));
    const { sessions } = agg;
    const axes = computeMaturity(c.axes, sessions, agg.info);
    if (sessions.status === 'available' || sessions.status === 'partial') c.meta.analysisType = 'static_with_sessions';
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
        limitations: engineLimitations(c.col, ctx, sessions, agg.info),
      },
    };
    if (prevId) {
      ctx.log(`Harness Lens: 이전 스냅샷 ${prevId}과 비교 중…`);
      draft.engine.comparison = ctx.time('diff', () => diffAnalyses(prevSnap, draft));
    }
    const finishSelfCost = (inventoryTokens) => {
      const prepareMs = Math.round(performance.now() - t0);
      const currentRun = [...ctx.timings, { subcommand: 'prepare', durationMs: prepareMs, maxRssBytes: process.resourceUsage().maxRSS * 1024 }];
      draft.engine.selfCost = {
        componentId: c.col.selfComponentId,
        alwaysLoadedTokens: { value: c.col.selfAlwaysLoadedTokens, method: 'estimate_utf8_bytes' },
        currentRun,
        previousAnalysis: prevSnap ? previousAnalysis(prevSnap, agg.previousTokens) : null,
        budgets: [
          budget('always_loaded_tokens', c.col.selfAlwaysLoadedTokens),
          budget('background_processes', 0),
          budget('reanalysis_engine_ms', prevId ? prepareMs : null),
          budget('engine_max_rss_bytes', Math.max(...currentRun.map((r) => r.maxRssBytes))),
          budget('llm_input_inventory_tokens', inventoryTokens),
          budget('llm_tokens_per_analysis', agg.previousTokens ? agg.previousTokens.freshInput + agg.previousTokens.cacheWrite + agg.previousTokens.output : null),
        ],
      };
    };
    // R7: 엔진 영역 재검사
    const rescanned = rescanAndRedact(draft.engine);
    if (rescanned.hits.length) {
      draft.engine = rescanned.value;
      draft.engine.limitations.push({ code: 'engine_output_redacted', message: `출력 직전 재검사에서 비밀정보 패턴 ${rescanned.hits.length}건을 추가로 제거했습니다.` });
      rescanWarnings.push(...rescanned.hits);
    }
    // 압축 인벤토리 크기는 selfCost에 들어가지 않으므로 한 번 재면 고정된다.
    finishSelfCost(null);
    const compact = compactInventory(draft, c.kbKeys);
    const inventoryTokens = estimateTokens(compact);
    finishSelfCost(inventoryTokens);

    const { axes: _ignored, ...engineNoAxes } = draft.engine;
    writeJson(path.join(dir, 'inventory.json'), {
      meta: draft.meta,
      inventory: engineNoAxes.inventory,
      evidence: engineNoAxes.evidence,
      axes: draft.engine.axes.map(({ maturity, measured, ...a }) => a),
      tensionCandidates: draft.engine.tensionCandidates,
      limitations: draft.engine.limitations,
      knowledgeBaseKeys: c.kbKeys,
    });
    writeJson(path.join(dir, 'sessions.json'), sessions);
    writeJson(path.join(dir, 'draft.json'), draft);
    atomicWrite(path.join(dir, 'inventory.compact.json'), compact);
    writeJson(path.join(dir, 'interpretation.template.json'), interpretationTemplate(axes, draft.engine.comparison));
    writeJson(path.join(dir, 'run.json'), {
      runId: c.runId,
      status: 'prepared',
      startedAt: ctx.now,
      finishedAt: ctx.now,
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      rubricVersion: RUBRIC_VERSION,
      timings: draft.engine.selfCost.currentRun,
      draftHash: draftHash(draft),
      previousSnapshotId: prevId,
    });
    pruneRuns(out, c.runId);
    for (const w of rescanWarnings) ctx.log(`경고: 엔진 출력 ${w}에서 비밀정보 패턴을 제거했습니다.`);
    const exceeded = draft.engine.selfCost.budgets.filter((b) => b.status === 'exceeded');
    for (const b of exceeded) ctx.log(`경고: 성능 예산 초과 ${b.budgetId} (${b.observed} > ${b.target})`);
    const result = {
      ok: true,
      runId: c.runId,
      compactInventoryPath: path.join(dir, 'inventory.compact.json'),
      interpretationTemplatePath: path.join(dir, 'interpretation.template.json'),
      interpretationPath: path.join(dir, 'interpretation.json'),
      hasComparison: draft.engine.comparison !== null,
      sessionsStatus: sessions.status,
      estimatedInventoryTokens: inventoryTokens,
    };
    if (ctx.opts['strict-budget'] && exceeded.length) return { result: { ...result, ok: false, exceededBudgets: exceeded.map((b) => b.budgetId) }, exit: EXIT.BUDGET };
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
  writeJson(path.join(runDir(ctx.out, c.runId), 'inventory.json'), {
    meta: c.meta, inventory: c.inventory, evidence: c.evidence, axes: c.axes.map(({ maturity, measured, _measurable, ...a }) => a),
    tensionCandidates: c.tensionCandidates, knowledgeBaseKeys: c.kbKeys,
  });
  return {
    result: {
      ok: true,
      runId: c.runId,
      configurationHash: c.meta.configurationHash,
      components: c.inventory.components.length,
      evidence: c.evidence.length,
      unreadable: c.inventory.sources.filter((s) => s.status === 'unreadable').map((s) => s.path),
    },
  };
}

// ---------- validate / snapshot / render / finalize ----------
function cmdValidate(ctx) {
  if (!ctx.opts.run) throw new EngineError(EXIT.USAGE, '--run <runId>가 필요합니다.');
  const r = ctx.time('validate', () => validateRun({ out: ctx.out, runId: ctx.opts.run, agent: ctx.opts.agent, model: ctx.opts.model, now: ctx.now }));
  const checks = r.checks.filter((c) => c.status !== 'pass');
  return { result: { ok: r.status === 'valid', status: r.status, checks }, exit: r.status === 'valid' ? 0 : EXIT.INVALID, analysis: r.analysis };
}

function cmdSnapshot(ctx) {
  if (!ctx.opts.run) throw new EngineError(EXIT.USAGE, '--run <runId>가 필요합니다.');
  const file = path.join(runDir(ctx.out, ctx.opts.run), 'analysis.json');
  if (!existsSync(file)) throw new EngineError(EXIT.NOT_FOUND, `run ${ctx.opts.run}의 analysis.json이 없습니다. validate를 먼저 실행하세요.`);
  const analysis = readJson(file);
  if (analysis.validation?.status !== 'valid') throw new EngineError(EXIT.INVALID, '검증을 통과하지 못한 결과는 스냅샷으로 저장하지 않습니다.');
  const { value: safe } = rescanAndRedact(analysis);
  ctx.time('snapshot', () => commitSnapshot(ctx.out, safe));
  // FR-09: 세션 커서·누적 집계는 스냅샷 저장이 성공한 뒤에만 전진한다.
  try { promoteState(ctx.out, sessionsStagingDir(runDir(ctx.out, ctx.opts.run))); } catch { ctx.log('경고: 세션 누적 집계를 확정하지 못했습니다. 다음 분석에서 같은 구간을 다시 읽습니다.'); }
  const runFile = path.join(runDir(ctx.out, ctx.opts.run), 'run.json');
  if (existsSync(runFile)) writeJson(runFile, { ...readJson(runFile), status: 'snapshotted' });
  return { result: { ok: true, snapshotId: safe.meta.snapshotId, analysisPath: path.join(snapshotDir(ctx.out, safe.meta.snapshotId), 'analysis.json') } };
}

// Windows는 cmd를 거치지 않는다. cmd는 따옴표 안에서도 %VAR%·!VAR!를 확장하고 file URL에는 %가 들어간다.
// rundll32 url.dll,FileProtocolHandler는 URL을 셸 해석 없이 기본 브라우저에 넘긴다(URL은 공백·따옴표가 인코딩돼 한 인자다).
export function browserCommand(platform, target) {
  if (platform === 'darwin') return ['open', [target]];
  if (platform === 'win32') return ['rundll32.exe', ['url.dll,FileProtocolHandler', target]];
  return ['xdg-open', [target]];
}

function openInBrowser(file) {
  const target = pathToFileURL(file).href;
  try {
    const [cmd, args] = browserCommand(process.platform, target);
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function cmdRender(ctx) {
  const id = ctx.opts.snapshot ?? latestSnapshotId(ctx.out);
  if (!id) throw new EngineError(EXIT.NOT_FOUND, '렌더링할 스냅샷이 없습니다.');
  const analysis = loadSnapshot(ctx.out, id);
  let html;
  try {
    html = ctx.time('render', () => renderReport(analysis));
    atomicWrite(path.join(snapshotDir(ctx.out, id), 'report.html'), html);
    atomicWrite(path.join(ctx.out, 'report.html'), html);
  } catch {
    throw new EngineError(EXIT.RENDER, '리포트를 만들지 못했습니다. 스냅샷은 저장돼 있습니다.');
  }
  const reportPath = path.join(ctx.out, 'report.html');
  const opened = ctx.opts.open ? openInBrowser(reportPath) : false;
  return { result: { ok: true, snapshotId: id, reportPath, opened } };
}

function cmdFinalize(ctx) {
  const out = ctx.out;
  if (!existsSync(out)) throw new EngineError(EXIT.NOT_FOUND, '결과 디렉터리가 없습니다. prepare를 먼저 실행하세요.');
  const unlock = acquireLock(out);
  try {
    const v = cmdValidate(ctx);
    if (v.exit) return { result: { ok: false, status: v.result.status, checks: v.result.checks }, exit: v.exit };
    const snap = cmdSnapshot(ctx);
    const saved = ctx.opts;
    ctx.opts = { ...saved, snapshot: snap.result.snapshotId, open: !saved['no-open'] };
    let r;
    try { r = cmdRender(ctx); } finally { ctx.opts = saved; }
    ctx.log(`Harness Lens: 리포트 ${r.result.reportPath}`);
    return {
      result: { ok: true, status: 'valid', snapshotId: snap.result.snapshotId, analysisPath: snap.result.analysisPath, reportPath: r.result.reportPath, opened: r.result.opened, checks: v.result.checks },
    };
  } finally {
    unlock();
  }
}

function resolveTo(ctx) {
  const to = ctx.opts.to;
  if (to && !to.startsWith('run:')) return loadSnapshot(ctx.out, to);
  let runId = to?.slice(4);
  if (!runId) {
    const dir = path.join(ctx.out, 'runs');
    const runs = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'draft.json'))).sort() : [];
    runId = runs[runs.length - 1];
  }
  const file = runId && path.join(runDir(ctx.out, runId), 'draft.json');
  if (!file || !existsSync(file)) throw new EngineError(EXIT.NOT_FOUND, '비교할 run이 없습니다.');
  return readJson(file);
}

function cmdDiff(ctx) {
  const toDoc = resolveTo(ctx);
  let fromId = ctx.opts.from;
  if (!fromId) {
    const idx = readIndex(ctx.out).map((e) => e.snapshotId).filter((id) => id !== toDoc.meta.snapshotId);
    fromId = idx[idx.length - 1];
  }
  if (!fromId) throw new EngineError(EXIT.NOT_FOUND, '비교할 이전 스냅샷이 없습니다.');
  const comparison = ctx.time('diff', () => diffAnalyses(loadSnapshot(ctx.out, fromId), toDoc));
  return { result: { ok: true, comparison } };
}

// 단독 실행: 확정된 누적 상태에 새 바이트를 더한 결과를 보여 줄 뿐 아무것도 쓰지 않는다(커서도 전진하지 않음).
function cmdAggregateSessions(ctx) {
  requireRuntime(ctx);
  const agg = ctx.time('aggregate-sessions', () => aggregateSessions({
    disabled: !!ctx.opts['no-sessions'], configDir: ctx.configDir, projectRoot: ctx.projectRoot, out: ctx.out,
    configSinceMs: null, fullRescan: !!ctx.opts['full-rescan'], nowMs: Date.parse(ctx.now), log: (m) => ctx.log(m),
  }));
  const s = agg.sessions;
  return { result: { ok: true, status: s.status, reason: s.reason, sessions: s } };
}

const HANDLERS = {
  'check-runtime': (ctx) => {
    const r = checkRuntime(ctx);
    if (!r.ok) return { result: { ok: false, code: r.code, message: r.message }, exit: r.exit ?? EXIT.RUNTIME };
    return { result: r };
  },
  collect: cmdCollect,
  'aggregate-sessions': cmdAggregateSessions,
  prepare: cmdPrepare,
  validate: cmdValidate,
  snapshot: cmdSnapshot,
  diff: cmdDiff,
  render: cmdRender,
  finalize: cmdFinalize,
};

export function main(argv) {
  let ctx = null;
  let json = argv.includes('--json');
  try {
    const { command, opts } = parseArgs(argv);
    json = !!opts.json;
    ctx = new Ctx(opts);
    const { result, exit = 0 } = HANDLERS[command](ctx);
    if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else if (command === 'diff' || command === 'check-runtime' || command === 'collect' || command === 'aggregate-sessions') process.stdout.write(stableStringify(result));
    if (!json && exit === EXIT.INVALID) {
      for (const c of result.checks ?? []) process.stderr.write(`${c.checkId}: ${c.status} ${c.message ?? ''}\n`);
    }
    return exit;
  } catch (err) {
    const code = err instanceof EngineError ? err.exitCode : EXIT.INTERNAL;
    let message = err instanceof EngineError ? err.message : '내부 오류가 발생했습니다.';
    if (code === EXIT.INTERNAL && ctx) {
      try {
        const file = path.join(ctx.out, ctx.opts.run ? path.join('runs', ctx.opts.run) : '', 'error.json');
        if (existsSync(path.dirname(file))) {
          writeFileSync(file, stableStringify({ message: String(err?.message ?? err).slice(0, 300), engineVersion: ENGINE_VERSION, at: ctx.now }));
          message = `${message} ${file}`;
        }
      } catch { /* 무시 */ }
      if (process.env.HARNESS_LENS_DEBUG) process.stderr.write(`${err?.stack}\n`);
    }
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, code, message })}\n`);
    process.stderr.write(`${message}\n`);
    return code;
  }
}
