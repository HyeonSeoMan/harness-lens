#!/usr/bin/env bash
# 위험한 Bash 명령을 실행 전에 막는다. stdin으로 받은 도구 입력 JSON에서 명령만 본다.
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
case "$cmd" in
  *"git push --force"*|*"git push -f"*|*"curl "*"| sh"*)
    echo "blocked: $cmd" >&2
    exit 2
    ;;
esac
exit 0
