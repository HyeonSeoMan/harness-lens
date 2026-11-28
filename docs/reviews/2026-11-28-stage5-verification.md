# 5단계 마무리 ② 검증: OS·성능 예산·리포트 표시

기준 main: `7f1e8a5`(#17 포함), PRD §11.1, `docs/spec/engine-cli.md`. 코드 변경은 아래 “조치”에 적은 버그 수정에 한정했다. 점수를 매기지 않고 실제 관측값만 적는다. DiceForge(`~/Documents/DiceForge`, HEAD `9b35cfa`)는 읽기만 했으며 결과는 분석 대상 밖 임시 디렉터리에 기록했다.

판정: **통과**(기준 충족) · **한계**(이번 검증으로 확인하지 못했거나 제한이 남음) · **조치**(이 PR에서 수정)

## 1. OS 확인

| 환경 | 방법 | 결과 | 판정 |
|---|---|---|---|
| macOS 27.2.1 arm64, Node 22.22.1 | 로컬 `node --test tests/*.test.mjs` | main 기준 112/112 통과(4.6초). 첫 커밋 후 114/114, 검수 반영 후 117/117 | 통과 |
| macOS(GitHub `macos-latest`), Node 22 | 이 PR에서 CI에 추가한 `os` 작업 | 통과 | 통과 |
| Linux Debian bookworm arm64, Node 20.20.2·22.23.5 | Docker `node:{20,22}-bookworm-slim`, 저장소를 읽기 전용으로 올려 복사 후 실행 | 각 112/112 통과 | 통과 |
| Linux, 비루트 사용자 | 같은 컨테이너에서 `node` 사용자로 테스트 실행(권한 검사가 루트에서 우회되지 않게) | 112/112 통과 | 통과 |
| Linux 번들 | 컨테이너에서 `npm ci && npm run check-bundle` | 커밋된 번들과 새 빌드 일치 | 통과 |
| Linux x86_64(GitHub `ubuntu-latest`), Node 20·22 | 기존 CI `test` 작업 | 통과 | 통과 |
| Windows(GitHub `windows-latest`), Node 22 | 이 PR에서 CI에 추가한 `os` 작업 | 최초 실행에서 5건과 1개 파일이 실패(아래 W1·W2). 문서 작성 시점 head의 CI run 46150759159는 114건 중 113건 통과, 1건 건너뜀(POSIX chmod 단언, #17 R5 설계대로), 실패 0. 검수 반영 후 개수는 §6 | 조치 후 통과 |

### Windows 코드 리뷰와 CI 결과

| ID | 영역 | 관찰 | 판정 |
|---|---|---|---|
| W1 | 개행 | 저장소에 `.gitattributes`가 없었다. Windows Git의 기본값 `core.autocrlf=true`로 체크아웃하면 픽스처·`SKILL.md`·번들이 CRLF가 된다. CI에서 `CRLF·BOM 차이는 구성 해시를 바꾸지 않는다`(이미 CRLF인 파일에 다시 `\r`를 붙여 `\r\r\n`이 됨)와 `skill-metadata.test.mjs`(frontmatter 정규식 불일치) 실패를 확인했다. 플러그인을 git으로 설치하는 사용자도 같은 CRLF 파일을 받는다. 엔진은 사용자 파일과 자기 `SKILL.md`를 읽을 때 `\r\n`을 정규화하므로(collect.mjs `readFile`, 자기 Skill 판독) 분석 결과 자체는 영향이 없다 | 조치: `* text=auto eol=lf`, PNG는 binary로 지정 |
| W2 | 경로 구분자 | 세션 귀속의 경로 언급 판정(`mentionsRoot`)은 `/` 구분자 루트로만 찾았다. Windows의 도구 입력은 `C:\a\b` 형태라 매핑 없는 봇 세션이 프로젝트 경로를 언급해도 `auto`로 귀속되지 않고 미귀속으로 남았다. CI의 귀속 테스트 3건 실패로 확인했다 | 조치: 루트가 Windows 경로(드라이브 문자·UNC)일 때만 값의 역슬래시를 `/`로 바꾸고 대소문자를 무시한다. POSIX에서는 역슬래시가 파일명 문자라 그대로 둔다(검수 차단 1, §6). 기존 커서의 `botMention`은 다시 계산되지 않으므로 파서 버전을 5로 올려 누적 상태를 재생성한다(검수 차단 2, §6) |
| W3 | `render --open` | `spawn('cmd', ['/c','start','""',url])`는 libuv 인용 규칙 때문에 `""`가 `"\"\""`로 전달되어 `start`가 제목으로 받지 못하고, URL에 `&`가 있으면 cmd가 명령 구분자로 해석한다 | 조치: cmd를 거치지 않고 `rundll32.exe url.dll,FileProtocolHandler <url>`로 연다. cmd는 따옴표 안에서도 `%VAR%`·`!VAR!`를 확장하고 file URL에는 `%`가 들어가므로 인용만으로는 막을 수 없다(검수 권고, §6). URL은 공백·따옴표가 인코딩돼 한 인자로 전달된다. 실제 브라우저 열기는 Windows에서 확인하지 못했다(W7) |
| W4 | 실행 비트 | Windows에서는 Git Hook 실행 비트를 확인하지 않고 `git_hook_executable_unconfirmed` 한계를 남긴다(#17 R5). 엔진 번들은 `node <경로>`로 실행해 실행 비트가 필요 없다(모드 100644) | 통과(설계상 한계는 리포트에 표시) |
| W5 | 경로 표기 | 수집·표시·해시 경로는 `toPosix`·`path.posix`로 정규화한다. 루트 경계 검사는 `path.relative`(win32는 대소문자 무시)로 한다 | 통과(코드 리뷰, CI 통과) |
| W6 | 실제 Windows 세션 기록 | Claude Code가 Windows에서 남기는 `cwd`의 드라이브 문자 대소문자·UNC 경로 표기는 실데이터로 확인하지 못했다. 합성 기록으로만 검사했다 | 한계 |
| W7 | Windows 수동 실행 | Windows 실기기에서 Skill 설치→분석→브라우저 열기를 해 보지 않았다. CI 러너의 테스트로 대신했다 | 한계 |

## 2. 성능 예산(PRD §11.1)

| 예산 | 목표 | 관측 | 조건 | 판정 |
|---|---|---|---|---|
| 상시 컨텍스트 | 100토큰 이하 | 46토큰(추정) | `SKILL.md` name+description, 엔진 `always_loaded_tokens` | 통과 |
| 백그라운드 프로세스 | 0개 | 0(엔진 `background_processes` 값). 근거는 정적 검사다: `plugin.json`에 hooks 없음, `hooks/` 디렉터리 없음, 번들에 네트워크 모듈 없음(`performance.test.mjs`) | 번들의 유일한 자식 프로세스는 `render --open`의 OS 브라우저 열기(`open`/`xdg-open`/`rundll32`)다. 분석 후 남는 프로세스를 런타임에 관측하지는 않았다 | 통과(정적 근거) |
| 엔진 메모리 | 200MiB 이하 | DiceForge 실데이터 최초 `prepare` 최대 RSS 1차 156.3MiB(163,856,384B), 2차 177.5MiB(186,073,088B). 같은 실행의 `/usr/bin/time -l`과 엔진 `selfCost.currentRun`의 값이 일치했다. 실행마다 20MiB 안팎 흔들린다 | 1차 957파일·390,278줄, 2차 964파일·392,066줄(세션 기록이 늘어남), 귀속 131세션, `--strict-budget`. 명령·원문은 §7 | 통과 |
| 엔진 메모리(합성 대용량) | 200MiB 이하 | macOS 최초 141.3MiB·증분 131.4MiB / 이벤트 72만: 최초 173.3MiB·증분 147.6MiB. Linux Node 22: 137.7·133.2 / 155.8·145.7MiB. Node 20: 134.1·121.2 / 151.4·137.4MiB | `performance.test.mjs` 12만 응답·약 166MB | 통과 |
| 재분석 실행 시간 | 5초 이내 | 합성 증분 재분석 macOS 270ms·293ms, Linux 318~369ms | `performance.test.mjs` | 통과 |
| 재분석 실행 시간(실데이터) | 5초 이내 | 측정하지 못했다. 증분 상태는 `finalize`에서 확정되고, `finalize`에는 LLM이 쓴 해석이 필요하다. 해석을 지어내 넣지 않았다. 참고로 최초 `prepare`는 1차 3.53초(세션 집계 3.48초)·2차 3.35초(3.30초)이며 최초 분석은 5초 예산의 예외다 | DiceForge | 한계 |
| 압축 인벤토리 | 6,000토큰 이하 | 5,974토큰(1차·2차 동일). 엔진 `estimatedInventoryTokens`(바이트 기반 추정)이며 실제 토크나이저 값이 아니다 | DiceForge, 세션 포함, `--strict-budget` 종료 0 | 통과(추정 기준 여유 26토큰) |
| 압축 인벤토리 여유 | — | 여유가 0.4%라 DiceForge 설정이나 세션 축이 조금만 늘어도 `--strict-budget`가 종료 60을 낼 수 있다. #17 검수 중에는 6,437토큰으로 넘은 실행이 있었다(압축 보완 전, 다른 main·세션 기록이라 동일 입력 비교는 아니다. `2026-11-28-stage5-collection-protocol.md` 참조) | — | 한계(후속 압축 작업 필요) |
| 분석 1회 LLM 토큰 | 120,000토큰 이하 | 엔진은 `unmeasured`로 표시한다. 이 검증에서는 LLM 분석을 돌리지 않았다 | — | 한계 |

## 3. 리포트 다크 모드·모바일 폭(390px)

방법: 리포트 3종(변경 비교 포함 최신, 이전 스냅샷, 합성 세션 40개 실측)을 `python3 -m http.server`(127.0.0.1)로 제공하고 Orca 브라우저에서 viewport 390×844(mobile)·`prefers-color-scheme` dark/light로 열었다. 페이지 가로 넘침, 텍스트 대비(WCAG 4.5:1, 큰 글자 3:1), 표 셀의 글자 단위 줄바꿈을 스크립트로 측정하고 스크린샷으로 확인했다.

| 항목 | 결과 | 판정 |
|---|---|---|
| 페이지 가로 스크롤 | 3종 × 다크·라이트 모두 `scrollWidth` = 390. 표·코드 외 요소의 넘침 0 | 통과 |
| 다크 모드 색 | 배경 `#161615`·본문 `#ecece6`. 대비 미달 텍스트 0건, SVG 하드코딩 색 0건 | 통과 |
| 라이트 모드 색 | 레이더 “판정 불가” 표지의 `?`(`--warn-line` #c98a00, 흰 패널)가 2.75:1로 미달. 다크는 통과. 색 토큰은 `style.mjs` 범위라 이 PR에서 고치지 않았다. 같은 정보는 범례와 축 목록 문장으로도 표시된다 | 한계(권고: 라이트 `--warn-line`을 3:1 이상으로) |
| 레이더·추세 차트 | 390px에서 축 이름·“처리 속도 (최대 2)” 잘림 없음, 범례 한 열 | 통과 |
| 표(좁은 폭) | 수정 전: 열이 화면 폭으로 압축되어 한글이 글자마다 세로로 쪼개졌다(변경 내역 “+ 추가”, 상세 수치 표의 “구조 수준”·`SC-L1-01` 등, 세션 리포트 상세 수치 표 19셀). 수정 후 0셀. 표는 `.tablewrap` 안에서 가로 스크롤되고 페이지 폭은 그대로다 | 조치: `client.mjs` `table()`에 열당 최소 80px와 `word-break: keep-all` |

## 4. 조치 요약

| 파일 | 변경 | 회귀 검사 |
|---|---|---|
| `.gitattributes` | LF 체크아웃 고정, PNG binary | Windows CI의 결정론·Skill 메타데이터·번들 테스트 |
| `engine/src/sessions.mjs`·`constants.mjs` | Windows 루트에 한해 역슬래시·대소문자 정규화, `SESSION_PARSER_VERSION` 5 | Windows CI의 귀속 테스트 3건, `unit.test.mjs` 경로 언급, `sessions.test.mjs` POSIX 반례·버전 4 커서 |
| `engine/src/cli.mjs` | `browserCommand()` 분리, Windows는 `rundll32` 직접 실행 | `unit.test.mjs`(`&`·`%..%`·`!..!` 포함 URL이 한 인자로 전달) |
| `engine/src/report/client.mjs` | 표 최소 폭·keep-all | `report-client.test.mjs` |
| `.github/workflows/ci.yml` | `os` 작업: macos-latest·windows-latest × Node 22 | — |
| `skills/harness-analyze/scripts/harness-lens.mjs` | 번들 재생성 | `check-bundle` |

## 5. 남은 한계

- 실데이터 재분석 시간과 분석 1회 LLM 토큰은 LLM 해석이 있는 실제 분석에서만 측정된다(§2).
- 압축 인벤토리 여유가 26토큰으로 작다(§2).
- Windows는 CI 러너로만 확인했고 실제 세션 기록·브라우저 열기는 확인하지 못했다(W6·W7).
- 라이트 모드 `?` 표지 대비(§3)는 `style.mjs` 담당 작업으로 넘긴다.

## 6. 독립 검수 반영

| 지적 | 조치 | 회귀 검사 |
|---|---|---|
| 차단 1: macOS·Linux에서도 역슬래시를 구분자로 바꿔 `/tmp/P\sample-app/...`를 `/tmp/P/sample-app` 언급으로 오인(무관한 봇이 auto 귀속, 토큰 합계 변화) | 루트가 `C:/…`·`//서버/…`일 때만 역슬래시 변환·대소문자 무시. POSIX 루트는 원문 그대로 비교 | `unit.test.mjs` 경로 언급(POSIX 반례, Windows 정방향·역방향·혼합·대소문자·UNC), `sessions.test.mjs` POSIX 역슬래시 반례(Windows에서는 auto 1) |
| 차단 2: 기존 커서가 있으면 수정 전 `botMention=false`가 남아 증분과 `--full-rescan` 결과가 다름 | `SESSION_PARSER_VERSION` 4→5. 버전 4 상태는 재사용하지 않고 현재 원본에서 재집계하며 `session_state_reset` 한계를 남긴다. 원본이 이미 정리된 구간은 복구되지 않는다(명세 §8). 직전 스냅샷과의 실측 비교는 `session_parser_changed`로 제한된다 | `sessions.test.mjs`: 버전 4·`botMention=false` 커서로 증분 실행 → `--full-rescan`과 세션 집계 전체가 같고 auto 1. 커서 버전을 5로 두면 같은 테스트가 실패함을 확인 |
| 권고: cmd 환경 변수 확장(`%VAR%`, 지연 확장 `!VAR!`) | cmd를 쓰지 않고 `rundll32.exe url.dll,FileProtocolHandler`로 변경 | `unit.test.mjs` |
| 권고: Windows 테스트 개수, “같은 입력” 표현 | §1·§2 정정 | — |
| 권고: 성능 수치 근거·추정 여부 | 재현 명령과 원문(§7), 인벤토리 토큰은 추정치, 상주 0은 정적 근거로 명시 | — |

검수 반영 커밋의 CI run 46151409320: 5개 작업 모두 통과. Windows는 117건 중 116건 통과, 1건 건너뜀(POSIX chmod 단언), 실패 0이며 새 테스트 3건(POSIX 반례는 Windows에서 auto 1 분기, 버전 4 커서, 경로 언급)이 모두 실행됐다.

## 7. 성능 측정 재현

```sh
# DiceForge는 읽기만 한다. --out은 분석 대상 밖 임시 디렉터리.
/usr/bin/time -l node skills/harness-analyze/scripts/harness-lens.mjs prepare \
  --project ~/Documents/DiceForge --out <임시 디렉터리> --strict-budget --json
# 결과 JSON의 estimatedInventoryTokens, <runs/runId>/draft.json의 engine.selfCost.budgets·currentRun을 읽는다.
```

| 실행 | 엔진 | 종료 | wall | 최대 RSS(time -l) | currentRun prepare | 인벤토리 추정 | 수집 범위 |
|---|---|---|---|---|---|---|---|
| 1차(13:31Z) | 이 PR 첫 커밋 번들, 파서 4 | 0 | 3.53s | 163,856,384B | 3,505ms·163,856,384B | 5,974 | 957파일·390,278줄·귀속 131 |
| 2차(검수 반영 후) | 검수 반영 번들, 파서 5 | 0 | 3.35s | 186,073,088B | 3,319ms·186,073,088B | 5,974 | 964파일·392,066줄·귀속 131 |

DiceForge HEAD `9b35cfa`, 작업 트리 변경 없음. 두 실행 사이에 세션 기록이 늘어 동일 입력이 아니다. 산출물은 세션 스크래치 디렉터리에 두었고 저장소에 커밋하지 않았다.
