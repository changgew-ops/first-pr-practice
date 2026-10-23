// OVR·능력치 변화 표시용 순수 함수. 기준값(ovrWas·statsWas)은 "지난 시즌 종료 시점(오프시즌 성장·노화 직전)"의 값이다.
// 게임 시작에서는 시작 값이 기준이라 첫 시즌 중 갱신(기록 기반 갱신·훈련)이 변화로 보인다. 새로 들어온 선수는 기준이 없어 변화가 없다.
export const deltaOf = (now, was) => (now == null || was == null ? 0 : now - was);
export const ovrDelta = (p) => deltaOf(p.ovr, p.ovrWas);
export const statDelta = (p, key) => deltaOf(p.stats?.[key], p.statsWas?.[key]);
/** 3 → "(+3)", -2 → "(-2)", 0 → "" */
export const deltaText = (d) => (d ? `(${d > 0 ? '+' : '-'}${Math.abs(d)})` : '');
export const deltaClass = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : '');
export const DELTA_TITLE = '지난 시즌 종료 시점 대비';
