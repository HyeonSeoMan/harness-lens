// 엔진 진입점. 번들에서는 build.mjs의 배너가 이보다 먼저 Node 버전을 확인한다.
import { main } from './cli.mjs';

process.exitCode = main(process.argv.slice(2));
