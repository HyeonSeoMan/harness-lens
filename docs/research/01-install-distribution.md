# 조사 ① 설치·배포 (Claude Code 플러그인 · Agent Skills · `npx skills`)

- 작성일: 2026-11-27
- 대상 PRD: `harness-lens-prd.md` v0.2 — 5장(사용자 경험), FR-01(설치·배포), 9.1(제안 저장소 구조), 관련 11.1·14.1·14.2
- 확인일: 아래 출처는 모두 **2026-11-27**에 확인했다. 이후 문서가 바뀌었을 수 있다.
- 실측 환경: macOS(Darwin 27.2), Node.js v22.22.1, npm 10.9.4, Claude Code 2.1.309, `skills` CLI 1.9.0(npm, 2026-11-16 배포)
- 표기: **[문서]** 공식 문서에 적힌 내용, **[실측]** 이번에 직접 실행해 확인한 내용, **[추론]** 문서·실측에서 도출한 판단

## 요약

1. PRD가 가정한 배포 구조(루트 `.claude-plugin/` + `skills/harness-analyze/` 안에 엔진 번들)는 두 채널 모두에서 그대로 동작한다. 로컬 픽스처로 `claude plugin validate`·설치와 `npx skills add`를 모두 통과했다. [실측]
2. **PRD가 틀린 점 1:** `npx skills` CLI는 **Node.js 22.20 이상**을 요구한다. PRD는 Node 20 이상을 전제로 하고, 그 근거로 `npx skills add`도 Node를 전제한다는 점을 든다(14.1). [문서]
3. **PRD가 틀린 점 2:** `npx skills add`는 같은 이름의 기존 스킬 폴더를 **통째로 교체**한다. `-y`를 주면 확인도 하지 않는다. 따라서 "기존 파일을 덮어쓰지 않는다/충돌 시 보존"(5장 1단계, FR-01)을 채널에 맡길 수 없다. [실측]
4. 스킬 폴더 안의 스크립트는 두 채널 모두에서 내용과 실행 권한(100755)이 함께 보존된다. 다만 Windows와 다른 에이전트를 고려하면 `node <경로>`로 호출하는 것이 안전하다. [실측/추론]
5. 평소 컨텍스트에는 Skill의 이름과 설명만 올라간다. 픽스처의 상시 비용은 `claude plugin details` 기준 약 25토큰이었다. 11.1의 "약 100토큰 이하"는 설명을 짧게 유지하면 달성할 수 있다. [문서/실측]

---

## 1. Claude Code 플러그인 + 마켓플레이스

### 1.1 파일 배치

| 항목 | 내용 | 출처 |
|---|---|---|
| 매니페스트 위치 | `.claude-plugin/plugin.json`. **선택 사항**이다. 없으면 표준 레이아웃에서 컴포넌트를 찾고, 이름은 마켓플레이스 항목에서 가져온다. `skills/`, `commands/`, `hooks/` 등은 `.claude-plugin/` 안이 아니라 플러그인 루트에 둔다 | [manifest-reference#manifest-file](https://code.claude.com/docs/en/plugins/manifest-reference.md) |
| Skill 기본 위치 | `skills/<name>/SKILL.md`. `skills` 키로 경로를 추가할 수 있고, 지정한 경로는 기본 `skills/` 스캔에 더해진다 | [manifest-reference#standard-layout](https://code.claude.com/docs/en/plugins/manifest-reference.md) |
| 기타 기본 위치 | `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `bin/`(Bash 도구 PATH에 추가됨) 등 | 같은 문서 |
| 루트 `CLAUDE.md` | 플러그인 루트의 `CLAUDE.md`는 컨텍스트로 로드되지 않고, validate가 경고한다 | 같은 문서 |
| 마켓플레이스 파일 | `.claude-plugin/marketplace.json`. 상대 경로 `source`는 `.claude-plugin/`이 아니라 **마켓플레이스 루트**(`.claude-plugin/`을 포함하는 디렉터리) 기준이다. `..`는 쓸 수 없다 | [marketplace-reference#marketplace-file](https://code.claude.com/docs/en/plugins/marketplace-reference.md), [create-marketplace](https://code.claude.com/docs/en/plugin-marketplaces.md) |

### 1.2 `plugin.json` 필드 (요약)

- 필수 필드는 `name` 하나다. 공백, `@`, `:`, 경로 구분자를 쓸 수 없고 kebab-case를 권장한다. 모든 컴포넌트가 이 이름 아래로 네임스페이스된다. [문서: [manifest-reference#fields](https://code.claude.com/docs/en/plugins/manifest-reference.md)]
- `claude-`, `anthropic-` 등으로 시작하는 이름은 예약어라 오류가 난다. `harness-lens`는 해당하지 않는다. [문서: 같은 문서 `name` 절]
- 자주 쓰는 선택 필드: `version`, `description`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords`, `skills`, `defaultEnabled`(기본 true), `engines.claude-code`(v2.1.323+ 필요. v2.0.15~v2.1.75에서는 이 필드가 있으면 매니페스트가 거부된다). [문서: 같은 문서]
- 인식하지 못하는 최상위 필드는 제거된 채로 로드되고 validate가 경고한다. [문서: 같은 문서 `Unrecognized fields`]
- **`version`의 효과:** 값을 지정하면 그 문자열이 바뀌기 전까지 사용자는 캐시된 버전에 머문다. 생략하면 GitHub 소스는 커밋 SHA 12자리를, Git 호스팅 마켓플레이스 안의 상대 경로 플러그인은 해당 디렉터리의 커밋 SHA를 버전으로 쓴다. [문서: [loading#how-claude-code-computes-the-version](https://code.claude.com/docs/en/plugins/loading.md)] [실측: `anthropics/skills` 설치 시 캐시 경로가 `.../document-skills/e4bb5d960d87/`였다]

### 1.3 `marketplace.json` 필드 (요약)

- 최상위 필수 필드는 `name`, `owner{name}`, `plugins[]`다. `description`이 없으면 validate가 경고한다. 사용자 한 명은 같은 `name`의 마켓플레이스를 하나만 등록할 수 있다. [문서: [marketplace-reference#top-level-fields](https://code.claude.com/docs/en/plugins/marketplace-reference.md)]
- 플러그인 항목의 필수 필드는 `name`, `source`다. 이 `name`이 설치 ID(`<entry-name>@<marketplace>`)가 된다. 소스 유형은 상대 경로, `github`, `url`, `git-subdir`, `npm`, `archive`, `command`가 있다. `"."` 또는 `"./"`는 마켓플레이스 루트 자체를 뜻한다. [문서: 같은 문서 `Plugin entries`, `Plugin sources`]
- 항목의 `name`과 `plugin.json`의 `name`을 같게 유지하라고 권장한다. 항목 이름은 설치 ID에 쓰이고, 매니페스트 이름은 스킬 접두어에 쓰인다. [문서: [create-marketplace#keep-the-entry-name-and-the-manifest-name-the-same](https://code.claude.com/docs/en/plugin-marketplaces.md)]
- [실측] 한 저장소가 플러그인이자 마켓플레이스인 PRD 9.1 구조를 픽스처로 만들어 확인했다(`marketplace.json`의 항목은 `"source": "./"`). `claude plugin validate .` → `✔ Validation passed`, 이어서 marketplace add, install, details까지 성공했다.

```json
// .claude-plugin/marketplace.json (실측에 쓴 최소형)
{"name":"harness-lens","owner":{"name":"…"},"description":"…",
 "plugins":[{"name":"harness-lens","source":"./","description":"…"}]}
```

- [실측/문서] `source: "./"`이면 **저장소 전체**(`.git` 제외)가 `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`으로 복사된다. 실측 캐시에는 `engine/`, `README.md` 등도 들어 있었다. 플러그인 디렉터리 바깥 파일은 복사되지 않으므로 런타임에 `../` 경로를 읽으면 안 된다. [문서: [loading#in-place-and-copied-plugins](https://code.claude.com/docs/en/plugins/loading.md)]

### 1.4 설치·업데이트·제거 명령

| 작업 | 세션 안 | 셸 | 출처 |
|---|---|---|---|
| 마켓플레이스 추가 | `/plugin marketplace add <owner>/<repo>` (`#ref`로 고정 가능) | `claude plugin marketplace add <owner>/<repo>` | [install#add-a-marketplace](https://code.claude.com/docs/en/plugins/install.md) |
| 설치 | `/plugin install <plugin>@<marketplace>` (상세 패널에서 범위 선택) | `claude plugin install <plugin>@<marketplace> [--scope user\|project\|local]` | 같은 문서 `Install from your shell` |
| 추가+설치 한 번에 | `/plugin install <plugin> --marketplace <owner>/<repo>` (v2.1.275+) | `claude plugin install <plugin> --marketplace <owner>/<repo>` (v2.1.292+) | 같은 문서 `Add a marketplace and install in one command` |
| 업데이트 | `/plugin` → Installed → Update now | `claude plugin update <plugin>@<marketplace>` | 같은 문서 `Update plugins now`, [cli-reference#plugin-update](https://code.claude.com/docs/en/plugins/cli-reference.md) |
| 목록 갱신만 | `/plugin marketplace update <name>` | `claude plugin marketplace update [name]`. 설치된 플러그인 버전은 바꾸지 않는다 | install 문서 `Update plugins now` |
| 비활성/활성 | `/plugin disable`·`enable` | `claude plugin disable`·`enable <id>` | install 문서 `Manage plugins from your shell` |
| 제거 | `/plugin uninstall` | `claude plugin uninstall <plugin>[@mkt] [--scope …] [--keep-data]` (별칭 `remove`, `rm`) | [cli-reference#plugin-uninstall](https://code.claude.com/docs/en/plugins/cli-reference.md) |
| 마켓플레이스 제거 | `/plugin marketplace remove <name>` | `claude plugin marketplace remove <name>`. 그 마켓플레이스에서 설치한 플러그인도 모두 제거된다 | install 문서 `Manage marketplaces` |
| 변경 적용 | `/reload-plugins` 또는 재시작 | — | install 문서 |

- **자동 업데이트:** 공식 마켓플레이스만 기본으로 켜져 있다. 서드파티 마켓플레이스(Harness Lens가 여기에 해당)는 **기본으로 꺼져 있다.** 사용자가 `/plugin` → Marketplaces 탭에서 켜야 한다. [문서: [install#keep-plugins-updated](https://code.claude.com/docs/en/plugins/install.md)]
- **제거 시 삭제되는 것:** 마지막 범위에서 제거하면 플러그인 옵션·비밀값과 `~/.claude/plugins/data/<id>/`(`${CLAUDE_PLUGIN_DATA}`)가 삭제된다. `--keep-data`를 주면 데이터 디렉터리는 남는다. 이전 버전 캐시는 `.orphaned_at` 표시 후 14일 뒤 정리된다. [문서: [cli-reference#what-an-uninstall-deletes-and-keeps](https://code.claude.com/docs/en/plugins/cli-reference.md), [loading#cleanup-of-previous-versions](https://code.claude.com/docs/en/plugins/loading.md)] → 스냅샷을 프로젝트의 `.harness-lens/`에 두기로 한 PRD 결정은 이 동작과 맞는다. `${CLAUDE_PLUGIN_DATA}`에 저장하면 제거할 때 사라진다.
- [실측] `claude plugin uninstall harness-lens@harness-lens` → `✔ Successfully uninstalled plugin`. `claude plugin update document-skills@anthropic-agent-skills` → `already at the latest version (e4bb5d960d87)`.

### 1.5 프로젝트 범위와 사용자 범위

| 범위 | 기록 위치 | 의미 | 출처 |
|---|---|---|---|
| user (셸 설치의 기본값) | `~/.claude/settings.json`의 `enabledPlugins` | 이 기기의 모든 프로젝트 | [install#choose-an-install-scope](https://code.claude.com/docs/en/plugins/install.md) |
| project | 저장소의 `.claude/settings.json`(커밋 대상) | 협업자에게도 활성화되지만 **다운로드는 하지 않는다.** 각자 클론마다 `claude plugin install … --scope project`를 한 번 실행해야 한다 | 같은 문서 |
| local | `.claude/settings.local.json` | 이 저장소의 나에게만 적용 | 같은 문서 |

- 우선순위는 local > project > user다. [문서: 같은 문서]
- 마켓플레이스 등록은 `--scope project`로 설치해도 **사용자 설정**(`extraKnownMarketplaces`)에 기록된다. [문서: install 문서 `Add and install from your shell`] [실측: 격리된 HOME의 `~/.claude/settings.json`에 `enabledPlugins`와 `extraKnownMarketplaces`가 기록되었다]
- [추론] project·local 범위 설치는 분석 대상 저장소의 `.claude/settings*.json`을 Claude Code가 직접 수정한다. 덮어쓰지 않고 키를 병합하지만, PRD의 "기존 파일을 덮어쓰지 않는다"는 표현과는 구분해서 설명해야 한다.

### 1.6 플러그인 Skill의 네임스페이스와 호출

- 플러그인 Skill은 `/<plugin-name>:<skill-name>`으로 호출한다. 마지막 세그먼트는 frontmatter `name`, 없으면 디렉터리 이름이다. 다른 명령과 충돌하지 않으면 bare `/<skill-name>`으로도 호출된다. [문서: [skills#how-a-skill-gets-its-command-name](https://code.claude.com/docs/en/skills.md)]
- 같은 이름의 개인/프로젝트 스킬과 플러그인 스킬은 네임스페이스가 달라 **둘 다 로드된다.** [문서: [skills#resolve-skills-that-share-a-name](https://code.claude.com/docs/en/skills.md)]
- 기본 설정에서는 사용자와 Claude 모두 호출할 수 있다. 자연어 요청에 맞으면 Claude가 자동으로 로드한다. `disable-model-invocation: true`이면 설명이 컨텍스트에서 빠지고 자동 호출도 막힌다. [문서: [skills#control-who-invokes-a-skill](https://code.claude.com/docs/en/skills.md)]
- [실측] 픽스처 `claude plugin details harness-lens` → `Skills (1) harness-analyze`. 따라서 명시적 호출은 `/harness-lens:harness-analyze`이고, PRD 5장 표기와 일치한다.

### 1.7 기본으로 컨텍스트에 로드되는 Skill 메타데이터

- 일반 세션에서는 **Skill 이름과 설명만** 컨텍스트에 들어가고, 본문은 호출할 때 로드된다. [문서: [skills#control-who-invokes-a-skill](https://code.claude.com/docs/en/skills.md) NOTE]
- 항목별 상한: `description`과 `when_to_use`를 합쳐 **1,536자**에서 잘린다(`skillListingMaxDescChars`로 변경 가능). 전체 목록 예산은 **모델 컨텍스트 창의 1%**이고(`skillListingBudgetFraction`), 넘치면 덜 쓰는 스킬의 설명부터 뺀다. [문서: [skills#frontmatter-reference](https://code.claude.com/docs/en/skills.md), [skills#skill-descriptions-are-cut-short](https://code.claude.com/docs/en/skills.md)]
- 호출된 본문은 대화에 남는다. 자동 압축 후에는 스킬당 처음 5,000토큰, 전체 25,000토큰 한도 안에서 다시 붙는다. [문서: [skills#skill-content-lifecycle](https://code.claude.com/docs/en/skills.md)]
- 표준 스펙도 같은 점진적 공개를 권장한다. 메타데이터는 약 100토큰, 본문은 5,000토큰 미만과 500줄 미만을 권장한다. [문서: [agentskills.io/specification#progressive-disclosure](https://agentskills.io/specification)]
- Codex: 처음 보여주는 스킬 목록에 이름·설명·파일 경로가 들어간다. 기본적으로 컨텍스트의 2%(알 수 없으면 8,000자)까지 쓴다. [문서: [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)]
- [실측] `claude plugin details`에서 픽스처(설명 73자)의 Always-on은 약 25토큰, Skill 항목은 약 30토큰으로 표시되었다. `install`의 `See what an installed plugin adds` 절에 따르면 이 수치가 세션마다 추가되는 토큰이다. 비교로 `document-skills`(스킬 4개)는 약 759토큰이었다.

## 2. Agent Skills 표준 (agentskills.io)

- Skill은 `SKILL.md`를 포함한 디렉터리다. 관례상 `scripts/`(실행 코드), `references/`, `assets/`를 두며 그 밖의 파일도 허용된다. [문서: [agentskills.io/specification#directory-structure](https://agentskills.io/specification)]
- 필수 frontmatter
  - `name`: 1~64자. 소문자·숫자·하이픈만 쓰고, 하이픈으로 시작하거나 끝나거나 연속(`--`)될 수 없다. **상위 디렉터리 이름과 같아야 한다.**
  - `description`: 1~1,024자.
  - 선택 필드: `license`, `compatibility`(≤500자), `metadata`(문자열 맵), `allowed-tools`(실험적).
  - 출처: [문서: 같은 문서 `Frontmatter`]
- `harness-analyze`는 이름 규칙을 만족한다. [추론]
- 파일 참조는 Skill 루트 기준 상대 경로로 쓰고, 한 단계 깊이까지만 두기를 권장한다. [문서: 같은 문서 `File references`]
- Claude Code는 스펙 외 필드(`when_to_use`, `disable-model-invocation` 등)도 받는다. claude.ai 업로드와 Skills API는 스펙의 6개 필드 외에는 하드 오류를 낸다. 교차 에이전트 배포를 하려면 frontmatter를 스펙 필드로 제한하는 것이 안전하다. [문서: [skills#using-skill-frontmatter-outside-claude-code](https://code.claude.com/docs/en/skills.md)]

## 3. `npx skills add` (vercel-labs/skills)

### 3.1 요구 사항과 기본 동작

- **Node.js 22.20 이상이 필요하다.** [문서: [vercel-labs/skills README](https://github.com/vercel-labs/skills#install-a-skill), 확인 커밋 `c220f92`]
- 기본 범위는 현재 프로젝트이고, `-g`를 주면 사용자 전역에 설치한다. 주요 옵션은 `-a/--agent`, `-s/--skill`, `--copy`, `-y`, `--all`, `--rename`, `-l`이다. [문서: [docs/commands.md#skills-add](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)]
- 설치 방식은 기본이 symlink(정본 1벌에 에이전트별 링크)이고 `--copy`를 고를 수 있다. [문서: 같은 문서 `Installation Methods`]
- 갱신·제거 명령
  - `npx skills check`: 업데이트나 로컬 변경이 있으면 exit 1.
  - `npx skills update [skills...] [-g|-p] [-y]`
  - `npx skills remove <name> [-g] [-a …] [-y]`: `--all`은 lock에 기록된 스킬만 지운다.
  - 출처: [문서: 같은 문서]
- 탐색: 루트 `SKILL.md`, `skills/`, `.claude/skills/` 등의 컨테이너를 최대 3단계 깊이까지 탐색한다. `.claude-plugin/marketplace.json`이나 `plugin.json`에 선언된 skills도 인식한다. [문서: [docs/creating-skills.md](https://github.com/vercel-labs/skills/blob/main/docs/creating-skills.md)]
- 텔레메트리: 익명 사용 데이터를 **기본으로 수집**한다. `DISABLE_TELEMETRY=1` 또는 `DO_NOT_TRACK=1`로 끈다. [문서: [README#telemetry](https://github.com/vercel-labs/skills#telemetry), [docs/troubleshooting.md](https://github.com/vercel-labs/skills/blob/main/docs/troubleshooting.md)]

### 3.2 에이전트별 설치 경로

| 에이전트 (`-a`) | 프로젝트 | 전역 (`-g`) | 출처 |
|---|---|---|---|
| Claude Code (`claude-code`) | `.claude/skills/` | `~/.claude/skills/` | [docs/agents.md](https://github.com/vercel-labs/skills/blob/main/docs/agents.md) |
| Codex (`codex`) | `.agents/skills/` | `~/.agents/skills/` | 같은 문서 |
| Cursor (`cursor`) | `.agents/skills/` | `~/.cursor/skills/` (문서 표기) | 같은 문서 |

에이전트 쪽 공식 문서와 대조한 결과:

- Codex는 CWD에서 저장소 루트까지의 각 `.agents/skills`와 `$HOME/.agents/skills`, `/etc/codex/skills`를 읽는다. [문서: [developers.openai.com/codex/skills](https://developers.openai.com/codex/skills)]
- Cursor는 `.agents/skills/`, `.cursor/skills/`, `~/.agents/skills/`, `~/.cursor/skills/`를 읽는다. 단, `~/.agents/skills/`는 Cloud Agents에 복사되지 않는다. [문서: [cursor.com/docs/skills](https://cursor.com/docs/skills)]

### 3.3 실측: 어떤 파일이 어디로 복사되는가

픽스처는 PRD 9.1 구조를 축소한 것이다. 루트에 `.claude-plugin/`, `engine/`, `README.md`를 두고, `skills/harness-analyze/` 안에 `SKILL.md`, `scripts/harness-lens.mjs`(chmod +x), `references/`, `schemas/`, `assets/`를 두었다.

1. `npx skills@1.9.0 add <로컬경로> -a claude-code -a codex -a cursor -y`(프로젝트 범위)를 실행했다.
   - `./.agents/skills/harness-analyze/`에 정본이 생겼다. Codex와 Cursor는 이 경로를 "universal"로 공유한다.
   - `./.claude/skills/harness-analyze`는 `../../.agents/skills/harness-analyze`를 가리키는 **symlink**였다.
   - 프로젝트 루트에 `skills-lock.json`(version 2, `computedHash` 포함)이 생겼다.
   - 루트의 `engine/`, `README.md`, `.claude-plugin/`은 **복사되지 않았다.** Skill 폴더 안의 하위 디렉터리는 모두 복사되었다.
2. 같은 명령에 `-g`를 붙여 격리된 HOME에서 실행했다.
   - 정본은 `~/.agents/skills/harness-analyze/`, `~/.claude/skills/harness-analyze`는 symlink, lock은 `~/.agents/.skill-lock.json`이었다.
   - 문서 표와 달리 Cursor용 `~/.cursor/skills/`는 생기지 않았다. Cursor도 "universal"(`~/.agents/skills`)로 처리되었다. Cursor는 `~/.agents/skills/`를 읽으므로 동작에는 문제가 없다.
3. `-a claude-code`만 지정한 경우(GitHub 소스 `anthropics/skills --skill pdf`)에는 `.agents/`를 만들지 않았다. 대신 `.claude/skills/pdf/`에 실제 디렉터리를 **복사**했다(요약에 `(copied)` 표시).

### 3.4 실측: 번들 스크립트의 보존과 실행 권한

| 경로 | 결과 |
|---|---|
| `npx skills add` 로컬 소스 | `scripts/harness-lens.mjs`가 `-rwxr-xr-x`로 보존되었다 |
| `npx skills add anthropics/skills --skill pdf` (GitHub) | git 모드 100755 파일 `scripts/extract_form_structure.py`는 `-rwxr-xr-x`, 100644 파일은 `-rw-r--r--`로 원본 모드를 따랐다 |
| `claude plugin install document-skills@anthropic-agent-skills` (GitHub 마켓플레이스 → 캐시 복사) | 캐시의 같은 파일이 `-rwxr-xr-x`로 보존되었다 |

- [추론] 두 채널 모두 엔진 번들을 손실 없이 배포한다. 다만 다음 세 가지 이유로 SKILL.md에서는 `node "<skill-dir>/scripts/harness-lens.mjs"`처럼 **인터프리터를 명시해 호출**하기를 권장한다.
  1. Windows에서는 실행 비트와 shebang이 의미가 없다.
  2. 저장소에 실행 비트를 커밋하지 않았을 수 있다.
  3. symlink를 지원하지 않는 환경에서는 `--copy`가 필요하다.
- 경로 해석
  - Claude Code는 플러그인과 개인/프로젝트 스킬 모두에서 `${CLAUDE_SKILL_DIR}`를 Skill 디렉터리로 치환한다. 이 변수를 `allowed-tools`의 Bash 규칙에도 쓰면 권한 프롬프트 없이 실행할 수 있다. [문서: [skills#available-string-substitutions](https://code.claude.com/docs/en/skills.md)]
  - 이 변수는 Claude Code 전용이다. Codex와 Cursor에서는 스펙의 "Skill 루트 기준 상대 경로" 관례에 기대야 한다. Codex는 초기 목록에 스킬 파일 경로를 함께 넣는다. [문서: agentskills.io `File references`, Codex skills 문서]

### 3.5 실측: 충돌 시 동작

- `.claude/skills/harness-analyze/`에 사용자가 만든 `SKILL.md`와 `mine.txt`를 미리 두고 `npx skills add … -a claude-code -y`를 실행했다.
  - 요약에 `overwrites: Claude Code`가 표시된 뒤 폴더가 **통째로 교체되었다.**
  - `mine.txt`는 삭제되었고 `SKILL.md`는 배포본으로 바뀌었다. [실측]
- `npx skills remove harness-analyze -a claude-code -y`를 실행하자 폴더가 삭제되고 lock 항목이 비었다. [실측]
- 문서에는 "다른 소스가 같은 이름의 스킬을 설치하면 두 번째가 첫 번째를 덮어쓴다. `--rename`을 쓰라"고 적혀 있다. [문서: [docs/commands.md#renaming-a-skill](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)]

## 4. PRD 5장 / FR-01 / 9.1 검토

| # | PRD 위치 | PRD 내용 | 판정 | 근거·제안 |
|---|---|---|---|---|
| 1 | 5장 명령 예시 | `/plugin marketplace add <owner>/harness-lens` → `/plugin install harness-lens@harness-lens` | **맞음** | 1.4. 한 단계 설치(`/plugin install harness-lens --marketplace <owner>/harness-lens`, v2.1.275+)도 함께 안내하면 좋다. validate가 README에 이 줄을 넣으라고 조언했다(실측) |
| 2 | 5장 | `npx skills add <owner>/harness-lens -a codex` | **맞음** | 3.1. 비대화형으로 쓰려면 `--skill harness-analyze -y`를 권장한다 |
| 3 | 5장 | 명시 호출 `/harness-lens:harness-analyze` | **부분적으로 맞음** | 플러그인 설치일 때만 이 이름이다. `npx skills`로 Claude Code에 설치하면 `/harness-analyze`다(1.6). 두 채널을 모두 설치하면 둘 다 로드되어 목록에 중복으로 나온다 |
| 4 | 5장 1단계, FR-01 | 채널이 설치하며 "기존 파일을 덮어쓰지 않는다", "충돌 시 기존 파일을 보존" | **틀림 (`npx skills`)** | 3.5. `npx skills add -y`는 같은 이름의 폴더를 교체한다. 플러그인 채널은 별도 캐시를 쓰고 네임스페이스가 달라 충돌하지 않는다. **제안:** FR-01 수용 기준을 "플러그인 채널은 기존 파일과 충돌하지 않는다. `npx skills` 채널은 같은 이름이면 교체되므로 README에 경고하고 `--rename`을 안내한다"로 고친다. 또는 충돌 가능성이 낮은 Skill 이름을 쓴다(예: `harness-lens-analyze`) |
| 5 | 14.1 / FR-01 | Node.js 20 이상. 근거로 "`npx skills add`도 Node를 전제" | **틀림 (버전)** | 3.1. `npx skills`는 Node 22.20 이상을 요구한다. 엔진 런타임 하한(20)과 설치 도구 하한(22.20)이 다르다. **제안:** 엔진 하한은 20으로 두되 "`npx skills` 채널은 Node 22.20 이상 필요"를 명시한다. 또는 하한을 22로 올린다(결정 필요). 플러그인 채널 설치에는 Node가 필요 없다 |
| 6 | 9.1 | "`npx skills add`는 Skill 폴더만 복사하므로 엔진 번들은 `skills/harness-analyze/` 안에" | **맞음** | 3.3 실측. 덧붙여 기본 모드에서는 `.agents/skills/` 정본과 symlink가 만들어지고, 프로젝트 루트에 `skills-lock.json`이 생긴다 |
| 7 | 9.1 | 루트 `.claude-plugin/plugin.json` + `marketplace.json` | **맞음 (주의 1건)** | 1.3 실측. `source: "./"`이면 `engine/`, `tests/`, `examples/`까지 저장소 전체가 사용자 캐시에 복사된다. 크기가 커지면 플러그인을 하위 디렉터리로 분리하는 방안을 검토한다 |
| 8 | 5장 1단계 | 업데이트는 채널이 담당 | **보완 필요** | 서드파티 마켓플레이스는 자동 업데이트가 기본으로 꺼져 있다(1.4). `plugin.json`에 `version`을 고정하면 버전 문자열을 올리기 전까지 업데이트가 전달되지 않는다(1.2). 릴리스 정책(버전 고정 vs 커밋 SHA 추적)을 정해야 한다 |
| 9 | 5장 1단계 / 4장 Read Only | 프로젝트/사용자 범위 선택은 채널이 담당 | **보완 필요** | 플러그인 project·local 범위는 대상 저장소의 `.claude/settings*.json`을 수정한다(1.5). `npx skills`의 프로젝트 범위(기본값)는 대상 저장소에 `.agents/`, `.claude/skills/`, `skills-lock.json`을 만든다(3.3). 수집기는 Harness Lens 자신이 설치한 파일을 "자기 구성 요소"로 식별해야 한다(11.1 자기 비용 공개와 연결) |
| 10 | 11.1 | 상시 컨텍스트 약 100토큰 이하 | **달성 가능** | 1.7. 이름과 설명만 상시 로드된다. 픽스처 실측은 약 25토큰이었다. 설명을 수백 자 안으로 유지하면 된다. 측정에는 `claude plugin details`의 Always-on 값을 쓸 수 있다 |
| 11 | 4장 Local First | 자체 텔레메트리 없음 | **보완 필요** | Harness Lens 자체에는 해당하지 않지만, `npx skills` CLI는 텔레메트리를 기본으로 수집한다(3.1). README에 `DISABLE_TELEMETRY=1`을 안내할지 정해야 한다 |
| 12 | 14.2 | "정확한 설치·호출 방법" 미결정 | **대부분 해소** | 이 문서의 1·3장. 남은 항목은 아래 열린 질문 참고 |

## 5. 구현 권고 (요약)

- **SKILL.md의 엔진 호출:** Claude Code에서는 `node "${CLAUDE_SKILL_DIR}/scripts/harness-lens.mjs"`로 호출한다. `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/harness-lens.mjs *)`를 함께 두면 프롬프트 없이 실행된다. 다른 에이전트를 위해 "이 SKILL.md가 있는 디렉터리 기준 `scripts/harness-lens.mjs`"라는 상대 경로 설명을 함께 적는다.
- **frontmatter:** 교차 에이전트 호환을 위해 스펙 필드(`name`, `description`, `license`, `compatibility`, `metadata`)만 사용한다. `compatibility: Requires Node.js 20+`처럼 런타임 요구 사항을 적는다. 설명은 1,024자 이하로 하되 훨씬 짧게 유지한다.
- **이름:** 플러그인·마켓플레이스·항목 이름을 `harness-lens`로 통일한다. 예약어에는 해당하지 않는다.
- **README:** 다음 내용을 넣는다.
  - 두 채널의 설치·업데이트·제거 명령
  - 한 단계 설치 명령
  - 자동 업데이트 켜는 방법
  - `npx skills`의 Node 22.20+ 요구, 덮어쓰기 경고, 텔레메트리 끄는 방법
  - 두 채널을 중복 설치하지 말라는 안내
- **CI:** `claude plugin validate --strict .`와 `skills-ref validate skills/harness-analyze`를 돌린다.

## 6. 열린 질문

1. Node 하한: 엔진 20, `npx skills` 22.20으로 이원화할지, 22 이상으로 통일할지.
2. Skill 이름: `harness-analyze`처럼 일반적인 이름을 유지할지, 충돌 방지용 `harness-lens-analyze` 등으로 바꿀지. 바꾸면 플러그인 호출명은 `/harness-lens:harness-lens-analyze`가 된다.
3. 플러그인 `version` 정책: 고정(명시적 릴리스)으로 할지, 생략(커밋 SHA 추적)으로 할지.
4. 플러그인 소스: 루트(`./`) 전체를 배포할지, 배포용 하위 디렉터리 또는 `git-subdir`로 줄일지.
5. 미검증 항목
   - Windows에서 `npx skills`의 symlink 동작과 `--copy` 필요 여부
   - Codex와 Cursor에서 실제로 Skill이 호출되고 엔진 상대 경로가 해석되는지(이번에는 파일 배치까지만 확인)
   - Claude Code가 symlink된 `.claude/skills/<name>`을 로드하는지는 문서로만 확인했다([skills#choose-where-skills-load](https://code.claude.com/docs/en/skills.md) "Symlinked folders")

## 부록: 실측 재현 절차

```sh
# 픽스처: PRD 9.1 축소판 (skills/harness-analyze/scripts/harness-lens.mjs 는 chmod +x)
claude plugin validate .                                   # ✔ Validation passed
HOME=$TMP/h claude plugin marketplace add ./               # declared in user settings
HOME=$TMP/h claude plugin install harness-lens@harness-lens # scope: user
HOME=$TMP/h claude plugin details harness-lens             # Skills (1) harness-analyze, Always-on ~25 tok
DISABLE_TELEMETRY=1 npx -y skills@1.9.0 add <fixture> -a claude-code -a codex -a cursor -y
ls -la .claude/skills .agents/skills/harness-analyze/scripts   # symlink, -rwxr-xr-x
```
