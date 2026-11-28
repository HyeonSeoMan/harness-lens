// 리포트 CSS. 외부 글꼴·리소스 없이 라이트·다크 모두 동작한다.
export const REPORT_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1d1b; --muted: #5f5f5a; --line: #d8d8d2;
  --grid: #c9c9c2; --current: #1f5fbf; --previous: #7a7a72; --band: rgba(31, 95, 191, 0.16);
  --warn-bg: #fff4dc; --warn-line: #c98a00; --added: #1d7a3a; --removed: #b3261e; --modified: #8a5a00;
  --code-bg: #efefea;
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --panel: #1f1f1d; --text: #ecece6; --muted: #a3a39b; --line: #3a3a36;
    --grid: #4a4a45; --current: #7fb0ff; --previous: #9c9c94; --band: rgba(127, 176, 255, 0.20);
    --warn-bg: #3a2f14; --warn-line: #e0a830; --added: #6fcf8a; --removed: #ff8a80; --modified: #e6b450;
    --code-bg: #2a2a27;
    --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 32px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 16px; margin: 18px 0 8px; }
p { margin: 6px 0; }
/* 긴 비분리 문자열(경로·식별자)이 페이지 폭을 넘기지 않게 한다. 표는 .tablewrap 가로 스크롤에 맡긴다. */
p, li, summary, .meta div { overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px 18px; margin: 12px 0; }
.meta div { font-size: 13px; }
.meta b { display: block; color: var(--muted); font-weight: 600; font-size: 12px; }
.notice { border-left: 4px solid var(--warn-line); background: var(--warn-bg); padding: 8px 12px; border-radius: 4px; margin: 8px 0; }
.maturity { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bar { width: 240px; height: 16px; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--panel); }
.bar { display: flex; gap: 2px; padding: 1px; }
.bar span.seg { flex: 1; height: 100%; border-radius: 3px; background: transparent; border: 1px dashed var(--grid); }
.bar span.seg.on { background: var(--current); border: 1px solid var(--current); }
.mini { display: inline-block; vertical-align: middle; width: 80px; height: 8px; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; margin-right: 6px; }
.mini span { display: block; height: 100%; background: var(--current); }
.sharewrap { margin: 6px 0 10px; }
svg.share { width: 100%; height: auto; display: block; }
svg .c1, .swatch.c1 { fill: var(--s1); background: var(--s1); }
svg .c2, .swatch.c2 { fill: var(--s2); background: var(--s2); }
svg .c3, .swatch.c3 { fill: var(--s3); background: var(--s3); }
svg .c4, .swatch.c4 { fill: var(--s4); background: var(--s4); }
.legend.inline { display: flex; flex-wrap: wrap; gap: 4px 16px; }
.legend.inline li { margin: 2px 0; }
.swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; }
.swatch.line-p50 { height: 3px; width: 22px; background: var(--s1); }
.swatch.line-max { height: 0; width: 22px; border-top: 2px dashed var(--s2); background: none; }
svg.trend { width: 100%; height: auto; display: block; }
svg.trend .gridline { stroke: var(--grid); stroke-width: 1; opacity: 0.6; }
svg.trend .axislabel { fill: var(--muted); font-size: 11px; }
svg.trend polyline { fill: none; stroke-width: 2; }
svg.trend .line-p50 { stroke: var(--s1); }
svg.trend .line-max { stroke: var(--s2); stroke-dasharray: 6 4; }
svg.trend .dot.line-p50 { fill: var(--s1); stroke: var(--panel); stroke-width: 2; stroke-dasharray: none; }
svg.trend .dot.line-max { fill: var(--panel); stroke: var(--s2); stroke-width: 2; stroke-dasharray: none; }
.summary li { margin: 4px 0; }
.radar-wrap { display: grid; grid-template-columns: minmax(280px, 520px) 1fr; gap: 20px; align-items: start; }
@media (max-width: 760px) { .radar-wrap { grid-template-columns: 1fr; } }
svg.radar.main { width: 100%; height: auto; display: block; }
.legend svg.radar { width: 46px; height: 16px; }
svg.radar text { fill: var(--text); font-size: 13px; }
svg.radar .grid { stroke: var(--grid); fill: none; }
svg.radar .spoke { stroke: var(--grid); }
svg.radar .ringlabel { fill: var(--muted); font-size: 10px; }
svg.radar .band { stroke: var(--band); stroke-width: 12; stroke-linecap: round; }
svg.radar .cur { stroke: var(--current); stroke-width: 2.5; fill: none; }
svg.radar .cur.predicted { stroke-dasharray: 7 5; }
svg.radar .prev { stroke: var(--previous); stroke-width: 2; fill: none; stroke-dasharray: 2 4; opacity: 0.9; }
svg.radar .pt-pred { fill: var(--panel); stroke: var(--current); stroke-width: 2.5; }
svg.radar .pt-pred.faded { opacity: 0.45; }
svg.radar .pt-meas { fill: var(--current); stroke: var(--current); }
svg.radar .pt-prev { fill: var(--previous); }
svg.radar .unknown { fill: none; stroke: var(--warn-line); stroke-width: 2; stroke-dasharray: 3 3; }
svg.radar .unknown-label { fill: var(--warn-line); font-weight: 700; }
.legend { list-style: none; padding: 0; margin: 0; font-size: 13px; }
.legend li { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.legend svg { flex: none; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; }
.tablewrap { overflow-x: auto; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: var(--code-bg); padding: 1px 4px; border-radius: 3px; word-break: break-all; }
.tag { display: inline-block; font-size: 12px; padding: 0 6px; border: 1px solid var(--line); border-radius: 10px; margin-right: 4px; }
.chg-added { color: var(--added); font-weight: 700; }
.chg-removed { color: var(--removed); font-weight: 700; }
.chg-modified { color: var(--modified); font-weight: 700; }
.chg-unknown { color: var(--warn-line); font-weight: 700; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
ul.tight { margin: 4px 0; padding-left: 20px; }
details summary { cursor: pointer; font-weight: 600; }
.axis-card h3 { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
`;
