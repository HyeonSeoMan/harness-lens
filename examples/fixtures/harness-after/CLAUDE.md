# sample-app

결제 대시보드 웹 앱이다. TypeScript + React, 패키지 매니저는 npm.

## 완료 정의

- 변경마다 관련 요구사항과 수용 기준을 PR 설명에 적는다.
- 코딩 규약은 @docs/conventions.md 를 따른다.

## 작업 규칙

- 변경 후 `npm test`로 테스트를 실행하고 결과를 보고한다.
- 큰 탐색은 explorer 서브에이전트로 위임해 컨텍스트를 아낀다.
- PR을 올리기 전에 reviewer 서브에이전트로 diff 리뷰를 받는다.
- 실패하면 원인을 적고 같은 명령을 세 번 넘게 재시도하지 않는다.

## 금지

- .env 파일과 비밀 값을 읽거나 커밋하지 않는다.
- main 브랜치에 force push 하지 않는다.
