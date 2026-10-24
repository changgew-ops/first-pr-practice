// 구단별 화면 강조색. 실제 구단 CI가 아니라 화면 구분용으로 정한 색이다. (구단 로고 이미지는 사용자가 제공한 것을 web/lib/emblem.js가 쓴다.)
export const TEAM_COLOR = {
  'wonju-db': '#2fb36d', 'seoul-samsung': '#4a7bff', 'goyang-sono': '#ff8a3d', 'seoul-sk': '#ff5a5a', 'changwon-lg': '#e0436b',
  'anyang-jungkwanjang': '#e8523a', 'busan-kcc': '#3cc3d6', 'suwon-kt': '#d94cc0', 'daegu-kogas': '#7a6cff', 'ulsan-hyundai-mobis': '#2e9bd6'
};
export const colorOf = (id) => TEAM_COLOR[id] ?? '#ff7a1a';
