// PreToolUse(Bash): 위험한 명령을 공용 헬퍼로 막는다.
import { readInput, block } from "./lib.mjs";

const input = await readInput();
if (String(input.tool_input?.command ?? "").includes("push --force")) block("강제 푸시는 막습니다.");
process.exit(0);
