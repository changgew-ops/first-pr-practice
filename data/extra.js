(function (g) {
  const D = (g.GameData = g.GameData || {});

  // 이벤트 필드: tiers(해당 등급 소속만) / only(특정 주인공만) / 본문의 {friend:이가} {rival:와과} 토큰은 엔진이 이름+조사로 치환
  const extra = [
    // ── 공통 ──
    { id: 'vocal_lesson', bg: 'practice', title: '보컬 특강', text: '유명 보컬 트레이너가 특강을 왔다. 20분 안에 모든 참가자에게 한 마디씩 피드백을 준다고 한다.',
      choices: [
        { label: '질문을 적극적으로 하게 한다', fx: { skill: { vocal: 2 }, stamina: -4 }, result: '날카로운 지적을 받았지만, 노트를 가득 채웠다.' },
        { label: '조용히 듣고 필요한 것만 챙기게 한다', fx: { mental: 3, skill: { vocal: 1 } }, result: '부담 없이 핵심만 가져왔다.' },
      ] },
    { id: 'late_night', bg: 'practice', title: '심야 연습', text: '밤 11시. 연습실 불이 아직 켜져 있다. 담당 연습생이 한 번만 더 맞춰 보고 싶다고 한다.',
      choices: [
        { label: '새벽까지 같이 연습한다', fx: { skill: { dance: 2 }, stamina: -9, trust: 2, ready: 3 }, result: '동작이 몸에 붙었다. 대신 눈 밑이 어둡다.' },
        { label: '오늘은 여기까지, 숙소로 보낸다', fx: { stamina: 6, mental: 2 }, result: '충분한 수면을 취했다. 아쉬움은 내일 풀자.' },
      ] },
    { id: 'hair', bright: true, bg: 'studio', title: '헤어 변신', text: '스타일리스트가 이미지 변신을 제안했다. 머리색과 길이를 바꿔 보자는 것이다.',
      choices: [
        { label: '과감하게 바꾼다', fx: { aw: 3, favor: 1 }, result: '"누구야?" 하는 반응이 터졌다. 호불호는 갈렸지만 화제가 됐다.' },
        { label: '결은 지키고 톤만 살짝 바꾼다', fx: { favor: 3 }, result: '자연스럽고 잘 어울린다는 평이 이어졌다.' },
      ] },
    { id: 'cam_fail', bg: 'backstage', title: '카메라 앞 실수', text: '리허설 중 안무 순서를 틀렸다. 하필 카메라가 가까이 있었다.',
      choices: [
        { label: '웃어넘기며 장난스럽게 대처하게 한다', fx: { favor: 2, mental: -2, aw: 1 }, result: '당황한 표정이 오히려 귀엽다는 반응을 얻었다.' },
        { label: '담담하게 사과하고 다시 맞춘다', fx: { mental: 1, trust: 1, ready: 2 }, result: '프로다운 태도라는 평이 돌았다.' },
      ] },
    { id: 'food_truck', bright: true, bg: 'dorm', title: '숙소 앞 푸드트럭', text: '팬들이 합숙소 앞에 푸드트럭을 보냈다. 연습생들의 눈이 반짝인다.',
      choices: [
        { label: '다 같이 나와서 인증샷을 찍는다', fx: { coh: 5, mental: 5, favor: 1 }, result: '팬 커뮤니티가 인증샷으로 도배됐다.' },
        { label: '조용히 포장해서 숙소에서 먹는다', fx: { mental: 6, stamina: 3 }, result: '모두가 배부르고 행복한 밤이었다.' },
      ] },
    { id: 'sleep_in', bg: 'dorm', title: '늦잠', text: '알람을 못 들었다. 집합 시간이 10분 남았다.',
      choices: [
        { label: '지금 바로 깨워 달려가게 한다', fx: { stamina: -4, mental: -3 }, result: '아슬아슬하게 도착했다. 숨이 가쁘다.' },
        { label: '늦더라도 정리하고 가게 한다', fx: { mental: 2, trust: -1, favor: -1 }, result: '지각 장면이 짧게 방송에 나갔다.' },
      ] },
    { id: 'dance_battle', bright: true, bg: 'practice', title: '즉흥 댄스 배틀', text: '쉬는 시간, 누군가 음악을 틀자 즉석 댄스 배틀이 벌어졌다. 담당 연습생도 눈이 번쩍 뜨였다.',
      choices: [
        { label: '나가서 한 번 보여 주라고 한다', fx: { favor: 3, aw: 2, stamina: -4, mental: 3 }, result: '환호성이 터졌다. 이 클립은 몇 만 조회수를 찍었다.' },
        { label: '구경하며 박수를 쳐 준다', fx: { mental: 4, coh: 1 }, result: '즐거운 분위기에 긴장이 풀렸다.' },
      ] },
    { id: 'sns_rumor', bg: 'office', title: 'SNS 루머', text: '근거 없는 루머가 커뮤니티에 올라왔다. 아직 퍼지진 않았지만 방치하기엔 찜찜하다.',
      choices: [
        { label: '짧은 공식 해명을 올린다 (자금 0.5)', cost: 0.5, fx: { funds: -0.5, favor: 1, mental: 2 }, result: '해명 글이 깔끔하게 정리돼 루머는 곧 가라앉았다.' },
        { label: '대응하지 않고 지켜본다', fx: { mental: -3, favor: -1 }, result: '루머는 조용히 사라졌지만 마음 한구석이 불편하다.' },
      ] },
    { id: 'mentor', bright: true, bg: 'studio', title: '선배 가수의 조언', text: '촬영장에 온 선배 가수가 담당 연습생에게 말을 걸었다. "무대에서 제일 중요한 게 뭔지 알아?"',
      choices: [
        { label: '대답을 연습생에게 맡긴다', fx: { mental: 6, skill: { charm: 1 } }, result: '"즐기는 거요." 선배가 웃으며 고개를 끄덕였다.' },
        { label: '메모를 옆에서 같이 정리한다', fx: { skill: { vocal: 1, dance: 1 }, trust: 2 }, result: '귀중한 팁이 한 페이지를 가득 채웠다.' },
      ] },
    { id: 'rain', bright: true, bg: 'dorm', title: '비 오는 날', text: '창밖에 비가 쏟아진다. 합숙소에는 라면 냄새가 퍼지고 있다.',
      choices: [
        { label: '다 같이 영화를 본다', fx: { mental: 8, coh: 1, stamina: 2 }, result: '모두가 이불을 덮고 한 시간 반을 보냈다. 시즌 중 가장 평화로운 밤이었다.' },
        { label: '그래도 한 번 더 연습한다', fx: { skill: { dance: 1 }, stamina: -5, mental: -1 }, result: '성실함은 칭찬받았지만 피로가 쌓였다.' },
      ] },
    { id: 'quiz', bg: 'studio', title: '예능 퀴즈 촬영', text: '짧은 퀴즈 코너가 잡혔다. 승부욕이 붙는 종목이다.',
      choices: [
        { label: '과감하게 나서서 답한다', fx: { skill: { variety: 2 }, aw: 3, stamina: -3 }, result: '엉뚱한 오답이 큰 웃음을 줬다. 분량이 늘어났다.' },
        { label: '팀원을 도우며 조용히 간다', fx: { favor: 2, coh: 2 }, result: '팀워크가 돋보였다.' },
      ] },
    { id: 'costume', bg: 'office', title: '의상비 고민', text: '이번 무대 의상을 직접 준비해야 한다. 예산이 빠듯하다.',
      choices: [
        { label: '자비로 괜찮은 의상을 맞춘다 (자금 1)', cost: 1, fx: { funds: -1, favor: 2, ready: 3 }, result: '무대에 딱 맞는 의상이 완성됐다.' },
        { label: '있는 것으로 최대한 꾸민다', fx: { mental: -1, ready: 1 }, result: '아쉽지만 아이디어로 커버했다.' },
      ] },
    { id: 'stage_fright', bg: 'backstage', title: '무대 공포', text: '리허설 직전, 담당 연습생의 손이 차갑게 식어 있다. "갑자기 너무 떨려요."',
      choices: [
        { label: '같이 호흡을 맞춰 준다', fx: { mental: 7, trust: 3 }, result: '숨을 몇 번 고르자 손끝에 온기가 돌아왔다.' },
        { label: '"넌 할 수 있어"라고 짧게 말한다', fx: { mental: 3, trust: 1 }, result: '고개를 끄덕였지만 여전히 긴장한 얼굴이다.' },
      ] },
    { id: 'birthday', bright: true, bg: 'dorm', title: '생일 파티', text: '동기 한 명의 생일이다. 숙소에서 몰래 깜짝 파티를 준비 중이다.',
      choices: [
        { label: '케이크를 사 와서 같이 축하한다 (자금 0.3)', fx: { funds: -0.3, mental: 8, coh: 2, favor: 1 }, result: '촛불을 끄는 순간 모두의 얼굴이 환했다.' },
        { label: '분위기만 거들고 빠진다', fx: { mental: 3 }, result: '파티는 성공적이었다.' },
      ] },
    { id: 'diet', bg: 'office', title: '다이어트 압박', text: '"카메라에 얼굴이 좀 부어 보이던데…" 누군가의 무심한 한마디에 분위기가 가라앉았다.',
      choices: [
        { label: '그런 말은 신경 쓰지 말라고 막는다', fx: { mental: 5, trust: 3 }, result: '매니저가 방패가 되어 주었다는 사실이 연습생에게 큰 힘이 됐다.' },
        { label: '식단을 살짝 조절하자고 제안한다', fx: { stamina: -4, mental: -4, trust: -2 }, result: '말은 따랐지만 표정이 굳었다.' },
      ] },
    { id: 'trainer_praise', bright: true, bg: 'practice', title: '트레이너의 칭찬', text: '엄하기로 소문난 트레이너가 처음으로 칭찬했다. "오늘 동작, 좋았어."',
      choices: [
        { label: '이 기세로 한 곡 더 맞춘다', fx: { skill: { dance: 2 }, mental: 4, stamina: -4 }, result: '자신감이 붙으니 동작이 더 부드러워졌다.' },
        { label: '칭찬을 만끽하게 한다', fx: { mental: 7 }, result: '오랜만에 환한 웃음이 나왔다.' },
      ] },
    { id: 'family_call', bright: true, bg: 'dorm', title: '가족의 전화', text: '가족에게서 전화가 왔다. "밥은 잘 먹고 있니? 방송 잘 보고 있어."',
      choices: [
        { label: '통화할 시간을 충분히 준다', fx: { mental: 9, trust: 1 }, result: '통화를 마친 연습생의 눈가가 촉촉했다. 그리고 한결 단단해졌다.' },
        { label: '짧게 끝내고 연습으로 돌아가게 한다', fx: { ready: 2, mental: 1 }, result: '아쉬워했지만 집중력은 올라갔다.' },
      ] },

    // ── 친구/라이벌 토큰 ──
    { id: 'friend_cheer', bright: true, bg: 'dorm', needs: 'friend', title: '친구의 응원', text: '{friend:이가} 간식을 들고 찾아왔다. "힘내라고 가져왔어. 우리 같이 데뷔하자!"',
      choices: [
        { label: '같이 간식을 먹으며 이야기한다', fx: { mental: 8, favor: 1, coh: 1 }, result: '둘이 나눠 먹는 모습이 방송 사이 짧게 나갔다. 훈훈하다는 반응이 많았다.' },
        { label: '고맙다고만 하고 연습을 이어간다', fx: { mental: 3, ready: 2 }, result: '마음만 받았다. 더 힘이 났다.' },
      ] },
    { id: 'rival_diss', bg: 'backstage', needs: 'rival', title: '라이벌의 신경전', text: '대기실에서 {rival:이가} 일부러 들으라는 듯 말했다. "순위가 아직도 그 정도야?"',
      choices: [
        { label: '대꾸하지 않고 웃어넘기게 한다', fx: { mental: -2, favor: 2, trust: 1 }, result: '의연한 태도가 오히려 좋은 인상을 줬다.' },
        { label: '정중하게, 하지만 단호하게 받아친다', fx: { aw: 3, mental: 2, favor: -1 }, result: '짧은 신경전이 화제가 됐다. 호불호는 갈렸다.' },
      ] },
    { id: 'friend_conflict', bg: 'practice', needs: 'friend', title: '친구와의 의견 충돌', text: '{friend:와과} 안무 해석을 두고 의견이 갈렸다. 분위기가 어색해졌다.',
      choices: [
        { label: '둘의 의견을 합친 절충안을 제안한다', fx: { mental: 2, coh: 1, skill: { dance: 1 }, trust: 2 }, result: '의외로 더 좋은 안무가 나왔다. 둘 다 만족한 표정이다.' },
        { label: '연습생의 판단을 믿고 밀어붙이게 한다', fx: { ready: 3, mental: -3 }, result: '결과는 좋았지만 어색함이 남았다.' },
      ] },
    { id: 'rival_help', bright: true, bg: 'backstage', needs: 'rival', title: '라이벌이 내민 손', text: '무대 직전, {rival:이가} 먼저 다가와 헤어핀을 건넸다. "네 무대 기대하고 있어. 우리 서로 최선을 다하자."',
      choices: [
        { label: '진심으로 고맙다고 답하게 한다', fx: { mental: 6, favor: 2 }, result: '서로를 존중하는 장면이 화제가 됐다.' },
        { label: '경계심을 풀지 않고 목례만 한다', fx: { mental: 1 }, result: '둘 사이에 묘한 긴장감이 흘렀다.' },
      ] },

    // ── 등급별 ──
    { id: 'big_support', bright: true, tiers: [1, 2], bg: 'office', title: '소속사의 풀 케어', text: '소속사가 전담 스타일링팀과 영양사를 붙여 주었다. 컨디션 관리에 큰 도움이 될 것이다.',
      choices: [
        { label: '식단과 수면 관리를 맡긴다', fx: { stamina: 10, mental: 4 }, result: '몸이 가벼워졌다. 대형사의 힘을 실감한다.' },
        { label: '스타일링에 집중해 이미지를 다듬는다', fx: { favor: 3, aw: 2 }, result: '비주얼이 한층 정돈됐다는 평이 돌았다.' },
      ] },
    { id: 'label_check', tiers: [1], bg: 'office', title: '실장의 점검', text: '소속사 실장이 연습실을 찾아왔다. "이번 순위, 목표는 TOP 5야."',
      choices: [
        { label: '현실적인 목표로 조율한다', fx: { mental: 4, trust: 3 }, result: '매니저가 방패가 되어 부담이 덜해졌다.' },
        { label: '그 목표에 맞춰 전력으로 간다', fx: { ready: 4, stamina: -5, mental: -3 }, result: '긴장감이 팽팽하다. 집중력은 높아졌다.' },
      ] },
    { id: 'budget_cut', tiers: [4, 5], bg: 'practice', title: '연습실 예약 취소', text: '대형사 연습생들이 연습실을 선점해서 예약이 밀려났다. 오늘은 갈 곳이 없다.',
      choices: [
        { label: '옥상이나 복도에서라도 연습한다', fx: { skill: { dance: 1 }, stamina: -5, mental: 2, trust: 2 }, result: '어디서든 해낸다는 의지에 직원들이 눈길을 줬다.' },
        { label: '자금을 써서 외부 스튜디오를 빌린다 (자금 1)', cost: 1, fx: { funds: -1, skill: { dance: 2 }, ready: 2 }, result: '쾌적한 환경에서 제대로 연습했다.' },
      ] },
    { id: 'free_help', bright: true, tiers: [4, 5], bg: 'practice', title: '선배의 도움', text: '같은 처지의 선배 연습생이 자신이 쓰던 연습 노트와 영상을 건네줬다.',
      choices: [
        { label: '감사 인사를 하고 열심히 활용한다', fx: { skill: { vocal: 1, dance: 1 }, mental: 5 }, result: '노트에는 오랜 시간의 노하우가 적혀 있었다.' },
        { label: '나중에 꼭 갚겠다고 약속한다', fx: { mental: 3, trust: 2, coh: 1 }, result: '훈훈한 뒷이야기가 팬들 사이에 퍼졌다.' },
      ] },
    { id: 'sponsor', bright: true, tiers: [3, 4, 5], bg: 'office', title: '작은 후원', text: '한 소규모 브랜드가 후원을 제안했다. 큰 금액은 아니지만 도움이 되는 정도다.',
      choices: [
        { label: '조건 없이 받는다', fx: { funds: 0.5, aw: 1 }, result: '작은 돈이지만 요긴하게 쓰일 것이다.' },
        { label: '광고 노출 조건을 걸고 더 받는다', fx: { funds: 1, aw: 3, favor: -1 }, result: '자금은 늘었지만 광고 티가 난다는 말도 있다.' },
      ] },
    { id: 'label_meeting', tiers: [2, 3], bg: 'office', title: '소속사 전략 회의', text: '소속사가 이번 시즌 전략을 두고 회의를 소집했다. 의견을 낼 기회다.',
      choices: [
        { label: '매니저 의견대로 장기 전략을 제안한다', fx: { trust: 3, funds: 0.3 }, result: '의견이 채택됐다. 지원도 소폭 늘었다.' },
        { label: '소속사 방침에 따라간다', fx: { mental: 1 }, result: '무난하게 끝났다.' },
      ] },

    // ── 주인공 전용 ──
    { id: 'o_yujin', only: 'yujin', bright: true, bg: 'studio', title: '쏟아지는 광고 제안', text: '화보와 광고 제안서가 쌓였다. 하지만 실력 논란이 있는 지금은 어떤 쪽이 득일까.',
      choices: [
        { label: '거절하고 연습에 집중한다', fx: { skill: { vocal: 2 }, stamina: -4, trust: 3 }, result: '"지금은 노래 연습이 먼저예요." 단단한 선언이 팬들에게 좋은 인상을 남겼다.' },
        { label: '하나만 골라 촬영한다', fx: { aw: 4, favor: 1, stamina: -3 }, result: '화보가 공개되자 커뮤니티가 들썩였다.' },
      ] },
    { id: 'o_chaewon', only: 'chaewon', bright: true, bg: 'dorm', title: '기말고사 기간', text: '채원은 아직 학생이다. 합숙소 책상 위에 시험지가 보인다.',
      choices: [
        { label: '하루만 공부에 집중하게 한다', fx: { mental: 5, stamina: 4, ready: -1 }, result: '"저도 학생이에요!" 오랜만에 또래다운 얼굴을 봤다.' },
        { label: '연습에 집중하게 한다', fx: { skill: { dance: 1 }, mental: -4 }, result: '채원은 입을 삐죽이면서도 따랐다.' },
      ] },
    { id: 'o_hayeon', only: 'hayeon', bg: 'dorm', title: '이전 팀 멤버의 소식', text: '하연의 옛 팀 멤버가 다른 팀으로 데뷔한다는 뉴스가 떴다. 하연이 말없이 화면을 들여다본다.',
      choices: [
        { label: '축하 메시지를 보내자고 권한다', fx: { mental: 3, trust: 3, favor: 1 }, result: '메시지를 보낸 뒤 하연은 오랜만에 가볍게 웃었다.' },
        { label: '지금은 자기 무대만 생각하자고 한다', fx: { mental: -3, ready: 2 }, result: '하연은 입술을 깨물었다.' },
      ] },
    { id: 'o_harin', only: 'harin', bright: true, bg: 'studio', title: '대본 리딩 제안', text: '드라마 제작진에게서 대본 리딩 제안이 왔다. 하린의 연기를 아는 사람들이다.',
      choices: [
        { label: '지금은 서바이벌에 집중한다고 거절한다', fx: { trust: 3, skill: { dance: 1 } }, result: '"오디션이 먼저예요." 하린의 눈빛이 단단해졌다.' },
        { label: '짧게 리딩만 해 보게 한다', fx: { aw: 3, favor: 1, stamina: -3 }, result: '현장 스태프들 사이에서 "역시"라는 말이 나왔다.' },
      ] },
    { id: 'o_daeun', only: 'daeun', bright: true, bg: 'studio', title: '예능 PD의 제안', text: '예능 PD가 다은을 눈여겨봤다. "고정 패널로 한 번 해 볼래요?"',
      choices: [
        { label: '정중히 거절하고 무대에 집중한다', fx: { skill: { vocal: 1 }, trust: 3, mental: 2 }, result: '다은이 "저 가수 하고 싶어요"라고 단단하게 말했다.' },
        { label: '일회성 게스트 출연만 받아들인다', fx: { aw: 4, favor: 2, stamina: -4 }, result: '출연 분량이 큰 인기를 끌었다.' },
      ] },
    { id: 'o_reina', only: 'reina', bright: true, bg: 'dorm', title: '고향과의 영상통화', text: '레이나가 일본의 가족과 영상통화를 한다. 목소리가 평소보다 부드럽다.',
      choices: [
        { label: '통화가 끝날 때까지 기다려 준다', fx: { mental: 8, trust: 2 }, result: '"마마가 보고 있어요, 열심히 하라고." 레이나의 눈이 반짝였다.' },
        { label: '통화 내용을 한국어로 정리해 보게 한다', fx: { skill: { variety: 1 }, mental: 3 }, result: '한국어 표현이 한 뼘 늘었다.' },
      ] },
    { id: 'o_seoyeon', only: 'seoyeon', bright: true, bg: 'practice', title: '라이브 직캠 화제', text: '서연의 연습실 라이브 영상이 퍼지고 있다. 평소 조용한 성격이라 본인도 놀랐다.',
      choices: [
        { label: '직접 소감 영상을 올려 보자고 권한다', fx: { coh: 4, favor: 2, aw: 3, stamina: -2 }, result: '어색하지만 진심이 느껴지는 영상이 큰 반응을 얻었다.' },
        { label: '반응은 팬들에게 맡기고 연습에 집중한다', fx: { skill: { vocal: 1 }, mental: 3 }, result: '조용히 팬이 늘어나는 중이다.' },
      ] },
    { id: 'o_jia', only: 'jia', bg: 'practice', title: '발레 스승의 연락', text: '지아의 발레 스승에게서 연락이 왔다. "아직도 네가 돌아오길 기다리고 있어."',
      choices: [
        { label: '결심을 전할 수 있도록 도와준다', fx: { mental: 5, trust: 3, skill: { charm: 1 } }, result: '지아의 눈빛에서 망설임이 사라졌다.' },
        { label: '지금은 대화를 뒤로 미루게 한다', fx: { mental: -2, ready: 2 }, result: '해야 할 일이 먼저다. 지아는 말없이 고개를 끄덕였다.' },
      ] },
    { id: 'o_yerin', only: 'yerin', bg: 'office', title: '팔로워 100만 돌파', text: '예린의 SNS 팔로워가 100만을 넘었다. 하지만 댓글 창은 여전히 응원 반 악플 반이다.',
      choices: [
        { label: '감사 라이브를 하며 직접 소통한다', fx: { coh: 6, favor: 2, stamina: -4 }, result: '직접 읽는 댓글과 진심 어린 답변이 호감을 샀다.' },
        { label: '숫자에 흔들리지 말고 무대 연습에 집중한다', fx: { skill: { vocal: 1, dance: 1 }, mental: 3 }, result: '조회수보다 실력이라는 태도가 눈에 띄었다.' },
      ] },
    { id: 'o_yuna', only: 'yuna', bg: 'office', title: '옛 팬카페 방문', text: '유나의 옛 팀 팬카페에서 응원 글이 올라왔다. "다시 무대에 서는 모습이 너무 반가워요."',
      choices: [
        { label: '직접 감사 인사를 남긴다', fx: { coh: 6, favor: 2, mental: 5 }, result: '오래된 팬들이 눈물의 댓글을 남겼다.' },
        { label: '과거 이야기는 최소화한다', fx: { mental: -1, aw: 1 }, result: '현재에 집중하는 모습이 일관돼 보였다.' },
      ] },
    { id: 'o_taeri', only: 'taeri', bg: 'backstage', title: '팀원들의 미묘한 시선', text: '대기실에서 팀원들이 태리와 눈을 마주치지 않는다. 방송 후 오해가 퍼진 모양이다.',
      choices: [
        { label: '태리가 먼저 말을 걸어 보게 한다', fx: { coh: 2, favor: 1, mental: -2, trust: 2 }, result: '어색한 대화가 오갔다. 하지만 얼음 한 겹이 녹았다.' },
        { label: '결과로 증명하자고 격려한다', fx: { mental: 3, ready: 3 }, result: '태리의 눈빛이 날카로워졌다.' },
      ] },
    { id: 'o_sodam', only: 'sodam', bg: 'office', title: '알바 연락', text: '소담이 일하던 카페 사장님에게서 연락이 왔다. "복귀하면 시급 올려 줄게. 방송 잘 보고 있어."',
      choices: [
        { label: '거절하고 연습에 집중하게 한다', fx: { skill: { vocal: 1, dance: 1 }, mental: 3, funds: -0.2 }, result: '소담은 아쉬워하면서도 단호하게 거절했다.' },
        { label: '주말 몇 시간만 하게 한다 (자금 +0.5)', fx: { funds: 0.5, stamina: -6 }, result: '생활비에 조금 보탬이 됐다. 몸은 고되다.' },
      ] },
  ];
  D.daily = (D.daily || []).concat(extra);

  // 서사 3막 (10주차 준비 주간). protagonists의 arc.beats 뒤에 추가
  const thirdBeats = {
    yujin: { title: '마지막 평가 전날', text: '유진이 거울 앞에서 한참 서 있다. "이제 얼굴 말고 무대로 평가받고 싶어요."',
      choices: [
        { label: '"넌 이미 충분히 노력했어. 믿어."', arc: 1, fx: { mental: 6, trust: 4 }, result: '유진이 크게 숨을 들이쉬었다. 표정에 확신이 있었다.' },
        { label: '"비주얼은 이미 합격이야."', arc: -1, fx: { mental: 1 }, result: '유진은 말없이 웃었다.' } ] },
    chaewon: { title: '언니들의 응원', text: '최종 평가 전날, 선배들이 채원에게 다가왔다. "네가 제일 대견해."',
      choices: [
        { label: '채원이 스스로 대답하게 둔다', arc: 1, fx: { mental: 7, coh: 2 }, result: '"저, 언니들이랑 같이 데뷔하고 싶어요." 용기 있는 대답이었다.' },
        { label: '분위기를 풀어 주며 대신 웃는다', arc: 0, fx: { mental: 3 }, result: '따뜻한 순간이 지나갔다.' } ] },
    hayeon: { title: '순위 발표 직전', text: '하연이 대기실에서 손을 쥐었다 폈다 한다. "…그때처럼 이름이 안 불리면 어떡하죠."',
      choices: [
        { label: '"불리든 안 불리든 넌 여기까지 왔어."', arc: 1, fx: { mental: 8, trust: 5 }, result: '하연이 눈을 감고 길게 숨을 내쉬었다. 손떨림이 멎었다.' },
        { label: '"괜찮을 거야, 안 떨어져."', arc: -1, fx: { mental: 1 }, result: '근거 없는 위로라는 걸 하연도 알았다.' } ] },
    harin: { title: '진짜 표정', text: '하린이 카메라 리허설에서 처음으로 표정을 꾸미지 않았다. 감독이 말했다. "방금 그게 제일 좋아."',
      choices: [
        { label: '그 표정을 무대에 가져가자고 한다', arc: 1, fx: { favor: 3, mental: 4, skill: { charm: 2 } }, result: '꾸미지 않은 표정이 오히려 가장 강렬했다.' },
        { label: '안정적으로 기존 표정을 쓰게 한다', arc: 0, fx: { ready: 2 }, result: '무난하고 안전한 선택이었다.' } ] },
    daeun: { title: '웃음기 없는 무대', text: '다은이 마지막 곡을 웃음 없이 부르기로 했다. "이번엔 정말 진지하게 하고 싶어요."',
      choices: [
        { label: '마음껏 해 보라고 밀어 준다', arc: 1, fx: { skill: { vocal: 2 }, mental: 4, favor: 2 }, result: '끝까지 웃지 않은 무대가 오히려 뭉클하다는 반응을 얻었다.' },
        { label: '중간에 한 번은 웃음을 넣자고 한다', arc: 0, fx: { favor: 1, mental: 2 }, result: '다은다운 무대가 됐다.' } ] },
    reina: { title: '한국어로 전하는 마음', text: '레이나가 최종 무대에서 팬들에게 한국어로 한마디를 하고 싶다고 한다.',
      choices: [
        { label: '직접 써 보게 하고 같이 다듬는다', arc: 1, fx: { favor: 3, coh: 4, mental: 4 }, result: '서툴지만 마음이 담긴 한마디가 팬들을 울렸다.' },
        { label: '매니저가 대신 써 준다', arc: -1, fx: { favor: 1 }, result: '깔끔했지만 레이나의 목소리는 아니었다.' } ] },
    seoyeon: { title: '함께 서는 무대', text: '서연이 팀원들에게 먼저 다가갔다. "마지막 무대, 같이 맞춰 보지 않을래?"',
      choices: [
        { label: '팀원들이 흔쾌히 받아주도록 분위기를 만든다', arc: 1, fx: { coh: 3, mental: 5, trust: 3 }, result: '연습실에 처음으로 웃음소리가 가득 찼다.' },
        { label: '서연이 스스로 이어가게 둔다', arc: 0, fx: { mental: 2 }, result: '쑥스러웠지만 합이 맞았다.' } ] },
    jia: { title: '틀을 벗어난 한 동작', text: '안무가가 마지막 무대에 지아의 즉흥 동작을 넣자고 제안했다. 정해진 틀이 없는 동작이다.',
      choices: [
        { label: '지아가 하고 싶은 대로 해 보게 한다', arc: 1, fx: { skill: { charm: 2 }, favor: 3, mental: 3 }, result: '정확하기만 했던 지아의 몸이 처음으로 자유롭게 움직였다.' },
        { label: '안정적인 안무를 고수한다', arc: -1, fx: { ready: 3 }, result: '완성도는 높았지만 인상은 평이했다.' } ] },
    yerin: { title: '숫자가 아닌 응원', text: '예린이 팬 편지 한 통을 오래 들여다본다. "저, 이 사람 이름을 알아요. 처음부터 있었던 사람이에요."',
      choices: [
        { label: '그 팬에게 직접 답장을 쓰게 한다', arc: 1, fx: { coh: 6, favor: 3, mental: 4 }, result: '답장이 공개되자 오랜 팬들이 감격했다.' },
        { label: '전체 팬에게 공지로 감사를 전한다', arc: 0, fx: { coh: 3, aw: 2 }, result: '무난하게 감사가 전해졌다.' } ] },
    yuna: { title: '마지막 기회의 의미', text: '유나가 중얼거린다. "이번이 정말 마지막 무대예요. 그래서 오히려 무섭지 않아요."',
      choices: [
        { label: '"그래, 후회 없이 하자."', arc: 1, fx: { mental: 6, trust: 4, skill: { vocal: 1 } }, result: '유나의 눈빛이 잔잔하게 빛났다.' },
        { label: '"아직 끝이 아니야, 또 기회는 있어."', arc: 0, fx: { mental: 3 }, result: '위로는 됐지만 유나는 조용히 고개를 저었다.' } ] },
    taeri: { title: '누명이 벗겨진 날', text: '커뮤니티에 첫 방송 장면의 원본 영상이 올라왔다. 태리의 말이 앞뒤가 잘려 있었다는 사실이 퍼지고 있다.',
      choices: [
        { label: '이 기회에 정중하게 입장을 밝힌다', arc: 1, fx: { favor: 6, coh: 5, aw: 3 }, result: '담담한 입장문이 큰 반향을 일으켰다. 여론이 한 번에 뒤집히는 순간이었다.' },
        { label: '조용히 지켜보며 무대에 집중한다', arc: 0, fx: { favor: 3, ready: 2 }, result: '말 없이도 시간이 그의 편이 되기 시작했다.' } ] },
    sodam: { title: '혼자가 아닌 무대', text: '소담이 처음으로 팀원들 앞에서 말했다. "고마워. 나 혼자였으면 여기까지 못 왔어."',
      choices: [
        { label: '팀원들과 같이 영상을 찍어 남긴다', arc: 1, fx: { coh: 6, favor: 4, mental: 6 }, result: '함께 웃는 모습이 영상 한 장면으로 남았다. 팬들이 눈물 이모티콘으로 답했다.' },
        { label: '소담이 스스로 여운을 즐기게 둔다', arc: 0, fx: { mental: 4 }, result: '조용한 감사가 오갔다.' } ] },
  };
  (D.protagonists || []).forEach((p) => { if (thirdBeats[p.id]) p.arc.beats.push(thirdBeats[p.id]); });
})(typeof window !== 'undefined' ? window : global);
