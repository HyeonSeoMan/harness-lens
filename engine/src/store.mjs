// 결과 디렉터리(.harness-lens/) 관리: 잠금, 원자적 쓰기, run·스냅샷(engine-cli.md §5, §11).
// 쓰기는 이 디렉터리 안에서만 한다.
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import path from 'node:path';
import { RUNS_TO_KEEP } from './constants.mjs';
import { compareCodeUnits, stableStringify } from './util.mjs';

export class EngineError extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}

export function atomicWrite(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

export const writeJson = (file, value) => atomicWrite(file, stableStringify(value));
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

export function ensureOutDir(out) {
  const fresh = !existsSync(out);
  mkdirSync(out, { recursive: true });
  if (fresh || !existsSync(path.join(out, '.gitignore'))) atomicWrite(path.join(out, '.gitignore'), '*\n');
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// O_EXCL 잠금. 기록된 pid가 죽었거나 10분이 지났으면 오래된 잠금으로 본다.
export function acquireLock(out, now) {
  const file = path.join(out, 'lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      closeSync(fd);
      return () => rmSync(file, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw new EngineError(11, '결과 디렉터리에 쓸 수 없습니다.');
      let stale = true;
      try {
        const info = JSON.parse(readFileSync(file, 'utf8'));
        const age = Date.now() - Date.parse(info.startedAt);
        stale = !pidAlive(info.pid) || !(age < 10 * 60 * 1000);
      } catch { stale = statSync(file).mtimeMs < Date.now() - 10 * 60 * 1000; }
      if (!stale) throw new EngineError(11, '다른 Harness Lens 분석이 진행 중입니다. 끝난 뒤 다시 시도하세요.');
      rmSync(file, { force: true });
    }
  }
  throw new EngineError(11, '결과 디렉터리 잠금을 얻지 못했습니다.');
}

export const runDir = (out, runId) => path.join(out, 'runs', runId);
export const snapshotDir = (out, id) => path.join(out, 'snapshots', id);

export function readIndex(out) {
  const file = path.join(out, 'snapshots', 'index.json');
  return existsSync(file) ? readJson(file) : [];
}

export function latestSnapshotId(out) {
  const file = path.join(out, 'latest.json');
  if (existsSync(file)) return readJson(file).snapshotId;
  const idx = readIndex(out);
  return idx.length ? idx[idx.length - 1].snapshotId : null;
}

export function loadSnapshot(out, id) {
  const file = path.join(snapshotDir(out, id), 'analysis.json');
  if (!existsSync(file)) throw new EngineError(41, `스냅샷 ${id}이 없습니다.`);
  return readJson(file);
}

// 스테이징 디렉터리에 쓴 뒤 통째로 rename한다. 같은 ID가 있으면 덮지 않는다.
export function commitSnapshot(out, analysis) {
  const id = analysis.meta.snapshotId;
  const finalDir = snapshotDir(out, id);
  if (existsSync(finalDir)) throw new EngineError(40, `스냅샷 ${id}이 이미 있습니다.`);
  const staging = path.join(out, 'snapshots', `.staging-${id}`);
  try {
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    writeFileSync(path.join(staging, 'analysis.json'), stableStringify(analysis));
    renameSync(staging, finalDir);
    const index = readIndex(out).filter((e) => e.snapshotId !== id);
    index.push({
      snapshotId: id,
      analyzedAt: analysis.meta.analyzedAt,
      configurationHash: analysis.meta.configurationHash,
      schemaVersion: analysis.schemaVersion,
      rubricVersion: analysis.rubricVersion,
      scope: analysis.meta.scope.preset,
    });
    index.sort((a, b) => compareCodeUnits(a.analyzedAt + a.snapshotId, b.analyzedAt + b.snapshotId));
    writeJson(path.join(out, 'snapshots', 'index.json'), index);
    writeJson(path.join(out, 'latest.json'), { snapshotId: id });
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    if (err instanceof EngineError) throw err;
    throw new EngineError(40, '스냅샷을 저장하지 못했습니다. 이전 상태를 유지합니다.');
  }
  return finalDir;
}

// 최근 run만 남긴다(현재 run 제외 시 keep-1개).
export function pruneRuns(out, keepId) {
  const dir = path.join(out, 'runs');
  if (!existsSync(dir)) return;
  const runs = readdirSync(dir).filter((d) => d !== keepId).sort(compareCodeUnits);
  for (const old of runs.slice(0, Math.max(0, runs.length - (RUNS_TO_KEEP - 1)))) {
    rmSync(path.join(dir, old), { recursive: true, force: true });
  }
}
