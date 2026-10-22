# first-pr-practice

Practice repo for my first pull request.

## What is this?

This repository exists so I can practice the full GitHub pull request
workflow: creating a branch, making a change, committing it, pushing,
and opening a PR for review.

## Workflow

1. Create a branch off `main`
2. Make a small, focused change
3. Commit with a clear message
4. Push the branch
5. Open a pull request

## KBL GM 게임 (개발 중)

기획서: [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)

```bash
npm run generate                              # 가상 선수 데이터 생성 (data/players.json)
npm test                                      # 데이터·시뮬레이션 검증
npm run build:real                            # 실제 선수 풀(data/players/real-pool.json)과 정정용 표 생성
npm run apply:real                            # 소속이 정해진 선수를 로스터·기록 CSV로 내보내기 (이어서 npm run generate)
npm run coverage                              # 시즌별 데이터 현황 (docs/DATA_STATUS.md)
npm run check                                 # build:history + 전체 테스트 (커밋 전에)
npm run build:history                         # 팀 이력(data/history/raw → seasons.json, franchises.json) 검증·빌드
node tools/run-season.mjs                     # 1시즌 + 플레이오프 결과 출력
node tools/run-season.mjs --seasons 500       # 여러 시즌 밸런스 통계
npm run sim:dummy                             # 25-26 실데이터로 20시즌을 돌려 data/dummy/league-20y.json 에 저장 (실제 시즌 데이터가 들어오면 대체할 더미 이력)
node tools/run-league.mjs --years 20          # 여러 해 연속 (육성·시즌 중 갱신·은퇴·드래프트 포함)
node tools/run-league.mjs --years 20 --manager busan-kcc          # 그 구단의 훈련을 자동 관리
node tools/run-league.mjs --years 20 --manager busan-kcc --bot    # 트레이드·재계약·FA도 자동 단장이 결정
```

팀 이력(1997~2025-26)은 `data/history/README.md`를 보세요.

실제 선수 이름과 기록을 쓰려면 `data/players/README.md`, `data/rosters/README.md`, `data/stats/README.md`를 보세요.

### 클라우드 세션에서 KBL 사이트가 안 열릴 때
이 개발 환경은 네트워크 정책으로 외부 사이트(`www.kbl.or.kr` 등)가 막혀 있을 수 있다. 세션 상단의 클라우드 환경 메뉴에서
Edit → Network access를 열어 Allowed domains에 필요한 도메인을 추가하면 열린다. 사이트가 화면을 자바스크립트로 그리는
경우 데이터를 불러오는 다른 도메인도 필요할 수 있다.

에이전트(포크·서브에이전트)로 데이터를 나눠 넣는 방법은 `CLAUDE.md`와 `docs/DATA_RUNBOOK.md`, 현재 데이터 현황은 `docs/DATA_STATUS.md`를 보세요.
