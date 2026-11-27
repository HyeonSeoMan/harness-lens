// 엔진 번들 빌드: engine/src → skills/harness-analyze/scripts/harness-lens.mjs (런타임 의존성 없는 단일 ESM 파일).
// 사용: node build.mjs [--outfile <path>]   (CI는 임시 경로로 빌드해 커밋된 번들과 바이트 비교한다)
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--outfile');
const outfile = i > 0 ? path.resolve(process.argv[i + 1]) : path.resolve(here, '../skills/harness-analyze/scripts/harness-lens.mjs');

// 배너는 번들 본문보다 먼저 실행된다. 구버전 Node에서도 동작하는 문법만 쓴다.
const banner = `// Harness Lens 엔진 번들. 생성 파일이므로 직접 고치지 말고 engine/src를 고친 뒤 npm run build 하세요.
if (Number(process.versions.node.split('.')[0]) < 20) {
  var hlMsg = 'Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요.';
  if (process.argv.indexOf('--json') >= 0) process.stdout.write(JSON.stringify({ ok: false, code: 'node_too_old', message: hlMsg }) + '\\n');
  else process.stderr.write(hlMsg + '\\n');
  process.exit(10);
}`;

await build({
  entryPoints: [path.join(here, 'src/main.mjs')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // 문법은 Node 14 수준으로 낮춰 구버전에서도 배너까지 파싱되게 한다.
  target: 'node14',
  banner: { js: banner },
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
});
