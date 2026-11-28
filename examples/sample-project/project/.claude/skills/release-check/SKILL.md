---
name: release-check
description: 릴리스 전에 CHANGELOG·버전·검증 결과를 점검한다. "릴리스 준비", "버전 올려줘" 요청에 쓴다.
---

# release-check

1. `CHANGELOG.md`에 이번 버전 항목이 있는지 확인한다.
2. `package.json`의 `version`이 CHANGELOG 최상단 버전과 같은지 확인한다.
3. `./scripts/verify.sh`를 실행하고 결과를 요약한다.
4. 어긋나는 항목이 있으면 고치지 말고 목록으로 보고한다.
