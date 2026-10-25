# KBL GM 게임 — 에이전트 작업 안내

웹·싱글 KBL GM 게임(카드 수집 + 육성, 프야매식 능력치 코스트). 기획은 `docs/GAME_DESIGN.md`, 데이터 넣는 절차는 `docs/DATA_RUNBOOK.md`, 현재 데이터 현황은 `docs/DATA_STATUS.md`(자동 생성).

## 명령
| 명령 | 하는 일 |
|---|---|
| `npm test` | 전체 테스트 (데이터 정합성 + 시뮬레이션 + 이력 검증) |
| `npm run build:history` | `data/history/{raw,drafts,events,title-sponsors}` 검증 → `seasons.json`, `drafts.json`, `events.json`, `franchises.json` 생성 |
| `node tools/check-events.mjs <시즌>` | 이벤트 파일 하나만 검증 (병렬 작업 때 쓴다) |
| `npm run build:cards` | 공식 기록 → 시즌 카드 `data/cards/*.json` (생성물) |
| `npm run build:real` / `apply:real` / `generate` | 실제 선수 풀 → 로스터·기록 CSV → `data/players.json` |
| `npm run coverage` | 시즌별 어떤 자료가 있는지 표 (`-- --write docs/DATA_STATUS.md`로 저장) |
| `npm run check` | build:history + test (커밋 전에) |
| `npm run web` | 화면 개발 서버(저장소 루트를 정적으로 서빙). http://localhost:8080/web/ |
| `npm run sim:dummy` | 20시즌 시뮬레이션 결과를 `data/dummy/`에 저장 |

## 반드시 지킬 것
1. **실제 데이터는 추측하지 않는다.** 사용자가 붙여넣은 문서·스크린샷·녹화·xlsx에서만 옮기고, 보이지 않는 값은 `null`이나 `note`로 남긴다. 기억에 의존한 선수·구단 정보를 넣지 않는다.
2. **옮긴 값은 항상 검증기로 확인한다.** 새 데이터 형식에는 검증을 먼저 만든다(합계·대칭·집합 일치 등). 검증 오류는 데이터를 고치거나, 원본이 틀렸다면 계산 가능한 값으로 바꾸고 `note`에 이유를 적는다. 경고는 원인을 확인하고 note에 남긴다.
3. **원본(`raw`, `events/*.json`, `drafts/*.json`)만 손으로 고치고, 생성물(`seasons.json`, `events.json`, `drafts.json`, `franchises.json`, `players.json`, `real-pool.json`, `data/cards/*.json`)은 빌드로만 바꾼다.** 생성물이 원본과 다르면 테스트가 실패한다.
4. 선수 사진·실제 초상은 가져오지 않는다. KBL 사이트(www.kbl.or.kr)는 이 환경에서 막혀 있다. 사용자가 보내는 화면 녹화로 읽는다.
5. 사용자가 요청하기 전에는 PR을 만들지 않는다. 개발 브랜치는 `claude/tender-pascal-rqifwe`. 커밋 메시지 끝에 사용자 지정 attribution 줄을 붙인다.
6. 병렬로 일할 때(포크·서브에이전트)는 **파일 단위로 나눈다**: 각자 자기 시즌 파일 하나만 만들고, `src/`·`tools/`·`tests/`·생성물·다른 시즌 파일은 건드리지 않으며, 커밋과 `npm run build:history`는 맡은 한 사람(조정자)만 한다.
7. **픽셀 오피스는 항상 같이 갱신한다.** 사용자가 주문하거나 에이전트(포크·서브에이전트)를 투입·완료할 때마다 오피스 artifact(https://claude.ai/artifact/HbVEtrL8vYJGQ3gzvByX5r)의 db를 `ArtifactData`로 고친다: `agents/<id>`(name, role, color, look(0~, 포켓몬풍 캐릭터 종류), floor `plan|dev|ui|ops`(없으면 task·role 키워드로 추정: 규칙·밸런스→plan, 엔진·시뮬→dev, 화면·UI→ui, 데이터·검수·배포→ops), state `working|done|idle`, status, order, items[{label, code(영문 6자 이하), state `done|work|wait|fix`}]), `feed/<id>`(at 밀리초, kind `order|start|done|fail|note`, text, 선택 `agent`=에이전트 id), `office/main`(headline, detail, say[], updatedAt). 오피스는 6층 건물이고 맨 위(6F)가 사장실(사장님=사용자), 3F는 휴게·회의실(끝났거나 쉬는 에이전트가 모인다)이다. 굼바 여러 마리(층별 청소 담당)·마귀(순찰·지원)·킹부끄(밤에만 나타남, 분신술)·휴게실 단골·사장실 전설 포켓몬 7마리는 db에 없는 건물 직원/장식이라 db에 넣지 않는다. 주문을 받으면 `order`(사장님이 메일을 내려 편지가 해당 층으로 내려간다)와 headline, 에이전트를 투입하면 `start`(1층에서 출근해 엘리베이터로 자기 층 책상에 앉는다)와 state `working`, 보고를 받으면 `done`(엘리베이터로 사장실에 올라가 보고하고 휴게 공간으로 내려온다)과 state `done`, 검수·테스트가 틀렸거나 반려하면 `fail`(사장님 대노, 에이전트가 다시 책상으로 가서 수정)과 해당 item state `fix`로 바꾼다. 텍스트에 에이전트 이름을 넣거나 `agent`를 채우면 그 캐릭터가 움직인다. 여러 문서는 batch 한 번으로. 페이지를 다시 게시할 필요는 없다. 결과물 패널에 게임과 오피스 두 개가 항상 보이도록, 게임을 게시할 때 오피스도 같은 세션에서 다시 게시한다(소스: `office/office3.html` + `office/assets`, 재게시 방법은 `office/README.md`, 둘 다 사이드바에 고정).

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
