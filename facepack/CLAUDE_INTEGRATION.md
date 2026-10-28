# Claude Code 연동 지침 — 전체팩 v2

## 범위와 변경점

기존 엑셀 명단 1,454명 중 1,275명은 실제 사진, 179명은 가상 대체입니다.
새로 생성한 선수나 명단 밖 ID도 가상 얼굴로 처리합니다.
v1(20명 테스트팩) 대신 이 전체 폴더를 사용하세요. v2는 지연 로딩 때문에 **render / drawOriginal 모두 Promise를 반환**합니다.
기존 게임을 덮어쓰지 말고 렌더러만 연결하세요. 시뮬레이션·세이브 형식은 필요한 faceKey 추가 외에 유지합니다.

## 배치

게임 HTML 옆에 `full-facepack/` 폴더 전체를 복사합니다.
HTML 하단에 다음 스크립트를 추가합니다.

```html
<canvas id="portrait" width="235" height="305"></canvas>
<script src="./full-facepack/data.js"></script>
<script src="./full-facepack/facepack.js"></script>
<script>
(async () => {
  const faces = await KBLFacePack.create({basePath:'./full-facepack/'});
  await faces.render(document.getElementById('portrait'),
    {id:'245065',teamId:'db'}, {mode:'portrait'});
})();
</script>
```

앱 초기화 때 create()를 한 번 실행해 공유하세요. UI 컴포넌트마다 렌더러를 새로 생성하지 마세요.
폴더 안의 `integration-example.html`은 바로 실행되는 예제입니다.

## 선수 매핑

KBL 선수 ID는 `playerNo`입니다. 같은 선수의 모든 시즌 카드를 동일한 playerNo로 연결합니다.
게임 ID가 다르면 별도 매핑 테이블을 만드세요. 이름 자동 매칭은 동명이인 때문에 피하세요.
팀·등번호·이름·시즌을 영구 ID 대신 쓰면 안 됩니다.

```js
const input = {
  id: String(player.kblPlayerNo || player.persistentId),
  name: player.name,
  isGenerated: !!player.isGenerated,
  faceKey: player.faceKey || undefined
};
const result = await faces.render(canvas, input, {
  teamId: teamMap[player.teamId],
  mode: 'portrait' // 얼굴 카드에는 'face'
});
if (result.faceKey && !player.faceKey) player.faceKey = result.faceKey;
```

- 사진 확보된 실제 ID: `kind:'real'`.
- 사진 없음/실루엣/알 수 없는 실제 ID/선수 사진 로딩 실패: `kind:'fallback'`.
- `isGenerated:true`: `kind:'generated'`.
- faceKey를 지정하면 실제 사진 여부와 무관하게 해당 가상 얼굴을 사용합니다.
- 이미지 로딩이 끝난 뒤의 실제 상태는 render() 반환값으로 판단하세요. resolve()는 로딩 전 명부 기준 상태입니다.
- `{cancelled:true}`는 같은 canvas에 더 최신 렌더 요청이 들어와 이전 결과를 생략했다는 뜻입니다.
- 새 선수는 영구 ID를 먼저 발급하세요. 빈 ID는 오류입니다.

## 생성/대체 얼굴

`KBLFacePack.assignFace(id)`는 gen-01 ~ gen-16 중 하나를 고정 배정합니다.
팀/등번호/시즌/이름이 바뀌어도 ID가 같으면 같은 얼굴입니다.
향후 팩 업데이트에도 유지하려면 배정된 faceKey를 게임 세이브에 저장하세요.
16종을 재사용하므로 중복 얼굴은 정상입니다. 매번 AI로 얼굴을 생성하는 기능이 아니며 API 호출도 없습니다.
실존 선수의 가상 대체 얼굴은 실제 얼굴처럼 표기하지 말고 필요 시 '대체 얼굴'로 구분하세요.

## 화면별 렌더링

```js
await faces.render(faceCanvas, input, {mode:'face'}); // 선수 카드 / 로스터
await faces.render(fullCanvas, input, {teamId:'lg', mode:'portrait'}); // 우승
await faces.render(fullCanvas, input, {teamId:'lg', scale:1.02, offset:3, tone:true});
await faces.drawOriginal(originalCanvas, input); // 원본 프로필 비교
```

얼굴 카드: 정사각 canvas. 상반신: 470:609 비율.
우승 로스터 전체를 순회하세요. 7명 등 고정 인원으로 자르지 마세요.
한 화면의 사진을 4~8개씩 나누어 await하면 초기 부하를 줄일 수 있습니다.
모든 1,454명을 시작 시 선로딩하지 마세요. 현재 화면에 필요한 사진만 렌더링합니다.

팀 코드: db / sk / kt / lg / kcc / sono / samsung / mobis / gas / kgc.
실제 게임 팀 코드와 다르면 teamMap을 구성하세요. 사진 속 팀을 현재 소속으로 사용하지 마세요.

## 로컬 HTML / 웹

- `file://`에서는 offline/boot.js와 offline/photos-XXX.js를 지연 로딩합니다.
- HTTP(S)에서는 faces/*.webp, uniforms/*.webp, generated/atlas.webp를 사용합니다.
- 동일 출처에 폴더 전체를 배포하세요. PC 폴더를 온라인 미리보기에서 자동 접근할 수는 없습니다.
- HTTP 전용이면 offline/ 폴더를 배포에서 제외할 수 있으나, 로컬 실행 지원이 사라집니다.
- HTML 본문에 사진을 넣지 마세요. 이 폴더를 독립 페이스팩으로 유지합니다.
- 외부 KBL 다운로드, CDN, npm, API 키, 생성 API 호출은 필요 없습니다.
- 필수 유니폼/가상 아틀라스 파일이 없으면 초기화가 실패합니다. 폴더 누락을 선수 사진 없음으로 숨기지 마세요.

## 품질 메타데이터

manifest.json의 players[].faceBox는 [x,y,width,height] 정규화 좌표입니다.
기준은 원본 이미지이며 rotation:90인 1장은 시계 방향 90도 회전 후의 좌표입니다.
검출 실패 25장은 cropMethod:'estimated'이고 UI에서 점검 대상으로 분류합니다.
다른 사진도 수동 얼굴/합성 검증을 모두 한 것은 아닙니다. 필요한 경우 faceBox를 조정해 data.js와 manifest.json을 함께 갱신하세요.
photo:true는 공식 URL의 이미지 확보·형식 검증 기준이며 최신 시즌 사진이나 개별 인물 수동 검증 보증은 아닙니다.
수집 불가 163명과 기본 실루엣 16명은 photo:false입니다.

몸통 등번호·문신·체형·포즈는 고정 원본이며 현재 선수의 실제 정보로 사용하면 안 됩니다.
목 연결과 과거 사진 배경은 완벽히 제거되지 않았습니다.

## 연동 검수

실제 선수(허재 245065, 워니 291248), 대체 선수(291677), 신규 ID를 확인합니다.
카드·로스터·우승 화면에서 동일한 ID인지 확인합니다.
이적/시즌 변경/세이브 로드 후 얼굴이 유지되는지 확인합니다.
20명 이상 전체 로스터, 로컬 HTML 오프라인 실행, 웹 실행을 확인합니다.
