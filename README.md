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
node tools/run-season.mjs                     # 1시즌 + 플레이오프 결과 출력
node tools/run-season.mjs --seasons 500       # 여러 시즌 밸런스 통계
node tools/run-league.mjs --years 20          # 여러 해 연속 (육성·시즌 중 갱신·은퇴·드래프트 포함)
node tools/run-league.mjs --years 20 --manager busan-kcc   # 그 구단의 훈련을 자동 관리
```

실제 선수 이름과 기록을 쓰려면 `data/rosters/README.md`와 `data/stats/README.md`를 보세요.
