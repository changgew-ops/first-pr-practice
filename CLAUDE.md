# KBL GM 게임 — 에이전트 작업 안내

웹·싱글 KBL GM 게임(카드 수집 + 육성, 프야매식 능력치 코스트). 기획은 `docs/GAME_DESIGN.md`, 데이터 넣는 절차는 `docs/DATA_RUNBOOK.md`, 현재 데이터 현황은 `docs/DATA_STATUS.md`(자동 생성).

## 명령
| 명령 | 하는 일 |
|---|---|
| `npm test` | 전체 테스트 (데이터 정합성 + 시뮬레이션 + 이력 검증) |
| `npm run build:history` | `data/history/{raw,drafts,events,title-sponsors}` 검증 → `seasons.json`, `drafts.json`, `events.json`, `franchises.json` 생성 |
| `node tools/check-events.mjs <시즌>` | 이벤트 파일 하나만 검증 (병렬 작업 때 쓴다) |
| `npm run build:real` / `apply:real` / `generate` | 실제 선수 풀 → 로스터·기록 CSV → `data/players.json` |
| `npm run coverage` | 시즌별 어떤 자료가 있는지 표 (`-- --write docs/DATA_STATUS.md`로 저장) |
| `npm run check` | build:history + test (커밋 전에) |
| `npm run web` | 화면 개발 서버(저장소 루트를 정적으로 서빙). http://localhost:8080/web/ |
| `npm run sim:dummy` | 20시즌 시뮬레이션 결과를 `data/dummy/`에 저장 |

## 반드시 지킬 것
1. **실제 데이터는 추측하지 않는다.** 사용자가 붙여넣은 문서·스크린샷·녹화·xlsx에서만 옮기고, 보이지 않는 값은 `null`이나 `note`로 남긴다. 기억에 의존한 선수·구단 정보를 넣지 않는다.
2. **옮긴 값은 항상 검증기로 확인한다.** 새 데이터 형식에는 검증을 먼저 만든다(합계·대칭·집합 일치 등). 검증 오류는 데이터를 고치거나, 원본이 틀렸다면 계산 가능한 값으로 바꾸고 `note`에 이유를 적는다. 경고는 원인을 확인하고 note에 남긴다.
3. **원본(`raw`, `events/*.json`, `drafts/*.json`)만 손으로 고치고, 생성물(`seasons.json`, `events.json`, `drafts.json`, `franchises.json`, `players.json`, `real-pool.json`)은 빌드로만 바꾼다.** 생성물이 원본과 다르면 테스트가 실패한다.
4. 선수 사진·실제 초상은 가져오지 않는다. KBL 사이트(www.kbl.or.kr)는 이 환경에서 막혀 있다. 사용자가 보내는 화면 녹화로 읽는다.
5. 사용자가 요청하기 전에는 PR을 만들지 않는다. 개발 브랜치는 `claude/tender-pascal-rqifwe`. 커밋 메시지 끝에 사용자 지정 attribution 줄을 붙인다.
6. 병렬로 일할 때(포크·서브에이전트)는 **파일 단위로 나눈다**: 각자 자기 시즌 파일 하나만 만들고, `src/`·`tools/`·`tests/`·생성물·다른 시즌 파일은 건드리지 않으며, 커밋과 `npm run build:history`는 맡은 한 사람(조정자)만 한다.

## 폴더
- `data/history/` 시즌 원본·생성물(순위, 플레이오프, 라운드, 상대전적, 수상, 우승팀, 타이틀 스폰서, 이벤트, 드래프트). 형식은 각 README.
- `data/stats/` 선수 시즌 누적 기록 CSV (xlsx에서 변환, 플레이오프 포함)
- `data/players/` 실제 선수 풀(등록선수 화면, 시즌별 소속, 별칭, 정정값, 아이콘 템플릿)
- `data/rosters/`, `data/players.json` 게임에 쓰는 로스터와 선수(생성물)
- `src/` 게임 규칙(순수 함수), `tools/` 데이터 도구와 시뮬레이션 실행기, `tests/`
- `web/` 화면(의존성 없는 정적 웹앱: `app.js` 경로·틀, `views/` 화면별, `lib/game.js` 게임 상태·규칙 호출). 규칙은 `src/`를 그대로 import하므로 `src/`는 node 전용 모듈(`node:fs` 등)을 끌어들이지 않는다(파일에서 읽는 일은 `history.mjs`·`tools/`에만).
- `.claude/agents/` 반복 작업용 에이전트 정의 (아래)

## 반복 작업과 담당 에이전트
- 시즌 이벤트 옮기기 → `season-events` 에이전트
- 신인 드래프트 옮기기 → `draft-transcriber`
- 데이터 점검(교차 확인·누락 찾기) → `data-auditor` (읽기 전용)
절차는 `docs/DATA_RUNBOOK.md`.
