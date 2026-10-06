(function (g) {
  g.GameData = g.GameData || {};

  // tier: 1 초대형 / 2 대형·중견 / 3 중소형 / 4 소형·신생 / 5 무소속
  // slots 합계 = 101
  g.GameData.labels = [
    { id: 'HYBE', name: 'HYBE', tier: 1, slots: 6, color: '#7b5cff', funds: 8 },
    { id: 'SM', name: 'SM', tier: 1, slots: 6, color: '#2fb8a6', funds: 8 },
    { id: 'JYP', name: 'JYP', tier: 1, slots: 6, color: '#3b82f6', funds: 7 },
    { id: 'YG', name: 'YG', tier: 1, slots: 6, color: '#222222', funds: 7 },
    { id: 'STARSHIP', name: '스타쉽', tier: 2, slots: 4, color: '#f59e0b', funds: 5 },
    { id: 'CUBE', name: '큐브', tier: 2, slots: 3, color: '#ef4444', funds: 5 },
    { id: 'PLEDIS', name: '플레디스', tier: 2, slots: 3, color: '#ec4899', funds: 5 },
    { id: 'WELLMADE', name: '웰메이드', tier: 2, slots: 3, color: '#84cc16', funds: 5 },
    { id: 'FNC', name: 'FNC', tier: 2, slots: 3, color: '#0ea5e9', funds: 5 },
    { id: 'WOOLLIM', name: '울림', tier: 2, slots: 3, color: '#a855f7', funds: 4 },
    { id: 'FANTAGIO', name: '판타지오', tier: 3, slots: 3, color: '#14b8a6', funds: 3 },
    { id: 'JELLY', name: '젤리피쉬', tier: 3, slots: 3, color: '#f472b6', funds: 3 },
    { id: 'KQ', name: 'KQ', tier: 3, slots: 3, color: '#64748b', funds: 3 },
    { id: 'ABYSS', name: '어비스컴퍼니', tier: 3, slots: 3, color: '#0f766e', funds: 3 },
    { id: 'WM', name: 'WM', tier: 3, slots: 3, color: '#b45309', funds: 3 },
    { id: 'RBW', name: 'RBW', tier: 3, slots: 3, color: '#be123c', funds: 3 },
    { id: 'NEW1', name: '신생 기획사 A', tier: 4, slots: 2, color: '#78716c', funds: 2 },
    { id: 'NEW2', name: '신생 기획사 B', tier: 4, slots: 2, color: '#78716c', funds: 2 },
    { id: 'NEW3', name: '신생 기획사 C', tier: 4, slots: 2, color: '#78716c', funds: 2 },
    { id: 'NEW4', name: '신생 기획사 D', tier: 4, slots: 2, color: '#78716c', funds: 2 },
    { id: 'NEW5', name: '신생 기획사 E', tier: 4, slots: 2, color: '#78716c', funds: 2 },
    { id: 'NEW6', name: '신생 기획사 F', tier: 4, slots: 1, color: '#78716c', funds: 2 },
    { id: 'NEW7', name: '신생 기획사 G', tier: 4, slots: 1, color: '#78716c', funds: 2 },
    { id: 'NEW8', name: '신생 기획사 H', tier: 4, slots: 1, color: '#78716c', funds: 2 },
    { id: 'NEW9', name: '신생 기획사 I', tier: 4, slots: 1, color: '#78716c', funds: 2 },
    { id: 'NEW10', name: '신생 기획사 J', tier: 4, slots: 1, color: '#78716c', funds: 2 },
    { id: 'FREE', name: '무소속', tier: 5, slots: 25, color: '#9ca3af', funds: 1 },
  ];

  // 티어별 시작 보정 / 방송 노출 배율
  g.GameData.tier = {
    skillBonus: { 1: 6, 2: 3, 3: 0, 4: -2, 5: -2 },
    awareness: { 1: [35, 55], 2: [20, 40], 3: [10, 25], 4: [5, 15], 5: [3, 15] },
    fans: { 1: [20000, 80000], 2: [8000, 35000], 3: [2000, 12000], 4: [500, 4000], 5: [200, 3000] },
    exposure: { 1: 1.3, 2: 1.05, 3: 0.85, 4: 0.7, 5: 0.6 },
  };

  // 미션 (index 0 = 첫 평가, 1~5 = 라운드, 6 = 최종 생방송)
  // w: 점수 가중치 / team: 팀 미션 / serious: 진지한 무대
  g.GameData.missions = [
    { name: '첫 등급 평가', kind: '개인 무대', w: { vocal: 0.3, dance: 0.3, rap: 0.1, charm: 0.3 } },
    { name: '그룹 배틀', kind: '그룹 미션', team: true, w: { vocal: 0.3, dance: 0.35, rap: 0.1, charm: 0.25 } },
    { name: '팀 배틀', kind: '팀 미션', team: true, w: { vocal: 0.25, dance: 0.35, rap: 0.2, charm: 0.2 } },
    { name: '포지션 평가', kind: '포지션 무대', w: { vocal: 0.35, dance: 0.35, rap: 0.2, charm: 0.1 } },
    { name: '콘셉트 평가', kind: '콘셉트 무대', serious: true, w: { vocal: 0.2, dance: 0.25, rap: 0.1, charm: 0.3, variety: 0.15 } },
    { name: '파이널 준비 무대', kind: '데뷔곡 무대', serious: true, team: true, w: { vocal: 0.3, dance: 0.3, rap: 0.1, charm: 0.3 } },
    { name: '최종 생방송', kind: '데뷔 평가 무대', serious: true, w: { vocal: 0.3, dance: 0.3, rap: 0.1, charm: 0.3 } },
  ];

  // 라운드 종료 시 남는 인원 (index = round)
  g.GameData.cuts = { 1: 60, 2: 35, 3: 22, 4: 16, 5: 13, 6: 11 };

  // 투표 방식 (index = round, 0 = 첫 평가 / 6 = 최종)
  g.GameData.voting = {
    0: { k: 11, text: '11명 선택', note: '두루 호감인 참가자가 유리' },
    1: { k: 11, text: '11명 선택', note: '두루 호감인 참가자가 유리' },
    2: { k: 11, text: '11명 선택', note: '두루 호감인 참가자가 유리' },
    3: { k: 5, text: '5명 선택', note: '고정 팬덤의 비중이 커진다' },
    4: { k: 5, text: '5명 선택', note: '고정 팬덤의 비중이 커진다' },
    5: { k: 3, text: '3명 선택', note: '고정 팬덤이 승부를 가른다' },
    6: { k: 1, text: '1명 선택', note: "'최애'로 선택받는 힘이 결정적" },
  };

  g.GameData.names = {
    surname: ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍', '전', '고', '문', '양', '손', '배', '백', '허', '유', '남'],
    given: ['서', '지', '하', '민', '유', '채', '은', '다', '예', '수', '아', '연', '나', '현', '소', '윤', '린', '희', '영', '진', '솔', '빈', '비', '주', '원', '담', '우', '이', '율', '온'],
  };
})(typeof window !== 'undefined' ? window : global);
