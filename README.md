# Harness Lens

AI 코딩 에이전트 하네스(Hooks, Skills, MCP, Subagents 등)의 구성과 변경을 읽기 전용으로 분석해, 기대 효과와 잠재적 손실을 근거와 함께 로컬 HTML 리포트로 보여주는 오픈소스 Agent Skill이다. 최적화 방향은 사람이 결정하고, Harness Lens는 판단 근거를 제공한다.

## 상태

**alpha (엔진 v0.1.0).** 정적 구성 분석, 스냅샷 비교, 오프라인 HTML 리포트까지 동작한다. 세션 기록 실측 집계(FR-10)는 아직 없어 모든 축이 구성 기반 예측으로 표시된다.

리포트 예시(`examples/fixtures/harness-before` → `harness-after`): [첫 분석](./docs/screenshots/report-before.png) · [재분석과 변경 비교](./docs/screenshots/report-after.png) · [다크 모드](./docs/screenshots/report-after-dark.png)

## 엔진 직접 실행

Node.js 20 이상이 필요하다. 런타임 의존성은 없다. 보통은 Skill이 아래 순서로 호출한다.

```sh
E=skills/harness-analyze/scripts/harness-lens.mjs
node $E prepare --project <프로젝트> --json     # 수집·수준 계산·비교 → runs/<runId>/
# LLM이 runs/<runId>/interpretation.json 작성 (예시: examples/interpretations/)
node $E finalize --project <프로젝트> --run <runId> --json   # 검증 → 스냅샷 → report.html
```

결과는 `<프로젝트>/.harness-lens/`에만 쓴다(첫 실행 시 `.gitignore`로 Git 추적 제외). 분석 대상 파일은 읽기만 하고 Hook·MCP 서버는 실행하지 않는다.

## 문서

- 제품 요구사항: [harness-lens-prd.md](./harness-lens-prd.md)
- MVP 1 명세(v0.1)
  - 결과 스키마: [skills/harness-analyze/schemas/analysis.schema.json](./skills/harness-analyze/schemas/analysis.schema.json) (예시: [examples/analysis.example.json](./examples/analysis.example.json))
  - 평가 루브릭: [skills/harness-analyze/references/evaluation-rubric.md](./skills/harness-analyze/references/evaluation-rubric.md)
  - 분석 프로토콜: [skills/harness-analyze/references/analysis-protocol.md](./skills/harness-analyze/references/analysis-protocol.md)
  - 엔진 CLI: [docs/spec/engine-cli.md](./docs/spec/engine-cli.md)
- 기여 안내: [CONTRIBUTING.md](./CONTRIBUTING.md)

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `.claude-plugin/` | Claude Code 플러그인·마켓플레이스 메타데이터 |
| `skills/harness-analyze/` | 배포 단위 Skill. 엔진 번들(`scripts/`), 스키마, 참고 문서, 리포트 템플릿 포함 |
| `engine/` | 엔진 소스 (Node.js 20 이상, ESM, 런타임 의존성 없음). `npm run build`로 `skills/harness-analyze/scripts/harness-lens.mjs` 단일 번들을 만든다(esbuild, 개발 의존성) |
| `tests/` | `node --test tests/*.test.mjs`로 실행한다(의존성 없음). 커밋된 번들을 실행하는 e2e·결정론·보안·검증·성능 예산 테스트 |
| `examples/` | 픽스처(`fixtures/`: before·after·비밀정보·악성 지시문), 예시 해석(`interpretations/`), 스키마 예시 |

## 라이선스

미정. 출시 전에 확정하며, 그때까지 `LICENSE` 파일은 없다.
