// 상시 로드 비용 예산(PRD 11.1, docs/spec/engine-cli.md §12 always_loaded_tokens) 회귀 검사.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const skill = readFileSync(fileURLToPath(new URL('../skills/harness-analyze/SKILL.md', import.meta.url)), 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)[1];
const field = (name) => frontmatter.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1] ?? '';

test('SKILL.md 상시 로드 메타데이터가 100토큰 추정 예산 안에 있다', () => {
  const estimated = Math.ceil(Buffer.byteLength(field('name') + field('description'), 'utf8') / 4);
  assert.ok(estimated <= 100, `추정 ${estimated}토큰`);
});

test('SKILL.md frontmatter는 교차 에이전트 스펙 필드만 쓴다', () => {
  const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata']);
  assert.deepEqual(keys.filter((k) => !allowed.has(k)), []);
});
