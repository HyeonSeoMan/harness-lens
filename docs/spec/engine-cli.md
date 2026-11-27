# 엔진 CLI 명세 v0.1

- 대상: MVP 1 결정론적 엔진 `skills/harness-analyze/scripts/harness-lens.mjs`(소스 `engine/`)
- 관련: PRD v0.3 §5, FR-02~FR-11, §6.1, §9, §11, §11.1, §14.1 / `docs/research/01~03`
- 데이터 계약: `skills/harness-analyze/schemas/analysis.schema.json` (schemaVersion `0.1`)
- 수준 규칙: `skills/harness-analyze/references/evaluation-rubric.md` (rubricVersion `0.3`)
- LLM 절차: `skills/harness-analyze/references/analysis-protocol.md`

## 1. 원칙

| 원칙 | 엔진의 약속 |
|---|---|
| 런타임 | Node.js 20 이상. 런타임 의존성 없는 단일 ESM 번들이다. 진입부는 구버전 Node에서도 파싱되는 문법으로 버전만 확인한 뒤 본체를 동적 `import()`한다 |
| 읽기 전용 | 분석 대상 파일을 쓰지 않는다. 쓰기는 결과 디렉터리(`<project>/.harness-lens/`)에만 한다 |
| 실행 없음 | Hook, MCP 서버, 스크립트, `git`을 실행하지 않는다. 자식 프로세스는 `render --open`의 OS 기본 브라우저 열기 하나뿐이다 |
| 네트워크 없음 | 어떤 서브커맨드도 네트워크에 접속하지 않는다. 텔레메트리가 없다 |
| 원문 최소화 | 세션 기록은 허용 목록 필드의 숫자만 집계한다. 설정은 구조 사실과 짧은 발췌(비밀정보 제거 후)만 남긴다 |
| 결정론 | 같은 입력이면 엔진 산출물이 바이트 단위로 같다(§10) |
| 안전한 실패 | 실패해도 하네스와 기존 정상 스냅샷을 훼손하지 않는다(§11) |

## 2. 호출 형식

```sh
node <skill-dir>/scripts/harness-lens.mjs <subcommand> [options]
```

공통 옵션:

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `--project <path>` | 현재 디렉터리에서 위로 올라가며 처음 만나는 `.git`(디렉터리 또는 파일)이 있는 곳 | 수집 루트. 워크트리면 그 워크트리를 수집한다. 세션 귀속용 메인 저장소 경로 `R`은 `.git` 파일의 `gitdir`로 따로 구한다 |
| `--out <path>` | `<project>/.harness-lens` | 결과 디렉터리. 프로젝트 밖으로 지정할 수 있다 |
| `--scope project\|project_and_user` | `project` | `project_and_user`면 사용자·관리형 설정을 함께 수집한다 |
| `--config-dir <path>` | `$CLAUDE_CONFIG_DIR` 또는 `~/.claude` | Claude Code 설정·세션 기록 위치 |
| `--json` | 끔 | stdout에 결과 JSON 객체 하나만 쓴다. 사람용 메시지와 진행 표시는 항상 stderr로 보낸다 |
| `--now <ISO 8601>` | 현재 시각 | 테스트용 시각 고정. 결정론 검사에 쓴다 |
| `--strict-budget` | 끔 | 성능 예산을 넘으면 종료 코드 60으로 실패한다(테스트용) |
| `--quiet` | 끔 | stderr 진행 표시를 끈다 |

## 3. 종료 코드

| 코드 | 의미 | 기존 결과 |
|---|---|---|
| 0 | 성공 | — |
| 1 | 내부 오류(버그). stderr에 스택 대신 한 줄 메시지와 `runs/<runId>/error.json` 경로 | 보존 |
| 2 | 사용법 오류(알 수 없는 옵션, 필수 인자 없음) | 보존 |
| 10 | 런타임 미지원(Node < 20, 지원하지 않는 플랫폼). stdout(`--json`) 또는 stderr에 설치 안내 한 줄 | 보존 |
| 11 | 결과 디렉터리 잠김(다른 분석 진행 중) 또는 쓰기 불가 | 보존 |
| 12 | 프로젝트 루트를 찾을 수 없거나 읽을 수 없음 | 보존 |
| 30 | 검증 실패(스키마 또는 V-* 의미 검사). 스냅샷을 만들지 않는다 | 보존 |
| 31 | 버전·무결성 불일치(스키마·루브릭·엔진 버전이 run과 다름, 엔진 영역이 바뀜) | 보존 |
| 40 | 스냅샷 쓰기 실패. 스테이징을 지우고 이전 상태로 둔다 | 보존 |
| 41 | 지정한 스냅샷·run이 없음 | 보존 |
| 50 | 렌더링 실패. 스냅샷은 저장됐다 | 보존 |
| 60 | 성능 예산 초과(`--strict-budget`일 때만) | 보존 |

수집 중 일부 파일을 읽지 못하거나 세션 기록이 없어도 실패가 아니다. 각각 `inventory.sources[].status`와 `sessions.status`로 보고한다(FR-02, FR-10).

## 4. 서브커맨드

LLM 절차는 `prepare`와 `finalize` 두 번만 호출한다. 나머지는 이 둘을 이루는 단계이며 개별 실행과 테스트를 위해 공개한다.

```text
prepare  = check-runtime → collect → aggregate-sessions → diff(직전 스냅샷) → 성숙도 계산 → 압축 인벤토리
(LLM이 interpretation.json 작성)
finalize = validate → snapshot → render
```

### 4.1 `check-runtime`

- 목적: 실행 조건을 확인한다(PRD §5 2단계).
- 검사
  - Node ≥ 20.0.0
  - `process.platform` ∈ {darwin, linux, win32}
  - `--out` 디렉터리를 만들거나 쓸 수 있는가
- 출력(`--json`): `{ "ok": true, "node": "v22.22.1", "platform": "darwin" }`
- 실패 시 출력
  - `{ "ok": false, "code": "node_too_old", "message": "Harness Lens 엔진에는 Node.js 20 이상이 필요합니다. https://nodejs.org 에서 설치한 뒤 다시 요청하세요." }`
  - 종료 코드 10. 메시지는 한 줄이다.
- 부작용: 없음. 디렉터리 쓰기 가능 여부는 만들지 않고 상위 디렉터리 권한으로 판단한다.

### 4.2 `collect`

- 목적: 읽기 전용 구성 수집과 구조 판정(FR-02, FR-03 데이터, FR-05 해시).
- 입력: 프로젝트 루트, `--scope`. 수집 대상은 §6.
- 처리
  1. 출처를 찾고 읽는다.
  2. 비밀정보를 제거한다(§7).
  3. 구성 요소를 식별한다. Harness Lens 자신은 `kind: "harness_lens"`다.
  4. 근거를 추출하고 루브릭 규칙으로 축을 귀속한다.
  5. 수준·범위를 계산하고 긴장 후보를 찾는다.
  6. 구성 해시를 계산한다.
- 출력: `runs/<runId>/inventory.json`. 스키마의 `engine` 중 `inventory`, `evidence`, `axes`(성숙도 제외), `tensionCandidates`, `limitations`와 `meta` 초안을 담는다. `--json`이면 `{ "ok", "runId", "configurationHash", "components", "evidence", "unreadable" }` 요약을 낸다.
- 구성 해시: 수집한 파일마다 (정규화한 상대 경로, 내용 sha256)를 만든다.
  - 내용은 CRLF → LF, UTF-8 BOM 제거로 정규화한다.
  - 이 쌍을 경로 사전순으로 이어 붙여 sha256을 계산한다(`sha256:<hex>`).
  - `.harness-lens/`와 `skipped_sensitive` 파일은 넣지 않는다.
  - 읽지 못한 출처는 `(경로, "unreadable")`로 넣는다.

### 4.3 `aggregate-sessions`

- 목적: 세션 기록 실측 집계(FR-10, PRD §6.1). 원문을 저장하지 않고 LLM에 넘기지 않는다.
- 입력: `--config-dir`의 `projects/` 아래 `*.jsonl`, `.harness-lens/sessions/` 커서와 누적 집계, `.harness-lens/config.json`(선택).
- 옵션
  - `--no-sessions`: 건너뛴다. `status: "disabled"`가 된다.
  - `--full-rescan`: 커서를 무시하고 처음부터 다시 읽는다.
- 출력
  - `prepare` 안에서: `runs/<runId>/sessions.json`(스키마 `engine.sessions`)과 새 누적 상태 `runs/<runId>/sessions.staging/`. 확정(`sessions/` 교체)은 `snapshot` 성공 뒤에만 한다(§8.4, FR-09).
  - 단독 실행: 확정된 누적 상태에 새 바이트를 더한 결과를 stdout에 낼 뿐 아무것도 쓰지 않는다. `--json`이면 `{ "ok", "status", "reason", "sessions" }`이다.
- `.harness-lens/config.json`의 `sessions.enabled: false`도 `--no-sessions`와 같다.
- 상태
  - `available`: 정상
  - `partial`: 건너뛴 줄 비율 > 5% 또는 미지원 버전 구간이 있음
  - `unavailable`: 기록 없음, 읽기 불가, 필수 4필드가 하나도 없음
  - `disabled`: `--no-sessions`
- `unavailable`·`disabled`면 모든 축이 예측으로 남는다. `reason`을 적는다.
  - `no_session_logs`: 기록도 누적 집계도 없다
  - `session_format_unsupported`: 줄은 있지만 필수 4필드를 가진 응답이 하나도 없다
  - `session_aggregation_failed`: 예상 밖 오류. 분석은 멈추지 않는다
  - `available`이어도 귀속된 세션이 없으면 `reason: "no_attributed_sessions"`다
  - `partial`의 사유는 `session_lines_skipped`다
- 세부 규칙은 §8.

### 4.4 `prepare` (LLM이 호출)

- 목적: LLM 해석 전에 필요한 엔진 값을 모두 만든다.
- 처리
  1. `check-runtime`, `collect`, `aggregate-sessions`를 차례로 실행한다.
  2. 직전 호환 스냅샷이 있으면 `diff`로 `comparison`을 만든다.
  3. 축마다 `maturity`·`measured`·실측 범위를 계산한다(루브릭 §1.8~1.9).
  4. 자기 비용(`selfCost`)을 계산한다.
- 출력 파일(`runs/<runId>/`)
  - `draft.json`: `meta`와 `engine` 전체. 이 파일의 정규화 sha256을 `run.json`에 기록한다.
  - `inventory.compact.json`: LLM 입력. `draft.json`에서 다음을 뺀다.
    - `sessions.contextPerTurn.series`
    - `sessions.tokens.byModel`
    - `inventory.sources` 중 `status: "absent"`인 항목
    - 대신 `knowledgeBaseKeys`(§4.4.1)를 더한다.
    - 목표 크기는 약 6,000토큰 이하다(§12).
  - `interpretation.template.json`: 빈 해석 골격. 미리 채우는 것은 다음 두 가지다.
    - `axisNotes`: 8개 축의 `axis`
    - `emptyAreas`: 엔진이 정한 `axis`·`kind`
  - `run.json`: `runId`, 시작·종료 시각, 엔진·스키마·루브릭 버전, 단계별 시간·메모리, `draftHash`, `status: "prepared"`
- stdout(`--json`):

  ```json
  {
    "ok": true,
    "runId": "20261127T091500Z-3f9a1c2e",
    "compactInventoryPath": ".harness-lens/runs/20261127T091500Z-3f9a1c2e/inventory.compact.json",
    "interpretationTemplatePath": ".harness-lens/runs/20261127T091500Z-3f9a1c2e/interpretation.template.json",
    "interpretationPath": ".harness-lens/runs/20261127T091500Z-3f9a1c2e/interpretation.json",
    "hasComparison": true,
    "sessionsStatus": "available",
    "estimatedInventoryTokens": 3900
  }
  ```

- `runId`는 스냅샷 ID와 같은 형식(`<UTC 시각>-<구성 해시 앞 8자>`)이고, 통과하면 그대로 `snapshotId`가 된다.

#### 4.4.1 `knowledgeBaseKeys`

구성 요소와 맞은 규칙에서 결정론적으로 만든다. 존재하는 구성 요소의 항목만 넣는다(PRD §11.1).

| 조건 | 키 |
|---|---|
| `hook` 구성 요소 | `hooks` |
| `skill` 구성 요소 | `skills` |
| `agent` 구성 요소 | `subagents` |
| `mcp_server` 구성 요소 | `mcp` |
| VG-L2-01·VG-L2-02 | `independent-review` |
| VG-L3-* | `verification-loop` |
| CX-L3-02 또는 `compactions_per_session` > 0 | `context-compaction` |
| TP-L2-* | `parallel-execution` |
| CE-L2-01·CE-L2-02 | `model-routing` |

### 4.5 `validate`

- 목적: LLM 해석을 엔진 결과와 합쳐 검증한다(FR-04).
- 입력: `--run <runId>`. `draft.json`과 `interpretation.json`을 쓴다.
- 처리
  1. `draft.json`의 해시가 `run.json.draftHash`와 같은지 확인한다(`V-ENGINE-INTEGRITY`). 다르면 31이다.
  2. `{ schemaVersion, rubricVersion, meta, engine, interpretation }`을 합친다.
  3. 스키마 검사(`validation` 속성 제외)와 §9의 의미 검사를 한다.
  4. 결과를 `validation`에 넣어 `analysis.json`을 만든다.
- `--model <id>`, `--agent <id>`: `meta.analyzer`를 채운다. 없으면 `model: null`, `modelSource: "unknown"`이다.
- 출력: `runs/<runId>/analysis.json`(status `valid` 또는 `invalid`)과 `validation.json`. stdout(`--json`)은 `{ "ok", "status", "checks": [실패·경고 항목만] }`이다.
- 종료 코드: 통과 0, 실패 30, 버전·무결성 31.

### 4.6 `snapshot`

- 목적: 검증을 통과한 결과를 불변 스냅샷으로 저장한다(FR-05).
- 입력: `--run <runId>`. `analysis.json`의 `validation.status`가 `valid`여야 한다. 아니면 30이다.
- 처리
  1. `snapshots/.staging-<runId>/`에 `analysis.json`을 쓴다.
  2. 디렉터리를 `snapshots/<snapshotId>/`로 원자적으로 rename한다.
  3. `snapshots/index.json`을 임시 파일 + rename으로 갱신한다.
  4. `latest.json`을 갱신한다.
  5. 세션 커서·누적 집계를 확정한다(§8.4).
- 같은 `snapshotId`가 이미 있으면 덮지 않고 40으로 실패한다.

### 4.7 `diff`

- 목적: 두 스냅샷(또는 스냅샷과 run 초안)을 결정론적으로 비교한다(FR-06).
- 입력: `--from <snapshotId>`, `--to <snapshotId|run:<runId>>`. 기본값은 `--from` 직전 스냅샷, `--to` 현재 run이다.
- 출력: 스키마 `comparison` 객체.
- 구성 요소 대응: (kind, origin, 식별 키)로 짝짓는다.
  - 식별 키는 파일이면 경로, Hook이면 `event|matcher|같은 event·matcher 안의 순번`, MCP면 서버 이름이다.
  - `added`: 한쪽에만 있다.
  - `removed`: 한쪽에만 있다. `componentId`는 이전 스냅샷의 것이다.
  - `modified`: `contentHash`가 다르다.
  - `unknown`: 어느 한쪽에서 해당 출처가 `unreadable`·`out_of_scope`였다.
- 비교 가능성

  | 조건 | `comparability` | 처리 |
  |---|---|---|
  | `schemaVersion`이 다름 | `none` | 변경 목록만 내고 `axisDeltas`는 비운다 |
  | `rubricVersion`이 다름 | `limited` | 모든 `axisDeltas.comparable: false`, `reason: "rubric_version_changed"` |
  | `scope.preset`이 다름 | `limited` | 범위 밖 출처가 걸린 변경을 `unknown`으로 둔다. `reason: "scope_changed"` |
  | `sessionParserVersion`이 다름 | `limited` | 실측 상태 축의 `comparable: false`, `reason: "session_parser_changed"` |
  | 그 외 | `full` | — |

- 예측 → 실측 전환은 비교 가능하며 `reason: "maturity_changed"`를 붙인다.
- 비교는 수준과 구성만 본다. LLM 해석 텍스트는 비교하지 않는다.

### 4.8 `render`

- 목적: 독립 실행형 HTML 리포트를 만든다(FR-08, PRD §8).
- 입력: `--snapshot <snapshotId>`(기본 최신), 선택 `--open`.
- 출력
  - `snapshots/<snapshotId>/report.html`
  - `report.html`(최신 사본)
- 보안
  - 분석 데이터는 `<script type="application/json" id="hl-data">`에 넣는다. `<`, `>`, `&`, U+2028, U+2029를 `\uXXXX`로 이스케이프한 JSON이다.
  - 화면에는 `textContent`로만 넣는다.
  - CSP 메타는 `default-src 'none'; script-src 'sha256-<내장 스크립트>'; style-src 'unsafe-inline'; img-src data:`이다.
  - 외부 리소스·CDN을 쓰지 않는다.
- `--open`: OS 기본 브라우저로 연다(`open`, `xdg-open`, `start`). 실패하면 경로만 출력하고 종료 코드는 0이다.

### 4.9 `finalize` (LLM이 호출)

- 처리: `validate` → `snapshot` → `render --open`을 차례로 실행한다. 앞 단계가 실패하면 멈추고 그 단계의 종료 코드를 돌려준다.
- 옵션: `--run`, `--agent`, `--model`, `--no-open`
- stdout(`--json`):

  ```json
  {
    "ok": true,
    "status": "valid",
    "snapshotId": "20261127T091500Z-3f9a1c2e",
    "analysisPath": ".harness-lens/snapshots/20261127T091500Z-3f9a1c2e/analysis.json",
    "reportPath": ".harness-lens/report.html",
    "opened": true,
    "checks": []
  }
  ```

## 5. `.harness-lens/` 구조

```text
.harness-lens/
├── .gitignore                  # 첫 생성 시 "*" 한 줄. 사용자가 공유하려면 지운다
├── config.json                 # 선택, 사용자가 작성(§5.1)
├── lock                        # 실행 중 잠금 {pid, startedAt}
├── latest.json                 # {"snapshotId": "..."}
├── report.html                 # 최신 리포트 사본
├── runs/<runId>/               # 실행 작업 공간. 최근 5개만 남긴다
│   ├── run.json                # 상태(prepared|validated|failed|snapshotted), 버전, 시간, draftHash
│   ├── inventory.json          # collect 산출
│   ├── sessions.json           # aggregate-sessions 산출
│   ├── sessions.staging/       # 새 누적 상태. snapshot 성공 시 sessions/로 옮긴다
│   ├── draft.json              # meta + engine
│   ├── inventory.compact.json  # LLM 입력
│   ├── interpretation.template.json
│   ├── interpretation.json     # LLM 작성(유일한 LLM 쓰기 대상)
│   ├── analysis.json           # validate 산출(valid|invalid)
│   ├── validation.json
│   └── error.json              # 실패 시
├── snapshots/
│   ├── index.json              # [{snapshotId, analyzedAt, configurationHash, schemaVersion, rubricVersion, scope}]
│   └── <snapshotId>/
│       ├── analysis.json       # 검증 통과본. 이후 바꾸지 않는다
│       └── report.html
└── sessions/                   # 세션 집계 누적 저장(원문 없음). snapshot 성공 때만 교체한다
    ├── cursor.json             # 파서 버전, R 해시, 파일 경로 해시별 {세대, inode, size, mtimeMs, offset, 지문, 카운터}
    ├── responses/<YYYY-MM>.jsonl # 응답 키 해시 → 병합 토큰(중복 제거용), 한 줄에 응답 하나. 90일 지나면 archive로 접는다
    ├── archive.json            # 접힌 응답의 일별·위치별·모델별 토큰과 일별 컨텍스트 요약
    ├── archived-keys.bin       # archive로 접힌 응답 키 해시(8바이트씩 오름차순). 같은 응답을 다시 읽어도 더하지 않는다
    ├── events.bin              # 이미 센 도구 호출·결과·프롬프트·시스템 이벤트 키 해시(8바이트씩 오름차순)
    └── attribution-cache.json  # cwd 해시 → 귀속 분류
```

### 5.1 `config.json` (선택)

```json
{
  "sessions": { "enabled": true },
  "sessionAttribution": { "bots": { "<봇 이름>": "<저장소 경로>" } },
  "orcaPaths": { "bots": "~/.orca/bots", "workspaces": "~/orca/workspaces" }
}
```

- 이 파일은 엔진이 읽기만 한다.
- 이 파일 안의 경로도 출력에는 해시로만 남긴다.

## 6. 수집 대상과 읽기 경계

| 출처(`origin`) | 경로 | 범위 |
|---|---|---|
| `project_shared` | `CLAUDE.md`, 하위 디렉터리 `CLAUDE.md`, `@import` 대상, `.claude/settings.json`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.mcp.json`, Hook이 가리키는 프로젝트 내 스크립트 | 항상 |
| `project_local` | `CLAUDE.local.md`, `.claude/settings.local.json` | 항상 |
| `plugin` | 유효 설정 `enabledPlugins`의 플러그인 매니페스트와 그 skills·agents·hooks. 플러그인 캐시 경로에서 읽는다 | 항상(구조만) |
| `user` | `<config-dir>/settings.json`, `<config-dir>/CLAUDE.md`, `<config-dir>/agents/`, `<config-dir>/skills/`, `~/.claude.json`의 `mcpServers`와 현재 프로젝트 항목의 `mcpServers` 키만 | `project_and_user`일 때 |
| `managed` | OS별 관리형 설정 파일(`managed-settings.json`) | `project_and_user`일 때 |
| 세션 기록 | `<config-dir>/projects/**/*.jsonl`, `subagents/agent-*.meta.json`의 `agentType` | `--no-sessions`가 아니면(§8) |
| 귀속 보조 | 세션 `cwd`의 `.git` 파일 한 개(`gitdir:` 줄만) | 세션 집계 시 |

읽기 경계:

- 수집 루트 밖으로 가는 심볼릭 링크와 `..` 경로는 따라가지 않는다. 해당 근거는 COM-02로 상한 1이다.
- 위 표의 경로만 연다. 그 밖은 열지 않는다. 텍스트 파일은 1MB까지만, Hook 스크립트는 256KB까지만 읽는다. 넘으면 `unsupported`(`reason: "too_large"`)다.
- 세션 기록은 줄 단위 스트리밍으로 읽는다. 파일 전체를 메모리에 올리지 않는다.
- `@import`는 최대 5단계까지 따라간다(Claude Code 동작과 같게). 순환 import는 한 번만 센다.

## 7. 비밀정보 제거 규칙

규칙은 수집 직후와 출력 직전(스냅샷·리포트·압축 인벤토리) 두 번 적용한다. 제거한 종류와 개수만 `inventory.redactions`에 남기고 값은 어디에도 남기지 않는다.

| ID | 규칙 |
|---|---|
| R1 | **열지 않는 파일.** `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*credentials*`, `.netrc`, `<config-dir>/.credentials.json`. `status: "skipped_sensitive"`로만 보고한다 |
| R2 | **값을 버리는 키.** `env`의 값은 버리고 키 이름만 남긴다. 단, 루브릭이 쓰는 키(`MAX_THINKING_TOKENS`, `CLAUDE_CODE_MAX_OUTPUT_TOKENS`, `MAX_MCP_OUTPUT_TOKENS`, `BASH_MAX_OUTPUT_LENGTH`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`)의 값이 `^[0-9]+$`이면 남긴다. `CLAUDE_CODE_SUBAGENT_MODEL`은 값이 모델 ID 형식(`^[a-z0-9.-]{1,60}$`)일 때 남긴다. MCP `env`·`headers` 값은 버리고 개수만 남긴다. MCP `url`은 scheme과 host만 남긴다 |
| R3 | **패턴 치환.** 모든 문자열에 다음 패턴을 적용해 `[REDACTED:<kind>]`로 바꾼다. `anthropic_key`(`sk-ant-[A-Za-z0-9_-]{20,}`), `openai_key`(`sk-[A-Za-z0-9]{20,}`), `github_token`(`gh[pousr]_[A-Za-z0-9]{30,}`, `github_pat_[A-Za-z0-9_]{30,}`), `slack_token`(`xox[abpr]-[A-Za-z0-9-]{10,}`), `aws_access_key`(`AKIA[0-9A-Z]{16}`), `jwt`(`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), `private_key`(`-----BEGIN [A-Z ]*PRIVATE KEY-----`), `url_credentials`(`://[^/\s:@]+:[^/\s@]+@`), `assignment`(대소문자 무시 `(api[_-]?key|token|secret|password|passwd|authorization|bearer)["']?\s*[:=]\s*["']?[^\s"']{8,}`), `high_entropy`(따옴표 안 32자 이상 `[A-Za-z0-9+/=_-]`이고 Shannon 엔트로피 4.0 이상, 휴리스틱) |
| R4 | **발췌 제한.** 지침 본문은 제목 목록과 어휘가 맞은 줄 발췌만 남긴다. 발췌는 R3 적용 후 160자 이하다. Hook 명령은 R3 적용 후 120자 이하다. Skill·Agent `description`은 300자 이하다 |
| R5 | **경로 정규화.** 프로젝트 안은 상대 경로, 홈 아래는 `~/`, 그 밖의 절대 경로는 `<abs:sha256 앞 8자>`로 쓴다 |
| R6 | **세션 식별자.** `sessionId`, `message.id`, `requestId`, `cwd`, `agentId`는 sha256 해시(앞 16자)로만 저장한다. `session-owner`, `api-request*`, `ai-title`, `custom-title`, `last-prompt`, `queue-operation` 레코드는 파싱하지 않는다 |
| R7 | **출력 재검사.** 스냅샷·리포트·압축 인벤토리를 쓰기 직전에 모든 문자열에 R3를 다시 적용한다. `interpretation`에서 걸리면 `V-SECRET-RESCAN` 실패(30)다. 엔진 영역에서 걸리면 치환하고 경고를 남긴다 |
| R8 | **분석 도구 겨냥 지시문 표시.** 지침·Skill·Agent 본문에서 `ignore (all )?(previous|prior) instructions`, `harness lens`, `analysis tool`, `이전 지시를 무시` 같은 표현(휴리스틱)을 찾으면 `limitations`에 `instruction_targets_analyzer`를 추가한다. 원문은 남기지 않는다 |

## 8. 세션 기록 집계

근거: `docs/research/02-session-logs.md`. 형식이 공식 계약이 아니므로 파서 규칙에 `sessionParserVersion`(정수 문자열)을 붙인다. `"1"`은 PR #8 초안, `"2"`는 캐시 분할 병합·이벤트 중복 제거·세대 보존·archive 키 보존을 반영한 현재 규칙이다. 버전이 바뀌면 누적 상태를 처음부터 다시 만든다.

### 8.1 읽는 필드(허용 목록)

- 공통: `type`, `uuid`, `sessionId`, `isSidechain`, `agentId`, `timestamp`, `cwd`, `version`, `origin.kind`
- `assistant`: `message.id`, `requestId`, `message.model`, `isApiErrorMessage`, `message.usage`의 `input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_5m_input_tokens`, `cache_creation.ephemeral_1h_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `message.content[].type`, `tool_use`의 `name`·`id`
- `user`: `message.content[]`의 `tool_result.is_error`·`tool_use_id`, 사람 입력 여부(`origin.kind`)
- `system`: `subtype`, `durationMs`(turn_duration), `compactMetadata.preTokens`·`postTokens`·`trigger`, `retryAttempt`
- `attachment`: `attachment.type`, `attachment.hookEvent`, `attachment.exitCode`
- 봇 자동 귀속(§8.3 규칙 4)에서만 `tool_use.input`의 문자열 값에 프로젝트 루트 경로가 들어 있는지 부분 문자열로 확인한다. 결과는 불리언 하나만 남기고 값을 저장하지 않는다.

그 밖의 필드는 해석하지 않는다. JSON 파싱 실패, 모르는 `type`, 타입이 다른 필드는 건너뛰고 개수만 센다(`linesSkipped`).

### 8.2 중복 제거(v1)

- 대상: `type == "assistant"`이고 `message.usage`가 객체인 줄
- 제외
  - `message.model == "<synthetic>"` → `excludedSynthetic`
  - `isApiErrorMessage == true` → `excludedApiError`
- 키: `message.id`. 없으면 `requestId`, 둘 다 없으면 `파일 해시#uuid`로 개별 취급한다.
- 병합: 같은 키의 줄마다 토큰 필드를 각각 `max()`로 취한다. `timestamp`는 최댓값을 쓴다. `model`·`sessionId`는 줄 순서와 무관하게 코드 유닛 순 최솟값, 사이드체인 여부는 모든 줄이 사이드체인일 때만 참이다. 줄 순서에 기대지 않아야 증분 결과가 전체 재집계와 같다(구현 v1, 초안의 "첫 줄 값"을 대신한다).
- 캐시 쓰기 분할: 줄마다 총량 `cache_creation_input_tokens`와 1시간 분량 `cache_creation.ephemeral_1h_input_tokens`(없으면 0)를 각각 `max()`로 병합한 뒤, 1시간 = min(병합 1시간, 병합 총량), 5분 = 병합 총량 − 1시간으로 나눈다. 분할 합은 병합 총량과 같다(불변식). 분할이 있는 줄과 총량만 있는 줄이 섞여도 줄 순서와 무관하다.
- 범위: 전역이다(파일 사이 복사 대비). 이미 집계한 키가 다시 나오면 차이분만 반영한다. archive로 접힌 응답의 키는 `archived-keys.bin`에 남겨, 원본 복사·회전·재스캔으로 다시 나와도 더하지 않는다(정확히 한 번).
- 이벤트 중복 제거: 축 지표에 쓰는 이벤트도 전역으로 한 번만 센다. 키는 `tool_use.id`(도구 호출), `tool_result.tool_use_id`(도구 결과·오류), 레코드 `uuid`(사람 프롬프트, `system`·`attachment` 이벤트: turn_duration, 압축, API 재시도, Hook 오류·차단)다. 같은 응답 안의 서로 다른 `tool_use` 블록은 id가 달라 각각 센다. id가 없는 이벤트는 구분할 수 없어 센다. 본 키는 `events.bin`에 해시로만 남긴다.
- 응답 키와 이벤트 키는 원 식별자(`message.id`, `tool_use.id` 등, 비밀값이 아닌 API 발급 식별자)의 64비트 비암호 해시(cyrb53 계열)다. 줄마다 `createHash`를 부르면 네이티브 메모리가 쌓여 RSS가 수십 MiB 늘어나기 때문이다. 메모리에서는 문자열 없이 상위·하위 uint32 쌍으로 typed array(오픈 어드레싱 해시, 확정분은 정렬 배열 이진 탐색)에 둔다. 경로·cwd·세션 식별자는 계속 sha256 앞 8바이트다.
- 집계 문자열 정화: 원문으로 저장하는 `message.model`과 `version`은 형식 정규식에 더해 비밀정보 검사(R3, 값 전체를 토큰으로 보는 고엔트로피 검사 포함)를 통과할 때만 남긴다. 걸리면 모델은 `unknown`, 버전은 버린다. 파서 단계에서 적용하므로 raw `sessions.json`, `aggregate-sessions` 출력, 스테이징, 확정 상태 모두에 원문이 남지 않는다.
- `usage.iterations[]`는 최상위 값과 합이 같으므로 더하지 않는다.
- 서브에이전트 기록은 별개 응답이라 합산한다. 부모 쪽 요약 수치(`attachment.usage.totalTokens`, `toolUseResult` 안의 토큰)는 쓰지 않는다.
- 사이드체인은 별도 파일 배치(`subagents/agent-*.jsonl`)와 메인 파일 혼재 배치 모두 `isSidechain`·`agentId`로 판별한다.

### 8.3 프로젝트 귀속(v1)

분석 대상 메인 저장소 경로를 `R`이라 한다. 세션마다 아래 규칙을 순서대로 적용해 처음 맞는 것을 쓴다. 서브에이전트 기록은 부모 세션의 귀속을 따른다.

| 순서 | 방법 | 조건 | `location` |
|---|---|---|---|
| 1 | `direct` | 첫 `cwd`가 `R`이거나 그 하위 | `direct` |
| 2 | `worktree` | 첫 `cwd`(또는 상위)의 `.git` 파일 `gitdir:`에서 `/.git/worktrees/<name>`를 뗀 경로가 `R` | `worker` |
| 3 | `inferred` | `cwd`가 없어졌고 `<orcaPaths.workspaces>/<repoName>/<worktree>` 규약에서 `repoName`이 `R`의 디렉터리 이름과 같음 | `worker` |
| 4a | `configured` | `cwd`가 `<orcaPaths.bots>/<bot>/` 아래이고 `config.json`이 그 봇을 `R`에 매핑 | `bot` |
| 4b | `auto` | 4a 매핑이 없고, 그 봇 세션의 `tool_use.input`에 `R` 경로가 1회 이상 나옴 | `bot` |
| 5 | 제외 | 이 프로젝트와 무관한 것이 확실함: 첫 `cwd`가 1~3과 봇 디렉터리 어디에도 해당하지 않음(다른 프로젝트), 또는 `config.json`이 그 봇을 다른 저장소에 매핑 | 집계하지 않는다. 합계·`unattributed` 어디에도 넣지 않고 `coverage.sessionsExcluded`에 개수만 |
| 6 | 미귀속 | 실제로 불확실한 것: `cwd` 기록이 없는 세션, 매핑도 `R` 경로 언급도 없는 봇 세션 | 합계에 넣지 않고 `unattributed`에 개수와 토큰만 |

- 디렉터리 이름 인코딩은 역변환할 수 없으므로 그룹 키로만 쓰고, 판정은 `cwd`로 한다.
- `CLAUDE_CONFIG_DIR`을 반영한다.
- 2의 결과는 `attribution-cache.json`에 저장한다. 워크트리가 나중에 지워져도 같은 결과를 낸다.
- `inferred`·`auto`는 합계에 들어가지만, 리포트에 "추정 귀속 포함 N%"를 함께 표시한다.
- 제외한 세션 수는 `limitations`의 `unrelated_sessions_excluded`와 리포트 "귀속" 칸에 표시한다. 다른 프로젝트의 사용량을 이 프로젝트 리포트에 싣지 않는다. 제외 세션의 서브에이전트도 제외하고, 90일이 지나 접을 때도 `archive.json`에 남기지 않는다(엔진 0.3.x 이전에 접힌 응답은 그때 규칙대로 `unattributed`에 남아 있을 수 있다).
- PRD §6.1의 "귀속이 불확실하면 미귀속"과 같은 뜻이다(v0.1의 5행 "그 외 전부"는 다른 프로젝트 세션까지 미귀속에 넣어 PRD와 어긋났다). PRD 문장 보강 제안은 `docs/reviews/2026-11-27-diceforge-defects.md`의 "PRD 제안"에 있다.

### 8.4 증분 처리와 누적 보존

- 파일 찾기: `<config-dir>/projects/*/*.jsonl`(메인)과 `<config-dir>/projects/*/<sessionId>/subagents/agent-*.jsonl`. `tool-results/`, `memory/`, `*.meta.json`은 열지 않는다.
- 읽기: 1MiB 단위 `readSync`로 줄을 나눈다. 16MiB를 넘는 줄은 버퍼에 모으지 않고 건너뛴다(`linesSkipped`). 256KiB를 넘는 줄은 앞 120바이트의 `"type"`만 보고, 해석하지 않는 타입(§8.1 밖, 예: `api-request-blob`)이면 파싱하지 않는다.
- 키 파일 무결성: `cursor.json`의 `keyFiles`에 `archived-keys.bin`·`events.bin`의 키 개수와 sha256 앞 8바이트를 적는다. 읽을 때 길이(8의 배수, 개수 일치), 해시, 엄격한 오름차순을 확인한다. 하나라도 어긋나면(잘림·비움·삭제·덮어쓰기·정렬 깨짐) 누적 상태 전체를 손상으로 보고 처음부터 다시 만든다(`limitations`의 `session_state_rebuilt`, 원문 없이 코드와 고정 문구만).
- 커서(`cursor.json`): `{ parserVersion, rootPathHash, keyFiles, files: { <파일 경로 해시>[~g<세대>]: { kind, gen, inode, size, mtimeMs, offset, fp, present, session, cls, botMention, versions, firstTs, lastTs, c: {카운터}, durations, gaps, openGap, pendingError, tools, openTools } } }`
  - 지문(`fp`): 커서까지 읽은 앞부분의 첫 4KiB와 커서 직전 4KiB의 해시다. inode·크기·수정 시각이 모두 같으면 읽지 않는다. 하나라도 바뀌면 지문을 다시 계산해, 크기가 offset 이상이고 지문이 같으면(이어 쓰기, 같은 내용으로 원자적 교체) 커서부터 이어 읽는다.
  - 크기가 offset보다 작아졌거나 지문이 다르면(같은 경로로 회전, copytruncate 뒤 재성장, 재작성) 새 세대로 보고 처음부터 읽는다. 이전 세대는 `<경로 해시>~g<세대>` 항목(`present: false`)으로 남겨 그 세션의 귀속과 카운터를 보존한다. 응답과 이벤트는 전역으로 한 번만 세므로 같은 내용을 다시 읽어도 늘지 않는다.
  - 파일을 읽다 실패하면 그 파일의 상태와 새 이벤트 키를 반영하지 않고 다음 실행에서 다시 읽는다.
  - 마지막 줄이 개행 없이 끝나면 쓰는 중인 줄로 보고 offset을 그 앞에 둔다.
  - `parserVersion` 또는 R(메인 저장소 경로) 해시가 바뀌면 전체를 다시 읽는다. `--full-rescan`도 같다.
  - 원본 파일이 사라져도 카운터는 남긴다(`present: false`).
- 응답 맵(`responses/<YYYY-MM>.jsonl`): 한 줄에 `[키 해시, freshInput, cacheCreation 총량, 1시간 쓰기(병합 최댓값), cacheRead, output, model, 세션 해시, 사이드체인(0|1), 시각(ms)]`. 메모리에서는 응답마다 객체를 만들지 않고 열 단위 typed array에 두며, 쓰기·읽기도 줄 단위로 나눠 한다(메모리 예산 200MiB). `--now`보다 90일 넘게 오래된 응답은 `archive.json`의 일별·위치별·모델별 토큰과 일별 컨텍스트 요약(`requests`, `p50`, `max`)으로 접고 키를 `archived-keys.bin`에 남긴다. 축 지표는 응답 맵(최근 90일)만 쓴다.
- 귀속은 저장하지 않고 실행마다 다시 정한다. 파일마다 첫 `cwd`의 분류(`direct`·`worktree`·`inferred`·`bot`(봇 이름 해시)·`none`)와 봇 세션의 프로젝트 경로 언급 여부(불리언)만 저장하므로, `config.json`의 봇 매핑을 바꾸면 다음 실행에 바로 반영된다. cwd 분류는 `attribution-cache.json`에 남겨 워크트리가 지워져도 같은 결과를 낸다.
- 스테이징과 확정: `prepare`는 확정 상태(`sessions/`)를 읽어 새 바이트를 더한 상태를 `runs/<runId>/sessions.staging/`에 쓴다. `snapshot`이 성공하면 `sessions/`를 그것으로 바꾼다(이름 바꾸기). 검증이 실패하면 커서가 전진하지 않으므로 다음 실행에서 같은 구간을 다시 읽는다.
- 분위수는 원값을 정렬한 최근접 순위(nearest-rank)다. 정확하고 결정론적이다(초안의 히스토그램 근사를 대신한다).
- 불변식: 증분 실행 결과는 같은 파일 집합을 `--full-rescan`한 결과와 같다(`coverage.incremental`만 다름). `tests/sessions.test.mjs`가 확인한다.

### 8.5 토큰 지표(PRD §6.1)

- 4종 분리: `freshInput`(=`input_tokens`), `cacheWrite`(=`cache_creation_input_tokens`), `cacheRead`, `output`
- 환산값 `weighted`
  - 식: Σ 모델가중치(model) × (freshInput × 1 + cacheWrite5m × w₅ₘ + cacheWrite1h × w₁ₕ + cacheRead × w_r + output × w_o)
  - 가중치는 엔진에 내장한 가격표(`engine/src/pricing.mjs`, `pricingTableVersion` `2026-10-06`)에서 온다. 기준 모델(`referenceModel`, `claude-opus-5-5`)의 새 입력 단가를 1로 둔 상대값이다. 캐시 쓰기는 입력의 1.25배(5분)·2배(1시간), 캐시 읽기와 출력은 모델별 공개 단가다. 모델 이름의 날짜 접미사·플랫폼 접두사·`[1m]` 표기는 떼고 찾는다.
  - 가격표에 없는 모델의 토큰은 `weighted`에서 빼고 `limitations`에 `unknown_model_pricing`을 남긴다.
  - 청구액으로 표시하지 않는다.
- 위치별: `direct`, `worker`, `subagent`, `bot`. 위치끼리 겹치지 않는다(서브에이전트 토큰은 부모 위치에 넣지 않는다). `subagent`의 `sessions`는 서브에이전트 기록 수다.
- 턴별 컨텍스트 크기: 프로젝트·워커 세션의 메인 스레드 요청마다 freshInput + cacheWrite + cacheRead다. 분포(p50, p90, max), 첫 요청 p50, 압축 수, 일별 추이(최대 90점)를 낸다.
  - 분포는 응답 맵(최근 90일 원시 응답)에서만 정확히 낸다. 범위는 `distribution: { from, to, retentionDays }`다. 원시 응답이 없으면 분포 값은 `null`(미확인)이다.
  - 일별 추이는 분포와 별개로 archive로 접힌 날까지 잇는다. 원시 응답이 모두 접혀도 남는다. 점마다 `source`(`raw` | `archive`)를 붙인다. `archive` 날의 `requests`·`max`는 정확하고, 같은 날이 여러 번 접히면 `p50`은 근사다. 리포트는 그 날을 "근사"로 표시한다.
- 서브에이전트는 부모 세션이 귀속됐을 때만 `subagent` 위치에 들어간다. 봇 세션의 서브에이전트도 `subagent`다(축 지표에서는 뺀다).

### 8.6 축 지표와 성숙도

- 축 지표(`axisMetrics`)는 `configSince` 이후에 시작한 프로젝트·워커 세션만으로 계산한다(`sinceConfig: true`). 봇 채팅은 조율 비용이라 넣지 않는다. 서브에이전트는 도구 오류 지표와 `cache_hit_ratio`, `toolUsage`에만 넣는다(루브릭 §1.9). 예외로 `bot_weighted_share`·`worker_weighted_share`는 누적 집계 전체의 위치별 비중이다(`sinceConfig: false`).
- 표본이 0인 지표는 싣지 않는다. 지표 목록과 정의는 루브릭 §1.9 표다.
- `configSince` = min(같은 구성 해시가 이어진 마지막 스냅샷 묶음의 첫 `analyzedAt`, 수집한 프로젝트 설정 파일의 최근 수정 시각(초 단위로 내림)), 그리고 `--now`를 넘지 않는다. 첫 분석과 두 번째 분석이 같은 값을 갖도록 수정 시각을 함께 본다.
- 도구별 집계 `toolUsage`: 축 지표와 같은 범위의 도구 분류별 `{ tool, calls, errors }`(루브릭 §1.9). `tool_result`의 도구는 `tool_use_id`로 잇고, 결과를 아직 못 본 호출은 커서의 `openTools`(id 해시 → 분류)에 둔다.
- 컨텍스트 창 크기: `engine/src/model-windows.mjs`(`CONTEXT_WINDOW_TABLE_VERSION` `2026-11-27`). 모델 이름 정규화는 가격표와 같다.
- 성숙도: 표본(세션 수, 또는 도구 호출 수 — ES는 Bash를 뺀 도구 호출(서브에이전트 포함), AU는 메인 스레드만)이 요구량에 닿고 대역 지표가 있으면 `measured`다. 닿지 않으면 `blockedReason: "insufficient_samples"`, 지표가 없으면 `"metric_unavailable"`이다.
- 직전 분석 자기 비용: 이전 스냅샷의 `meta.analyzedAt` ~ `validation.checkedAt` 구간에 시각이 있는, 이 프로젝트(direct·worker)에 귀속된 메인 스레드 응답을 더한다. 같은 시간대의 다른 작업도 함께 들어간다.

## 9. 검증 검사 목록 (`validate`)

`fail`이 하나라도 있으면 `status: "invalid"`, 종료 코드 30이다. 참조 구현은 `tests/support/analysis-checks.mjs`다(엔진 구현 시 옮긴다).

| checkId | 검사 |
|---|---|
| V-SCHEMA | `validation`을 뺀 문서가 스키마를 통과한다 |
| V-VERSION | `schemaVersion`·`rubricVersion`·엔진 버전이 run 기록과 같다(다르면 31) |
| V-ENGINE-INTEGRITY | `meta`·`engine`이 `prepare` 산출과 바이트 단위로 같다(다르면 31) |
| V-REF-EVIDENCE | 모든 `evidenceIds`가 `engine.evidence`에 있다 |
| V-REF-COMPONENT | 모든 `componentId` 참조가 인벤토리에 있다(`removed` 변경 제외) |
| V-REF-CHANGE | `changeTradeoffs`는 `comparison`이 있을 때만 있고, `changeIds`가 실제 변경이다 |
| V-CHANGE-COVERAGE | 모든 `componentChanges[].changeId`가 어떤 `changeTradeoffs` 항목에 나온다 |
| V-REF-TENSION | `axisTensions[].tensionId`가 `tensionCandidates`에 있다 |
| V-REF-METRIC | `findings[].metricRefs`가 `sessions.axisMetrics[].metricId`에 있다 |
| V-SINGLE-ATTRIBUTION | 축 판정 근거가 그 축을 주 축으로 가지며, 무력화되지 않았고, 두 축에 쓰이지 않는다 |
| V-AXIS-NOTES | `axisNotes`가 8개 축을 정확히 하나씩 덮는다 |
| V-EMPTY-AREAS | `emptyAreas`가 실측 상태가 아닌 수준 0 축(`unconfigured`)과 판정 불가 축(`unknown`)과 정확히 같다 |
| V-INVEST-FORGO | `invested` 축은 수준 2 이상, `forgone` 축은 1 이하 또는 판정 불가, 서로 겹치지 않는다 |
| V-RANGE | 표시 값(실측이면 band, 아니면 level)이 `range` 안에 있고 `min ≤ max`다 |
| V-MATURITY | 진행도 = min(1, current ÷ required), 상태와 진행도가 맞고, `deltaFromPredicted` = band − predictedLevel이다 |
| V-TOKEN-SUM | `total` = 위치별 합 = 모델별 합(가중치는 ±0.5 허용)이고 위치별 비중 합이 1(±0.005)이다 |
| V-SECRET-RESCAN | `interpretation`의 모든 문자열이 R3에 걸리지 않는다 |

## 10. 결정론 보장

같은 입력이면 엔진 산출물(`inventory.json`, `sessions.json`, `draft.json`, `inventory.compact.json`, `comparison`, 렌더링 HTML의 데이터 부분)이 바이트 단위로 같다.

- 입력의 정의: 수집 대상 파일의 바이트, 세션 기록 파일의 바이트와 커서 상태, `config.json`, 엔진·루브릭·스키마·파서·가격표 버전, `--scope`, `--now`(시각)
- 정렬
  - 구성 요소: (kind, origin, 식별 키)
  - 근거: (path, line, keyPath)
  - 객체 키: 코드 유닛 순서
  - 로케일 의존 비교(`Intl`, `localeCompare`)를 쓰지 않는다.
- 직렬화: JSON은 2칸 들여쓰기, 키 정렬, 끝 개행 하나로 쓴다. 해시 입력은 공백 없는 정렬 JSON이다.
- ID
  - 구성 요소: `c_` + sha256(kind|origin|식별 키)의 앞 12자
  - 근거: `ev_` + sha256(componentId|keyPath|line|규칙 군)의 앞 12자
  - 변경: `chg_` + sha256(from|to|componentId|change)의 앞 12자
- 시각: 산출물에 들어가는 시각은 `meta.analyzedAt`, `validation.checkedAt`, run 기록뿐이다. 모두 `--now`로 고정할 수 있다. 수정 시각은 `configSince` 계산에만 쓴다.
- 부동소수: 비율은 소수 4자리, 환산 토큰은 소수 1자리로 반올림(half-even)해 저장한다.
- 환경 독립: 경로 구분자는 `/`로 정규화한다. 줄 끝은 해시 계산에서 LF로 정규화한다. 플랫폼에 따라 다른 값(`platform`, `nodeVersion`)은 `meta.engineInfo`에만 넣는다.
- LLM 해석은 결정론 대상이 아니다. 변경 비교(`diff`)는 LLM 텍스트를 쓰지 않는다.
- 회귀 테스트: 같은 픽스처를 두 번 수집해 바이트 비교하고, 증분 집계와 전체 재집계를 비교한다(PRD §13).

## 11. 안전한 실패

- 잠금: `lock` 파일을 `O_EXCL`로 만든다. 기록된 pid가 살아 있지 않거나 10분이 지났으면 오래된 잠금으로 보고 지운다.
- 원자적 쓰기: 모든 파일은 같은 디렉터리의 임시 파일에 쓴 뒤 rename한다. 스냅샷은 스테이징 디렉터리를 통째로 rename한다.
- 부분 결과: `runs/` 아래 파일은 정상 결과가 아니다. 리포트와 비교는 `snapshots/`만 읽는다. 검증 실패한 `analysis.json`은 run 디렉터리에만 남는다(FR-04, FR-09).
- 세션 커서는 스냅샷 성공 후에만 전진한다(§8.4).
- 예외: 처리하지 않은 예외는 `error.json`(메시지, 단계, 엔진 버전. 원문·경로 원문 없음)에 남기고 종료 코드 1로 끝낸다.

## 12. 성능 예산 훅 (PRD §11.1)

엔진은 서브커맨드마다 `durationMs`(단조 시계)와 `maxRssBytes`(`process.resourceUsage().maxRSS × 1024`)를 `run.json`과 `selfCost.currentRun`에 기록한다. 예산 대비 결과는 `selfCost.budgets`에 넣는다.

| budgetId | 목표(초기값) | 측정 |
|---|---|---|
| `always_loaded_tokens` | 100 토큰 | Harness Lens `SKILL.md` frontmatter의 `name` + `description` UTF-8 바이트 ÷ 4(올림, 추정) |
| `background_processes` | 0 | 엔진은 상주 프로세스·상시 Hook을 만들지 않는다. 항상 0을 기록하고, 테스트가 설치물에 Hook 선언이 없는지 확인한다 |
| `reanalysis_engine_ms` | 5,000 ms | 이전 스냅샷이 있을 때 `prepare` 전체 시간. 최초 분석(커서 없음)은 `unmeasured`로 두고, 진행 상황을 stderr에 표시한다 |
| `engine_max_rss_bytes` | 200 MiB | 모든 서브커맨드의 최대 RSS |
| `llm_input_inventory_tokens` | 6,000 토큰 | `inventory.compact.json` UTF-8 바이트 ÷ 4(올림, 추정) |
| `llm_tokens_per_analysis` | 120,000 토큰 | 직전 분석 run의 `prepare` 시작 ~ `finalize` 종료 사이, 귀속된 메인 스레드 응답의 freshInput + cacheWrite + output(캐시 읽기 제외). 다음 분석에서 `previousAnalysis`로 측정한다 |

- 기본 동작은 예산을 넘어도 실패하지 않고 `status: "exceeded"`와 stderr 경고만 남긴다.
- `--strict-budget`이면 종료 코드 60이다. CI 성능 테스트가 이 옵션을 쓴다(PRD §11.1 "예산 초과는 테스트에서 실패").
- 수치는 초기 목표다. 구현 후 실측으로 보정하고, 보정하면 이 표와 PRD를 함께 고친다.

## 13. 구현 시 확인할 것

- Hook 실패·권한 거부·압축 레코드의 실제 형식(픽스처 필요). 확인 전에는 `hook_blocks_per_session`을 대리 지표로만 싣고 SB 실측을 막아 둔다. 구현 v1은 `attachment.type == "hook_non_blocking_error"`, `exitCode != 0`인 `hook_*`, `stop_hook_summary.hookErrors[]`를 실패로, `hook_*blocking_error`(non_blocking 제외)를 차단으로 센다.
- `system(turn_duration)`이 없는 세션(실측에서 Orca 워커 세션 다수)은 TP 대역 지표가 없어 `metric_unavailable`로 남는다.
- `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`, `omitClaudeMd`, 실패 이벤트 Hook 이름 등 루브릭이 참조하는 키를 공식 문서로 재확인한다.
- 관리형 설정 파일의 OS별 경로, Windows의 심볼릭 링크·경로 처리.
- 가격표 내장 형식과 갱신 절차(`pricingTableVersion`).
