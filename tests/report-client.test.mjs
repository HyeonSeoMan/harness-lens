// 리포트 화면 스크립트 테스트: 최소 DOM 대역으로 reportClient를 실행하고 그려진 표를 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './helpers.mjs';
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
