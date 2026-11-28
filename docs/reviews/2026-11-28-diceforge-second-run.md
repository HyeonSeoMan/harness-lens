# DiceForge 2회차 실행: 5단계 개선 확인 (2026-11-28)

- 기준 main: `929c335`(#22까지). 엔진 0.4.0, 스키마 0.1, 루브릭 0.4, 세션 파서 5.
- 대상: `~/Documents/DiceForge`(HEAD `9b35cfa`), 읽기만 했다. 실행한 명령은 Harness Lens 엔진과 읽기 전용 `git log`·`git diff`뿐이다.
- 절차: `skills/harness-analyze/SKILL.md` → `references/analysis-protocol.md`를 그대로 따랐다. `prepare --scope project --out ~/Documents/harness-lens-runs/DiceForge`, 압축 인벤토리 나눠 읽기(jq 키별), 원본 2개(PreToolUse·Stop 스크립트) 열람, `interpretation.json` 작성, `finalize --agent claude-code --model claude-opus-5-5 --out ...`.
- 결과: 새 스냅샷 `20261128T140600Z-0ab0c1ca`, `report.html`. 1회차 스냅샷 `20261127T102221Z-0ae31e0e`(analysis.json·report.html)는 실행 전후 SHA-1이 같다. 결과 루트의 `report.html`은 엔진 명세상 "최신 사본"이라 finalize가 덮어썼다. 실행 전에 1회차 스냅샷 안 `report.html`과 바이트 단위로 같음을 확인해서, 1회차 리포트는 스냅샷 안에 그대로 남아 있다.
- 1회차 자료: `docs/reviews/2026-11-27-diceforge-defects.md`(결함 15건), 봇 메모리 stage5-backlog(A~G).
- 판정: **해결됨** / **부분** / **미해결** / **미확인**. 점수는 매기지 않는다.

## 1. 자기 비용

| 항목 | 1회차(DiceForge Bot, 2026-11-27) | 2회차(이 워커, 2026-11-28) | 예산 |
|---|---|---|---|
| 압축 인벤토리(엔진 추정) | 7,361 토큰 | **6,673 토큰**(초과 경고) | 6,000 |
| 분석 1회 LLM 토큰(새 입력+캐시 쓰기+출력) | 30 + 6.5만 + 1.3만 ≈ 7.8만 | 36 + 41,947 + 16,978 = **58,961** | 120,000 |
| 그중 해석 작성~finalize | 미측정 | 10 + 16,598 + 12,223 = 28,831(요청 5회, 14:07:16~14:09:02) | — |
| 요청 수 | 15 | 18(finalize 재시도 1회 포함) | — |
| 컨텍스트 증가 | 약 4.9만 | 76,537 → 117,297, **+40,760** | — |
| 시간 | 약 2분 25초(엔진 기록 `wallClockMs` 126,000) | **3분 2초**(prepare 시작 14:06:00 ~ finalize 끝 14:09:02, 엔진 analyzedAt~checkedAt과 같음). 해석 작성 1분 42초 | — |
| 엔진 prepare | 미측정 | 3,670 ms, 최대 RSS 170 MB | 5,000 ms, 200 MB |

측정 방법: 2회차는 이 세션의 Claude Code 기록에서 위 시각 구간의 assistant 응답 usage 숫자만 메시지 ID로 중복 제거해 합했다(캐시 읽기 제외). SKILL.md·프로토콜을 처음 읽은 요청은 prepare 전이라 빠져 있다. 1회차는 실행자(봇)와 측정 경로가 달라 같은 조건의 비교가 아니다.

**2회차 `selfCost`가 잡히는가: 아니다.** `llm_tokens_per_analysis`는 `unmeasured`이고, `previousAnalysis`는 `{wallClockMs: 126000, llmTokens: null, method: "unknown"}`이다. 시간만 잡히고 토큰은 안 잡힌다. 원인은 §4 N2에 적었다.

## 2. 1회차 결함 15건

| # | 결함 | 판정 | 2회차 근거(리포트 화면·analysis.json) |
|---|---|---|---|
| 1 | exit 2·`decision: block` 차단 미탐지 | 해결됨 | Hook `blockingMarker`: 1회차는 PreCompact만 true였다. 2회차는 PreToolUse·UserPromptSubmit(`blockingMarkerVia: "import"`)과 Stop(`"script"`)이 true다. 리포트 근거 문장은 "차단 표지(문자열 패턴) 있음(import lib.mjs)"이다 |
| 2 | `diceforge-elephant`가 reviewer로 분류됨 | 해결됨 | `role`이 1회차 `reviewer`에서 2회차 `null`로 바뀌었다. 근거 fact "역할 없음, 본문 지연 로드"(CX-L2-01). VG-L2-02 근거는 `diceforge-review`에만 남았다 |
| 3 | 실행 안정성 수준 3인데 가능 범위 0~2 | 해결됨 | 실측 축은 "실측 대역 범위 2–3 (표본이 요구량의 2배 미만이라 실측 대역 ±1)"로 표기된다. ES는 Bash를 뺀 지표 표본이 72/500이라 예측 상태(범위 3–3)다 |
| 4 | 비용 실측 대역 3인데 `unconfigured` | 해결됨 | CE는 `predicted`, `blockedReason: band_metric_undefined`. 화면은 "실측 불가: 대역 지표 미정(캐시 적중률은 참고 지표)"이다. 빈 영역 `unconfigured`와 모순되지 않는다 |
| 5 | 컨텍스트 임계값이 창 크기를 안 봄 | 해결됨 | CX-M-02 `context_p90_window_ratio` 0.2325 → 대역 3. 1회차는 절대값 기준으로 대역 0이었다 |
| 6 | 도구 오류율에 Bash 섞임 | 해결됨 | `non_bash_tool_error_rate` 0(72), `bash_error_rate` 0.0468(171, 참고), `toolUsage` 8개 도구 표가 있다 |
| 7 | knowledgeBaseKeys 4개 부재인데 경고 없음 | 미해결 | `knowledgeBaseKeys`는 hooks·independent-review·skills·verification-loop인데 배포본에는 README뿐이다. 엔진 `limitations`에 해당 코드가 없다. 해석 한계에 직접 적었다(선택 개선이라 미착수) |
| 8 | 압축 인벤토리 예산 초과 | 부분 | 7,361 → 6,673으로 줄었지만 6,000을 넘는다. 모든 생략 단계(`descriptive_component_attributes`, `factLimitPerAxis: 1`, 생략 fact 24)를 적용한 뒤에도 초과했다. 원인은 N1 |
| 9 | 위치별 지표 metricId 없음 | 해결됨 | `bot_weighted_share` 0.388, `worker_weighted_share` 0.533이 axisMetrics에 있다. finding f5가 `metricRefs`로 인용했고 V-REF를 통과했다 |
| 10 | 미귀속에 다른 프로젝트 섞임 | 해결됨 | 1회차 미귀속 593(봇 36)이 2회차는 미귀속 42(봇 42)와 무관 제외 591로 나뉘었다. 리포트 귀속 줄은 "귀속 세션 147 · 미귀속(불확실) 42 · 무관한 프로젝트 제외 591"이다 |
| 11 | 구성 요소 표 "역할(해석)" 전부 "—" | 해결됨 | 해석한 요소에 역할이 표시된다(예: `.githooks/pre-commit` "커밋 전 강제 검사"). 해석하지 않은 요소만 "—"이다 |
| 12 | 투자 축이 예측 수준만 표시 | 부분 | "컨텍스트 효율 — 수준 2 명시적 구성 (구조 예측) · 실측 대역 3"처럼 실측 대역을 함께 적는다. 다만 결정 A의 제목 변경("구조상 투자한 축")은 반영되지 않았다(`engine/src/report/client.mjs:465` "투자한 축") |
| 13 | 모델별 빈칸·범례 중복·direct 표기 | 해결됨 | 접힘 제목 "모델별 (3개 모델)", 위치 막대 아래 목록 범례만, 귀속 방법 "작업 경로 일치" |
| 14 | file://에서 JS로만 그림 | 미해결(선택, 미착수) | `<main>`에는 대체 문장 하나뿐이다. 이번 확인은 로컬 서버(127.0.0.1)와 Orca 브라우저로 했다(§5). 대체 문장의 안내도 틀렸다(N6) |
| 15 | 프로토콜 `--agent`·`--out`·measured evidenceIds | 해결됨 | SKILL.md는 `--agent claude-code`와 "`--out`을 썼다면 같은 값", 엔진 v0.4.0을 적는다. 프로토콜 §2.1은 `--out`·`CLAUDE_SKILL_DIR`을, §2.3은 measured의 빈 `evidenceIds` 허용을 적는다. 이번 실행은 이 문서대로 해서 41 오류 없이 끝났다 |

## 3. 백로그 A·B·C·F·G

### A. 버그

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| A1 | Hook 공용 헬퍼 미수집 | 해결됨 | PreToolUse·UserPromptSubmit의 `paths`에 `.claude/hooks/lib.mjs`가 들어갔다. `inventory.sources`에 `guard.mjs`·`scripts/lib/harness.mjs`가 read로 있다 |
| A2 | elephant 리뷰어 오분류 | 해결됨 | 결함 #2와 같다 |
| A3 | 압축 인벤토리 예산 초과 | 부분 | 결함 #8과 같다. 6,673 > 6,000 |
| A4 | fact에 AGENTS.md 원문 인용 | 부분 | 프로토콜 §1-4가 "엔진이 비밀정보를 제거·길이 제한한 발췌"라고 규칙을 문서화했다. 리포트 근거에는 여전히 `AGENTS.md:23`·`AGENTS.md:10` 원문 한 줄이 따옴표째 보인다. 인용 상한 정책이 별도로 정해졌는지는 이 실행으로 확인하지 못했다 |
| A5 | knowledgeBaseKeys 부재 경고 | 미해결 | 결함 #7과 같다 |

### B. 측정 정의·라벨

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| B6 | '미귀속' 의미 | 해결됨 | 결함 #10. limitation 문구가 "귀속이 불확실한 세션 42개(봇 42개)"와 `unrelated_sessions_excluded` 591개로 나뉘었다 |
| B7 | 도구 오류율 Bash 포함 | 해결됨 | 결함 #6 |
| B8 | 창 크기 가정 | 해결됨 | 결함 #5 |
| B9 | 캐시 적중률로 비용 대역 3 | 해결됨 | 캐시 적중률 95.2%는 "(참고)"로만 표시되고 CE는 예측 상태다 |
| B10 | 수준과 실측 대역이 같은 척도로 보임 | 해결됨 | 레이더 경고문 "같은 눈금에 올렸지만 다른 척도"가 있고, CX 상세는 "구조 수준 2 / 실측 대역 3(다른 척도라 차이를 계산하지 않음)"이다 |
| B11 | 범위가 수준을 포함 안 함 / 비용 실측인데 unconfigured | 해결됨 | 결함 #3·#4. 새로 생긴 작은 모순은 N7 |
| B12 | '차단 표지'·'검증 명령 어휘' 오해 | 해결됨 | 축 상세 머리말이 "문자열 패턴을 찾은 결과, 실행해 확인한 것이 아님"과 "검증 판정에 쓰는 이벤트에서만 근거"를 설명한다. PostToolUseFailure 근거에는 "(이 이벤트는 검증 판정에 쓰지 않음)"이 붙는다 |
| B13 | 환산 단위·direct·분석 세션 위치 | 부분 | 환산 설명이 표 바로 위에 있고, direct는 "프로젝트 세션(엔진 값 direct)"로 정의된다. 그러나 "이번 분석 세션은 프로젝트 세션·워커 워크트리·오케스트레이터 봇 중 하나로 집계"라는 문장은 실제와 다르다(N2) |
| B14 | 실측 창 길이 | 해결됨 | "② 축별 실측 지표 … 2026-11-27T11:10:06Z 이후 (분석 시각까지 1일 2시간, 세션 28개)"와 "축 실측 창이 짧아 실측 대역이 흔들릴 수 있습니다"가 표시된다 |

### C. 분석 프로토콜

| # | 항목 | 판정 | 근거 |
|---|---|---|---|
| C15 | `--agent` 값 | 해결됨 | SKILL.md·프로토콜 모두 `claude-code` |
| C16 | `--out` | 해결됨 | 프로토콜 §2.1-2·§2.4 |
| C17 | `CLAUDE_SKILL_DIR` 없을 때 | 해결됨 | 프로토콜 §2.1-1. 이번 실행은 이 규칙대로 읽은 SKILL.md 기준 경로를 썼다 |
| C18 | 스키마 읽기 허용, measured 빈 evidenceIds | 부분 | 빈 evidenceIds 허용은 명시됐다. 스키마 파일을 읽어도 되는지는 여전히 적혀 있지 않다. 그래서 이번에 finding `direction` 열거값을 몰라 첫 finalize가 V-SCHEMA로 실패했다(N11) |
| C19 | 압축 인벤토리 나눠 읽기 | 해결됨 | §2.2에 순서·120줄 단위·재출력 금지가 있다. 이번 실행은 통째로 출력하지 않고 키별로 한 번씩 읽었다 |

### F. 리포트 화면(1회차 Orca 브라우저 확인 항목)

| 항목 | 판정 | 근거 |
|---|---|---|
| 요약 첫 화면 '귀속 불확실 593개' | 해결됨 | 첫 화면(스크린샷 1)에는 메타·근거 성숙도·해석 요약만 있다 |
| 실측 불가 'CI·PR 데이터 필요(MVP 3)' | 해결됨 | "실측 불가: CI·PR 실행 결과 필요(설정 수집과 별개)" |
| 원시 사유 코드 노출 | 해결됨 | 모든 범위 사유가 문장이다(예: "처리 속도는 수준 3을 예약해 두어 최대 2") |
| 레이더 실측 실선 막대 | 해결됨 | 실측 대역은 채운 점이고, 이웃이 실측일 때만 실선이다. CX 한 축만 점으로 표시된다(스크린샷 2). 이전 스냅샷 겹침 문제는 N5 |
| 서브에이전트 칸 라벨 없음 | 해결됨 | 막대 아래 목록에 "서브에이전트 7.9%" |
| 컨텍스트 추이 점 2개 | 해결됨 | "일별 추이는 2일치뿐이라 그래프 대신 값을 적습니다"와 날짜별 요청 수·중앙값·최대 |
| 귀속과 실측 창이 섞인 문구 | 해결됨 | ①(스캔 범위)와 ②(축 실측 창)가 분리됐다. 두 p90(222,755와 232,464)의 차이도 설명된다 |
| 득실 2개뿐(Hook 10개 중) | 해결됨 | 2회차 득실은 5개(Stop, PreToolUse, PostToolUse, UserPromptSubmit, diceforge-review)이고, 나머지 13개 후보의 ID와 생략 사유가 리포트 "한계와 미확인 영역"에 표시된다. 개수는 품질 지표가 아니다 |
| 다크 모드·모바일 폭 | 미확인 | 이번 확인은 1280px 라이트만 했다 |

### G. DiceForge Bot 화면 비평

| 항목 | 판정 | 근거 |
|---|---|---|
| '역할(해석)' 빈칸 | 해결됨 | 결함 #11 |
| 투자와 포기가 예측만 | 부분 | 결함 #12. 실측 병기는 됐고 제목은 그대로다 |
| 비용 실측선 과도 강조 | 해결됨 | CE가 실측이 아니어서 레이더에 실측 표시가 없다 |
| '직접' vs '프로젝트 세션' | 해결됨 | "프로젝트 세션 … (엔진 값 direct)", 귀속 방법 "작업 경로 일치" |
| 막대 라벨·범례 중복 | 해결됨 | 막대 안 라벨이 없다 |
| 모델별 접힘 | 해결됨 | 접힘 제목에 "(3개 모델)" |

## 4. 새로 발견한 문제

코드는 고치지 않았다. 줄 번호는 `929c335` 기준이다.

| ID | 분류 | 문제 | 위치 | 근거 |
|---|---|---|---|---|
| N1 | 버그 | 압축 인벤토리가 모든 생략 단계 뒤에도 6,000을 넘는다. `comparison`(변경 15건마다 name·paths 반복, 직렬화 약 4.7k자)과 `sessions`(약 4.6k자)는 압축 대상이 아니고, 마지막 단계는 예산 확인 없이 반환한다 | `engine/src/cli.mjs:250-318`(특히 `:312-318`) | `compaction.omitted`에 7개 단계가 모두 있는데 6,673 토큰이다 |
| N2 | 버그 | 직전 분석 토큰(`llm_tokens_per_analysis`)이 잡히지 않는다. 분석 구간 토큰을 `direct`·`worker` 위치에서만 센다. 1회차는 DiceForge Bot(위치 `bot`)이 실행해서 빠졌다. 대상 밖 작업 경로에서 실행한 분석(이번 2회차, harness-lens 워크트리)은 무관 세션으로 제외되므로 3회차에서도 잡히지 않는다. 리포트 설명 문장도 봇 위치가 집계된다고 말해 실제와 다르다 | `engine/src/session-metrics.mjs:409`, `engine/src/report/client.mjs:354` | `previousAnalysis.llmTokens: null`, `method: "unknown"` |
| N3 | 버그 | 엔진 버전이 바뀐 비교에서 거짓 변경이 나온다. 새로 수집하기 시작한 종류(CI·Git Hook)가 `added`로, 스크립트가 바뀌지 않은 Hook 7개가 `modified`로 보고된다. 1회차 이후 대상 저장소의 하네스 변경은 `pre-compact.mjs` 삭제, `session-start.mjs`, `settings.json` 3개 파일뿐이다(`git diff 92ce585..HEAD`). CI·pre-commit은 2026-11-26에 이미 있었다. Hook 해시 입력이 엔진 버전마다 다르고(import 해시 추가 등), diff가 수집기 변경을 `unknown`으로 처리하지 않는다 | `engine/src/diff.mjs:47-53`, `engine/src/collect.mjs:520` | 리포트 "변경 내역" + 3, − 1, ~ 11 |
| N4 | 버그(표시) | 처리 속도가 "실측까지: 세션 28 / 20회 · 100%"로 표시된다. 실제로는 `blockedReason: metric_unavailable`(대역 지표 없음)이라 표본이 충분해도 실측이 되지 않는데, 이유가 화면에 없다 | `engine/src/report/client.mjs:282-283` | 스크린샷 2 처리 속도 줄 |
| N5 | 버그(표시) | 루브릭이 달라 모든 축이 `comparable: false`인데도 레이더에 이전 스냅샷 구조 수준 선을 그린다. 판정 기준이 다른 값이 같은 눈금에 겹친다 | `engine/src/report/client.mjs:88, 226-227` | `showPrev`는 `comparability !== 'none'`만 본다. 이번 값은 `limited`다 |
| N6 | 버그(문구) | JS가 꺼졌을 때의 대체 문장이 "원본 데이터는 같은 폴더의 analysis.json"이라고 안내하지만, 결과 루트의 `report.html` 옆에는 analysis.json이 없다(`snapshots/<id>/` 안에만 있다) | `engine/src/render.mjs:33` | 결과 루트 목록: config.json, latest.json, report.html, runs, sessions, snapshots |
| N7 | 버그(표시) | 범위가 이미 최대(3–3)인 축에도 "실제 수준이 더 높을 수 있음" 사유를 붙인다 | `engine/src/rubric.mjs:100`, 문구 `engine/src/report/client.mjs:43` | SC·VG·ES "가능 범위 3–3 (… 더 높을 수 있음)" |
| N8 | 확인 필요 | 구성 이후 28세션의 `session_duration_p50_ms`가 1,416(1.4초)이고, 사람 입력 중앙 1회, 입력 사이 도구 호출 중앙 0이다. 매우 짧거나 빈 세션이 표본 대부분일 수 있다. 처리 속도·자율성 표본 요구량을 채운 것처럼 보이는 근거가 이 세션들이다 | `engine/src/session-metrics.mjs:344-350` | axisMetrics |
| N9 | 문서 | 프로토콜에 finding `direction` 열거값이 없다. "positive"를 썼다가 V-SCHEMA로 거부됐다(재시도 1회로 통과). 스키마 파일을 읽어도 되는지가 불명확한 C18과 같은 뿌리다 | `skills/harness-analyze/references/analysis-protocol.md:104-109` | 첫 finalize 종료 코드 30 |
| N10 | 설계 | 보호 경로·위험 git 명령을 막는 PreToolUse 차단이 §1.5 우선순위로 SC에 귀속되어, 안전 경계는 서술 근거만으로 수준 1에 머문다. 해석 f3에 inferred로 남겼다 | `skills/harness-analyze/references/evaluation-rubric.md:315`(SB-L2-02 단서) | 루브릭대로 동작한다. 오너 판단 사항 |
| N11 | 표시 | 해석 한계에 적은 생략 후보가 `c_…` ID 그대로 리포트에 노출돼 사람이 읽기 어렵다. 프로토콜이 ID 기록을 요구해서 생긴 결과다 | 리포트 "한계와 미확인 영역" | — |
| N12 | 데이터 | 세션 파서 버전이 바뀌어 누적 상태를 다시 만들었다(`session_state_reset`). 컨텍스트 분포는 여전히 2026-11-26~27(요청 1,535)뿐이다. #21·#22 조사대로 귀속 메인 스레드 관측일 기준이라 결함은 아니다 | — | `contextPerTurn.distribution` |

## 5. 리포트 화면 확인

- 방법: `report.html`을 스크래치 디렉터리에 복사하고 `python3 -m http.server --bind 127.0.0.1`로 띄웠다. Orca 내장 브라우저 탭(1280×900, 라이트)으로 열었다. 콘솔 항목은 0개다.
- 스크린샷 2장: 스크린샷 1(메타·근거 성숙도·요약)과 스크린샷 2(레이더·축 목록). 로컬에 보관하고 저장소에는 넣지 않았다.
- 화면 텍스트(`exec read`)로 §2~§4의 문구를 확인했다.

## 6. 남은 일

- N1~N7은 코드 수정 후보, N8은 원인 조사 후보다. N9는 프로토콜 보강, N10은 오너 판단 사항이다.
- 결함 #7·#14와 다크 모드·모바일 폭 확인은 이번에도 미착수·미확인이다.
- N2가 고쳐지기 전에는 `selfCost`로 분석 1회 토큰 예산을 자동 확인할 수 없다. 당분간 이 문서처럼 실행자 기록으로 따로 잰다.
