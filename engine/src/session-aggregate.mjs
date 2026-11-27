// aggregate-sessions 단계(engine-cli.md §4.3). 확정된 누적 상태(.harness-lens/sessions/)에 새 바이트만 더해
// run 디렉터리의 스테이징에 쓴다. 확정(sessions/ 교체)은 snapshot 성공 뒤에만 한다(FR-09).
import path from 'node:path';
import { analysisWindowTokens, pruneResponses, summarize } from './session-metrics.mjs';
import { h16, loadState, readSessionConfig, resolveMainRoot, scanTranscripts, stateDir, writeState } from './sessions.mjs';

const COUNTS0 = { filesScanned: 0, linesRead: 0, linesSkipped: 0, skippedRatio: 0, sessionsAttributed: 0, sessionsUnattributed: 0, sessionsExcluded: 0, incremental: false, configSince: null };

export function emptySessions(status, reason) {
  return {
    status, reason, clientVersions: null, window: null, coverage: { ...COUNTS0 },
    dedup: { assistantLines: 0, uniqueResponses: 0, excludedSynthetic: 0, excludedApiError: 0 },
    tokens: null, contextPerTurn: null, axisMetrics: [],
  };
}

const NO_INFO = { unknownModels: false, estimatedShare: 0, samples: {}, sinceSessions: 0 };

// previousWindow: { startMs, endMs } 직전 분석 구간. 결과의 previousTokens로 돌려준다.
export function aggregateSessions({ disabled = false, configDir, projectRoot, out, configSinceMs = null, fullRescan = false, nowMs, log, stagingDir = null, previousWindow = null }) {
  if (disabled) return { sessions: emptySessions('disabled', null), info: NO_INFO, previousTokens: null };
  try {
    const cfg = readSessionConfig(out);
    if (!cfg.enabled) return { sessions: emptySessions('disabled', null), info: NO_INFO, previousTokens: null };
    const { main, roots } = resolveMainRoot(projectRoot);
    const env = { roots, cfg, mainRoot: main };
    const loaded = fullRescan ? { state: loadState('', h16(main)).state, had: false } : loadState(stateDir(out), h16(main));
    const { state } = loaded;
    const scan = scanTranscripts({ configDir, state, env, fullRescan, log });
    pruneResponses(state, env, nowMs);
    const { sessions, info } = summarize(state, env, { configSinceMs, incremental: loaded.had && !fullRescan, scan });
    if (loaded.corrupted) info.stateCorrupted = true;
    if (scan.unreadable) info.unreadableFiles = scan.unreadable;
    if (stagingDir) writeState(stagingDir, state);
    const previousTokens = previousWindow && sessions.status !== 'unavailable'
      ? analysisWindowTokens(state, env, previousWindow.startMs, previousWindow.endMs) : null;
    return { sessions, info, previousTokens };
  } catch (err) {
    if (process.env.HARNESS_LENS_DEBUG) process.stderr.write(`${err?.stack}\n`);
    // 형식이 바뀌거나 예상 밖 오류가 나도 분석을 멈추지 않는다. 모든 축이 예측으로 남는다.
    return { sessions: emptySessions('unavailable', 'session_aggregation_failed'), info: NO_INFO, previousTokens: null };
  }
}

export const sessionsStagingDir = (runDirPath) => path.join(runDirPath, 'sessions.staging');
