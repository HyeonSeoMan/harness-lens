// Skill·Agent 파일의 YAML frontmatter를 읽는 최소 파서. 지원하지 않는 형식이면 ok: false를 돌려준다(COM-02).

function scalar(raw) {
  const v = raw.trim();
  if (v === '') return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(v)) return Number(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== null).map(String);
  }
  return v;
}

// 결과: { ok, data, body, bodyStartLine }
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines[0].trim() !== '---') return { ok: false, data: {}, body: text, bodyStartLine: 1 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { ok: false, data: {}, body: text, bodyStartLine: 1 };
  const data = {};
  let ok = true;
  let listKey = null;
  let blockKey = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (blockKey && /^\s+/.test(line)) {
      data[blockKey] = data[blockKey] ? `${data[blockKey]} ${line.trim()}` : line.trim();
      continue;
    }
    blockKey = null;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(String(scalar(item[1])));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!kv) { ok = false; continue; }
    const [, key, rest] = kv;
    listKey = null;
    if (rest.trim() === '') {
      data[key] = [];
      listKey = key;
    } else if (/^[|>][-+]?$/.test(rest.trim())) {
      data[key] = '';
      blockKey = key;
    } else {
      data[key] = scalar(rest);
    }
  }
  return { ok, data, body: lines.slice(end + 1).join('\n'), bodyStartLine: end + 2 };
}
