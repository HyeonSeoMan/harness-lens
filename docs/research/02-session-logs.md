# 조사 ② — Claude Code 세션 기록(`~/.claude/projects/**/*.jsonl`)

- 작성일: 2026-11-27
- 관련 PRD: FR-10(세션 기록 실측 집계), 11장(보안), 11.1(증분 처리), 14.2(형식 안정성·`cleanupPeriodDays`)
- 조사 방법: 공식 문서 확인 + 로컬 기록 **구조 실측**. 로컬 파일에서는 키 이름, 값의 타입, 숫자 필드만 읽었다. 메시지 본문, 코드, 경로 원문, 식별자는 문서에 옮기지 않았다.
- 실측 표본: Claude Code `2.1.309`~`2.1.322`(4개 버전), 메인 기록 624개 + 서브에이전트 기록 175개, 약 22만 줄, 총 약 2GB(파일 중앙값 약 0.5MB, 최대 약 150MB). 진입점(`entrypoint`)은 대부분 `orca`였고 `cli`, `sdk-cli`, `claude-vscode`도 섞여 있었다.

> 결론 요약: 집계에 필요한 숫자는 모두 `type:"assistant"` 줄의 `message.usage`와 몇 가지 `system` 줄에 있다. **한 API 응답이 콘텐츠 블록마다 한 줄씩 기록되고, 각 줄에 같은 `usage`가 반복된다.** 그래서 `message.id`로 중복을 제거하지 않으면 토큰이 약 2배(실측 1.97배) 부풀려진다. 형식은 공식 계약이 아니므로 파서는 "알려진 필드만 읽고, 모르는 것은 건너뛰고, 필수 필드가 없으면 그 축을 예측으로 되돌리는" 방식이어야 한다.

## 1. 저장 위치와 파일 배치

공식 문서([claude-directory](https://code.claude.com/docs/en/claude-directory), [data-usage](https://code.claude.com/docs/en/data-usage)) 기준:

- 세션 기록은 `~/.claude/projects/<project>/<session>.jsonl`에 평문으로 저장된다. 기록에는 메시지, 도구 호출, 도구 결과, 그리고 모델에 보낸 시스템 프롬프트·도구 정의·요청 파라미터까지 들어간다.
- `CLAUDE_CONFIG_DIR`을 설정하면 `~/.claude` 아래 모든 경로가 그 디렉터리로 옮겨진다. **엔진은 `~/.claude`를 하드코딩하지 말고 `CLAUDE_CONFIG_DIR`을 먼저 확인해야 한다.**
- 저장 시 암호화하지 않으며, 보호 수단은 OS 파일 권한뿐이다(실측: 파일 모드 `0600`).

실측한 디렉터리 배치(버전 2.1.3xx):

```
<CONFIG_DIR>/projects/
  <encoded-cwd>/
    <sessionId>.jsonl                 # 메인 세션 기록 (isSidechain=false)
    <sessionId>/
      subagents/
        agent-<agentId>.jsonl         # 서브에이전트 기록 (isSidechain=true)
        agent-<agentId>.meta.json     # agentType, description, toolUseId, spawnDepth, parentAgentId?, model?, finished ...
      tool-results/                   # 큰 도구 출력의 별도 저장본 (집계에 불필요, 읽지 않음)
    memory/                           # 자동 메모리 (세션 기록 아님, 읽지 않음)
```

## 2. 프로젝트 경로 인코딩

- 규칙(실측): 세션을 **시작한 작업 디렉터리의 절대 경로에서 영숫자(`[A-Za-z0-9]`)가 아닌 모든 문자를 `-`로 바꾼다.**
  - `/Users/u/Documents/my-app` → `-Users-u-Documents-my-app`
  - `/Users/u/.orca/bots/x-bot` → `-Users-u--orca-bots-x-bot` (`/.` 두 글자가 `--`로 바뀜)
- **역변환은 불가능하다.** `-`, `/`, `.`, `_`, 공백, 한글이 모두 `-`로 바뀌므로 `my-app`과 `my/app`을 구분할 수 없다. 디렉터리 이름은 그룹 키로만 쓰고, 실제 경로는 줄의 `cwd` 필드에서 얻어야 한다.
- `cwd`는 세션 도중 바뀔 수 있다. 실측에서 세션 626개 중 161개가 여러 `cwd`를 가졌고, 이 경우 모두 프로젝트 디렉터리의 **하위 경로**였다(예: 하위 패키지로 `cd`). 디렉터리 이름은 시작 시점의 cwd로 고정된다.
- 매우 긴 경로(약 200자 초과)는 잘린 뒤 해시가 붙는다는 보고가 있으나 **미검증**이다. 실측 최대 길이는 141자였다. 파서는 디렉터리 이름과 `cwd` 인코딩이 정확히 같지 않아도 동작해야 한다.

## 3. 레코드 타입

모든 줄은 JSON 객체 하나이고 최상위 `type`으로 구분한다. 실측 빈도와 집계 관련성은 다음과 같다.

| `type` | 실측 줄 수 | 집계 용도 | 비고 |
|---|---:|---|---|
| `assistant` | 60,713 | **토큰, 모델, 도구 호출 수** | 콘텐츠 블록(`text`/`thinking`/`tool_use`) 하나당 한 줄 |
| `user` | 35,181 | 턴 수, 도구 결과·거부 수 | 사람 입력, `tool_result`, 메타 메시지 포함 |
| `system` | 3,298 | **작업 시간, Hook, 재시도, 압축** | `subtype`으로 구분(아래) |
| `attachment` | 124,020 | Hook 성공·실패 | `attachment.type`: `hook_success`, `hook_non_blocking_error` 등 다수 |
| `cost-state` | 754 | 교차 검증용 | 세션 누적 `modelUsage.<model>.{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD}`, `totalDuration` 등 |
| `api-request`, `api-request-shape`, `api-request-blob` | 약 5.6만 | 사용 안 함 | 요청 파라미터·시스템 프롬프트·**메시지 원문**. 반드시 건너뛴다 |
| `ai-title`, `custom-title`, `last-prompt`, `agent-name` | 약 4만 | 사용 안 함 | 제목·마지막 프롬프트 **원문** 포함 |
| `queue-operation`, `mode`, `permission-mode`, `pr-link`, `frame-link`, `file-history-*`, `session-owner`, `tools-used`, `atis-latch` | 소량 | 사용 안 함(선택적으로 메타) | `session-owner`에는 계정·조직 UUID가 있으므로 읽지 않는다 |

실측 `system.subtype`: `stop_hook_summary`(2,650), `turn_duration`(521), `away_summary`, `compact_boundary`(33), `api_error`(18), `local_command`, `informational`, `model_refusal_no_fallback`.

이전 버전 기록에서 자주 보고된 `summary`, `progress` 타입은 이번 표본에 없었다. 타입 목록이 버전에 따라 바뀐다는 근거다(6장).

### 3.1 FR-10 지표와 필드 매핑(제안)

| 지표 | 소스 | 계산 |
|---|---|---|
| 토큰(입력/캐시 생성/캐시 읽기/출력) | `assistant.message.usage.*` | 4장 중복 제거 후 합계 |
| 모델별 분포 | `assistant.message.model` | `<synthetic>` 제외 |
| 도구 호출 수 | `assistant.message.content[].type == "tool_use"` 블록 수, `name`만 읽음 | 블록 단위라 줄 중복 문제 없음. 입력값(`input`)은 읽지 않음 |
| 작업 시간 | `system(subtype=turn_duration).durationMs` | 합계·분포. 보조: `cost-state.totalDuration`/`totalAPIDuration` |
| Hook 실패 | `attachment.type == "hook_non_blocking_error"`, `system(stop_hook_summary).hookErrors[]` 길이, `attachment.exitCode != 0` | `hookEvent`·`hookName`만 집계 키로 사용, `stdout`/`stderr`/`command`는 읽지 않음 |
| 재시도·API 오류 | `system(subtype=api_error).retryAttempt`, `assistant.isApiErrorMessage` | 횟수 |
| 컨텍스트 압축 | `system(subtype=compact_boundary).compactMetadata.{preTokens, postTokens, trigger}` | 횟수, 감소량 |
| 턴 수 | `user` 중 `origin.kind == "human"` 또는 `turnPosition` | 사람 입력 기준 |

## 4. `usage` 필드와 중복 줄

### 4.1 `message.usage` 구조(실측)

```jsonc
"usage": {
  "input_tokens": 0,                    // int, 캐시 미적중 입력
  "cache_creation_input_tokens": 0,     // int, = cache_creation.ephemeral_5m + ephemeral_1h (실측 15,050건 모두 일치)
  "cache_read_input_tokens": 0,         // int
  "output_tokens": 0,                   // int, thinking 포함
  "cache_creation": { "ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 0 },
  "output_tokens_details": { "thinking_tokens": 0 },     // 신규 버전에만
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "iterations": [ { "type": "...", "input_tokens": 0, "output_tokens": 0, ... } ], // 실측상 길이 1, 합계 = 최상위 값
  "service_tier": "...", "speed": "...", "inference_geo": "..."
}
```

- 필수로 취급할 필드는 4개(`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`)다. 나머지는 있으면 쓰고 없으면 무시한다.
- `iterations[]`는 최상위 값과 합이 같으므로 **두 번 더하지 않는다.** 최상위 값만 쓴다.
- 모델은 `message.model`에서 읽는다(실측: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `<synthetic>`). `<synthetic>`(42건)은 API 오류나 중단 시 Claude Code가 로컬에서 만든 메시지로 usage가 0이므로 제외한다. 줄 최상위의 `requestedModel`/`advisorModel`은 요청 시 모델로, 실제 응답 모델과 다를 수 있다.

### 4.2 하나의 응답이 여러 줄로 기록됨

- 한 API 응답(`message.id`, 형식 `msg_…`)은 콘텐츠 블록마다 별도 줄로 기록된다. 각 줄은 서로 다른 `uuid`와 `parentUuid` 체인을 가지며, `message.id`, `requestId`, `usage`는 같다.
- 실측 분포(`message.id`당 줄 수): 1줄 9,411 / 2줄 14,983 / 3줄 5,493 / 4줄 이상 약 1,000(최대 22). 고유 응답 30,844개에 줄 60,713개로, 단순 합산하면 **약 1.97배 과대 집계**된다.
- 이번 표본(2.1.3xx)에서는 같은 `message.id`의 중복 줄 29,899개 모두 `usage`가 완전히 같았다. 하지만 과거 버전은 스트리밍 중간값(작은 `output_tokens`)이 앞 줄에 기록되었다고 보고되었으므로, **필드별 최댓값**을 쓰는 방식이 두 경우 모두 안전하다.
- 같은 `message.id`가 여러 파일에 나타난 경우는 실측 0건이었다(`uuid` 기준도 0건). 다만 `--resume`/`--fork-session` 등으로 이전 줄이 새 파일에 복사될 가능성이 있으므로, 중복 제거 범위는 파일 단위가 아니라 **전역**으로 잡는다.

### 4.3 제안: 중복 제거 규칙 (v1)

```
대상: type == "assistant" 이고 message.usage 가 객체인 줄
제외: message.model == "<synthetic>" 또는 isApiErrorMessage == true
키:   message.id            (없으면 requestId, 둘 다 없으면 파일경로#uuid 로 개별 취급)
병합: 같은 키의 줄들에서 4개 필수 토큰 필드를 각각 max() 로 취함
      model, sessionId, agentId, isSidechain 은 첫 줄 값을 쓰고 timestamp 는 마지막 줄 값을 씀
범위: 전역(모든 파일). 증분 처리 시 "처리한 키 집합"은 키 → 병합값 맵으로
      .harness-lens/ 에 보존해, 다음 실행에서 이미 집계한 키가 다시 나오면 차이분만 반영
```

증분 처리(PRD 11.1)는 파일별 `(inode, size, 마지막 읽은 바이트 오프셋)`을 저장하는 방식을 제안한다. 파일 크기가 줄었거나 inode가 바뀌면 그 파일을 처음부터 다시 읽는다. 한 응답의 줄들은 연속으로 기록되지만, 오프셋 경계에서 잘릴 수 있으므로 위의 키 → 병합값 맵이 필요하다. 마지막 줄이 개행 없이 끝나면 아직 쓰는 중인 줄로 보고 다음 실행으로 넘긴다.

## 5. 서브에이전트(사이드체인)

- 실측 버전에서 서브에이전트 기록은 **별도 파일**(`<sessionId>/subagents/agent-<agentId>.jsonl`)에 있다. 모든 줄이 `isSidechain: true`이고, `sessionId`는 부모 세션 ID와 같으며(175/175), `agentId`는 파일 이름과 같다(175/175).
- 메인 파일의 줄은 모두 `isSidechain: false`였다. 과거 버전은 사이드체인 줄을 메인 파일 안에 `isSidechain: true`로 섞어 기록했다고 알려져 있으므로, 파서는 **두 배치 모두** 지원해야 한다. 판별은 파일 위치가 아니라 `isSidechain`/`agentId` 필드로 한다.
- 서브에이전트의 API 호출은 부모와 별개의 응답(`message.id`가 다름)이다. 따라서 **합산해도 이중 집계가 아니다.** 단, 부모 쪽 결과에 붙는 요약값(`attachment.usage.totalTokens`, `toolUseResult` 안의 토큰 합계 등)은 같은 토큰을 다시 센 값이므로 합산에 쓰지 않는다. 쓰더라도 교차 검증용으로만 쓴다.
- 리포트에서는 메인과 서브에이전트를 나눠 보여주는 것을 제안한다. 서브에이전트 사용량은 `agentType`(meta.json)별로 묶을 수 있다. `description`은 사람이 쓴 텍스트이므로 읽지 않는다.
- 같은 부모 세션 아래에서 `parentAgentId`와 `spawnDepth`로 중첩 서브에이전트를 구분할 수 있다.

## 6. 보존 기간과 형식 안정성

### 6.1 보존 기간 (공식 문서로 확인)

- [claude-directory](https://code.claude.com/docs/en/claude-directory): Claude Code는 `cleanupPeriodDays`보다 오래된 `projects/<project>/<session>.jsonl` 등을 삭제한다. **기본값은 30일, 최솟값은 1이며 `0`은 검증 오류다.**
- [data-usage](https://code.claude.com/docs/en/data-usage): 세션 재개를 위해 기본 30일 동안 `~/.claude/projects/` 아래에 평문으로 보관한다.
- 예외: Claude Desktop이나 Cowork에서 시작하거나 마지막으로 이어간 세션은 기간과 관계없이 보관되며, 별도 설정 `desktopSessionCleanupPeriodDays`를 따른다.
- 실측: 표본의 가장 오래된 파일 수정 시각은 24.6일 전이었고, 로컬 설정에는 `cleanupPeriodDays`가 없었다. 기본 30일과 모순되지 않는다.
- 제품 영향: FR-10이 요구하는 "`.harness-lens/`에 집계값 누적 보존"은 필수다. 기본 설정에서는 30일 넘게 분석하지 않으면 원본 기록이 사라진다. 리포트에는 "원본 기록 범위: 최근 N일"을 표시하는 것을 제안한다.

### 6.2 형식 안정성

- 공식 문서는 jsonl 형식을 공개 계약으로 설명하지 않는다. 내용을 설명할 뿐 안정성을 보장하는 문구는 찾지 못했다. PRD 14.2의 리스크 판단이 맞다.
- 실측 근거: 4개 패치 버전으로 이루어진 좁은 표본에서도 최상위 레코드 타입이 25종 이상이었다. 과거에 보고된 `summary`/`progress`는 없었고, `usage.iterations`, `output_tokens_details`, `cache_creation` 분할처럼 새로 추가된 필드가 있었다. 서브에이전트의 저장 위치도 바뀌었다.
- 각 줄에 `version`(Claude Code 버전)이 있으므로, 파서 호환성 판단의 기준으로 쓸 수 있다.

제안하는 파서 호환 전략:

1. **허용 목록 방식**: 필요한 경로(`type`, `message.id`, `message.model`, `message.usage.{4필드}`, `content[].type/name`, `isSidechain`, `agentId`, `sessionId`, `timestamp`, `cwd`, `version`, `system.subtype/durationMs/...`)만 읽고 나머지는 해석하지 않는다. 원문 필드는 메모리에 오래 두지 않는다.
2. **관대한 파싱**: JSON 파싱 실패, 모르는 `type`, 타입이 다른 필드는 건너뛰고 개수만 센다. 건너뛴 비율이 임계값(예: 5%)을 넘거나 필수 4필드가 하나도 없으면 해당 축을 "예측"으로 유지하고 사유("세션 기록 형식 미지원: version X")를 표시한다(FR-10).
3. **버전 기록**: 스냅샷에 관측한 `version`의 최소·최대값과 파서 규칙 버전을 저장해, 형식이 바뀐 구간의 비교에 제한을 표시한다(FR-06).
4. **픽스처**: 아래 7장 스키마로 익명화한 합성 픽스처(중복 줄, 사이드체인, `<synthetic>`, 잘린 마지막 줄, 미지원 타입)를 만들어 회귀 테스트한다. 실제 기록을 픽스처로 커밋하지 않는다.

## 7. 익명화 스키마 스케치

값은 모두 가짜이고, 실측한 키와 타입만 반영했다.

```jsonc
// <encoded-cwd>/<sessionId>.jsonl — 한 응답(msg_A)이 2줄로 기록된 예
{"type":"user","uuid":"u1","parentUuid":null,"sessionId":"S","isSidechain":false,"cwd":"/p","gitBranch":"main","version":"2.1.3xx","entrypoint":"cli","timestamp":"T0","origin":{"kind":"human"},"message":{"role":"user","content":"<생략>"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","sessionId":"S","isSidechain":false,"requestId":"req_A","timestamp":"T1",
 "message":{"id":"msg_A","model":"claude-x","role":"assistant","stop_reason":"tool_use","content":[{"type":"thinking"}],
            "usage":{"input_tokens":3,"cache_creation_input_tokens":1200,"cache_read_input_tokens":45000,"output_tokens":310,
                     "cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":1200}}}}
{"type":"assistant","uuid":"a2","parentUuid":"a1","sessionId":"S","isSidechain":false,"requestId":"req_A","timestamp":"T1",
 "message":{"id":"msg_A","model":"claude-x","content":[{"type":"tool_use","name":"Read","input":"<읽지 않음>"}],
            "usage":{"input_tokens":3,"cache_creation_input_tokens":1200,"cache_read_input_tokens":45000,"output_tokens":310}}}
{"type":"system","subtype":"turn_duration","durationMs":8421,"sessionId":"S","uuid":"s1","timestamp":"T2"}
{"type":"attachment","attachment":{"type":"hook_non_blocking_error","hookEvent":"PostToolUse","hookName":"<이름>","exitCode":1},"sessionId":"S"}

// <encoded-cwd>/S/subagents/agent-G.jsonl
{"type":"assistant","isSidechain":true,"agentId":"G","sessionId":"S","message":{"id":"msg_B","model":"claude-y","usage":{"input_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":9000,"output_tokens":120}}}
```

위 예시의 올바른 집계는 다음과 같다. 메인: input 3 / cache_creation 1,200 / cache_read 45,000 / output 310(줄이 2개여도 1회). 서브에이전트(G): 5 / 0 / 9,000 / 120. 작업 시간 8.4초, Hook 실패 1건, 도구 호출 1건(Read).

## 8. Orca 봇 대화와 워커 워크트리 세션의 귀속 (PRD 6장 FR-10 보완)

### 8.1 관측된 모습

| 종류 | 실행 위치(cwd) | 프로젝트 디렉터리 이름 예 | `gitBranch` | 저장소 신호 |
|---|---|---|---|---|
| 일반 세션 | 저장소 루트 또는 하위 디렉터리 | `-Users-u-Documents-my-app` | 실제 브랜치 | cwd 자체 |
| Orca 워커 워크트리 | `~/orca/workspaces/<repo>/<worktree>` | `-Users-u-orca-workspaces-my-app-trevally` | 워커 브랜치 | 워크트리의 `.git` **파일**(`gitdir: <main>/.git/worktrees/<name>`) |
| Orca 봇 대화 | `~/.orca/bots/<bot>/` (실측: 모든 줄의 cwd가 봇 홈 안) | `-Users-u--orca-bots-my-app-bot` | `HEAD`(봇 홈은 git 저장소가 아님) | 없음. `bot.json`에도 저장소 연결 필드가 없음(`id`, `name`, `agent`, `avatar`, `members`만 있음) |

- 워커 세션은 워크트리마다 **별도 프로젝트 디렉터리**가 생긴다. 실측에서 한 저장소에 워크트리 디렉터리가 수십 개였다. 디렉터리 이름 기준으로 집계하면 한 프로젝트가 수십 개로 쪼개진다.
- 워크트리는 작업이 끝나면 삭제되는 경우가 많다. 세션 기록이 남아도 cwd 경로는 존재하지 않을 수 있다.
- 봇 대화는 저장소 밖에서 실행되고 워커를 디스패치한다. 봇 세션 자체의 토큰은 "조율 비용"으로, 실제 코드 작업 토큰은 워커 세션에 기록된다. 이번 표본에서 봇 세션의 `entrypoint`는 `orca`, 일부는 `sdk-cli`였다.
- 워커 세션에는 `origin.kind`(`human`, `task-notification`, `peer`)가 있어 사람 입력과 오케스트레이션 메시지를 구분할 수 있다.

### 8.2 제안: 프로젝트 귀속 규칙 (v1)

분석 대상 프로젝트 루트를 `R`(분석을 요청한 저장소의 메인 워크트리 경로)이라 하고, 세션마다 다음 순서로 판정한다. 먼저 맞는 규칙에서 멈춘다.

1. **직접 일치**: 세션의 첫 `cwd`(없으면 디렉터리 이름)가 `R`과 같거나 `R`의 하위 경로이면 R에 귀속한다(`direct`).
2. **git 워크트리 해석**: 첫 `cwd`가 존재하고 그 안에(또는 상위에) `.git` 파일이 있으면, 그 파일의 `gitdir:` 경로에서 `/.git/worktrees/<name>`를 떼어낸 메인 저장소 경로가 `R`과 같을 때 귀속한다(`worktree`). `git` 실행 없이 파일 하나만 읽으면 되므로 Read Only 원칙과 5초 예산에 맞는다. 결과는 `cwd → 메인 저장소` 캐시로 `.harness-lens/`에 저장해, 워크트리가 나중에 삭제되어도 재분석 결과가 같게 한다.
3. **삭제된 워크트리 추정**: 경로가 없으면, Orca 워크스페이스 규약 `<orca-workspaces>/<repoName>/<worktree>`에서 `<repoName>`이 `R`의 디렉터리 이름과 같을 때 귀속하되, 표시는 `inferred`(추정)로 한다. 이름 충돌 가능성이 있으므로 실측 수치에 "추정 귀속 포함 N%"를 함께 표시한다. 인코딩된 디렉터리 이름만으로는 `-`의 원래 문자를 알 수 없으므로, 반드시 `cwd` 원문 경로로 비교한다.
4. **봇 대화**: cwd가 `~/.orca/bots/<bot>/` 아래이면, 사용자가 `.harness-lens/config.json`의 `sessionAttribution.bots: {"<bot>": "<repo 경로>"}`로 명시한 경우에만 R에 귀속한다(`configured`). 그리고 별도 범주 **"오케스트레이션(봇)"**으로 집계해 워커 작업 토큰과 섞지 않는다. 봇 이름과 저장소 이름이 비슷하다는 휴리스틱(예: `my-app-bot` → `my-app`)은 기본으로 끄고, 설정 마법사에서 후보로 제안만 한다.
5. **그 외**: 귀속하지 않는다. 리포트에 "귀속 안 된 세션 N개(봇 M개 포함)"로 개수만 표시한다.

추가 규칙:

- 서브에이전트 기록은 항상 부모 세션의 귀속을 따른다(같은 `sessionId`).
- 세션 하나에 cwd가 여러 개이면 첫 cwd로 귀속한다. 실측에서 다른 cwd는 모두 시작 디렉터리의 하위 경로였다.
- 봇·워커 판별은 경로 규약에 의존한다. Orca 쪽 경로 규약(`~/.orca/bots`, `~/orca/workspaces`)은 설정으로 바꿀 수 있게 하고, 기본값은 실측 값으로 둔다.

## 9. 보안·개인정보 주의 (PRD 11장 연계)

- 세션 기록에는 원문이 넓게 퍼져 있다: `message.content`, `toolUseResult`, `attachment.{stdout, stderr, command, content}`, `api-request-blob`, `last-prompt`, `ai-title`, `queue-operation.content`. 또 `session-owner`에는 계정·조직 UUID가 있다. 엔진은 3.1절 허용 목록 밖의 필드를 **스냅샷·리포트·LLM 입력에 절대 넣지 않는다.**
- 집계 키로 쓰는 문자열(도구 `name`, `hookEvent`, `agentType`, 모델명)도 MCP 서버나 사용자 정의 이름이 들어갈 수 있다. 리포트에 표시하기 전에 비밀정보 제거 규칙(FR 11장)을 똑같이 적용한다.
- 파일이 클 수 있으므로(실측 최대 150MB) 반드시 줄 단위 스트리밍으로 읽는다.

## 10. 미결정 사항 / 후속 확인

1. 과거 버전(1.x, 2.0.x)의 실제 기록 표본으로 사이드체인의 메인 파일 혼재 여부, 스트리밍 중간 `usage`, `summary` 타입을 확인해야 한다. 이번 표본은 2.1.3xx뿐이다.
2. 긴 경로(약 200자 초과)의 디렉터리 이름 축약·해시 규칙은 미검증이다.
3. `--resume`/`--fork-session`/`/compact` 이후 줄 복사나 `message.id` 재사용 여부는 이번 표본에서 0건이었지만, 의도적으로 재현해 확인할 필요가 있다.
4. 봇 → 저장소 매핑을 Orca가 어디에 저장하는지(봇 홈의 설정 파일이나 Orca 앱 상태) 확인되면, 8.2절 규칙 4를 설정 없이 자동으로 처리할 수 있다.
5. 비용(USD) 표시 여부: `cost-state.costUSD`가 있지만 클라이언트 추정치다. PRD 비목표("비용 절감률 확정")와 맞추려면 토큰만 실측으로 표시하고 비용은 참고값으로 두는 것을 제안한다.
