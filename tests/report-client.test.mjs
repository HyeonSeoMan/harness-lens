// 리포트 화면 스크립트 테스트: 최소 DOM 대역으로 reportClient를 실행하고 그려진 표를 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { engine, makeProject, readJson, repoRoot } from './helpers.mjs';
import { reportClient } from '../engine/src/report/client.mjs';

class FakeNode {
  constructor(tag, text = null) { this.tag = tag; this.attrs = {}; this.children = []; this.text = text; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  get textContent() { return this.text ?? this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children = []; this.text = String(t); }
}

function render(analysis) {
  const app = new FakeNode('main');
  const data = { textContent: JSON.stringify({ analysis }) };
  const prev = globalThis.document;
  globalThis.document = {
    getElementById: (id) => (id === 'hl-data' ? data : id === 'app' ? app : null),
    createElement: (tag) => new FakeNode(tag),
    createElementNS: (_ns, tag) => new FakeNode(tag),
    createTextNode: (t) => new FakeNode('#text', t),
  };
  try { reportClient(); } finally { globalThis.document = prev; }
  return app;
}

function example() { return JSON.parse(readFileSync(path.join(repoRoot, 'examples/analysis.example.json'), 'utf8')); }
// 루트(#app)는 textContent = ''로 비운 뒤 자식을 붙이므로 자식에서 글자를 모은다.
const allText = (n) => (n.children.length ? n.children.map(allText).join('') : n.text ?? '');
const AXIS_KO = { execution_stability: '실행 안정성', autonomy: '자율성' };
const byClass = (cls) => (n) => (n.attrs.class || '').split(' ').includes(cls);

function findAll(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const c of node.children) findAll(c, pred, out);
  return out;
}

function tableAfterHeading(root, heading) {
  const sections = findAll(root, (n) => n.children.some((c) => c.tag === 'h3' && c.textContent === heading));
  assert.equal(sections.length, 1, `'${heading}' 제목이 한 번 있어야 한다`);
  const kids = sections[0].children;
  const table = kids.slice(kids.findIndex((c) => c.tag === 'h3' && c.textContent === heading) + 1).find((c) => findAll(c, (n) => n.tag === 'table').length);
  return findAll(table, (n) => n.tag === 'tr').map((tr) => tr.children.map((td) => td.textContent));
}

test('구성 요소 표의 역할(해석) 칸에 interpretation.components의 role을 표시한다', () => {
  const analysis = JSON.parse(readFileSync(path.join(repoRoot, 'examples/analysis.example.json'), 'utf8'));
  const rows = tableAfterHeading(render(analysis), '구성 요소');
  const header = rows[0];
  const roleCol = header.indexOf('역할(해석)');
  const nameCol = header.indexOf('이름');
  assert.ok(roleCol >= 0 && nameCol >= 0);
  const byName = Object.fromEntries(rows.slice(1).map((r) => [r[nameCol], r[roleCol]]));
  for (const c of analysis.interpretation.components) {
    const comp = analysis.engine.inventory.components.find((x) => x.id === c.componentId);
    assert.equal(byName[comp.name], c.role);
  }
  const described = new Set(analysis.interpretation.components.map((c) => c.componentId));
  for (const comp of analysis.engine.inventory.components) if (!described.has(comp.id)) assert.equal(byName[comp.name], '—');
});

test('투자·포기 목록은 실측 축에 구조 예측임과 실측 대역을 함께 적는다', () => {
  const analysis = JSON.parse(readFileSync(path.join(repoRoot, 'examples/analysis.example.json'), 'utf8'));
  const root = render(analysis);
  const block = findAll(root, (n) => n.tag === 'div' && n.children[0]?.tag === 'b' && n.children[0].textContent === '투자한 축')[0];
  const items = findAll(block, (n) => n.tag === 'li').map((n) => n.textContent);
  const axes = Object.fromEntries(analysis.engine.axes.map((a) => [a.axis, a]));
  assert.equal(items.length, analysis.interpretation.currentTradeoffs.investForgo.invested.length);
  analysis.interpretation.currentTradeoffs.investForgo.invested.forEach((id, i) => {
    const a = axes[id];
    if (a.maturity.state === 'measured') assert.match(items[i], new RegExp(`\\(구조 예측\\) · 실측 대역 ${a.measured.band}$`));
    else assert.doesNotMatch(items[i], /실측 대역/);
  });
});

// ---- 5단계 리포트 표시·라벨(stage5 backlog B10~B14, E, F, G 라벨) ----

test('B10 레이더: 구조 수준 점선 다각형은 실측 대역을 지나지 않고, 이웃 없는 실측 축은 실선 변 없이 점만 남는다', () => {
  const a = example();
  const root = render(a);
  const svg = findAll(root, (n) => n.tag === 'svg' && byClass('main')(n))[0];
  const meas = findAll(svg, byClass('pt-meas'));
  const measured = a.engine.axes.filter((x) => x.maturity.state === 'measured');
  assert.equal(meas.length, measured.length);
  for (const m of meas) assert.match(m.textContent, /실측 대역 \d \(세션 지표, 구조 수준과 다른 척도\)/);
  // 예시의 실측 축(실행 안정성·자율성)은 이웃하지 않으므로 실선 변이 없다.
  assert.equal(findAll(svg, (n) => n.tag === 'line' && n.attrs.class === 'cur').length, 0);
  // 구조 수준 빈 원은 실측 축을 포함해 수준이 있는 모든 축에 있다.
  assert.equal(findAll(svg, byClass('pt-pred')).length, a.engine.axes.filter((x) => x.level !== null).length);
  assert.equal(findAll(svg, byClass('pt-was')).length, 0);
  // 실측 축의 구조 수준(직전 예측)은 흐리게 겹친다.
  assert.equal(findAll(svg, byClass('faded')).length, measured.length);
  // 좌표: 구조 점선 변의 끝점은 구조 수준 점이고, 구조 수준과 실측 대역이 다른 축에서 실측 대역 점을 지나지 않는다.
  const n = a.engine.axes.length;
  const pt = (i, lv) => { const ang = (-90 + i * 360 / n) * Math.PI / 180; return [280 + 170 * lv / 3 * Math.cos(ang), 280 + 170 * lv / 3 * Math.sin(ang)]; };
  const near = (x, y, p) => Math.abs(Number(x) - p[0]) < 1e-6 && Math.abs(Number(y) - p[1]) < 1e-6;
  const structural = findAll(svg, (n) => n.tag === 'line' && n.attrs.class === 'cur predicted');
  assert.equal(structural.length, n);
  a.engine.axes.forEach((x, i) => {
    const j = (i + 1) % n;
    assert.ok(structural.some((l) => near(l.attrs.x1, l.attrs.y1, pt(i, x.level)) && near(l.attrs.x2, l.attrs.y2, pt(j, a.engine.axes[j].level))), `${x.axis} 구조 변`);
  });
  const differ = a.engine.axes.map((x, i) => [x, i]).filter(([x]) => x.measured && x.measured.band !== x.level);
  assert.ok(differ.length >= 1);
  for (const [x, i] of differ) {
    const band = pt(i, x.measured.band);
    assert.ok(!structural.some((l) => near(l.attrs.x1, l.attrs.y1, band) || near(l.attrs.x2, l.attrs.y2, band)), `${x.axis} 구조 변이 실측 대역을 지남`);
    const dot = meas.find((m) => m.textContent.startsWith(AXIS_KO[x.axis]));
    assert.ok(near(dot.attrs.cx, dot.attrs.cy, band));
  }
});

test('B10 레이더: 이웃한 두 축이 모두 실측이면 그 사이만 실선으로 잇는다', () => {
  const a = example();
  const ax = Object.fromEntries(a.engine.axes.map((x) => [x.axis, x]));
  const es = ax.execution_stability;
  ax.throughput.maturity = { ...es.maturity };
  ax.throughput.measured = { ...es.measured, band: 1, predictedLevel: 0, deltaFromPredicted: 1 };
  const svg = findAll(render(a), (n) => n.tag === 'svg' && byClass('main')(n))[0];
  assert.equal(findAll(svg, (n) => n.tag === 'line' && n.attrs.class === 'cur').length, 1);
});

test('B10 실측과 구조 수준의 차이는 점수 하락처럼 쓰지 않고, 상세 표는 두 값을 다른 칸에 둔다', () => {
  const a = example();
  const root = render(a);
  const text = allText(root);
  assert.doesNotMatch(text, /차이 [−+±]\d/);
  assert.match(text, /구조 수준 3 \/ 실측 대역 1\(다른 척도라 차이를 계산하지 않음\)/);
  assert.doesNotMatch(text, /단계 (낮음|높음)|대비 실측 대역이/);
  const rows = findAll(findAll(root, (n) => n.tag === 'section' && n.attrs.id === 'data')[0], (n) => n.tag === 'tr').map((tr) => tr.children.map((c) => c.textContent));
  const h = rows[0];
  assert.ok(h.includes('구조 수준') && h.includes('실측 대역') && !h.includes('수준'));
  const auto = rows.find((r) => r[0] === '자율성');
  assert.equal(auto[h.indexOf('구조 수준')], '3');
  assert.equal(auto[h.indexOf('실측 대역')], '1');
  assert.equal(auto[h.indexOf('가능 범위')], '0–2 (실측 대역 기준)');
});

test('B11·F 가능 범위는 어느 값의 범위인지 밝히고, 원시 사유 코드 대신 문장을 보인다', () => {
  const a = example();
  const text = allText(render(a));
  for (const code of ['user_scope_not_collected', 'managed_settings_not_collected', 'measured_band', 'sample_below_2x_requirement', 'level3_reserved']) {
    assert.ok(!text.includes(code), `${code}가 화면에 그대로 나오면 안 된다`);
  }
  assert.match(text, /자율성 실측 대역 1 \(실측\) · 구조 수준 3 강제 검증 · 실측 대역 범위 0–2 \(표본이 요구량의 2배 미만이라 실측 대역 ±1\)/);
  assert.match(text, /엔진 근거 \d+개 · 가능 범위 2–3 \(수집하지 않은 사용자 설정 파일이 있어 실제 수준이 더 높을 수 있음\)/);
  assert.match(text, /CI·PR 데이터 필요\(아직 수집하지 않음\)/);
  assert.doesNotMatch(text, /CI·PR 데이터 필요\(MVP 3\)/);
});

test('B14·E 세션 실측은 집계 창 둘(토큰 표·축 실측)과 창 길이를 눈에 띄게 적고, 귀속 칸에 구성 기준 시각을 섞지 않는다', () => {
  const a = example();
  const root = render(a);
  const notice = findAll(root, byClass('windows'))[0];
  assert.ok(notice && byClass('notice')(notice));
  assert.match(notice.textContent, /① 토큰·위치 표: 2026-10-29 ~ 2026-11-27 \(30일\(날짜 기준\), 귀속 세션 31개\)/);
  assert.match(notice.textContent, /② 축별 실측 지표.*2026-11-20T09:00:00Z 이후 \(분석 시각까지 7일 0시간, 프로젝트·워커 세션 12개\)/);
  assert.doesNotMatch(notice.textContent, /축 실측 창이 짧아/);
  const attrib = findAll(root, (n) => n.tag === 'div' && n.children[0]?.tag === 'b' && n.children[0].textContent === '귀속')[0];
  assert.doesNotMatch(attrib.textContent, /현재 구성 이후/);
  const rows = tableAfterHeading(root, '축별 실측 지표');
  assert.equal(rows[0][4], '집계 창');
  assert.ok(rows.slice(1).every((r) => r[4] === '② 현재 구성 이후' || r[4] === '① 누적'));
});

test('B14 축 실측 창은 분석 시각까지의 실제 경과로 적고, 7일 미만이면 경계값에서도 흔들릴 수 있다고 알린다', () => {
  // 분석 시각 2026-11-27T09:15:00Z. 마지막 기록 날짜의 다음 자정까지 늘리지 않는다.
  const cases = [
    ['2026-11-27T03:22:00Z', '5시간 53분', true],
    ['2026-11-20T10:00:00Z', '6일 23시간', true],
    ['2026-11-20T09:15:00Z', '7일 0시간', false],
    ['2026-11-27T09:10:00Z', '5분', true],
  ];
  for (const [since, span, warn] of cases) {
    const a = example();
    a.engine.sessions.coverage.configSince = since;
    const notice = findAll(render(a), byClass('windows'))[0];
    assert.match(notice.textContent, new RegExp(`${since} 이후 \\(분석 시각까지 ${span},`), since);
    assert.equal(/축 실측 창이 짧아/.test(notice.textContent), warn, since);
  }
});

test('B13 분석 세션의 집계 위치는 실행 위치에 따라 달라지고, 자기 비용은 프로젝트·워커 합계와 겹친다고 적는다', () => {
  const text = allText(render(example()));
  assert.doesNotMatch(text, /이번 분석을 실행한 세션도 여기에 들어갑니다|프로젝트 세션.에도 들어 있습니다/);
  assert.match(text, /이번 분석 세션은 실행한 곳에 따라 프로젝트 세션·워커 워크트리·오케스트레이터 봇 중 하나로 집계/);
  assert.match(text, /프로젝트 세션과 워커 워크트리 응답을 합한 값이라 세션 기록 실측의 두 위치 합계와 겹칩니다/);
});

test('E 턴별 p90과 축 지표 p90이 다르면 어느 창의 값인지 구분해 적는다', () => {
  const a = example();
  const m = a.engine.sessions.axisMetrics.find((x) => x.metricId === 'context_p90_tokens');
  m.value = 168315; m.sinceConfig = true;
  const text = allText(render(a));
  assert.match(text, /p90 92,000\(이 창 기준\)/);
  assert.match(text, /요청 입력 크기 p90 168,315은 현재 구성 이후\(② 창\) 요청만 센 값이라 위 p90 92,000과 다릅니다/);
});

test('B13·G 환산 설명은 위치별 표 바로 위에 두고, direct는 \u2018프로젝트 세션\u2019 하나로 부른다', () => {
  const a = example();
  const root = render(a);
  const sec = findAll(root, (n) => n.tag === 'section' && n.attrs.id === 'sessions')[0];
  const i = sec.children.findIndex((c) => c.tag === 'h3' && c.textContent.startsWith('위치별'));
  assert.match(sec.children[i + 1].textContent, /^환산값: 공개 가격표.*청구액이 아닙니다.*프로젝트 세션은 .*\(엔진 값 direct\)/);
  const rows = tableAfterHeading(root, '위치별 (환산값 비중)');
  const meth = rows[0].indexOf('귀속 방법');
  assert.ok(rows.slice(1).every((r) => !/직접/.test(r[meth])));
  assert.match(rows.find((r) => r[0] === '프로젝트 세션')[meth], /작업 경로 일치/);
});

test('F·G 비중 막대는 막대 안 글자 없이 범례에만 모든 항목(좁은 서브에이전트 칸 포함)을 한 번씩 적는다', () => {
  const root = render(example());
  const shares = findAll(root, (n) => n.tag === 'svg' && byClass('share')(n));
  assert.equal(shares.length, 2);
  for (const g of shares) assert.equal(findAll(g, (n) => n.tag === 'text').length, 0);
  const legend = findAll(root, (n) => n.tag === 'ul' && byClass('inline')(n)).map((n) => n.textContent);
  assert.ok(legend.some((t) => t.includes('서브에이전트 5.8%')));
  const items = findAll(root, (n) => n.tag === 'li').map((n) => n.textContent).filter((t) => t.startsWith('서브에이전트 '));
  assert.equal(items.length, 1);
});

test('F 일별 추이가 3일 미만이면 그래프 대신 문장으로, 그 이상이면 y축 눈금을 반올림한 값으로 그린다', () => {
  const a = example();
  const root = render(a);
  const labels = findAll(findAll(root, (n) => n.tag === 'svg' && byClass('trend')(n))[0], byClass('axislabel')).map((n) => n.textContent);
  assert.deepEqual(labels.slice(0, 3), ['0', '100,000', '200,000']);
  a.engine.sessions.contextPerTurn.series = a.engine.sessions.contextPerTurn.series.slice(-2);
  const short = render(a);
  assert.equal(findAll(short, (n) => n.tag === 'svg' && byClass('trend')(n)).length, 0);
  assert.match(findAll(short, byClass('trend-text'))[0].textContent, /^일별 추이는 2일치뿐이라 그래프 대신 값을 적습니다: 2026-11-25 요청 260개 · 중앙값 41,000 · 최대 161,000 토큰/);
});

test('G 접힌 모델별·도구별 표는 요약 줄에 항목 수를 적는다', () => {
  const summaries = findAll(render(example()), (n) => n.tag === 'summary').map((n) => n.textContent);
  // 열림 상태는 details가 보이므로 요약 줄은 펼쳐도 틀리지 않는 항목 수만 적는다.
  assert.ok(summaries.includes('모델별 (3개 모델)'));
  assert.ok(summaries.some((t) => /^도구별 호출·오류 \(\d+개 도구\)$/.test(t)));
  assert.ok(summaries.every((t) => !/접혀 있음|펼치기/.test(t)));
});

test('B12 축 상세는 차단 표지가 문자열 패턴 탐지임을 적고, Hook fact는 검증 판정에 쓰지 않는 이벤트의 검증 어휘를 구분한다', (t) => {
  const text = allText(render(example()));
  assert.match(text, /차단 표지.는 Hook 명령·스크립트.*문자열 패턴을 찾은 결과입니다\. 실행해 확인한 것이 아닙니다/);
  const p = makeProject('harness-after');
  t.after(p.cleanup);
  mkdirSync(path.join(p.project, '.claude'), { recursive: true });
  writeFileSync(path.join(p.project, '.claude/settings.json'), JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'npm test --silent' }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: 'npm run lint' }] }],
    PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npm run lint || exit 2' }] }],
  } }));
  const prep = engine(['prepare', '--project', p.project, '--out', p.out, '--now', '2026-11-27T09:00:00Z', '--no-sessions', '--json']);
  assert.equal(prep.code, 0, prep.stderr);
  const facts = readJson(path.join(path.dirname(prep.json.compactInventoryPath), 'draft.json')).engine.evidence.map((e) => e.fact).filter((f) => /Hook:/.test(f));
  const of = (ev) => facts.find((f) => f.startsWith(ev));
  assert.match(of('UserPromptSubmit'), /차단 표지\(문자열 패턴\) 없음, 검증 명령 어휘 있음\(이 이벤트는 검증 판정에 쓰지 않음\)/);
  assert.match(of('SessionEnd'), /검증 명령 어휘 있음\(이 이벤트는 검증 판정에 쓰지 않음\)/);
  assert.match(of('PostToolUse'), /차단 표지\(문자열 패턴\) 있음, 검증 명령 어휘\)$/);
});
