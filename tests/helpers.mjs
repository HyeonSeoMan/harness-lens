// 테스트 공용 도구: 커밋된 엔진 번들을 자식 프로세스로 실행하고, 픽스처를 임시 프로젝트로 복사한다.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  return { base, project, out: path.join(base, 'out'), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

export function swapFixture(project, fixtureName) {
  rmSync(project, { recursive: true, force: true });
  cpSync(fixture(fixtureName), project, { recursive: true });
}

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// prepare → 예시 해석 복사 → finalize. LLM 없이 전체 흐름을 돈다.
export function analyze({ project, out, now, interpretation, extra = [] }) {
  const prep = engine(['prepare', '--project', project, '--out', out, '--now', now, '--json', ...extra]);
  if (prep.code !== 0) return { prep };
  if (interpretation) {
    const body = typeof interpretation === 'string' ? readFileSync(interpretation, 'utf8') : JSON.stringify(interpretation);
    writeFileSync(prep.json.interpretationPath, body);
  }
  const fin = engine(['finalize', '--project', project, '--out', out, '--run', prep.json.runId, '--now', now, '--agent', 'claude-code', '--no-open', '--json']);
  return { prep, fin };
}
