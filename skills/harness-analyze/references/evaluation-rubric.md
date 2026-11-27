# 평가 루브릭 v0.1

- 루브릭 버전: `0.1` (분석 결과의 `rubricVersion`)
- 대상: PRD v0.3 §7.1의 8개 축, FR-07a, FR-10, FR-11
- 근거: `docs/research/03-evaluation-axes.md`(축·척도·긴장), `docs/research/02-session-logs.md`(세션 지표)
- 성격: 이 문서의 규칙은 **엔진이 결정론적으로 실행한다.** 사용자 LLM은 수준을 고르지 않고, 엔진이 계산한 수준을 해석만 한다(`analysis-protocol.md`).

수준(0~3)은 **구조적 지원 수준**이다. 실제 성능이 아니고, 설정이 많다고 올라가지 않는다(PRD §7.2). 표에 "휴리스틱"으로 표시한 수치는 근거 있는 기준이 아니라 초기값이며, 실측으로 보정한다.

## 1. 공통 규칙

### 1.1 강제력 단계 (`evidence.mechanism`)

| 값 | 단계 | 예 | 성격 |
|---|---|---|---|
| `narrative` | A. 서술 | `CLAUDE.md`, `CLAUDE.local.md`, `@import` 문서 | 따를지는 모델이 정한다 |
| `procedure` | B. 절차화 | Skill, Subagent 정의, frontmatter의 `model`·역할 | 호출되면 절차를 적용한다. 호출은 모델·사용자가 정한다 |
| `harness_enforced` | C. 하네스 강제 | `permissions.*`, Hook, Subagent `tools`·`maxTurns`, 출력 상한 환경 변수 | 모델의 선택과 무관하게 하네스가 실행·차단한다 |
| `org_enforced` | D. 조직·OS 강제 | 관리형 설정, `sandbox`, `disableBypassPermissionsMode` | 사용자·프로젝트 설정으로 끌 수 없거나 OS 단위로 막는다 |

### 1.2 수준의 공통 의미

| 수준 | 이름 | 공통 기준 |
|---|---|---|
| 0 | 미구성 | 수집 범위 안에 이 축의 근거가 없다. 범위 밖이라 못 본 것은 0이 아니라 범위(range)로 표시한다 |
| 1 | 일부 구성 | 서술(A)만 있거나, 축의 핵심 요소 중 일부만 있다 |
| 2 | 명시적 구성 | 핵심 요소를 절차(B) 또는 구체적 설정으로 구성했지만, 실패를 막는 강제가 없거나 실행을 모델에 맡긴다 |
| 3 | 강제 검증 | 핵심 요소 중 하나 이상을 하네스(C) 또는 조직·OS(D)가 강제하고, 실패 시 차단·중단·재진입 방지 중 하나가 정의돼 있다 |

PRD §7.1의 네 단계 위계(서술 < 절차 < Hook·권한 < 관리형·sandbox)는 수준 1~3에 대응한다. C와 D는 대부분의 축에서 같은 3이고, **안전 경계 축만** D를 3, C를 2로 나눈다(§2.8). D 여부는 모든 축에서 근거 속성으로 남는다.

### 1.3 수준 계산 절차 (엔진)

1. 수집한 설정을 근거 단위(§1.4)로 나누고, 귀속 순서(§1.5)로 근거마다 `primaryAxis`를 하나 정한다. 어느 규칙에도 맞지 않으면 `null`(미귀속)이다.
2. 공통 규칙(§1.6)으로 무력화(`void`)와 상한(`levelCap`)을 붙인다.
3. 축마다 무력화되지 않은 주 근거 집합에 대해 L3 → L1 순서로 규칙을 평가한다. 규칙이 맞으면 후보 수준 = min(규칙 수준, 그 규칙을 성립시킨 근거들의 상한 중 최솟값)이다.
4. 수준 = 후보 수준의 최댓값. `source.ruleId`는 그 후보를 낸 규칙이다. 같은 수준이 여럿이면 규칙 ID 사전순으로 가장 앞선 것을 쓴다(COM-10).
5. 축 상한 규칙(`<PREFIX>-CAP-nn`)을 적용하고, 낮춘 규칙을 `source.capRuleIds`에 기록한다.
6. 후보가 없을 때
   - 수집 범위 안의 출처 중 `unreadable`이 하나라도 있으면 `levelStatus: "unknown"`, `level: null`이다(COM-01).
   - 그렇지 않으면 `level: 0`, `ruleId: "<PREFIX>-L0-00"`이다.
7. `source.evidenceIds`에는 그 축의 무력화되지 않은 주 근거를 모두 정렬해 넣는다. 근거 개수는 수준에 영향을 주지 않는다(COM-05).

### 1.4 근거 단위

근거 하나는 **설정 키 하나, Hook 핸들러 하나, 파일 하나** 중 하나다. 같은 파일에서 나온 서로 다른 사실은 다른 근거다.

- 예: `reviewer.md` 파일 자체(역할), `tools` 필드, `model` 필드, `maxTurns` 필드는 근거 4개다. 각각 다른 축에 귀속된다.
- 서술 근거는 **(파일, 축)마다 하나**다. 그 파일에서 해당 어휘가 처음 나온 줄을 `line`으로 쓰고, 일치한 줄 수는 속성으로만 남긴다.
- `permissions.allow`·`ask`·`deny`는 목록 전체가 근거 하나다(`keyPath: /permissions/deny`). 규칙 수는 속성이다.

### 1.5 귀속 순서

한 근거가 여러 축 규칙에 맞을 수 있으면 아래 순서로 첫 번째 축에 귀속하고, 나머지는 `secondaryAxes`에 참고로 적는다. 참고 축은 수준 판정에 쓰지 않는다.

| 근거 | 귀속 순서 |
|---|---|
| 서술 한 줄이 여러 어휘에 맞음 | `safety_boundary` > `verification_gate_strength` > `spec_clarity` > `execution_stability` > `autonomy` > `cost_efficiency` > `context_efficiency` > `throughput` |
| 차단 표지가 있는 PreToolUse·UserPromptSubmit Hook | 명세 어휘 → SC / 검증 명령 어휘 → VG / matcher가 고비용 도구만 → CE / 그 외 → SB |
| Stop·SubagentStop Hook | 검증 명령 어휘 + 차단 표지, 또는 `prompt`·`agent` 타입 → VG / 그 외 → 미귀속 |
| PostToolUse Hook | 차단 표지 있음 → VG-L2 / 검증 명령 어휘만 있음 → VG-L1 / 그 외 → 미귀속 |
| Skill·Agent 파일(역할) | `reviewer` > `spec` > `recovery` > `parallel` > `explorer` 순으로 역할을 정한다. 역할 없는 Skill → CX(지연 로드), 역할 없는 Agent → 미귀속 |
| Hook 스크립트 안의 재진입 방지(`stop_hook_active`) | ES. 같은 Hook 선언은 VG로 따로 센다(근거가 다르다) |
| `permissions.ask` | AU(승인 지점). 참고 축 SB |
| `defaultMode` | `plan` → SC / 그 외 → AU |

### 1.6 공통 규칙 (`COM-nn`)

| ID | 규칙 |
|---|---|
| COM-01 | **미확인 ≠ 0.** 읽지 못한 출처가 있고 후보가 없으면 수준은 `null`(`unknown`)이다. 범위 밖 출처는 수준을 바꾸지 않고 범위 최댓값만 넓힌다(§1.8) |
| COM-02 | **참조 무결성.** Hook 명령이 가리키는 스크립트가 없거나, 자기 출처의 루트 밖(심볼릭 링크 이탈 포함. 프로젝트 구성 요소는 프로젝트 루트, 플러그인 구성 요소는 그 플러그인 루트 기준)이거나, Skill·Agent frontmatter를 파싱할 수 없으면 그 근거의 상한은 1이다 |
| COM-03 | **Hook 무력화.** 유효 설정의 `disableAllHooks: true`이면 모든 Hook 근거를 `void` 처리한다 |
| COM-04 | **플러그인 Subagent.** 플러그인이 제공한 Subagent의 `hooks`·`mcpServers`·`permissionMode`는 근거로 만들지 않는다(Claude Code가 무시한다) |
| COM-05 | **개수 무관.** 같은 축의 근거가 여러 개여도 수준은 규칙으로만 정한다. 개수는 상세 표 속성이다 |
| COM-06 | **단일 귀속.** 근거 하나는 축 하나의 수준 판정에만 쓴다(§1.5). validate가 `V-SINGLE-ATTRIBUTION`으로 확인한다 |
| COM-07 | **출처 표시.** 사용자·관리형·플러그인 출처의 근거는 `origin`을 남긴다 |
| COM-08 | **자기 제외.** Harness Lens 자신이 설치한 Skill·플러그인·파일은 어느 축의 근거도 되지 않는다. 자기 비용(`selfCost`)에만 나온다 |
| COM-09 | **유효 설정 병합.** 목록 키(`permissions.*`)는 출처를 합친다. 스칼라 키는 관리형 > 프로젝트 로컬 > 공유 프로젝트 > 사용자 순으로 앞선 값만 유효하고, 덮인 값의 근거는 `void`다 |
| COM-10 | **동률.** 같은 수준의 규칙이 여럿이면 규칙 ID 사전순 첫 번째를 `ruleId`로 쓴다 |
| COM-11 | **적용되지 않는 설정.** 그 출처에서 적용되지 않는다고 공식 문서가 밝힌 값은 `void`다. 예: 프로젝트·로컬 설정의 `defaultMode: "auto"`·`"bypassPermissions"` |

### 1.7 어휘 사전 (`LEX-*`, 휴리스틱)

엔진은 아래 목록으로만 텍스트를 분류한다. 대소문자를 무시하고 NFC로 정규화한 뒤 부분 문자열로 비교한다. 목록은 루브릭 버전에 묶여 있고, 바꾸면 루브릭 버전을 올린다. 어휘가 놓친 의미는 LLM이 `inferred` finding으로 지적할 수 있지만 수준은 바뀌지 않는다.

| ID | 용도 | 어휘 (v0.1) |
|---|---|---|
| LEX-NAR-SC | 서술: 명세 | `수용 기준`, `완료 정의`, `요구사항`, `명세`, `코딩 규약`, `acceptance criteria`, `definition of done`, `requirement`, `spec`, `convention`, `style guide` |
| LEX-NAR-VG | 서술: 검증 | `테스트를 실행`, `테스트 실행`, `타입 검사`, `리뷰`, `검증`, `run tests`, `run the tests`, `lint`, `typecheck`, `review`, `verify` |
| LEX-NAR-ES | 서술: 안정성 | `실패하면`, `실패 시`, `재시도`, `롤백`, `복구`, `on failure`, `retry`, `rollback`, `recover` |
| LEX-NAR-TP | 서술: 속도 | `병렬`, `동시에`, `parallel`, `concurrently`, `in the background` |
| LEX-NAR-CE | 서술: 비용 | `비용`, `토큰 예산`, `cost`, `token budget`, `cheaper model` |
| LEX-NAR-CX | 서술: 컨텍스트 | `컨텍스트`, `/clear`, `/compact`, `context window`, `subagent로 위임`, `delegate to a subagent` |
| LEX-NAR-AU | 서술: 자율 | `묻지 말고`, `확인 없이`, `승인을 받`, `without asking`, `autonomously`, `ask before` |
| LEX-NAR-SB | 서술: 안전 | `금지`, `비밀`, `.env`, `rm -rf`, `force push`, `secret`, `credential`, `never commit`, `do not push` |
| LEX-ROLE | Skill·Agent 역할(`name`+`description`) | reviewer: `review`, `verif`, `audit`, `qa`, `critic`, `검토`, `리뷰`, `검증` / spec: `spec`, `plan`, `prd`, `requirement`, `명세`, `계획`, `요구사항` / recovery: `rollback`, `recover`, `checkpoint`, `restore`, `복구`, `롤백` / parallel: `parallel`, `fan-out`, `dispatch`, `병렬` / explorer: `explore`, `search`, `research`, `investigat`, `탐색`, `조사` |
| LEX-VERIFY-CMD | Hook 명령·스크립트의 검증 명령 | `test`, `lint`, `eslint`, `prettier --check`, `tsc`, `typecheck`, `pytest`, `ruff`, `cargo clippy`, `go vet`, `mvn verify`, `gradle check` |
| LEX-SPEC-CMD | Hook 명령·스크립트의 명세 검사 | `spec`, `prd`, `acceptance`, `requirements`, `명세` |
| LEX-BLOCK | 차단 표지 | `exit 2`, `"decision": "block"`, `"permissionDecision": "deny"`, `"continue": false` (공백 차이 무시) |
| LEX-REENTRY | 재진입 방지 | `stop_hook_active` |

Hook 스크립트 해석: 명령의 첫 실행 파일(인터프리터 `bash`·`sh`·`node`·`python`·`python3` 뒤의 첫 경로 포함)을 `$CLAUDE_PROJECT_DIR`, `${CLAUDE_PLUGIN_ROOT}` 치환 후 찾는다. 자기 출처의 루트(프로젝트 또는 플러그인) 안에 있는 256KB 이하 파일만 읽는다. 스크립트를 실행하지 않는다.

### 1.8 가능 범위 (`axes[].range`)

- 예측 상태
  - `min` = 수준(`null`이면 0)이다.
  - `max` = max(수준, 읽지 못했거나 범위 밖인 출처가 이 축에 줄 수 있는 최대 수준)이다.
  - 사용자 설정을 수집하지 않으면 그 축의 최대 수준까지(`user_scope_not_collected`) 넓힌다.
  - 관리형 설정을 수집하지 않으면 SB 최대 3(`managed_settings_not_collected`)까지 넓힌다.
  - 읽지 못한 프로젝트 출처가 있으면 그 축의 최대 수준까지(`source_unreadable`) 넓힌다.
- 축 최대 수준은 3이다. 단, TP는 2다(L3 예약, `level3_reserved`).
- 실측 상태
  - 중심은 `measured.band`다.
  - 표본이 요구량의 2배 미만이면 band ± 1을 [0, 3]으로 자른다(`sample_below_2x_requirement`). 2배 이상이면 [band, band]다.
  - 사유 코드 `measured_band`를 붙인다.
- 리포트는 이 범위를 반투명 막대로 그린다. 수집 범위를 넓히거나 세션이 쌓이면 범위가 좁아진다(FR-11).

### 1.9 성숙도와 실측 전환 (FR-11)

- **실측 지표는 0~3 구조 척도와 같은 레이더 축에 올린다(제안).**
  - 실측 상태 축은 실측 대역(`measured.band`)을 실선·채운 점으로 그린다.
  - 직전 구조 수준(`measured.predictedLevel`)은 흐린 점선으로 겹친다. 차이는 `deltaFromPredicted`다.
  - 대역 임계값은 모두 휴리스틱이며 `heuristic: true`로 표시한다.
  - 이 방식을 쓸지는 소유자 결정 사항이다(PR 설명 참고). 별도 패널로 정하면 `measured.band`를 레이더에 쓰지 않으면 된다. 스키마는 바뀌지 않는다.
- 실측 전환 조건
  - 실측 가능 축(`measurable: true`)에서 `configSince` 이후 표본이 요구량에 도달하면 `state: "measured"`가 된다.
  - `configSince`는 현재 구성 해시가 처음 관측된 시각이다. 이전 스냅샷이 없으면 수집한 설정 파일 중 가장 최근 수정 시각을 쓴다.
- 진행도 = min(1, 현재 표본 ÷ 요구량)이다. 실측 불가 축은 진행도를 표시하지 않는다(도달할 수 없는 진행도는 사용자를 오도한다).
- 세션 지표 집계 범위
  - 봇 채팅은 조율 비용이므로 축 지표에서 뺀다.
  - 서브에이전트 기록은 `tool_error_rate`와 `cache_hit_ratio`에만 포함한다.
  - 나머지 지표는 프로젝트·워커 세션의 메인 스레드만 쓴다.

| 축 | 실측 가능 | 요구량 (휴리스틱) | 대역 규칙 | 지표 → 대역 (휴리스틱) |
|---|---|---|---|---|
| spec_clarity | 아니오 (`needs_ci_pr_data`, MVP 3) | — | — | — |
| verification_gate_strength | 아니오 (`needs_ci_pr_data`, MVP 3) | — | — | 대리 지표(Hook 차단 수, 리뷰어 호출 비율)는 `axisMetrics`에만 싣는다 |
| execution_stability | 예 | 도구 호출 500회 | ES-M-01 | `tool_error_rate` ≤ 0.02 → 3, ≤ 0.05 → 2, ≤ 0.10 → 1, 그 외 0 |
| throughput | 예 | 세션 20회 | TP-M-01 | `turn_duration_p50_ms` ≤ 30,000 → 3, ≤ 90,000 → 2, ≤ 300,000 → 1, 그 외 0 (작업 크기 미보정) |
| cost_efficiency | 예 | 세션 20회 | CE-M-01 | `cache_hit_ratio` ≥ 0.90 → 3, ≥ 0.75 → 2, ≥ 0.50 → 1, 그 외 0 (성공 작업당 비용이 아니라 세션 기준) |
| context_efficiency | 예 | 세션 20회 | CX-M-01 | `context_p90_tokens` ≤ 50,000 → 3, ≤ 100,000 → 2, ≤ 150,000 → 1, 그 외 0. `compactions_per_session` > 0.5이면 최대 1 |
| autonomy | 예 | 도구 호출 500회 | AU-M-01 | `tool_calls_between_prompts_p50` ≥ 20 → 3, ≥ 8 → 2, ≥ 3 → 1, 그 외 0 |
| safety_boundary | 아니오 (`session_format_unconfirmed`) | — | — | 권한 거부 기록 형식이 확인되면 도구 호출 500회 기준으로 전환을 검토한다 |

지표 정의 (모두 `message.id` 중복 제거 후, 원문 없이 숫자만):

| metricId | 정의 |
|---|---|
| `tool_error_rate` | `tool_result.is_error == true` 수 ÷ `tool_use` 블록 수 |
| `tool_error_recovery_rate` | 오류 뒤 같은 세션에서 성공한 도구 호출이 이어진 비율 |
| `turn_duration_p50_ms` | `system(turn_duration).durationMs`의 중앙값 |
| `cache_hit_ratio` | cacheRead ÷ (freshInput + cacheWrite + cacheRead) |
| `context_p90_tokens` | 메인 스레드 요청별 입력 크기(freshInput + cacheWrite + cacheRead)의 90분위 |
| `compactions_per_session` | `system(compact_boundary)` 수 ÷ 세션 수 |
| `tool_calls_between_prompts_p50` | 사람 프롬프트(`origin.kind == "human"`) 사이 `tool_use` 수의 중앙값 |
| `human_prompts_per_session` | 세션당 사람 프롬프트 수 |
| `hook_blocks_per_session` | VG 대리 지표. 차단된 Hook 결과 수 ÷ 세션 수 (형식 확인 필요) |
| `reviewer_calls_per_session` | VG 대리 지표. 역할이 reviewer인 Subagent 호출 수 ÷ 세션 수 |

## 2. 축별 규칙

각 표의 "근거"는 엔진이 수집 결과에서 결정론적으로 확인하는 조건이다. 모든 축에 `<PREFIX>-L0-00`(후보 없음 → 0)이 있다.

### 2.1 명세 명확성 `spec_clarity` (SC)

정의: 결과의 "정답"을 하네스가 미리 정의해 두는 정도다. 요구사항, 수용 기준, 규약, 계획 단계가 대상이다. 결과를 실행해 확인하는 것은 VG다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| SC-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-SC 일치 줄이 있다 | narrative |
| SC-L2-01 | 2 | 역할이 `spec`인 Skill이 있다 | procedure |
| SC-L2-02 | 2 | 역할이 `spec`인 Subagent가 있다 | procedure |
| SC-L2-03 | 2 | 유효 설정 `permissions.defaultMode`가 `plan`이다 | harness_enforced |
| SC-L3-01 | 3 | 차단 표지가 있는 UserPromptSubmit Hook, 또는 matcher에 `Write`·`Edit`가 들어간 PreToolUse Hook의 명령·스크립트에 LEX-SPEC-CMD가 있다 | harness_enforced |

- 서술은 아무리 구체적이어도 1이다. 조사 03은 구체적 명령·완료 정의 서술을 2로 제안했지만, PRD §7.1의 강제력 위계를 따른다. 구체성은 LLM이 finding으로 설명한다.
- 반례: 긴 지침이 명세를 명확하게 만들지는 않는다. 오히려 컨텍스트 비용이 된다(T7).

### 2.2 검증 게이트 강도 `verification_gate_strength` (VG)

정의: 결과가 맞는지 실행해서 확인하고, 실패한 결과가 다음 단계로 넘어가지 못하게 막는 정도다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| VG-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-VG 일치 줄이 있다 | narrative |
| VG-L1-02 | 1 | PostToolUse Hook 명령·스크립트에 LEX-VERIFY-CMD가 있지만 차단 표지는 없다 | harness_enforced |
| VG-L2-01 | 2 | 역할이 `reviewer`인 Subagent가 있다 | procedure |
| VG-L2-02 | 2 | 역할이 `reviewer`인 Skill이 있다 | procedure |
| VG-L2-03 | 2 | 차단 표지가 있는 PostToolUse Hook이 있다(이미 실행된 뒤라 막지 못하고 Claude에게 돌려준다) | harness_enforced |
| VG-L3-01 | 3 | Stop·SubagentStop Hook 명령·스크립트에 LEX-VERIFY-CMD와 차단 표지가 함께 있다 | harness_enforced |
| VG-L3-02 | 3 | 차단 표지가 있는 PreToolUse Hook 명령·스크립트에 LEX-VERIFY-CMD가 있다(검증 없는 커밋 차단 등) | harness_enforced |
| VG-L3-03 | 3 | Stop·SubagentStop Hook의 `type`이 `prompt` 또는 `agent`다 | harness_enforced |

- 독립성: reviewer의 `tools`에 `Write`·`Edit`·`Bash`가 없으면 컴포넌트 속성 `independent: true`로 상세 표에만 표시한다. 수준에는 섞지 않는다.
- 반례: 테스트가 빈약하면 강제 게이트도 잘못 승인한다. 늘 실패하는 Stop Hook은 무한 계속 루프를 만든다(T5).

### 2.3 실행 안정성 `execution_stability` (ES)

정의: 도구 실패, 루프, 걸린 Hook 같은 비정상 상황에서 하네스가 작업을 안전하게 끝내거나 복구하는 정도다. 결과의 정답 여부는 다루지 않는다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| ES-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-ES 일치 줄이 있다 | narrative |
| ES-L2-01 | 2 | Subagent에 `maxTurns`가 있다 | harness_enforced |
| ES-L2-02 | 2 | Subagent에 `isolation: worktree`가 있다 | harness_enforced |
| ES-L2-03 | 2 | Hook 핸들러에 명시적 `timeout`이 있다 | harness_enforced |
| ES-L2-04 | 2 | 역할이 `recovery`인 Skill·Subagent가 있다 | procedure |
| ES-L3-01 | 3 | 실패 이벤트 Hook(`PostToolUseFailure` 등 이름에 `Failure`가 들어간 이벤트)이 있다 | harness_enforced |
| ES-L3-02 | 3 | Stop·SubagentStop Hook 스크립트에 LEX-REENTRY가 있다 | harness_enforced |
| ES-L3-03 | 3 | Subagent가 1개 이상이고 모두 `maxTurns`를 갖는다(ES-L2-01 근거 집합으로 판정) | harness_enforced |

- 수준 2와 3의 차이: 상한이 일부에만 있으면 2, 실패 경로나 재진입 방지가 강제되면 3이다.
- 반례: 오류율은 작업 난이도에 크게 좌우된다. 실측 대역이 낮아도 구성 탓이라고 단정하지 않는다.

### 2.4 처리 속도 `throughput` (TP)

정의: 같은 작업을 끝내는 벽시계 시간을 구조적으로 줄이는 정도다. 속도를 낮추는 구성(검증 Hook, 리뷰, ask)은 다른 축에서 세고, 여기서는 긴장(T1, T4)으로만 다룬다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| TP-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-TP 일치 줄이 있다 | narrative |
| TP-L2-01 | 2 | Subagent에 `background: true`가 있다 | harness_enforced |
| TP-L2-02 | 2 | 역할이 `parallel`인 Skill·Subagent가 있다 | procedure |
| (L3) | — | **예약.** 속도를 강제하는 메커니즘은 상한뿐이고, 상한은 속도를 높이지 않는다. v0.1에서는 정의하지 않는다 | — |

- 정적 근거가 약한 축이다. 세션 기록으로 가장 먼저 실측 전환하는 축으로 둔다.
- 반례: 작업이 작으면 병렬화가 없어도 느리지 않다. 수준 0은 "느리다"가 아니라 "속도 구성이 없다"는 뜻이다.

### 2.5 비용 효율 `cost_efficiency` (CE)

정의: 작업 하나에 드는 금전 비용을 구조적으로 관리하는 정도다. 모델 배정, 출력·사고 예산, 호출 상한이 대상이다. 컨텍스트 창 점유는 CX다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| CE-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-CE 일치 줄이 있다 | narrative |
| CE-L1-02 | 1 | 유효 설정에 최상위 `model`만 고정돼 있다 | harness_enforced |
| CE-L2-01 | 2 | Subagent·Skill frontmatter에 `inherit`가 아닌 `model`이 있다(작업별 라우팅) | procedure |
| CE-L2-02 | 2 | `env`에 `MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_SUBAGENT_MODEL` 중 하나가 있다 | harness_enforced |
| CE-L3-01 | 3 | `env`에 `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`이 있다(조사 03 인용, 구현 전 공식 문서 재확인) | harness_enforced |
| CE-L3-02 | 3 | 차단 표지가 있는 PreToolUse Hook의 matcher가 고비용 도구(`WebSearch`, `WebFetch`, `Task`, `Agent`)만 대상으로 한다 | harness_enforced |

- `maxTurns`는 ES에 귀속한다(§1.5). CE에는 참고 축으로만 표시한다.
- 반례: 싼 모델로 라우팅하면 재작업이 늘어 성공 작업당 비용이 오를 수 있다(T9). MVP 1에는 성공 레이블이 없어 세션 기준으로만 측정한다.

### 2.6 컨텍스트 효율 `context_efficiency` (CX)

정의: 메인 컨텍스트 창에 들어가는 정보의 양과 관련성을 관리하는 정도다. 상시 로드 최소화, 지연 로드, 격리, 출력 상한이 대상이다. 금전 비용은 CE다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| CX-L1-01 | 1 | 상시 로드 지침이 1개 이상이고 파일마다 200줄 이하다(휴리스틱, 공식 권장 기준) | narrative |
| CX-L2-01 | 2 | 역할 없는 Skill이 있다(본문 지연 로드) | procedure |
| CX-L2-02 | 2 | Skill에 `context: fork`가 있다 | procedure |
| CX-L2-03 | 2 | 역할이 `explorer`인 Subagent가 있다(탐색 위임) | procedure |
| CX-L2-04 | 2 | 하위 디렉터리 `CLAUDE.md`가 있다(필요 시 로드) | narrative |
| CX-L3-01 | 3 | `env`에 `MAX_MCP_OUTPUT_TOKENS`(25,000 미만), `BASH_MAX_OUTPUT_LENGTH`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` 중 하나가 있다 | harness_enforced |
| CX-L3-02 | 3 | PreCompact Hook이 있다 | harness_enforced |
| CX-CAP-01 | 상한 1 | 상시 로드 합계가 400줄을 넘는다(휴리스틱) | — |

- `@import`는 컨텍스트를 줄이지 않는다. import한 파일도 상시 로드 합계에 넣는다.
- 반례: 격리·요약은 메인 창을 지키지만 세부와 규약이 빠질 수 있다(T6).

### 2.7 자율성 `autonomy` (AU)

정의: 사람 개입 없이 진행할 범위와 멈출 지점이 **명시적으로 정의된** 정도다. 넓게 열어 둔 상태를 높게 보지 않는다. 핵심 요소는 (a) 자동 진행 범위와 (b) 정지·승인 지점이다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| AU-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-AU 일치 줄이 있다 | narrative |
| AU-L1-02 | 1 | (a)와 (b) 중 하나만 있다. (a) = `permissions.allow`, 유효 `defaultMode` ∈ {`acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`}, Subagent `permissionMode`. (b) = `permissions.ask`, Notification Hook | harness_enforced |
| AU-L2-01 | 2 | (a)가 있고 (b)는 Notification Hook뿐이다(알림만 하고 멈추지 않는다) | harness_enforced |
| AU-L3-01 | 3 | (a)가 있고 `permissions.ask`가 1개 이상이다(하네스가 멈춘다) | harness_enforced |

- `defaultMode: "auto"`·`"bypassPermissions"`가 프로젝트·로컬 설정에 있으면 COM-11로 무력화한다.
- 반례: `bypassPermissions`만 있고 ask·deny가 없으면 1이다. 실측 대역이 구조 수준보다 낮으면 작업 성격 때문일 수 있다.

### 2.8 안전 경계 `safety_boundary` (SB)

정의: 에이전트가 넘지 말아야 할 경계(파일, 명령, 네트워크, 권한 모드)를 하네스가 정의하고 강제하는 정도다.

| 규칙 | 수준 | 근거 | 단계 |
|---|---|---|---|
| SB-L1-01 | 1 | 상시 로드 지침에 LEX-NAR-SB 일치 줄이 있다 | narrative |
| SB-L2-01 | 2 | Subagent에 `tools` 허용 목록 또는 `disallowedTools`가 있다 | harness_enforced |
| SB-L2-02 | 2 | 차단 표지가 있는 PreToolUse Hook이 있다(§1.5에서 SC·VG·CE로 가지 않은 것) | harness_enforced |
| SB-L2-03 | 2 | `permissions.deny`가 1개 이상이다 | harness_enforced |
| SB-L3-01 | 3 | 유효 설정 `sandbox.enabled: true` | org_enforced |
| SB-L3-02 | 3 | 유효 설정 `disableBypassPermissionsMode: "disable"` | org_enforced |
| SB-L3-03 | 3 | 관리형 설정에서 온 SB 근거(deny, 차단 Hook)가 있다 | org_enforced |

- 이 축만 C(도구 호출 단위 규칙)를 2, D(OS·조직 단위)를 3으로 나눈다. 권한 규칙과 Hook은 Claude Code 도구 호출만 보지만, sandbox는 Bash 하위 프로세스까지 막고 관리형 설정은 사용자가 끌 수 없다. 조사 03은 PreToolUse 차단 Hook을 3으로 제안했으나 PRD §7.1 위계에 맞춰 2로 둔다.
- `permissions.ask`는 AU에 귀속하고 SB에는 참고로 표시한다(PRD §7.1 표는 ask를 SB 근거로 적었다. PR 설명의 PRD 변경 제안 참고).
- 반례: deny 규칙은 Bash 하위 프로세스의 파일 접근을 막지 못할 수 있다. 사용자 범위를 수집하지 않으면 sandbox 여부는 미확인이다.

## 3. 긴장·시너지 트리거 (FR-07a)

엔진은 아래 트리거가 맞는 조합만 `tensionCandidates`로 낸다. LLM은 이 후보 안에서만 `axisTensions`를 쓴다. 트리거가 맞지 않은 조합은 리포트에 나오지 않는다.

| ID | 종류 | 축 | 트리거 (결정론적) | 후보 근거 |
|---|---|---|---|---|
| T1 | 긴장 | VG ↔ TP | VG-L1-02, VG-L3-01, VG-L3-02 중 하나에 맞는 Hook이 있다(검증 명령을 실행하는 Hook) | 그 Hook 근거 |
| T2 | 긴장 | VG ↔ CE | VG-L2-01, VG-L2-02, VG-L3-03 중 하나(별도 모델 호출) | 그 근거 |
| T3 | 긴장 | AU ↔ VG, SB | (a)에 유효 `defaultMode` ∈ {`auto`, `dontAsk`, `bypassPermissions`} 또는 allow에 인자 없는 `Bash`·`Bash(*)`가 있고, SB-L2-02·SB-L2-03 근거가 없다 | (a) 근거 |
| T4 | 긴장 | VG, SB ↔ AU | `permissions.ask` 3개 이상(휴리스틱) 또는 Notification Hook | ask·Hook 근거 |
| T5 | 긴장 | AU ↔ CE, ES | `maxTurns` 없는 Subagent가 있거나, 차단 표지가 있는 Stop Hook에 LEX-REENTRY가 없다 | 그 Agent·Hook 근거 |
| T6 | 긴장 | CX ↔ SC | Skill 3개 이상이 `context: fork`이거나, Subagent에 `omitClaudeMd: true`가 있다(키 존재는 구현 전 공식 문서 재확인) | 그 근거 |
| T7 | 긴장 | SC ↔ CX | 상시 로드 지침 중 200줄을 넘는 파일이 있다 | 상시 로드 근거 |
| T8 | 긴장 | TP ↔ CE | TP-L2-01 또는 TP-L2-02 근거 | 그 근거 |
| T9 | 긴장 | CE ↔ VG | 역할이 `reviewer`인 Subagent의 `model`이 `haiku`이거나, `MAX_THINKING_TOKENS`가 있다 | `model`·`env` 근거 |
| T10 | 긴장 | CX, SB ↔ MCP 확장 | MCP 서버가 1개 이상이고 `MAX_MCP_OUTPUT_TOKENS`가 없다 | MCP 근거(미귀속) |
| S1 | 시너지 | CX → CE | CX 수준 2 이상 | CX 주 근거 |
| S2 | 시너지 | VG → ES | VG-L3-* 근거 | 그 근거 |
| S3 | 시너지 | SB → AU | SB-L2-03 근거와 (a) 근거가 함께 있다 | deny·(a) 근거 |

## 4. 버전 관리

- 규칙 조건, 어휘, 임계값, 귀속 순서 중 하나라도 바뀌면 `rubricVersion`을 올린다. 규칙 ID는 재사용하지 않는다. 폐기한 규칙은 이 문서에 "폐기"로 남긴다.
- 루브릭이 참조하는 설정 키는 구현 전에 공식 문서로 다시 확인하고, 지식 베이스 항목에 URL과 확인일을 남긴다(조사 03 §7.5).
- 버전이 다른 스냅샷끼리는 `comparison.comparability`를 `limited` 이하로 둔다(FR-06).
