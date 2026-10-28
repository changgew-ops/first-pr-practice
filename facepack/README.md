# KBL 페이스팩 v1 — 실존 선수 + 생성선수

클로드 코드에 전달할 파일: 이 폴더 전체와 `CLAUDE_PROMPT.txt`의 요청문.
적용 문서: `CLAUDE_INTEGRATION.md`. 최소 동작 예제: `integration-example.html`.

## 포함 범위

- 실제 선수 20명의 사진과 10개 구단 유니폼 몸통 (중복 제거 원본 21장)
- AI로 만든 가상 인물 얼굴 16종, 고정 선수 ID에 따른 배정
- 사진 없는 선수의 가상 얼굴 대체
- 얼굴 전용/유니폼 상반신 렌더러 `facepack.js`
- 실존/생성 혼합 및 생성선수 20인 우승 장면 데모

전현직 전체 선수 페이스팩이 아닙니다. 실게임 원본에 직접 연결된 버전도 아닙니다.
가상 얼굴은 16종을 재사용하므로 많은 선수를 생성하면 얼굴이 겹칩니다.
원본 몸통의 등번호·문신·체형·포즈가 남고, 목 연결과 피부색 차이가 완전히 해결되지는 않았습니다.

## 실행

ZIP 전체를 압축 해제하고 `uniform-lab/index.html`을 브라우저로 엽니다.
`faces`와 `generated` 폴더를 함께 보관하세요. API 키나 서버 설치는 필요하지 않습니다.
로컬 HTML에서는 `faces/pack.js`, HTTP(S)에서는 WebP를 사용합니다.
폰의 단순 파일 미리보기는 JavaScript 실행이 제한될 수 있습니다.

## 실제 게임에서 필요한 파일

`data.js`, `facepack.js`, `faces/`, `generated/atlas.webp`.
원본 PNG와 큰 생성 원본은 보관용이며 런타임에 불러오지 않습니다.
사진을 HTML 자체에 넣지 않아 게임 코드와 사진팩을 별도로 관리할 수 있습니다.

## 원본과 출처

`originals/`: KBL 공식 프로필 원본. 각 URL은 `sources.json`.
촬영 시즌은 확인하지 않았으며 최신 유니폼을 보증하지 않습니다.
`generated/atlas-original.png`: 내장 이미지 생성 기능으로 제작한 가상 인물 아틀라스.
생성 프롬프트는 `generated/PROMPT.md`. 실존 선수의 사진을 생성선수 얼굴로 재사용하지 않았습니다.
사진과 구단 표장의 권리는 원 권리자에게 있습니다.

---

## 게임에 연결하는 법 (이 저장소 기준)

게임은 `facepack/`을 **선택적으로** 읽는다. 폴더가 없거나 일부만 있어도 오류 없이 기존 조합형 아바타로 대신 보인다(`web/lib/faces.js`).

| 실행 방식 | 폴더 위치 |
|---|---|
| 개발 서버(`npm run web`) | 저장소 루트의 `facepack/` (`web/`의 한 단계 위). `globalThis.KBL_FACEPACK_BASE`로 바꿀 수 있다 |
| 단일 HTML(`dist/프로농구-단장-게임.html`) | **HTML과 같은 폴더에 `facepack/` 폴더를 둔다.** 로컬(`file://`)에서는 `facepack/faces/pack.js`를 읽는다 |
| 웹에 올릴 때 | HTML과 `facepack/` 폴더를 같은 위치에 올린다(`KBL_FACEPACK_BASE`를 페이지에서 지정) |

필요한 것: `data.js`, `facepack.js`, `generated/atlas.webp`(저장소에 있음), `faces/`(실사 사진 + `pack.js`, **저장소에 없음**: 사용자가 따로 내려받아 이 폴더에 넣는다). `originals/`와 `generated/atlas-original.png`는 필요 없다.
사진은 HTML에 넣지 않는다. 게임을 갱신할 때는 HTML만 바꾸고 페이스팩은 그대로 쓴다. `tools/build-standalone.mjs`는 이 폴더를 복사하지 않는다.

### 어디에 어떻게 쓰이는가
- **로스터·라인업·도감·선수 정보**: 사진이 있는 선수는 얼굴(작은 크기) 또는 상반신(112px 이상)을 쓴다. 사진이 없는 선수는 기존 일러스트 그대로다.
- **선수 상세**: 소속팀 유니폼에 합성한 상반신(크기 112px 이상), 아바타 안내 문구에 사진 여부를 적었다.
- **우승 화면(단체 사진)**: 팩이 있으면 소속팀 유니폼 합성 상반신으로 바뀌고 로스터 전체(최대 12명, 세 줄)가 선다. 사진이 없는 선수는 가상 얼굴 16종 중 하나(선수 고정 id의 해시)가 몸통에 붙고 카드 모서리에 "가상"이 표시된다. 팩이 없으면 기존 일러스트 단체 사진 그대로다. PNG 저장도 같은 그림을 쓴다.
- **게임 선수 ↔ 사진**: 게임 선수의 `kblId`(KBL playerNo)가 팩 `data.js`의 선수 id와 같을 때만 사진을 쓴다(이름으로 짝짓지 않는다). 가상 얼굴은 `kblId ?? id`의 해시라 이적·시즌 변경·저장 불러오기 뒤에도 같다(저장 형식은 바뀌지 않는다).
- **구단 매핑**: 게임 구단 id → 팩 구단 id는 `web/lib/faces.js`의 `PACK_TEAM`(wonju-db→db, seoul-sk→sk, suwon-kt→kt, changwon-lg→lg, busan-kcc→kcc, goyang-sono→sono, seoul-samsung→samsung, ulsan-hyundai-mobis→mobis, daegu-kogas→gas, anyang-jungkwanjang→kgc).

### 한계(이번 팩 v1)
- 실존 선수 사진은 20명뿐이다(게임 선수와 맞는 사람은 18명: 이원석·송교창은 지금 게임 선수 목록에 없다). 나머지는 가상 얼굴 또는 기존 일러스트.
- 몸통(유니폼)의 **등번호·체형·문신은 구단별 원본 그대로**다. 화면은 번호를 덧붙이지 않는다. 목 연결이 어색한 선수가 있다.
- 사진 촬영 시즌은 확인되지 않아 최신 유니폼을 보증하지 않는다. 가상 얼굴 16종은 서로 다른 선수끼리 겹칠 수 있다. 사진과 구단 표장의 권리는 원 권리자에게 있다.
