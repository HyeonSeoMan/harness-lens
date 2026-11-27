#!/usr/bin/env bash
# 파일을 고친 뒤 테스트를 돌리고, 실패하면 결과를 Claude에게 돌려준다.
if ! npm test --silent >/tmp/sample-app-test.log 2>&1; then
  tail -n 30 /tmp/sample-app-test.log >&2
  exit 2
fi
exit 0
