// 읽기 경계(engine-cli.md §6): 루트 밖 심볼릭 링크와 .. 경로를 따라가지 않는다. 쓰기는 하지 않는다.
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { sha256hex } from './util.mjs';

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// R5 경로 정규화: 프로젝트 안은 상대 경로, 홈 아래는 ~/, 그 밖은 <abs:해시>.
export function displayPath(abs, projectRoot) {
  if (projectRoot && within(projectRoot, abs)) {
    const rel = toPosix(path.relative(projectRoot, abs));
    return rel === '' ? '.' : rel;
  }
  const home = homedir();
  if (within(home, abs)) return `~/${toPosix(path.relative(home, abs))}`;
  return `<abs:${sha256hex(toPosix(abs)).slice(0, 8)}>`;
}

// root 기준 상대 경로를 안전하게 해석한다.
// 결과: { status: 'ok'|'absent'|'escape'|'unreadable', abs, real, isDir, size }
export function resolveInside(root, rel) {
  if (path.isAbsolute(rel) || toPosix(rel).split('/').includes('..')) return { status: 'escape' };
  const abs = path.join(root, rel);
  let lst;
  try {
    lst = lstatSync(abs);
  } catch (err) {
    return { status: err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 'absent' : 'unreadable', abs };
  }
  let real;
  let rootReal;
  try {
    real = realpathSync(abs);
    rootReal = realpathSync(root);
  } catch {
    // 깨진 심볼릭 링크
    return { status: lst.isSymbolicLink() ? 'escape' : 'unreadable', abs };
  }
  if (!within(rootReal, real)) return { status: 'escape', abs };
  try {
    const st = statSync(real);
    return { status: 'ok', abs, real, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return { status: 'unreadable', abs };
  }
}

export function readTextInside(root, rel, limit) {
  const r = resolveInside(root, rel);
  if (r.status !== 'ok') return r;
  if (r.isDir) return { ...r, status: 'unsupported', reason: 'is_directory' };
  if (r.size > limit) return { ...r, status: 'unsupported', reason: 'too_large' };
  try {
    return { ...r, text: readFileSync(r.real, 'utf8') };
  } catch {
    return { ...r, status: 'unreadable' };
  }
}

export function listDirInside(root, rel) {
  const r = resolveInside(root, rel);
  if (r.status !== 'ok' || !r.isDir) return { status: r.status === 'ok' ? 'absent' : r.status, entries: [] };
  try {
    return { status: 'ok', entries: readdirSync(r.real).sort() };
  } catch {
    return { status: 'unreadable', entries: [] };
  }
}
