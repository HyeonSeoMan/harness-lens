// SB-L2-04의 정적 보호 대상 확인. 실행하지 않는다.
import { compareCodeUnits } from './util.mjs';
import { hasBlockMarker } from './lexicon.mjs';

// 0.5: Hook 선언과 별개인 보호 사실. 실행·데이터 흐름 증명이 아닌 보수적 문자열 휴리스틱이다.
// 괄호/블록 안의 문자열과 주석은 경계 계산에서 건너뛴다.
function closing(text, start, open, close) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      while (++i < text.length) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote) break;
      }
    } else if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

export function safetyHookTargets({ event, matcher, script, blockingCalls = [] }) {
  if (event !== 'PreToolUse' || !script) return [];
  // 설명·주석만으로 보호 사실을 만들지 않는다. 대상 문자열은 검사식 안에서만 찾는다.
  const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  const code = script.replace(tokens, (s) => s.startsWith('/') ? blank(s) : s);
  const withoutStrings = (s) => s.replace(tokens, blank);
  const syntax = withoutStrings(code);
  const tools = (matcher ?? '*').split('|').map((m) => m.trim());
  const matches = (names) => tools.some((m) => ['*', '.*', ...names].includes(m));
  const targets = new Set();
  const calls = blockingCalls.filter((n) => /^[\w$]+$/.test(n));
  const blocks = (body) => {
    const executable = withoutStrings(body);
    if (hasBlockMarker(executable) || calls.some((n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\s*\\(`).test(executable))) return true;
    // JSON 차단 응답은 문자열 출력 예시가 아니라 코드의 객체 리터럴일 때만 인정한다.
    return [...body.matchAll(/\{[^{}]*\}/g)].some((m) => executable[m.index] === '{'
      && /["']?(?:decision|permissionDecision|continue)["']?\s*:/.test(m[0]) && hasBlockMarker(m[0]));
  };
  const pathNames = [...code.matchAll(/\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*\b(?:file_path|notebook_path)\b/g)].map((m) => m[1]);
  const riskyGit = /(?:git\s+(?:push|reset|clean|checkout|restore)|push\s+--force|reset\s+--hard|clean\s+-[a-z]*f)/i;
  for (const hit of code.matchAll(/\bif\s*\(/g)) {
    if (!syntax.slice(hit.index).startsWith('if')) continue;
    const start = hit.index + hit[0].length - 1;
    const end = closing(code, start, '(', ')');
    if (end < 0) continue;
    const condition = code.slice(start + 1, end);
    const rest = code.slice(end + 1).trimStart();
    const bodyEnd = rest.startsWith('{') ? closing(rest, 0, '{', '}') : rest.indexOf(';');
    if (bodyEnd < 0 || !blocks(rest.slice(0, bodyEnd + 1))) continue;
    if (matches(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) && /\b(?:file_path|notebook_path)\b/.test(code)
      && /\b(?:inside|startsWith|includes|match|test)\s*\(/.test(condition)
      && (/\b(?:path|target|dirs|protected\w*|file\w*)\b/i.test(condition)
        || pathNames.some((n) => new RegExp(`\\b${n}\\b`).test(condition)))) targets.add('protected_path');
    if (matches(['Bash']) && /\bcommand\b/.test(condition)
      && riskyGit.test(condition)) targets.add('risky_git');
  }
  // 셸은 jq로 command를 직접 받은 변수의 단순 case 분기만 지원한다.
  const shell = code.replace(/^\s*#.*$/gm, '');
  if (matches(['Bash'])) for (const m of shell.matchAll(/\bcase\s+["']?\$(\w+)["']?\s+in\b([\s\S]*?)\besac\b/g)) {
    if (!new RegExp(`\\b${m[1]}=[^\\n]*\\.tool_input\\.command`).test(shell.slice(0, m.index))) continue;
    for (const branch of m[2].split(';;')) {
      const end = branch.indexOf(')');
      if (end >= 0 && riskyGit.test(branch.slice(0, end)) && blocks(branch.slice(end + 1))) targets.add('risky_git');
    }
  }
  return [...targets].sort(compareCodeUnits);
}

