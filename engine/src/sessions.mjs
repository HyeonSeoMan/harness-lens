// 세션 기록 실측 집계(FR-10, engine-cli.md §4.3, §8). 3단계 수직 슬라이스에서는 구현하지 않는다.
// 세션 기록을 열지 않고, 모든 축을 예측으로 남기는 빈 집계를 돌려준다.

export const SESSIONS_NOT_IMPLEMENTED = 'session_aggregation_not_implemented';

export function aggregateSessions({ disabled = false } = {}) {
  return {
    status: disabled ? 'disabled' : 'unavailable',
    reason: disabled ? null : SESSIONS_NOT_IMPLEMENTED,
    clientVersions: null,
    window: null,
    coverage: {
      filesScanned: 0,
      linesRead: 0,
      linesSkipped: 0,
      skippedRatio: 0,
      sessionsAttributed: 0,
      sessionsUnattributed: 0,
      incremental: false,
      configSince: null,
    },
    dedup: { assistantLines: 0, uniqueResponses: 0, excludedSynthetic: 0, excludedApiError: 0 },
    tokens: null,
    contextPerTurn: null,
    axisMetrics: [],
  };
}
