// 테스트 공용 도구: 커밋된 엔진 번들을 자식 프로세스로 실행하고, 픽스처를 임시 프로젝트로 복사한다.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export const bundle = path.join(repoRoot, 'skills/harness-analyze/scripts/harness-lens.mjs');
export const fixture = (name) => path.join(repoRoot, 'examples/fixtures', name);
export const exampleInterpretation = (name) => path.join(repoRoot, 'examples/interpretations', `${name}.json`);

// 기본으로 빈 설정 디렉터리를 쓴다. 테스트 결과가 실행하는 컴퓨터의 ~/.claude에 좌우되지 않게 한다.
const emptyConfigDir = mkdtempSync(path.join(tmpdir(), 'hl-config-'));

export function engine(args, { cwd = repoRoot, configDir = emptyConfigDir } = {}) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: configDir };
  const r = spawnSync(process.execPath, [bundle, ...args, '--quiet'], { cwd, encoding: 'utf8', env });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* --json이 아니면 비어 있을 수 있다 */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

export function tempDir(prefix = 'hl-test-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// 임시 디렉터리 안에 sample-app 프로젝트를 만든다. 내용은 픽스처로 바꿔 끼운다.
export function makeProject(fixtureName) {
  const base = tempDir();
  const project = path.join(base, 'sample-app');
  cpSync(fixture(fixtureName), project, { recursive: true });
  pinMtimes(project);
  return { base, project, out: path.join(base, 'out'), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

// 구성 파일 수정 시각을 고정해 configSince(루브릭 §1.9)가 실행 시각에 좌우되지 않게 한다.
export const CONFIG_MTIME = new Date('2026-11-01T00:00:00Z');
export function pinMtimes(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pinMtimes(p);
    else utimesSync(p, CONFIG_MTIME, CONFIG_MTIME);
  }
}

// 합성 세션 기록 픽스처(examples/fixtures/claude-config)를 임시 설정 디렉터리로 복사하며 경로 자리표시자를 바꾼다.
// {{PROJECT}}: 분석 대상, {{WORKTREE}}: .git 파일로 대상에 연결된 워커 워크트리, {{BOTS}}·{{WORKSPACES}}: Orca 경로 규약.
export const SENTINELS = ['SENTINEL_TEXT_7f3a', 'SENTINEL_CODE_7f3a', 'SENTINEL_INPUT_7f3a', 'SENTINEL_RESULT_7f3a', 'SENTINEL_TITLE_7f3a', 'SENTINELID', 'SENTINELREQ'];
export function makeSessionLogs(p, { mapping = false, botMap = null } = {}) {
  const configDir = path.join(p.base, 'claude-config');
  const worktree = path.join(p.base, 'workspaces', 'sample-app', 'wt-live');
  const bots = path.join(p.base, 'bots');
  const workspaces = path.join(p.base, 'workspaces');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(p.project, '.git', 'worktrees', 'wt-live')}\n`);
  const vars = { PROJECT: p.project, WORKTREE: worktree, BOTS: bots, WORKSPACES: workspaces };
  const copy = (src, dst) => {
    mkdirSync(dst, { recursive: true });
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const a = path.join(src, e.name);
      const b = path.join(dst, e.name);
      if (e.isDirectory()) copy(a, b);
      else writeFileSync(b, readFileSync(a, 'utf8').replace(/\{\{(\w+)\}\}/g, (_, k) => JSON.stringify(vars[k]).slice(1, -1)));
    }
  };
  copy(fixture('claude-config'), configDir);
  mkdirSync(p.out, { recursive: true });
  const config = { orcaPaths: { bots, workspaces } };
  if (mapping) config.sessionAttribution = { bots: { 'mapped-bot': p.project } };
  if (botMap) config.sessionAttribution = { bots: { ...config.sessionAttribution?.bots, ...botMap } };
  writeFileSync(path.join(p.out, 'config.json'), JSON.stringify(config));
  return { configDir, worktree, bots, workspaces };
}

// 디렉터리 아래 모든 파일 내용을 이어 붙인다(원문 누출 검사용).
export function readTree(dir) {
  let text = '';
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    text += e.isDirectory() ? readTree(p) : statSync(p).size < 64 * 1024 * 1024 ? readFileSync(p, 'utf8') : '';
  }
  return text;
}

export function swapFixture(project, fixtureName) {
  rmSync(project, { recursive: true, force: true });
  cpSync(fixture(fixtureName), project, { recursive: true });
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// prepare → 예시 해석 복사 → finalize. LLM 없이 전체 흐름을 돈다.
export function analyze({ project, out, now, interpretation, extra = [], configDir }) {
  const opt = configDir ? { configDir } : undefined;
  const prep = engine(['prepare', '--project', project, '--out', out, '--now', now, '--json', ...extra], opt);
  if (prep.code !== 0) return { prep };
  if (interpretation) {
    const body = typeof interpretation === 'string' ? readFileSync(interpretation, 'utf8') : JSON.stringify(interpretation);
    writeFileSync(prep.json.interpretationPath, body);
  }
  const fin = engine(['finalize', '--project', project, '--out', out, '--run', prep.json.runId, '--now', now, '--agent', 'claude-code', '--no-open', '--json'], opt);
  return { prep, fin };
}
