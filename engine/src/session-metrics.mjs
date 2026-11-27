// 누적 세션 상태 → 스키마 engine.sessions (engine-cli.md §8.3~§8.5, 루브릭 §1.9).
// 같은 상태면 같은 결과가 나오도록 모든 순회를 키 정렬 순서로 한다.
import { PRICING_TABLE_VERSION, REFERENCE_MODEL, unitsToWeighted, weightedUnits } from './pricing.mjs';
import { DAY_MS, RESPONSE_RETENTION_DAYS, compareVersions } from './sessions.mjs';
import { compareCodeUnits, roundHalfEven } from './util.mjs';

export const LOCATIONS = ['direct', 'worker', 'subagent', 'bot'];
const METHODS = ['direct', 'worktree', 'inferred', 'configured', 'auto'];

const r4 = (x) => roundHalfEven(x, 4);
const r1 = (x) => roundHalfEven(x, 1);
const dateOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// 최근접 순위 분위수(정확값, 결정론적).
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}
const sortNum = (a) => [...a].sort((x, y) => x - y);

const zero5 = () => [0, 0, 0, 0, 0];
function add5(t, v) { for (let i = 0; i < 5; i++) t[i] += v[i]; }

// 세션 → { location, method } 귀속(§8.3). 미귀속이면 location null.
function resolveAttribution(state, env) {
  const sessions = new Map(); // sessionKey → { files: [fh], cls, botMention, location, method }
  const subagents = [];
  for (const fh of Object.keys(state.files).sort(compareCodeUnits)) {
    const fs = state.files[fh];
    const key = fs.session ?? `f:${fh}`;
    if (fs.kind === 'subagent') { subagents.push([fh, fs, key]); continue; }
    let s = sessions.get(key);
    if (!s) { s = { files: [], cls: null, botMention: false }; sessions.set(key, s); }
    s.files.push(fh);
    if (!s.cls && fs.cls) s.cls = fs.cls;
    s.botMention = s.botMention || fs.botMention;
  }
  const decide = (cls, botMention) => {
    if (!cls) return { location: null, method: null, bot: false };
    if (cls.kind === 'direct') return { location: 'direct', method: 'direct', bot: false };
    if (cls.kind === 'worktree') return { location: 'worker', method: 'worktree', bot: false };
    if (cls.kind === 'inferred') return { location: 'worker', method: 'inferred', bot: false };
    if (cls.kind === 'bot') {
      const mapped = env.cfg.botMap[cls.bot];
      if (mapped !== undefined) return env.roots.includes(mapped) ? { location: 'bot', method: 'configured', bot: true } : { location: null, method: null, bot: true };
      return botMention ? { location: 'bot', method: 'auto', bot: true } : { location: null, method: null, bot: true };
    }
    return { location: null, method: null, bot: false };
  };
  for (const s of sessions.values()) Object.assign(s, decide(s.cls, s.botMention));
  // 서브에이전트는 부모 세션의 귀속을 따른다. 부모 기록이 없으면 자기 cwd로 판정한다.
  const subs = new Map();
  for (const [fh, fs, key] of subagents) {
    const parent = sessions.get(key);
    const d = parent ?? decide(fs.cls, fs.botMention);
    subs.set(fh, { key, parentLocation: d.location, method: d.method, bot: d.bot });
  }
  return { sessions, subs };
}

// 응답 하나의 위치. 서브에이전트 응답은 부모가 귀속됐을 때만 subagent다.
function responseLocation(r, attr) {
  const s = attr.sessions.get(r[6]);
  const parentLoc = s ? s.location : attr.subBySession.get(r[6]) ?? null;
  if (!parentLoc) return null;
  return r[7] ? 'subagent' : parentLoc;
}

// 90일보다 오래된 응답은 일별 누적(archive)으로 접어 둔다. 원본 기록이 정리된 뒤에도 추이가 남는다.
export function pruneResponses(state, env, nowMs) {
  const cutoff = nowMs - RESPONSE_RETENTION_DAYS * DAY_MS;
  const attr = withSubIndex(resolveAttribution(state, env));
  const old = [...state.responses.keys()].filter((k) => { const t = state.responses.get(k)[8]; return t > 0 && t < cutoff; }).sort(compareCodeUnits);
  const raw = new Map();
  for (const k of old) {
    const r = state.responses.get(k);
    const day = dateOf(r[8]);
    const loc = responseLocation(r, attr) ?? 'unattributed';
    const d = (state.archive.days[day] ??= { tokens: {}, ctx: null });
    const slot = (d.tokens[`${loc}|${r[5]}`] ??= zero5());
    add5(slot, r.slice(0, 5));
    if (!r[7] && (loc === 'direct' || loc === 'worker')) {
      if (!raw.has(day)) raw.set(day, []);
      raw.get(day).push(r[0] + r[1] + r[2] + r[3]);
    }
    state.archive.responses++;
    state.responses.delete(k);
  }
  // 일별 분포는 요청 수·p50·max만 남긴다. 같은 날이 다시 접히면 근사로 합친다.
  for (const day of [...raw.keys()].sort(compareCodeUnits)) {
    const s = sortNum(raw.get(day));
    const cur = { requests: s.length, p50: quantile(s, 0.5), max: s[s.length - 1] };
    const d = state.archive.days[day];
    d.ctx = d.ctx ? { requests: d.ctx.requests + cur.requests, p50: d.ctx.requests >= cur.requests ? d.ctx.p50 : cur.p50, max: Math.max(d.ctx.max, cur.max) } : cur;
  }
}

function withSubIndex(attr) {
  attr.subBySession = new Map();
  for (const s of attr.subs.values()) if (!attr.sessions.has(s.key) && !attr.subBySession.has(s.key)) attr.subBySession.set(s.key, s.parentLocation);
  return attr;
}

function bucketOut(parts) {
  // parts: Map(model → [5]) → tokenBucket
  const t = zero5();
  let units = 0;
  let unknown = false;
  for (const model of [...parts.keys()].sort(compareCodeUnits)) {
    const v = parts.get(model);
    add5(t, v);
    const u = weightedUnits(model, v);
    if (u === null) { if (v.some((x) => x > 0)) unknown = true; } else units += u;
  }
  return { bucket: { freshInput: t[0], cacheWrite: t[1] + t[2], cacheRead: t[3], output: t[4], weighted: r1(unitsToWeighted(units)) }, unknown, units };
}

function emptyBucket() { return { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 }; }

// 루브릭 §1.9 대역 규칙(휴리스틱).
export const BAND_RULES = {
  execution_stability: { ruleId: 'ES-M-01', metric: 'tool_error_rate', band: (v) => (v <= 0.02 ? 3 : v <= 0.05 ? 2 : v <= 0.1 ? 1 : 0) },
  throughput: { ruleId: 'TP-M-01', metric: 'turn_duration_p50_ms', band: (v) => (v <= 30000 ? 3 : v <= 90000 ? 2 : v <= 300000 ? 1 : 0) },
  cost_efficiency: { ruleId: 'CE-M-01', metric: 'cache_hit_ratio', band: (v) => (v >= 0.9 ? 3 : v >= 0.75 ? 2 : v >= 0.5 ? 1 : 0) },
  context_efficiency: {
    ruleId: 'CX-M-01', metric: 'context_p90_tokens', band: (v, m) => {
      const b = v <= 50000 ? 3 : v <= 100000 ? 2 : v <= 150000 ? 1 : 0;
      const cps = m.compactions_per_session;
      return cps !== undefined && cps > 0.5 ? Math.min(b, 1) : b;
    },
  },
  autonomy: { ruleId: 'AU-M-01', metric: 'tool_calls_between_prompts_p50', band: (v) => (v >= 20 ? 3 : v >= 8 ? 2 : v >= 3 ? 1 : 0) },
};

// 상태 → engine.sessions. extra: 성숙도 계산에 쓰는 표본 수(스키마 밖, 호출자가 떼어 낸다).
export function summarize(state, env, { configSinceMs, incremental, scan }) {
  const files = Object.entries(state.files).sort((a, b) => compareCodeUnits(a[0], b[0]));
  const sum = (k) => files.reduce((s, [, f]) => s + f.c[k], 0);
  const linesRead = sum('lines');
  const linesSkipped = sum('skipped');
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
  const unattributed = mainSessions.filter(([, s]) => !s.location);

  const base = {
    status: 'available', reason: null,
    clientVersions: vmin ? { min: vmin, max: vmax } : null,
    window: null,
    coverage: {
      filesScanned: scan.present, linesRead, linesSkipped, skippedRatio,
      sessionsAttributed: attributed.length, sessionsUnattributed: unattributed.length, incremental,
      configSince: configSinceMs === null ? null : new Date(configSinceMs).toISOString().replace(/\.\d+Z$/, 'Z'),
    },
    dedup: {
      assistantLines: sum('assistantLines'), uniqueResponses: state.responses.size + state.archive.responses,
      excludedSynthetic: sum('synthetic'), excludedApiError: sum('apiError'),
    },
    tokens: null, contextPerTurn: null, axisMetrics: [],
  };
  const info = { unknownModels: false, estimatedShare: 0, samples: {}, sinceSessions: 0 };
  const unavailable = (reason) => ({ sessions: { ...base, status: 'unavailable', reason }, info });
  if (!files.length) return unavailable('no_session_logs');
  if (base.dedup.uniqueResponses === 0) return unavailable(sum('assistantLines') > 0 || linesRead > 0 ? 'session_format_unsupported' : 'no_session_logs');

  // ---- 토큰 ----
  const byLocModel = new Map(LOCATIONS.map((l) => [l, new Map()]));
  const unattrModel = new Map();
  const ctxAll = [];
  const ctxByDay = new Map();
  const firstBySession = new Map();
  const addTo = (map, model, v) => { const t = map.get(model) ?? zero5(); add5(t, v); map.set(model, t); };
  const respKeys = [...state.responses.keys()].sort(compareCodeUnits);
  for (const k of respKeys) {
    const r = state.responses.get(k);
    const v = r.slice(0, 5);
    const loc = responseLocation(r, attr);
    if (!loc) { addTo(unattrModel, r[5], v); continue; }
    addTo(byLocModel.get(loc), r[5], v);
    if (!r[7] && (loc === 'direct' || loc === 'worker')) {
      const size = r[0] + r[1] + r[2] + r[3];
      ctxAll.push(size);
      if (r[8] > 0) {
        const day = dateOf(r[8]);
        if (!ctxByDay.has(day)) ctxByDay.set(day, []);
        ctxByDay.get(day).push(size);
        const f = firstBySession.get(r[6]);
        if (!f || r[8] < f[0] || (r[8] === f[0] && compareCodeUnits(k, f[1]) < 0)) firstBySession.set(r[6], [r[8], k, size]);
      }
    }
  }
  const archDays = Object.keys(state.archive.days).sort(compareCodeUnits);
  for (const day of archDays) {
    const d = state.archive.days[day];
    for (const key of Object.keys(d.tokens).sort(compareCodeUnits)) {
      const [loc, model] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
      if (loc === 'unattributed') addTo(unattrModel, model, d.tokens[key]);
      else if (byLocModel.has(loc)) addTo(byLocModel.get(loc), model, d.tokens[key]);
    }
  }
  const locOut = LOCATIONS.map((l) => ({ l, ...bucketOut(byLocModel.get(l)) }));
  const allModels = new Map();
  for (const l of LOCATIONS) for (const [m, v] of byLocModel.get(l)) addTo(allModels, m, v);
  const total = bucketOut(allModels);
  info.unknownModels = total.unknown || locOut.some((x) => x.unknown);
  const totalUnits = locOut.reduce((s, x) => s + x.units, 0);
  const sessCount = Object.fromEntries(LOCATIONS.map((l) => [l, 0]));
  const methodCount = Object.fromEntries(LOCATIONS.map((l) => [l, Object.fromEntries(METHODS.map((m) => [m, 0]))]));
  for (const [, s] of attributed) { sessCount[s.location]++; methodCount[s.location][s.method]++; }
  for (const s of attr.subs.values()) if (s.parentLocation) { sessCount.subagent++; methodCount.subagent[s.method]++; }
  // 추정 귀속(inferred·auto)이 환산값에서 차지하는 비중
  {
    const est = new Map();
    for (const k of respKeys) {
      const r = state.responses.get(k);
      const s = attr.sessions.get(r[6]);
      if (s && (s.method === 'inferred' || s.method === 'auto')) addTo(est, r[5], r.slice(0, 5));
    }
    info.estimatedShare = totalUnits ? r4(bucketOut(est).units / totalUnits) : 0;
  }
  base.tokens = {
    weighting: { pricingTableVersion: PRICING_TABLE_VERSION, referenceModel: REFERENCE_MODEL, basis: 'reference_model_fresh_input_equivalent' },
    total: total.bucket,
    byLocation: locOut.map((x) => ({
      location: x.l, sessions: sessCount[x.l], tokens: x.bucket,
      weightedShare: totalUnits ? r4(x.units / totalUnits) : 0, attribution: methodCount[x.l],
    })),
    unattributed: {
      sessions: unattributed.length, botSessions: unattributed.filter(([, s]) => s.bot).length,
      tokens: unattrModel.size ? bucketOut(unattrModel).bucket : emptyBucket(),
    },
    byModel: [...allModels.keys()].sort(compareCodeUnits).map((m) => ({ model: m, tokens: bucketOut(new Map([[m, allModels.get(m)]])).bucket })),
  };

  // ---- 턴별 컨텍스트 ----
  const ctxSorted = sortNum(ctxAll);
  const mainAttributedFiles = (pred) => files.filter(([fh, f]) => {
    if (f.kind !== 'main') return false;
    const s = attr.sessions.get(f.session ?? `f:${fh}`);
    return s && (s.location === 'direct' || s.location === 'worker') && pred(s, f);
  });
  const workFiles = mainAttributedFiles(() => true);
  const series = [];
  for (const day of archDays) {
    const c = state.archive.days[day].ctx;
    if (c && !ctxByDay.has(day)) series.push({ date: day, ...c });
  }
  for (const day of [...ctxByDay.keys()].sort(compareCodeUnits)) {
    const s = sortNum(ctxByDay.get(day));
    series.push({ date: day, requests: s.length, p50: quantile(s, 0.5), max: s[s.length - 1] });
  }
  series.sort((a, b) => compareCodeUnits(a.date, b.date));
  base.contextPerTurn = ctxSorted.length ? {
    requests: ctxSorted.length, p50: quantile(ctxSorted, 0.5), p90: quantile(ctxSorted, 0.9), max: ctxSorted[ctxSorted.length - 1],
    firstRequestP50: quantile(sortNum([...firstBySession.values()].map((f) => f[2])), 0.5) ?? 0,
    compactions: workFiles.reduce((s, [, f]) => s + f.c.compactions, 0),
    series: series.slice(-90),
  } : null;

  // ---- 창 ----
  let fromMs = null;
  let toMs = null;
  for (const k of respKeys) {
    const t = state.responses.get(k)[8];
    if (t <= 0) continue;
    if (fromMs === null || t < fromMs) fromMs = t;
    if (toMs === null || t > toMs) toMs = t;
  }
  const presentFirst = files.filter(([, f]) => f.present && f.firstTs !== null).map(([, f]) => f.firstTs);
  const from = archDays.length ? archDays[0] : fromMs !== null ? dateOf(fromMs) : null;
  if (from) base.window = { from, to: toMs !== null ? dateOf(toMs) : archDays[archDays.length - 1], rawLogsFrom: presentFirst.length ? dateOf(presentFirst.reduce((a, b) => Math.min(a, b))) : null };

  // ---- 축 지표(configSince 이후, 프로젝트·워커 메인 스레드. 봇 제외) ----
  const since = (f) => configSinceMs === null || (f.firstTs !== null && f.firstTs >= configSinceMs);
  const sinceSessions = new Map();
  for (const [fh, f] of workFiles) if (since(f)) {
    const key = f.session ?? `f:${fh}`;
    if (!sinceSessions.has(key)) sinceSessions.set(key, []);
    sinceSessions.get(key).push(f);
  }
  const sinceFiles = [...sinceSessions.values()].flat();
  const sinceSubs = files.filter(([fh, f]) => f.kind === 'subagent' && sinceSessions.has(attr.subs.get(fh)?.key));
  const n = sinceSessions.size;
  const fsum = (list, k) => list.reduce((s, f) => s + f.c[k], 0);
  const mainTool = fsum(sinceFiles, 'toolUse');
  const subTool = fsum(sinceFiles, 'subToolUse') + sinceSubs.reduce((s, [, f]) => s + f.c.subToolUse, 0);
  const allTool = mainTool + subTool;
  const allErr = fsum(sinceFiles, 'toolErrors') + fsum(sinceFiles, 'subToolErrors') + sinceSubs.reduce((s, [, f]) => s + f.c.subToolErrors, 0);
  const metrics = [];
  const push = (axis, metricId, value, unit, sampleSize) => { if (sampleSize > 0 && Number.isFinite(value)) metrics.push({ axis, metricId, value, unit, sampleSize, sinceConfig: configSinceMs !== null }); };
  push('execution_stability', 'tool_error_rate', allTool ? r4(allErr / allTool) : NaN, 'ratio', allTool);
  const mainErr = fsum(sinceFiles, 'toolErrors');
  push('execution_stability', 'tool_error_recovery_rate', mainErr ? r4(fsum(sinceFiles, 'recovered') / mainErr) : NaN, 'ratio', mainErr);
  push('execution_stability', 'hook_errors_per_session', r4(fsum(sinceFiles, 'hookErrors') / n), 'per_session', n);
  push('execution_stability', 'api_retries_per_session', r4(fsum(sinceFiles, 'apiRetries') / n), 'per_session', n);
  const durations = sortNum(sinceFiles.flatMap((f) => f.durations));
  push('throughput', 'turn_duration_p50_ms', quantile(durations, 0.5), 'ms', durations.length);
  const sessionDur = sortNum([...sinceSessions.values()].map((list) => {
    const a = list.map((f) => f.firstTs).filter((x) => x !== null);
    const b = list.map((f) => f.lastTs).filter((x) => x !== null);
    return a.length ? b.reduce((x, y) => Math.max(x, y)) - a.reduce((x, y) => Math.min(x, y)) : null;
  }).filter((x) => x !== null));
  push('throughput', 'session_duration_p50_ms', quantile(sessionDur, 0.5), 'ms', sessionDur.length);
  // 캐시 적중률은 서브에이전트를 포함한다(루브릭 §1.9).
  const sinceKeys = new Set(sinceSessions.keys());
  let crSum = 0;
  let inSum = 0;
  let respN = 0;
  const sinceCtx = [];
  const sinceWeight = new Map();
  for (const k of respKeys) {
    const r = state.responses.get(k);
    if (!sinceKeys.has(r[6])) continue;
    respN++;
    crSum += r[3];
    inSum += r[0] + r[1] + r[2] + r[3];
    addTo(sinceWeight, r[5], r.slice(0, 5));
    if (!r[7]) sinceCtx.push(r[0] + r[1] + r[2] + r[3]);
  }
  push('cost_efficiency', 'cache_hit_ratio', inSum ? r4(crSum / inSum) : NaN, 'ratio', respN);
  push('cost_efficiency', 'weighted_tokens_per_session', r1(bucketOut(sinceWeight).bucket.weighted / n), 'tokens', n);
  const sc = sortNum(sinceCtx);
  push('context_efficiency', 'context_p90_tokens', quantile(sc, 0.9), 'tokens', sc.length);
  push('context_efficiency', 'compactions_per_session', r4(fsum(sinceFiles, 'compactions') / n), 'per_session', n);
  const gaps = sortNum(sinceFiles.flatMap((f) => (f.openGap !== null ? [...f.gaps, f.openGap] : f.gaps)));
  push('autonomy', 'tool_calls_between_prompts_p50', quantile(gaps, 0.5), 'count', gaps.length);
  push('autonomy', 'human_prompts_per_session', r4(fsum(sinceFiles, 'humanPrompts') / n), 'per_session', n);
  push('verification_gate_strength', 'hook_blocks_per_session', r4(fsum(sinceFiles, 'hookBlocks') / n), 'per_session', n);
  base.axisMetrics = metrics;
  info.samples = { sessions: n, tool_calls_all: allTool, tool_calls_main: mainTool };
  info.sinceSessions = n;

  if (skippedRatio > 0.05) { base.status = 'partial'; base.reason = 'session_lines_skipped'; }
  if (!attributed.length) base.reason = base.reason ?? 'no_attributed_sessions';
  return { sessions: base, info };
}

// 직전 분석(prepare 시작 ~ finalize 끝)에 귀속된 메인 스레드 응답 토큰(PRD §11.1 자기 비용).
export function analysisWindowTokens(state, env, startMs, endMs) {
  const attr = withSubIndex(resolveAttribution(state, env));
  const parts = new Map();
  let n = 0;
  for (const k of [...state.responses.keys()].sort(compareCodeUnits)) {
    const r = state.responses.get(k);
    if (r[7] || r[8] < startMs || r[8] > endMs) continue;
    const loc = responseLocation(r, attr);
    if (loc !== 'direct' && loc !== 'worker') continue;
    const t = parts.get(r[5]) ?? zero5();
    add5(t, r.slice(0, 5));
    parts.set(r[5], t);
    n++;
  }
  return n ? bucketOut(parts).bucket : null;
}
