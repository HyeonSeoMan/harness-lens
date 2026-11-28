#!/usr/bin/env bash
# 작업을 끝내기 전에 타입 검사·린트·테스트를 돌린다(scripts/verify.sh와 같은 순서).
# 실패하면 종료를 막고(exit 2) 로그 끝부분을 Claude에게 돌려준다.
input="$(cat)"
# 이미 Stop Hook으로 이어진 턴이면 다시 막지 않는다(무한 반복 방지).
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then
  exit 0
fi
log="$(mktemp)"
if ! { npm run typecheck && npm run lint && npm test; } >"$log" 2>&1; then
  tail -n 30 "$log" >&2
  exit 2
fi
exit 0
