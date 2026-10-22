# 실제 선수 풀

KBL 기록실 xlsx에서 만든 실제 선수 풀. 기획: `docs/GAME_DESIGN.md` 5.8.1.

| 파일 | 설명 |
|---|---|
| `real-pool.json` | `npm run build:real`이 만드는 선수 풀(이름, 추정 포지션, 능력치, 코스트, 팀 후보). 매번 다시 만들어진다 |
| `team-map.csv` | 사람이 채우는 팀 배정표. `build:real`을 다시 돌려도 **이미 채운 값은 유지**되고, 새 선수와 후보 정보만 갱신된다 |

## team-map.csv 채우는 법
컬럼: `name,team,age,position,number,origin` (+ 참고용 `minutes,games,후보구단,포지션추정,국적추정`)

- `team`: `data/teams.json`의 구단 id(예: `busan-kcc`). 비워 두면 그 선수는 게임에 들어가지 않는다.
- `position`, `age`, `number`, `origin`은 비워 두면 추정·생성값을 쓴다. 알면 적어서 정정한다.
- `후보구단`은 W/L 기록으로 추린 가능한 구단이다(`|`로 구분). 하나뿐이면 `team`이 미리 채워져 있다.
- 동명이인은 `이름(1)`, `이름(2)`로 구분되어 있다.

채운 뒤 `npm run apply:real` → `npm run generate` → `npm test`.
국내 12명·외국 2명(포지션 다섯 개 모두)이 안 되는 구단은 가상 선수로 채워진다.
