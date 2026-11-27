import { writeSync } from "node:fs";

export async function readInput() {
  return JSON.parse(await new Response(process.stdin).text());
}

/** JSON 출력(exit 0). */
export function emit(obj) {
  writeSync(1, JSON.stringify(obj) + "\n");
}

/** exit 2: 차단하고 사유를 모델에게 돌려준다. */
export function block(msg) {
  writeSync(2, msg + "\n");
  process.exit(2);
}
