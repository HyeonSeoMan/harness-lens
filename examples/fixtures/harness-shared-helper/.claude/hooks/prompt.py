# UserPromptSubmit: 비밀값처럼 보이는 입력을 막는다.
import json
import re
import sys

data = json.load(sys.stdin)
if re.search(r"AKIA[0-9A-Z]{16}", data.get("prompt", "")):
    print("비밀값으로 보이는 문자열이 있습니다.", file=sys.stderr)
    sys.exit(2)
