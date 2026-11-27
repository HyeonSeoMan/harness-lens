// JSON Schema draft 2020-12의 부분 집합 검사기. 의존성 없이 analysis.schema.json만 검사하려고 만든 테스트 도구다.
// 지원하지 않는 키워드가 스키마에 나오면 조용히 넘어가지 않고 예외를 던진다.

const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs']);
const SUPPORTED = new Set([
  'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'prefixItems', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format',
  '$ref', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else',
]);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

function deepEqual(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

export function createValidator(rootSchema) {
  const regexCache = new Map();
  const regex = (pattern) => {
    if (!regexCache.has(pattern)) regexCache.set(pattern, new RegExp(pattern, 'u'));
    return regexCache.get(pattern);
  };

  function resolve(ref) {
    if (!ref.startsWith('#/')) throw new Error(`지원하지 않는 $ref: ${ref}`);
    let node = rootSchema;
    for (const part of ref.slice(2).split('/')) {
      node = node?.[part];
      if (node === undefined) throw new Error(`해석할 수 없는 $ref: ${ref}`);
    }
    return node;
  }

  // 오류 배열을 돌려준다. 빈 배열이면 통과.
  function check(schema, value, path) {
    if (schema === true) return [];
    if (schema === false) return [`${path}: 허용되지 않는 값`];
    const errors = [];
    for (const key of Object.keys(schema)) {
      if (!ANNOTATIONS.has(key) && !SUPPORTED.has(key)) {
        throw new Error(`지원하지 않는 스키마 키워드 '${key}' (${path})`);
      }
    }

    if (schema.$ref) errors.push(...check(resolve(schema.$ref), value, path));

    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => matchesType(value, t))) {
        return [...errors, `${path}: 타입 ${types.join('|')} 필요, 실제 ${typeOf(value)}`];
      }
    }
    if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
      errors.push(`${path}: ${JSON.stringify(value)}는 enum ${JSON.stringify(schema.enum)}에 없음`);
    }
    if ('const' in schema && !deepEqual(schema.const, value)) {
      errors.push(`${path}: const ${JSON.stringify(schema.const)} 필요`);
    }

    const t = typeOf(value);
    if (t === 'string') {
      const len = [...value].length;
      if (schema.minLength !== undefined && len < schema.minLength) errors.push(`${path}: 길이 ${len} < ${schema.minLength}`);
      if (schema.maxLength !== undefined && len > schema.maxLength) errors.push(`${path}: 길이 ${len} > ${schema.maxLength}`);
      if (schema.pattern !== undefined && !regex(schema.pattern).test(value)) errors.push(`${path}: 패턴 ${schema.pattern} 불일치`);
      if (schema.format === 'date-time' && !DATE_TIME.test(value)) errors.push(`${path}: date-time 형식 아님`);
    }
    if (t === 'integer' || t === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: ${value} < ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: ${value} > ${schema.maximum}`);
    }
    if (t === 'array') {
      if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 항목 ${value.length} < ${schema.minItems}`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 항목 ${value.length} > ${schema.maxItems}`);
      if (schema.uniqueItems) {
        const seen = new Set(value.map((v) => JSON.stringify(canonical(v))));
        if (seen.size !== value.length) errors.push(`${path}: 중복 항목`);
      }
      const prefix = schema.prefixItems ?? [];
      prefix.forEach((s, i) => { if (i < value.length) errors.push(...check(s, value[i], `${path}[${i}]`)); });
      if (schema.items !== undefined) {
        for (let i = prefix.length; i < value.length; i++) errors.push(...check(schema.items, value[i], `${path}[${i}]`));
      }
    }
    if (t === 'object') {
      for (const key of schema.required ?? []) {
        if (!(key in value)) errors.push(`${path}: 필수 속성 '${key}' 없음`);
      }
      const props = schema.properties ?? {};
      for (const [key, v] of Object.entries(value)) {
        if (key in props) errors.push(...check(props[key], v, `${path}.${key}`));
        else if (schema.additionalProperties !== undefined) errors.push(...check(schema.additionalProperties, v, `${path}.${key}`));
      }
    }

    for (const s of schema.allOf ?? []) errors.push(...check(s, value, path));
    if (schema.anyOf && !schema.anyOf.some((s) => check(s, value, path).length === 0)) {
      errors.push(`${path}: anyOf 중 일치하는 스키마 없음`);
    }
    if (schema.oneOf && schema.oneOf.filter((s) => check(s, value, path).length === 0).length !== 1) {
      errors.push(`${path}: oneOf 중 정확히 하나가 일치해야 함`);
    }
    if (schema.not && check(schema.not, value, path).length === 0) errors.push(`${path}: not 조건 위반`);
    if (schema.if !== undefined) {
      const branch = check(schema.if, value, path).length === 0 ? schema.then : schema.else;
      if (branch !== undefined) errors.push(...check(branch, value, path));
    }
    return errors;
  }

  return (value) => check(rootSchema, value, '$');
}
