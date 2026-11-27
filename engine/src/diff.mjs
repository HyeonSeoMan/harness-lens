// 두 분석의 결정론적 비교(engine-cli.md §4.7, FR-06). 수준과 구성만 보고 LLM 해석 텍스트는 보지 않는다.
// 구성 요소 ID는 (kind, origin, 식별 키)의 해시라서 같은 ID끼리 짝지으면 된다.
import { changeId, compareTuples } from './util.mjs';

const CHANGE_ORDER = { added: 0, removed: 1, modified: 2, unknown: 3 };

function blindPaths(doc) {
  return new Set(doc.engine.inventory.sources.filter((s) => s.status === 'unreadable' || s.status === 'out_of_scope').map((s) => s.path));
}

export function diffAnalyses(prev, cur) {
  const from = prev.meta.snapshotId;
  const to = cur.meta.snapshotId;
  const limitations = [];
  let comparability = 'full';
  const reasonAll = [];
  const limit = (code, message) => {
    if (comparability === 'full') comparability = 'limited';
    limitations.push({ code, message });
  };
  if (prev.schemaVersion !== cur.schemaVersion) {
    comparability = 'none';
    limitations.push({ code: 'schema_version_changed', message: `스키마 버전이 달라(${prev.schemaVersion} → ${cur.schemaVersion}) 변경 목록만 비교한다.` });
  } else {
    if (prev.rubricVersion !== cur.rubricVersion) {
      limit('rubric_version_changed', `루브릭 버전이 달라(${prev.rubricVersion} → ${cur.rubricVersion}) 축 수준을 비교할 수 없다.`);
      reasonAll.push('rubric_version_changed');
    }
    if (prev.meta.scope.preset !== cur.meta.scope.preset) {
      limit('scope_changed', `분석 범위가 달라(${prev.meta.scope.preset} → ${cur.meta.scope.preset}) 범위 밖 출처의 변경은 미확인이다.`);
    }
    if (prev.meta.engineInfo.sessionParserVersion !== cur.meta.engineInfo.sessionParserVersion) {
      limit('session_parser_changed', '세션 파서 버전이 달라 실측 상태 축은 비교할 수 없다.');
    }
  }

  const prevComps = new Map(prev.engine.inventory.components.map((c) => [c.id, c]));
  const curComps = new Map(cur.engine.inventory.components.map((c) => [c.id, c]));
  const prevBlind = blindPaths(prev);
  const curBlind = blindPaths(cur);
  const scopeChanged = prev.meta.scope.preset !== cur.meta.scope.preset;
  const outOfProject = (c) => c.origin === 'user' || c.origin === 'managed';
  const changes = [];
  const push = (c, change) => changes.push({
    changeId: changeId(from, to, c.id, change), componentId: c.id, kind: c.kind, name: c.name, change, paths: c.paths,
  });
  for (const c of curComps.values()) {
    const p = prevComps.get(c.id);
    if (!p) {
      const blind = c.paths.some((x) => prevBlind.has(x)) || (scopeChanged && outOfProject(c));
      push(c, blind ? 'unknown' : 'added');
    } else if (p.contentHash !== c.contentHash) {
      push(c, 'modified');
    }
  }
  for (const p of prevComps.values()) {
    if (curComps.has(p.id)) continue;
    const blind = p.paths.some((x) => curBlind.has(x)) || (scopeChanged && outOfProject(p));
    push(p, blind ? 'unknown' : 'removed');
  }
  changes.sort((a, b) => compareTuples([CHANGE_ORDER[a.change], a.kind, a.name, a.componentId], [CHANGE_ORDER[b.change], b.kind, b.name, b.componentId]));

  const axisDeltas = comparability === 'none' ? [] : cur.engine.axes.map((a) => {
    const p = prev.engine.axes.find((x) => x.axis === a.axis);
    const previousState = p?.maturity?.state ?? 'predicted';
    const currentState = a.maturity?.state ?? 'predicted';
    let comparable = true;
    let reason = null;
    if (reasonAll.length) { comparable = false; reason = reasonAll[0]; }
    else if (limitations.some((l) => l.code === 'session_parser_changed') && (previousState === 'measured' || currentState === 'measured')) {
      comparable = false; reason = 'session_parser_changed';
    } else if (previousState !== currentState) reason = 'maturity_changed';
    return { axis: a.axis, previousLevel: p?.level ?? null, currentLevel: a.level, previousState, currentState, comparable, reason };
  });

  return {
    previousSnapshotId: from,
    previousAnalyzedAt: prev.meta.analyzedAt,
    comparability,
    limitations,
    componentChanges: changes,
    axisDeltas,
  };
}
