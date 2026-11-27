# Harness Lens

AI 코딩 에이전트 하네스(Hooks, Skills, MCP, Subagents 등)의 구성과 변경을 읽기 전용으로 분석해, 기대 효과와 잠재적 손실을 근거와 함께 로컬 HTML 리포트로 보여주는 오픈소스 Agent Skill이다. 최적화 방향은 사람이 결정하고, Harness Lens는 판단 근거를 제공한다.

## 상태

**pre-alpha.** 저장소 뼈대만 있으며 분석 엔진과 Skill 절차는 아직 구현되지 않았다. 설치해도 분석은 동작하지 않는다.

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
| `engine/` | 엔진 소스 (Node.js 20 이상, ESM, 런타임 의존성 없음) |
| `tests/`, `examples/` | 테스트와 예시. `node --test tests/*.test.mjs`로 실행한다(의존성 없음) |

## 라이선스

미정. 출시 전에 확정하며, 그때까지 `LICENSE` 파일은 없다.
