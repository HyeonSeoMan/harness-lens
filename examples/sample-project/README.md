# 샘플 프로젝트: todo-api (합성 데이터)

> **이 폴더의 모든 내용은 합성 데이터다.** 가상의 프로젝트와 고정 시드로 만든 가짜 세션 기록이며, 실제 사용자의 설정·대화·코드·경로·사람 이름이 들어 있지 않다.

README의 리포트 스크린샷(`docs/images/sample-report-*.png`)을 만드는 데 쓴다. 엔진을 실제로 돌려 나온 리포트를 찍은 것이다.

## 구성

| 경로 | 내용 |
|---|---|
| `project/` | 분석 대상 가상 하네스(현재 구성). `CLAUDE.md`, `.claude/settings.json`(권한 규칙 + Hook 2개), `.claude/hooks/guard-bash.sh`(PreToolUse 차단), `.claude/hooks/verify-on-stop.sh`(Stop 검증, 재진입 방지), `.claude/skills/release-check/`(Skill 1개), `scripts/verify.sh`(검증 명령 모음) |
| `interpretations/` | 해석 두 개. `first.json`(첫 분석), `second.json`(재분석). LLM 대신 직접 쓴 예시 해석이다 |
| `build-report.mjs` | 합성 세션 기록을 만들고 엔진을 두 번 돌려 `report.html`을 만든다 |
| `screenshot.mjs` | 헤드리스 Chrome으로 리포트를 찍어 `docs/images/`에 저장한다(라이트·다크 1200px, 390px) |

## 시나리오

1. **첫 분석(2026-10-31)**: Stop 검증 Hook이 없던 구성(`build-report.mjs`가 `project/`에서 Stop Hook과 그 스크립트를 빼서 만든다)과 10월 합성 세션 24개.
2. **재분석(2026-11-27)**: `project/` 그대로(Stop Hook 추가)와 11월 합성 세션 24개. 엔진이 직전 스냅샷과 비교해 변경 내역·변경 트레이드오프를 붙인다.

합성 세션은 Stop Hook이 생긴 뒤 턴이 길어지고 가끔 종료가 막히도록(`hook_blocking_error`) 만들었다. 그래서 리포트에는 검증 게이트·실행 안정성 2→3과 처리 속도 실측 대역 2→1이 함께 나온다. 이 수치는 시연용으로 설계한 값이며 실제 효과를 보여주는 측정이 아니다.

## 다시 만들기

저장소 루트에서(`build-report.mjs`는 Node.js 20 이상, `screenshot.mjs`는 Node.js 22 이상과 Chrome 필요):

```sh
node examples/sample-project/build-report.mjs --work <빈 작업 디렉터리>   # → <작업 디렉터리>/out/report.html
node examples/sample-project/screenshot.mjs <작업 디렉터리>/out/report.html # → docs/images/sample-report-*.png
```

- `--work`를 빼면 OS 임시 디렉터리에 만든다. 세션 기록은 그 안의 `claude-config/`에만 쓰고 `CLAUDE_CONFIG_DIR`로 엔진에 넘기므로 실행하는 컴퓨터의 `~/.claude`를 읽지 않는다.
- Chrome 경로는 `--chrome <경로>` 또는 `CHROME` 환경 변수로 바꾼다(기본값은 macOS 경로).
- 리포트는 실행할 때마다 엔진 자기 측정값(시간·메모리)만 달라진다.
- 엔진 출력의 구성 요소·근거 ID가 바뀌면 `interpretations/`의 참조도 고쳐야 한다. 해석 파일이 없으면 `build-report.mjs`가 `prepare` 결과 경로를 알려주고 멈춘다.
