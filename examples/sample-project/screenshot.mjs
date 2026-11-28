// build-report.mjs가 만든 report.html을 헤드리스 Chrome으로 찍어 docs/images/에 저장한다.
// 라이트·다크(1200px)와 휴대폰 폭(390px) 전체 페이지. 의존성 없이 Chrome DevTools Protocol을 직접 쓴다(Node 22 이상, 전역 WebSocket).
//
// 사용: node examples/sample-project/screenshot.mjs <report.html> [--chrome <Chrome 실행 파일>]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '../../docs/images');
const report = process.argv[2];
if (!report) { process.stderr.write('사용: node screenshot.mjs <report.html> [--chrome <경로>]\n'); process.exit(64); }
const chromeArg = process.argv.indexOf('--chrome');
const chrome = chromeArg > 0 ? process.argv[chromeArg + 1]
  : process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const shots = [
  { file: 'sample-report-light.png', width: 1200, scale: 1, scheme: 'light', mobile: false },
  { file: 'sample-report-dark.png', width: 1200, scale: 1, scheme: 'dark', mobile: false },
  { file: 'sample-report-mobile.png', width: 390, scale: 2, scheme: 'light', mobile: true },
];

const profile = mkdtempSync(path.join(tmpdir(), 'hl-chrome-'));
const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  proc.on('exit', (c) => reject(new Error(`Chrome 종료(${c})`)));
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) listeners.forEach((f) => f(msg));
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const waitEvent = (method, sessionId) => new Promise((resolve) => {
  const f = (m) => { if (m.method === method && m.sessionId === sessionId) { listeners.splice(listeners.indexOf(f), 1); resolve(m); } };
  listeners.push(f);
});

mkdirSync(outDir, { recursive: true });
try {
  for (const s of shots) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: s.width, height: 900, deviceScaleFactor: s.scale, mobile: s.mobile }, sessionId);
    const loaded = waitEvent('Page.loadEventFired', sessionId);
    await send('Page.navigate', { url: pathToFileURL(path.resolve(report)).href }, sessionId);
    await loaded;
    await new Promise((r) => setTimeout(r, 800));
    const { result } = await send('Runtime.evaluate', { expression: 'Math.ceil(document.documentElement.scrollHeight)', returnByValue: true }, sessionId);
    const height = result.value;
    await send('Emulation.setDeviceMetricsOverride', { width: s.width, height, deviceScaleFactor: s.scale, mobile: s.mobile }, sessionId);
    await new Promise((r) => setTimeout(r, 400));
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    writeFileSync(path.join(outDir, s.file), Buffer.from(data, 'base64'));
    process.stdout.write(`${s.file} ${s.width}×${height} @${s.scale}x\n`);
    await send('Target.closeTarget', { targetId });
  }
} finally {
  ws.close();
  proc.kill();
  await new Promise((r) => setTimeout(r, 300));
  rmSync(profile, { recursive: true, force: true });
}
