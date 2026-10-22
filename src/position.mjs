// 기록으로 포지션 추정. 선수 데이터에 포지션이 없을 때 쓴다 (로스터 CSV의 position이 있으면 그쪽이 우선).
// 기준은 36분당 리바운드·어시스트로, 2025-26 KBL 기록의 분포(센터급 외국 선수 10~17개, 가드 3개 이하)에 맞췄다.
// 정확한 포지션이 아니라 "역할 추정"이다.
export function inferPosition(totals) {
  const k = 36 / Math.max(1, totals.minutes);
  const reb = totals.rebounds * k;
  const ast = totals.assists * k;
  if (reb >= 9.5) return 'C';
  if (reb >= 6.6) return 'PF';
  if (reb >= 4.6) return 'SF';
  return ast >= 4.8 ? 'PG' : 'SG';
}
