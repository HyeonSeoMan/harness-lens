// 결정론적 규칙 엔진(evaluation-rubric.md §1.3~§3). LLM이 아니라 이 코드가 0~3 수준을 정한다.
import { AXES, AXIS_MAX, AXIS_PREFIX, MATURITY_RULES } from './constants.mjs';
import { BAND_RULES } from './session-metrics.mjs';
import { compareCodeUnits, roundHalfEven, uniqueSorted } from './util.mjs';

const ruleLevel = (ruleId) => Number(/-L([0-3])-/.exec(ruleId)?.[1] ?? -1);

function addRule(ev, ruleId) {
  if (!ev.ruleIds.includes(ruleId)) ev.ruleIds.push(ruleId);
}

// 축 하나의 후보 수준을 모은다. 결과: [{ level, ruleId }]
function axisCandidates(axis, prim, ctx) {
  const cands = [];
  const push = (ruleId, evs) => {
    const capMax = Math.min(3, ...evs.map((e) => e.levelCap?.max ?? 3));
    cands.push({ level: Math.min(ruleLevel(ruleId), capMax), ruleId });
  };
  const prefix = AXIS_PREFIX[axis];
  // 근거 단위 규칙
  for (const ev of prim) for (const r of ev.ruleIds) if (r.startsWith(`${prefix}-L`)) push(r, [ev]);

  // 근거 집합 규칙
  if (axis === 'context_efficiency') {
    const sizes = prim.filter((e) => e._tags.family === 'size');
    if (sizes.length && sizes.every((e) => e._tags.alwaysLoadedLines <= 200)) {
      sizes.forEach((e) => addRule(e, 'CX-L1-01'));
      push('CX-L1-01', sizes);
    }
  }
  if (axis === 'execution_stability') {
    const agents = ctx.allEvidence.filter((e) => e._tags.agent && !e.void);
    const maxTurns = prim.filter((e) => e._tags.maxTurns);
    // ES-L3-04(0.2): Subagent가 2개 이상이고 모두 maxTurns를 가질 때만 3이다. 하나뿐이면 ES-L2-01(2)에 머문다.
    if (agents.length >= 2 && agents.every((a) => !a._tags.noMaxTurns) && maxTurns.length) {
      maxTurns.forEach((e) => addRule(e, 'ES-L3-04'));
      push('ES-L3-04', maxTurns);
    }
  }
  if (axis === 'autonomy') {
    const a = prim.filter((e) => e._tags.a);
    const ask = prim.filter((e) => e._tags.b === 'ask');
    const notif = prim.filter((e) => e._tags.b === 'notification');
    if (a.length && ask.length) {
      [...a, ...ask].forEach((e) => addRule(e, 'AU-L3-01'));
      push('AU-L3-01', [...a, ...ask]);
    } else if (a.length && notif.length) {
      [...a, ...notif].forEach((e) => addRule(e, 'AU-L2-01'));
      push('AU-L2-01', [...a, ...notif]);
    } else if (a.length || ask.length || notif.length) {
      const evs = [...a, ...ask, ...notif];
      evs.forEach((e) => addRule(e, 'AU-L1-02'));
      push('AU-L1-02', evs);
    }
  }
  if (axis === 'safety_boundary') {
    const managed = prim.filter((e) => e._tags.origin === 'managed' && (e.ruleIds.includes('SB-L2-02') || e.ruleIds.includes('SB-L2-03')));
    if (managed.length) {
      managed.forEach((e) => addRule(e, 'SB-L3-03'));
      push('SB-L3-03', managed);
    }
  }
  return cands;
}

export function computeAxes(col, { scope }) {
  const allEvidence = col.evidence;
  const ctx = { allEvidence };
  const unreadable = col.sources.some((s) => s.status === 'unreadable');
  const unscopedUser = col.sources.some((s) => s.reason === 'user_scope_not_collected');
  const unscopedManaged = col.sources.some((s) => s.reason === 'managed_settings_not_collected');
  const outOfScope = col.sources.some((s) => s.status === 'out_of_scope' && s.reason !== 'user_scope_not_collected' && s.reason !== 'managed_settings_not_collected');
  const totalAlwaysLines = col.alwaysLoaded.lines;
  return AXES.map((axis) => {
    const prefix = AXIS_PREFIX[axis];
    const prim = allEvidence.filter((e) => e.primaryAxis === axis && !e.void);
    const cands = axisCandidates(axis, prim, ctx);
    let level = null;
    let ruleId = null;
    let levelStatus = 'assessed';
    const capRuleIds = [];
    if (cands.length) {
      const best = Math.max(...cands.map((c) => c.level));
      ruleId = cands.filter((c) => c.level === best).map((c) => c.ruleId).sort(compareCodeUnits)[0];
      level = best;
      if (axis === 'context_efficiency' && totalAlwaysLines > 400 && level > 1) {
        level = 1;
        capRuleIds.push('CX-CAP-01');
      }
    } else if (unreadable) {
      levelStatus = 'unknown';
    } else {
      level = 0;
      ruleId = `${prefix}-L0-00`;
    }
    const axisMax = AXIS_MAX[axis];
    const reasons = [];
    let max = level ?? 0;
    // 0.2: 수집하지 않은 사용자·관리형 설정 파일이 실제로 있을 때만 넓힌다. 없으면 프로젝트 근거대로 좁게 둔다.
    if (scope === 'project' && unscopedUser && max < axisMax) { max = axisMax; reasons.push('user_scope_not_collected'); }
    if (scope === 'project' && unscopedManaged && axis === 'safety_boundary' && (level ?? 0) < axisMax) { max = axisMax; reasons.push('managed_settings_not_collected'); }
    if (unreadable) { max = axisMax; reasons.push('source_unreadable'); }
    if (outOfScope) { max = axisMax; reasons.push('source_out_of_scope'); }
    if (levelStatus === 'unknown') max = axisMax;
    if (axis === 'throughput') reasons.push('level3_reserved');
    const m = MATURITY_RULES[axis];
    return {
      axis,
      level,
      levelStatus,
      source: { ruleId, evidenceIds: uniqueSorted(prim.map((e) => e.id)), capRuleIds },
      range: { min: level ?? 0, max: Math.max(max, level ?? 0), reasonCodes: uniqueSorted(reasons) },
      maturity: null, // prepare 단계에서 채운다
      measured: null,
      _measurable: m.measurable,
    };
  });
}

// 근거 성숙도(루브릭 §1.8~§1.9). 세션 집계가 없으면 모든 축이 예측으로 남는다.
// info.samples: configSince 이후 프로젝트·워커 세션 수와 도구 호출 수(session-metrics.mjs).
export function computeMaturity(axes, sessions, info = {}) {
  const usable = sessions.status === 'available' || sessions.status === 'partial';
  const blocked = sessions.status === 'disabled' ? 'sessions_disabled' : sessions.reason ?? 'no_session_logs';
  const samples = info.samples ?? {};
  const metric = (id) => sessions.axisMetrics.find((x) => x.metricId === id);
  for (const a of axes) {
    const m = MATURITY_RULES[a.axis];
    delete a._measurable;
    if (!m.measurable) {
      a.maturity = { state: 'predicted', measurable: false, requirement: null, current: null, progress: null, blockedReason: m.blockedReason };
      continue;
    }
    const requirement = { unit: m.unit, required: m.required, heuristic: true };
    if (!usable) {
      a.maturity = { state: 'predicted', measurable: true, requirement, current: null, progress: null, blockedReason: blocked };
      continue;
    }
    // ES(0.3)는 대역 지표가 Bash 제외 오류율이라 표본도 Bash를 뺀 도구 호출(서브에이전트 포함)이다.
    const current = m.unit === 'sessions' ? (a.axis === 'throughput' ? samples.active_sessions ?? samples.sessions ?? 0 : samples.sessions ?? 0) : a.axis === 'execution_stability' ? samples.tool_calls_non_bash ?? 0 : samples.tool_calls_main ?? 0;
    const progress = roundHalfEven(Math.min(1, current / m.required), 4);
    const rule = BAND_RULES[a.axis];
    const main = rule && metric(rule.metric);
    if (current < m.required || !main) {
      a.maturity = { state: 'predicted', measurable: true, requirement, current, progress, blockedReason: current < m.required ? 'insufficient_samples' : 'metric_unavailable' };
      continue;
    }
    const values = Object.fromEntries(sessions.axisMetrics.filter((x) => x.axis === a.axis).map((x) => [x.metricId, x.value]));
    const band = rule.band(main.value, values);
    const used = [main, ...(a.axis === 'context_efficiency' && metric('compactions_per_session') ? [metric('compactions_per_session')] : [])];
    a.maturity = { state: 'measured', measurable: true, requirement, current, progress, blockedReason: null };
    a.measured = {
      band,
      bandRuleId: rule.ruleId,
      heuristic: true,
      metrics: used.map((x) => ({ metricId: x.metricId, value: x.value, unit: x.unit })),
      predictedLevel: a.level,
      deltaFromPredicted: a.level === null ? null : band - a.level,
      sampleSize: current,
    };
    // 실측 범위: 표본이 요구량의 2배 미만이면 band ± 1(§1.8).
    const narrow = current >= 2 * m.required;
    a.range = {
      min: narrow ? band : Math.max(0, band - 1),
      max: narrow ? band : Math.min(3, band + 1),
      reasonCodes: narrow ? ['measured_band'] : ['measured_band', 'sample_below_2x_requirement'],
    };
  }
  return axes;
}

// 빈 영역 종류(프로토콜 emptyAreas 행, V-EMPTY-AREAS). 0.3: 실측 상태 축은 구조 수준이 0이어도 실측이 있으므로 넣지 않는다.
// 빈 영역이 아니면 null.
export function emptyAreaKind(a) {
  if (a.levelStatus === 'unknown') return 'unknown';
  if (a.levelStatus === 'assessed' && a.level === 0 && a.maturity?.state !== 'measured') return 'unconfigured';
  return null;
}

// 긴장·시너지 트리거(루브릭 §3). 트리거가 맞은 조합만 후보로 낸다.
export function computeTensions(col, axes) {
  const evs = col.evidence.filter((e) => !e.void);
  const has = (ev, ...rules) => rules.some((r) => ev.ruleIds.includes(r));
  const ids = (list) => uniqueSorted(list.map((e) => e.id));
  const out = [];
  const add = (tensionId, kind, axesList, list) => {
    if (list.length) out.push({ tensionId, kind, axes: axesList, evidenceIds: ids(list) });
  };
  const level = Object.fromEntries(axes.map((a) => [a.axis, a.level]));
  const aSet = evs.filter((e) => e._tags.a);
  const A = 'autonomy';
  const VG = 'verification_gate_strength';
  const SB = 'safety_boundary';
  const TP = 'throughput';
  const CE = 'cost_efficiency';
  const CX = 'context_efficiency';
  const ES = 'execution_stability';
  const SC = 'spec_clarity';

  add('T1', 'tension', [VG, TP], evs.filter((e) => e._tags.hook && has(e, 'VG-L1-02', 'VG-L2-03', 'VG-L3-01', 'VG-L3-02')));
  add('T2', 'tension', [VG, CE], evs.filter((e) => has(e, 'VG-L2-01', 'VG-L2-02', 'VG-L3-03')));
  {
    const risky = aSet.filter((e) => ['auto', 'dontAsk', 'bypassPermissions'].includes(e._tags.defaultMode) || e._tags.bareBash);
    const guard = evs.some((e) => has(e, 'SB-L2-02', 'SB-L2-03'));
    if (!guard) add('T3', 'tension', [A, VG, SB], risky);
  }
  {
    const asks = evs.filter((e) => e._tags.b === 'ask');
    const askCount = asks.reduce((s, e) => s + (e._tags.askCount ?? 0), 0);
    const notif = evs.filter((e) => e._tags.b === 'notification');
    add('T4', 'tension', [VG, SB, A], [...(askCount >= 3 ? asks : []), ...notif]);
  }
  add('T5', 'tension', [A, CE, ES], evs.filter((e) => (e._tags.agent && e._tags.noMaxTurns) || (e._tags.blockingStop && !e._tags.reentry)));
  {
    const forks = evs.filter((e) => e._tags.fork);
    add('T6', 'tension', [CX, SC], [...(forks.length >= 3 ? forks : []), ...evs.filter((e) => e._tags.omitClaudeMd)]);
  }
  add('T7', 'tension', [SC, CX], evs.filter((e) => e._tags.family === 'size' && e._tags.alwaysLoadedLines > 200));
  add('T8', 'tension', [TP, CE], evs.filter((e) => has(e, 'TP-L2-01', 'TP-L2-02')));
  add('T9', 'tension', [CE, VG], evs.filter((e) => e._tags.reviewerHaiku || e._tags.envKey === 'MAX_THINKING_TOKENS'));
  {
    const mcp = evs.filter((e) => e._tags.mcp);
    const limited = evs.some((e) => e._tags.envKey === 'MAX_MCP_OUTPUT_TOKENS');
    if (!limited) add('T10', 'tension', [CX, SB], mcp);
  }
  if ((level[CX] ?? 0) >= 2) add('S1', 'synergy', [CX, CE], evs.filter((e) => e.primaryAxis === CX));
  add('S2', 'synergy', [VG, ES], evs.filter((e) => e.ruleIds.some((r) => r.startsWith('VG-L3-'))));
  {
    const deny = evs.filter((e) => has(e, 'SB-L2-03'));
    if (deny.length && aSet.length) add('S3', 'synergy', [SB, A], [...deny, ...aSet]);
  }
  return out;
}

// 지식 베이스 키(engine-cli.md §4.4.1). 존재하는 구성 요소의 항목만 넣는다.
export function knowledgeBaseKeys(col) {
  const keys = new Set();
  const kinds = new Set(col.components.map((c) => c.kind));
  if (kinds.has('hook')) keys.add('hooks');
  if (kinds.has('skill')) keys.add('skills');
  if (kinds.has('agent')) keys.add('subagents');
  if (kinds.has('mcp_server')) keys.add('mcp');
  for (const e of col.evidence) {
    if (e.void) continue;
    if (e.ruleIds.some((r) => r === 'VG-L2-01' || r === 'VG-L2-02')) keys.add('independent-review');
    if (e.ruleIds.some((r) => r.startsWith('VG-L3-'))) keys.add('verification-loop');
    if (e.ruleIds.includes('CX-L3-02')) keys.add('context-compaction');
    if (e.ruleIds.some((r) => r.startsWith('TP-L2-'))) keys.add('parallel-execution');
    if (e.ruleIds.some((r) => r === 'CE-L2-01' || r === 'CE-L2-02')) keys.add('model-routing');
  }
  return [...keys].sort(compareCodeUnits);
}
