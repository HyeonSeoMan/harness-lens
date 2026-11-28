// 독립 실행형 HTML 리포트(engine-cli.md §4.8, PRD §8). CDN·외부 리소스 없이 동작한다.
import { createHash } from 'node:crypto';
import { reportClient } from './report/client.mjs';
import { REPORT_CSS } from './report/style.mjs';
import { rescanAndRedact } from './redact.mjs';
import { canonical } from './util.mjs';

// <, >, &, U+2028, U+2029를 \uXXXX로 바꿔 <script> 안에서 문자열이 끝나지 않게 한다.
export function serializeForScript(value) {
  return JSON.stringify(canonical(value)).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderReport(analysis) {
  // R7: 출력 직전 재검사
  const { value: safe } = rescanAndRedact(analysis);
  const script = `(${reportClient.toString()})();`;
  const hash = createHash('sha256').update(script, 'utf8').digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:`;
  const title = `Harness Lens — ${safe.meta.project.displayName} (${safe.meta.snapshotId})`;
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main id="app"><p>이 리포트는 JavaScript로 그립니다. 브라우저에서 스크립트를 허용하면 내용을 볼 수 있습니다. 결과 루트에서 열었다면 원본 데이터는 snapshots/${escapeHtml(safe.meta.snapshotId)}/analysis.json에 있습니다. 스냅샷 폴더에서 열었다면 같은 폴더의 analysis.json을 확인하세요.</p></main>
<script type="application/json" id="hl-data">${serializeForScript({ analysis: safe })}</script>
<script>${script}</script>
</body>
</html>
`;
}
