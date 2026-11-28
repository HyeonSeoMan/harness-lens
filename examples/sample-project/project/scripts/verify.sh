#!/usr/bin/env bash
# 검증 명령 모음: 타입 검사 → 린트 → 테스트. 하나라도 실패하면 0이 아닌 값으로 끝난다.
set -euo pipefail
npm run typecheck
npm run lint
npm test
