# 5단계 마무리 ② 검증: OS·성능 예산·리포트 표시

기준 main: `7f1e8a5`(#17 포함), PRD §11.1, `docs/spec/engine-cli.md`. 코드 변경은 아래 “조치”에 적은 버그 수정에 한정했다. 점수를 매기지 않고 실제 관측값만 적는다. DiceForge(`~/Documents/DiceForge`, HEAD `9b35cfa`)는 읽기만 했으며 결과는 분석 대상 밖 임시 디렉터리에 기록했다.

판정: **통과**(기준 충족) · **한계**(이번 검증으로 확인하지 못했거나 제한이 남음) · **조치**(이 PR에서 수정)

## 1. OS 확인

| 환경 | 방법 | 결과 | 판정 |
|---|---|---|---|
| macOS 27.2.1 arm64, Node 22.22.1 | 로컬 `node --test tests/*.test.mjs` | main 기준 112/112 통과(4.6초). 이 PR 적용 후 114/114 | 통과 |
| macOS(GitHub `macos-latest`), Node 22 | 이 PR에서 CI에 추가한 `os` 작업 | 통과 | 통과 |
| Linux Debian bookworm arm64, Node 20.20.2·22.23.5 | Docker `node:{20,22}-bookworm-slim`, 저장소를 읽기 전용으로 올려 복사 후 실행 | 각 112/112 통과 | 통과 |
| Linux, 비루트 사용자 | 같은 컨테이너에서 `node` 사용자로 테스트 실행(권한 검사가 루트에서 우회되지 않게) | 112/112 통과 | 통과 |
| Linux 번들 | 컨테이너에서 `npm ci && npm run check-bundle` | 커밋된 번들과 새 빌드 일치 | 통과 |
| Linux x86_64(GitHub `ubuntu-latest`), Node 20·22 | 기존 CI `test` 작업 | 통과 | 통과 |
| Windows(GitHub `windows-latest`), Node 22 | 이 PR에서 CI에 추가한 `os` 작업 | 최초 실행에서 5건과 1개 파일이 실패(아래 W1·W2). 수정 후 113건 중 112건 통과, 1건 건너뜀(POSIX chmod 단언, #17 R5 설계대로) | 조치 후 통과 |

### Windows 코드 리뷰와 CI 결과

| ID | 영역 | 관찰 | 판정 |
|---|---|---|---|
| W1 | 개행 | 저장소에 `.gitattributes`가 없었다. Windows Git의 기본값 `core.autocrlf=true`로 체크아웃하면 픽스처·`SKILL.md`·번들이 CRLF가 된다. CI에서 `CRLF·BOM 차이는 구성 해시를 바꾸지 않는다`(이미 CRLF인 파일에 다시 `\r`를 붙여 `\r\r\n`이 됨)와 `skill-metadata.test.mjs`(frontmatter 정규식 불일치) 실패를 확인했다. 플러그인을 git으로 설치하는 사용자도 같은 CRLF 파일을 받는다. 엔진은 사용자 파일과 자기 `SKILL.md`를 읽을 때 `\r\n`을 정규화하므로(collect.mjs `readFile`, 자기 Skill 판독) 분석 결과 자체는 영향이 없다 | 조치: `* text=auto eol=lf`, PNG는 binary로 지정 |
| W2 | 경로 구분자 | 세션 귀속의 경로 언급 판정(`mentionsRoot`)은 `/` 구분자 루트로만 찾았다. Windows의 도구 입력은 `C:\a\b` 형태라 매핑 없는 봇 세션이 프로젝트 경로를 언급해도 `auto`로 귀속되지 않고 미귀속으로 남았다. CI의 귀속 테스트 3건 실패로 확인했다 | 조치: 비교 전에 역슬래시를 `/`로 바꾼다(값은 저장하지 않는 기존 원칙 유지) |
| W3 | `render --open` | `spawn('cmd', ['/c','start','""',url])`는 libuv 인용 규칙 때문에 `""`가 `"\"\""`로 전달되어 `start`가 제목으로 받지 못하고, URL에 `&`가 있으면 cmd가 명령 구분자로 해석한다 | 조치: `cmd /d /s /c "start "" "<url>""`를 `windowsVerbatimArguments`로 전달. Windows CI에서 `start` 대신 `echo`로 같은 인용을 실제 cmd가 해석하는지 검사(`&` 포함 경로) |
| W4 | 실행 비트 | Windows에서는 Git Hook 실행 비트를 확인하지 않고 `git_hook_executable_unconfirmed` 한계를 남긴다(#17 R5). 엔진 번들은 `node <경로>`로 실행해 실행 비트가 필요 없다(모드 100644) | 통과(설계상 한계는 리포트에 표시) |
| W5 | 경로 표기 | 수집·표시·해시 경로는 `toPosix`·`path.posix`로 정규화한다. 루트 경계 검사는 `path.relative`(win32는 대소문자 무시)로 한다 | 통과(코드 리뷰, CI 통과) |
| W6 | 실제 Windows 세션 기록 | Claude Code가 Windows에서 남기는 `cwd`의 드라이브 문자 대소문자·UNC 경로 표기는 실데이터로 확인하지 못했다. 합성 기록으로만 검사했다 | 한계 |
| W7 | Windows 수동 실행 | Windows 실기기에서 Skill 설치→분석→브라우저 열기를 해 보지 않았다. CI 러너의 테스트로 대신했다 | 한계 |

## 2. 성능 예산(PRD §11.1)

| 예산 | 목표 | 관측 | 조건 | 판정 |
|---|---|---|---|---|
| 상시 컨텍스트 | 100토큰 이하 | 46토큰(추정) | `SKILL.md` name+description, 엔진 `always_loaded_tokens` | 통과 |
| 백그라운드 프로세스 | 0개 | 0. `plugin.json`에 hooks 없음, `hooks/` 디렉터리 없음, 번들에 네트워크 모듈 없음 | 번들의 유일한 자식 프로세스는 `render --open`의 OS 브라우저 열기(분리 실행 후 즉시 종료하는 `open`/`xdg-open`/`cmd start`)이며 상주하지 않는다 | 통과 |
| 엔진 메모리 | 200MiB 이하 | DiceForge 실데이터 최초 `prepare` 최대 RSS 156.3MiB(163,856,384B, `/usr/bin/time -l`과 엔진 자기 측정 일치) | 957파일·390,278줄·귀속 131세션, `--strict-budget` | 통과 |
| 엔진 메모리(합성 대용량) | 200MiB 이하 | macOS 최초 141.3MiB·증분 131.4MiB / 이벤트 72만: 최초 173.3MiB·증분 147.6MiB. Linux Node 22: 137.7·133.2 / 155.8·145.7MiB. Node 20: 134.1·121.2 / 151.4·137.4MiB | `performance.test.mjs` 12만 응답·약 166MB | 통과 |
| 재분석 실행 시간 | 5초 이내 | 합성 증분 재분석 macOS 270ms·293ms, Linux 318~369ms | `performance.test.mjs` | 통과 |
| 재분석 실행 시간(실데이터) | 5초 이내 | 측정하지 못했다. 증분 상태는 `finalize`에서 확정되고, `finalize`에는 LLM이 쓴 해석이 필요하다. 해석을 지어내 넣지 않았다. 참고로 최초 `prepare`는 3.53초(세션 집계 3.48초)이며 최초 분석은 5초 예산의 예외다 | DiceForge | 한계 |
| 압축 인벤토리 | 6,000토큰 이하 | 5,974토큰 | DiceForge, 세션 포함, `--strict-budget` 종료 0 | 통과(여유 26토큰) |
| 압축 인벤토리 여유 | — | 여유가 0.4%라 DiceForge 설정이나 세션 축이 조금만 늘어도 `--strict-budget`가 종료 60을 낼 수 있다. #17에서도 같은 입력이 6,437토큰으로 한 번 넘었다 | — | 한계(후속 압축 작업 필요) |
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
| `engine/src/sessions.mjs` | 경로 언급 판정에서 역슬래시 정규화 | Windows CI의 귀속 테스트 3건 |
| `engine/src/cli.mjs` | `browserCommand()` 분리, Windows 인용 수정 | `unit.test.mjs`(Windows에서는 실제 cmd 해석 검사) |
| `engine/src/report/client.mjs` | 표 최소 폭·keep-all | `report-client.test.mjs` |
| `.github/workflows/ci.yml` | `os` 작업: macos-latest·windows-latest × Node 22 | — |
| `skills/harness-analyze/scripts/harness-lens.mjs` | 번들 재생성 | `check-bundle` |

## 5. 남은 한계

- 실데이터 재분석 시간과 분석 1회 LLM 토큰은 LLM 해석이 있는 실제 분석에서만 측정된다(§2).
- 압축 인벤토리 여유가 26토큰으로 작다(§2).
- Windows는 CI 러너로만 확인했고 실제 세션 기록·브라우저 열기는 확인하지 못했다(W6·W7).
- 라이트 모드 `?` 표지 대비(§3)는 `style.mjs` 담당 작업으로 넘긴다.
