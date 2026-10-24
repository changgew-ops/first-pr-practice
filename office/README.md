# 에이전트 오피스 (픽셀 오피스) 소스

- 게시 주소: https://claude.ai/artifact/HbVEtrL8vYJGQ3gzvByX5r (db 컬렉션 `agents` / `feed` / `office`는 읽기만 한다)
- `office3.html` — 페이지 본체(캔버스 + 인라인 JS/CSS). 이미지 에셋(`assets/…`)을 불러오고, 실패하면 코드로 그린 캐릭터·소품으로 대신한다.
- `assets/atlas.png` `props.png` `atlas.json` — 사용자가 만든 캐릭터·소품 시트(`source/sheet.webp`, 초록 배경)에서 잘라 낸 컷아웃. 캐릭터 컷(`atlas.png`)은 원본(약 60~90px)을 2배(`atlas.json`의 `up`)로 키우고 선명하게 다듬은 것이다. 게임이 화면 픽셀 해상도의 캔버스에 줄여 그리므로 흐려지지 않는다(원본을 1.3~1.6배 늘려 그리던 때가 흐려 보이던 원인).
- `make-atlas.py`, `cutout.py` — 시트 → 에셋 변환(크로마키 제거, 초록 번짐 제거, 연결 성분 분리, 패킹). `python3 office/make-atlas.py`
  - 컷 번호(`CHARS`, `BOSS`, `PROP_COMPS`)는 시트를 눈으로 보고 정한 목록이다. 시트를 바꾸면 `/tmp`에 번호 표시 이미지를 만들어 다시 확인한다.
- `source/sheet.webp`, `source/building-ref.webp` — 사용자가 올린 시트와 완성 건물 참고 이미지(시안).

## 다시 게시하기
`Artifact` 도구로 같은 주소에 게시한다(캔버스 앱이라 db 읽기만 쓴다. capabilities는 생략하면 `db`가 유지된다).

- `url`: https://claude.ai/artifact/HbVEtrL8vYJGQ3gzvByX5r
- `file_path`: `office/office3.html`
- `root`: `office`
- `files`: `{"assets/atlas.png": "assets/atlas.png", "assets/props.png": "assets/props.png", "assets/atlas.json": "assets/atlas.json"}`

게임을 게시할 때 오피스도 같은 세션에서 다시 게시한다(결과물 패널에 두 개가 보이도록; CLAUDE.md 7번).

## 움직임(이동) 규칙 요약
- 걷기는 가속→순항→감속(순간이동 없음), 걸음마다 통통·기울임, 방향 전환은 몸을 좁혔다 펴며 뒤집기, 도착하면 살짝 튕김, 앉기·일어나기는 부드럽게 가라앉았다 올라오기.
- 엘리베이터: 문 앞 대기 → 문 열림 → 걸어 들어가 카 안에 섬 → 문(유리) 닫힘 → 가속·감속 이동 → 열림 → 걸어 나옴. 유리문이라 타고 있는 캐릭터가 계속 보인다.
- 층 바꿔야 하는 출근·보고·반려도 모두 걸어서 이동한다(새 직원만 입구에서 페이드로 나타난다). 편지·뮤 비서는 곡선 경로로 천천히 출발·도착한다.

## 로컬 확인
`office/office3.html` 앞뒤에 `<!doctype html>…<body>` 틀을 붙이고 `assets/` 와 함께 정적 서버로 서빙해 연다(`window.claude`가 없으면 예시 직원 10명으로 렌더된다).
