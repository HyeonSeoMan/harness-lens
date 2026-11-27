// Skill 디렉터리의 정적 자원(스키마, SKILL.md) 위치를 찾는다.
// 번들은 skills/harness-analyze/scripts/에, 소스는 engine/src/에 있다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedSkillDir = null;

export function skillDir() {
  if (cachedSkillDir) return cachedSkillDir;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '..'), path.resolve(here, '../../skills/harness-analyze')];
  cachedSkillDir = candidates.find((d) => existsSync(path.join(d, 'schemas', 'analysis.schema.json'))) ?? candidates[0];
  return cachedSkillDir;
}

export function loadSchema() {
  return JSON.parse(readFileSync(path.join(skillDir(), 'schemas', 'analysis.schema.json'), 'utf8'));
}
