#!/usr/bin/env bash
# PreToolUse(Write): 보호 경로 쓰기를 공용 헬퍼로 막는다.
source "$CLAUDE_PROJECT_DIR/.claude/hooks/common.sh"
input=$(cat)
case "$input" in
  *'"file_path":"/etc/'*) deny "보호 경로입니다." ;;
esac
