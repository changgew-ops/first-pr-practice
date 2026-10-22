# 실명 로스터 넣는 법

구단 id와 같은 이름의 CSV 파일을 이 폴더에 두면 `npm run generate`가 그 이름을 그대로 사용한다.
능력치·잠재력·계약은 이름을 시드로 해서 자동 생성한다(실제 수치가 아님).

- 파일명: `busan-kcc.csv` 처럼 `data/teams.json`의 `id`
- 컬럼: `name,position,age,number,origin` (`_template.csv` 참고)
- `position`: PG / SG / SF / PF / C
- `origin`: `domestic`(국내) 또는 `foreign`(외국)
- 국내 12명, 외국 2명보다 적게 적으면 나머지는 가상 선수로 채워진다.
- `_`로 시작하는 파일은 무시된다.
