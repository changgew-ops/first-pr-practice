(function (g) {
  g.GameData = g.GameData || {};

  // fx 키: skill{}, stamina, mental, trust, favor, aw(인지도), coh(팬덤 결속), funds, fans, ready(미션 준비), risk/guard(편집 위험)
  // 매니저 집중 행동 (주당 2개). phase: 어느 주간에 쓸 수 있는가
  g.GameData.actions = [
    { id: 'train_vocal', label: '보컬 집중 훈련', desc: '보컬 ↑ / 체력 ↓', phase: ['prep'], train: 'vocal', fx: { stamina: -10 } },
    { id: 'train_dance', label: '댄스 집중 훈련', desc: '댄스 ↑ / 체력 ↓', phase: ['prep'], train: 'dance', fx: { stamina: -10 } },
    { id: 'train_rap', label: '랩 집중 훈련', desc: '랩 ↑ / 체력 ↓', phase: ['prep'], train: 'rap', fx: { stamina: -10 } },
    { id: 'train_charm', label: '표정·무대매너 훈련', desc: '매력 ↑ / 체력 ↓', phase: ['prep'], train: 'charm', fx: { stamina: -8 } },
    { id: 'train_variety', label: '예능·소통 훈련', desc: '끼 ↑ / 체력 ↓', phase: ['prep'], train: 'variety', fx: { stamina: -8 } },
    { id: 'negotiate_main', label: '메인 파트 협상', desc: '성공 시 노출·보상 ↑ (실패하면 갈등 위험)', phase: ['prep'], special: 'negotiate_main' },
    { id: 'negotiate_safe', label: '안정적인 파트로 조율', desc: '무난한 파트 확보, 갈등 없음', phase: ['prep'], special: 'negotiate_safe' },
    { id: 'analyze', label: '매니저 분석', desc: '이번 미션에서 무엇이 점수를 만드는지 구체적으로 알려줌', phase: ['prep', 'broadcast'], special: 'analyze' },
    { id: 'mediate', label: '관계 중재', desc: '팀 갈등·소통 문제 완화, 편집 위험 ↓', phase: ['prep', 'broadcast'], special: 'mediate' },
    { id: 'rehearse', label: '미션 리허설', desc: '준비도 ↑ / 체력 소폭 ↓', phase: ['prep', 'broadcast'], fx: { ready: 6, stamina: -5 } },
    { id: 'condition', label: '컨디션 조절', desc: '체력·멘탈 회복', phase: ['broadcast'], fx: { stamina: 14, mental: 8 } },
    { id: 'counsel', label: '멘탈 상담', desc: '멘탈 큰 회복, 신뢰 ↑', phase: ['prep', 'broadcast'], fx: { mental: 14, trust: 2 } },
    { id: 'promo', label: '홍보 영상 제작 (자금 1.5)', desc: '인지도 ↑ / 결속 ↑ / 자금 소모', phase: ['broadcast'], cost: 1.5, fx: { aw: 4, coh: 3 } },
    { id: 'fanservice', label: '팬 소통 (SNS 라이브)', desc: '팬덤 결속 ↑ / 체력 소폭 ↓', phase: ['prep', 'broadcast'], fx: { coh: 8, favor: 1, stamina: -4 } },
    { id: 'interview_prep', label: '인터뷰·발언 점검', desc: '이번 편집 위험 크게 ↓', phase: ['prep', 'broadcast'], fx: { guard: 0.15, stamina: -2 } },
  ];

  // 일상 이벤트 풀. bright: 밝은 일상 (큰 억까 직후 우선 배치)
  g.GameData.daily = [
    { id: 'chicken', bright: true, bg: 'dorm', title: '야식 타임', text: '합숙 3일차. 연습이 끝나고 아이들이 숙소에 모였다. 누군가 치킨 이야기를 꺼냈다.',
      choices: [
        { label: '치킨을 시켜 준다 (자금 0.3)', fx: { funds: -0.3, mental: 8, coh: 2 }, result: '숙소가 한바탕 웃음바다가 됐다. 이 장면은 훗날 "레전드 먹방"으로 불린다.' },
        { label: '식단 관리를 하자고 말린다', fx: { stamina: 3, mental: -3 }, result: '체력은 지켰지만 분위기가 살짝 가라앉았다.' },
      ] },
    { id: 'roommate', bright: true, bg: 'dorm', title: '룸메이트와의 밤', text: '같은 방을 쓰는 동료가 잠들지 못하고 뒤척인다. 담당 연습생도 눈을 뜨고 있다.',
      choices: [
        { label: '불을 켜고 같이 수다를 떨게 한다', fx: { mental: 6, trust: 2, favor: 1 }, result: '새벽까지 이어진 수다가 훗날 서로를 응원하는 계기가 됐다.' },
        { label: '푹 자라고 말한다', fx: { stamina: 6 }, result: '다음 날 컨디션이 좋았다.' },
      ] },
    { id: 'fanletter', bright: true, bg: 'office', title: '팬레터', text: '첫 팬레터가 도착했다. 삐뚤빼뚤한 손글씨로 "정말 좋아해요"라고 적혀 있다.',
      choices: [
        { label: '연습생에게 직접 읽게 한다', fx: { mental: 8, coh: 3, trust: 1 }, result: '편지를 읽는 목소리가 떨렸다. 그날 연습은 평소보다 훨씬 집중됐다.' },
        { label: '공개 답장을 올린다', fx: { aw: 2, coh: 5, favor: 1 }, result: '답장 영상이 작은 화제가 됐다.' },
      ] },
    { id: 'trainer', bg: 'practice', title: '트레이너의 쓴소리', text: '보컬 트레이너가 연습 후 표정을 굳히고 말했다. "오늘 컨디션이 좋지 않았어요."',
      choices: [
        { label: '변명하지 않고 피드백을 받아들인다', fx: { skill: { vocal: 2 }, mental: -2, trust: 2 }, result: '쓴소리는 아팠지만 확실히 도움이 됐다.' },
        { label: '컨디션 문제라고 대신 설명한다', fx: { mental: 3, trust: -1 }, result: '트레이너가 고개를 끄덕였지만 평가는 그대로였다.' },
      ] },
    { id: 'rival_talk', bg: 'backstage', title: '대기실에서 만난 라이벌', text: '대기실에서 순위가 가까운 참가자와 마주쳤다. 먼저 말을 건넨 쪽은 상대다.',
      choices: [
        { label: '응원하며 인사를 나눈다', fx: { favor: 2, mental: 3, coh: 1 }, result: '훈훈한 장면이 카메라에 잡혔다.' },
        { label: '눈빛으로 견제한다', fx: { aw: 2, mental: -2 }, result: '긴장감 있는 분위기가 연출됐다. 팬 반응은 반반이었다.' },
      ] },
    { id: 'photo', bright: true, bg: 'studio', title: '화보 촬영', text: '쉬는 시간에 짧은 화보 촬영이 잡혔다. 카메라 앞에서 어떤 콘셉트로 갈까?',
      choices: [
        { label: '밝고 장난기 있는 콘셉트', fx: { favor: 3, aw: 2, stamina: -3 }, result: '친근한 이미지가 팬들에게 좋은 반응을 얻었다.' },
        { label: '성숙하고 시크한 콘셉트', fx: { aw: 4, stamina: -3 }, result: '새로운 모습에 화제가 됐지만 호불호가 갈렸다.' },
      ] },
    { id: 'injury', bg: 'practice', title: '삐끗한 발목', text: '연습 중 발목을 살짝 접질렀다. 심하진 않지만 신경 쓰이는 정도다.',
      choices: [
        { label: '오늘은 무조건 쉬게 한다', fx: { stamina: 8, mental: -2 }, result: '큰 부상은 피했다. 다만 연습 시간이 줄었다.' },
        { label: '테이핑하고 계속 연습한다', fx: { skill: { dance: 2 }, stamina: -10, mental: -3 }, result: '동작은 맞췄지만 통증이 신경 쓰인다.' },
      ] },
    { id: 'snack', bright: true, bg: 'dorm', title: '간식 차 도착', text: '팬들이 서포트한 간식 차가 도착했다. 연습생들이 환호성을 지른다.',
      choices: [
        { label: '팬들에게 감사 영상을 찍는다', fx: { coh: 6, favor: 2, stamina: -2 }, result: '진심 어린 영상이 팬들의 결속을 더 단단하게 했다.' },
        { label: '그냥 즐겁게 받는다', fx: { mental: 6 }, result: '든든한 간식에 모두의 기분이 좋아졌다.' },
      ] },
    { id: 'staff', bg: 'office', title: '제작진의 접근', text: '카메라 감독이 슬쩍 다가왔다. "이번에는 개인 인터뷰 따로 따볼게요. 편하게 해 주세요."',
      choices: [
        { label: '신중하게 응하고 발언을 점검한다', fx: { guard: 0.1, stamina: -2 }, result: '매니저가 옆에서 질문을 미리 체크했다. 안정적인 인터뷰였다.' },
        { label: '편하게 하라고 한다', fx: { favor: 1, risk: 0.05 }, result: '자연스러운 인터뷰가 됐다. 어떻게 쓰일지는 모른다.' },
      ] },
    { id: 'mv', bright: true, bg: 'studio', title: '현장 직캠 화제', text: '어제 연습 중 찍힌 직캠이 커뮤니티에서 돌고 있다.',
      choices: [
        { label: '이 기세를 타 공식 영상을 올린다', fx: { aw: 4, favor: 1, stamina: -3 }, result: '관심이 크게 늘었다.' },
        { label: '그냥 흘러가게 둔다', fx: { aw: 2 }, result: '조용히 화제가 이어졌다.' },
      ] },
    { id: 'pressure', bg: 'office', title: '소속사의 연락', text: '소속사 실장이 전화를 걸어 왔다. "이번에는 꼭 결과를 내야 해. 알지?"',
      choices: [
        { label: '부담을 대신 짊어진다', fx: { mental: 3, trust: 3, stamina: -3 }, result: '연습생은 매니저가 자기 편이라는 걸 느꼈다.' },
        { label: '연습생에게 그대로 전달한다', fx: { mental: -6, trust: -3, ready: 4 }, result: '연습생은 긴장했고, 준비도는 높아졌지만 표정이 굳었다.' },
      ] },
    { id: 'idea', bright: true, bg: 'practice', title: '안무 아이디어', text: '연습생이 안무 중 즉흥적인 동작을 하나 제안했다. 의외로 괜찮아 보인다.',
      choices: [
        { label: '채택해서 무대에 넣는다', fx: { skill: { charm: 2 }, favor: 1, ready: 3 }, result: '새로운 포인트 안무가 만들어졌다.' },
        { label: '원래 안무를 지킨다', fx: { ready: 2 }, result: '안정적인 선택이었다.' },
      ] },
  ];

  // 억까 연쇄 단계별 텍스트 (kind는 주인공 edit.kind를 따라 문구에 삽입)
  g.GameData.chain = {
    conflict: {
      title: '파트 배분 갈등',
      text: '팀 연습 중 파트 분배를 두고 의견이 엇갈렸다. 목소리가 높아진 순간, 카메라가 이쪽을 향했다. 제작진이 이 장면에 관심을 보이는 눈치다.',
      choices: [
        { label: '중재한다 (분위기를 가라앉힌다)', fx: { risk: -0.1, trust: 2, stamina: -3 }, result: '팀원들의 감정이 풀렸다. 제작진은 아쉬운 표정을 지었다.', resolved: true },
        { label: '연습생이 직접 맞서게 한다', fx: { risk: 0.12, aw: 2, coh: 2 }, result: '단호한 모습이 눈에 띄었다. 편집 방향이 어떨지 장담할 수 없다.' },
        { label: '한 발 물러난다', fx: { risk: 0.03, mental: -4 }, result: '갈등은 일단 접혔지만 마음 한구석이 불편하다.' },
      ],
    },
    interview: {
      title: '인터뷰 요청',
      text: '제작진이 개인 인터뷰를 요청했다. 질문 몇 개는 갈등 상황에 대한 이야기가 될 것 같다.',
      choices: [
        { label: '질문을 미리 점검하고 철저히 준비한다', fx: { guard: 0.2, stamina: -3 }, result: '발언 하나하나를 정리했다. 위험한 답변은 피할 수 있을 것이다.' },
        { label: '평소처럼 자연스럽게 임한다', fx: {}, result: '무난하게 끝났다.' },
        { label: '솔직하게 다 말한다', fx: { risk: 0.1, favor: 1 }, result: '진솔한 이야기가 나왔지만, 어떻게 편집될지는 모른다.', honest: true },
      ],
    },
    response: {
      title: '방송 후 대응',
      text: '방송이 나가자 반응이 심상치 않다. 커뮤니티에서는 편집 의도에 대한 의견이 갈리고 있다. 어떻게 대응할까?',
    },
  };

  // 위기 단계 (체력/멘탈 0 즉시 하차 금지)
  g.GameData.crisis = {
    warn: '컨디션 경고: 얼굴빛이 좋지 않다. 이대로 가면 무대 퍼포먼스에 영향이 간다.',
    low: '수행 능력 저하: 기본 연습 효율이 눈에 띄게 떨어졌다. 휴식이나 상담이 필요하다.',
    talkIntro: '연습생이 조용히 말을 꺼냈다. 이 이야기를 어떻게 이어갈까?',
  };

  // 엔딩 문구 (3축 조합)
  g.GameData.endings = {
    result: {
      center: { title: '센터 데뷔', text: '1위로 호명되는 순간, 모든 조명이 담당 연습생에게 쏟아졌다.' },
      debut: { title: '데뷔조 합류', text: '이름이 불렸다. 11명의 데뷔조 안에 이름을 올렸다.' },
      final: { title: '파이널 아쉬운 탈락', text: '마지막 문턱에서 데뷔조에는 들지 못했다. 그러나 최종 무대까지 서 본 시간은 사라지지 않는다.' },
      out: { title: '중도 탈락', text: '순위 발표에서 이름이 불리지 않았다. 여정은 거기서 끝났다.' },
    },
    bond: {
      deep: '매니저와는 서로에게 가장 믿을 만한 사람이 되었다.',
      work: '매니저와는 일로 만난 좋은 파트너로 남았다.',
      broke: '시즌이 끝날 무렵 매니저와의 관계는 서먹해져 있었다.',
    },
    // 탈락 후 서사 엔딩 (arc 해소 + 호감 보유 시)
    comeback: '탈락의 아쉬움 속에서도 자신감을 되찾았다. 얼마 뒤, 작은 신생 회사에서 새로운 준비를 시작했다는 소식이 들려왔다.',
    withdraw: '자진 하차를 선택했다. 하지만 매니저는 곁에서 오랫동안 이야기를 들어 주었다.',
  };
})(typeof window !== 'undefined' ? window : global);
