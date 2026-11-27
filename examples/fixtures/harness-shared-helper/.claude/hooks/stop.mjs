// Stop: 테스트가 실패하면 종료를 막는다. JS 객체라 키에 따옴표가 없다.
import { execFileSync } from "node:child_process";
import { emit } from "./lib.mjs";

try {
  execFileSync("npm", ["test"], { stdio: "ignore" });
} catch {
  emit({ decision: "block", reason: "테스트가 실패했습니다." });
}
