// 가상 뉴스와 팬 커뮤니티 반응 생성기. 순수 함수(node 전용 모듈 없음)라 브라우저와 테스트가 같이 쓴다.
//
// 뉴스는 저장하지 않는 "파생 데이터"다. 세션이 가진 시즌 결과·순위·박스스코어·오프시즌 보고서와 시드에서
// 언제나 같은 기사·댓글을 다시 만든다. 기사의 숫자와 이름은 모두 실제 상태에서 채우고,
// 문장은 그 숫자로 확인할 수 있는 말만 쓴다(경기 흐름처럼 데이터에 없는 사실은 지어내지 않는다).
// 기사·댓글·매체는 모두 게임이 만든 가상 콘텐츠다. 실제 매체명·실제 팬 반응이 아니다.
import { mulberry32, hashString } from './rng.mjs';

// ---------- 한국어 조사 ----------
const HANGUL = 0xac00;
const LATIN_BATCHIM = new Set(['L', 'M', 'N', 'R']); // 엘·엠·엔·알
const DIGIT_BATCHIM = new Set(['0', '1', '3', '6', '7', '8']); // 영·일·삼·육·칠·팔
/** 단어의 마지막 소리에 받침이 있는지(ㄹ 받침이면 'rieul') */
function finalSound(word) {
  const s = String(word).replace(/\(\d+\)$/u, '').replace(/[\s)\]"'.,!?…]+$/u, ''); // 동명이인 표기 '(2)'는 소리 나지 않는다
  const ch = [...s].at(-1);
  if (!ch) return 'none';
  const code = ch.codePointAt(0);
  if (code >= HANGUL && code <= 0xd7a3) {
    const jong = (code - HANGUL) % 28;
    return jong === 0 ? 'none' : jong === 8 ? 'rieul' : 'yes';
  }
  if (/[0-9]/.test(ch)) return DIGIT_BATCHIM.has(ch) ? (ch === '1' || ch === '7' || ch === '8' ? 'rieul' : 'yes') : 'none';
  if (/[A-Za-z]/.test(ch)) return LATIN_BATCHIM.has(ch.toUpperCase()) ? (/[LR]/i.test(ch) ? 'rieul' : 'yes') : 'none';
  return 'none';
}
const PAIRS = { '이/가': ['이', '가'], '은/는': ['은', '는'], '을/를': ['을', '를'], '과/와': ['과', '와'], '으로/로': ['으로', '로'], '이라/라': ['이라', '라'] };
export function josa(word, pair) {
  const [withB, noB] = PAIRS[pair] ?? pair.split('/');
  const f = finalSound(word);
  if (pair === '으로/로') return f === 'yes' ? withB : noB;
  return f === 'none' ? noB : withB;
}

const TOKEN = /\{(\w+)(?::([^}]+))?\}/g;
/** 템플릿의 {이름}·{이름:조사}를 채운다. 채울 값이 없는 토큰이 있으면 null */
export function fill(template, vars) {
  let missing = false;
  const out = template.replace(TOKEN, (_, key, pair) => {
    const v = vars[key];
    if (v == null) { missing = true; return ''; }
    const s = String(v);
    return pair ? `${s}${josa(s, pair)}` : s;
  });
  return missing ? null : out.replace(/\s{2,}/g, ' ').trim();
}

// ---------- 문구 ----------
// 기사 템플릿: 종류별 제목(h)·본문(b). 종류마다 4개 이상이고, 시드와 사건 키로 고른다.
export const TEMPLATES = {
  opener_win: {
    h: ['개막전 승리… {team:이/가} {opp:을/를} {score:으로/로} 제압', '{team}, {opp}전 승리로 시즌 첫 경기를 장식', '새 시즌 첫 경기, {team:은/는} 웃었다', '{team}, 개막 첫 승… 상대는 {opp}'],
    b: ['{team:은/는} 시즌 첫 경기에서 {opp:을/를} {score:으로/로} 이겼다.', '{venue}에서 치른 개막전에서 {score:으로/로} 이긴 {team}의 전적은 1승 0패다.', '{star:이/가} {starLine:으로/로} 첫 경기를 이끌었다. {team:은/는} 1승 0패로 출발했다.', '시즌 첫 경기부터 승리를 챙긴 {team:은/는} 1승 0패로 새 시즌을 열었다.']
  },
  opener_loss: {
    h: ['개막전 패배… {team}, {opp}에 {score}', '{team:은/는} 첫 경기에서 웃지 못했다', '시즌 첫 경기부터 숙제를 안은 {team}', '{team}, 개막 첫 경기에서 {opp}에 패'],
    b: ['{team:은/는} 시즌 첫 경기에서 {opp}에 {score:으로/로} 졌다. 전적은 0승 1패다.', '{venue}에서 치른 개막전에서 {score:으로/로} 진 {team:은/는} 0승 1패로 출발한다.', '{oppStar:이/가} {oppStarLine:을/를} 기록한 {opp}에 졌다. 54경기 중 한 경기일 뿐이다.', '개막전 결과는 {score}. {team}의 새 시즌은 0승 1패로 시작됐다.']
  },
  result_win: {
    h: ['{team}, {opp} 꺾고 {record:으로/로} {rank}위', '{team:이/가} {venue}에서 {opp:을/를} {score:으로/로} 제압', '{team}, {day}일차 {opp}전 승리… {rank}위', '{team:이/가} {opp}에 {margin}점 차 승리를 거뒀다'],
    b: ['{team:은/는} {venue}에서 열린 {opp}전에서 {score:으로/로} 이겼다. 이 승리로 {record:이/가} 됐고 순위는 {rank}위다.', '{team}의 {day}일차 경기는 {score}. {opp}에 {margin}점 차로 앞서며 {record:을/를} 만들었다.', '{star:이/가} {starLine:으로/로} 공격을 이끌었다. {team:은/는} {record}, 현재 {rank}위다.', '{opp:을/를} 상대로 {margin}점 차 승리를 챙긴 {team:은/는} 전적 {record:으로/로} {rank}위에 자리했다.']
  },
  result_loss: {
    h: ['{team}, {opp}에 {score:으로/로} 패배… {record}', '{venue}에서 {opp}에 진 {team}', '{team:이/가} {opp}에 {margin}점 차로 졌다', '{day}일차 {opp}전 패배, {team}의 순위는 {rank}위'],
    b: ['{team:은/는} {venue}에서 열린 {opp}전에서 {score:으로/로} 졌다. 전적은 {record}, 순위는 {rank}위다.', '{team}의 {day}일차 결과는 {score}. {opp}에 {margin}점 차로 졌다.', '{oppStar:이/가} {oppStarLine:을/를} 기록한 {opp}에 졌다. {team:은/는} {record:이/가} 됐다.', '{team}에게 아쉬운 하루였다. {record:으로/로} {rank}위에 자리하고 있다.']
  },
  thriller_win: {
    h: ['{team}, {otText}{opp}에 {margin}점 차 신승', '{team}, {otText}{opp}전 {score} 짜릿한 승리', '한 끗 차이… {team:이/가} {opp:을/를} {margin}점 차로 눌렀다', '{team}, {opp}전 신승으로 {record}'],
    b: ['{otText}{team:은/는} {opp:을/를} {score:으로/로} 이겼다. 점수 차는 {margin}점이었다.', '점수 차는 {margin}점에 불과했다. {team:이/가} 이기면서 {record:이/가} 됐다.', '{star:이/가} {starLine:으로/로} 버틴 {team:은/는} {opp}전 신승으로 {rank}위가 됐다.', '한 끗 차이였다. {team:은/는} {venue}에서 {opp:을/를} {score:으로/로} 따돌렸다.']
  },
  thriller_loss: {
    h: ['{team}, {opp}에 {margin}점 차 석패', '{team}, {otText}{opp}에 {score} 패', '아쉬운 {margin}점 차… {team:이/가} {opp}에 졌다', '{team}, 접전 끝에 {opp}에 무릎'],
    b: ['{otText}{team:은/는} {opp}에 {score:으로/로} 졌다. 전적은 {record}, {rank}위다.', '점수 차는 {margin}점이었다. {team:은/는} {opp}에 지며 {record:이/가} 됐다.', '{oppStar:이/가} {oppStarLine:을/를} 올린 {opp}에 {margin}점 차로 졌다.', '접전이었던 만큼 아쉬움이 컸다. {team}의 전적은 {record}다.']
  },
  blowout_win: {
    h: ['{team}, {opp} 상대로 {margin}점 차 대승', '{team:이/가} {opp:을/를} {score:으로/로} 압도했다', '{day}일차 완승… {team}, {opp}에 {score}', '{team}의 대승, {opp:은/는} {oppPts}점에 그쳤다'],
    b: ['{team:은/는} {opp}에 {margin}점 차로 이겼다. 스코어는 {score}다.', '{star:이/가} {starLine:을/를} 기록하며 승리에 힘을 보탰다. {team}의 전적은 {record}.', '{opp:은/는} {oppPts}점에 그쳤다. {team:은/는} {record:으로/로} {rank}위다.', '대승으로 {record:을/를} 만든 {team}, 순위는 {rank}위다.']
  },
  blowout_loss: {
    h: ['{team}, {opp}에 {margin}점 차 대패', '{opp:이/가} {team:을/를} {scoreRev:으로/로} 눌렀다', '{day}일차 완패… {team}의 숙제', '{team}, {opp}전 {margin}점 차 패배로 {record}'],
    b: ['{team:은/는} {opp}에 {score:으로/로} 졌다. {margin}점 차 패배로 전적은 {record:이/가} 됐다.', '{opp:은/는} {oppPts}점을 올렸고 {team:은/는} {my}점에 그쳤다. 순위는 {rank}위다.', '{oppStar:이/가} {oppStarLine:을/를} 기록한 {opp}에 크게 졌다.', '한 경기에 흔들릴 필요는 없지만 {margin}점 차는 가볍지 않다. {team}의 전적은 {record}.']
  },
  streak_win: {
    h: ['{team}, {streak}연승 질주', '{streak}연승째… {team}의 상승세', '{opp}도 막지 못했다… {team} {streak}연승', '{team} {streak}연승, 순위는 {rank}위'],
    b: ['{team:은/는} {opp:을/를} {score:으로/로} 꺾고 {streak}연승을 이었다. 전적은 {record}.', '{streak}연승째 승리를 챙긴 {team:은/는} 현재 {rank}위다.', '{star:이/가} {starLine:을/를} 기록했다. {team:은/는} {streak}연승으로 {record:이/가} 됐다.', '연승 행진은 {streak}경기째다. {team}의 전적은 {record}.']
  },
  streak_lose: {
    h: ['{team}, {streak}연패 수렁', '{streak}연패에 빠진 {team}, 반등이 필요하다', '{opp}전 패배로 {team:은/는} {streak}연패', '{team} {streak}연패… 전적 {record}'],
    b: ['{team:은/는} {opp}에 {score:으로/로} 지며 {streak}연패를 기록했다. 전적은 {record}.', '{streak}연패로 {team}의 현재 순위는 {rank}위다. 분위기 전환이 필요하다.', '{oppStar:이/가} {oppStarLine:을/를} 올린 {opp}에 졌다. {team:은/는} {streak}연패째다.', '연패가 {streak}경기로 늘었다. {team}의 전적은 {record}.']
  },
  star_points: {
    h: ['{player}, {opp}전에서 {pts}점', '{starTeam}의 {player}, {pts}점 맹활약', '{player:이/가} 코트를 지배했다: {line}', '{day}일차 최고의 활약은 {player}'],
    b: ['{starTeam}의 {player:은/는} {opp}전에서 {line:을/를} 기록했다. 팀은 {res}했다.', '{line}. {player:이/가} 이날 가장 눈에 띄는 기록을 남겼다.', '{pts}점을 올린 {player:을/를} 앞세운 {starTeam:은/는} {score:으로/로} {res}했다.', '{day}일차 기록 중 가장 돋보인 것은 {player}의 {line}이었다.']
  },
  star_all: {
    h: ['{player}, {line}… 전천후 활약', '{player:이/가} 박스스코어를 가득 채웠다', '{starTeam}의 {player}, {opp}전에서 {line}', '{player}의 {line}, 오늘의 기록'],
    b: ['{starTeam}의 {player:은/는} {opp}전에서 {line:을/를} 기록했다. 팀은 {res}했다.', '{line}. 득점뿐 아니라 리바운드와 어시스트까지 챙긴 하루였다.', '{player:이/가} {line:으로/로} 경기를 만들었다. {starTeam:은/는} {score:으로/로} {res}했다.', '{day}일차에 나온 기록 중 가장 다채로운 것은 {player}의 {line}이었다.']
  },
  leader_change: {
    h: ['{leader:이/가} 선두로 올라섰다', '선두 교체: {leader}, {prev:을/를} 제치다', '{day}일차, 새 1위는 {leader}', '{leader}, 1위 자리에 올랐다'],
    b: ['{leader:은/는} {leaderRec:으로/로} 1위가 됐다. 직전까지 1위였던 {prev:은/는} 순위가 내려갔다.', '순위표 맨 위가 바뀌었다. {leader:이/가} {leaderRec:으로/로} 선두다.', '{day}일차를 마친 현재 선두는 {leader}({leaderRec})다.', '{prev}에서 {leader:으로/로} 선두가 넘어갔다. 전적은 {leaderRec}.']
  },
  rank_first: {
    h: ['{team}, 1위 등극', '{team:이/가} 순위표 맨 위에 섰다', '{day}일차, {team}의 이름이 1위에 올랐다', '선두 {team}! {record}'],
    b: ['{team:은/는} {record:으로/로} 리그 1위가 됐다.', '{day}일차를 마친 현재 {team:이/가} 선두다. 전적은 {record}.', '1위에 오른 {team}. 이 자리를 지키는 것이 다음 과제다.', '순위표 최상단에 {team:이/가} 이름을 올렸다({record}).']
  },
  rank_out: {
    h: ['{team}, 플레이오프권 밖으로… {rank}위', '{team:이/가} 6위 밖으로 밀렸다', '{day}일차 순위 하락, {team} {rank}위', '플레이오프 경계 아래로 내려선 {team}'],
    b: ['{team:은/는} {record:으로/로} {rank}위가 됐다. 플레이오프 진출선은 6위다.', '6위 안에 있던 {team:이/가} {rank}위로 내려갔다. 전적은 {record}.', '{day}일차를 마친 {team}의 순위는 {rank}위({record}). 6위 안으로 돌아가야 한다.', '플레이오프에 오르는 팀은 상위 6팀이다. {team:은/는} 지금 {rank}위다.']
  },
  rank_in: {
    h: ['{team}, 플레이오프권 복귀', '{team:이/가} 6위 안으로 올라섰다', '{day}일차 순위 상승, {team} {rank}위', '플레이오프 진출선 위로 올라온 {team}'],
    b: ['{team:은/는} {record:으로/로} {rank}위가 되며 플레이오프권에 들어갔다.', '6위 밖에 있던 {team:이/가} {rank}위로 올라섰다. 전적은 {record}.', '{day}일차를 마친 {team}의 순위는 {rank}위({record}). 플레이오프권이다.', '상위 6팀이 플레이오프에 오른다. {team:은/는} 지금 {rank}위다.']
  },
  clinch: {
    h: ['{team}, 플레이오프 진출 확정', '{team:이/가} 6강 티켓을 확보했다', '{day}일차, {team}의 플레이오프행 확정', '{team} 플레이오프 진출 확정… {record}'],
    b: ['남은 경기 결과와 관계없이 {team:은/는} 6위 안을 확보했다. 전적은 {record}.', '{day}일차에 {team}의 플레이오프 진출이 확정됐다. 현재 {rank}위({record}).', '{team:이/가} 플레이오프에 오른다. 이제 목표는 더 높은 순위다.', '남은 경기를 모두 져도 6위 안이다. {team}의 전적은 {record}.']
  },
  eliminated: {
    h: ['{team}, 플레이오프 탈락 확정', '{team:이/가} 6강 문턱에서 멈췄다', '{day}일차, {team}의 플레이오프 도전 마감', '{team} 플레이오프행 좌절… {record}'],
    b: ['남은 경기를 모두 이겨도 {team:은/는} 6위 안에 들 수 없다. 전적은 {record}.', '{day}일차에 {team}의 플레이오프 진출이 무산됐다. 현재 {rank}위({record}).', '{team:은/는} 이번 시즌 플레이오프에 오르지 못한다. 남은 경기에서 내년을 준비한다.', '6위 안에 들 가능성이 사라졌다. {team}의 전적은 {record}.']
  },
  cycle: {
    h: ['{day}일차 결산: {team} {record}, {rank}위', '상대를 한 바퀴 돌았다… {team}의 중간 성적표', '{cycle}바퀴째 마감, {team}의 현재 위치는 {rank}위', '{team} {record}… 리그 {rank}위로 {cycle}바퀴 마무리'],
    b: ['{day}일차까지 {team:은/는} {record:으로/로} {rank}위에 올라 있다. 선두는 {leader}({leaderRec})다.', '10개 구단이 서로 한 번씩 만나는 한 바퀴가 끝났다. {team}의 성적은 {record}.', '득점 선두는 {scorer}(경기당 {ppg}점)다. {team:은/는} {rank}위({record}).', '순위표 맨 위는 {leader}, {team}의 순위는 {rank}위({record})다.']
  },
  midseason: {
    h: ['반환점 돈 {team}, {record:으로/로} {rank}위', '전반기 마감: {team}의 성적표', '시즌 절반 지난 {team}, 현재 {rank}위', '{day}일차, 시즌 반환점… {team} {record}'],
    b: ['정규리그 {games}경기 중 절반을 치렀다. {team:은/는} {record}, {rank}위다.', '반환점을 지난 {team}의 전적은 {record}. 선두는 {leader}({leaderRec})다.', '{games}경기 중 {day}경기를 마쳤다. {team:은/는} 지금 {rank}위에 있다.', '전반기를 {record:으로/로} 마친 {team}. 득점 선두는 {scorer}(경기당 {ppg}점)다.']
  },
  regular_end: {
    h: ['정규리그 종료: {team} {rank}위({record})', '{team}, 정규리그를 {rank}위로 마무리', '{games}경기 끝… {team}의 최종 순위는 {rank}위', '정규리그 마감, {team} {record}'],
    b: ['{team:은/는} 정규리그를 {record}, {rank}위로 마쳤다. {tail}', '{games}경기를 모두 치른 {team}의 성적은 {record}({rank}위). {tail}', '최종 순위 {rank}위. {tail} 최종 1위는 {leader}({leaderRec})다.', '{team}의 정규리그 성적표는 {record}. {tail}']
  },
  preview: {
    h: ['새 시즌 앞둔 {team}, 전력 {powerRank}위 평가', '{season} 시즌 개막 임박… {team}의 전망', '{team}의 새 시즌 전력은 10개 구단 중 {powerRank}위', '개막을 앞둔 {team}'],
    b: ['게임이 계산한 전력 순위에서 {team:은/는} {powerRank}위다. 정규리그 {games}경기가 곧 시작된다.', '{season} 시즌 정규리그는 총 {games}경기, 상위 6팀이 플레이오프에 오른다. {team}의 전력은 {powerRank}위.', '10개 구단 가운데 {team}의 전력은 {powerRank}위로 평가됐다. 라인업과 훈련을 정할 시간이다.', '{team:이/가} {season} 시즌을 맞이한다. 전력 순위는 {powerRank}위.']
  },
  po_my_win: {
    h: ['{team}, {round}서 {opp} 꺾고 다음 라운드로', '{round} 통과! {team:이/가} {opp:을/를} {wins:으로/로} 제압', '{team:은/는} {opp:을/를} 넘어섰다({round})', '{team}, {round} 시리즈 승리'],
    b: ['{round}에서 {team:은/는} {opp:을/를} {wins:으로/로} 이겼다.', '{wins:으로/로} 시리즈를 가져간 {team}. 다음 라운드로 올라간다.', '{team:이/가} {opp:을/를} 꺾고 {round:을/를} 통과했다. 시리즈 전적은 {wins}.', '{round} 시리즈 결과는 {team} {wins}. 다음 상대가 가려진다.']
  },
  po_my_out: {
    h: ['{team}, {round}서 {opp}에 막혀 탈락', '{round} 시리즈에서 멈춘 {team}의 시즌', '{opp:이/가} {team:을/를} 꺾고 올라갔다({round})', '{team}, {round} 탈락… {opp:이/가} 진출'],
    b: ['{team:은/는} {round}에서 {opp}에 {wins:으로/로} 졌다. 이번 시즌 여정이 끝났다.', '{round} 시리즈에서 {opp:이/가} {wins:으로/로} 앞서 {team}의 시즌이 마무리됐다.', '{team:은/는} {round}에서 탈락했다. 정규리그 성적은 {rank}위였다.', '{opp:이/가} {team:을/를} {wins:으로/로} 꺾었다. {team:은/는} 시즌을 마쳤다.']
  },
  po_league: {
    h: ['{winner:이/가} {loser:을/를} 꺾고 {round} 통과', '{round}: {winner}, {wins:으로/로} 시리즈 승리', '{loser}의 시즌은 {round}에서 끝났다', '{winner}, {round} 시리즈 돌파'],
    b: ['{round}에서 {winner:은/는} {loser:을/를} {wins:으로/로} 이겼다.', '{winner:이/가} {wins:으로/로} 시리즈를 가져가며 다음 라운드에 올랐다.', '{loser:은/는} {round}에서 {winner}에 밀려 시즌을 마쳤다.', '{round} 결과: {winner} {wins}.']
  },
  po_title_my: {
    h: ['{team}, 우승!', '{team:이/가} {season} 시즌 챔피언에 올랐다', '챔피언결정전 승리, 정상에 선 {team}', '{team}, 챔피언 등극… {opp:을/를} {wins:으로/로} 꺾다'],
    b: ['{team:은/는} 챔피언결정전에서 {opp:을/를} {wins:으로/로} 꺾고 {season} 시즌 우승을 차지했다.', '정규리그 {rank}위로 마친 {team:이/가} 플레이오프를 통과해 챔피언이 됐다.', '{season} 시즌의 주인공은 {team}. 결승 상대 {opp}에 {wins:으로/로} 이겼다.', '우승을 확정한 {team}. 챔피언결정전 시리즈 전적은 {wins}다.']
  },
  po_title: {
    h: ['{winner}, {season} 시즌 챔피언', '{winner:이/가} 챔피언결정전에서 {loser:을/를} 꺾었다', '{season} 시즌 우승은 {winner}', '챔피언은 {winner}… {loser:은/는} 준우승'],
    b: ['{winner:은/는} 챔피언결정전에서 {loser:을/를} {wins:으로/로} 꺾고 우승했다.', '{season} 시즌 챔피언결정전은 {winner}의 {wins} 승리로 끝났다.', '{loser:은/는} 결승에서 {winner}에 {wins:으로/로} 졌다.', '{winner:이/가} {season} 시즌 정상에 올랐다.']
  },
  review_top: {
    h: ['{season} 결산: {team}, {rank}위로 마친 시즌', '{team}의 {season} 시즌, 상위권으로 마무리', '{season} 시즌 성적표: {team} {rank}위({record})', '{team} {season} 시즌 결산, 플레이오프 {stage}'],
    b: ['{team:은/는} {season} 정규리그를 {record}, {rank}위로 마쳤다. 플레이오프 성적은 {stage}.', '{rank}위({record})로 상위권을 지킨 {team}의 시즌은 {stage:으로/로} 끝났다.', '이번 시즌 {team}의 결과는 정규리그 {rank}위, 플레이오프 {stage}. 시즌 순이익은 {net}억이었다.', '{season} 시즌을 {record:으로/로} 마친 {team}. 플레이오프에서는 {stage}.']
  },
  review_mid: {
    h: ['{season} 결산: {team} {rank}위, 플레이오프는 {stage}', '{team}의 {season} 시즌, 6강 경쟁 끝에', '{season} 시즌 성적표: {team} {rank}위({record})', '{team} {season} 시즌 결산'],
    b: ['{team:은/는} {season} 정규리그를 {record}, {rank}위로 마쳤다. 플레이오프 성적은 {stage}.', '{rank}위({record})로 플레이오프에 오른 {team}의 시즌은 {stage:으로/로} 끝났다.', '이번 시즌 {team}의 결과는 정규리그 {rank}위, 플레이오프 {stage}. 시즌 순이익은 {net}억이었다.', '{season} 시즌을 {record:으로/로} 마친 {team}. 플레이오프에서는 {stage}.']
  },
  review_miss: {
    h: ['{season} 결산: {team} {rank}위, 플레이오프 불발', '{team}의 {season} 시즌, 6강 문턱에서', '{season} 시즌 성적표: {team} {rank}위({record})', '{team} {season} 시즌 결산, 다음을 기약하며'],
    b: ['{team:은/는} {season} 정규리그를 {record}, {rank}위로 마쳤다. 플레이오프에는 오르지 못했다.', '{rank}위({record})에 그친 {team:은/는} 플레이오프에 진출하지 못했다.', '이번 시즌 {team}의 결과는 정규리그 {rank}위. 시즌 순이익은 {net}억이었다.', '{season} 시즌을 {record:으로/로} 마친 {team}. 오프시즌이 중요해졌다.']
  },
  retire_my: {
    h: ['{player}, 현역 은퇴', '{team}의 {player}, 코트를 떠난다', '은퇴 선언… {player}({age}세)', '{player}, 은퇴로 마무리한 선수 생활'],
    b: ['{team}의 {player:이/가} 시즌 종료와 함께 은퇴했다. 나이는 {age}세, 마지막 OVR은 {ovr}.', '{age}세의 {player:이/가} 현역에서 물러난다. 마지막 시즌 OVR은 {ovr}이었다.', '{team:은/는} {player:을/를} 떠나보낸다. 은퇴 당시 나이는 {age}세다.', '{player}의 이름이 {team}의 선수단에서 빠진다. 은퇴 시점 OVR {ovr}.']
  },
  retire_star: {
    h: ['{player}, 은퇴 발표', '{from}의 {player}, 현역 마감', '{player}({age}세), 코트와 작별', '은퇴 소식: {player}'],
    b: ['{from}의 {player:이/가} 은퇴한다. {age}세, 마지막 OVR {ovr}로 이번 오프시즌 은퇴 선수 중 가장 높았다.', '{age}세의 {player:이/가} 현역에서 물러난다. 마지막 OVR은 {ovr}이었다.', '{from}에서 뛴 {player:이/가} 시즌을 끝으로 은퇴했다.', '이번 은퇴 선수 중 OVR이 가장 높은 {player}({ovr}). 소속은 {from}이었다.']
  },
  growth_up: {
    h: ['{player}, 한 시즌 만에 OVR {delta} 상승', '성장한 {team}의 {player}', '{player}({age}세), OVR {from}에서 {to:으로/로}', '{team}의 성장주 {player}'],
    b: ['{team}의 {player:은/는} 오프시즌 성장으로 OVR이 {from}에서 {to:으로/로} {delta} 올랐다.', '{age}세의 {player:이/가} {delta}만큼 성장했다. 새 OVR은 {to}.', '{player}의 OVR이 {from}에서 {to:이/가} 됐다. 나이는 {age}세다.', '오프시즌 변화에서 {team}의 {player:이/가} 가장 크게 올랐다(+{delta}).']
  },
  growth_down: {
    h: ['{player}, OVR {from}에서 {to:으로/로}', '{team}의 {player}, 능력치 변화', '{player}({age}세), OVR {delta} 하락', '{team} {player}의 새 시즌 전망'],
    b: ['{team}의 {player:은/는} 오프시즌 변화로 OVR이 {from}에서 {to:으로/로} 바뀌었다.', '{age}세의 {player} OVR이 {delta} 내려 {to:이/가} 됐다.', '{player}의 새 OVR은 {to}. 라인업과 훈련 계획을 다시 점검할 시점이다.', '오프시즌 변화에서 {team}의 {player:이/가} 가장 크게 내려갔다({delta}).']
  },
  resign_done: {
    h: ['{team}, 재계약 {count}건 확정', '{names}, {team}에 남는다', '{team}, 핵심 자원 {count}명과 재계약', '재계약 소식: {team}의 {count}건'],
    b: ['{names} 등이 {team}에 남기로 했다. 재계약은 총 {count}건이다.', '{team:은/는} 계약이 끝나는 선수 가운데 {count}명과 재계약했다. {names:이/가} 포함된다.', '이번 오프시즌 {team}의 재계약은 {count}건. 대표적으로 {names}.', '{names}의 재계약이 확정됐다. {team}의 재계약은 모두 {count}건이다.']
  },
  resign_fail: {
    h: ['{team}, 재계약 협상 결렬 {count}명', '{names}, 재계약 거절', '{team:과/와} {names}의 협상 불발', '재계약 불발… {team:은/는} {count}명을 놓쳤다'],
    b: ['{names:이/가} {team}의 제시액을 받아들이지 않았다. 협상이 결렬된 선수는 {count}명이다.', '{team:은/는} {names:과/와} 협상했지만 합의하지 못했다. 이들은 FA 시장으로 나간다.', '재계약에 이르지 못한 선수는 {count}명({names}). FA 시장에서 다시 만날 수 있다.', '{names:이/가} 재계약 제안을 거절했다.']
  },
  fa_in: {
    h: ['{team}, FA {player} 영입', '{player:이/가} {team}에 합류한다', 'FA 시장 소식: {team:이/가} {player:을/를} 품었다', '{team}, {salary}억 투자해 {player} 영입'],
    b: ['{team:은/는} FA {player:을/를} 연봉 {salary}억, {years}년 계약으로 영입했다.', '{player:이/가} {salary}억에 {years}년 계약을 맺고 {team}에 합류한다.', '{team}의 FA 영입: {player}, 연봉 {salary}억, 계약기간 {years}년.', 'FA 시장 {round}라운드에서 {team:이/가} {player:을/를} 영입했다. 연봉 {salary}억.']
  },
  fa_out: {
    h: ['{player}, {to:으로/로} 이적', '{team} 떠나는 {player}', 'FA {player}, 새 팀은 {to}', '{team}의 {player}, {to} 선택'],
    b: ['{team}에서 계약이 끝난 {player:이/가} FA 시장에서 {to:과/와} 계약했다. 연봉은 {salary}억이다.', '{player:이/가} {to:으로/로} 향한다. 계약은 {years}년, 연봉 {salary}억.', '{team:은/는} {player:을/를} 잡지 못했다. {player:은/는} {to}에서 새 시즌을 맞는다.', '{to:이/가} {team} 출신 {player:을/를} 영입했다.']
  },
  fa_big: {
    h: ['{to}, {player} 영입… 연봉 {salary}억', '{player:이/가} {to}에 간다', 'FA 시장 소식: {player}, 새 팀은 {to}', '{to}의 선택은 {player}'],
    b: ['{to:은/는} FA {player:을/를} 연봉 {salary}억, {years}년 계약으로 영입했다.', '다른 구단들의 FA 이동 가운데 연봉이 높은 축에 든다. {player:이/가} {salary}억에 {to:과/와} 계약했다.', '{player:이/가} {salary}억, {years}년 조건으로 {to}에 합류한다.', 'FA 시장 {round}라운드, {to:이/가} {player:을/를} 품었다.']
  },
  comp: {
    h: ['FA 보상 정리: {to:은/는} {from}에 {compWhat}', '{player} 이적에 따른 보상, {to}에서 {from:으로/로}', '{from}, {player} 보상으로 {compWhat} 수령', '{to}, {player} 영입 보상 지급'],
    b: ['{player:을/를} 영입한 {to:은/는} 원소속 구단 {from}에 보상으로 {compWhat:을/를} 냈다.', '보상 규정에 따라 {from}에 {compWhat:이/가} 전해졌다. 대상 선수는 {player}.', '{player} 이적의 보상은 {compWhat}. 보상을 내는 쪽은 {to}, 받는 쪽은 {from}이다.', '{to:이/가} {from}에 {compWhat:을/를} 보상으로 지급했다.']
  },
  trade_done: {
    h: ['{team}, {partner:과/와} 트레이드', '트레이드 성사: {get} 영입, {give} 이적', '{partner:과/와} 맞교환… {team}의 선택', '{team}의 트레이드: {give} ↔ {get}'],
    b: ['{team:은/는} {partner:과/와} 트레이드를 성사시켰다. {give:이/가} 떠나고 {get:이/가} 합류한다.', '{team:이/가} 내보낸 선수는 {give}, 영입한 선수는 {get}. 상대는 {partner}.', '{partner:과/와}의 거래로 {team}에 {get:이/가} 온다.', '트레이드 상대는 {partner}. {team:은/는} {give:을/를} 내주고 {get:을/를} 받았다.']
  },
  draft_my: {
    h: ['{team}, 신인 {player} 지명({pick}순위)', '{player:이/가} {team}의 새 식구가 됐다', '드래프트: {team}의 선택은 {player}', '{pick}순위로 {team}에 온 {player}'],
    b: ['{team:은/는} 드래프트 {pick}순위로 {player:을/를} 지명했다. 포지션 {pos}, OVR {ovr}.', '{player}의 첫 소속은 {team}이다. 지명 순위는 {pick}순위, OVR은 {ovr}.', '{team}의 신인 {player}({pos})는 OVR {ovr}, 잠재력 {potential:으로/로} 평가된다.', '드래프트 {pick}순위 {player:이/가} {team}에 합류한다.']
  },
  draft_top: {
    h: ['드래프트 1순위는 {to}의 {player}', '{to:이/가} 1순위로 {player:을/를} 선택했다', '신인 드래프트 1번 {player}, 행선지는 {to}', '{player:이/가} 드래프트 1순위로 {to}에 간다'],
    b: ['{to:은/는} 드래프트 1순위로 {player:을/를} 지명했다. 포지션 {pos}, OVR {ovr}.', '{player}의 OVR은 {ovr}, 잠재력은 {potential}. 가장 먼저 호명됐다.', '올해 드래프트 1순위 {player:이/가} {to}의 유니폼을 입는다.', '{to}의 1순위 선택은 {player}({pos}).']
  },
  cap_over: {
    h: ['{team}, 소프트캡 초과로 기금 {penalty}억', '샐러리캡을 넘긴 {team}, 기금 납부', '{team}의 캡 초과 비용은 {penalty}억', '소프트캡 기금 {penalty}억… {team}'],
    b: ['{season} 시즌 국내 선수 연봉이 캡을 넘어 {team:은/는} {penalty}억을 기금으로 냈다.', '{team}의 국내 선수 연봉은 {payroll}억으로 캡 {cap}억을 넘었다. 기금은 {penalty}억이다.', '캡 초과분에 따라 {team:이/가} 낸 기금은 {penalty}억. 구단 자금에서 빠진다.', '소프트캡을 넘긴 대가로 {penalty}억이 나갔다. 연봉 구성을 돌아볼 필요가 있다.']
  },
  funds_plus: {
    h: ['{team}, 시즌 순이익 {net}억', '{season} 시즌 흑자 {profit}억, {team}', '{team}의 곳간: 순이익 {net}억', '구단 재정 점검: {team} 흑자'],
    b: ['수입에서 지출을 뺀 {season} 시즌 순이익은 {net}억이다. {fundsText}', '{team:은/는} {season} 시즌을 {profit}억 흑자로 마쳤다. {fundsText}', '시즌 수입 {revenue}억, 선수단 연봉 {payroll}억. 순이익은 {net}억이다.', '흑자 {profit}억. {fundsText}']
  },
  funds_minus: {
    h: ['{team}, 시즌 적자 {loss}억', '{season} 시즌 적자 {loss}억, {team}', '{team}의 곳간: 순이익 {net}억', '구단 재정 점검: {team} 적자'],
    b: ['수입에서 지출을 뺀 {season} 시즌 순이익은 {net}억이다. {fundsText}', '{team:은/는} {season} 시즌을 {loss}억 적자로 마쳤다. {fundsText}', '시즌 수입 {revenue}억, 선수단 연봉 {payroll}억. 순이익은 {net}억이다.', '적자 {loss}억. {fundsText}']
  }
};

// 댓글: 가상 닉네임이 쓰는 말. 선수는 기록을 칭찬하는 말에만 나오고, 부정적인 말은 팀·전술·운영에 대해서만 한다.
export const COMMENTS = {
  환호: ['오늘 분위기 진짜 좋다', '이 기세면 우승도 노려볼 만하죠', '{team} 팬이라 행복한 요즘입니다', '응원 온 보람이 있네요 ㅎㅎ', '이 흐름 끊기지 않았으면', '오늘도 퇴근길이 즐겁다', '농구 보는 맛이 나는 시즌'],
  기대: ['꾸준하네요, 이대로만 가죠', '조금씩 팀 색깔이 나오는 듯', '슬슬 기대해도 되나 싶습니다', '이 정도면 해볼 만한데요', '다음 경기도 기대합니다', '수비가 단단해진 느낌이에요', '벤치 자원들도 잘 받쳐 주네요'],
  불안: ['아직 안심하긴 이르죠', '좋다가도 한 번씩 흔들려서 불안합니다', '기복만 줄이면 좋겠어요', '이 정도로는 마음이 놓이질 않네요', '다음 경기가 중요해 보입니다', '후반 집중력이 변수인 듯해요', '로테이션을 한 번 점검했으면 합니다'],
  격앙: ['이건 좀 아쉬운 경기였습니다', '수비 로테이션이 너무 늦어요', '이럴 때일수록 라인업을 다시 짜 봐야 할 듯', '답답하네요 정말', '단장님 이번엔 좀 움직여 주세요', '같은 패턴이 계속 읽히는 것 같아요', '연패 끊을 방법을 찾아야 합니다'],
  체념: ['올해는 그냥 내년을 보겠습니다', '기대를 낮추니 마음이 편하네요', '그래도 응원은 계속합니다', '오프시즌에 뭔가 바뀌겠죠', '이제는 담담하게 봅니다', '경기 수가 많이 남았으니 지켜볼게요', '팬이니까 끝까지 갑니다'],
  relief: ['이제야 한숨 돌렸네요', '오랜만에 웃습니다 ㅎㅎ', '이 승리가 반등의 계기가 되길', '답답했는데 속이 시원하네요', '일단 하나 잡았으니 다음도 가봅시다'],
  sting: ['한 경기 졌다고 흔들리지 맙시다', '이런 날도 있죠, 다음에 만회하면 됩니다', '아쉽지만 아직 갈 길이 멀어요', '오늘은 상대가 잘했다고 봅니다', '승패보다 내용을 보고 싶네요'],
  rival_good: ['{team:은/는} 오늘 인정합니다. 다음에 만나면 달라질 겁니다', '축하드립니다, 다음 맞대결에서 봅시다', '{team} 팬분들 오늘은 즐거우시겠네요', '완패는 아니었는데 아쉽네요', '오늘은 {team}의 날이었습니다'],
  rival_bad: ['{team:은/는} 다음 경기에서 만회할 거라 믿습니다', '이번엔 우리가 웃었지만 시즌은 길죠', '좋은 경기였습니다. 다음에 또 봐요', '{team}도 곧 올라올 팀이라 방심은 못 합니다', '수고하셨습니다, {team} 팬분들'],
  neutral: ['요즘 리그 순위 싸움이 재밌네요', '기록 보면 흥미로운 시즌입니다', '10개 구단이 다 만만치 않아요', '숫자로 보면 꽤 볼만한 날이었네요', '이런 기사 보는 재미가 있어요'],
  player_good: ['{player}의 기록이 인상적이네요', '{player} 오늘 박스스코어 보면 대단합니다', '{player}의 꾸준함이 팀에 큰 힘입니다', '오늘의 주인공은 {player}였네요'],
  move_good: ['좋은 선택 같습니다', '이런 소식이 반갑네요', '새 시즌이 기대됩니다', '이 정도면 만족입니다', '보강이 필요했던 자리라 반갑습니다', '기록을 보면 기대해 볼 만하죠'],
  move_bad: ['아쉽지만 팀 사정이 있겠죠', '빈자리가 커 보입니다', '이 공백을 어떻게 메울지가 관건이네요', '응원했던 선수라 서운하네요', '다음 선택을 지켜보겠습니다'],
  finance: ['재정이 탄탄해야 오래 가죠', '곳간 관리도 중요합니다', '숫자로 보니 현실적이네요', '캡 관리가 쉽지 않은 시대입니다'],
  preview: ['시즌이 기다려지네요', '올해는 기대 반 걱정 반입니다', '라인업 고민이 깊어지는 시기네요', '빨리 개막했으면 좋겠습니다'],
  move_neutral: ['이번 오프시즌은 지켜볼 게 많네요', '새 시즌 로스터가 기대됩니다', '선수단 구성이 어떻게 될지 궁금합니다', '이 선택이 어떤 결과로 이어질지 봅시다']
};

export const NICKS = ['농구는장비빨', '3점슈터', '벤치워머_민', '코트위의철학자', '림맞고나감', '새벽농구', '픽앤롤장인', '언더독', '가로수길덩크', '골밑은내꺼', '수비가최고', '바스켓볼러', '자유투연습중', '버저비터', '트랜지션', '농알못', '직관러', '하프라인', '리바운드왕', '코트사이드팬', '숨은MVP', '파울트러블', '퀵핸즈', '농구보는직장인', '시즌권홀더', '야간경기러', '박스스코어덕후', '림프로텍터', '3&D러버', '슛터치', '열혈직관러', '응원봉', '골대불꽃', '스크린셋터', '로테이션', '앨리웁', '풋워크', '스틸왕', '순위표지킴이', '벤치응원단'];

export const OUTLETS = ['코트사이드', '하프라인 뉴스', '버저비터 데일리', '림로드 매거진'];

// ---------- 팬 심리 ----------
export const MOOD_LABELS = ['환호', '기대', '불안', '격앙', '체념'];
export function moodLabel(score, trend = 0) {
  if (score >= 72) return '환호';
  if (score >= 58) return '기대';
  if (score >= 44) return '불안';
  return trend <= -2 ? '격앙' : '체념';
}
const MOOD_DESC = {
  환호: ['팬들이 들뜬 분위기입니다. 커뮤니티가 우승 이야기로 가득합니다.', '요즘 응원석 분위기가 뜨겁습니다.', '연일 칭찬이 쏟아지고 있습니다.'],
  기대: ['팬들이 조심스럽게 기대를 키우고 있습니다.', '분위기가 괜찮습니다. 이대로만 가자는 반응이 많습니다.', '응원 열기가 조금씩 오르는 중입니다.'],
  불안: ['팬들이 반신반의하고 있습니다. 한 번 더 확인이 필요하다는 분위기입니다.', '기복 때문에 마음이 놓이지 않는다는 반응이 많습니다.', '커뮤니티에 걱정 섞인 글이 늘었습니다.'],
  격앙: ['팬들의 불만이 커지고 있습니다. 변화를 요구하는 목소리가 큽니다.', '커뮤니티가 들끓고 있습니다. 반등이 급하다는 반응입니다.', '최근 흐름에 대한 아쉬움이 터져 나오고 있습니다.'],
  체념: ['팬들이 조용해졌습니다. 내년을 이야기하는 글이 늘었습니다.', '기대를 내려놓았다는 반응이 많습니다.', '그래도 응원은 계속하겠다는 글이 이어집니다.']
};

// ---------- 내부 도구 ----------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const STAGE_TEXT = { 우승: '우승', 결승: '준우승', '4강': '4강 탈락', '6강': '6강 탈락', '': '진출 실패' };
const ROUND_ORDER = { '6강': 1, '4강': 2, '결승': 3, '챔피언결정전': 3 };

function pickIndex(arr, vars, rng, recent) {
  const ok = [];
  arr.forEach((t, i) => { if (fill(t, vars) != null) ok.push(i); });
  if (!ok.length) return -1;
  let cand = ok.filter((i) => !recent.includes(i));
  if (!cand.length) cand = ok;
  const i = cand[Math.floor(rng() * cand.length)];
  recent.push(i);
  while (recent.length > Math.min(3, arr.length - 1)) recent.shift();
  return i;
}

const recordText = (w, l) => `${w}승 ${l}패`;
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const money = (v) => fmt1(Math.abs(v));

// ---------- 사건 만들기 ----------
/**
 * 입력(src):
 *  seed, teams(구단 id 목록), myTeamId, startYear(현재 시즌 시작 연도), season(현재 시즌 표기), teamName(id)→이름, games(정규리그 경기 수),
 *  log: 시즌 결과 목록(마지막 것이 가장 최근. 오프시즌 중이면 방금 끝난 시즌 포함),
 *  current: { stage, day, dayResults, playoffSeries, offseason: { retired, progressed } | null },
 *  names: Map(id → { name }) (트레이드 보고서의 선수 id를 이름으로), power: [{ id, rank }] (선택)
 * 반환: { items(최신순), mood, outlets }
 */
export function buildNews(src) {
  const my = src.myTeamId;
  const nameOf = (id) => src.teamName(id);
  const events = [];
  let seq = 0;
  const add = (ev) => { events.push({ seq: seq++, tags: [], tone: 'neutral', delta: 0, comments: 0, ...ev }); };
  const pname = (id) => src.names?.get?.(id)?.name ?? null;

  const log = (src.log ?? []).slice(-2);
  const cur = src.current ?? { stage: 'regular', day: 0, dayResults: [] };
  const games = src.games ?? 54;

  // 팬 심리의 시작점: 직전 시즌 결과
  let mood0 = 55;
  if (log.length) { // 기록이 있는 가장 오래된 시즌의 결과가 시작 분위기를 정한다
    const first = log[0];
    const row = first.standings.find((s) => s.id === my);
    const st = first.stage?.[my];
    mood0 = st === '우승' ? 72 : st === '결승' ? 64 : st ? 58 : row && row.rank >= 8 ? 38 : 46;
  }

  // ----- 현재 시즌 정규리그 -----
  const sy = src.startYear;
  const base = (y) => y * 1000;
  const seasonLabel = src.season;
  const dayResults = cur.dayResults ?? [];

  if (src.power && src.power.length) {
    const r = src.power.find((p) => p.id === my);
    if (r) add({ key: `${sy}:preview`, t: base(sy), season: seasonLabel, when: `${seasonLabel} 개막 전`, kind: 'preview', scope: 'my', tags: ['우리 팀', '전망'], vars: { team: nameOf(my), season: seasonLabel, powerRank: r.rank, games }, comments: 1 });
  }

  const rec = new Map(src.teams.map((id) => [id, { id, w: 0, l: 0, pf: 0, pa: 0 }]));
  const rank = () => [...rec.values()].sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.id.localeCompare(b.id));
  const scorers = new Map();
  let streak = 0; // +n 연승, -n 연패
  let prevRank = null; let prevLeader = null; let clinched = false; let out = false;
  const totalDays = cur.totalDays ?? games;
  const TOP = 6;
  for (const d of dayResults) {
    const dayGames = d.games;
    for (const g of dayGames) {
      const h = rec.get(g.homeId); const a = rec.get(g.awayId);
      h.pf += g.homePts; h.pa += g.awayPts; a.pf += g.awayPts; a.pa += g.homePts;
      if (g.winnerId === g.homeId) { h.w++; a.l++; } else { a.w++; h.l++; }
      for (const side of [g.box?.home, g.box?.away]) {
        for (const line of side ?? []) {
          if (!line.minutes) continue;
          const s = scorers.get(line.id) ?? { name: line.name, pts: 0, g: 0 };
          s.pts += line.points; s.g++; scorers.set(line.id, s);
        }
      }
    }
    const order = rank();
    const myRank = order.findIndex((r) => r.id === my) + 1;
    const mine = rec.get(my);
    const myRec = recordText(mine.w, mine.l);
    const leader = order[0];
    const leaderRec = recordText(leader.w, leader.l);
    const t0 = base(sy) + d.day;

    // 우리 팀 경기
    const mg = dayGames.find((g) => g.homeId === my || g.awayId === my);
    if (mg) {
      const home = mg.homeId === my;
      const mp = home ? mg.homePts : mg.awayPts; const op = home ? mg.awayPts : mg.homePts;
      const win = mg.winnerId === my; const oppId = home ? mg.awayId : mg.homeId;
      streak = win ? (streak > 0 ? streak + 1 : 1) : (streak < 0 ? streak - 1 : -1);
      const margin = Math.abs(mp - op);
      const top = (side) => (side ?? []).filter((l) => l.minutes).sort((a, b) => b.points - a.points)[0];
      const myTop = top(home ? mg.box?.home : mg.box?.away); const opTop = top(home ? mg.box?.away : mg.box?.home);
      const lineOf = (l) => `${l.points}점 ${l.rebounds}리바운드 ${l.assists}어시스트`;
      const vars = {
        team: nameOf(my), opp: nameOf(oppId), venue: home ? '홈' : '원정', score: `${mp}-${op}`, scoreRev: `${op}-${mp}`, my: mp, oppPts: op, margin,
        record: myRec, rank: myRank, day: d.day, otText: mg.overtimes ? `${mg.overtimes > 1 ? `${mg.overtimes}차 ` : ''}연장 혈투 끝에 ` : '',
        ...(myTop ? { star: myTop.name, starLine: lineOf(myTop) } : {}), ...(opTop ? { oppStar: opTop.name, oppStarLine: lineOf(opTop) } : {})
      };
      let kind; let delta; let comments;
      if (d.day === 1) { kind = win ? 'opener_win' : 'opener_loss'; delta = win ? 2.4 : -2; comments = 2; }
      else if (win && streak >= 3 && [3, 5, 7, 10, 12, 15].includes(streak)) { kind = 'streak_win'; vars.streak = streak; delta = 4.4; comments = 3; }
      else if (!win && -streak >= 3 && [3, 5, 7, 10, 12].includes(-streak)) { kind = 'streak_lose'; vars.streak = -streak; delta = -5.3; comments = 3; }
      else if (mg.overtimes || margin <= 3) { kind = win ? 'thriller_win' : 'thriller_loss'; delta = win ? 3 : -2.2; comments = 2; }
      else if (margin >= 20) { kind = win ? 'blowout_win' : 'blowout_loss'; delta = win ? 3 : -3.5; comments = 2; }
      else { kind = win ? 'result_win' : 'result_loss'; delta = win ? 2.4 : -2.8; comments = 1; }
      // 위 조건에 들지 않은 연승·연패 숫자도 mood에는 이미 경기 결과로 반영된다
      add({ key: `${sy}:g${d.day}`, t: t0, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind, scope: 'my', tags: ['우리 팀', '경기'], tone: win ? 'good' : 'bad', delta, comments, oppId, vars, refTeam: oppId, win, flag: 'game' });
    }

    // 오늘의 활약(리그 전체에서 하나)
    let star = null;
    for (const g of dayGames) {
      for (const [side, teamId, oppId] of [[g.box?.home, g.homeId, g.awayId], [g.box?.away, g.awayId, g.homeId]]) {
        for (const l of side ?? []) {
          if (!l.minutes) continue;
          const triple = l.points >= 10 && l.rebounds >= 10 && l.assists >= 10;
          const notable = l.points >= 32 || triple || l.rebounds >= 16 || l.assists >= 13;
          if (!notable) continue;
          const score = l.points + l.rebounds * 1.2 + l.assists * 1.5 + (triple ? 15 : 0);
          if (!star || score > star.score) star = { l, teamId, oppId, g, score, triple };
        }
      }
    }
    if (star) {
      const { l, teamId, oppId, g } = star;
      const thisPts = teamId === g.homeId ? g.homePts : g.awayPts; const thatPts = teamId === g.homeId ? g.awayPts : g.homePts;
      const kind = l.points >= 32 && !star.triple ? 'star_points' : 'star_all';
      add({
        key: `${sy}:star${d.day}`, t: t0 + 0.5, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind, scope: 'league', tags: ['리그', '기록'], tone: teamId === my ? 'good' : 'neutral', comments: 2, playerComment: true,
        vars: { player: l.name, starTeam: nameOf(teamId), opp: nameOf(oppId), pts: l.points, line: `${l.points}점 ${l.rebounds}리바운드 ${l.assists}어시스트`, day: d.day, res: thisPts > thatPts ? '승리' : '패배', score: `${thisPts}-${thatPts}` }
      });
    }

    // 순위 변화
    if (leader.id !== prevLeader && d.day >= 3) {
      if (leader.id === my) {
        add({ key: `${sy}:first${d.day}`, t: t0 + 0.6, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_first', scope: 'my', tags: ['우리 팀', '순위'], tone: 'good', delta: 3, comments: 3, vars: { team: nameOf(my), record: myRec, day: d.day } });
      } else if (prevLeader) {
        add({ key: `${sy}:lead${d.day}`, t: t0 + 0.6, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'leader_change', scope: 'league', tags: ['리그', '순위'], comments: 1, vars: { leader: nameOf(leader.id), prev: nameOf(prevLeader), leaderRec, day: d.day } });
      }
    }
    if (prevRank != null && d.day >= 18) {
      if (prevRank <= TOP && myRank > TOP) add({ key: `${sy}:rout${d.day}`, t: t0 + 0.7, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_out', scope: 'my', tags: ['우리 팀', '순위'], tone: 'bad', delta: -3, comments: 2, vars: { team: nameOf(my), rank: myRank, record: myRec, day: d.day } });
      else if (prevRank > TOP && myRank <= TOP) add({ key: `${sy}:rin${d.day}`, t: t0 + 0.7, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_in', scope: 'my', tags: ['우리 팀', '순위'], tone: 'good', delta: 2.5, comments: 2, vars: { team: nameOf(my), rank: myRank, record: myRec, day: d.day } });
    }
    // 진출 확정·탈락 확정: 남은 경기를 모두 져도(모두 이겨도) 6위 안에 든다(들 수 없다)고 승수만으로 확인되는 순간
    if (!clinched && !out && d.day >= 20) {
      const remaining = (id) => totalDays - (rec.get(id).w + rec.get(id).l);
      const others = order.filter((r) => r.id !== my);
      if (others.filter((r) => r.w + remaining(r.id) >= mine.w).length <= TOP - 1) {
        clinched = true;
        add({ key: `${sy}:clinch`, t: t0 + 0.8, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'clinch', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'good', delta: 5, comments: 3, vars: { team: nameOf(my), rank: myRank, record: myRec, day: d.day } });
      } else if (others.filter((r) => r.w > mine.w + remaining(my)).length >= TOP) {
        out = true;
        add({ key: `${sy}:out`, t: t0 + 0.8, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'eliminated', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'bad', delta: -6, comments: 3, vars: { team: nameOf(my), rank: myRank, record: myRec, day: d.day } });
      }
    }
    // 한 바퀴(9일)마다 결산
    const cycle = Math.round(src.teams.length - 1);
    if (d.day % cycle === 0) {
      const best = [...scorers.values()].filter((s) => s.g >= 5).sort((a, b) => b.pts / b.g - a.pts / a.g)[0];
      const scoreVars = best ? { scorer: best.name, ppg: fmt1(best.pts / best.g) } : {};
      const vars = { team: nameOf(my), record: myRec, rank: myRank, leader: nameOf(leader.id), leaderRec, day: d.day, cycle: d.day / cycle, games: totalDays, ...scoreVars };
      if (d.day === totalDays) {
        add({ key: `${sy}:end`, t: t0 + 0.9, season: seasonLabel, when: `${seasonLabel} 정규리그 종료`, kind: 'regular_end', scope: 'my', tags: ['우리 팀', '순위'], tone: myRank <= TOP ? 'good' : 'bad', delta: myRank <= TOP ? 2 : -2, comments: 2, vars: { ...vars, tail: myRank <= TOP ? '플레이오프에 진출했다.' : '플레이오프에는 오르지 못했다.' } });
      } else {
        add({ key: `${sy}:cycle${d.day}`, t: t0 + 0.9, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: d.day * 2 === totalDays ? 'midseason' : 'cycle', scope: 'my', tags: ['우리 팀', '순위'], tone: myRank <= TOP ? 'good' : 'bad', comments: 1, vars });
      }
    }
    prevRank = myRank; prevLeader = leader.id;
  }

  // ----- 플레이오프(현재 시즌이 진행 중이거나, 오프시즌에서 방금 끝난 시즌) -----
  const seriesEvents = (seriesList, y, label, myRankIn, source) => {
    seriesList.forEach((s, i) => {
      const round = s.round;
      const ro = ROUND_ORDER[round] ?? 1;
      const winner = s.winnerId; const loser = s.winnerId === s.higherId ? s.lowerId : s.higherId;
      const w = s.wins[winner]; const l = s.wins[loser];
      const wins = recordText(w, l);
      const key = `${y}:po${i}`; const t = base(y) + 100 + ro * 10 + i;
      const isMy = winner === my || loser === my;
      const final = ro === 3;
      if (final) {
        if (winner === my) add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_title_my', scope: 'my', tags: ['우리 팀', '플레이오프', '우승'], tone: 'good', delta: 12, comments: 3, vars: { team: nameOf(my), opp: nameOf(loser), wins, season: label, rank: myRankIn ?? undefined }, src: source });
        else add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_title', scope: isMy ? 'my' : 'league', tags: ['플레이오프', '우승'], tone: isMy ? 'bad' : 'neutral', delta: isMy ? -5 : 0, comments: 2, vars: { winner: nameOf(winner), loser: nameOf(loser), wins, season: label } });
      } else if (isMy) {
        if (winner === my) add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_my_win', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'good', delta: 5, comments: 3, vars: { team: nameOf(my), opp: nameOf(loser), round, wins } });
        else add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_my_out', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'bad', delta: -5, comments: 3, vars: { team: nameOf(my), opp: nameOf(winner), round, wins, rank: myRankIn ?? undefined } });
      } else {
        add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_league', scope: 'league', tags: ['리그', '플레이오프'], comments: 1, vars: { winner: nameOf(winner), loser: nameOf(loser), round, wins } });
      }
    });
  };
  const curSeries = cur.playoffSeries ?? [];
  const myRankNow = (() => { const o = rank(); const i = o.findIndex((r) => r.id === my); return dayResults.length && i >= 0 ? i + 1 : null; })();
  if (curSeries.length) seriesEvents(curSeries, sy, seasonLabel, myRankNow, 'live');

  // ----- 끝난 시즌들(로그) -----
  log.forEach((entry, idx) => {
    const y = entry.startYear; const label = entry.season;
    const latest = idx === log.length - 1;
    const row = entry.standings.find((s) => s.id === my);
    const recText = row ? recordText(row.wins, row.losses) : '';
    if (entry.series?.length && (cur.stage === 'offseason' || !latest || y !== sy)) {
      const list = latest ? entry.series : entry.series.filter((s) => s.round === '결승');
      seriesEvents(list.map((s) => ({ ...s, wins: s.wins })), y, label, row?.rank, 'log');
    }
    const st = entry.stage?.[my];
    const led = entry.ledger?.[my];
    const kind = row && row.rank <= 3 && st ? 'review_top' : st ? 'review_mid' : 'review_miss';
    if (row) {
      add({ key: `${y}:review`, t: base(y) + 200, season: label, when: `${label} 시즌 결산`, kind, scope: 'my', tags: ['우리 팀', '결산'], tone: st ? 'good' : 'bad', delta: kind === 'review_top' ? 3 : kind === 'review_mid' ? 0 : -3, comments: 2, vars: { team: nameOf(my), season: label, rank: row.rank, record: recText, stage: STAGE_TEXT[st ?? ''] ?? '진출 실패', net: led ? `${led.net >= 0 ? '+' : '-'}${money(led.net)}` : '0.0' } });
    }
    if (!latest) return;
    const wen = (when) => `${label} 오프시즌 · ${when}`;
    // 재정
    if (led) {
      if (led.penalty > 0) add({ key: `${y}:cap`, t: base(y) + 350, season: label, when: wen('재정'), kind: 'cap_over', scope: 'my', tags: ['우리 팀', '재정'], tone: 'bad', delta: -1.5, comments: 2, vars: { team: nameOf(my), season: label, penalty: money(led.penalty), payroll: money(led.payroll), cap: money(src.capEok ?? 30) } });
      const plus = led.net >= 0;
      add({ key: `${y}:funds`, t: base(y) + 351, season: label, when: wen('재정'), kind: plus ? 'funds_plus' : 'funds_minus', scope: 'my', tags: ['우리 팀', '재정'], tone: plus ? 'good' : 'bad', delta: plus ? 1 : -1, comments: 1, vars: { team: nameOf(my), season: label, net: `${plus ? '+' : '-'}${money(led.net)}`, profit: money(led.net), loss: money(led.net), revenue: money(led.revenue), payroll: money(led.payroll), ...(entry.fundsAfter?.[my] != null ? { fundsText: `오프시즌을 거친 구단 자금은 ${money(entry.fundsAfter[my])}억이다.` } : { fundsText: '' }) } });
    }
    // 오프시즌 보고서(완료된 오프시즌) 또는 진행 중인 오프시즌의 은퇴·성장
    const rep = entry.report;
    const retired = rep ? rep.retired : cur.offseason?.retired ?? [];
    const mineProg = rep ? rep.progressed.mine : (cur.offseason?.progressed ?? []).filter((p) => p.teamId === my);
    const myRet = retired.filter((p) => p.teamId === my).slice(0, 3);
    myRet.forEach((p) => add({ key: `${y}:ret:${p.id}`, t: base(y) + 300, season: label, when: wen('은퇴'), kind: 'retire_my', scope: 'my', tags: ['우리 팀', '은퇴'], tone: 'neutral', delta: -1, comments: 2, vars: { team: nameOf(my), player: p.name, age: p.age, ovr: p.ovr } }));
    const star = retired.filter((p) => p.teamId !== my).sort((a, b) => b.ovr - a.ovr)[0];
    if (star) add({ key: `${y}:ret:${star.id}`, t: base(y) + 300.5, season: label, when: wen('은퇴'), kind: 'retire_star', scope: 'league', tags: ['리그', '은퇴'], comments: 1, vars: { player: star.name, from: nameOf(star.teamId), age: star.age, ovr: star.ovr } });
    const up = [...mineProg].sort((a, b) => b.delta - a.delta)[0];
    if (up && up.delta >= 2) add({ key: `${y}:up:${up.id}`, t: base(y) + 301, season: label, when: wen('성장'), kind: 'growth_up', scope: 'my', tags: ['우리 팀', '성장'], tone: 'good', delta: 1.5, comments: 2, playerComment: true, vars: { team: nameOf(my), player: up.name, from: up.from, to: up.to, delta: up.delta, age: up.age } });
    const down = [...mineProg].sort((a, b) => a.delta - b.delta)[0];
    if (down && down.delta <= -2) add({ key: `${y}:down:${down.id}`, t: base(y) + 302, season: label, when: wen('성장'), kind: 'growth_down', scope: 'my', tags: ['우리 팀', '성장'], tone: 'neutral', delta: -1.5, comments: 1, vars: { team: nameOf(my), player: down.name, from: down.from, to: down.to, delta: Math.abs(down.delta), age: down.age } });
    if (!rep) return;
    // 트레이드
    for (const [i, t] of rep.trades.entries()) {
      let give = []; let get = []; let partner = t.with;
      if (t.source === 'offer') { get = (t.received ?? []).map(pname); give = (t.sent ?? []).map(pname); }
      else if (t.trade) {
        const tr = t.trade; const mineIsA = tr.teamA === my;
        give = (mineIsA ? tr.giveA : tr.giveB).map(pname); get = (mineIsA ? tr.giveB : tr.giveA).map(pname); partner = mineIsA ? tr.teamB : tr.teamA;
      }
      if (give.some((x) => !x) || get.some((x) => !x) || !give.length || !get.length) continue;
      add({ key: `${y}:trade${i}`, t: base(y) + 305 + i * 0.1, season: label, when: wen('트레이드'), kind: 'trade_done', scope: 'move', tags: ['우리 팀', '트레이드'], tone: 'neutral', delta: 0, comments: 2, vars: { team: nameOf(my), partner: nameOf(partner), give: give.join(', '), get: get.join(', ') } });
    }
    // 재계약
    const renewed = rep.renewed.filter((r) => r.teamId === my);
    if (renewed.length) add({ key: `${y}:resign`, t: base(y) + 310, season: label, when: wen('재계약'), kind: 'resign_done', scope: 'move', tags: ['우리 팀', '재계약'], tone: 'good', delta: 1.5, comments: 2, vars: { team: nameOf(my), count: renewed.length, names: renewed.slice(0, 3).map((r) => r.name).join(', ') } });
    const refused = rep.refused.filter((r) => r.teamId === my);
    if (refused.length) add({ key: `${y}:refuse`, t: base(y) + 311, season: label, when: wen('재계약'), kind: 'resign_fail', scope: 'move', tags: ['우리 팀', '재계약'], tone: 'bad', delta: -2, comments: 2, vars: { team: nameOf(my), count: refused.length, names: refused.slice(0, 3).map((r) => r.name).join(', ') } });
    // FA
    const sigs = rep.signings;
    sigs.filter((s) => s.teamId === my).slice(0, 3).forEach((s) => add({ key: `${y}:fain:${s.id}`, t: base(y) + 320 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_in', scope: 'move', tags: ['우리 팀', 'FA'], tone: 'good', delta: 2, comments: 2, playerComment: true, vars: { team: nameOf(my), player: s.name, salary: fmt1(s.salaryEok), years: s.years, round: s.round } }));
    sigs.filter((s) => s.from === my && s.teamId !== my).slice(0, 3).forEach((s) => add({ key: `${y}:faout:${s.id}`, t: base(y) + 321 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_out', scope: 'move', tags: ['우리 팀', 'FA'], tone: 'bad', delta: -2, comments: 2, vars: { team: nameOf(my), player: s.name, to: nameOf(s.teamId), salary: fmt1(s.salaryEok), years: s.years } }));
    sigs.filter((s) => s.teamId !== my && s.from !== my).sort((a, b) => b.salaryEok - a.salaryEok).slice(0, 2).forEach((s) => add({ key: `${y}:fabig:${s.id}`, t: base(y) + 322 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_big', scope: 'move', tags: ['리그', 'FA'], comments: 1, vars: { player: s.name, to: nameOf(s.teamId), salary: fmt1(s.salaryEok), years: s.years, round: s.round } }));
    // 보상
    for (const c of rep.compensations.filter((x) => x.from === my || x.to === my)) {
      const sg = sigs.find((s) => s.id === c.playerId); if (!sg) continue;
      add({ key: `${y}:comp:${c.playerId}`, t: base(y) + 330, season: label, when: wen('FA 보상'), kind: 'comp', scope: 'move', tags: ['우리 팀', 'FA'], tone: c.to === my ? 'neutral' : 'good', delta: 0, comments: 1, vars: { player: sg.name, from: nameOf(c.from), to: nameOf(c.to), compWhat: c.type === 'player' ? `선수 1명과 현금 ${fmt1(c.cashEok)}억` : `현금 ${fmt1(c.cashEok)}억` } });
    }
    // 드래프트
    rep.drafted.filter((d) => d.teamId === my).slice(0, 2).forEach((dd) => add({ key: `${y}:draft:${dd.id}`, t: base(y) + 340 + dd.pick * 0.01, season: label, when: wen('드래프트'), kind: 'draft_my', scope: 'move', tags: ['우리 팀', '드래프트'], tone: 'good', delta: 1, comments: 2, playerComment: true, vars: { team: nameOf(my), player: dd.name, pick: dd.pick, pos: dd.position, ovr: dd.ovr, potential: dd.potential } }));
    const first = rep.drafted.find((d) => d.pick === 1);
    if (first && first.teamId !== my) add({ key: `${y}:draft1`, t: base(y) + 341, season: label, when: wen('드래프트'), kind: 'draft_top', scope: 'league', tags: ['리그', '드래프트'], comments: 1, vars: { player: first.name, to: nameOf(first.teamId), pos: first.position, ovr: first.ovr, potential: first.potential } });
  });

  // 정렬: 시간, 같은 시각이면 생성 순
  events.sort((a, b) => a.t - b.t || a.seq - b.seq);

  // ----- 글 만들기: 템플릿 고르기, 팬 심리, 댓글 -----
  let score = mood0;
  const hist = [];
  const recentH = {}; const recentB = {}; const recentC = {};
  const items = [];
  const usedNicks = new Set();
  for (const ev of events) {
    const group = TEMPLATES[ev.kind];
    const rng = mulberry32(hashString(`${src.seed}:${ev.key}`));
    const hi = pickIndex(group.h, ev.vars, rng, (recentH[ev.kind] ??= []));
    const bi = pickIndex(group.b, ev.vars, rng, (recentB[ev.kind] ??= []));
    const headline = hi >= 0 ? fill(group.h[hi], ev.vars) : '';
    const body = bi >= 0 ? fill(group.b[bi], ev.vars) : '';
    // 팬 심리
    if (ev.delta) { score = clamp(score + ev.delta, 5, 95); }
    score += (50 - score) * 0.04;
    if (ev.flag === 'game' || ev.delta) hist.push(score);
    const trend = hist.length > 5 ? score - hist.at(-6) : hist.length ? score - hist[0] : 0;
    const label = moodLabel(score, trend);
    const comments = makeComments(ev, label, rng, src, usedNicks, recentC);
    items.push({
      id: ev.key, t: ev.t, season: ev.season, when: ev.when, kind: ev.kind, scope: ev.scope, tags: ev.tags, tone: ev.tone,
      outlet: OUTLETS[hashString(ev.key) % OUTLETS.length], headline, body, comments, mood: Math.round(score)
    });
    usedNicks.clear();
  }
  const finalScore = Math.round(score);
  const last5 = hist.length > 5 ? score - hist.at(-6) : hist.length ? score - hist[0] : 0;
  const lab = moodLabel(score, last5);
  const descRng = mulberry32(hashString(`${src.seed}:mood:${items.at(-1)?.id ?? ''}`));
  const descs = MOOD_DESC[lab];
  return {
    items: items.reverse(),
    mood: { score: finalScore, raw: score, label: lab, trend: Math.round(last5 * 10) / 10, desc: descs[Math.floor(descRng() * descs.length)], history: hist.slice(-20).map((v) => Math.round(v)) },
    outlets: OUTLETS
  };
}

function makeComments(ev, label, rng, src, used, recentC) {
  if (!ev.comments) return [];
  // 0~max개: 일반 경기 기사는 가끔만 댓글이 달린다
  let n = ev.comments;
  if (ev.comments === 1) n = rng() < 0.6 ? 1 : 0;
  else n = Math.max(1, ev.comments - (rng() < 0.3 ? 1 : 0));
  const out = [];
  const myName = src.teamName(src.myTeamId);
  for (let i = 0; i < n; i++) {
    const roll = rng();
    let type = 'mine';
    if (ev.refTeam && roll > 0.78) type = 'rival'; else if (roll > 0.92) type = 'neutral';
    let pool; let team;
    const vars = { ...ev.vars, team: myName };
    const offseasonKind = ev.scope === 'move' || /^(growth|retire)_/.test(ev.kind);
    if (type === 'rival') {
      pool = ev.tone === 'good' ? COMMENTS.rival_good : COMMENTS.rival_bad; team = `${src.teamName(ev.refTeam)} 팬`;
    } else if (type === 'neutral') { pool = offseasonKind ? COMMENTS.move_neutral : COMMENTS.neutral; team = '중립'; }
    else {
      team = `${myName} 팬`;
      if (ev.kind === 'preview') pool = COMMENTS.preview;
      else if (/^(cap_over|funds_)/.test(ev.kind)) pool = COMMENTS.finance;
      else if (offseasonKind) pool = ev.playerComment && ev.tone !== 'bad' && rng() < 0.5 ? COMMENTS.player_good : ev.tone === 'good' ? COMMENTS.move_good : ev.tone === 'bad' ? COMMENTS.move_bad : COMMENTS.move_neutral;
      else if (ev.scope === 'league') pool = ev.playerComment && rng() < 0.6 ? COMMENTS.player_good : COMMENTS.neutral;
      else if (ev.playerComment && ev.tone !== 'bad' && rng() < 0.6) pool = COMMENTS.player_good;
      else if (ev.tone === 'good' && (label === '격앙' || label === '체념' || label === '불안') && rng() < 0.6) pool = COMMENTS.relief;
      else if (ev.tone === 'bad' && (label === '환호' || label === '기대') && rng() < 0.6) pool = COMMENTS.sting;
      else pool = COMMENTS[label];
    }
    const poolName = Object.keys(COMMENTS).find((k) => COMMENTS[k] === pool);
    const idx = pickIndex(pool, vars, rng, (recentC[poolName] ??= []));
    if (idx < 0) continue;
    let nick = NICKS[Math.floor(rng() * NICKS.length)];
    for (let k = 0; k < 6 && used.has(nick); k++) nick = NICKS[Math.floor(rng() * NICKS.length)];
    used.add(nick);
    const votes = 3 + Math.floor(rng() * rng() * 320 * (1 + ev.comments * 0.3));
    out.push({ nick, team, votes, text: fill(pool[idx], vars) });
  }
  return out.sort((a, b) => b.votes - a.votes);
}

/** 템플릿·댓글 전체 문자열(금지어 검사용) */
export function allTemplateStrings() {
  return [
    ...Object.values(TEMPLATES).flatMap((g) => [...g.h, ...g.b]),
    ...Object.values(COMMENTS).flat(), ...Object.values(MOOD_DESC).flat(), ...NICKS, ...OUTLETS
  ];
}
