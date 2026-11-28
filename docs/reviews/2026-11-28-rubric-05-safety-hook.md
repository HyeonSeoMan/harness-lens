# 루브릭 0.5: DiceForge 보호 Hook 재평가

- 오너 결정 ⑤, 2회차 리뷰 N10의 후속이다. 기준 main은 `3dea5b3`(#24), DiceForge HEAD는 `9b35cfa`다.
- 대상 `~/Documents/DiceForge`는 읽기만 했다. 엔진 `prepare --no-sessions --project … --out /tmp/hl-rubric05-before`와 변경 후 `--out /tmp/hl-rubric05-after`로 세션·기존 분석 결과를 건드리지 않고 구성 수준만 계산했다. Hook·프로젝트 코드·Git Hook은 실행하지 않았다.
- 전후 `configurationHash`는 모두 `sha256:0ab0c1ca2944ec5eb3a0a3b6e35550d6c962f21801ded4f783c8ca0c87b14a0c`이며 대상 저장소 `git status --porcelain`은 전후 빈 출력이다.

| 축 | 변경 전(0.4) | 변경 후(0.5) | 결정 규칙 |
|---|---:|---:|---|
| 명세 명확성(SC) | 3 | 3 | SC-L3-01 유지 |
| 검증 게이트 강도(VG) | 3 | 3 | VG-L3-01 유지 |
| 실행 안정성(ES) | 3 | 3 | ES-L3-01 유지 |
| 처리 속도(TP) | 0 | 0 | TP-L0-00 유지 |
| 비용 효율(CE) | 0 | 0 | CE-L0-00 유지 |
| 컨텍스트 효율(CX) | 2 | 2 | CX-L2-01 유지 |
| 자율성(AU) | 0 | 0 | AU-L0-00 유지 |
| 안전 경계(SB) | 1 | 2 | SB-L1-01 → SB-L2-04 |

PreToolUse의 matcher는 `Bash|Write|Edit|MultiEdit|NotebookEdit`다. 스크립트는 `file_path`·`notebook_path`를 읽고, 보호 디렉터리 포함 여부를 검사한 분기에서 1단계 import의 차단 export를 호출한다. 같은 Hook의 SC 근거를 유지하면서 SB 보호 사실 `ev_ca83da9f8aa0`을 추가했다(componentId `c_0ce71c024d0e`, keyPath `/hooks/PreToolUse/0/hooks/0`).

새 SB fact는 보호 유형 `protected_path`, 정적 패턴 확인, 도구 호출 한정, 설정 해제·다른 실행 경로 우회 가능, 실행 검증이 아니라는 한계를 남긴다. 위험 git의 위임 함수 전체를 해석하거나 실제 차단 성공을 입증한 결과는 아니다. DiceForge의 Task 범위 경고만 하는 분기는 SB 보호 사실로 쓰지 않았다.

두 초안을 `diffAnalyses`로 비교하면 구성 변경은 0개, `comparability: limited`, 8개 축 모두 `comparable: false`, `reason: rubric_version_changed`다. 표의 수치는 동일 구성을 새 기준으로 재평가한 구조 수준이며 임의 점수나 구성 개선량이 아니다.

검증: 전체 Node 테스트, 번들 일치 검사, 합성 샘플 프로젝트의 두 번 분석·finalize를 수행했다. 회귀 테스트에는 SC·SB 별도 근거와 단일 귀속 검사, matcher 불일치, 선언만 존재, 경고만, 무력화, 분기 밖·else 차단, 문자열 출력·주석, 위험 git 셸 case, import 별칭 차단과 0.4 → 0.5 비교 제한이 포함된다.
