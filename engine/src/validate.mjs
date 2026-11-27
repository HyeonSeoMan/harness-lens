// LLM 해석을 엔진 결과와 합쳐 검증한다(engine-cli.md §4.5, §9, FR-04).
// 실패한 결과는 runs/에만 남고 스냅샷이 되지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ENGINE_VERSION, RUBRIC_VERSION, SCHEMA_VERSION, VALIDATOR_VERSION } from './constants.mjs';
import { runSemanticChecks } from './checks.mjs';
import { detectSecrets, mapStrings } from './redact.mjs';
import { loadSchema } from './resources.mjs';
import { createValidator } from './schema-validator.mjs';
import { EngineError, readJson, runDir, writeJson } from './store.mjs';
import { hashJson, truncate } from './util.mjs';

const PLACEHOLDER_VALIDATION = { status: 'valid', validatorVersion: VALIDATOR_VERSION, checkedAt: '1970-01-01T00:00:00Z', checks: [] };

const msg = (problems) => (problems.length ? truncate(problems.join('; '), 600) : null);

export function draftHash(draft) {
  return hashJson(draft);
}

export function validateDocument(doc, schema = loadSchema()) {
  const checks = [];
  const validator = createValidator(schema);
  const schemaErrors = validator({ ...doc, validation: PLACEHOLDER_VALIDATION });
  checks.push({ checkId: 'V-SCHEMA', status: schemaErrors.length ? 'fail' : 'pass', message: msg(schemaErrors.slice(0, 8)) });
  if (schemaErrors.length === 0) {
    checks.push(...runSemanticChecks(doc));
  }
  const secretHits = [];
  if (doc.interpretation && typeof doc.interpretation === 'object') {
    mapStrings(doc.interpretation, (s, p) => {
      const kinds = detectSecrets(s);
      if (kinds.length) secretHits.push(`interpretation${p}: ${kinds.join(',')}`);
      return s;
    });
  }
  checks.push({ checkId: 'V-SECRET-RESCAN', status: secretHits.length ? 'fail' : 'pass', message: msg(secretHits) });
  return checks;
}

export function validateRun({ out, runId, agent, model, now }) {
  const dir = runDir(out, runId);
  if (!existsSync(path.join(dir, 'run.json'))) throw new EngineError(41, `run ${runId}이 없습니다.`);
  const run = readJson(path.join(dir, 'run.json'));
  const draft = readJson(path.join(dir, 'draft.json'));
  if (draftHash(draft) !== run.draftHash) {
    throw new EngineError(31, 'V-ENGINE-INTEGRITY: draft.json이 prepare 산출과 다릅니다. prepare부터 다시 실행하세요.');
  }
  if (run.engineVersion !== ENGINE_VERSION || draft.schemaVersion !== SCHEMA_VERSION || draft.rubricVersion !== RUBRIC_VERSION) {
    throw new EngineError(31, 'V-VERSION: run의 엔진·스키마·루브릭 버전이 현재 엔진과 다릅니다. prepare부터 다시 실행하세요.');
  }

  const checks = [
    { checkId: 'V-VERSION', status: 'pass', message: null },
    { checkId: 'V-ENGINE-INTEGRITY', status: 'pass', message: null },
  ];
  let interpretation = null;
  const interpFile = path.join(dir, 'interpretation.json');
  if (!existsSync(interpFile)) {
    checks.push({ checkId: 'V-SCHEMA', status: 'fail', message: 'interpretation.json이 없습니다.' });
  } else {
    try {
      interpretation = JSON.parse(readFileSync(interpFile, 'utf8'));
    } catch {
      checks.push({ checkId: 'V-SCHEMA', status: 'fail', message: 'interpretation.json이 올바른 JSON이 아닙니다.' });
    }
  }
  const meta = {
    ...draft.meta,
    analyzer: {
      agent: agent ?? draft.meta.analyzer.agent,
      model: model ?? null,
      modelSource: model ? 'reported_by_agent' : 'unknown',
    },
  };
  const doc = { schemaVersion: draft.schemaVersion, rubricVersion: draft.rubricVersion, meta, engine: draft.engine, interpretation };
  if (interpretation !== null) checks.push(...validateDocument(doc));
  const status = checks.some((c) => c.status === 'fail') ? 'invalid' : 'valid';
  const validation = { status, validatorVersion: VALIDATOR_VERSION, checkedAt: now, checks };
  const analysis = { ...doc, validation };
  writeJson(path.join(dir, 'analysis.json'), analysis);
  writeJson(path.join(dir, 'validation.json'), validation);
  writeJson(path.join(dir, 'run.json'), { ...run, status: status === 'valid' ? 'validated' : 'failed' });
  return { status, checks, analysis };
}
