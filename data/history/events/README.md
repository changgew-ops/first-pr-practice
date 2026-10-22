# 시즌 이벤트 (`events/<시즌>.json` → `events.json`)

나무위키 시즌 문서의 오프시즌·시즌 중 이동 정보를 구조화한 것. `npm run build:history`가 검증해 `data/history/events.json`을 만든다.
한 파일만 검증하려면 `node tools/check-events.mjs <시즌>`. 모델 파일: `2026-27.json`.

## 형식
```jsonc
{
  "season": "2026-27",
  "note": "(선택) 해석한 부분, 위키 오류 등",
  "coaching":  [{"team": "부산 KCC", "name": "김도수", "from": "tvN SPORTS 해설위원", "to": "수석코치"}],   // from은 없으면 null
  "trades":    [{"date": "2026-07-01", "phase": "offseason", "teamA": "안양 정관장", "giveA": ["김경원"],
                 "teamB": "울산 현대모비스", "giveB": ["이대헌"], "note": ""}],   // phase: offseason | inseason. 무상·지명권은 giveX에 "무상"이 아니라 빈 배열이나 "24년 1라운드 우선 지명권" 문자열
  "foreign":   [{"team": "부산 KCC", "name": "숀 롱", "position": "센터", "nationality": ["미국"], "kind": "재계약",
                 "asiaQuota": false, "salaryUsd": 600000, "nthSeason": 2, "flags": ["일시대체선수"], "note": ""}],   // salaryUsd(계약 연봉, 달러)·nthSeason(KBL n번째 시즌)은 문서에 있을 때만
   // kind 예: 재계약 / 신규 계약 / 신규 영입 / 신규 계약, 시즌 도중 방출
  "retirements":    [{"team": "...", "names": ["..."]}],
  "voluntaryLeave": [{"team": "...", "names": ["..."]}],     // 임의 탈퇴
  "military": {"enlist": [{"team": "...", "names": ["..."]}], "discharge": [{"team": "...", "names": ["..."]}]},
  "fa": {
    "targets":   [{"team": "구단", "names": ["..."]}, {"team": "계약 미체결", "names": ["전년 미체결자"]}],
    "contracts": [{"fromTeam": "원 소속(또는 '계약 미체결')", "name": "...", "position": "포워드", "toTeam": "새 소속 또는 '잔류'",
                   "date": "2026-05-19", "years": 4, "salaryEok": 3.5, "window": "자율 협상", "compensation": "없음"}],
    "unsigned":  [{"team": "...", "names": ["..."]}],        // 계약 미체결
    "withdrawn": [{"team": "...", "names": ["..."]}]         // FA 대상이었지만 은퇴 등으로 계약도 미체결도 아닌 경우
  }
}
```
- FA 대상자 묶음 이름으로 구단 말고 `계약 미체결`(전년 미체결자)과 `해외 복귀`(해외 진출 후 KBL 복귀 FA)를 쓸 수 있다.
- 구단 이름은 "안양 정관장"처럼 현재 이름이나 줄임말(정관장, KGC, 데이원, kt 등) 모두 된다.
- `salaryEok`은 억 원 숫자(3억 5000만원 = 3.5, 4500만원 = 0.45).
- 위키 FA 계약표는 같은 값이 병합 칸으로 한 번만 적힌다(날짜·기간·보상·새 소속 `잔류`). 위에서 아래로 풀어서 행마다 채운다.

## 검증
- 팀 이름, 날짜(YYYY-MM-DD), 포지션(센터·포워드·가드), 트레이드에 오가는 것이 있는지.
- **FA: 구단별로 대상자 = 계약 + 미체결 + 제외(은퇴 등)**가 이름까지 정확히 같아야 한다. 계약 이름은 그 구단 대상자 안에 있어야 한다.
- 경고(오류는 아님): FA 새 소속이 그 시즌 선수 소속 CSV(`data/players/team-<시즌>.csv`, 2026-27은 등록선수 화면)와 다르면 알려 준다. 시즌 중 이적이거나 동명이인일 수 있어 확인하고, 해석이 맞으면 그대로 둔다.
