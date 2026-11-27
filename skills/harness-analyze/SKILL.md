---
name: harness-analyze
description: 하네스 구성(Hooks·Skills·MCP·Agents)을 읽기 전용으로 분석해 트레이드오프 리포트를 만든다. "내 하네스 분석해줘" 요청에 사용.
---

# Harness Analyze

> 상태: pre-alpha. 분석 규격(v0.1)만 있고 엔진은 아직 구현되지 않았다.

1. 이 파일과 같은 디렉터리에 `scripts/harness-lens.mjs`가 없으면, 아직 분석할 수 없다고 한 줄로 알리고 종료한다. 파일을 읽거나 바꾸지 않는다.
2. 있으면 `references/analysis-protocol.md`를 읽고 그 절차를 처음부터 끝까지 따른다.
