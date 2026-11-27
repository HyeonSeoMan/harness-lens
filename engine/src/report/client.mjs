// 리포트 화면 스크립트. render가 이 함수의 소스를 그대로 HTML에 넣으므로 바깥 변수를 참조하지 않는다.
// 데이터는 #hl-data JSON에서만 읽고, 화면에는 textContent로만 넣는다(XSS 방지).
export function reportClient() {
  'use strict';
  var data = JSON.parse(document.getElementById('hl-data').textContent);
  var doc = data.analysis;
  var meta = doc.meta;
  var eng = doc.engine;
  var interp = doc.interpretation;
  var cmp = eng.comparison;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var AXIS = {
    spec_clarity: '명세 명확성', verification_gate_strength: '검증 게이트 강도', execution_stability: '실행 안정성',
    throughput: '처리 속도', cost_efficiency: '비용 효율', context_efficiency: '컨텍스트 효율', autonomy: '자율성', safety_boundary: '안전 경계',
  };
  var LEVEL = ['0 미구성', '1 일부 구성', '2 명시적 구성', '3 강제 검증'];
  var KIND = {
    instructions: '지침', settings: '설정', hook: 'Hook', skill: 'Skill', agent: 'Subagent', mcp_server: 'MCP 서버', plugin: '플러그인', harness_lens: 'Harness Lens',
  };
  var ORIGIN = { project_shared: '프로젝트(공유)', project_local: '프로젝트(로컬)', user: '사용자', managed: '관리형', plugin: '플러그인' };
  var CHANGE = { added: '추가', removed: '삭제', modified: '수정', unknown: '미확인' };
  var CHANGE_MARK = { added: '+', removed: '−', modified: '~', unknown: '?' };
  var CONF = { low: '신뢰 낮음', medium: '신뢰 중간', high: '신뢰 높음' };
  var DIR = { increase: '↑ 증가', decrease: '↓ 감소', unclear: '? 불명' };
  var STATUS = { observed: '관찰 사실', inferred: '구조적 추정', measured: '실측', unknown: '미확인' };
  var FDIR = { potential_positive: '잠재적 이점', potential_negative: '잠재적 손실', mixed: '혼재', neutral: '중립', unknown: '불명' };
  var SRC = { read: '읽음', absent: '없음', unreadable: '읽지 못함', unsupported: '지원 안 함', out_of_scope: '범위 밖', skipped_sensitive: '민감 파일이라 열지 않음' };
  var BUDGET = {
    always_loaded_tokens: '평소 세션 상시 로드', background_processes: '백그라운드 프로세스', reanalysis_engine_ms: '재분석 엔진 시간',
    engine_max_rss_bytes: '엔진 최대 메모리', llm_input_inventory_tokens: 'LLM 입력 인벤토리', llm_tokens_per_analysis: '분석 1회 LLM 토큰',
  };
  var BSTATUS = { within: '예산 이내', exceeded: '초과', unmeasured: '미측정' };
  var BLOCKED = {
    needs_ci_pr_data: 'CI·PR 데이터 필요(MVP 3)', session_format_unconfirmed: '세션 기록 형식 미확인',
    sessions_disabled: '세션 집계 꺼짐', no_session_logs: '세션 기록 없음', session_format_unsupported: '세션 기록 형식 미지원',
    session_aggregation_failed: '세션 집계 오류', insufficient_samples: '표본 부족', metric_unavailable: '대역 지표 없음',
    no_attributed_sessions: '귀속된 세션 없음', session_lines_skipped: '해석 못 한 줄이 많음',
  };
  var LOC = { direct: '프로젝트 세션', worker: '워커 워크트리', subagent: '서브에이전트', bot: '오케스트레이터 봇' };
  var METHOD = { direct: '직접', worktree: '워크트리 gitdir', inferred: '추정(삭제된 워크트리)', configured: '설정 매핑', auto: '자동 귀속' };
  var TOKTYPE = [['freshInput', '새 입력'], ['cacheWrite', '캐시 쓰기'], ['cacheRead', '캐시 읽기'], ['output', '출력']];
  var METRIC = {
    tool_error_rate: '도구 오류율', tool_error_recovery_rate: '오류 뒤 회복률', hook_errors_per_session: '세션당 Hook 실패', api_retries_per_session: '세션당 API 재시도',
    turn_duration_p50_ms: '턴 시간 중앙값', session_duration_p50_ms: '세션 길이 중앙값', cache_hit_ratio: '캐시 적중률', weighted_tokens_per_session: '세션당 환산 토큰',
    context_p90_tokens: '요청 입력 크기 p90', compactions_per_session: '세션당 컨텍스트 압축', tool_calls_between_prompts_p50: '사람 입력 사이 도구 호출 중앙값',
    human_prompts_per_session: '세션당 사람 입력', hook_blocks_per_session: '세션당 Hook 차단(VG 대리 지표)',
  };
  function num(v) {
    if (v === null || v === undefined) return '—';
    var neg = v < 0, x = Math.abs(v), int = Math.floor(x), frac = x - int;
    var str = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (frac > 0) str += '.' + String(Math.round(frac * 10) % 10);
    return (neg ? '−' : '') + str;
  }
  function pct(v) { return (Math.round(v * 1000) / 10) + '%'; }
  function metricValue(m) {
    if (m.unit === 'ratio') return pct(m.value);
    if (m.unit === 'ms') return (m.value >= 60000 ? (Math.round(m.value / 6000) / 10) + '분' : (Math.round(m.value / 100) / 10) + '초');
    if (m.unit === 'tokens') return num(m.value) + ' 토큰';
    if (m.unit === 'per_session') return (Math.round(m.value * 100) / 100) + '회';
    return String(m.value);
  }

  var evidence = {};
  eng.evidence.forEach(function (e) { evidence[e.id] = e; });
  var components = {};
  eng.inventory.components.forEach(function (c) { components[c.id] = c; });
  var changes = {};
  (cmp ? cmp.componentChanges : []).forEach(function (c) { changes[c.changeId] = c; });
  var axisById = {};
  eng.axes.forEach(function (a) { axisById[a.axis] = a; });
  var prevLevel = {};
  var showPrev = !!(cmp && cmp.comparability !== 'none');
  if (cmp) cmp.axisDeltas.forEach(function (d) { prevLevel[d.axis] = d; });

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    append(node, children);
    return node;
  }
  function append(node, children) {
    if (children === undefined || children === null) return node;
    (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }
  function s(tag, attrs, children) {
    var node = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    append(node, children);
    return node;
  }
  function code(t) { return el('code', null, t); }
  function axisName(a) { return a ? AXIS[a] || a : '축 없음'; }
  function levelText(a) {
    if (a.levelStatus === 'unknown') return '판정 불가(미확인)';
    if (a.levelStatus === 'undefined') return '기준 없음';
    return '수준 ' + LEVEL[a.level];
  }
  function stateText(a) { return a.maturity.state === 'measured' ? '실측' : '예측'; }
  function evList(ids) {
    if (!ids || !ids.length) return el('p', { class: 'muted' }, '근거 없음');
    return el('ul', { class: 'tight' }, ids.map(function (id) {
      var e = evidence[id];
      if (!e) return el('li', null, [code(id), ' (알 수 없는 근거)']);
      return el('li', null, [e.fact, ' ', el('span', { class: 'muted' }, '— ' + e.path + (e.line ? ':' + e.line : '') + (e.keyPath ? ' ' + e.keyPath : '')), e.void ? el('span', { class: 'tag' }, '무력화 ' + e.void.ruleId) : null]);
    }));
  }
  function section(title, id) {
    var sec = el('section', { id: id });
    sec.appendChild(el('h2', null, title));
    app.appendChild(sec);
    return sec;
  }
  function table(headers, rows) {
    return el('div', { class: 'tablewrap' }, el('table', null, [
      el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { scope: 'col' }, h); }))),
      el('tbody', null, rows.map(function (r) { return el('tr', null, r.map(function (c) { return el('td', null, c); })); })),
    ]));
  }

  var app = document.getElementById('app');
  app.textContent = '';

  // ---------- 상단 ----------
  app.appendChild(el('h1', null, 'Harness Lens 리포트 — ' + meta.project.displayName));
  app.appendChild(el('p', { class: 'muted' }, '하네스 구성의 구조적 지원 수준과 트레이드오프. 최적화 방향은 사람이 결정합니다.'));
  var typeText = meta.analysisType === 'static' ? '정적 구성 분석(세션 실측 없음)' : '정적 구성 + 세션 기록 집계';
  app.appendChild(el('div', { class: 'meta panel' }, [
    ['프로젝트', meta.project.displayName],
    ['분석 시점', meta.analyzedAt],
    ['스냅샷 ID', meta.snapshotId],
    ['분석 기준 버전', '스키마 ' + doc.schemaVersion + ' · 루브릭 ' + doc.rubricVersion + ' · 엔진 ' + meta.engineInfo.version],
    ['데이터 유형', typeText],
    ['분석 범위', (meta.scope.preset === 'project' ? '프로젝트' : '프로젝트+사용자') + ' (' + meta.scope.sources.map(function (x) { return ORIGIN[x] || x; }).join(', ') + ')'],
    ['구성 해시', meta.configurationHash.slice(0, 19) + '…'],
    ['해석 작성', meta.analyzer.agent + ' · ' + (meta.analyzer.model || '모델 미확인')],
  ].map(function (kv) { return el('div', null, [el('b', null, kv[0]), kv[1]]); })));

  var measuredCount = eng.axes.filter(function (a) { return a.maturity.state === 'measured'; }).length;
  var bar = el('div', { class: 'bar', role: 'img', 'aria-label': '실측 ' + measuredCount + ' / ' + eng.axes.length + '축' });
  eng.axes.forEach(function (a) { bar.appendChild(el('span', { class: a.maturity.state === 'measured' ? 'seg on' : 'seg', title: AXIS[a.axis] + ' ' + stateText(a) })); });
  app.appendChild(el('div', { class: 'panel maturity' }, [
    el('b', null, '근거 성숙도'), bar, el('span', null, '실측 ' + measuredCount + ' / ' + eng.axes.length + '축'),
    measuredCount === 0 ? el('span', { class: 'muted' }, '지금은 구성 기반 예측입니다. 실제 성능 측정이 아닙니다.') : el('span', { class: 'muted' }, '실측 대역은 세션 기록 집계에 휴리스틱 임계값을 적용한 값입니다(상관관계, 인과 아님).'),
  ]));
  var sess = eng.sessions;
  var usable = sess.status === 'available' || sess.status === 'partial';
  if (!usable) {
    app.appendChild(el('p', { class: 'notice' }, '세션 기록 실측: ' + (BLOCKED[sess.reason] || sess.reason || BLOCKED[sess.status === 'disabled' ? 'sessions_disabled' : 'no_session_logs']) + '. 모든 축은 구성 기반 예측으로 표시합니다.'));
  } else if (sess.status === 'partial') {
    app.appendChild(el('p', { class: 'notice' }, '세션 기록 일부를 해석하지 못했습니다(' + pct(sess.coverage.skippedRatio) + '). 형식이 바뀌었을 수 있어 실측값을 조심해서 보세요.'));
  }
  if (interp.summary && interp.summary.length) {
    app.appendChild(el('div', { class: 'panel' }, [el('b', null, '요약'), el('ul', { class: 'summary tight' }, interp.summary.map(function (l) { return el('li', null, l); }))]));
  }

  // ---------- 레이더 ----------
  var radarSec = section('구조 프로필', 'profile');
  var W = 560, C = 280, R = 170;
  var n = eng.axes.length;
  function pt(i, level) {
    var ang = (-90 + i * 360 / n) * Math.PI / 180;
    var r = R * level / 3;
    return [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  }
  function value(a) { return a.measured ? a.measured.band : a.level; }
  var svg = s('svg', { class: 'radar main', viewBox: '0 0 ' + W + ' ' + W, role: 'img', 'aria-labelledby': 'radar-title' });
  svg.appendChild(s('title', { id: 'radar-title' }, '8개 축 구조 프로필 레이더 차트. 정확한 값은 아래 상세 수치 표에 있습니다.'));
  [1, 2, 3].forEach(function (lv) {
    svg.appendChild(s('polygon', { class: 'grid', points: eng.axes.map(function (_, i) { return pt(i, lv).join(','); }).join(' ') }));
    var p = pt(0, lv);
    svg.appendChild(s('text', { class: 'ringlabel', x: p[0] + 4, y: p[1] + 12 }, String(lv)));
  });
  eng.axes.forEach(function (a, i) {
    var end = pt(i, 3);
    svg.appendChild(s('line', { class: 'spoke', x1: C, y1: C, x2: end[0], y2: end[1] }));
    var lp = pt(i, 3.62);
    var anchor = Math.abs(lp[0] - C) < 10 ? 'middle' : lp[0] > C ? 'start' : 'end';
    var label = AXIS[a.axis] + (a.levelStatus === 'unknown' ? ' (판정 불가)' : a.axis === 'throughput' ? ' (최대 2)' : '');
    svg.appendChild(s('text', { x: lp[0], y: lp[1] + 4, 'text-anchor': anchor }, label));
    // 가능 범위
    var b0 = pt(i, a.range.min), b1 = pt(i, a.range.max);
    svg.appendChild(s('line', { class: 'band', x1: b0[0], y1: b0[1], x2: b1[0], y2: b1[1] }, s('title', null, AXIS[a.axis] + ' 가능 범위 ' + a.range.min + '–' + a.range.max)));
  });
  function drawProfile(getValue, cls, isSolidEdge) {
    eng.axes.forEach(function (a, i) {
      var j = (i + 1) % n;
      var v1 = getValue(eng.axes[i]), v2 = getValue(eng.axes[j]);
      if (v1 === null || v1 === undefined || v2 === null || v2 === undefined) return;
      var p1 = pt(i, v1), p2 = pt(j, v2);
      var solid = isSolidEdge(eng.axes[i], eng.axes[j]);
      svg.appendChild(s('line', { class: cls + (solid ? '' : ' predicted'), x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }));
    });
  }
  if (showPrev) {
    drawProfile(function (a) { var d = prevLevel[a.axis]; return d ? d.previousLevel : null; }, 'prev', function () { return true; });
    eng.axes.forEach(function (a, i) {
      var d = prevLevel[a.axis];
      if (!d || d.previousLevel === null) return;
      var p = pt(i, d.previousLevel);
      svg.appendChild(s('rect', { class: 'pt-prev', x: p[0] - 4, y: p[1] - 4, width: 8, height: 8 }, s('title', null, '이전 ' + AXIS[a.axis] + ' 수준 ' + d.previousLevel)));
    });
  }
  drawProfile(value, 'cur', function (x, y) { return x.maturity.state === 'measured' && y.maturity.state === 'measured'; });
  eng.axes.forEach(function (a, i) {
    var v = value(a);
    if (v === null) {
      var q = pt(i, 0.45);
      svg.appendChild(s('circle', { class: 'unknown', cx: q[0], cy: q[1], r: 9 }));
      svg.appendChild(s('text', { class: 'unknown-label', x: q[0], y: q[1] + 4, 'text-anchor': 'middle' }, '?'));
      return;
    }
    var p = pt(i, v);
    var measured = a.maturity.state === 'measured';
    if (measured && a.measured.predictedLevel !== null) {
      var w = pt(i, a.measured.predictedLevel);
      svg.appendChild(s('circle', { class: 'pt-was', cx: w[0], cy: w[1], r: 7 }, s('title', null, AXIS[a.axis] + ' 직전 예측 수준 ' + a.measured.predictedLevel)));
    }
    svg.appendChild(s('circle', { class: measured ? 'pt-meas' : 'pt-pred', cx: p[0], cy: p[1], r: 5.5 }, s('title', null, AXIS[a.axis] + ' ' + levelText(a) + ' (' + stateText(a) + ')')));
  });

  function legendIcon(kind) {
    var g = s('svg', { width: 46, height: 16, viewBox: '0 0 46 16', 'aria-hidden': 'true' });
    g.setAttribute('class', 'radar');
    if (kind === 'pred') { g.appendChild(s('line', { class: 'cur predicted', x1: 2, y1: 8, x2: 34, y2: 8 })); g.appendChild(s('circle', { class: 'pt-pred', cx: 38, cy: 8, r: 5 })); }
    if (kind === 'meas') { g.appendChild(s('line', { class: 'cur', x1: 2, y1: 8, x2: 34, y2: 8 })); g.appendChild(s('circle', { class: 'pt-meas', cx: 38, cy: 8, r: 5 })); }
    if (kind === 'prev') { g.appendChild(s('line', { class: 'prev', x1: 2, y1: 8, x2: 34, y2: 8 })); g.appendChild(s('rect', { class: 'pt-prev', x: 34, y: 4, width: 8, height: 8 })); }
    if (kind === 'was') { g.appendChild(s('circle', { class: 'pt-was', cx: 23, cy: 8, r: 6 })); }
    if (kind === 'band') { g.appendChild(s('line', { class: 'band', x1: 8, y1: 8, x2: 38, y2: 8 })); }
    if (kind === 'unknown') { g.appendChild(s('circle', { class: 'unknown', cx: 23, cy: 8, r: 6 })); g.appendChild(s('text', { class: 'unknown-label', x: 23, y: 12, 'text-anchor': 'middle' }, '?')); }
    return g;
  }
  var legend = el('ul', { class: 'legend' }, [
    el('li', null, [legendIcon('pred'), '현재 · 예측(구성 기반): 점선, 빈 원']),
    el('li', null, [legendIcon('meas'), '현재 · 실측: 실선, 채운 점 (변은 양 끝이 모두 실측일 때만 실선)']),
    showPrev ? el('li', null, [legendIcon('prev'), '이전 스냅샷 ' + cmp.previousSnapshotId + ': 점 무늬 선, 네모']) : null,
    el('li', null, [legendIcon('band'), '가능 범위: 수집 범위 밖·미확인 출처가 바꿀 수 있는 수준. 실측 축은 표본이 쌓일수록 좁아집니다']),
    measuredCount ? el('li', null, [legendIcon('was'), '실측 축의 직전 예측(구조적 수준): 흐린 점선 원']) : null,
    el('li', null, [legendIcon('unknown'), '판정 불가: 관련 출처를 읽지 못함(0점이 아님)']),
  ]);
  var axisList = el('ul', { class: 'tight' }, eng.axes.map(function (a) {
    var m = a.maturity;
    var unitName = m.requirement && (m.requirement.unit === 'sessions' ? '세션 ' : '도구 호출 ');
    var mt;
    if (!m.measurable) mt = '실측 불가: ' + (BLOCKED[m.blockedReason] || m.blockedReason);
    else if (m.state === 'measured') {
      var me = a.measured;
      mt = '실측 대역 ' + me.band + ' (' + me.bandRuleId + ', 휴리스틱) · ' + me.metrics.map(function (x) { return (METRIC[x.metricId] || x.metricId) + ' ' + metricValue(x); }).join(', ')
        + ' · 표본 ' + unitName + num(me.sampleSize) + '회' + (me.predictedLevel === null ? '' : ' · 직전 예측 ' + me.predictedLevel + ' → 차이 ' + (me.deltaFromPredicted > 0 ? '+' : me.deltaFromPredicted < 0 ? '−' : '±') + Math.abs(me.deltaFromPredicted));
    } else if (m.current === null) mt = '실측까지: ' + unitName + m.requirement.required + '회 · ' + (BLOCKED[m.blockedReason] || m.blockedReason);
    else mt = '실측까지: ' + unitName + num(m.current) + ' / ' + num(m.requirement.required) + '회 · ' + Math.round(m.progress * 100) + '% (기준은 휴리스틱)';
    var d = prevLevel[a.axis];
    var delta = d && d.comparable && d.previousLevel !== d.currentLevel ? ' · 이전 ' + (d.previousLevel === null ? '?' : d.previousLevel) + ' → 현재 ' + (d.currentLevel === null ? '?' : d.currentLevel) : '';
    var prog = m.measurable && m.progress !== null ? el('span', { class: 'mini', role: 'img', 'aria-label': '진행도 ' + Math.round(m.progress * 100) + '%' }, el('span', { style: 'width:' + Math.round(m.progress * 100) + '%' })) : null;
    var shownText = m.state === 'measured' ? '실측 대역 ' + a.measured.band : levelText(a);
    return el('li', null, [el('b', null, AXIS[a.axis]), ' ', shownText, ' (' + stateText(a) + ') · 가능 범위 ' + a.range.min + '–' + a.range.max + delta, el('br'), prog, el('span', { class: 'muted' }, mt)]);
  }));
  radarSec.appendChild(el('div', { class: 'radar-wrap' }, [
    el('div', { class: 'panel' }, svg),
    el('div', null, [legend, el('p', { class: 'notice' }, '레이더의 면적은 종합 점수가 아닙니다. 수준(0~3)은 구조적 지원 수준이며 실제 성능이 아닙니다. 축끼리 더하거나 하네스 간 순위를 매기지 마세요.'), axisList]),
  ]));

  // ---------- 세션 기록 실측 ----------
  function shareBar(parts, label) {
    // parts: [{ name, value, cls }]. 비중 막대 + 직접 라벨. 색만으로 구분하지 않도록 이름과 비율을 함께 적는다.
    var total = parts.reduce(function (t, x) { return t + x.value; }, 0);
    var W2 = 640, H2 = 28;
    var g = s('svg', { class: 'share', viewBox: '0 0 ' + W2 + ' ' + H2, role: 'img', 'aria-label': label + ': ' + parts.map(function (x) { return x.name + ' ' + (total ? pct(x.value / total) : '0%'); }).join(', ') });
    var x0 = 0;
    parts.forEach(function (x) {
      if (!total || !x.value) return;
      var w = x.value / total * W2;
      g.appendChild(s('rect', { class: 'seg ' + x.cls, x: x0, y: 0, width: Math.max(w - 2, 1), height: H2, rx: 3 }, s('title', null, x.name + ' ' + num(x.value) + ' (' + pct(x.value / total) + ')')));
      if (w > 110) g.appendChild(s('text', { x: x0 + 6, y: 18, class: x.cls === 'c3' || x.cls === 'c4' ? 'seglabel ink' : 'seglabel' }, x.name + ' ' + pct(x.value / total)));
      x0 += w;
    });
    var legend2 = el('ul', { class: 'legend inline' }, parts.map(function (x) {
      return el('li', null, [el('span', { class: 'swatch ' + x.cls, 'aria-hidden': 'true' }), x.name + ' ' + (total ? pct(x.value / total) : '0%')]);
    }));
    return el('div', { class: 'sharewrap' }, [g, legend2]);
  }
  function bucketRow(name, b) { return [name, num(b.freshInput), num(b.cacheWrite), num(b.cacheRead), num(b.output), num(b.weighted)]; }
  var TOKH = ['구분', '새 입력', '캐시 쓰기', '캐시 읽기', '출력', '환산값'];
  if (usable) {
    var sSec2 = section('세션 기록 실측', 'sessions');
    var cov = sess.coverage;
    sSec2.appendChild(el('div', { class: 'meta panel' }, [
      ['누적 집계 기간', sess.window ? sess.window.from + ' ~ ' + sess.window.to : '—'],
      ['원본 기록 범위', sess.window && sess.window.rawLogsFrom ? sess.window.rawLogsFrom + ' 이후(오래된 기록은 Claude Code가 정리)' : '원본 기록 없음(누적값만)'],
      ['Claude Code 버전', sess.clientVersions ? sess.clientVersions.min + ' ~ ' + sess.clientVersions.max : '미확인'],
      ['읽은 기록', '파일 ' + num(cov.filesScanned) + '개 · 줄 ' + num(cov.linesRead) + ' (건너뜀 ' + num(cov.linesSkipped) + ')' + (cov.incremental ? ' · 증분' : ' · 전체')],
      ['중복 제거', 'assistant 줄 ' + num(sess.dedup.assistantLines) + ' → 응답 ' + num(sess.dedup.uniqueResponses) + ' (합성 ' + sess.dedup.excludedSynthetic + ' · API 오류 ' + sess.dedup.excludedApiError + ' 제외)'],
      ['귀속', '귀속 세션 ' + num(cov.sessionsAttributed) + ' · 미귀속 ' + num(cov.sessionsUnattributed) + (cov.configSince ? ' · 현재 구성 이후 ' + cov.configSince.slice(0, 10) : '')],
    ].map(function (kv) { return el('div', null, [el('b', null, kv[0]), kv[1]]); })));
    sSec2.appendChild(el('p', { class: 'muted' }, '원문(대화·코드·도구 입력)은 읽어 두지 않고 숫자만 집계했습니다. 환산값은 공개 가격표(' + (sess.tokens ? sess.tokens.weighting.pricingTableVersion : '—') + ') 기준 ' + (sess.tokens ? sess.tokens.weighting.referenceModel : '') + ' 새 입력 토큰으로 환산한 상대값이며 청구액이 아닙니다.'));
    var tk = sess.tokens;
    if (tk) {
      sSec2.appendChild(el('h3', null, '토큰 종류별'));
      sSec2.appendChild(shareBar(TOKTYPE.map(function (t, i) { return { name: t[1], value: tk.total[t[0]], cls: 'c' + (i + 1) }; }), '토큰 종류별 비중(토큰 수)'));
      sSec2.appendChild(el('h3', null, '위치별 (환산값 비중)'));
      var locs = tk.byLocation.filter(function (l) { return l.sessions > 0 || l.tokens.weighted > 0; });
      sSec2.appendChild(shareBar(tk.byLocation.map(function (l, i) { return { name: LOC[l.location], value: l.tokens.weighted, cls: 'c' + (i + 1) }; }), '위치별 환산값 비중'));
      var bot = tk.byLocation.filter(function (l) { return l.location === 'bot'; })[0];
      var top = tk.byLocation.slice().sort(function (a, b) { return b.weightedShare - a.weightedShare; })[0];
      if (bot && bot.weightedShare > 0 && top.location === 'bot') {
        var crShare = tk.total.cacheRead ? bot.tokens.cacheRead / tk.total.cacheRead : 0;
        sSec2.appendChild(el('p', { class: 'notice' }, '오케스트레이터 봇 채팅이 환산값의 ' + pct(bot.weightedShare) + '로 가장 큽니다. 캐시 읽기의 ' + pct(crShare) + '가 봇 채팅에서 나왔습니다. 조율 비용이라 축 지표에서는 뺐습니다.'));
      }
      sSec2.appendChild(table(TOKH.concat(['비중', '세션', '귀속 방법']), locs.map(function (l) {
        var meth = Object.keys(l.attribution).filter(function (k) { return l.attribution[k] > 0; }).map(function (k) { return METHOD[k] + ' ' + l.attribution[k]; }).join(', ');
        return bucketRow(LOC[l.location], l.tokens).concat([pct(l.weightedShare), num(l.sessions), meth || '—']);
      }).concat([bucketRow(el('b', null, '합계(귀속분)'), tk.total).concat(['100%', num(cov.sessionsAttributed), '']),
        bucketRow(el('span', { class: 'muted' }, '미귀속(합계 제외)'), tk.unattributed.tokens).concat(['—', num(tk.unattributed.sessions), '봇 ' + tk.unattributed.botSessions])])));
      if (tk.byModel.length) {
        sSec2.appendChild(el('details', null, [el('summary', null, '모델별'), table(TOKH, tk.byModel.map(function (m) { return bucketRow(m.model, m.tokens); }))]));
      }
    }
    var cpt = sess.contextPerTurn;
    if (cpt) {
      sSec2.appendChild(el('h3', null, '턴별 컨텍스트 크기'));
      var dist = cpt.distribution;
      if (cpt.p50 === null) sSec2.appendChild(el('p', { class: 'notice' }, '최근 ' + dist.retentionDays + '일 안의 원시 요청이 없어 분포(중앙값·p90·최대)는 미확인입니다. 아래 일별 추이는 접어 둔 누적 요약입니다. 컨텍스트 압축 ' + cpt.compactions + '회.'));
      else sSec2.appendChild(el('p', null, '메인 스레드 요청 ' + num(cpt.requests) + '개(' + dist.from + ' ~ ' + dist.to + ', 최근 ' + dist.retentionDays + '일 원시 기록)의 입력 크기(새 입력+캐시 쓰기+캐시 읽기): 중앙값 ' + num(cpt.p50) + ' · p90 ' + num(cpt.p90) + ' · 최대 ' + num(cpt.max) + ' 토큰. 세션 첫 요청 중앙값 ' + num(cpt.firstRequestP50) + ' · 컨텍스트 압축 ' + cpt.compactions + '회.'));
      if (cpt.series.some(function (p) { return p.source === 'archive'; })) sSec2.appendChild(el('p', { class: 'muted' }, '‘근사’ 표시 날은 ' + dist.retentionDays + '일이 지나 일별 요약으로 접은 날입니다. 요청 수·최대는 정확하고 중앙값은 근사일 수 있습니다.'));
      if (cpt.series.length) sSec2.appendChild(trendChart(cpt.series));
    }
    if (sess.axisMetrics.length) {
      sSec2.appendChild(el('h3', null, '축별 실측 지표'));
      sSec2.appendChild(table(['축', '지표', '값', '표본', '범위'], sess.axisMetrics.map(function (m) {
        return [AXIS[m.axis], METRIC[m.metricId] || m.metricId, metricValue(m), num(m.sampleSize), m.sinceConfig ? '현재 구성 이후' : '전체'];
      })));
    }
  }
  function trendChart(series) {
    var W3 = 640, H3 = 200, L = 64, Rt = 12, T = 12, B = 30;
    var maxV = Math.max.apply(null, series.map(function (p) { return p.max; })) || 1;
    var n3 = series.length;
    var xOf = function (i) { return n3 === 1 ? L + (W3 - L - Rt) / 2 : L + i * (W3 - L - Rt) / (n3 - 1); };
    var yOf = function (v) { return T + (H3 - T - B) * (1 - v / maxV); };
    var g = s('svg', { class: 'trend', viewBox: '0 0 ' + W3 + ' ' + H3, role: 'img', 'aria-label': '일별 요청 입력 크기 추이. 정확한 값은 아래 표에 있습니다.' });
    [0, 0.5, 1].forEach(function (f) {
      var y = yOf(maxV * f);
      g.appendChild(s('line', { class: 'gridline', x1: L, x2: W3 - Rt, y1: y, y2: y }));
      g.appendChild(s('text', { class: 'axislabel', x: L - 6, y: y + 4, 'text-anchor': 'end' }, num(Math.round(maxV * f))));
    });
    [0, n3 - 1].filter(function (v, i, arr) { return arr.indexOf(v) === i; }).forEach(function (i) {
      g.appendChild(s('text', { class: 'axislabel', x: xOf(i), y: H3 - 8, 'text-anchor': i === 0 && n3 > 1 ? 'start' : 'end' }, series[i].date));
    });
    [['max', 'line-max'], ['p50', 'line-p50']].forEach(function (k) {
      if (n3 > 1) g.appendChild(s('polyline', { class: k[1], points: series.map(function (p, i) { return xOf(i) + ',' + yOf(p[k[0]]); }).join(' ') }));
      series.forEach(function (p, i) {
        g.appendChild(s('circle', { class: 'dot ' + k[1], cx: xOf(i), cy: yOf(p[k[0]]), r: 4 }, s('title', null, p.date + ' ' + (k[0] === 'max' ? '최대 ' : '중앙값 ') + num(p[k[0]]) + ' 토큰 · 요청 ' + p.requests + (p.source === 'archive' ? ' · 근사' : ''))));
      });
    });
    var lg = el('ul', { class: 'legend inline' }, [
      el('li', null, [el('span', { class: 'swatch line-p50', 'aria-hidden': 'true' }), '일별 중앙값(실선)']),
      el('li', null, [el('span', { class: 'swatch line-max dashed', 'aria-hidden': 'true' }), '일별 최대(점선)']),
    ]);
    return el('div', null, [el('div', { class: 'panel' }, [g, lg]), el('details', null, [el('summary', null, '일별 표'), table(['날짜', '요청', '중앙값', '최대', '출처'], series.map(function (p) { return [p.date, num(p.requests), num(p.p50), num(p.max), p.source === 'archive' ? '근사(누적 요약)' : '원시 기록']; }))])]);
  }

  // ---------- 변경 내역 ----------
  if (cmp) {
    var chSec = section('변경 내역', 'changes');
    var compText = { full: '전체 비교 가능', limited: '일부만 비교 가능', none: '비교 불가(변경 목록만)' }[cmp.comparability];
    chSec.appendChild(el('p', null, ['이전 스냅샷 ', code(cmp.previousSnapshotId), ' (' + cmp.previousAnalyzedAt + ') 대비 · ', el('b', null, compText)]));
    cmp.limitations.forEach(function (l) { chSec.appendChild(el('p', { class: 'notice' }, l.message)); });
    if (!cmp.componentChanges.length) chSec.appendChild(el('p', { class: 'muted' }, '구성 요소 변경이 없습니다.'));
    else chSec.appendChild(table(['변경', '종류', '구성 요소', '근거 파일'], cmp.componentChanges.map(function (c) {
      return [el('span', { class: 'chg-' + c.change }, CHANGE_MARK[c.change] + ' ' + CHANGE[c.change]), KIND[c.kind] || c.kind, c.name, c.paths.join(', ')];
    })));
    var moved = cmp.axisDeltas.filter(function (d) { return d.previousLevel !== d.currentLevel || d.reason; });
    if (moved.length) chSec.appendChild(el('ul', { class: 'tight' }, moved.map(function (d) {
      return el('li', null, AXIS[d.axis] + ': ' + (d.previousLevel === null ? '?' : d.previousLevel) + ' → ' + (d.currentLevel === null ? '?' : d.currentLevel) + (d.comparable ? '' : ' (비교 불가: ' + d.reason + ')'));
    })));
  }

  // ---------- 현재 구성의 트레이드오프 ----------
  var ct = interp.currentTradeoffs;
  var tSec = section('현재 구성의 트레이드오프', 'tradeoffs');
  tSec.appendChild(el('h3', null, '투자와 포기'));
  tSec.appendChild(el('div', { class: 'panel' }, [
    el('p', null, ct.investForgo.summary),
    el('div', { class: 'grid2' }, [
      el('div', null, [el('b', null, '투자한 축'), el('ul', { class: 'tight' }, ct.investForgo.invested.map(function (a) { return el('li', null, AXIS[a] + ' — ' + levelText(axisById[a])); }))]),
      el('div', null, [el('b', null, '내준 축'), el('ul', { class: 'tight' }, ct.investForgo.forgone.map(function (a) { return el('li', null, AXIS[a] + ' — ' + levelText(axisById[a])); }))]),
    ]),
    el('details', null, [el('summary', null, '근거'), evList(ct.investForgo.evidenceIds)]),
  ]));
  tSec.appendChild(el('h3', null, '구성 요소별 득실'));
  if (!ct.componentTradeoffs.length) tSec.appendChild(el('p', { class: 'muted' }, '득실이 함께 있는 구성 요소가 없습니다.'));
  else tSec.appendChild(table(['구성 요소', '얻는 것', '치르는 비용', '신뢰'], ct.componentTradeoffs.map(function (c) {
    var comp = components[c.componentId];
    var fx = function (list) { return el('ul', { class: 'tight' }, list.map(function (x) { return el('li', null, AXIS[x.axis] + ': ' + x.text); })); };
    return [comp ? (KIND[comp.kind] || comp.kind) + ' ' + comp.name : c.componentId, fx(c.gains), fx(c.costs), CONF[c.confidence]];
  })));
  tSec.appendChild(el('h3', null, '축 간 긴장'));
  var cand = {};
  eng.tensionCandidates.forEach(function (t) { cand[t.tensionId] = t; });
  if (!ct.axisTensions.length) tSec.appendChild(el('p', { class: 'muted' }, '현재 구성에서 근거가 있는 긴장 조합이 없습니다.'));
  ct.axisTensions.forEach(function (t) {
    var c = cand[t.tensionId];
    var axesTxt = c ? c.axes.map(axisName).join(c.kind === 'synergy' ? ' → ' : ' ↔ ') : '';
    tSec.appendChild(el('div', { class: 'panel' }, [
      el('b', null, [code(t.tensionId), ' ', (c && c.kind === 'synergy' ? '시너지 ' : '긴장 ') + axesTxt]),
      el('p', null, t.explanation),
      el('p', { class: 'muted' }, '조건: ' + t.condition + ' · ' + CONF[t.confidence]),
      el('details', null, [el('summary', null, '근거'), evList(t.evidenceIds)]),
    ]));
  });
  tSec.appendChild(el('h3', null, '빈 영역'));
  if (!ct.emptyAreas.length) tSec.appendChild(el('p', { class: 'muted' }, '미구성이거나 판정 불가인 축이 없습니다.'));
  else tSec.appendChild(table(['축', '상태', '의미', '확인 방법'], ct.emptyAreas.map(function (e) {
    return [AXIS[e.axis], e.kind === 'unknown' ? '판정 불가(미확인)' : '미구성(수준 0)', e.meaning, e.howToConfirm];
  })));

  // ---------- 변경 트레이드오프 ----------
  if (cmp && interp.changeTradeoffs) {
    var cSec = section('변경 트레이드오프', 'change-tradeoffs');
    interp.changeTradeoffs.forEach(function (c) {
      var fx = function (title, list) {
        if (!list.length) return null;
        return el('div', null, [el('b', null, title), el('ul', { class: 'tight' }, list.map(function (x) {
          return el('li', null, [AXIS[x.axis] + ' ' + DIR[x.direction] + ': ' + x.text, el('br'), el('span', { class: 'muted' }, '조건: ' + x.condition + ' · ' + CONF[x.confidence])]);
        }))]);
      };
      cSec.appendChild(el('div', { class: 'panel' }, [
        el('p', null, [el('b', null, '대상 변경: '), c.changeIds.map(function (id) { var ch = changes[id]; return ch ? CHANGE_MARK[ch.change] + ' ' + (KIND[ch.kind] || ch.kind) + ' ' + ch.name : id; }).join(', ')]),
        c.multiChangeCaveat ? el('p', { class: 'notice' }, '여러 구성 요소가 함께 바뀌어 개별 효과를 확정할 수 없습니다.') : null,
        el('div', { class: 'grid2' }, [fx('기대 효과', c.expectedEffects), fx('잠재적 손실', c.potentialLosses)]),
        c.unknownImpacts.length ? el('div', null, [el('b', null, '영향 불명'), el('ul', { class: 'tight' }, c.unknownImpacts.map(function (u) { return el('li', null, (u.axis ? AXIS[u.axis] + ': ' : '') + u.text); }))]) : null,
        el('div', null, [el('b', null, '검증 방법'), el('ul', { class: 'tight' }, c.validation.map(function (v) { return el('li', null, v); }))]),
      ]));
    });
  }

  // ---------- 축 상세 ----------
  var aSec = section('축 상세', 'axes');
  var notes = {};
  interp.axisNotes.forEach(function (x) { notes[x.axis] = x; });
  eng.axes.forEach(function (a) {
    var note = notes[a.axis];
    var fs = interp.findings.filter(function (f) { return f.axis === a.axis; });
    var list = function (title, arr) { return arr && arr.length ? el('div', null, [el('b', null, title), el('ul', { class: 'tight' }, arr.map(function (x) { return el('li', null, x); }))]) : null; };
    aSec.appendChild(el('div', { class: 'panel axis-card', id: 'axis-' + a.axis }, [
      el('h3', null, [AXIS[a.axis], el('span', { class: 'tag' }, levelText(a)), el('span', { class: 'tag' }, stateText(a)), a.source.ruleId ? code(a.source.ruleId) : null].concat(a.source.capRuleIds.map(function (r) { return el('span', { class: 'tag' }, '상한 ' + r); }))),
      note ? el('p', null, [el('b', null, '판단 근거: '), note.rationale]) : null,
      note ? list('조건', note.conditions) : null,
      note ? list('반례 가능성', note.counterexamples) : null,
      note ? list('추가 검증 방법', note.validation) : null,
      fs.length ? el('div', null, [el('b', null, '발견'), el('ul', { class: 'tight' }, fs.map(findingItem))]) : null,
      el('details', null, [el('summary', null, '엔진 근거 ' + a.source.evidenceIds.length + '개 · 가능 범위 ' + a.range.min + '–' + a.range.max + (a.range.reasonCodes.length ? ' (' + a.range.reasonCodes.join(', ') + ')' : '')), evList(a.source.evidenceIds)]),
    ]));
  });
  function findingItem(f) {
    return el('li', null, [
      el('span', { class: 'tag' }, STATUS[f.status]), el('span', { class: 'tag' }, FDIR[f.direction]), f.statement,
      f.condition ? el('span', { class: 'muted' }, ' — 조건: ' + f.condition) : null,
      f.validation ? el('span', { class: 'muted' }, ' · 확인: ' + f.validation) : null,
      f.unknownReason ? el('span', { class: 'muted' }, ' · 미확인 사유: ' + f.unknownReason) : null,
      el('span', { class: 'muted' }, ' · ' + CONF[f.confidence]),
    ]);
  }
  var general = interp.findings.filter(function (f) { return f.axis === null; });
  if (general.length) {
    aSec.appendChild(el('h3', null, '축에 속하지 않는 발견'));
    aSec.appendChild(el('ul', { class: 'tight' }, general.map(findingItem)));
  }

  // ---------- 상세 수치 표 ----------
  var dSec = section('상세 수치 표', 'data');
  dSec.appendChild(el('p', { class: 'muted' }, '레이더 차트와 같은 데이터입니다.'));
  dSec.appendChild(table(['축', '수준', '상태', '가능 범위', '결정 규칙', '근거 수', '이전 수준', '비교'], eng.axes.map(function (a) {
    var d = prevLevel[a.axis];
    return [AXIS[a.axis], a.level === null ? '판정 불가' : String(a.level), stateText(a) + (a.levelStatus === 'unknown' ? ' · 미확인' : ''), a.range.min + '–' + a.range.max,
      a.source.ruleId ? code(a.source.ruleId) : '—', String(a.source.evidenceIds.length),
      d ? (d.previousLevel === null ? '판정 불가' : String(d.previousLevel)) : '—',
      d ? (d.comparable ? (d.previousLevel === d.currentLevel ? '같음' : '변경') : '비교 불가') : '첫 분석'];
  })));
  var role = {};
  interp.components.forEach(function (c) { role[c.componentId] = c; });
  dSec.appendChild(el('h3', null, '구성 요소'));
  dSec.appendChild(table(['종류', '이름', '출처', '경로', '역할(해석)'], eng.inventory.components.map(function (c) {
    var r = role[c.componentId];
    return [KIND[c.kind] || c.kind, c.name, ORIGIN[c.origin] || c.origin, c.paths.join(', '), r ? r.role : el('span', { class: 'muted' }, '—')];
  })));

  // ---------- 자기 비용 ----------
  var sc = eng.selfCost;
  var sSec = section('Harness Lens 자기 비용', 'self-cost');
  sSec.appendChild(el('p', null, 'Harness Lens도 하네스의 구성 요소입니다. 평소 세션 상시 로드 약 ' + sc.alwaysLoadedTokens.value + '토큰(추정), 상주 프로세스·상시 Hook 없음.'));
  sSec.appendChild(table(['예산', '목표', '관측', '상태'], sc.budgets.map(function (b) {
    var fmt = function (v) { return v === null ? '—' : b.unit === 'bytes' ? (v / 1048576).toFixed(1) + ' MiB' : v + ' ' + b.unit; };
    return [BUDGET[b.budgetId] || b.budgetId, fmt(b.target), fmt(b.observed), BSTATUS[b.status]];
  })));
  if (sc.currentRun.length) sSec.appendChild(el('p', { class: 'muted' }, '이번 분석 엔진 실행: ' + sc.currentRun.map(function (r) { return r.subcommand + ' ' + r.durationMs + 'ms'; }).join(' · ')));
  var pa = sc.previousAnalysis;
  if (!pa) sSec.appendChild(el('p', { class: 'muted' }, '직전 분석 기록 없음. 다음 분석에서 이번 분석의 토큰·시간을 세션 기록으로 측정합니다.'));
  else {
    sSec.appendChild(el('p', null, '직전 분석(' + pa.snapshotId + '): 걸린 시간 ' + (pa.wallClockMs === null ? '미확인' : (Math.round(pa.wallClockMs / 100) / 10) + '초') + ' · LLM 토큰 ' + (pa.llmTokens
      ? '새 입력 ' + num(pa.llmTokens.freshInput) + ' + 캐시 쓰기 ' + num(pa.llmTokens.cacheWrite) + ' + 출력 ' + num(pa.llmTokens.output) + ' (캐시 읽기 ' + num(pa.llmTokens.cacheRead) + ' 별도, 환산 ' + num(pa.llmTokens.weighted) + ')'
      : '미측정(그 구간의 귀속 세션 기록 없음)')));
    if (pa.llmTokens) sSec.appendChild(el('p', { class: 'muted' }, 'prepare 시작~finalize 끝 구간에 이 프로젝트에 귀속된 메인 스레드 응답을 모두 셉니다. 같은 시간에 다른 작업을 했다면 함께 들어갑니다.'));
  }

  // ---------- 한계 ----------
  var lSec = section('한계와 미확인 영역', 'limitations');
  var lims = eng.limitations.map(function (l) { return l.message; }).concat(interp.limitations);
  lSec.appendChild(el('ul', { class: 'tight' }, lims.map(function (l) { return el('li', null, l); })));
  var notRead = eng.inventory.sources.filter(function (x) { return x.status !== 'read' && x.status !== 'absent'; });
  if (notRead.length) {
    lSec.appendChild(el('h3', null, '읽지 않았거나 읽지 못한 출처'));
    lSec.appendChild(table(['경로', '출처', '상태', '사유'], notRead.map(function (x) { return [x.path, ORIGIN[x.origin] || x.origin, SRC[x.status] || x.status, x.reason || '—']; })));
  }
  if (eng.inventory.redactions.length) {
    lSec.appendChild(el('p', null, '비밀정보 제거: ' + eng.inventory.redactions.map(function (r) { return r.kind + ' ' + r.count + '건'; }).join(', ') + ' (값은 저장하지 않음)'));
  }
  app.appendChild(el('footer', null, 'Harness Lens 엔진 ' + meta.engineInfo.version + ' · 검증 ' + doc.validation.status + ' (' + doc.validation.checkedAt + ') · 이 리포트는 외부 리소스 없이 오프라인에서 동작합니다.'));
}
