# 5단계 마무리 ①: PRD·PR #17 후속 검증

- 기준: main `7f1e8a5`(#9~#17 병합), 브랜치 `HyeonSeoMan/stage5-wrapup-1`.
- PRD v0.6: CI·Git hooks **설정**은 MVP 1, 실행 결과·PR 리뷰/검사 결과는 MVP 3으로 분리했다. Orca 봇 구성 수집은 후속으로 미루며 봇 세션 집계는 유지한다. 루브릭 0.4와 §6.1 무관 프로젝트 제외를 명시했다. 저장소 PRD와 `~/Documents/harness-lens/harness-lens-prd.md`를 동기화했다.
- N3: 셸 test·[ ]·[[ ]] 조건식은 명령 후보에서 제외한다. if·elif·while·until의 조건 명령과 then/do 뒤 실제 명령은 남기며, 명세 경로가 든 존재 조건만으로 SC 근거를 만들지 않는다. 기존 보수적 실패 표지 판정은 유지한다.
- N1: 압축은 5,400토큰의 여유 목표로 수행하며, 최종 실패 상한은 6,000토큰을 유지한다. 최종 단계에 근거의 첫 구성 요소 경로와 중복 read 출처 생략을 추가했다. 생략 표지·복원 규칙은 엔진 명세와 분석 프로토콜에 기재했다. 정식 인벤토리와 스냅샷은 그대로 보존한다.

## 검증

- `node --test tests/*.test.mjs`: 114/114 통과. 추가 조건문·명령 줄 귀속 테스트, 중복 경로 복원·출처 경계·결정론·원본 보존·추가 300토큰 수용 테스트 포함.
- `npm run check-bundle`: 통과.
- DiceForge 세션 포함 `prepare --strict-budget --now 2026-11-28T13:30:10Z`: 종료 0, **5,974 → 5,386토큰**, 여유 **26 → 614토큰**. 근거 ID·경로(복원 후) 및 실측 지표(기존 null/빈 배열 생략 규칙 적용 후)를 대조했다. 실제 인벤토리에 합성 300토큰 지표를 추가해도 5,700토큰이다.
- DiceForge pre-commit 조건문에서 생성되던 SC 근거가 사라졌다. SC·VG 구조 수준은 다른 Hook 근거로 각각 3이며 예측 상태를 유지한다. 점수·실측 대역 계산은 변경하지 않았다.
- 결과는 `/private/tmp/hl-wrapup-after`에만 기록했다. DiceForge 대상 파일 423개(`.git` 제외)의 크기·mtime가 실행 전후 동일하며 `.harness-lens`는 생성되지 않았다. Read Only는 합성 입력 회귀 테스트로도 확인한다.
- 입력이 계속 커지면 목표 여유를 확보하지 못할 수 있다. 최종 결과가 6,000토큰을 넘으면 기존 strict-budget 실패를 유지한다.

CI 결과는 PR의 검사 상태를 참조한다.

## Claude 검수 반영

- 차단 수정: `if ! npm test; then exit 1; fi`, `while read f; do eslint "$f"; done`, CI `run: if [ -f package.json ]; then npm test; fi`에서 VG-L2-04를 유지하고 `if ! node scripts/check-task-spec.mjs; then exit 1; fi`에서 SC-L2-04를 유지한다. 조건문 전체를 제외하던 구현은 철회했다. 명세 파일 조건식의 오탐, 복합 조건식, 따옴표 안 표시 문자열도 회귀 테스트로 고정했다.
- 권고 ①: 무손실 경로·이름·출처·축 근거 ID 생략을 fact 축소 앞으로 옮겼다. 5,400~6,000토큰 입력에서 fact를 전부 보존한 채 여유 목표 안에 드는 회귀 테스트를 추가했다.
- 권고 ②·③: 실제 생략한 출처만 `compaction.readSourceRefs`에 인덱스 쌍으로 기록한다. 이 목록으로 복원한 read 출처도 원문 읽기 허용 목록에 포함한다. 참조가 없는 가상 `plugin|harness-lens/SKILL.md` 경로는 복원·읽기 대상이 아니다. 실제 DiceForge 출처 전체와 근거 경로의 복원 일치를 확인했다.
- 권고 ④: 루브릭 0.4 본문에 명령 영역 조건을 명시하고 §4.1에 2026-11-28 구현 정정 기록을 추가했다. 기존 명령 영역의 오탐·미탐 구현 결함을 고치는 것이므로 어휘·규칙 ID·루브릭 버전은 유지했다.
- 재검증: 테스트 **116/116**, 번들 일치 통과. DiceForge 세션 포함 strict-budget 종료 0, **5,417토큰(여유 583)**. `.git` 포함 대상 파일 **1,772개**의 크기·mtime 동일, 대상 git status 깨끗함, `.harness-lens` 생성 없음. 결과는 `/private/tmp/hl-wrapup-revision`에만 기록했다. 위 5,386토큰은 최초 검증 당시 수치다.
