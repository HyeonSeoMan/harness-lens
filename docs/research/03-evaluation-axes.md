# 조사 ③ 평가 축: 구조적 근거, 순서형 척도, 실측 지표

- 작성일: 2026-11-27
- 대상: PRD v0.2 §7.1 초기 평가 축(가설) 7개, FR-07a, FR-10, FR-11
- 상태: 연구 메모 (PRD 반영은 소유자 봇이 결정)
- 확인일: 모든 URL은 2026-11-27에 확인했다. Claude Code 문서는 자주 바뀌므로 루브릭 버전마다 다시 확인해야 한다.

## 0. 요약

1. **척도의 핵심은 "강제력의 위계"다.** 같은 의도라도 CLAUDE.md 문장(권고) < Skill·Subagent 정의(절차화) < `settings.json`의 permissions·hooks(하네스가 결정론적으로 실행)로 강제력이 다르다. 0~3 척도의 2와 3을 가르는 기준을 "LLM이 따르기로 선택해야 하는가, 하네스가 강제하는가"로 고정하면 축마다 재현 가능하게 판정할 수 있다.
2. **품질과 검증 신뢰성은 그대로 두면 같은 근거(테스트 관련 Hook·지침)를 두 번 센다.** 품질은 "정답이 무엇인지 정의돼 있는가(명세 측)", 검증 신뢰성은 "정답 여부를 누가, 언제 확인하고 실패를 막는가(게이트 측)"로 나누고, 근거 하나는 한 축에만 주 근거로 쓰는 규칙을 제안한다. 비용 효율과 컨텍스트 효율도 토큰 지표를 공유하므로 같은 방식으로 경계를 정한다.
3. **안전 경계 축이 빠져 있다.** deny 규칙, sandbox, `disableBypassPermissionsMode`처럼 설정에서 가장 뚜렷하게 보이는 구성이 지금은 들어갈 축이 없다. 억지로 넣으면 "자율성이 낮다"로 잘못 읽힌다. 8번째 축으로 **안전 경계**를 추가하거나, 자율성을 "경계가 정의된 자율성"으로 재정의하는 안 중 하나를 골라야 한다.
4. **세션 기록(FR-10)으로 실측 전환이 가능한 축은 처리 속도, 비용 효율, 컨텍스트 효율, 자율성, 실행 안정성(일부)이다.** 품질과 검증 신뢰성은 세션 기록만으로는 대리 지표(proxy)만 나오며 CI·PR 기록(MVP 3)이 있어야 실측으로 바꿀 수 있다.
5. **FR-07a용 긴장 조합은 10개를 정리했다.** 그중 근거가 가장 강한 것은 검증↔속도·비용, 자율성↔검증·안전, 컨텍스트 격리↔품질(요약 손실)이다.

## 1. 범위와 방법

- 관찰 대상: `CLAUDE.md`(및 `@import`), `.claude/settings.json`·`settings.local.json`·사용자·관리형 설정의 `permissions`·`hooks`·`sandbox`·`model`·`env`, `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.mcp.json`, 플러그인(`.claude-plugin/plugin.json`과 그 안의 skills·agents·hooks).
- 출처 우선순위: Claude Code 공식 문서 > Anthropic 엔지니어링 글 > 기타 공개 연구. 커뮤니티 경험담은 쓰지 않았다.
- 이 문서의 0~3 판정은 **구조적 지원 수준**이다. PRD §7.2대로 실제 성능을 뜻하지 않고, 설정 개수가 많다고 높게 매기지 않는다.

## 2. 공통 척도 정의

### 2.1 강제력의 위계

| 단계 | 메커니즘 | 성격 | 근거 |
|---|---|---|---|
| A. 서술 | `CLAUDE.md`, `CLAUDE.local.md`, 규칙 문서 | 매 세션 컨텍스트에 들어가지만 따를지는 모델이 정한다 | [Memory](https://code.claude.com/docs/en/memory) |
| B. 절차화 | Skill(`SKILL.md`), Subagent 정의(`.claude/agents/*.md`), 슬래시 명령 | 호출되면 절차와 도구 제한을 적용한다. 호출 여부는 대개 모델 또는 사용자가 정한다 | [Skills](https://code.claude.com/docs/en/skills), [Subagents](https://code.claude.com/docs/en/sub-agents) |
| C. 하네스 강제 | `permissions.deny/ask/allow`, `defaultMode`, `sandbox`, Hook(종료 코드 2 또는 `decision: "block"`), Subagent `tools` 제한, `maxTurns` | 모델의 선택과 무관하게 하네스가 실행·차단한다 | [Hooks](https://code.claude.com/docs/en/hooks), [Permissions](https://code.claude.com/docs/en/permissions) |
| D. 조직 강제 | 관리형 설정(managed settings), `disableBypassPermissionsMode` | 사용자·프로젝트 설정으로 덮어쓸 수 없다 | [Settings](https://code.claude.com/docs/en/settings) |

공식 문서에서 이 위계를 뒷받침하는 사실:

- 권한 규칙은 "deny, then ask, then allow" 순서로 평가하고, 구체성은 순서를 바꾸지 않는다([Permissions](https://code.claude.com/docs/en/permissions)). deny 규칙은 `bypassPermissions`를 포함한 모든 모드에서 유지된다([Best practices](https://code.claude.com/docs/en/best-practices)).
- 일치하는 deny 규칙은 Hook이 `allow`를 반환해도 막는다. 종료 코드 2로 끝나는 PreToolUse Hook은 규칙 검사 전에 도구 호출을 막는다([Permissions](https://code.claude.com/docs/en/permissions), [Hooks](https://code.claude.com/docs/en/hooks)).
- 종료 코드 2의 효과는 이벤트마다 다르다. PreToolUse는 도구 호출을 막고, PostToolUse는 이미 실행된 뒤라 stderr를 Claude에게 보여줄 뿐이다. Stop과 SubagentStop은 멈춤을 막아 작업을 계속하게 한다([Hooks](https://code.claude.com/docs/en/hooks)).
- 설정 우선순위는 관리형 > 명령줄 > 프로젝트 로컬 > 공유 프로젝트 > 사용자이고, `permissions.allow` 같은 목록 키는 덮어쓰지 않고 병합된다([Settings](https://code.claude.com/docs/en/settings)).
- 플러그인이 제공하는 Subagent는 `hooks`, `mcpServers`, `permissionMode` 필드를 무시한다([Subagents](https://code.claude.com/docs/en/sub-agents)). 따라서 플러그인 에이전트 파일 안의 Hook 선언은 C단계 근거로 세면 안 된다.

### 2.2 0~3 척도의 공통 판정 규칙

| 수준 | 이름 | 공통 판정 기준 |
|---|---|---|
| 0 | 미구성 | 해당 축을 다루는 근거가 수집 범위 안에 없다. 수집 범위 밖(예: 전역 설정 미포함)이라 못 본 경우는 0이 아니라 **미확인**이다 |
| 1 | 일부 구성 | A단계 서술만 있거나, B·C단계 구성이 있지만 축의 핵심 요소 중 일부만 다룬다(예: 테스트 실행 지침은 있으나 수용 기준 정의가 없다) |
| 2 | 명시적 구성 | 축의 핵심 요소를 B단계(호출 가능한 절차·전용 에이전트·구체적 설정값)로 구성했다. 다만 실행 여부를 모델이나 사용자의 선택에 맡긴다 |
| 3 | 강제 검증 | 핵심 요소 중 적어도 하나를 C 또는 D단계로 하네스가 강제하고, 실패하면 차단·재시도·중단 중 하나가 정의돼 있다 |

축 공통 감점·상한 규칙(LLM 판정 편차를 줄이기 위한 결정론적 규칙):

- **참조 무결성:** Hook 명령이 가리키는 스크립트가 저장소에 없거나 Skill·Agent 파일의 frontmatter를 파싱할 수 없으면, 그 근거는 최대 1로 센다.
- **무력화 설정:** `disableAllHooks: true`이면 Hook 근거는 모두 무효로 본다. 항목별 비활성화 여부는 엔진이 결정론적으로 판정한다.
- **플러그인 에이전트:** 플러그인 Subagent의 `hooks`·`permissionMode`는 근거로 세지 않는다(§2.1).
- **범위 표시:** 근거가 사용자·관리형 설정에서 왔으면 범위를 표시한다. 프로젝트만 분석할 때 전역 설정의 효과는 미확인으로 둔다.
- **개수 무관:** 같은 축에 Hook이 다섯 개 있어도 수준은 메커니즘 단계로 정하고 개수는 상세 표에만 표시한다.

## 3. 축별 루브릭

각 축은 "정의 → 수준별 관찰 근거 → 반례 → 실측 지표" 순서로 정리했다. 실측 지표는 FR-10 세션 기록에서 얻을 수 있는 것과 후속 MVP 소스가 필요한 것을 나눴다. 세션 기록 필드는 §5에서 다룬다.

### 3.1 품질 (제안 재정의: 명세 명확성)

**정의(제안):** 에이전트가 만든 결과의 "정답"이 무엇인지 하네스가 사전에 정의해 두는 정도. 요구사항, 수용 기준, 코딩 규약, 테스트 작성 정책이 대상이다. 결과를 확인하고 차단하는 행위는 검증 신뢰성(§3.2)으로 넘긴다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 요구사항·규약·테스트 정책에 대한 서술이 없다 |
| 1 | CLAUDE.md에 일반적 규약(스타일, "테스트를 작성하라")만 있다. 실행 명령이나 기준이 없다 |
| 2 | 빌드·테스트·린트 명령, 완료 정의(Definition of Done), 수용 기준 템플릿이 구체적으로 적혀 있다. 또는 명세 작성 Skill(예: spec/plan 절차)이나 계획 전용 에이전트가 있다. `defaultMode: "plan"`처럼 구현 전 계획을 기본값으로 둔 경우도 포함한다 |
| 3 | 명세 산출물의 존재나 형식을 하네스가 강제한다. 예: UserPromptSubmit·PreToolUse Hook이 명세 파일 없이 구현 파일 수정을 차단하거나, 수용 기준 스키마를 검사한다 |

- 반례: CLAUDE.md가 길다고 품질이 높은 것은 아니다. 공식 문서는 CLAUDE.md를 200줄 이하로 유지하고 "저장소를 읽어서 알 수 없는 것만" 적으라고 권한다([Memory](https://code.claude.com/docs/en/memory), [Best practices](https://code.claude.com/docs/en/best-practices)). 지나치게 긴 지침은 컨텍스트 효율 축의 비용이 된다.
- 세션 기록 실측: 직접 지표는 없다. 대리 지표로 "같은 작업 안에서 사용자가 정정 프롬프트를 보낸 비율"을 생각할 수 있으나, 원문을 읽지 않고(PRD §11) 정정 여부를 판정하기는 어렵다. **MVP 1에서는 예측 유지가 타당하다.**
- 후속 실측(MVP 3·4): 요구사항 충족률(평가 과제), PR 재작업 비율, 머지 후 결함 보고.

### 3.2 검증 신뢰성 (제안 재정의: 검증 게이트 강도)

**정의(제안):** 결과가 정답인지를 독립적으로 확인하고, 실패한 결과가 다음 단계로 넘어가지 못하게 막는 정도. "누가 검증하는가(독립성)"와 "실패 시 막는가(강제성)"를 함께 본다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 검증 절차가 없다 |
| 1 | CLAUDE.md에 "변경 후 테스트를 돌려라" 같은 서술만 있다. 또는 PostToolUse Hook이 포매터·린터를 실행하지만 실패를 피드백하지 않는다(정보 제공용) |
| 2 | 리뷰 전용 Subagent(예: `tools: Read, Grep, Glob`로 쓰기를 막은 리뷰어)나 검증 Skill이 있다. 또는 PostToolUse Hook이 실패를 stderr로 Claude에게 돌려준다. 실행 여부는 모델에게 달려 있다 |
| 3 | Stop·SubagentStop Hook이 테스트·타입 검사를 실행하고 실패하면 종료 코드 2로 종료를 막는다. 또는 PreToolUse Hook이 검증 없이 `git commit`·`git push`를 차단한다. 또는 `agent`·`prompt` 타입 Hook으로 독립 모델 판정을 강제한다 |

- 독립성 가산 표시: 같은 컨텍스트에서 자기 결과를 다시 보는 경우보다, 컨텍스트가 격리된 Subagent나 다른 모델이 검증하는 경우를 상세 표에 따로 표시한다. Subagent는 "자기 컨텍스트 창, 별도 시스템 프롬프트, 별도 도구 권한"으로 실행된다([Subagents](https://code.claude.com/docs/en/sub-agents)). 수준 자체는 강제성으로만 정하고, 독립성은 속성으로 남긴다. 두 기준을 한 숫자에 섞으면 루브릭을 설명하기 어려워진다.
- 근거: 공식 모범 사례는 "실행하면 통과·실패를 돌려주는 무언가를 Claude에게 주라"고 권하고, 종료 코드 2로 끝나는 Stop Hook을 검증 게이트 예시로 든다([Best practices](https://code.claude.com/docs/en/best-practices)). 평가자-최적화자 패턴은 "평가 기준이 명확하고 반복 개선이 측정 가능한 가치를 줄 때" 적합하다([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents), 2024-12-19).
- 반례: Stop Hook이 늘 실패하면 무한 계속 루프가 생겨 실행 안정성과 비용을 해친다. Hook 입력의 `stop_hook_active` 확인 같은 재진입 방지 로직이 있는지 함께 본다. 테스트 자체가 빈약하면 강제 검증이어도 잘못된 승인이 일어난다. 이 점은 정적 분석으로 알 수 없으므로 불확실성에 적는다.
- 세션 기록 실측(대리 지표만 가능): Hook 차단 횟수, 검증 Subagent 호출 비율(작업당 리뷰어 호출 수), 테스트 명령 실행 후 실패→수정→재실행 순환 수. 결함 탐지율과 잘못된 승인율은 정답 레이블이 필요하므로 MVP 3·4 범위다.

### 3.3 실행 안정성

**정의(제안):** 도구 실패, 외부 의존성 장애, 루프 같은 비정상 상황에서 하네스가 작업을 안전하게 복구하거나 중단하는 정도. 결과의 정답 여부는 다루지 않는다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 오류 처리·중단 조건에 대한 근거가 없다 |
| 1 | CLAUDE.md에 "실패하면 원인을 보고하라" 같은 서술만 있다 |
| 2 | 복구 절차를 담은 Skill(롤백, 체크포인트, worktree 격리 절차)이 있거나, Subagent에 `maxTurns`나 `isolation: worktree`가 지정돼 있다. Hook에 명시적 `timeout`이 있다 |
| 3 | 하네스가 상한이나 실패 경로를 강제한다. 예: PostToolUseFailure·StopFailure Hook이 실패를 기록하거나 알리고, Stop Hook에 재진입 방지가 있다. sandbox의 `failIfUnavailable`처럼 조건이 맞지 않으면 실행을 거부한다. 루프 상한(`maxTurns`)이 모든 자동 실행 경로에 지정돼 있다 |

- 참고 사실: Hook 기본 타임아웃은 `command` 600초, `prompt` 30초, `agent` 60초다([Hooks](https://code.claude.com/docs/en/hooks)). 기본값이 길어 명시 타임아웃이 없으면 걸린 Hook이 세션을 오래 붙잡을 수 있다. 에이전트 시스템에는 "최대 반복 횟수 같은 중단 조건"을 두는 것이 일반적이다([Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)).
- 세션 기록 실측: 도구 결과 오류율(`is_error`), 오류 직후 같은 도구 재호출 비율(재시도), 오류 후 세션 내 성공 도구 호출 도달 비율(복구율), API 오류·중단 횟수, 사용자 중단(interrupt) 횟수.

### 3.4 처리 속도

**정의(제안):** 같은 작업을 끝내는 데 걸리는 벽시계 시간을 구조적으로 줄이거나 늘리는 정도. 병렬화와 대기·반복 단계를 본다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 속도 관련 구성이 없다(이것만으로 느리다는 뜻은 아니다) |
| 1 | CLAUDE.md에 병렬 도구 호출, 빠른 테스트 부분 실행 같은 서술이 있다 |
| 2 | 병렬 실행을 위한 구성이 있다: `background: true` Subagent, worktree 격리 에이전트, 빠른 모델(`model: haiku`)을 배정한 탐색 에이전트. 자주 쓰는 명령을 `permissions.allow`에 넣어 승인 대기를 줄였다 |
| 3 | 대기 상한을 하네스가 강제한다. 예: 모든 Hook에 짧은 `timeout`을 지정했고, 오래 걸리는 검증 Hook은 비동기로 돌리거나 범위를 제한한다 |

- 주의: 속도 축의 "3 강제 검증"은 다른 축보다 의미가 약하다. 속도를 강제하는 메커니즘은 상한(타임아웃·턴 수)뿐이고, 상한은 속도를 높이지 않고 최악의 경우를 자를 뿐이다. 이 축은 **0~2만 쓰고 3은 비워 두는 안**도 검토할 만하다(§6 미결정 사항).
- 근거: 멀티 에이전트 연구 시스템은 병렬 도구 호출로 복잡한 질의의 조사 시간을 최대 90% 줄였다. 다만 "대부분의 코딩 작업은 연구보다 진짜로 병렬화할 수 있는 부분이 적다"고 밝힌다([Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system), 2025-06-13).
- 세션 기록 실측: 세션 벽시계 시간(첫·마지막 타임스탬프), 사용자 프롬프트→최종 응답 간격, 도구 호출 대기 시간, Hook 실행 시간(기록되는 경우), 권한 대기 시간(기록되는 경우, 확인 필요).

### 3.5 비용 효율

**정의(제안):** 성공한 작업 하나에 드는 **금전 비용**을 구조적으로 관리하는 정도. 모델 배정, effort·thinking 예산, 호출 횟수 상한, 캐시 재사용이 대상이다. 컨텍스트 창 점유는 §3.6으로 넘긴다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 모델·예산 관련 구성이 없다(기본값 사용) |
| 1 | CLAUDE.md에 비용 관련 서술만 있거나, `model` 하나만 고정했다 |
| 2 | 작업별 모델 라우팅이 있다: Subagent·Skill frontmatter의 `model`(`haiku`, `sonnet` 등), `effort`, `CLAUDE_CODE_SUBAGENT_MODEL`. `MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 같은 예산 환경 변수가 있다 |
| 3 | 비용 상한을 하네스가 강제한다. 예: 모든 자동 루프 경로에 `maxTurns`, 웹 검색 상한(`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`), 비싼 도구 호출을 PreToolUse Hook으로 제한·승인 요청한다 |

- 근거: 공식 비용 문서는 단순 Subagent에 `model: haiku`를 쓰고, 무관한 작업 사이에 `/clear`를 쓰고, effort나 thinking을 줄이라고 권한다. 평균 비용은 활성일당 약 13달러, 사용자 90%는 활성일당 30달러 미만이다. 에이전트 팀은 plan 모드에서 일반 세션보다 약 7배 토큰을 쓴다([Costs](https://code.claude.com/docs/en/costs)). 에이전트는 채팅보다 약 4배, 멀티 에이전트는 약 15배 토큰을 쓴다([Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)).
- 반례: 싼 모델로 라우팅하면 재작업이 늘어 성공 작업당 비용이 오히려 오를 수 있다. 그래서 실측 지표는 "세션당"이 아니라 "성공 작업당"이어야 하지만, MVP 1에는 성공 레이블이 없다. 세션당 값으로 표시하고 이 한계를 명시한다.
- 세션 기록 실측: 메시지별 `usage`(input, output, cache creation, cache read)와 `model`로 계산한 추정 비용, 모델별 토큰 분포, 캐시 적중률(cache read ÷ 전체 입력), Subagent(사이드체인) 토큰 비중.

### 3.6 컨텍스트 효율

**정의(제안):** 메인 컨텍스트 창에 들어가는 정보의 양과 관련성을 관리하는 정도. 상시 로드량 최소화, 지연 로드, 격리, 중복 제거, 압축이 대상이다. 금전 비용은 §3.5에서 다룬다.

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 관리 구성이 없다. 또는 상시 로드되는 CLAUDE.md·import 합계가 권장 크기를 크게 넘는다(측정은 엔진이 결정론적으로 한다) |
| 1 | CLAUDE.md가 적정 크기다. 다만 격리·지연 로드 구성이 없다 |
| 2 | 지연 로드와 격리를 쓴다: 세부 절차를 Skill로 분리(본문은 호출 때만 로드), 탐색을 Subagent로 위임, `context: fork` Skill, `omitClaudeMd`, 하위 디렉터리 CLAUDE.md(필요 시 로드), MCP 서버 수 최소화 |
| 3 | 컨텍스트 유입을 하네스가 제한한다. 예: `MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, `BASH_MAX_OUTPUT_LENGTH`를 기본값보다 낮게 지정했다. PreToolUse Hook으로 큰 파일 전체 읽기를 막는다. PreCompact Hook으로 압축 전 상태를 보존한다 |

- 근거: 컨텍스트가 길어질수록 정보 회상 능력이 떨어지는 "context rot"이 있다. 대응은 압축, 구조화된 노트, Subagent(보통 1,000~2,000토큰의 압축 요약을 반환), 필요할 때 불러오는 just-in-time 검색이다([Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), 2025-09-29). Skill 본문은 사용할 때만 로드되고 시작 시에는 이름과 설명만 로드된다([Skills](https://code.claude.com/docs/en/skills)). import는 컨텍스트 비용을 줄이지 않는다([Memory](https://code.claude.com/docs/en/memory)). MCP 도구 응답 기본 상한은 25,000토큰이고 10,000토큰을 넘으면 경고한다([Env vars](https://code.claude.com/docs/en/env-vars), [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). 코드 실행 방식의 MCP 활용은 한 예시에서 토큰을 150,000에서 2,000으로 줄였다([Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), 2025-11-04).
- 세션 기록 실측: 메인 스레드 턴별 입력 토큰 추이와 최대값, 압축(compaction) 발생 횟수, 첫 턴 입력 토큰(상시 로드량의 대리 지표), 같은 파일을 반복해서 읽은 횟수(중복 데이터량 대리 지표), 큰 도구 결과 건수.

### 3.7 자율성

**정의(제안):** 사람이 개입하지 않고 에이전트가 진행할 수 있는 범위가 **명시적으로 정의된** 정도. "높을수록 좋다"는 방향을 지키려면 승인 없이 넓게 열어 둔 상태를 높게 보면 안 된다. 그렇게 하면 `bypassPermissions`가 최고점이 된다. 대신 "어디까지 자동이고 어디서 멈추는지가 정의돼 있는가"를 본다(경계가 있는 자율성).

| 수준 | 관찰 가능한 구조적 근거 (예) |
|---|---|
| 0 | 권한 구성이 없다. 매번 기본 프롬프트에 의존한다. 자동 진행 범위도 중단 조건도 정의돼 있지 않다 |
| 1 | `permissions.allow`에 일부 명령만 있다. 또는 "물어보지 말고 진행하라" 같은 서술만 있다 |
| 2 | 자동 진행 범위(allow, `acceptEdits`·`auto` 모드)와 사람 승인 지점(ask 규칙, Notification Hook)을 함께 정의했다. 헤드리스 실행(`claude -p`)용 Skill·명령이 있다 |
| 3 | 자동 범위와 중단 조건을 하네스가 강제한다. 예: 자동 모드에서도 deny·ask 규칙과 PreToolUse Hook으로 위험 작업에서 반드시 멈춘다. Subagent마다 `permissionMode`·`tools`·`maxTurns`로 범위를 제한한다 |

- 사실: 권한 모드는 `default`(manual), `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`가 있다. `auto`와 `bypassPermissions`는 프로젝트·로컬 설정에서는 적용되지 않는다([Permissions](https://code.claude.com/docs/en/permissions), [Settings](https://code.claude.com/docs/en/settings)). 그래서 프로젝트 범위만 분석하면 실제 기본 모드는 미확인일 수 있다.
- 반례: `bypassPermissions`만 있고 deny·Hook이 없으면 자율성은 1(서술 수준의 경계)로 보고, 안전 경계(§4.3)는 0으로 본다.
- 세션 기록 실측: 세션당 사용자 프롬프트 수(인간 개입 횟수), 사용자 중단 횟수, 권한 요청·거부 횟수(기록 형식 확인 필요), 사용자 개입 없이 연속 실행된 도구 호출 수의 중앙값, 헤드리스 세션 비율.

## 4. 중복·누락 축 분석과 제안

### 4.1 품질 ↔ 검증 신뢰성 (중복 높음)

- 문제: PRD 표에서 품질의 근거("테스트 정책")와 검증 신뢰성의 근거("검증 절차")가 같은 파일을 가리킨다. 테스트를 돌리는 Stop Hook 하나가 두 축을 동시에 올리면 레이더가 부풀려진다. 실측 예시(결함률 대 결함 탐지율)도 같은 결함 데이터에서 나온다.
- 제안 A(권장): 두 축을 유지하되 경계를 다시 긋는다.
  - **명세 명확성**(품질): 입력 측. "무엇이 정답인가"를 정의하는 근거만 센다(요구사항, 수용 기준, 규약, 테스트 작성 정책, 계획 모드).
  - **검증 게이트 강도**(검증 신뢰성): 출력 측. "정답 여부를 실행해서 확인하고 실패를 막는가"를 보여주는 근거만 센다(Hook, 리뷰 에이전트, 승인 게이트).
  - **근거 단일 귀속 규칙:** 증거 하나는 축 하나에만 주 근거(primary)로 연결한다. 다른 축에는 참고 근거(secondary)로만 표시하고 수준 판정에는 쓰지 않는다. 엔진이 스키마 검증 단계에서 이를 확인할 수 있다(`findings[].evidenceIds` 중복 검사).
- 제안 B: 두 축을 "품질 보증" 하나로 합치고 하위 속성(명세·검증·독립성)을 상세 표에만 둔다. 축 수가 줄어 레이더는 단순해지지만, "명세는 탄탄한데 검증 게이트가 없다"는 흔한 상태를 레이더에서 볼 수 없다. 이 정보가 FR-07a의 "투자와 포기" 요약에 필요하므로 B는 권하지 않는다.

### 4.2 비용 효율 ↔ 컨텍스트 효율 (실측 지표 중복)

- 문제: 둘 다 토큰으로 측정된다. 컨텍스트를 줄이면 대개 비용도 줄어서 두 축이 같이 움직인다. 그래서 별도 축의 정보량이 작다.
- 반대 방향으로 움직이는 경우도 있다. Subagent 격리는 메인 컨텍스트를 줄이지만(컨텍스트 ↑) 총 토큰을 늘린다(비용 ↓). 프롬프트 캐시는 비용을 줄이지만 컨텍스트 점유는 그대로다. 이런 구성 요소에서 두 축이 갈리므로 **분리 유지를 권한다.**
- 경계 규칙: 컨텍스트 효율은 **메인 스레드의 턴별 입력 토큰과 압축 빈도**(창 점유)로, 비용 효율은 **모델 단가를 반영한 세션 전체(사이드체인 포함) 비용과 캐시 적중률**로 측정한다. 같은 원시 지표(토큰 합계)를 두 축에 동시에 쓰지 않는다.

### 4.3 누락: 안전 경계 (추가 제안)

- 문제: `permissions.deny`, `sandbox`(파일 시스템·네트워크 제한), `disableBypassPermissionsMode`, 비밀 파일 읽기 차단(예: `Read(./.env)` deny), MCP 서버 허용 목록은 설정에서 가장 뚜렷하게 보이는 구성이다. 그런데 7개 축 중 어디에도 맞지 않는다. 자율성에 넣으면 "제한이 많을수록 자율성이 낮다"로 읽히고, 실행 안정성에 넣으면 정의가 흐려진다.
- 제안: 8번째 축 **안전 경계**를 둔다. 0 없음 / 1 서술만 / 2 deny·ask 규칙과 Subagent 도구 제한 / 3 sandbox 활성화, 관리형 설정 또는 `disableBypassPermissionsMode`, PreToolUse 차단 Hook.
- 대안: 축 수를 7개로 유지해야 한다면, 자율성을 §3.7처럼 "경계가 있는 자율성"으로 정의하고 안전 근거를 자율성 3의 필수 조건으로 넣는다. 이 경우 "넓게 자동화했지만 경계가 없음"과 "경계는 단단하지만 자동화가 거의 없음"이 레이더에서 구별되지 않는다.
- 세션 기록 실측: deny로 막힌 호출 수, 권한 거부 수, sandbox 위반 시도 수(기록 형식 확인 필요).

### 4.4 실행 안정성 ↔ 검증 신뢰성 (경계 혼동)

- Stop Hook이 테스트를 돌리면 검증이고, Stop Hook이 무한 루프를 막으면 안정성이다. 같은 이벤트라도 **목적**으로 귀속한다. 하나의 Hook이 둘 다 하면 주 근거는 검증, 재진입 방지 로직은 안정성의 참고 근거로 둔다.

### 4.5 처리 속도 (정적 근거 약함)

- 정적 구성에서 속도를 높인다고 확인되는 근거는 병렬화 정도다. 속도를 낮추는 근거(검증 Hook, 리뷰 에이전트, ask 규칙)는 다른 축에서 이미 센다. 그래서 이 축은 사실상 "다른 축 투자의 대가"로만 움직인다. 정적 수준은 낮은 신뢰도로 표시하고, **세션 기록으로 가장 먼저 실측 전환하는 축**으로 두기를 권한다. 측정이 쉽기 때문이다.

## 5. 세션 기록 지표 매핑 (FR-10, FR-11)

세션 기록(`~/.claude/projects/<project>/*.jsonl`)은 공식 계약이 아니다(PRD §14.2). 아래 필드는 현재 Claude Code 버전에서 흔히 관찰되는 구조를 기준으로 썼고, 엔진 구현 전에 픽스처로 확인해야 한다. 기록은 기본 30일(`cleanupPeriodDays`) 뒤에 지워지므로([Costs](https://code.claude.com/docs/en/costs)) FR-10의 누적 보존이 필요하다. 공식적으로 계약된 대안은 OpenTelemetry 내보내기(토큰·비용·도구 결정 이벤트 등)이고, 사용자가 켠 경우에만 쓸 수 있다([Monitoring usage](https://code.claude.com/docs/en/monitoring-usage)). 원문은 읽어도 저장하거나 LLM에 넘기지 않는다는 PRD §11 원칙에 따라 모두 **숫자 집계**만 쓴다.

| 지표 | 원천 필드 (확인 필요) | 주 축 | 비고 |
|---|---|---|---|
| 세션 벽시계 시간, 프롬프트→완료 간격 | 각 줄의 `timestamp` | 처리 속도 | 유휴 시간 제거 규칙 필요(예: 간격 > N분은 제외) |
| 메시지별 토큰 (input / output / cache creation / cache read) | `message.usage.*` | 비용 효율 | 모델 단가표는 엔진에 버전 명시로 내장 |
| 모델 분포 | `message.model` | 비용 효율 | 라우팅 구성이 실제로 쓰였는지 확인 |
| 캐시 적중률 | cache read ÷ (input + cache creation + cache read) | 비용 효율 | |
| 메인 스레드 턴별 입력 토큰 최대값·추이, 첫 턴 입력 토큰 | `usage` + `isSidechain: false` | 컨텍스트 효율 | 첫 턴 값은 상시 로드량의 대리 지표 |
| 압축 발생 횟수 | 압축 요약·경계 표시 레코드 | 컨텍스트 효율 | 레코드 형식 확인 필요 |
| 동일 파일 반복 읽기 수 | Read 도구 입력의 경로 해시 | 컨텍스트 효율 | 경로는 해시로만 집계 |
| 도구 호출 수(도구 이름별) | `tool_use` 블록 | 처리 속도·비용 | |
| Subagent 호출 수·사이드체인 토큰 비중 | Task/Agent 도구 호출, `isSidechain: true` | 비용·컨텍스트·검증 | 리뷰어 이름별 집계로 검증 대리 지표 |
| 도구 오류율, 오류 후 재시도율, 복구율 | `tool_result.is_error`, 직후 호출 | 실행 안정성 | 재시도 = 오류 뒤 같은 도구 호출 |
| Hook 실패·차단 수 | Hook 관련 시스템 메시지·첨부 레코드 | 실행 안정성·검증 | FR-10에 명시된 지표. 형식이 가장 불확실하다 |
| 사용자 프롬프트 수, 사용자 중단 수 | `type: user` 중 도구 결과가 아닌 것, 중단 표시 | 자율성 | 원문을 읽지 않고 구분하는 규칙 필요 |
| 권한 요청·거부 수 | 권한 관련 레코드 | 자율성·안전 경계 | 기록 여부 확인 필요. 없으면 OTel의 도구 결정 이벤트 사용 |

FR-11 "실측까지 필요한 데이터" 표시를 위한 기본값 제안: 처리 속도·비용·컨텍스트는 해당 구성 이후 **세션 20회 이상**, 자율성·실행 안정성은 **도구 호출 500회 이상**. 근거가 있는 수치가 아니라 초기값이며, 분산을 보고 보정해야 한다. 품질·검증 신뢰성은 "세션 기록만으로는 실측 불가(MVP 3 필요)"로 표시하고 진행도 막대를 보여주지 않기를 권한다. 도달할 수 없는 진행도는 사용자를 오도한다.

## 6. 축 간 긴장 카탈로그 (FR-07a "현재 구성의 트레이드오프")

리포트는 아래 조합 중 **현재 구성에 해당 근거가 있는 것만** 표시한다. "근거 신호"는 엔진이 결정론적으로 찾을 수 있는 트리거다.

| # | 축 조합 | 메커니즘 | 근거 신호(트리거) | 출처 |
|---|---|---|---|---|
| T1 | 검증 ↑ ↔ 처리 속도 ↓ | 테스트를 돌리는 Stop·PreToolUse Hook과 리뷰 Subagent가 매 턴 대기를 늘린다 | 검증 수준 ≥ 2이면서 테스트·빌드 명령을 실행하는 Hook이 있다 | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) ("지연과 비용을 성능과 맞바꾼다") |
| T2 | 검증 ↑ ↔ 비용 효율 ↓ | 리뷰어·`agent` 타입 Hook은 별도 모델 호출이다 | 리뷰 Subagent, `prompt`·`agent` Hook | [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (4배·15배 토큰) |
| T3 | 자율성 ↑ ↔ 검증·안전 ↓ | 승인 지점을 줄이면 잘못된 변경이 사람 확인 없이 통과한다 | `auto`·`bypassPermissions`·넓은 allow(`Bash(*)`)가 있고, deny·차단 Hook은 없다 | [Permissions](https://code.claude.com/docs/en/permissions) |
| T4 | 검증 게이트 ↑ ↔ 자율성 ↓ | ask 규칙과 사람 승인 게이트가 많으면 자동 완료율이 낮아진다 | ask 규칙 수, Notification Hook | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (사람 체크포인트) |
| T5 | 자율성 ↑ ↔ 비용·안정성 ↓ | 중단 조건 없는 자동 루프는 토큰을 계속 쓴다. 늘 실패하는 Stop Hook은 무한 계속을 만든다 | `maxTurns` 없는 Subagent, 재진입 방지 없는 Stop Hook | [Hooks](https://code.claude.com/docs/en/hooks) |
| T6 | 컨텍스트 효율 ↑ ↔ 품질 ↓ | Subagent 격리·압축·`omitClaudeMd`는 메인 창을 지키지만, 요약 과정에서 세부와 규약이 빠진다 | `omitClaudeMd: true`, 다수의 `context: fork` Skill | [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Subagents](https://code.claude.com/docs/en/sub-agents) |
| T7 | 품질(명세) ↑ ↔ 컨텍스트 효율 ↓ | 긴 CLAUDE.md·import는 매 세션 상시 로드된다 | 상시 로드 합계가 권장(파일당 200줄)을 넘는다 | [Memory](https://code.claude.com/docs/en/memory) |
| T8 | 처리 속도 ↑ ↔ 비용 효율 ↓ | 병렬 Subagent·에이전트 팀은 시간을 줄이지만 총 토큰을 늘린다 | `background` Subagent, 에이전트 팀 구성 | [Costs](https://code.claude.com/docs/en/costs) (팀 약 7배), [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) |
| T9 | 비용 효율 ↑ ↔ 품질·검증 ↓ | 저가 모델 라우팅·thinking 축소는 어려운 작업에서 재작업을 늘릴 수 있다 | `model: haiku` 리뷰어·구현 에이전트, `MAX_THINKING_TOKENS` 낮음 | [Costs](https://code.claude.com/docs/en/costs) (단순 작업에 한정해 권장) |
| T10 | 기능 확장(MCP) ↔ 컨텍스트·안전 ↓ | MCP 서버가 늘면 도구 정의와 응답이 컨텍스트를 차지하고, 외부 시스템 접근 면이 넓어진다 | `.mcp.json` 서버 수, `MAX_MCP_OUTPUT_TOKENS` 미설정 | [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) |

같은 방향으로 움직이는 조합(시너지)도 함께 표시하기를 권한다. 사용자가 "이 축을 올리면 저 축은 공짜로 따라온다"는 점도 알아야 판단할 수 있다.

- 컨텍스트 효율 ↑ → 비용 효율 ↑ (상시 로드량 감소, 지연 로드)
- 검증(Hook 게이트) ↑ → 실행 안정성 ↑ (실패를 빨리 드러냄)
- 안전 경계(deny) ↑ → 자율성 ↑ (경계가 있으면 더 넓은 allow나 auto 모드를 안전하게 쓸 수 있다. 공식 문서는 deny가 모든 모드에서 유지된다고 명시한다)

## 7. 루브릭 운용 규칙 제안

1. **판정 단위 = 메커니즘 단계(§2.1).** LLM은 근거를 A~D 단계로 분류하고, 수준은 엔진이 단계 규칙으로 계산한다. LLM이 0~3 숫자를 직접 고르지 않게 하면 모델 간 편차가 줄어든다(PRD §14.2 "모델 간 분석 일관성").
2. **근거 단일 귀속(§4.1).** 증거 하나는 축 하나에만 주 근거로 쓴다.
3. **미확인 ≠ 0.** 수집 범위 밖, 파싱 실패, 공식 문서로 동작을 확인할 수 없는 설정 키는 미확인으로 둔다.
4. **반례 필수.** 각 축 판정에 "이 수준이 실제로는 성립하지 않을 조건"을 한 줄 이상 붙인다(예: "테스트가 빈약하면 강제 검증도 잘못 승인한다").
5. **문서 확인일.** 루브릭이 참조하는 설정 키마다 공식 문서 URL과 확인일을 지식 베이스에 기록한다. Hook 이벤트는 현재 30종이 넘고 자주 늘어나므로, 루브릭은 이벤트 목록을 하드코딩하지 말고 "차단 가능한 이벤트" 같은 속성으로 분류한다.

## 8. 미결정 질문

1. 8번째 축(안전 경계)을 추가할지, 자율성 재정의로 흡수할지.
2. 처리 속도 축에서 수준 3을 비워 둘지(0~2 척도), 아니면 "대기 상한 강제"로 정의할지.
3. 축 이름을 "품질 → 명세 명확성", "검증 신뢰성 → 검증 게이트 강도"로 바꿀지. 이름을 바꾸면 사용자가 레이더를 더 정확히 읽지만 PRD의 다른 절도 고쳐야 한다.
4. 세션 기록의 Hook 실패, 권한 요청, 압축 이벤트의 실제 레코드 형식. 픽스처를 만들어 확인해야 하고, 기록되지 않으면 FR-10의 "Hook 실패·재시도" 지표를 OTel 옵션으로 옮겨야 한다.
5. 실측 전환 기준(세션 20회, 도구 호출 500회)의 통계적 근거. MVP 1에서는 휴리스틱으로 공개하고 나중에 보정할지.

## 출처

공식 문서(Claude Code, 확인일 2026-11-27, 게시일 미표시):

- Hooks: https://code.claude.com/docs/en/hooks
- Settings: https://code.claude.com/docs/en/settings
- Settings reference: https://code.claude.com/docs/en/settings-reference
- Permissions: https://code.claude.com/docs/en/permissions
- Subagents: https://code.claude.com/docs/en/sub-agents
- Skills: https://code.claude.com/docs/en/skills
- Memory (CLAUDE.md): https://code.claude.com/docs/en/memory
- Costs: https://code.claude.com/docs/en/costs
- Environment variables: https://code.claude.com/docs/en/env-vars
- Best practices: https://code.claude.com/docs/en/best-practices (구 https://www.anthropic.com/engineering/claude-code-best-practices)
- Monitoring usage (OpenTelemetry): https://code.claude.com/docs/en/monitoring-usage (이 문서에서는 지표 범주만 참조했고 세부 이름은 확인하지 않았다)

Anthropic 엔지니어링 글:

- Building effective agents (2024-12-19): https://www.anthropic.com/engineering/building-effective-agents
- How we built our multi-agent research system (2025-06-13): https://www.anthropic.com/engineering/multi-agent-research-system
- Writing effective tools for agents (2025-09-11): https://www.anthropic.com/engineering/writing-tools-for-agents
- Effective context engineering for AI agents (2025-09-29): https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Code execution with MCP (2025-11-04): https://www.anthropic.com/engineering/code-execution-with-mcp
