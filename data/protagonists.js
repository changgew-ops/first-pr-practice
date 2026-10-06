(function (g) {
  g.GameData = g.GameData || {};

  // hostile: 제작진 편집이 얼마나 불리하게 작용하는가 (0~1)
  // growth: 훈련 효율 배율 / traits.teamPenalty·seriousPenalty: 팀 미션·진지한 무대 감점
  // arc: 개인 서사. beats 2개 + 해소/미해소 엔딩 문구
  g.GameData.protagonists = [
    {
      id: 'yujin', name: '한유진', age: 17, label: 'HYBE', star: 1,
      concept: '비주얼 센터', strength: '압도적 비주얼', weakness: '실력 부족 · 특혜 의혹',
      skills: { vocal: 45, dance: 55, rap: 40, charm: 92, variety: 50 },
      stamina: 80, mental: 75, awareness: 58, favor: 60, fans: 90000, coh: 38,
      hostile: 0.2, growth: 1.0, trust: 40, funds: 8, traits: {},
      edit: { kind: '특혜 의혹', bad: "'얼굴로 온 애' 자막과 함께 실수 장면만 반복 편집됐다.", hint: '실수 장면 위주로 쓰일 위험이 있다' },
      arc: {
        name: '낙인 뒤집기', resolved: '"얼굴만이 아니라는 걸 증명하고 싶었어요."', unresolved: '"얼굴 말고는 보여줄 게 없다는 말이 아직도 따라다녀요."',
        beats: [
          { title: '"얼굴로 왔다"는 말', text: '연습실 뒤편에서 유진이 숨을 고른다. 커뮤니티 글을 봤다고 한다. "저, 진짜 실력으로 왔다고 말할 수 있을까요?"',
            choices: [
              { label: '"증명하자. 오늘부터 보컬 따로 잡자."', arc: 1, fx: { skill: { vocal: 3 }, stamina: -6, trust: 4 }, result: '유진의 눈빛이 달라졌다. 그날 밤 연습실 불은 늦게까지 꺼지지 않았다.' },
              { label: '"신경 쓰지 마. 넌 이미 충분히 빛나."', arc: -1, fx: { mental: 4, trust: 1 }, result: '유진은 웃어 보였지만, 어딘가 아쉬운 표정이었다.' },
            ] },
          { title: '센터 제안', text: '제작진이 콘셉트 평가의 센터 후보로 유진을 지목했다. 부담스러운 자리라는 걸 유진도 안다.',
            choices: [
              { label: '센터에 도전한다', arc: 1, fx: { stamina: -8, aw: 4, favor: 2 }, result: '"해볼게요." 떨리는 목소리지만 분명한 대답이었다.' },
              { label: '무리하지 않고 안정적으로 간다', arc: 0, fx: { mental: 4 }, result: '안전한 선택이었다. 유진은 안도하면서도 조금 아쉬워 보였다.' },
            ] },
        ],
      },
    },
    {
      id: 'chaewon', name: '이채원', age: 16, label: 'SM', star: 1,
      concept: '최연소 막내', strength: '성장 속도 · 대형사 후광', weakness: '체력/멘탈 불안정',
      skills: { vocal: 58, dance: 60, rap: 45, charm: 75, variety: 55 },
      stamina: 62, mental: 58, awareness: 40, favor: 60, fans: 50000, coh: 45,
      hostile: 0.3, growth: 1.5, trust: 45, funds: 8, traits: {},
      edit: { kind: '나이 프레임', bad: "'어려서 불안하다'는 자막이 붙은 울먹이는 표정만 방송에 나갔다.", hint: '울컥한 순간만 길게 쓰일 위험이 있다' },
      arc: {
        name: '막내의 반란', resolved: '"이제 막내라는 말이 칭찬으로 들려요."', unresolved: '"아직도 선배들 눈치를 보는 제가 싫어요."',
        beats: [
          { title: '선배들 사이에서', text: '합숙 중 채원이 식당 구석에 혼자 앉아 있다. 언니들끼리의 이야기에 끼지 못하는 눈치다.',
            choices: [
              { label: '같이 앉아 분위기를 만들어 준다', arc: 1, fx: { mental: 5, coh: 3, trust: 3 }, result: '채원이 처음으로 크게 웃었다. 그 장면이 카메라에 잡혔다.' },
              { label: '스스로 다가가게 둔다', arc: -1, fx: { mental: -3 }, result: '채원은 끝내 말을 걸지 못하고 방으로 돌아갔다.' },
            ] },
          { title: '체력 한계', text: '채원의 얼굴이 하얗다. "괜찮아요, 할 수 있어요." 하지만 손이 떨린다.',
            choices: [
              { label: '오늘은 쉬게 한다', arc: 1, fx: { stamina: 14, mental: 4, trust: 4 }, result: '채원은 "죄송해요…"라고 했지만, 곧 깊이 잠들었다.' },
              { label: '한 번만 더 맞춰 보자고 한다', arc: -1, fx: { skill: { dance: 2 }, stamina: -12, trust: -4 }, result: '동작은 좋아졌지만 채원의 표정은 점점 굳어갔다.' },
            ] },
        ],
      },
    },
    {
      id: 'hayeon', name: '서하연', age: 19, label: 'JYP', star: 2,
      concept: '데뷔 무산 경험자', strength: '보컬/댄스 안정', weakness: '순위 발표 트라우마',
      skills: { vocal: 74, dance: 72, rap: 55, charm: 66, variety: 52 },
      stamina: 75, mental: 48, awareness: 30, favor: 50, fans: 30000, coh: 50,
      hostile: 0.4, growth: 1.0, trust: 40, funds: 7, traits: { announceShock: 8 },
      edit: { kind: '낙인 편집', bad: "'또 떨어질 것 같은 연습생'이라는 내레이션이 붙었다.", hint: '과거 데뷔 무산 이야기를 꺼낼 위험이 있다' },
      arc: {
        name: '트라우마 극복', resolved: '"이번엔 순위가 무섭지 않았어요."', unresolved: '"발표 날만 되면 아직도 손이 떨려요."',
        beats: [
          { title: '그날의 기억', text: '하연이 조용히 말한다. "데뷔 직전에 팀이 없어졌던 날… 오늘이 그날이랑 비슷한 날씨예요."',
            choices: [
              { label: '끝까지 들어준다', arc: 1, fx: { mental: 6, trust: 6 }, result: '하연이 처음으로 그 이야기를 끝까지 했다. 눈물이 맺혔지만 표정은 후련해 보였다.' },
              { label: '"이번엔 달라. 지금에 집중하자."', arc: 0, fx: { mental: 2, trust: 1 }, result: '하연은 고개를 끄덕였다. 그러나 속마음은 닫힌 채였다.' },
            ] },
          { title: '순위 발표 전날 밤', text: '잠을 못 자는 하연이 옥상에 올라와 있다. 야경이 보인다.',
            choices: [
              { label: '치킨을 사 와서 같이 먹는다', arc: 1, fx: { mental: 8, stamina: -3, trust: 5 }, result: '"이건 반칙이에요." 하연이 웃으며 닭다리를 집었다.' },
              { label: '일찍 자라고 한다', arc: -1, fx: { mental: -2 }, result: '하연은 침대에 누웠지만 새벽까지 뒤척였다.' },
            ] },
        ],
      },
    },
    {
      id: 'harin', name: '오하린', age: 18, label: 'STARSHIP', star: 2,
      concept: '아역배우 출신', strength: '표정 연기 · 카메라 감각', weakness: '아이돌 기본기',
      skills: { vocal: 52, dance: 50, rap: 45, charm: 70, variety: 74 },
      stamina: 75, mental: 62, awareness: 45, favor: 55, fans: 40000, coh: 45,
      hostile: 0.4, growth: 1.1, trust: 40, funds: 5, traits: { seriousPenalty: 0 },
      edit: { kind: '연기 프레임', bad: "'연기하는 거 아니야?'라는 자막과 함께 우는 장면이 반복 편집됐다.", hint: '감정 장면이 연출처럼 보이게 쓰일 위험이 있다' },
      arc: {
        name: '진짜 나로 서기', resolved: '"연기가 아니라 제 얼굴로 무대에 섰어요."', unresolved: '"카메라 앞에서는 아직 어떤 표정이 진짜인지 모르겠어요."',
        beats: [
          { title: '"그거 연기야?"', text: '하린이 댓글을 봤다. "제 눈물이… 연기라는 사람이 있대요."',
            choices: [
              { label: '"무대에서 진심으로 보여주자."', arc: 1, fx: { mental: 3, skill: { vocal: 2 }, trust: 3 }, result: '하린이 고개를 끄덕였다. 표정에서 연기가 빠져 있었다.' },
              { label: '"연기든 아니든 팬들이 좋아하면 돼."', arc: -1, fx: { favor: 1, trust: -2 }, result: '하린은 웃었지만 눈은 웃지 않았다.' },
            ] },
          { title: '기본기 보충', text: '댄스 트레이너가 하린의 기본 동작을 지적했다. 아역 시절엔 없던 종류의 지적이다.',
            choices: [
              { label: '매일 아침 기본기 훈련을 붙인다', arc: 1, fx: { skill: { dance: 3 }, stamina: -7 }, result: '하린은 투덜대면서도 한 번도 빠지지 않았다.' },
              { label: '표현력으로 커버하자고 한다', arc: 0, fx: { skill: { variety: 1 } }, result: '무난한 선택이었다.' },
            ] },
        ],
      },
    },
    {
      id: 'daeun', name: '차다은', age: 18, label: 'PLEDIS', star: 2,
      concept: '예능 천재', strength: '끼 · 친근함', weakness: '진지한 무대',
      skills: { vocal: 55, dance: 56, rap: 60, charm: 62, variety: 90 },
      stamina: 80, mental: 70, awareness: 38, favor: 70, fans: 25000, coh: 50,
      hostile: 0.35, growth: 1.0, trust: 45, funds: 5, traits: { seriousPenalty: 6 },
      edit: { kind: '예능캐 고착', bad: "웃긴 장면만 모아 '실력 없는 예능캐'로 편집했다.", hint: '웃긴 순간만 골라 쓸 위험이 있다' },
      arc: {
        name: '진지한 반전', resolved: '"웃기지 않아도 저를 봐주는 사람들이 생겼어요."', unresolved: '"아직도 사람들은 제가 웃기는 사람으로만 알아요."',
        beats: [
          { title: '"쟤는 웃기기만 해"', text: '다은이 평소 같지 않게 조용하다. "저 무대 때 웃음 안 나오면 어떡하죠?"',
            choices: [
              { label: '"한 곡만 진지하게 해 보자."', arc: 1, fx: { skill: { vocal: 3 }, stamina: -6, trust: 4 }, result: '다은의 눈빛이 처음으로 진지해졌다. 연습실이 조용해졌다.' },
              { label: '"넌 웃길 때 제일 빛나."', arc: -1, fx: { favor: 1, trust: -1 }, result: '다은이 웃었다. 하지만 마음 한구석은 비어 보였다.' },
            ] },
          { title: '무대 위 눈물', text: '진지한 곡 연습 중에 다은이 갑자기 울음을 터뜨렸다. "저 이런 거 처음이라…"',
            choices: [
              { label: '그대로 연습을 이어가게 한다', arc: 1, fx: { mental: 3, skill: { vocal: 2 }, trust: 3 }, result: '눈물 섞인 무대는 이상하게 설득력이 있었다.' },
              { label: '잠깐 쉬게 한다', arc: 0, fx: { mental: 5, stamina: 4 }, result: '다은은 눈물을 닦고 웃었다. "다시 갈게요."' },
            ] },
        ],
      },
    },
    {
      id: 'reina', name: '레이나', age: 20, label: 'CUBE', star: 3,
      concept: '일본 출신 퍼포머', strength: '랩 · 퍼포먼스', weakness: '언어 장벽',
      skills: { vocal: 60, dance: 78, rap: 82, charm: 68, variety: 40 },
      stamina: 80, mental: 65, awareness: 20, favor: 48, fans: 15000, coh: 45,
      hostile: 0.5, growth: 1.0, trust: 35, funds: 5, traits: { teamPenalty: 5 },
      edit: { kind: '번역 장난', bad: "서툰 한국어 발음을 놀리는 듯한 자막과 효과음이 붙었다.", hint: '발음 실수만 골라 자막으로 쓸 위험이 있다' },
      arc: {
        name: '소통을 배우다', resolved: '"제 말로 마음을 전하고 싶었어요. 이제 조금은 돼요."', unresolved: '"마음은 있는데 말이 안 따라줘서 아직 답답해요."',
        beats: [
          { title: '말이 안 통하는 밤', text: '팀 회의에서 레이나의 의견이 오해로 번졌다. 레이나는 입을 닫았다.',
            choices: [
              { label: '통역 앱 말고 직접 천천히 이야기해 본다', arc: 1, fx: { mental: 5, trust: 5, coh: 2 }, result: '어설프지만 전달됐다. 레이나가 처음으로 먼저 농담을 했다.' },
              { label: '동료에게 대신 설명해 준다', arc: -1, fx: { trust: 1 }, result: '해결은 됐지만 레이나는 여전히 자신의 말로 말하지 못했다.' },
            ] },
          { title: '한국어 가사', text: '레이나가 직접 쓴 한국어 랩 가사를 보여준다. 문법이 어색하지만 마음이 전해진다.',
            choices: [
              { label: '어색한 부분은 살리고 그대로 가자', arc: 1, fx: { skill: { rap: 2 }, favor: 2 }, result: '어색함이 오히려 매력이 됐다. 레이나의 눈이 반짝였다.' },
              { label: '자연스럽게 고쳐 준다', arc: 0, fx: { skill: { rap: 1 } }, result: '깔끔해졌지만 레이나 특유의 색은 조금 옅어졌다.' },
            ] },
        ],
      },
    },
    {
      id: 'seoyeon', name: '백서연', age: 22, label: 'WOOLLIM', star: 3,
      concept: '독고다이 보컬', strength: '압도적인 라이브', weakness: '친근함 · 팀 케미',
      skills: { vocal: 94, dance: 58, rap: 40, charm: 60, variety: 30 },
      stamina: 78, mental: 68, awareness: 18, favor: 45, fans: 12000, coh: 60,
      hostile: 0.55, growth: 1.0, trust: 30, funds: 4, traits: { teamPenalty: 4 },
      edit: { kind: '태도 논란', bad: "무표정한 장면에 '건방진 태도?'라는 자막이 붙었다.", hint: '무표정한 순간을 태도 문제처럼 쓸 위험이 있다' },
      arc: {
        name: '마음 열기', resolved: '"먼저 손 내미는 법을 배웠어요."', unresolved: '"여전히 혼자가 편하다고 말하게 돼요."',
        beats: [
          { title: '혼자 연습하는 이유', text: '서연은 늘 연습실에 혼자 남는다. 같은 팀원이 문 앞에서 머뭇거린다.',
            choices: [
              { label: '팀원을 안으로 들여보낸다', arc: 1, fx: { coh: 3, trust: 4, mental: 3 }, result: '어색한 침묵 끝에 서연이 먼저 말했다. "같이… 맞춰볼래?"' },
              { label: '서연의 페이스를 존중한다', arc: -1, fx: { mental: 2, trust: 1 }, result: '서연은 조용히 연습을 이어갔다. 팀원은 돌아갔다.' },
            ] },
          { title: '무대 후 대화', text: '무대가 끝난 뒤, 팀원이 서연에게 말을 건넨다. "솔직히 너 덕분에 우리가 산 거야."',
            choices: [
              { label: '서연이 답할 수 있게 기다려 준다', arc: 1, fx: { mental: 5, coh: 4, trust: 3 }, result: '"…고마워." 서연이 겨우 꺼낸 한마디였다.' },
              { label: '분위기를 풀어 준다', arc: 0, fx: { mental: 2 }, result: '자연스럽게 넘어갔지만 서연의 속마음은 그대로였다.' },
            ] },
        ],
      },
    },
    {
      id: 'jia', name: '문지아', age: 21, label: 'FANTAGIO', star: 3,
      concept: '발레 전공자', strength: '피지컬 · 퍼포먼스', weakness: '보컬/랩 · 딱딱한 인상',
      skills: { vocal: 40, dance: 90, rap: 42, charm: 70, variety: 45 },
      stamina: 85, mental: 65, awareness: 20, favor: 48, fans: 12000, coh: 50,
      hostile: 0.5, growth: 1.0, trust: 35, funds: 3, traits: { seriousPenalty: 3 },
      edit: { kind: '딱딱한 이미지', bad: "'아이돌 하기엔 딱딱하다'는 평가와 함께 굳은 표정이 반복됐다.", hint: '긴장한 표정을 반복해서 쓸 위험이 있다' },
      arc: {
        name: '무대 위의 자유', resolved: '"발레가 아닌, 제 춤으로 무대에 섰어요."', unresolved: '"아직도 몸이 정해진 틀 안에서만 움직여요."',
        beats: [
          { title: '틀을 깨는 연습', text: '안무가가 지아에게 말했다. "너무 정확해서 재미가 없어. 흐트러져 봐."',
            choices: [
              { label: '일부러 틀리게 춰 보라고 한다', arc: 1, fx: { skill: { charm: 3 }, stamina: -5, trust: 3 }, result: '처음엔 어색했지만, 지아의 춤에 처음으로 표정이 생겼다.' },
              { label: '지금의 정확함이 강점이라고 말한다', arc: -1, fx: { mental: 3 }, result: '안심은 했지만 변화는 없었다.' },
            ] },
          { title: '보컬 트레이닝', text: '지아가 노래 연습 중 목소리가 갈라지자 얼굴을 붉혔다. "저 노래는 정말 못하죠?"',
            choices: [
              { label: '"춤으로 부족한 건 채울 수 있어."', arc: 0, fx: { mental: 4 }, result: '지아는 안도했다. 보컬 실력은 그대로였다.' },
              { label: '"조금씩, 매일 10분만 해 보자."', arc: 1, fx: { skill: { vocal: 3 }, stamina: -4, trust: 4 }, result: '지아가 천천히 고개를 끄덕였다. 목표가 생긴 얼굴이었다.' },
            ] },
        ],
      },
    },
    {
      id: 'yerin', name: '도예린', age: 17, label: 'FREE', star: 4,
      concept: 'SNS 스타 출신', strength: '초기 팬 수 · 화제성', weakness: '트레이닝 부족 · 안티',
      skills: { vocal: 48, dance: 55, rap: 50, charm: 78, variety: 70 },
      stamina: 75, mental: 55, awareness: 65, favor: 26, fans: 55000, coh: 22,
      hostile: 0.7, growth: 1.2, trust: 30, funds: 1.5, traits: {},
      edit: { kind: '악플/어그로', bad: "'관심종자' 자막과 함께 SNS 논란 장면이 길게 편집됐다.", hint: '과거 SNS 영상이 맥락 없이 쓰일 위험이 있다' },
      arc: {
        name: '팬이 아닌 사람 얻기', resolved: '"조회수가 아니라 응원이 쌓이는 느낌이에요."', unresolved: '"아직도 사람들은 제 숫자만 봐요."',
        beats: [
          { title: '악플 읽기', text: '예린이 휴대폰을 붙들고 있다. 댓글은 응원 반, 악플 반. "다 봐야 직성이 풀려요."',
            choices: [
              { label: '휴대폰을 압수하고 같이 산책한다', arc: 1, fx: { mental: 7, stamina: 3, trust: 5 }, result: '한참 걷고 나서 예린이 말했다. "…살 것 같아요."' },
              { label: '악플은 무시하고 팬 반응만 보게 한다', arc: 0, fx: { mental: 2, coh: 2 }, result: '잠깐은 괜찮아졌지만 불안은 남았다.' },
            ] },
          { title: '진짜 연습 영상', text: '예린이 처음으로 SNS 대신 연습 영상을 올려 보고 싶다고 한다.',
            choices: [
              { label: '땀 흘리는 모습 그대로 올린다', arc: 1, fx: { favor: 4, coh: 4, aw: 2 }, result: '보정 없는 영상이 예상 밖의 호평을 받았다.' },
              { label: '완성도 있게 편집해서 올린다', arc: 0, fx: { aw: 4 }, result: '조회수는 많았지만 반응은 평소와 비슷했다.' },
            ] },
        ],
      },
    },
    {
      id: 'yuna', name: '유나', age: 23, label: 'JELLY', star: 4,
      concept: '해체한 전 아이돌', strength: '무대 경험 · 기존 팬', weakness: '나이 · 과거 이슈',
      skills: { vocal: 72, dance: 70, rap: 55, charm: 62, variety: 58 },
      stamina: 72, mental: 52, awareness: 38, favor: 33, fans: 13000, coh: 55,
      hostile: 0.65, growth: 0.9, trust: 35, funds: 2, traits: { announceShock: 4 },
      edit: { kind: '실패자 낙인', bad: "'한 번 실패한 사람'이라는 내레이션과 해체 당시 영상이 편집됐다.", hint: '해체 당시 이야기만 골라 쓸 위험이 있다' },
      arc: {
        name: '두 번째 무대', resolved: '"두 번째는 후회하지 않을 거예요. 이미 후회 안 해요."', unresolved: '"아직도 그 날의 제 모습이 따라다녀요."',
        beats: [
          { title: '해체 이후', text: '유나가 과거 팀 사진을 꺼냈다. "그 애들이랑 연락은 안 해요. 이번에는 다를까요?"',
            choices: [
              { label: '"이번엔 네 이름으로 서는 거야."', arc: 1, fx: { mental: 6, trust: 5 }, result: '유나는 사진을 다시 넣었다. 이번엔 미련이 아닌 정리였다.' },
              { label: '"그 얘긴 안 하는 게 좋겠어."', arc: -1, fx: { mental: 1, trust: -2 }, result: '유나는 입을 다물었다.' },
            ] },
          { title: '소속사의 위기', text: '젤리피쉬에서 연락이 왔다. 지원금이 줄어든다는 소식이다.',
            choices: [
              { label: '내 자금으로 일부 메운다', arc: 1, fx: { funds: -1, trust: 5, mental: 3 }, result: '유나가 고개를 숙였다. "…꼭 갚을게요."' },
              { label: '지출을 줄이고 버틴다', arc: 0, fx: { mental: -3 }, result: '필요한 건 포기해야 했다. 유나는 말없이 받아들였다.' },
            ] },
        ],
      },
    },
    {
      id: 'taeri', name: '강태리', age: 20, label: 'YG', star: 5,
      concept: '악역 낙인 리더형', strength: '리더십 · 팀워크', weakness: '시작부터 나쁜 이미지',
      skills: { vocal: 66, dance: 68, rap: 62, charm: 64, variety: 50 },
      stamina: 80, mental: 50, awareness: 55, favor: 14, fans: 3000, coh: 40,
      hostile: 0.9, growth: 1.1, trust: 25, funds: 7, traits: {},
      edit: { kind: '악마의 편집', bad: "리더로서의 단호한 말만 골라 '독단적인 악역'으로 편집했다.", hint: '리더십 장면이 독단처럼 편집될 위험이 크다' },
      arc: {
        name: '오해를 풀고 대역전', resolved: '"사람들이 진짜 저를 알아봐 주기 시작했어요."', unresolved: '"아직도 어떤 사람들은 첫 방송의 저만 기억해요."',
        beats: [
          { title: '첫 방송의 그 장면', text: '태리는 방송에서 자신이 어떻게 비쳤는지 알고 있다. "…저, 정말 그런 사람처럼 보였어요?"',
            choices: [
              { label: '"아니. 하지만 증명은 무대에서 하자."', arc: 1, fx: { mental: 4, trust: 5 }, result: '태리가 고개를 끄덕였다. 눈빛이 단단해졌다.' },
              { label: '"괜찮아, 시간이 해결해 줄 거야."', arc: -1, fx: { mental: 1 }, result: '태리는 웃었다. 하지만 믿는 표정은 아니었다.' },
            ] },
          { title: '팀원의 한마디', text: '같이 무대를 준비한 팀원이 태리에게 조용히 사과했다. "나도 방송만 보고 오해했었어."',
            choices: [
              { label: '증언 영상을 찍어달라고 부탁한다', arc: 1, fx: { favor: 5, coh: 4, trust: 4 }, result: '팀원의 진심 어린 증언이 커뮤니티에서 화제가 됐다.' },
              { label: '그냥 마음만 받는다', arc: 0, fx: { mental: 4, trust: 1 }, result: '따뜻했지만 여론은 달라지지 않았다.' },
            ] },
        ],
      },
    },
    {
      id: 'sodam', name: '윤소담', age: 21, label: 'FREE', star: 5,
      concept: '혼자 나온 언더독', strength: '성장률 최고', weakness: '자원 · 환경 열세',
      skills: { vocal: 58, dance: 56, rap: 52, charm: 60, variety: 50 },
      stamina: 80, mental: 70, awareness: 10, favor: 44, fans: 2500, coh: 48,
      hostile: 0.75, growth: 1.7, trust: 50, funds: 1, traits: {},
      edit: { kind: '분량 삭제', bad: "무대가 통편집되고 대기실 장면 몇 컷만 방송에 나갔다.", hint: '분량이 거의 없는 채로 편집될 위험이 있다' },
      arc: {
        name: '개천에서 용', resolved: '"혼자 시작했지만, 이제는 혼자가 아니에요."', unresolved: '"여전히 모든 걸 혼자 해내야 한다는 생각이 들어요."',
        beats: [
          { title: '아무도 없는 연습실', text: '대형사 연습생들은 전용 연습실이 있다. 소담은 공용 연습실 예약을 매번 새벽에 잡는다.',
            choices: [
              { label: '새벽 연습을 같이 한다', arc: 1, fx: { skill: { dance: 3, vocal: 2 }, stamina: -10, trust: 6 }, result: '새벽 연습실에서 둘은 처음으로 서로에게 기댔다.' },
              { label: '자금을 써서 연습실을 빌린다', arc: 0, fx: { funds: -1, stamina: 4, skill: { dance: 2 } }, result: '환경이 나아졌지만 돈이 줄었다.' },
            ] },
          { title: '다른 소속사 연습생의 제안', text: '같은 조 연습생이 연합을 제안했다. "우리 같이 팀 짜자. 네 실력 인정해."',
            choices: [
              { label: '연합을 받아들인다', arc: 1, fx: { coh: 3, favor: 3, trust: 3 }, result: '처음으로 혼자가 아닌 느낌이었다. 소담이 활짝 웃었다.' },
              { label: '혼자 하겠다고 답한다', arc: -1, fx: { mental: -2 }, result: '소담은 거절했지만 표정은 쓸쓸했다.' },
            ] },
        ],
      },
    },
  ];
})(typeof window !== 'undefined' ? window : global);
