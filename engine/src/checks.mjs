// docs/spec/engine-cli.md §9 validate 의미 검사(V-*). 스키마로 표현할 수 없는 교차 참조·일관성 규칙을 확인한다.
import { emptyAreaKind } from './rubric.mjs';

const AXES = [
  'spec_clarity', 'verification_gate_strength', 'execution_stability', 'throughput',
  'cost_efficiency', 'context_efficiency', 'autonomy', 'safety_boundary',
];

const TOKEN_FIELDS = ['freshInput', 'cacheWrite', 'cacheRead', 'output'];

function sumBuckets(buckets) {
  const total = { freshInput: 0, cacheWrite: 0, cacheRead: 0, output: 0, weighted: 0 };
  for (const b of buckets) for (const k of Object.keys(total)) total[k] += b[k];
  return total;
}

function bucketsMatch(a, b) {
  return TOKEN_FIELDS.every((k) => a[k] === b[k]) && Math.abs(a.weighted - b.weighted) <= 0.5;
}

// 결과: [{ checkId, status: 'pass'|'fail', message }]
export function runSemanticChecks(doc) {
  const { engine, interpretation: llm } = doc;
  const results = [];
  const record = (checkId, problems) => results.push({
    checkId,
    status: problems.length ? 'fail' : 'pass',
    message: problems.length ? problems.join('; ') : null,
  });

  const evidenceById = new Map(engine.evidence.map((e) => [e.id, e]));
  const componentIds = new Set(engine.inventory.components.map((c) => c.id));
  const axisById = new Map(engine.axes.map((a) => [a.axis, a]));

  // V-REF-EVIDENCE: 모든 evidenceIds가 engine.evidence에 있다.
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
    record('V-REF-EVIDENCE', [...new Set(refs.filter((id) => !evidenceById.has(id)))].map((id) => `없는 근거 ${id}`));
  }

  // V-REF-COMPONENT: componentId 참조가 인벤토리에 있다(removed 변경은 이전 스냅샷 ID라 제외).
  {
    const refs = [
      ...engine.evidence.map((e) => e.componentId),
      ...llm.components.flatMap((c) => [c.componentId, ...c.dependsOn]),
      ...llm.findings.flatMap((f) => f.componentIds),
      ...llm.currentTradeoffs.componentTradeoffs.map((c) => c.componentId),
    ];
    if (engine.selfCost.componentId) refs.push(engine.selfCost.componentId);
    (engine.comparison?.componentChanges ?? []).filter((c) => c.change !== 'removed').forEach((c) => refs.push(c.componentId));
    record('V-REF-COMPONENT', [...new Set(refs.filter((id) => !componentIds.has(id)))].map((id) => `없는 구성 요소 ${id}`));
  }

  // V-REF-CHANGE / V-CHANGE-COVERAGE: 변경 트레이드오프는 comparison이 있을 때만, 모든 변경을 덮는다.
  {
    const problems = [];
    const changeIds = new Set((engine.comparison?.componentChanges ?? []).map((c) => c.changeId));
    if (engine.comparison === null && llm.changeTradeoffs !== null) problems.push('comparison이 없는데 changeTradeoffs가 있음');
    if (engine.comparison !== null && llm.changeTradeoffs === null) problems.push('comparison이 있는데 changeTradeoffs가 null');
    const covered = new Set();
    for (const c of llm.changeTradeoffs ?? []) {
      for (const id of c.changeIds) {
        if (!changeIds.has(id)) problems.push(`없는 변경 ${id}`);
        covered.add(id);
      }
    }
    record('V-REF-CHANGE', problems);
    record('V-CHANGE-COVERAGE', [...changeIds].filter((id) => !covered.has(id)).map((id) => `트레이드오프가 없는 변경 ${id}`));
  }

  // V-REF-TENSION: LLM은 엔진이 찾은 긴장 후보만 설명한다.
  {
    const candidates = new Set(engine.tensionCandidates.map((t) => t.tensionId));
    record('V-REF-TENSION', llm.currentTradeoffs.axisTensions
      .filter((t) => !candidates.has(t.tensionId)).map((t) => `후보에 없는 긴장 ${t.tensionId}`));
  }

  // V-REF-METRIC: measured finding은 실제 집계 지표를 인용한다.
  {
    const metricIds = new Set((engine.sessions.axisMetrics ?? []).map((m) => m.metricId));
    record('V-REF-METRIC', llm.findings.flatMap((f) => f.metricRefs)
      .filter((m) => !metricIds.has(m)).map((m) => `없는 지표 ${m}`));
  }

  // V-SINGLE-ATTRIBUTION: 수준 판정 근거는 그 축이 주 축이고 무력화되지 않았으며, 두 축에 쓰이지 않는다.
  {
    const problems = [];
    const usedBy = new Map();
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
    record('V-SINGLE-ATTRIBUTION', problems);
  }

  // V-AXIS-NOTES: 축 상세는 8개 축 모두 정확히 하나씩.
  {
    const seen = llm.axisNotes.map((n) => n.axis);
    const problems = AXES.filter((a) => !seen.includes(a)).map((a) => `축 상세 누락 ${a}`);
    if (new Set(seen).size !== seen.length) problems.push('축 상세 중복');
    record('V-AXIS-NOTES', problems);
  }

  // V-EMPTY-AREAS: 빈 영역은 엔진의 수준 0(unconfigured, 실측 상태 제외)·판정 불가(unknown) 축과 정확히 일치한다.
  {
    const expected = new Map();
    for (const a of engine.axes) {
      const kind = emptyAreaKind(a);
      if (kind) expected.set(a.axis, kind);
    }
    const problems = [];
    const actual = new Map(llm.currentTradeoffs.emptyAreas.map((e) => [e.axis, e.kind]));
    for (const [axis, kind] of expected) if (actual.get(axis) !== kind) problems.push(`빈 영역 ${axis}(${kind}) 누락 또는 종류 불일치`);
    for (const axis of actual.keys()) if (!expected.has(axis)) problems.push(`빈 영역이 아닌 축 ${axis}`);
    record('V-EMPTY-AREAS', problems);
  }

  // V-INVEST-FORGO: 투자 축은 구조 수준 2 이상, 포기 축은 1 이하 또는 판정 불가.
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
    record('V-INVEST-FORGO', problems);
  }

  // V-RANGE / V-MATURITY: 표시 값(실측이면 band, 아니면 level)이 범위 안에 있고 진행도가 계산과 맞는다.
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
        if (Math.abs(expected - m.progress) > 0.005) maturity.push(`${a.axis} 진행도 ${m.progress} ≠ ${expected.toFixed(3)}`);
        // 표본이 요구량에 닿았어도 대역 지표가 없으면 예측으로 남을 수 있다(blockedReason 필수).
        if (m.state === 'measured' && m.current < m.requirement.required) maturity.push(`${a.axis} 상태와 진행도 불일치`);
        if (m.state === 'predicted' && m.current >= m.requirement.required && !m.blockedReason) maturity.push(`${a.axis} 상태와 진행도 불일치`);
      }
      if (a.measured && a.measured.predictedLevel !== null
        && a.measured.deltaFromPredicted !== a.measured.band - a.measured.predictedLevel) {
        maturity.push(`${a.axis} deltaFromPredicted 계산 불일치`);
      }
    }
    record('V-RANGE', range);
    record('V-MATURITY', maturity);
  }

  // V-TOKEN-SUM: 합계 = 위치별 합 = 모델별 합. 미귀속은 합계에 섞지 않는다.
  {
    const problems = [];
    const tokens = engine.sessions.tokens;
    if (tokens) {
      if (!bucketsMatch(tokens.total, sumBuckets(tokens.byLocation.map((l) => l.tokens)))) problems.push('위치별 합 ≠ total');
      if (!bucketsMatch(tokens.total, sumBuckets(tokens.byModel.map((m) => m.tokens)))) problems.push('모델별 합 ≠ total');
      const share = tokens.byLocation.reduce((s, l) => s + l.weightedShare, 0);
      // 환산값이 0이면(귀속된 응답 없음) 비중은 모두 0이다.
      if (tokens.total.weighted > 0 ? Math.abs(share - 1) > 0.005 : share !== 0) problems.push(`위치별 비중 합 ${share}`);
    }
    record('V-TOKEN-SUM', problems);
  }

  return results;
}
