// PostToolUse(Edit): 린트 결과를 안내만 한다(차단 아님). 같은 헬퍼에서 emit만 쓴다.
import { readInput, emit } from "./lib.mjs";

const input = await readInput();
emit({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `eslint ${input.tool_input?.file_path ?? ""}` } });
