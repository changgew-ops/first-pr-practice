# Claude Code 적용 지침 — KBL 페이스팩 v1

이 문서와 폴더 전체를 읽은 뒤 사용자의 실제 게임 저장소에 연결하세요.
이번 팩은 **실존 20명 + 가상 얼굴 16종 + 10구단 몸통**입니다. 전현직 1,454명의 완성 페이스팩이 아닙니다.
실제 게임 원본을 받지 못한 상태에서 만든 독립 연동용 SDK와 데모입니다.

## 1. 파일 배치

게임 HTML 옆에 `facepack/` 폴더를 만들고 다음 파일을 복사합니다.

- `data.js`, `facepack.js`
- `faces/` 전체 (21개 WebP + 로컬 실행용 pack.js)
- `generated/atlas.webp`

`originals/`, `generated/atlas-original.png`, 데모의 `app.js`/`style.css`는 실제 게임 실행에 필요하지 않습니다.
이들은 원본 보관 및 비교용입니다. 게임 HTML에 사진을 base64로 직접 넣지 마세요.
데모 화면 전체를 기존 게임에 덮어쓰지 말고 `facepack.js`의 API만 연결합니다.

## 2. 스크립트 및 초기화

```html
<canvas id="player-portrait" width="470" height="609"></canvas>
<script src="./facepack/data.js"></script>
<script src="./facepack/facepack.js"></script>
<script>
(async () => {
  const faces = await KBLFacePack.create({basePath:'./facepack/'});
  const canvas = document.getElementById('player-portrait');
  faces.render(canvas, {id:'291248',teamId:'db'});
})();
</script>
```

실제 초기화는 위 예제처럼 canvas가 존재하는 DOM 준비 후 실행하세요.
동작하는 최소 예제는 동봉한 `integration-example.html`입니다.
`create()`는 비동기이고, 초기 로딩 후 `render()`는 동기입니다. 렌더러는 앱에서 한 번 만들고 재사용합니다.
`basePath`는 문서 URL 기준입니다. 경로가 다른 경우 실제 배치에 맞추세요.

## 3. 선수 ID 연결

`data.js`의 실존 선수 id는 KBL 원본 playerNo입니다.
게임 내부 ID가 다르면 별도 매핑 테이블을 만드세요. 이름만으로 자동 연결하지 마세요(동명이인/시즌 카드 중복).
한 선수의 여러 시즌 카드에는 동일한 KBL playerNo를 연결합니다.
선수 번호나 팀, 나이, 시즌을 얼굴 ID로 사용하지 마세요.

```js
const faceInput = {
  id: player.kblPlayerNo || player.persistentId,
  name: player.name,
  teamId: teamMap[player.teamId],
  isGenerated: Boolean(player.isGenerated),
  faceKey: player.faceKey || undefined
};
const resolved = faces.resolve(faceInput);
// 신규 생성선수나 사진 없는 선수의 얼굴 번호는 세이브 데이터에 함께 저장합니다.
if (resolved.faceKey && !player.faceKey) player.faceKey = resolved.faceKey;
faces.render(canvas, faceInput, {teamId:faceInput.teamId});
```

`isGenerated:true` → 가상 얼굴. 알려진 실제 ID이며 사진 존재 → 실제 사진.
ID가 없거나 매칭되지 않는 실존 선수, 선수 사진 로딩 실패 → 가상 얼굴 대체 (`kind:'fallback'`).
가상 얼굴은 실제 인물 복원이 아니므로 UI에 `대체 얼굴`로 구분할 수 있습니다.
빈 ID는 오류입니다. 생성선수를 만들 때 영구 ID를 먼저 발급하세요.

## 4. 생성선수 일관성

- `KBLFacePack.assignFace(id)`는 문자열 ID를 안정적인 해시로 16종 중 하나에 배정합니다.
- 팀·등번호·시즌·이름을 바꿔도 ID가 같으면 같은 얼굴입니다.
- `faceKey:'gen-01'`부터 `'gen-16'`으로 명시적 고정이 가능합니다.
- 팩 업데이트에 대비해 faceKey를 세이브에 저장하세요.
- 얼굴 16종을 재사용하므로 서로 다른 선수끼리 같은 얼굴이 나올 수 있습니다. 무한 개별 얼굴 생성이나 AI API 실시간 호출은 아닙니다.
- 현재 제공하는 16종은 모두 성인 남성 가상 인물입니다. 외모 유형을 이름/국적에서 추정하지 않습니다.

## 5. 화면별 사용

```js
// 선수 카드/로스터: 머리만 잘라 보여주기
faces.render(faceCanvas, faceInput, {mode:'face'});
// 우승 화면: 해당 소속 유니폼 몸통과 결합
faces.render(fullCanvas, faceInput, {teamId:'lg', tone:true});
// 확대/높이 미세 조정
faces.render(fullCanvas, faceInput, {teamId:'lg', scale:1.02, offset:3});
```

권장 canvas 비율: 얼굴 정사각형, 상반신 470:609.
카드·로스터·우승 화면에서 동일한 faceInput을 재사용합니다.
로스터 전체를 순회해 렌더링하세요. 임의로 7명까지만 잘라내지 마세요.
팀 ID: `db`, `sk`, `kt`, `lg`, `kcc`, `sono`, `samsung`, `mobis`, `gas`, `kgc`.
구단 명칭/코드가 게임과 다르면 별도 teamMap을 만드세요. 잘못된 teamId는 오류입니다.
`render()` 반환값은 `{playerId,kind,faceKey,teamId}`입니다.

## 6. 로컬 HTML과 호스팅

- `file://` 실행 시 SDK가 `faces/pack.js`를 읽습니다. 캔버스 보안 제한을 피하는 데이터 URI 자산 묶음입니다.
- HTTP(S) 실행 시 개별 WebP를 사용합니다. 외부 KBL 사이트에서 실시간 다운로드하지 않습니다.
- 외부 CDN, npm 패키지, API 키, 유료 생성 호출이 필요하지 않습니다.
- 게임을 웹에 올리면 facepack 폴더도 같은 출처에 업로드해야 합니다.
- 브라우저 안의 HTML 미리보기에서는 PC의 옆 폴더를 자동으로 읽을 수 없습니다. 전체 폴더를 지원하는 환경이나 실제 브라우저에서 실행하세요.
- `faces/pack.js`는 이미지의 중복 데이터이므로 HTTP 전용 배포는 생략할 수 있습니다. 로컬 HTML 지원을 유지하려면 포함하세요.

## 7. 합성 한계 / 수정 시 주의

- 몸통·팔·포즈·체형·등번호·문신은 구단별 원본 제공 선수의 것입니다.
- 등번호를 게임 데이터로 바꾸는 기능은 아직 없습니다. 원본 번호를 실제 선수 번호라고 표시하지 마세요.
- 목 가장자리와 색 차이는 완벽하지 않습니다. 선수별 위치 메타데이터로 보정하거나 향후 공통 몸통을 정리하세요.
- 사진 촬영 시즌은 확인하지 않았습니다. 최신 시즌 유니폼 보증 자료가 아닙니다.
- 원본 사진과 생성 아틀라스는 보존하고, 수정 결과를 별도 파일로 저장하세요.
- 기존 게임의 저장 데이터, 난수 생성기, 시즌 시뮬레이션 로직을 변경하지 마세요.

## 8. 연동 후 확인

실존 선수, 생성선수, 사진 없는 선수 각각을 확인합니다.
같은 선수가 팀 이동/등번호 변경/시즌 변경/세이브 로드 후에도 같은 얼굴인지 확인합니다.
선수 카드·로스터·우승 화면의 ID 매핑이 일치하는지 확인합니다.
20명 이상 로스터에서 모든 선수가 표시되는지 확인합니다.
인터넷을 끊은 로컬 실행에서도 자산이 표시되는지 확인합니다.
