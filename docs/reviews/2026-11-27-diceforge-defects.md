# DiceForge 실사용 결함 15건 검토 (2026-11-27)

- 대상 버전: 엔진 0.3.0, 스키마 0.1, 루브릭 0.2
- 재현 자료: DiceForge 스냅샷 `20261127T102221Z-0ae31e0e`(analysis.json, report.html). 같은 하네스를 현재 `main` 엔진으로 `prepare --out <임시 디렉터리>`로 다시 돌려 확인했다(대상 저장소에는 쓰지 않음, `git status` 깨끗).
- 분류: **버그**(명세·PRD와 어긋난 구현) / **설계 결정 필요**(명세·루브릭대로 동작하지만 명세를 바꿔야 함) / **정상**(의도대로 동작, 오해)
- 줄 번호는 이 문서를 추가한 시점의 `main` 기준이다.

## 분류표

| # | 결함 | 분류 | 근거 | 조치 |
|---|---|---|---|---|
| 1 | exit 2·`decision: block` 차단 미탐지 | 설계 결정 필요 (루브릭 0.3) | LEX-BLOCK이 문자열 `exit 2`, `"decision": "block"`(따옴표 키)만 본다(`engine/src/lexicon.mjs:25`, `evaluation-rubric.md:100`). 스캔 대상은 Hook 명령+스크립트 본문뿐이고 import를 따라가지 않는다(`engine/src/collect.mjs:390-391`). DiceForge는 `lib.mjs:146-148`의 `process.exit(2)`를 import해 쓰고, `stop.mjs:113`은 JS 객체 `emit({ decision: "block" ... })`(따옴표 없는 키)라 둘 다 어휘에 안 걸린다. 엔진은 루브릭대로 동작한다 | 어휘·스캔 범위 변경은 rubricVersion 상승 사항(`evaluation-rubric.md:327`). 오너 결정 |
| 2 | Skill `diceforge-elephant`가 reviewer로 분류 | 설계 결정 필요 (루브릭 0.3) | LEX-ROLE은 `name`+`description` 부분 문자열 일치이고 부정문을 구분하지 않는다(`lexicon.mjs:15-21, 45-49`). 설명의 "독립 리뷰어는 쓰지 않는다"의 `리뷰`가 걸려 VG-L2-02 근거가 됐다(`collect.mjs:582, 590`) | 오너 결정 |
| 3 | 실행 안정성 수준 3인데 가능 범위 0~2 | 정상 (표시 개선 여지) | 실측 상태의 범위는 수준이 아니라 `measured.band` ± 1이다(`evaluation-rubric.md:116-119`, `engine/src/rubric.mjs:165`). `level`은 구조 예측(3), band는 1이라 범위 0~2가 맞다 | 표시 개선은 #12와 함께 결정 |
| 4 | 비용 효율 실측 대역 3인데 빈 영역 `unconfigured` | 설계 결정 필요 | 빈 영역은 구조 수준 0이면 `unconfigured`(`engine/src/cli.mjs:237-239`, 프로토콜 emptyAreas 행). 실측 여부를 보지 않는다. 또 CE-M-01이 `cache_hit_ratio`를 쓰는데(`evaluation-rubric.md:145`) 캐시 적중은 클라이언트 동작 영향이 커서 하네스 축 실측으로 약하다 | 오너 결정 |
| 5 | 컨텍스트 대역 임계값이 모델 창 크기를 안 봄 | 설계 결정 필요 (루브릭 0.3) | CX-M-01은 절대 토큰(50k/100k/150k)만 본다(`evaluation-rubric.md:146`, `engine/src/session-metrics.mjs:129-135`). 창 크기·모델 구분 없음. 재실행에서 p90 214,087(1M 창 모델로 보임) → 대역 0 | 오너 결정 |
| 6 | 도구 오류율에 정상적인 Bash 비정상 종료가 섞임 | 설계 결정 필요 (루브릭 0.3) | `tool_result.is_error == true`를 도구·원인 구분 없이 센다(`engine/src/sessions.mjs:697-698`, 지표 정의 `evaluation-rubric.md` §1.9). Bash 0이 아닌 종료, PreToolUse Hook 차단, 사용자 권한 거절도 `is_error`로 기록되므로 차단 Hook이 강할수록 ES 대역이 낮아지는 역방향 상호작용이 있다 | 오너 결정 |
| 7 | knowledgeBaseKeys 4개 파일이 모두 없는데 경고 없음 | 정상 (개선 제안) | 키는 구성 요소·규칙에서 만든다(`docs/spec/engine-cli.md` §4.4.1, `engine/src/rubric.mjs:227`). 지식 베이스는 pre-alpha라 비어 있다고 명시돼 있고(`references/knowledge-base/README.md`), 프로토콜은 "없는 항목은 건너뛴다"(§2.2) | 선택: 엔진이 배포본의 파일 존재를 확인해 `limitations`에 알림 |
| 8 | 압축 인벤토리 7,361토큰 > 예산 6,000 | 버그 (수정 방식은 설계 결정 필요) | 현재 엔진으로 재현(경고 `llm_input_inventory_tokens (7361 > 6000)`). PRD §11.1 예산 초과. 압축은 `sources`의 absent·시계열·byModel만 뺀다(`engine/src/cli.mjs:209-224`). 무손실 제거(구성 요소 `contentHash` 약 350토큰)만으로는 7,009, null·빈 필드까지 빼도 6,313, Hook `command`까지 빼도 6,131로 여전히 초과. 6,000 이하는 정보 손실 선택이 필요 | 오너 결정(압축 규칙) |
| 9 | 위치별 지표에 맞는 metricId가 없어 measured finding 인용 불가 | 설계 결정 필요 | 프로토콜은 봇 비중이 크면 조율 비용임을 밝히라 하지만(§2.2) `byLocation` 비중은 `axisMetrics`에 없다. measured finding은 `axisMetrics`의 `metricId`만 인용할 수 있다(V-REF 검사) | 오너 결정 |
| 10 | 귀속분이 미귀속의 6%라 위치별 비중 대표성이 낮음 | 설계 결정 필요 (전제 정정) | "미귀속"에 **다른 프로젝트 세션 전체**가 들어 있다. 귀속 판정에서 `cwd`가 대상과 무관한 세션(`kind: none`)도 `location: null`이 되어(`engine/src/sessions.mjs:593-597`, `engine/src/session-metrics.mjs:39-50, 155`) 미귀속으로 집계된다. DiceForge 재실행: 미귀속 메인 세션 596개 중 559개가 무관한 프로젝트, 37개만 매핑 없는 봇(실제로 불확실). PRD §6.1은 "귀속이 불확실하면 미귀속"인데 엔진 명세 §8.3 5행은 "그 외 전부"라 명세끼리 어긋난다. 리포트·`limitations`는 이를 "귀속이 불확실한 세션"이라 표시한다(`engine/src/cli.mjs:141`) | 오너 결정(명세 정정). 정정되면 6% 대표성 경고는 대부분 불필요 |
| 11 | 구성 요소 표 "역할(해석)" 칸이 전부 "—" | **버그** | `engine/src/report/client.mjs:487-489`가 엔진 구성 요소를 `c.componentId`로 찾지만 엔진 필드는 `id` | PR #9에서 수정 |
| 12 | "투자한 축"이 예측 수준만 표시, 레이더 오해 | 일부 버그 + 설계 결정 | 투자 목록이 실측 축도 `levelText`(구조 수준)만 표시해 상태를 글로 구분하지 않는다(`client.mjs:390-391`, PRD §8.1 위반). 투자 판정 기준(구조 수준 ≥ 2, 프로토콜 investForgo 행)과 레이더에 실측 대역을 같은 축에 올리는 방식(`evaluation-rubric.md:124-128` "소유자 결정 사항", `client.mjs:171`)은 명세대로다 | 표시는 PR #9에서 수정. 판정 기준·레이더는 오너 결정 |
| 13 | 모델별 칸 비어 있음, 범례 중복, direct 표기 | 정상 | 모델별은 접힌 `<details>`(`client.mjs:319-321`)에 있고 DiceForge 데이터로 3개 모델 행이 그려진다. 막대 안 라벨과 아래 범례 중복은 색만으로 구분하지 않으려는 의도(`client.mjs:270-287` 주석). `direct` → "프로젝트 세션"은 PRD §6.1 "`direct`(프로젝트 세션)"과 같다 | 선택: 막대 안 라벨 생략 |
| 14 | file://에서 JS로 그려 자동화 도구가 못 엶 | 정상 (선택 개선) | PRD §8.2는 "외부 CDN·서버 없이 작동하는 독립 HTML/CSS/JS"를 요구하고 리포트는 인라인 스크립트+CSP 해시로 file://에서 동작한다(`engine/src/render.mjs:17-36`). 못 여는 것은 자동화 도구의 file:// 제약이다 | 선택: 정적 요약 폴백 |
| 15 | 프로토콜 `--agent`·`--out`·measured evidenceIds·fact 원문 | **버그(문서)** | `SKILL.md:14`는 `--agent <에이전트>`, 프로토콜은 `claude-code`. `--out`을 prepare에만 쓰면 finalize가 41로 실패. measured의 evidenceIds는 스키마상 빈 배열 허용인데 미기재. fact 발췌는 엔진이 비밀정보를 제거한 값이라 규칙 4와 충돌하지 않지만 문서가 모호. SKILL.md 상태 줄이 "엔진 v0.1.0, 세션 집계 없음"으로 낡음 | PR #10에서 수정 |

## 오너 결정이 필요한 항목

각 항목의 첫 선택지가 추천이다.

### 루브릭 0.3으로 묶을 후보 (#1, #2, #5, #6)

- #1 차단 표지
  - A(추천): LEX-BLOCK에 언어별 종료 관례(`process.exit(2)`, `sys.exit(2)`, `os.Exit(2)`)와 따옴표 없는 키(`decision: "block"`, `permissionDecision: "deny"`)를 더하고, Hook 스크립트가 같은 출처 루트 안에서 상대 경로로 import·source하는 파일을 1단계까지 함께 스캔한다(256KB 한도, 실행 없음).
  - B: 어휘만 넓히고 import는 따라가지 않는다. DiceForge의 PreToolUse·UserPromptSubmit은 계속 미탐지된다.
  - C: 그대로 두고 `limitations`에 "공용 헬퍼 차단은 감지하지 못할 수 있음"을 알린다.
- #2 역할 분류
  - A(추천): `name`을 먼저 보고, `description`은 부정 표현(`않는다`, `쓰지 않`, `not `, `don't`) 뒤의 일치를 무시한다.
  - B: `name`만 본다(오탐은 줄지만 이름이 일반적인 Skill은 놓친다).
  - C: 그대로 두고 LLM이 finding(`inferred`)으로 반박하게 둔다(현재 프로토콜 §1 규칙 6).
- #5 컨텍스트 임계값
  - A(추천): `context_p90_tokens ÷ 모델 창 크기` 비율로 대역을 정한다(창 크기는 가격표처럼 모델별 표로 둔다. 모르는 모델은 실측 보류).
  - B: 절대값을 유지하되 1M 창 모델은 별도 임계값.
  - C: 그대로 두고 리포트에 "창 크기 미보정"을 표기.
- #6 도구 오류율
  - A(추천): 도구 이름(메타데이터)별로 나눠 집계하고, ES 대역에는 Bash를 빼거나 별도 지표로 둔다. Hook 차단·사용자 거절은 원문 없이 구분할 수 있는 기록 형식이 확인될 때까지 참고 지표로만 둔다.
  - B: 정의는 유지하고 리포트에 "Bash 비정상 종료·Hook 차단 포함"을 표기.

### 판정·표시 규칙 (#3, #4, #12)

- #4 빈 영역과 CE 실측
  - A(추천): 실측 상태 축은 구조 수준이 0이어도 `unconfigured`에서 빼고(실측이 있으므로), CE-M-01은 `cache_hit_ratio`를 참고 지표로 내리고 대역 지표가 정해질 때까지 CE를 예측으로 유지한다.
  - B: 빈 영역 규칙만 바꾼다.
  - C: 그대로 둔다.
- #12 투자 판정·레이더
  - A(추천): 투자·포기는 지금처럼 구조 수준 기준으로 두되 리포트 제목을 "구조상 투자한 축"으로 바꾸고(이번 PR #9로 실측 대역 병기는 반영), 레이더는 실측 대역을 실선, 구조 수준을 흐린 점선으로 그리는 현 방식 유지.
  - B: 실측 축은 실측 대역으로 투자·포기를 판정한다(프로토콜·V-* 검사 변경).
  - C: 실측을 레이더에서 빼고 별도 패널로 보인다(`evaluation-rubric.md:128`의 대안).
- #3은 #12 A를 택하면 데이터 표 "수준" 칸을 "구조 수준"으로 바꾸는 것으로 충분하다.

### 세션 집계 (#9, #10)

- #10 미귀속 범위
  - A(추천): 엔진 명세 §8.3 5행을 "매핑 없는 봇 세션 등 실제로 불확실한 것"으로 좁히고, 무관한 프로젝트 세션은 합계·미귀속 어디에도 넣지 않는다(다른 프로젝트 사용량을 이 프로젝트 리포트에 싣지 않는 효과도 있다). `unattributed` 스키마 형태는 그대로.
  - B: 무관한 프로젝트를 `otherProjects`(개수만)로 따로 보고(스키마 변경).
  - C: 그대로 두고 리포트 문구만 "귀속되지 않은 세션(다른 프로젝트 포함)"으로 바꾼다.
- #9 위치별 지표
  - A(추천): `axisMetrics`에 CE 참고 지표 `bot_weighted_share`, `worker_weighted_share`(대역 없음)를 더해 measured finding이 인용할 수 있게 한다.
  - B: `metricRefs`가 `tokens.byLocation[].location`을 가리킬 수 있게 스키마를 넓힌다.

### 예산 (#8)

- A(추천): 압축 인벤토리에서 구성 요소 `contentHash`를 빼고, 근거의 null·빈 배열 기본값 필드(`void`, `levelCap`, `secondaryAxes`, `line`, `keyPath`)를 생략 규칙으로 문서화한 뒤 빼고, 그래도 넘으면 근거 `fact`를 축별 상위 N개로 자르고 나머지는 ID·경로만 남긴다. DiceForge 기준 앞 두 단계로 약 6,300토큰이라 세 번째 단계가 필요하다.
- B: 예산을 실측(근거 30개 규모 하네스)에 맞춰 올린다(PRD §11.1 변경이라 PRD 개정 필요).

### 선택 개선 (#7, #13, #14)

- #7: 엔진이 `references/knowledge-base/<key>.md` 존재를 확인해 없는 키를 `limitations`에 알린다(추천, 작음).
- #13: 막대 안 라벨을 빼고 범례만 남긴다(취향, 낮음).
- #14: `<main>` 안에 정적 요약(축 표·한계)을 서버에서 미리 그려 넣고 스크립트가 대체한다. 결정론 산출물이 커지므로 필요성 확인 후(낮음).

## PRD 제안 (수정하지 않음)

- §6.1 귀속 규칙의 "미귀속"이 "불확실한 것만"임을 명확히 하고, 무관한 프로젝트 세션은 집계하지 않는다는 문장 추가(#10). 오너 결정(A)으로 엔진 명세 §8.3은 고쳤고 PRD는 고치지 않았다. 개정 문안 제안:
  - 현행: "귀속이 불확실하면 "미귀속"으로 따로 표시하고 합계에 섞지 않는다."
  - 제안: "귀속이 불확실하면(작업 경로 기록이 없거나, 매핑·경로 언급이 없는 봇 세션) "미귀속"으로 따로 표시하고 합계에 섞지 않는다. 작업 경로가 분석 대상과 무관한 것이 확실한 세션(다른 프로젝트, 다른 저장소에 매핑된 봇)은 합계·미귀속 어디에도 집계하지 않고 제외한 세션 수만 보고한다."
  - 이유: 다른 프로젝트의 사용량을 이 프로젝트 리포트에 싣지 않고(Local First 범위 최소화), 미귀속 비율이 실제 불확실성을 나타내게 한다. DiceForge 재실행 기준 미귀속 596개 중 559개가 다른 프로젝트였다.
- §11.1 압축 인벤토리 예산이 근거 수에 비례해 커지는 점을 고려해 "근거 N개 기준" 같은 조건을 둘지 검토(#8).

## 반영 현황

오너 결정(2026-11-27)을 반영한 PR. 병합 순서는 위에서 아래로다(스택).

| # | 결정 | PR |
|---|---|---|
| 10 | A: 무관한 프로젝트 세션 제외, 엔진 명세 §8.3을 "불확실한 것만 미귀속"으로. `coverage.sessionsExcluded`·`unrelated_sessions_excluded`로 제외 수 표시. PRD는 위 "PRD 제안"에 개정 문안만 | #12 |
| 1 | A: LEX-BLOCK 종료 관례·따옴표 없는 키, 상대 import·source 1단계 스캔(이름 import는 표지가 든 export를 호출할 때만) | #15 |
| 2 | A: `name` 우선, `description`은 부정 절(LEX-NEG) 제외 | #15 |
| 4 | A: 실측 상태 축은 빈 영역에서 제외, CE-M-01 폐기(`cache_hit_ratio` 참고 지표, CE 실측 불가 `band_metric_undefined`) | #15 |
| 5 | A: CX-M-02 `context_p90_window_ratio`(모델 창 크기 표, 모르는 모델은 보류) | #15 |
| 6 | A: `sessions.toolUsage` 도구별 집계, ES-M-02 Bash 제외 오류율, `bash_error_rate` 참고 지표 | #15 |
| 9 | A: `bot_weighted_share`·`worker_weighted_share` CE 참고 지표 | #15 |
| 8 | A: 압축 인벤토리 `contentHash`·null 기본값 필드 제거, 근거 `fact` 축별 상위 N개 | #14 |
