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
const PAIRS = { '이/가': ['이', '가'], '은/는': ['은', '는'], '을/를': ['을', '를'], '과/와': ['과', '와'], '으로/로': ['으로', '로'], '이라/라': ['이라', '라'], '이다/다': ['이다', '다'], '이었다/였다': ['이었다', '였다'], '이었/였': ['이었', '였'] };
export function josa(word, pair) {
  const [withB, noB] = PAIRS[pair] ?? pair.split('/');
  const f = finalSound(word);
  if (pair === '으로/로') return f === 'yes' ? withB : noB;
  return f === 'none' ? noB : withB;
}

const TOKEN = /\{(\w+)(?::([^}]+))?\}/g;
/** 선수 이름 앞의 카드 연도 표기("26 허웅", "97초 정재근")는 기사 문장에서 뗀다 */
const plainName = (s) => s.replace(/^\d{2}초? (?=\S)/, '');

/** 템플릿의 {이름}·{이름:조사}를 채운다. 채울 값이 없는 토큰이 있으면 null */
export function fill(template, vars) {
  let missing = false;
  const out = template.replace(TOKEN, (_, key, pair) => {
    const v = vars[key];
    if (v == null) { missing = true; return ''; }
    const s = plainName(String(v));
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
  awards: {
    h: ['{season} 정규리그 MVP에 {mvp}… {mvpTeam} 소속', '{mvp}, {season} 시즌 최고의 선수로 뽑혔다', '{season} 어워드 발표: MVP는 {mvp}', '{mvpTeam}의 {mvp:이/가} MVP를 차지했다', '{season} 시즌 시상: {mvp}가 이끈 한 해'],
    b: ['{season} 시즌 정규리그 MVP는 {mvpTeam}의 {mvp:으로/로} 정해졌다. 기록은 {mvpLine}.', '{mvpTeam}의 {mvp:이/가} {season} 정규리그 MVP에 올랐다. 시즌 기록은 {mvpLine}.', '{season} 시즌 시상 결과가 나왔다. 정규리그 MVP는 {mvpLine:을/를} 기록한 {mvpTeam}의 {mvp}다.', '{mvp:이/가} {season} 시즌 정규리그 MVP를 받았다. {mvpTeam} 소속으로 {mvpLine:을/를} 남겼다.', '올 시즌 최고의 선수는 {mvpTeam}의 {mvp}였다. 시즌 기록은 {mvpLine}, 정규리그 MVP로 선정됐다.']
  },
  goals_eval: {
    h: ['모기업 시즌 평가: {team}, 목표 {goalsTotal}개 중 {goalsMet}개 달성', '{season} 모기업 평가 발표… 단장 신뢰도 {trust}점', '{team} 모기업, {season} 시즌 성적표를 공개했다', '{season} 목표 달성도 {goalsMet}/{goalsTotal}, 단장 신뢰도 {trust}점', '모기업이 본 {team}의 {season} 시즌'],
    b: ['{team}의 모기업이 {season} 시즌 평가를 마쳤다. 시즌 초에 제시한 목표 {goalsTotal}개 가운데 {goalsMet}개를 달성했고, 단장 신뢰도는 {trustMove}.', '{season} 시즌 목표 {goalsTotal}개 중 {goalsMet}개가 달성으로 인정됐다. 이에 따라 단장 신뢰도는 {trustMove}.', '모기업은 {season} 시즌 목표({goalsText}) 달성 여부를 평가했다. 결과는 {goalsMet}/{goalsTotal}이고 단장 신뢰도는 {trustMove}.', '{team:은/는} {season} 시즌 모기업 평가에서 {goalsMet}개 목표를 채웠다. 단장 신뢰도는 {trustMove}.']
  },
  waiver_my: {
    h: ['{player}, 웨이버 {outcomeShort}… {team}', '웨이버 시장 소식: {player} {outcomeShort}', '{team} {player} 웨이버, {outcomeShort}', '{player}의 웨이버 결과는 {outcomeShort}', '{day}일차 웨이버: {player} {outcomeShort}'],
    b: ['{statusText}', '{day}일차 웨이버 소식이다. {statusText}', 'KBL 웨이버 절차에 따른 결과다. {statusText}', '{statusText} 규약이 정한 절차를 그대로 밟았다.']
  },
  coach_change: {
    h: ['{team}, {oldHead} 감독과 결별… 새 사령탑 {newHead}', '{team:은/는} {newHead} 감독을 선임했다', '{season} 시즌 {rank}위 {team}, 감독 교체 단행', '{newHead} 감독, {team} 지휘봉 잡는다', '{team}의 사령탑이 바뀐다: {oldHead}에서 {newHead}로'],
    b: ['{team:은/는} {season} 시즌을 {rank}위({record})로 마친 뒤 {oldHead} 감독과 계약을 정리하고 {newHead} 감독을 새 사령탑으로 선임했다.', '{season} 정규리그 {rank}위에 그친 {team:이/가} 감독을 바꿨다. {oldHead} 감독이 물러나고 {newHead} 감독이 {nextSeason} 시즌부터 팀을 이끈다.', '{team}의 {oldHead} 감독이 시즌 종료와 함께 지휘봉을 내려놓았다. 후임은 {newHead} 감독이다.', '{rank}위({record})라는 성적표를 받은 {team:은/는} {newHead} 감독 체제로 {nextSeason} 시즌을 준비한다.']
  },
  injury_my: {
    h: ['{player}, {part:으로/로} {absence}', '{team} {player} 부상… {absence}', '{team}에 부상 악재, {player}의 {part}', '{player} 부상 이탈, {team:은/는} 대안을 찾아야 한다', '{part} 진단 {player}, 한동안 코트를 떠난다'],
    b: ['{team}의 {player:이/가} {day}일차 경기에서 {part} 진단을 받았다. 예상 결장 기간은 {gamesText:이다/다}.', '{player:이/가} {part:으로/로} 이탈한다. 진단 결과 결장 기간은 {gamesText:이다/다}.', '{team:은/는} {day}일차 경기 뒤 {player}의 부상({part})을 확인했다. 예상 결장은 {gamesText:이다/다}.', '{part} 진단을 받은 {player:은/는} {gamesText:을/를} 쉬어야 한다. {team}의 선수단 운영에 변수가 생겼다.']
  },
  injury_star: {
    h: ['{team} {player}, {part:으로/로} {absence}', '{player} 부상 소식… {team:은/는} 전력 누수', '{team}의 {player}, {part} 진단', '{part}에 쓰러진 {player}, {team}의 고민'],
    b: ['{team}의 {player:이/가} {day}일차 경기에서 {part} 진단을 받았다. 결장 기간은 {gamesText:이다/다}.', '{player:이/가} {part:으로/로} 코트를 떠난다. {team:은/는} {gamesText:을/를} 그 없이 치러야 한다.', '{day}일차 경기 뒤 {team} {player}의 {part}가 확인됐다. 결장은 {gamesText:으로/로} 예상된다.', '{team:은/는} {player}의 부상({part})으로 장기 결장이 불가피해졌다. 기간은 {gamesText:이다/다}.']
  },
  fa_season: {
    h: ['{team}, 시장에 남은 {player} 영입', '{player}, 시즌 중 {team}에 합류', '{team:은/는} {day}일차에 {player:을/를} 데려왔다', '시즌 중 보강: {team}의 {player} 영입'],
    b: ['{team:은/는} {day}일차에 시장에 남아 있던 {player:을/를} 영입했다. 연봉은 {salary}억, 계약은 이번 시즌을 포함해 {years}년이다.', '{player:이/가} 시즌 중 {team}에 합류했다. 계약 조건은 연봉 {salary}억, 이번 시즌 포함 {years}년이다.', '{team:은/는} FA 시장에 남은 {player}와 {day}일차에 계약했다. 연봉 {salary}억에 {years}년 계약이다.', '{day}일차, {team:은/는} {player:을/를} 연봉 {salary}억(이번 시즌 포함 {years}년)에 영입했다.']
  },
  foreign_swap_my: {
    h: ['{team}, {origText} {kindText}… {player} 합류', '{outName} 대신 {player}, {team}의 {kindText}', '{team:은/는} {day}일차에 {origShort} {kindText:을/를} 택했다', '{player:이/가} {team}의 새 {origText}로 등록됐다'],
    b: ['{team:은/는} {day}일차에 {origText} {outName} 대신 {player:을/를} 등록했다. 방식은 {kindText:이다/다}.', '{team}의 {kindText:이/가} 이뤄졌다. {outName} 자리에 {player:이/가} 들어왔고, 요구 연봉은 {usdText:이다/다}.', '{day}일차 {team:은/는} {origText} 교체({kindText})를 마쳤다. 새 선수는 {player}이다.', '{player:이/가} {outName} 대신 {team}에 합류했다. {kindText} 절차로 등록했다.']
  },
  foreign_swap_lg: {
    h: ['{team}, {origText} {kindText}… {player} 합류', '{outName} 대신 {player}, {team}의 {kindText}', '{team:은/는} {day}일차에 {origShort} {kindText:을/를} 했다', '{player:이/가} {team}의 새 {origText}로 등록됐다'],
    b: ['{team:은/는} {day}일차에 {origText} {outName} 대신 {player:을/를} 등록했다. 방식은 {kindText:이다/다}.', '{team:이/가} {origText:을/를} 바꿨다. {outName} 자리에 {player:이/가} 들어왔고, 방식은 {kindText:이다/다}.', '{day}일차 {team:은/는} {origText} 교체({kindText})를 마쳤다. 새 선수는 {player}이다.', '{player:이/가} {outName} 대신 {team}에 합류했다. {kindText} 절차로 등록했다.']
  },
  retire_my: {
    h: ['{player}, 현역 은퇴', '{team}의 {player}, 코트를 떠난다', '은퇴 선언… {player}({age}세)', '{player}, 은퇴로 마무리한 선수 생활'],
    b: ['{team}의 {player:이/가} 시즌 종료와 함께 은퇴했다. 나이는 {age}세, 마지막 OVR은 {ovr}.', '{age}세의 {player:이/가} 현역에서 물러난다. 마지막 시즌 OVR은 {ovr}이었다.', '{team:은/는} {player:을/를} 떠나보낸다. 은퇴 당시 나이는 {age}세다.', '{player}의 이름이 {team}의 선수단에서 빠진다. 은퇴 시점 OVR {ovr}.']
  },
  retire_star: {
    h: ['{player}, 은퇴 발표', '{from}의 {player}, 현역 마감', '{player}({age}세), 코트와 작별', '은퇴 소식: {player}'],
    b: ['{from}의 {player:이/가} 은퇴한다. {age}세, 마지막 OVR {ovr:으로/로} 이번 오프시즌 은퇴 선수 중 가장 높았다.', '{age}세의 {player:이/가} 현역에서 물러난다. 마지막 OVR은 {ovr}이었다.', '{from}에서 뛴 {player:이/가} 시즌을 끝으로 은퇴했다.', '이번 은퇴 선수 중 OVR이 가장 높은 {player}({ovr}). 소속은 {from}이었다.']
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
    b: ['{team:은/는} 드래프트 {pick}순위로 {player:을/를} 지명했다. 포지션 {pos}, OVR {ovr}.', '{player}의 첫 소속은 {team}이다. 지명 순위는 {pick}순위, OVR은 {ovr}.', '{team}의 신인 {player:은/는} OVR {ovr}, 잠재력 {potential:으로/로} 평가된다. 포지션은 {pos}이다.', '드래프트 {pick}순위 {player:이/가} {team}에 합류한다.']
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
  player_good: ['{player}의 기록이 인상적이네요', '{player} 오늘 박스스코어 보면 대단합니다', '{player}의 꾸준함이 팀에 큰 힘입니다', '오늘의 주인공은 {player:이었/였}네요'],
  star_neutral: ['{player}의 기록이 인상적이네요', '{player} 오늘 박스스코어 보면 대단합니다', '리그에 이런 선수가 있다는 게 반갑네요', '{player} 상대 팀은 고민이 많겠어요', '{line}면 이날 최고의 활약이죠'],
  star_fan: ['우리 {player} 오늘 대단했죠', '{player:이/가} 이렇게 해 주면 든든합니다', '{starTeam} 팬으로서 뿌듯하네요', '{line} 기록 보셨나요, 정말 잘했어요', '이런 활약 계속 보고 싶습니다'],
  move_good: ['좋은 선택 같습니다', '이런 소식이 반갑네요', '새 시즌이 기대됩니다', '이 정도면 만족입니다', '보강이 필요했던 자리라 반갑습니다', '기록을 보면 기대해 볼 만하죠'],
  move_bad: ['아쉽지만 팀 사정이 있겠죠', '빈자리가 커 보입니다', '이 공백을 어떻게 메울지가 관건이네요', '응원했던 선수라 서운하네요', '다음 선택을 지켜보겠습니다'],
  finance: ['재정이 탄탄해야 오래 가죠', '곳간 관리도 중요합니다', '숫자로 보니 현실적이네요', '캡 관리가 쉽지 않은 시대입니다'],
  preview: ['시즌이 기다려지네요', '올해는 기대 반 걱정 반입니다', '라인업 고민이 깊어지는 시기네요', '빨리 개막했으면 좋겠습니다'],
  reply: ['저도 같은 생각입니다', 'ㅇㅈ합니다', '맞아요, 그 부분이 제일 중요하죠', '동의합니다. 다음 경기에서 확인해 봅시다', '반대 의견도 있겠지만 저는 응원합니다', '그렇게 보는 분들이 많더라고요', '말씀 듣고 보니 그렇네요', '공감합니다 ㅎㅎ'],
  detail_good: ['{rank}위면 선방이죠, 이 페이스 유지했으면', '{record}면 나쁘지 않은 출발입니다', '다음 상대가 {nextOpp}인데 이 기세면 기대됩니다', '시즌 평균 득점 {ppgFor}점이면 공격은 믿어도 되겠어요', '{opp}전 승리 값지네요, 올 시즌 상대 전적도 {h2h}입니다', '최근 5경기 {l5}면 흐름이 좋은 편이죠'],
  detail_bad: ['{record:으로/로} {rank}위라 마음이 편치 않네요', '{nextOpp}전이 고비가 되겠어요', '실점 평균 {ppgAgn}점은 줄여야 합니다', '{opp}전 결과는 아쉽지만 남은 경기가 많으니까요', '최근 5경기 {l5}라 반등 포인트가 필요해 보입니다', '{rank}위에서 플레이오프권을 지킬 수 있을지 지켜보겠습니다'],
  preview_detail: ['전력 {powerRank}위면 해볼 만합니다, 개막이 기대되네요', '{core} 조합이 어떨지 궁금합니다', '올해 목표는 {season} 시즌 6강이라고 봅니다', '외국 선수 활약에 시즌이 달렸다고 봐요', '캡에 여유가 있으니 시즌 중 움직임도 기대해 봅니다'],
  injury: ['부상이 크지 않았으면 좋겠습니다', '빈자리를 누가 메울지가 관건이네요', '벤치 자원들이 기회를 잡길 바랍니다', '회복 잘하고 건강하게 돌아오길', '이럴 때 로스터 관리가 중요하죠', '이탈이 길어지지 않기를 바랄 뿐입니다'],
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
const NEXT_ROUND = { '6강': '4강', '4강': '챔피언결정전' };
const ORIGIN_TEXT = { domestic: '국내', foreign: '외국', asia: '아시아쿼터' };
/** 카드 연도 표기("26 허웅", "97초 허웅")를 뗀 이름 */
export const cleanName = (s) => String(s ?? '').replace(/^(?:\d{2}|97초)\s+/u, '');

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

/** 시즌 평가의 목표 한 줄을 기사 문장 조각으로(src/goals.mjs describeGoal과 같은 뜻) */
const GOAL_TEXT = (g) => ({ rank: `정규리그 ${g.value}위 이내`, stage: g.value === '우승' ? '우승' : `플레이오프 ${g.value} 이상`, winPct: `승률 ${Math.round(g.value * 100)}% 이상`, profit: g.value > 0 ? `순이익 ${g.value}억 이상` : '흑자', payroll: '국내 연봉 캡 준수', youth: '젊은 선수 출전' }[g.kind] ?? '목표');
const recordText = (w, l) => `${w}승 ${l}패`;
const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const money = (v) => fmt1(Math.abs(v));
const pct3 = (w, l) => (w + l ? (w / (w + l)).toFixed(3) : '0.000');

// ---------- 본문 문장 풀 ----------
// 본문은 문단 여러 개다. 문단은 PLAN이 정한 "문장 칸"을 차례로 채운다. 칸마다 변형이 4개 이상이고,
// 문장에 쓸 값이 하나라도 없으면 그 변형은 쓰지 않는다(값이 없는 칸은 건너뛴다). 'lead'는 종류별 TEMPLATES.b.
export const SENT = {
  inj_status: ['{player:은/는} {part} 진단을 받았고 결장 기간은 {gamesText:으로/로} 알려졌다. 상태는 {kindText:으로/로} 분류된다.', '{part:으로/로} 쓰러진 {player}의 진단명은 {part:이고/고}, 몸 상태는 {kindText}에 해당한다. 결장은 {gamesText:으로/로} 잡혔다.', '진단 결과는 {part}, 결장은 {gamesText:이다/다}. 부상 정도는 {kindText:으로/로} 본다.', '{player:이/가} 받은 진단은 {part:이다/다}. {kindText} 수준이고 {gamesText:을/를} 쉬게 된다.'],
  inj_info: ['{pAge}세 {pPos} 선수 {player}의 현재 OVR은 {pOvr}이다.', '{player:은/는} 포지션 {pPos}, 나이 {pAge}세, OVR {pOvr}의 선수다.', '{pPos} 자리의 {player}({pAge}세, OVR {pOvr})가 빠지게 됐다.', 'OVR {pOvr}의 {pPos} {player}({pAge}세)가 로테이션에서 빠진다.'],
  inj_lineup: ['부상 선수는 라인업에서 자동으로 빠지고 건강한 선수가 같은 자리에 선다.', '{team:은/는} 남은 선수들로 로테이션을 다시 짜야 한다. 직접 편성한 라인업이라면 대체 선수가 자동으로 들어간다.', '결장하는 동안 출전 시간과 기록은 쌓이지 않고, 라인업은 건강한 선수들로 채워진다.', '당분간 {team}의 라인업은 건강한 선수만으로 구성된다. 복귀하면 원래 편성으로 돌아간다.'],
  inj_back: ['{backDay}일차 경기부터 복귀가 가능하다.', '일정대로라면 {backDay}일차 경기부터 다시 코트에 설 수 있다.', '복귀 가능 시점은 {backDay}일차 경기다.', '{backDay}일차부터는 출전이 가능하다는 계산이다.'],
  inj_kind: ['{kindText} 수준의 부상은 시즌 중 언제든 생길 수 있는 일이다. 이번 일로 선수층의 깊이가 시험대에 올랐다.', '이런 부상은 출전 시간이 길수록 잦아진다. 체력과 나이, 연속 출전이 위험을 조금씩 높인다.', '부상 변수가 생긴 만큼 벤치 자원의 역할이 커졌다. 로스터 관리가 시즌의 변수가 된다.', '시즌이 길어질수록 부상은 순위 싸움의 변수가 된다. 대체 자원을 점검해 둘 시점이다.'],
  wv_info: ['{pAge}세 {pPos} 선수 {player}의 OVR은 {pOvr}이다.', '{player:은/는} 포지션 {pPos}, 나이 {pAge}세, OVR {pOvr}의 선수다.', '{pPos} 포지션의 {player}({pAge}세, OVR {pOvr})를 둘러싼 움직임이다.', 'OVR {pOvr}의 {pPos} {player}({pAge}세)가 이번 웨이버의 주인공이다.'],
  wv_rule: ['{ruleText}', '참고로 {ruleText}', '규약은 이렇게 정한다. {ruleText}', '이번 절차의 근거 규정: {ruleText}'],
  wv_money: ['{moneyText}', '정산은 이렇게 처리된다. {moneyText}', '{moneyText} 자세한 내역은 시즌 결산 장부에 남는다.', '돈 문제는 이렇다. {moneyText}'],
  wv_next: ['{nextText}', '남은 시즌 {remain}경기, {nextText}', '{nextText} 선수단 운영의 방향이 곧 드러난다.', '시즌은 {remain}경기가 남았다. {nextText}'],
  fs_info: ['{pAge}세 {pPos} 선수 {player}의 OVR은 {pOvr}이다.', '{player:은/는} 포지션 {pPos}, 나이 {pAge}세, OVR {pOvr}의 선수다.', '{pPos} 자리를 보강하는 {player}({pAge}세)는 OVR {pOvr}이다.', 'OVR {pOvr}의 {pPos} {player}({pAge}세)가 선수단에 더해졌다.'],
  fs_contract: ['계약은 연봉 {salary}억에 이번 시즌 포함 {years}년이다. 이미 지난 경기 비율만큼은 보수를 내지 않고 합류한 뒤부터 정산한다.', '연봉 {salary}억은 시즌 정산에서 합류한 뒤의 비율만큼만 지출로 잡힌다. 계약 기간은 이번 시즌을 포함해 {years}년이다.', '조건은 연봉 {salary}억, {years}년(이번 시즌 포함)이다. 보수는 합류한 날부터 계산한다.', '{team}이 낸 연봉 {salary}억은 캡 계산에 바로 들어간다. 지출은 합류 이후의 경기 비율만큼 정산된다.'],
  fs_why: ['시즌 중 영입은 오프시즌 FA에서 계약하지 못한 선수 가운데에서 고른다. 국내 선수 12명의 자리가 차 있으면 먼저 방출이 필요하다.', '시장에 남은 선수는 오프시즌 요구액보다 낮은 조건으로 계약할 수 있다. 최저 연봉 아래로는 내려가지 않는다.', '{team:은/는} 로스터와 캡 여유를 확인한 뒤 영입했다. 소프트캡 초과분은 시즌 말 기금으로 정산된다.', '선수층을 두껍게 하려는 선택이다. 영입 선수도 훈련과 출전 기록이 일반 선수와 똑같이 쌓인다.'],
  fs_next: ['시즌은 {remain}경기가 남았다. 새 선수가 얼마나 빨리 자리를 잡는지가 관건이다.', '남은 정규리그는 {remain}경기다. 이 영입이 순위 싸움에 어떤 영향을 줄지 지켜볼 만하다.', '정규리그 {remain}경기가 더 남았다. 영입 효과는 라인업에서 확인할 수 있다.', '앞으로 {remain}경기, 이번 영입이 로테이션에 어떤 변화를 줄지가 관심사다.'],
  fw_info: ['{player}의 OVR은 {ovr}이고 요구 연봉은 {usdText}이다.', '새 {origText} {player:은/는} OVR {ovr}, 요구 연봉 {usdText}이다.', '{outName}의 자리를 맡는 {player:은/는} OVR {ovr}의 선수로, 연봉은 {usdText}이다.', 'OVR {ovr}의 {player:이/가} 연봉 {usdText}에 등록됐다.'],
  fw_rule: ['{ruleText}', '참고로 {ruleText}', '관리규정은 이렇다. {ruleText}', '이번 교체의 근거 규정: {ruleText}'],
  fw_pay: ['{payText}', '정산은 이렇게 처리된다. {payText}', '{payText} 연봉 한도도 지켜야 한다.', '금액 처리: {payText}'],
  fw_next: ['시즌은 {remain}경기가 남았다. 새 {origText}의 적응이 변수다.', '남은 정규리그 {remain}경기에서 교체 효과가 드러난다.', '{remain}경기가 더 남았다. {origText} 활약이 순위 싸움을 좌우할 수 있다.', '앞으로 {remain}경기, 교체 선수가 로테이션에 자리를 잡을지가 관심이다.'],
  scoreboard: ['점수 차는 {margin}점, 두 팀이 올린 점수는 모두 {total}점이다.', '{team}의 득점은 {my}점, 실점은 {oppPts}점이었다.', '양 팀 득점 합계는 {total}점이고 점수 차는 {margin}점이었다.', '{venue} 경기였고 {team:은/는} {my}점을 넣고 {oppPts}점을 내줬다.'],
  h2h: ['올 시즌 {opp:과/와}의 맞대결 전적은 이번 경기를 포함해 {h2h:이/가} 됐다.', '{opp:과/와}는 올해 {h2h:으로/로} 맞서 있다.', '이번 경기까지 {opp}전 전적은 {h2h}다.', '시즌 상대 전적으로 보면 {team:은/는} {opp} 상대 {h2h}다.'],
  standing: ['이 결과로 {team:은/는} {record}, 리그 {rank}위에 자리했다. {gapText}', '{day}일차까지의 성적은 {record:으로/로} 순위는 {rank}위다. {gapText}', '순위표에서 {team:은/는} {rank}위({record})에 올라 있다. {gapText}', '{record:이/가} 된 {team}의 현재 순위는 {rank}위다. {gapText}'],
  form: ['최근 5경기는 {l5:으로/로} 흐름이 {formWord}. 시즌 평균 {ppgFor}점을 넣고 {ppgAgn}점을 내주고 있다.', '{l5:을/를} 기록한 최근 흐름은 {formWord}. 경기당 득점은 {ppgFor}점, 실점은 {ppgAgn}점이다.', '시즌 평균 득점 {ppgFor}점, 평균 실점 {ppgAgn}점이다. 최근 5경기 성적은 {l5:으로/로} 흐름이 {formWord}.', '경기당 {ppgFor}점을 넣고 {ppgAgn}점을 내주는 {team}의 최근 5경기는 {l5}이고, 분위기는 {formWord}.'],
  lastSeason: ['지난 시즌 {team:은/는} {lastRec:으로/로} {lastRank}위를 기록했고, 통산 우승은 {titles}회다.', '지난 시즌 성적은 {lastRank}위({lastRec}). 올해 {record:과/와} 비교하면 {cmpWord}', '{team}의 지난 시즌 최종 순위는 {lastRank}위, 통산 우승 {titles}회의 전통을 가진 구단이다.', '{opp:은/는} 지난 시즌 {oppLastRank}위로 마쳤고 올해는 {oppRank}위({oppRec})에 있다.', '통산 우승 {titles}회의 {team:은/는} 지난 시즌 {lastRank}위로 마쳤다. 올 시즌 페이스는 {cmpWord}'],
  spot_star: ['{star:이/가} {starLine:으로/로} 팀 공격을 이끌었다. {starAge}세 {starPos} 선수로 현재 OVR은 {starOvr}이다.', '이날 가장 눈에 띈 선수는 {star}. {starLine:을/를} 기록했고 포지션은 {starPos}, 나이는 {starAge}세다.', '{star}({starAge}세, {starPos}) 선수는 {starLine:으로/로} 경기에 영향을 줬다.', '기록 상위는 {star}. {starLine:을/를} 남겼고 계약은 연봉 {starSalary}억에 {starYears}년이 남았다.', '{star:이/가} {starLine:을/를} 올렸다. {starOrigin} 선수로 연봉 {starSalary}억을 받는다.'],
  spot_avg: ['{star}의 시즌 평균은 {starAvg}다.', '시즌 기록으로 보면 {star:은/는} {starAvg:을/를} 기록 중이다.', '이번 시즌 {star}의 누적 평균은 {starAvg}.', '{star:은/는} 경기당 평균 {starAvg:을/를} 만들고 있다.'],
  spot_opp: ['상대 {oppStar:은/는} {oppStarLine:을/를} 올렸다. 시즌 평균은 {oppStarAvg}다.', '{opp}에서는 {oppStar:이/가} {oppStarLine:으로/로} 맞섰다.', '{opp}의 {oppStar:이/가} {oppStarLine:을/를} 기록했고, 시즌 평균 {oppStarAvg}의 선수다.', '맞상대 {oppStar}의 기록은 {oppStarLine:이었다/였다}.'],
  next: ['다음 경기는 {nextVenue}에서 {nextOpp:과/와} 치른다.', '{team}의 {nextDay}일차 상대는 {nextOpp}({nextVenue})다.', '일정상 다음 상대는 {nextOpp}, {nextVenue} 경기다.', '이어지는 {nextDay}일차에는 {nextVenue}에서 {nextOpp:을/를} 만난다.'],
  remain: ['정규리그는 {remain}경기가 남아 있다.', '시즌 {games}경기 중 {remain}경기가 남았다.', '남은 경기는 {remain}경기다.', '{games}경기 가운데 {day}경기를 치렀고 {remain}경기가 남았다.', '{day}일차를 마친 지금 {remain}경기가 더 남아 있다.', '앞으로 치를 정규리그 경기는 {remain}경기다.', '{games}경기 일정 가운데 {remain}경기가 남은 시점이다.', '{allPlayed}경기를 모두 치러 정규리그 일정이 끝났다.'],
  team_leader: ['{team}의 득점 선두는 {tmName:으로/로} 경기당 {tmPpg}점을 올리고 있다.', '팀 내 득점 1위는 경기당 {tmPpg}점의 {tmName}이다.', '{tmName:이/가} 경기당 {tmPpg}점으로 {team}의 공격을 책임지고 있다.', '{team}에서는 {tmName:이/가} 평균 {tmPpg}점으로 득점 선두다.'],
  top3: ['현재 순위표 상단은 {top3}이다.', '상위 세 팀은 {top3} 순이다.', '순위표를 보면 {top3:이/가} 앞서 있다.', '선두권 구도는 {top3}이다.'],
  // 개막 전 전망
  pv_core: ['핵심 전력은 {core}이다.', '로스터에서 능력치가 가장 높은 세 선수는 {core}이다.', '{team}의 간판은 {core:으로/로} 꼽힌다.', '주축 선수는 {core}이다.'],
  pv_foreign: ['외국 선수는 {foreignText}.', '코트에 서는 외국 선수 진용은 {foreignText}.', '{foreignText}. 아시아쿼터는 {asiaText}.', '외국 선수는 {foreignText}, 아시아쿼터는 {asiaText}.'],
  pv_cap: ['국내 선수 연봉은 {payroll}억으로 캡 {cap}억 대비 {capRoom:이다/다}. 구단 자금은 {funds}억이다.', '캡 사정을 보면 국내 선수 연봉 {payroll}억, 캡 {cap}억으로 {capRoom:이다/다}. 자금은 {funds}억을 쥐고 있다.', '{team:은/는} 국내 선수 연봉이 {payroll}억이고 캡은 {cap}억이라 {capRoom:이다/다}.', '재정은 국내 선수 연봉 {payroll}억(캡 {cap}억, {capRoom}), 구단 자금 {funds}억이다.'],
  pv_last: ['지난 시즌 {team:은/는} {lastRec:으로/로} {lastRank}위에 올랐고, 통산 우승 {titles}회에 정규리그 1위 {regTitles}회의 전통이 있다.', '{lastRank}위({lastRec})로 마친 지난 시즌 기록 위에 새 시즌이 시작된다. 통산 우승은 {titles}회다.', '지난 시즌 성적은 {lastRank}위, 전통 점수는 {tradition}점이다.', '통산 우승 {titles}회의 구단이 지난 시즌 {lastRank}위({lastRec})를 딛고 새 시즌을 맞는다.'],
  pv_city: ['같은 {city:을/를} 연고로 하는 {cityRival:은/는} 지난 시즌 {cityRivalRank}위였다. 연고 라이벌과의 대결이 관심을 모은다.', '{city} 연고 {cityRival}과는 지난 시즌 순위가 {cityRivalRank}위였다. 서로를 의식할 수밖에 없는 사이다.', '{team}의 홈 {arena}에서는 같은 도시의 {cityRival:과/와} 맞대결이 열린다.', '{cityRival:은/는} 같은 {city} 구단으로, 지난 시즌 {cityRivalRank}위를 했다.'],
  pv_top: ['게임이 계산한 전력 1위는 {topRival}이다. {team}과의 격차를 줄이는 것이 과제다.', '전력 순위 맨 위의 {topRival:은/는} 우승 후보로 꼽힌다.', '가장 높은 평가를 받은 팀은 {topRival}이다.', '전력만 보면 {topRival:이/가} 가장 앞서 있다.'],
  pv_task: ['올 시즌 {team}의 과제는 분명하다. {taskText}', '{season} 시즌 목표는 {taskText}', '출발선에서 {team:이/가} 안고 있는 숙제는 이것이다. {taskText}'],
  // 경기·순위 기사 보조
  st_info: ['{player:은/는} {sAge}세 {sPos} 선수로 {sOrigin} 소속이며 현재 OVR은 {sOvr}이다.', '{sPos} 포지션의 {player:은/는} {sAge}세로 OVR {sOvr}의 선수다.', '{starTeam}의 {player:은/는} {sAge}세, 포지션 {sPos}, 능력치 OVR {sOvr}이다.', '{sAge}세 {sPos} {player:은/는} OVR {sOvr:으로/로} 평가된다.'],
  st_avg: ['시즌 평균은 {sAvg:이다/다}.', '이번 시즌 {player}의 평균 기록은 {sAvg}.', '{player:은/는} 경기당 평균 {sAvg:을/를} 올리고 있다.', '누적 평균으로 보면 {sAvg:이다/다}.'],
  st_contract: ['계약은 연봉 {sSalary}억에 {sYears}년이 남았다.', '연봉은 {sSalary}억이고 계약기간은 {sYears}년 남아 있다.', '{sSalary}억의 연봉으로 {sYears}년 더 {starTeam:과/와} 함께한다.', '남은 계약은 {sYears}년, 연봉은 {sSalary}억이다.'],
  st_team: ['{starTeam:은/는} 이 경기 뒤 {sTeamRec:으로/로} {sTeamRank}위에 올라 있다.', '{starTeam}의 성적은 {sTeamRec}, 순위는 {sTeamRank}위다.', '이날 경기를 마친 {starTeam:은/는} {sTeamRank}위({sTeamRec})다.', '{sTeamRank}위 {starTeam}의 전적은 {sTeamRec}다.'],
  // 플레이오프
  po_games: ['시리즈는 {nGames}경기로 끝났다. 경기별 결과는 {gameList}이다.', '경기별 기록은 {gameList}이다. 시리즈는 {nGames}경기였다.', '{nGames}경기 만에 갈린 시리즈의 기록은 {gameList}.', '시리즈 기록: {gameList}. 총 {nGames}경기를 치렀다.'],
  po_seeds: ['정규리그에서 {winner:은/는} {winnerRank}위, {loser:은/는} {loserRank}위였다. {upsetText}', '{winner}의 정규리그 순위는 {winnerRank}위, {loser:은/는} {loserRank}위였다. {upsetText}', '정규리그 순위로는 {loser:이/가} {loserRank}위, {winner:이/가} {winnerRank}위였다. {upsetText}', '{winner}({winnerRank}위)와 {loser}({loserRank}위)의 맞대결이었다. {upsetText}'],
  po_my: ['{team}의 이번 포스트시즌 성적은 {myPoText}.', '{team:은/는} 정규리그 {myRank}위로 올라 {myPoText}.', '정규리그 {myRank}위로 시작한 {team}의 포스트시즌은 {myPoText}.', '{team}의 여정은 {myPoText}.'],
  po_next: ['다음 라운드는 {nextRound}이다.', '이제 {nextRound:이/가} 기다린다.', '{nextRound} 대진이 이어진다.'],
  po_end: ['{season} 시즌 챔피언이 가려지며 이번 시즌 일정이 모두 끝났다.', '챔피언결정전을 끝으로 {season} 시즌 순위 싸움은 막을 내렸다.', '이로써 {season} 시즌의 주인공이 결정됐다.', '시즌의 마지막 경기가 끝났다. 곧 오프시즌이 시작된다.'],
  // 시즌 결산
  rv_record: ['{team:은/는} 정규리그 54경기에서 승률 {winPct:을/를} 기록했다.', '승률은 {winPct}, 최종 순위는 {rank}위다.', '{record}, 승률 {winPct:으로/로} 시즌을 마쳤다.', '정규리그 승률은 {winPct}였다.'],
  rv_leader: ['팀 내 득점 선두는 경기당 {tmPpg}점의 {tmName}이었다.', '{tmName:은/는} 경기당 {tmPpg}점으로 {team}의 득점 1위였다.', '득점은 {tmName:이/가} 평균 {tmPpg}점으로 가장 많았다.', '{team}의 공격은 경기당 {tmPpg}점을 올린 {tmName:이/가} 이끌었다.'],
  rv_money: ['시즌 수입은 {revenue}억, 선수단 연봉은 {payroll}억으로 순이익은 {net}억이었다.', '재정으로는 수입 {revenue}억에 연봉 {payroll}억, 순이익 {net}억이다.', '구단 장부는 수입 {revenue}억, 선수단 연봉 {payroll}억, 순이익 {net}억으로 정리됐다.', '수입 {revenue}억, 연봉 {payroll}억을 거쳐 순이익은 {net}억이 됐다.'],
  rv_outlook: ['이제 오프시즌이다. 트레이드와 재계약, FA, 드래프트가 차례로 이어지며 {nextSeason} 시즌 전력이 결정된다.', '{nextSeason} 시즌을 앞두고 트레이드·재계약·FA·드래프트가 기다리고 있다.', '다음 시즌 {nextSeason:을/를} 위한 정비가 시작된다. 결정할 일이 많은 오프시즌이다.', '오프시즌의 선택이 {nextSeason} 시즌의 성적을 좌우한다.'],
  // 시즌 어워드(게임이 기록과 팀 성적으로 정한다)
  aw_mvp: ['{mvpTeam:은/는} 정규리그 {mvpRank}위({mvpRec})였다. MVP 점수는 개인 기록에 팀 성적을 더해 계산했다.', '{mvp}의 소속팀 {mvpTeam}의 정규리그 성적은 {mvpRank}위, {mvpRec}이다.', '{mvpTeam}은 {mvpRank}위({mvpRec})로 시즌을 마쳤다. 게임의 MVP 점수는 개인 기록과 팀 승률을 함께 본다.', '개인 기록뿐 아니라 {mvpTeam}의 {mvpRank}위({mvpRec}) 성적이 점수에 반영됐다.'],
  aw_best5: ['베스트5는 {best5}이다. 가드 2명, 포워드 2명, 센터 1명 구성이 원칙이다.', '이번 시즌 베스트5에는 {best5:이/가} 이름을 올렸다. 포지션별로 가드 2·포워드 2·센터 1명을 뽑는다.', '{best5}가 {season} 시즌 베스트5로 뽑혔다. 포지션 칸마다 점수가 가장 높은 선수다.', '베스트5 명단은 {best5}. 포지션 균형을 맞춰 가드 2, 포워드 2, 센터 1명이다.'],
  aw_rookie: ['신인상은 {rookieTeam}의 {rookie:이/가} 받았다. 기록은 {rookieLine}.', '새로 들어온 선수 가운데서는 {rookieTeam}의 {rookie:이/가} 신인상을 차지했다({rookieLine}).', '{rookie:은/는} {rookieTeam} 소속으로 {rookieLine:을/를} 남겨 신인상에 올랐다.', '신인상 수상자는 {rookie}. {rookieTeam}에서 {rookieLine:을/를} 기록했다.'],
  aw_defense: ['최우수 수비상은 {dfTeam}의 {dfName:이/가} 받았다. 경기당 스틸 {dfStl}개, 블록 {dfBlk}개를 기록했다.', '{dfTeam}의 {dfName:이/가} 최우수 수비상을 가져갔다(스틸 {dfStl}·블록 {dfBlk}).', '수비에서는 {dfName}이 돋보였다. 경기당 스틸 {dfStl}개와 블록 {dfBlk}개로 {dfTeam}의 수비를 이끌었다.', '최우수 수비상 수상자는 {dfName}({dfTeam}). 스틸 {dfStl}개, 블록 {dfBlk}개를 경기당 기록했다.'],
  aw_improved: ['기량발전상은 지난 시즌 종료 때보다 OVR이 가장 많이 오른 {imTeam}의 {imName:이/가} 받았다.', '{imTeam}의 {imName:은/는} 지난 시즌보다 능력치(OVR)가 가장 크게 올라 기량발전상을 차지했다.', '가장 크게 성장한 선수는 {imTeam}의 {imName}이다. 기량발전상에 선정됐다.', '기량발전상 수상자는 {imTeam}의 {imName}. OVR 상승폭이 리그에서 가장 컸다.'],
  aw_leaders: ['부문별 1위는 {leadersText}이다.', '기록 부문 1위는 {leadersText}.', '부문 선두는 {leadersText}로 정리됐다.', '경기당 기록 선두는 {leadersText}이다.'],
  aw_finals: ['챔피언결정전 MVP는 우승팀 {champName}의 {fmName:이/가} 차지했다. 챔피언결정전 {fmLine:을/를} 기록했다.', '{champName}의 우승을 이끈 {fmName:이/가} 챔피언결정전 MVP로 뽑혔다({fmLine}).', '챔피언결정전 MVP는 {fmName:이다/다}. 우승팀 {champName}에서 {fmLine:을/를} 남겼다.', '{fmName:이/가} 챔피언결정전 MVP에 올랐다. 우승팀 {champName} 선수 중 챔피언결정전 기록이 가장 좋았다.'],
  aw_my: ['우리 구단에서는 {myAwards} 등이 수상했다.', '{team} 수상자 명단: {myAwards}.', '{myAwards} 등 {team} 선수들이 상을 받았다.', '수상자 가운데 {team} 소속은 {myAwards}.'],
  gl_missed: ['채우지 못한 목표는 {missedText}이다.', '{missedText} 목표는 달성하지 못했다는 평가다.', '특히 {missedText}에서 모기업의 기대에 못 미쳤다.', '미달성 항목은 {missedText}.'],
  gl_all: ['{allMet}', '모기업 관계자는 "올해 목표를 모두 채웠다"며 만족감을 나타냈다.', '목표를 전부 채운 시즌이어서 구단 안팎의 평가가 후하다.'],
  gl_bonus: ['신뢰도가 높아 다음 시즌 예산에 {bonus}억 원이 보너스로 더해졌다.', '모기업은 성과를 인정해 {bonus}억 원의 추가 예산을 약속했다.', '높은 신뢰도 덕분에 {bonus}억 원이 다음 시즌 운영비로 얹어진다.'],
  gl_warn: ['신뢰도 {warnTrust}점은 낮은 구간이라 모기업이 다음 시즌 성과를 지켜보겠다는 입장이다.', '신뢰도가 {warnTrust}점까지 내려와 모기업이 경고 메시지를 보냈다.', '단장에 대한 모기업의 신뢰가 {warnTrust}점으로 흔들리고 있다는 분석이 나온다.'],
  gl_risk: ['신뢰도({riskTrust}점)가 위험선 아래에 머문 기간이 길어져 해임설이 거론된다.', '신뢰도 {riskTrust}점에 모기업 내부에서 단장 교체 이야기가 나오고 있다는 소문이 돈다.', '신뢰도 {riskTrust}점이 이어지면 다음 평가에서 책임을 묻겠다는 말이 흘러나온다.'],
  gl_trust: ['이번 평가는 목표 {goalsTotal}개 중 {goalsMet}개 달성이라는 결과로 정리됐고, 이에 따라 단장 신뢰도는 {trustMove}.', '단장에 대한 모기업의 신뢰도는 이번 평가로 {trustMove}. 목표 달성은 {goalsMet}/{goalsTotal}이다.', '평가 결과는 신뢰도에 그대로 반영돼 {trustMove}. 모기업은 달성한 목표 {goalsMet}개를 성과로 인정했다.'],
  cc_why: ['구단은 성적 부진에 책임을 물어 변화를 택했다고 설명했다. 순위가 하위권에 머문 시즌이 길어지며 코칭스태프 쇄신 요구가 커졌다.', '프런트는 팀 분위기를 바꾸기 위해 사령탑 교체가 필요하다고 판단했다. 시즌 막판까지 순위를 끌어올리지 못한 점이 컸다.', '{rank}위라는 성적이 교체의 가장 큰 이유로 꼽힌다. 구단 안팎에서는 예견된 결정이라는 반응이 나온다.', '성적 책임을 묻는 결정이다. {team} 팬들 사이에서는 일찍부터 사령탑 교체론이 나오던 터였다.'],
  cc_old: ['떠나는 {oldHead} 감독의 성향은 {oldSpec}으로 알려졌다. 선수 육성과 로테이션 운영에서 아쉬움이 있었다는 평가가 따른다.', '{oldHead} 감독은 {oldSpec}이라는 평을 받았다. 그의 지도 방식이 팀 구성과 잘 맞지 않았다는 지적도 있었다.', '{oldSpec}으로 평가받던 {oldHead} 감독은 이번 시즌 성적에 책임을 지고 물러난다.', '{oldHead} 감독의 지도 스타일은 {oldSpec}이었다. 구단은 후임에게 다른 색깔을 기대하고 있다.'],
  cc_new: ['새로 부임하는 {newHead} 감독은 {newSpec}으로 평가된다. 구단은 이 점에 기대를 걸고 계약을 맺었다.', '{newHead} 감독의 지도 성향은 {newSpec}이다. 취임 일성으로 "준비된 만큼 보여 주겠다"는 각오를 밝혔다.', '후임 {newHead} 감독은 {newSpec}의 지도자다. 구단은 선수단 구성에 맞는 색깔을 입혀 주길 바란다.', '{newSpec}으로 알려진 {newHead} 감독이 부임했다. 전술과 육성에서 얼마나 변화를 줄지가 관심사다.'],
  cc_next: ['{nextSeason} 시즌 {team}의 성적이 새 감독 체제의 첫 시험대가 될 전망이다.', '구단은 {nextSeason} 시즌 개막 전까지 코칭스태프 구성을 마무리할 계획이다.', '새 사령탑이 선수단과 어떤 호흡을 보일지는 {nextSeason} 시즌 초반 경기에서 드러날 것이다.', '{team:은/는} 감독 교체 효과가 나타나는 데 시간이 필요하다고 보고 있다.'],
  gl_next: ['다음 {nextSeason} 시즌에도 모기업은 새 목표를 제시할 예정이다.', '모기업은 {nextSeason} 시즌 목표를 시즌 시작 전에 다시 전달한다.', '새 시즌 목표는 개막 전에 발표된다.'],
  // 오프시즌
  of_last: ['{lastSeasonLabel} 시즌 {team:은/는} 정규리그 {rank}위({record})로 마쳤고 플레이오프 성적은 {stage:이었다/였다}.', '지난 {lastSeasonLabel} 시즌 {team}의 성적은 {rank}위({record}), 플레이오프는 {stage}.', '{lastSeasonLabel} 시즌을 {record}, {rank}위로 마친 {team}의 오프시즌이다.', '{lastSeasonLabel} 시즌 결과를 안고 {team:은/는} {nextSeason} 시즌을 준비한다. 정규리그 {rank}위({record}), 플레이오프는 {stage:이었다/였다}.'],
  pl_info: ['{player:은/는} {pAge}세 {pPos} 선수이며 OVR은 {pOvr}이다.', '{pPos} 포지션의 {player:은/는} {pAge}세로 OVR {pOvr}의 선수다.', '{pAge}세 {pPos} {player:은/는} OVR {pOvr:으로/로} 평가된다.', '{player}의 포지션은 {pPos}, 나이는 {pAge}세, OVR은 {pOvr}이다.', '{player:은/는} {pPos} 포지션에서 OVR {pOvr:으로/로} 평가되는 선수다.', '능력치로 보면 {player}의 OVR은 {pOvr}이고 포지션은 {pPos}다.', '{pAge}세의 {player:은/는} 마지막 시즌 OVR {pOvr:을/를} 기록했다.', '{player}의 나이는 {pAge}세, 마지막으로 기록한 OVR은 {pOvr}이다.'],
  rt_gap: ['{player}의 은퇴로 {team}의 로스터에는 빈자리가 생겼다.', '은퇴한 {player}의 자리는 FA와 드래프트로 채워야 한다.', '{team:은/는} {player:이/가} 비운 자리를 어떻게 메울지 고민하게 됐다.', '{player:이/가} 선수단에서 빠지면서 새 시즌 구성이 달라진다.'],
  pl_contract: ['계약은 연봉 {pSalary}억에 {pYears}년이 남아 있다.', '연봉 {pSalary}억, 남은 계약기간은 {pYears}년이다.', '{pSalary}억의 연봉으로 {pYears}년 더 뛰는 조건이다.', '남은 계약은 {pYears}년이고 연봉은 {pSalary}억이다.'],
  of_team: ['{team}의 현재 핵심 선수는 {coreText}이다.', '{team}에서 능력치가 가장 높은 세 선수는 {coreText}이다.', '로스터의 중심은 {coreText}이다.', '{team}의 주축은 {coreText:으로/로} 꼽힌다.'],
  of_cap: ['국내 선수 연봉은 {payroll}억으로 캡 {cap}억 대비 {capRoom:이다/다}.', '캡 상황은 국내 선수 연봉 {payroll}억, 캡 {cap}억으로 {capRoom:이다/다}.', '연봉 총액 {payroll}억은 캡 {cap}억에 비해 {capRoom:이다/다}.', '{team}의 국내 선수 연봉은 {payroll}억이고 캡 대비 {capRoom:이다/다}.'],
  of_outlook: ['{nextSeason} 시즌 개막까지 라인업과 훈련을 정비할 시간이 남아 있고, 남은 선택이 전력의 윤곽을 정한다.', '다음 시즌인 {nextSeason} 시즌을 앞두고 남은 오프시즌 결정이 전력을 좌우한다. 하나하나가 순위 싸움의 밑천이 된다.', '{nextSeason} 시즌 개막 전에 해야 할 일은 아직 남아 있다. 로스터와 캡 여유를 함께 따져 봐야 한다.', '새 시즌 {nextSeason}의 밑그림은 이 오프시즌에 그려진다. 지금의 선택이 한 시즌을 좌우할 수 있다.'],
  pl_growth: ['한 시즌 사이 OVR은 {from}에서 {to:이/가} 됐다({deltaSign}).', '능력치 변화는 {from}에서 {to:으로/로}, 변화폭은 {deltaSign}이다.', 'OVR {from:이/가} {to:이/가} 됐고 변화폭은 {deltaSign}이다.', '{from}이던 OVR이 {to:으로/로} 바뀌었다({deltaSign}).'],
  spot_career: ['{star}의 KBL 통산 기록은 {starCareer}다.', '통산으로는 {starCareer:을/를} 남긴 선수다.', 'KBL 경력을 보면 {starCareer}이다.', '{star:은/는} KBL에서 {starCareer:을/를} 기록해 왔다.'],
  st_career: ['KBL 통산 기록은 {sCareer}이다.', '{player:은/는} 통산 {sCareer:을/를} 남겼다.', '지금까지의 KBL 경력은 {sCareer}이다.', '통산 성적은 {sCareer}다.'],
  pl_rank: ['{player}의 연봉은 {team} 선수단에서 {pSalRank}번째로 높고, OVR은 {pOvrRank}번째로 높다.', '{team} 선수단 안에서 연봉 {pSalRank}위, OVR {pOvrRank}위에 해당한다.', '팀 내 비교로는 연봉 {pSalRank}위, 능력치(OVR) {pOvrRank}위의 선수다.', '{team}의 연봉 순위로는 {pSalRank}번째, OVR 순위로는 {pOvrRank}번째다.'],
  pl_career: ['KBL 통산 기록은 {pCareer}이다.', '{player:은/는} 통산 {pCareer:을/를} 기록했다.', 'KBL 경력은 {pCareer}이다.', '그동안의 통산 성적은 {pCareer}다.'],
  st_game: ['{starTeam:이/가} {opp:과/와} 맞붙어 {score:으로/로} {res}했다.', '경기는 {starTeam}의 {res}였다. 스코어는 {score}.', '{starTeam}의 {opp}전은 {score:으로/로} 끝났고 결과는 {res}였다.', '이 경기에서 {starTeam:은/는} {score:으로/로} {res}했다.'],
  st_gap: ['{day}일차 기준 순위표 맨 위는 {leader}({leaderRec})다.', '현재 선두는 {leader:으로/로} {leaderRec:을/를} 기록 중이다.', '1위 {leader}의 전적은 {leaderRec}이다.', '리그 선두 {leader}({leaderRec}) 뒤를 쫓는 구도다.'],
  pv_depth: ['로스터 평균 연령은 {avgAge}세, 평균 OVR은 {avgOvr}이다. 가장 어린 선수는 {youngName}({youngAge}세), 가장 나이가 많은 선수는 {oldName}({oldAge}세)다.', '{team}의 선수단은 평균 {avgAge}세에 평균 OVR {avgOvr}이다. 막내는 {youngName}({youngAge}세), 맏형은 {oldName}({oldAge}세)다.', '평균 연령 {avgAge}세, 평균 OVR {avgOvr}의 로스터다. {oldName}({oldAge}세)이 최고참이고 {youngName}({youngAge}세)이 가장 젊다.', '선수단 평균 OVR은 {avgOvr}, 평균 나이는 {avgAge}세다. {youngName}({youngAge}세)부터 {oldName}({oldAge}세)까지 폭이 넓다.'],
  pv_contenders: ['전력 상위권은 {powerTop3} 순으로 평가됐다.', '게임이 매긴 전력 순위 상위 세 팀은 {powerTop3}이다.', '{powerTop3:이/가} 우승 경쟁의 중심으로 꼽힌다.', '전력 순위 1~3위는 {powerTop3}이다.'],
  rv_top: ['정규리그 1위는 {regChamp}({regChampRec}), 챔피언은 {champName}이었다.', '{regChamp:이/가} {regChampRec:으로/로} 정규리그 정상에 섰고, 우승 트로피는 {champName:이/가} 가져갔다.', '시즌 챔피언은 {champName}, 정규리그 1위는 {regChamp}였다.', '정규리그에서는 {regChamp}({regChampRec})가, 플레이오프에서는 {champName:이/가} 웃었다.'],
  po_avg: ['시리즈 평균 득점은 {winner:이/가} {winAvg}점, {loser:이/가} {loseAvg}점이었다.', '경기당 득점으로 보면 {winner} {winAvg}점, {loser} {loseAvg}점이다.', '{winner:은/는} 시리즈에서 평균 {winAvg}점을 올렸고 {loser:은/는} {loseAvg}점에 그쳤다.', '평균 득점은 {winAvg}점 대 {loseAvg}점으로 {winner} 쪽이 앞섰다.'],
  rs_names: ['이름이 오른 선수는 {names}이다.', '이번 협상 대상으로 이름이 오른 선수는 {names}이다.', '결과가 나온 선수는 {names}이다.', '해당 선수는 {names}이다.']
};

SENT.of_last_f = SENT.of_last; SENT.of_team_f = SENT.of_team; SENT.of_cap_f = SENT.of_cap; // 선수가 없는 오프시즌 기사는 이 칸을 항상 채운다
const G = ['lead', 'scoreboard', 'h2h'];
const PLAN_GAME = [G, ['standing', 'form', 'lastSeason'], ['spot_star', 'spot_avg', 'spot_career', 'spot_opp'], ['next', 'remain']];
const PLAN_STANDING = [['lead', 'st_gap'], ['standing', 'top3', 'form'], ['team_leader', 'lastSeason'], ['next', 'remain']];
const PLAN_OFF = [['lead', 'pl_info', 'pl_contract', 'pl_rank', 'pl_career'], ['of_last', 'of_team', 'of_cap'], ['of_outlook']];
const PLAN_PO = [['lead', 'po_games'], ['po_seeds', 'po_my', 'po_avg'], ['po_next', 'po_end']];
const PLAN_REVIEW = [['lead', 'rv_record'], ['lastSeason', 'rv_top', 'rv_leader'], ['rv_money'], ['rv_outlook']];
export const PLAN = {
  injury_my: [['lead', 'inj_status'], ['inj_info', 'inj_lineup'], ['inj_back', 'inj_kind']],
  injury_star: [['lead', 'inj_status'], ['inj_info', 'inj_lineup'], ['inj_back', 'inj_kind']],
  waiver_my: [['lead', 'wv_info'], ['wv_rule', 'wv_money'], ['wv_next']],
  fa_season: [['lead', 'fs_info'], ['fs_contract', 'fs_why'], ['fs_next']],
  foreign_swap_my: [['lead', 'fw_info'], ['fw_rule', 'fw_pay'], ['fw_next']],
  foreign_swap_lg: [['lead', 'fw_info'], ['fw_rule', 'fw_pay'], ['fw_next']],
  coach_change: [['lead', 'cc_why'], ['cc_old', 'cc_new'], ['cc_next']],
  goals_eval: [['lead', 'gl_missed', 'gl_all'], ['gl_trust'], ['gl_bonus', 'gl_warn', 'gl_risk'], ['gl_next']],
  awards: [['lead', 'aw_mvp'], ['aw_best5', 'aw_rookie'], ['aw_defense', 'aw_improved', 'aw_leaders'], ['aw_finals', 'aw_my']],
  preview: [['lead', 'pv_core'], ['pv_foreign', 'pv_depth'], ['pv_cap', 'pv_last', 'pv_city'], ['pv_contenders', 'pv_top', 'pv_task']],
  opener_win: [['lead', 'scoreboard'], ['standing', 'lastSeason'], ['spot_star', 'spot_career', 'spot_opp'], ['next', 'remain']],
  opener_loss: [['lead', 'scoreboard'], ['standing', 'lastSeason'], ['spot_star', 'spot_career', 'spot_opp'], ['next', 'remain']],
  result_win: PLAN_GAME, result_loss: PLAN_GAME, thriller_win: PLAN_GAME, thriller_loss: PLAN_GAME, blowout_win: PLAN_GAME, blowout_loss: PLAN_GAME, streak_win: PLAN_GAME, streak_lose: PLAN_GAME,
  star_points: [['lead', 'st_game', 'st_info'], ['st_avg', 'st_contract', 'st_career'], ['st_team']], star_all: [['lead', 'st_game', 'st_info'], ['st_avg', 'st_contract', 'st_career'], ['st_team']],
  leader_change: [['lead', 'top3', 'st_gap'], ['standing', 'form'], ['team_leader', 'lastSeason'], ['next', 'remain']],
  rank_first: PLAN_STANDING, rank_out: PLAN_STANDING, rank_in: PLAN_STANDING, clinch: PLAN_STANDING, eliminated: PLAN_STANDING, cycle: PLAN_STANDING, midseason: PLAN_STANDING, regular_end: [['lead', 'top3'], ['standing', 'form'], ['team_leader', 'lastSeason'], ['rv_outlook']],
  po_my_win: PLAN_PO, po_my_out: PLAN_PO, po_league: PLAN_PO, po_title_my: PLAN_PO, po_title: PLAN_PO,
  review_top: PLAN_REVIEW, review_mid: PLAN_REVIEW, review_miss: PLAN_REVIEW,
  retire_my: [['lead', 'pl_info', 'rt_gap'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']], retire_star: PLAN_OFF, growth_up: [['lead', 'pl_info', 'pl_growth', 'pl_career'], ['of_last', 'of_team', 'of_cap'], ['of_outlook']], growth_down: [['lead', 'pl_info', 'pl_growth', 'pl_career'], ['of_last', 'of_team', 'of_cap'], ['of_outlook']],
  resign_done: [['lead', 'rs_names'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']], resign_fail: [['lead', 'rs_names'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']],
  fa_in: PLAN_OFF, fa_out: PLAN_OFF, fa_big: PLAN_OFF, comp: PLAN_OFF, trade_done: [['lead'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']],
  draft_my: PLAN_OFF, draft_top: PLAN_OFF, cap_over: [['lead'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']], funds_plus: [['lead'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']], funds_minus: [['lead'], ['of_last_f', 'of_team_f', 'of_cap_f'], ['of_outlook']]
};

// 같은 말이 매 기사에 되풀이되지 않게, 일부 칸은 확률적으로만 넣는다(시드로 정해져 같은 입력이면 같다)
const SLOT_PROB = { of_last: 0.7, of_team: 0.85, of_cap: 0.85, pl_rank: 0.9, lastSeason: 0.35, spot_career: 0.55, h2h: 0.85, spot_opp: 0.7, spot_avg: 0.8, team_leader: 0.75, pl_career: 0.8, st_career: 0.8 };

/** 문단들을 만든다. 첫 문단의 첫 문장(lead)은 접힌 기사의 한 줄 요약이 된다 */
function compose(kind, vars, rng, recentS) {
  const paragraphs = [];
  let summary = '';
  for (const slots of PLAN[kind]) {
    const sents = [];
    for (const slot of slots) {
      const pool = slot === 'lead' ? TEMPLATES[kind].b : SENT[slot];
      if (SLOT_PROB[slot] != null && rng() > SLOT_PROB[slot]) continue;
      const i = pickIndex(pool, vars, rng, (recentS[`${kind}.${slot}`] ??= []));
      if (i < 0) continue;
      const s = fill(pool[i], vars);
      if (slot === 'lead' && !summary) summary = s;
      sents.push(s);
    }
    if (sents.length) paragraphs.push(sents.join(' '));
  }
  return { paragraphs, summary };
}

// ---------- 사건 만들기 ----------
/**
 * 입력(src):
 *  seed, teams(구단 id 목록), myTeamId, startYear(현재 시즌 시작 연도), season(현재 시즌 표기), teamName(id)→이름, games(정규리그 경기 수),
 *  log: 시즌 결과 목록(마지막 것이 가장 최근. 오프시즌 중이면 방금 끝난 시즌 포함),
 *  current: { stage, day, totalDays, dayResults, playoffSeries, offseason: { retired, progressed } | null },
 *  names: Map(id → { name }) (트레이드 보고서의 선수 id를 이름으로), power: [{ id, rank }] (선택),
 *  선택 정보(없으면 해당 문장을 건너뛴다): players: Map(id → { name, baseName, age, position, ovr, origin, teamId, salaryEok, yearsLeft }),
 *  schedule: [[{ homeId, awayId }]](날짜별), prestige: { [id]: { score, titles, regularTitles } }, teamInfo: { [id]: { city, arena } },
 *  payroll: { domestic, cap, over }, funds: 우리 구단 자금(억), seasonLabelOf(startYear)
 * 반환: { items(최신순), mood, outlets }. item: { id, t, season, when, kind, scope, tags, tone, outlet, headline, summary, paragraphs, body, comments, mood }
 */
export function buildNews(src) {
  const my = src.myTeamId;
  const nameOf = (id) => src.teamName(id);
  const events = [];
  let seq = 0;
  const add = (ev) => { events.push({ seq: seq++, tags: [], tone: 'neutral', delta: 0, comments: 0, ...ev }); };
  const players = src.players ?? new Map();
  const pbn = (id, fallback) => { const p = players.get(id); return p?.baseName ?? cleanName(p?.name ?? src.names?.get?.(id)?.name ?? fallback ?? ''); };
  const pname = (id) => { const n = pbn(id); return n || null; };
  const labelOf = src.seasonLabelOf ?? ((y) => `${y}-${String(y + 1).slice(2)}`);

  const log = (src.log ?? []).slice(-2);
  const cur = src.current ?? { stage: 'regular', day: 0, dayResults: [] };
  const games = src.games ?? 54;
  const sy = src.startYear;
  const base = (y) => y * 1000;
  const seasonLabel = src.season;
  const dayResults = cur.dayResults ?? [];
  const totalDays = cur.totalDays ?? games;
  const prevEntry = (y) => (src.log ?? []).find((e) => e.startYear === y - 1) ?? null;
  const lastRowOf = (id, y) => {
    const hs = (src.history ?? []).find((x) => x.startYear === y - 1)?.teams?.find((t) => t.franchiseId === id);
    if (hs) return { rank: hs.rank, wins: hs.wins, losses: hs.losses };
    return prevEntry(y)?.standings?.find((s) => s.id === id) ?? null;
  };
  const titlesOf = (id) => src.prestige?.[id]?.titles;
  const cityOf = (id) => src.teamInfo?.[id]?.city;

  // 팬 심리의 시작점: 기록이 있는 가장 오래된 시즌의 결과
  let mood0 = 55;
  if (log.length) {
    const first = log[0];
    const row = first.standings.find((s) => s.id === my);
    const st = first.stage?.[my];
    mood0 = st === '우승' ? 72 : st === '결승' ? 64 : st ? 58 : row && row.rank >= 8 ? 38 : 46;
  }

  // 우리 팀 핵심·외국 선수 요약
  const mine = [...players.values()].filter((p) => p.teamId === my).sort((a, b) => b.ovr - a.ovr);
  const dispName = (p) => p.baseName ?? cleanName(p.name);
  const coreText = mine.length >= 3 ? mine.slice(0, 3).map((p) => `${dispName(p)}(${p.position}, OVR ${p.ovr})`).join(', ') : undefined;
  const pInfo = (id, prefix = 'p') => {
    const p = players.get(id);
    if (!p) return {};
    const career = src.careerOf?.(id);
    const rankInfo = p.teamId === my && p.salaryEok != null ? { [`${prefix}SalRank`]: 1 + mine.filter((q) => q.salaryEok > p.salaryEok).length, [`${prefix}OvrRank`]: 1 + mine.filter((q) => q.ovr > p.ovr).length } : {};
    return { ...rankInfo, ...(career ? { [`${prefix}Career`]: career } : {}), [`${prefix}Age`]: p.age, [`${prefix}Pos`]: p.position, [`${prefix}Ovr`]: p.ovr, [`${prefix}Origin`]: ORIGIN_TEXT[p.origin] ?? '국내', ...(p.salaryEok != null ? { [`${prefix}Salary`]: fmt1(p.salaryEok), [`${prefix}Years`]: p.yearsLeft } : {}) };
  };
  const capVars = src.payroll ? { payroll: fmt1(src.payroll.domestic), cap: fmt1(src.payroll.cap), capRoom: src.payroll.over > 0 ? `초과 ${fmt1(src.payroll.over)}억` : `여유 ${fmt1(src.payroll.cap - src.payroll.domestic)}억` } : {};
  const ofTeam = () => ({ ...(coreText ? { coreText } : {}), ...capVars });

  // ----- 개막 전 전망 -----
  if (src.power && src.power.length) {
    const r = src.power.find((p) => p.id === my);
    if (r) {
      const foreign = mine.filter((p) => p.origin === 'foreign'); const asia = mine.filter((p) => p.origin === 'asia');
      const lr = lastRowOf(my, sy);
      const city = cityOf(my);
      const cityRivalId = src.teams.find((id) => id !== my && city && cityOf(id) === city);
      const cr = cityRivalId ? lastRowOf(cityRivalId, sy) : null;
      const top = src.power.find((p) => p.rank === 1 && p.id !== my);
      const tier = r.rank <= 3 ? 'top' : r.rank <= 6 ? 'mid' : 'low';
      const taskText = { top: '우승권 전력으로 평가받는 만큼 정규리그 상위권을 지키며 플레이오프에서 정상을 노리는 것이다.', mid: '6강 경쟁에서 안정적으로 살아남아 플레이오프 문턱을 넘는 것이다.', low: '먼저 6위 안에 들어 플레이오프 진출권을 확보하는 것이다.' }[tier];
      const pr = src.prestige?.[my];
      const roster = mine.filter((p) => p.origin !== undefined);
      const youngest = [...roster].sort((a, b) => a.age - b.age)[0]; const oldest = [...roster].sort((a, b) => b.age - a.age)[0];
      const depth = roster.length >= 5 ? { avgAge: fmt1(roster.reduce((x, p) => x + p.age, 0) / roster.length), avgOvr: fmt1(roster.reduce((x, p) => x + p.ovr, 0) / roster.length), youngName: dispName(youngest), youngAge: youngest.age, oldName: dispName(oldest), oldAge: oldest.age } : {};
      const top3p = [...src.power].sort((a, b) => a.rank - b.rank).slice(0, 3).map((p) => nameOf(p.id)).join(', ');
      add({
        key: `${sy}:preview`, t: base(sy), season: seasonLabel, when: `${seasonLabel} 개막 전`, kind: 'preview', scope: 'my', tags: ['우리 팀', '전망'], comments: 2,
        vars: {
          team: nameOf(my), season: seasonLabel, powerRank: r.rank, games, ...depth, powerTop3: top3p, ...(coreText ? { core: coreText } : {}),
          ...(foreign.length ? { foreignText: foreign.map((p) => `${dispName(p)}(OVR ${p.ovr})`).join(', ') } : {}),
          asiaText: asia.length ? asia.map((p) => `${dispName(p)}(OVR ${p.ovr})`).join(', ') : '없음',
          ...capVars, ...(src.funds != null ? { funds: fmt1(src.funds) } : {}),
          ...(lr ? { lastRank: lr.rank, lastRec: recordText(lr.wins, lr.losses) } : {}), ...(titlesOf(my) != null ? { titles: titlesOf(my), regTitles: pr?.regularTitles ?? 0, tradition: fmt1(pr?.score ?? 0) } : {}),
          ...(cityRivalId && cr ? { city, cityRival: nameOf(cityRivalId), cityRivalRank: cr.rank } : {}), ...(city ? { arena: src.teamInfo[my].arena ?? undefined } : {}),
          ...(top ? { topRival: nameOf(top.id) } : {}), taskText
        }
      });
    }
  }

  // ----- 현재 시즌 정규리그 -----
  const rec = new Map(src.teams.map((id) => [id, { id, w: 0, l: 0, pf: 0, pa: 0 }]));
  const rank = () => [...rec.values()].sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.id.localeCompare(b.id));
  const scorers = new Map(); // 선수별 누적: 이름·팀·득점·리바운드·어시스트·경기 수
  const myResults = []; // 우리 팀 경기 결과(오래된 순)
  let streak = 0;
  let prevRank = null; let prevLeader = null; let clinched = false; let out = false;
  const TOP = 6;
  const avgOf = (id) => { const s = scorers.get(id); return s && s.g ? { ppg: s.pts / s.g, rpg: s.reb / s.g, apg: s.ast / s.g } : null; };
  const avgText = (id) => { const a = avgOf(id); return a ? `${fmt1(a.ppg)}점 ${fmt1(a.rpg)}리바운드 ${fmt1(a.apg)}어시스트` : undefined; };
  const teamLeader = (teamId) => [...scorers.values()].filter((s) => s.teamId === teamId && s.g >= 3).sort((a, b) => b.pts / b.g - a.pts / a.g)[0];
  const ofRec = (id) => { const r = rec.get(id); return recordText(r.w, r.l); };

  for (const d of dayResults) {
    const dayGames = d.games;
    for (const g of dayGames) {
      const h = rec.get(g.homeId); const a = rec.get(g.awayId);
      h.pf += g.homePts; h.pa += g.awayPts; a.pf += g.awayPts; a.pa += g.homePts;
      if (g.winnerId === g.homeId) { h.w++; a.l++; } else { a.w++; h.l++; }
      for (const [side, teamId] of [[g.box?.home, g.homeId], [g.box?.away, g.awayId]]) {
        for (const line of side ?? []) {
          if (!line.minutes) continue;
          const s = scorers.get(line.id) ?? { name: pbn(line.id, line.name), teamId, pts: 0, reb: 0, ast: 0, g: 0 };
          s.pts += line.points; s.reb += line.rebounds; s.ast += line.assists; s.g++; scorers.set(line.id, s);
        }
      }
    }
    const order = rank();
    const myRank = order.findIndex((r) => r.id === my) + 1;
    const me = rec.get(my);
    const myRec = recordText(me.w, me.l);
    const leader = order[0];
    const leaderRec = recordText(leader.w, leader.l);
    const t0 = base(sy) + d.day;
    const sixth = order[TOP - 1]; const seventh = order[TOP];
    const gapN = myRank <= TOP ? me.w - seventh.w : sixth.w - me.w;
    const gv = (hashString(`${src.seed}:gap${d.day}`)) % 4;
    const gapText = myRank <= TOP
      ? [`플레이오프권 안이고 7위와의 승수 차는 ${gapN}승이다.`, `7위와 ${gapN}승 차로 플레이오프권을 지키고 있다.`, `6위 안에 들어 있으며 바로 아래 7위와는 ${gapN}승 차다.`, `플레이오프 진출선 위에서 7위를 ${gapN}승 앞서 있다.`][gv]
      : [`플레이오프 진출선인 6위와는 ${gapN}승 차다.`, `6위와의 승수 차는 ${gapN}승으로, 플레이오프권 진입이 과제다.`, `플레이오프권인 6위까지 ${gapN}승이 모자란다.`, `6위를 ${gapN}승 차로 쫓고 있다.`][gv];
    const top3 = `${order.slice(0, 3).map((r, i) => `${i + 1}위 ${nameOf(r.id)}(${recordText(r.w, r.l)})`).join(', ')}`;
    const remain = totalDays - d.day;
    const ldr = teamLeader(my);
    const common = {
      team: nameOf(my), rank: myRank, record: myRec, day: d.day, games: totalDays, ...(remain > 0 ? { remain } : { allPlayed: totalDays }), gapText, gapN, top3, leader: nameOf(leader.id), leaderRec,
      ...(ldr ? { tmName: ldr.name, tmPpg: fmt1(ldr.pts / ldr.g) } : {})
    };
    const nextG = src.schedule?.[d.day]?.find((g) => g.homeId === my || g.awayId === my);
    if (nextG && remain > 0) Object.assign(common, { nextOpp: nameOf(nextG.homeId === my ? nextG.awayId : nextG.homeId), nextVenue: nextG.homeId === my ? '홈' : '원정', nextDay: d.day + 1 });
    const lr = lastRowOf(my, sy);
    if (lr) {
      Object.assign(common, { lastRank: lr.rank, lastRec: recordText(lr.wins, lr.losses) });
      if (me.w + me.l >= 6) { const diff = me.w / (me.w + me.l) - lr.wins / (lr.wins + lr.losses); common.cmpWord = diff >= 0.08 ? '지난 시즌보다 나아진 흐름이다.' : diff <= -0.08 ? '지난 시즌보다 주춤한 흐름이다.' : '지난 시즌과 비슷한 페이스다.'; }
    }
    if (titlesOf(my) != null) common.titles = titlesOf(my);

    // 우리 팀 경기
    const mg = dayGames.find((g) => g.homeId === my || g.awayId === my);
    if (mg) {
      const home = mg.homeId === my;
      const mp = home ? mg.homePts : mg.awayPts; const op = home ? mg.awayPts : mg.homePts;
      const win = mg.winnerId === my; const oppId = home ? mg.awayId : mg.homeId;
      streak = win ? (streak > 0 ? streak + 1 : 1) : (streak < 0 ? streak - 1 : -1);
      myResults.push({ win, oppId });
      const margin = Math.abs(mp - op);
      const top1 = (side) => (side ?? []).filter((l) => l.minutes).sort((a, b) => b.points - a.points)[0];
      const myTop = top1(home ? mg.box?.home : mg.box?.away); const opTop = top1(home ? mg.box?.away : mg.box?.home);
      const lineOf = (l) => `${l.points}점 ${l.rebounds}리바운드 ${l.assists}어시스트`;
      const l5 = myResults.slice(-5); const w5 = l5.filter((x) => x.win).length;
      const h2 = myResults.filter((x) => x.oppId === oppId); const h2w = h2.filter((x) => x.win).length;
      const orec = rec.get(oppId); const orow = order.findIndex((r) => r.id === oppId) + 1; const olr = lastRowOf(oppId, sy);
      const vars = {
        ...common, opp: nameOf(oppId), venue: home ? '홈' : '원정', score: `${mp}-${op}`, scoreRev: `${op}-${mp}`, my: mp, oppPts: op, total: mp + op, margin,
        otText: mg.overtimes ? `${mg.overtimes > 1 ? `${mg.overtimes}차 ` : ''}연장 혈투 끝에 ` : '',
        h2h: recordText(h2w, h2.length - h2w), l5: recordText(w5, l5.length - w5), formWord: l5.length >= 3 ? (w5 >= 4 || (l5.length < 5 && w5 === l5.length) ? '좋다' : w5 <= 1 ? '무겁다' : '엇갈린다') : undefined,
        ppgFor: fmt1(me.pf / (me.w + me.l)), ppgAgn: fmt1(me.pa / (me.w + me.l)), oppRank: orow, oppRec: recordText(orec.w, orec.l), ...(olr ? { oppLastRank: olr.rank } : {}),
        ...(myTop ? { star: pbn(myTop.id, myTop.name), starLine: lineOf(myTop), ...pInfo(myTop.id, 'star'), ...(avgText(myTop.id) ? { starAvg: avgText(myTop.id) } : {}) } : {}),
        ...(opTop ? { oppStar: pbn(opTop.id, opTop.name), oppStarLine: lineOf(opTop), ...(avgText(opTop.id) ? { oppStarAvg: avgText(opTop.id) } : {}) } : {})
      };
      if (me.w + me.l < 3) delete vars.formWord;
      let kind; let delta; let comments;
      if (d.day === 1) { kind = win ? 'opener_win' : 'opener_loss'; delta = win ? 2.4 : -2; comments = 2; }
      else if (win && streak >= 3 && [3, 5, 7, 10, 12, 15].includes(streak)) { kind = 'streak_win'; vars.streak = streak; delta = 4.4; comments = 3; }
      else if (!win && -streak >= 3 && [3, 5, 7, 10, 12].includes(-streak)) { kind = 'streak_lose'; vars.streak = -streak; delta = -5.3; comments = 3; }
      else if (mg.overtimes || margin <= 3) { kind = win ? 'thriller_win' : 'thriller_loss'; delta = win ? 3 : -2.2; comments = 2; }
      else if (margin >= 20) { kind = win ? 'blowout_win' : 'blowout_loss'; delta = win ? 3 : -3.5; comments = 2; }
      else { kind = win ? 'result_win' : 'result_loss'; delta = win ? 2.4 : -2.8; comments = 1; }
      add({ key: `${sy}:g${d.day}`, t: t0, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind, scope: 'my', tags: ['우리 팀', '경기'], tone: win ? 'good' : 'bad', delta, comments, oppId, vars, refTeam: oppId, win, flag: 'game' });
    }

    // 오늘의 활약(리그 전체에서 하나)
    let star = null;
    for (const g of dayGames) {
      for (const [side, teamId, oppId] of [[g.box?.home, g.homeId, g.awayId], [g.box?.away, g.awayId, g.homeId]]) {
        for (const l of side ?? []) {
          if (!l.minutes) continue;
          const triple = l.points >= 10 && l.rebounds >= 10 && l.assists >= 10;
          if (!(l.points >= 32 || triple || l.rebounds >= 16 || l.assists >= 13)) continue;
          const score = l.points + l.rebounds * 1.2 + l.assists * 1.5 + (triple ? 15 : 0);
          if (!star || score > star.score) star = { l, teamId, oppId, g, score, triple };
        }
      }
    }
    if (star) {
      const { l, teamId, oppId, g } = star;
      const thisPts = teamId === g.homeId ? g.homePts : g.awayPts; const thatPts = teamId === g.homeId ? g.awayPts : g.homePts;
      const kind = l.points >= 32 && !star.triple ? 'star_points' : 'star_all';
      const trow = order.findIndex((r) => r.id === teamId) + 1;
      add({
        key: `${sy}:star${d.day}`, t: t0 + 0.5, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind, scope: 'league', tags: ['리그', '기록'], tone: teamId === my ? 'good' : 'neutral', comments: 2, playerComment: true, starTeamId: teamId, refTeam: teamId === my ? undefined : teamId,
        vars: {
          player: pbn(l.id, l.name), starTeam: nameOf(teamId), opp: nameOf(oppId), pts: l.points, line: `${l.points}점 ${l.rebounds}리바운드 ${l.assists}어시스트`, day: d.day, res: thisPts > thatPts ? '승리' : '패배', score: `${thisPts}-${thatPts}`,
          ...pInfo(l.id, 's'), ...(avgText(l.id) ? { sAvg: avgText(l.id) } : {}), sTeamRank: trow, sTeamRec: ofRec(teamId)
        }
      });
    }

    // 순위 변화
    if (leader.id !== prevLeader && d.day >= 3) {
      if (leader.id === my) {
        add({ key: `${sy}:first${d.day}`, t: t0 + 0.6, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_first', scope: 'my', tags: ['우리 팀', '순위'], tone: 'good', delta: 3, comments: 3, vars: { ...common } });
      } else if (prevLeader) {
        add({ key: `${sy}:lead${d.day}`, t: t0 + 0.6, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'leader_change', scope: 'league', tags: ['리그', '순위'], comments: 1, vars: { ...common, leader: nameOf(leader.id), prev: nameOf(prevLeader), leaderRec, day: d.day } });
      }
    }
    if (prevRank != null && d.day >= 18) {
      if (prevRank <= TOP && myRank > TOP) add({ key: `${sy}:rout${d.day}`, t: t0 + 0.7, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_out', scope: 'my', tags: ['우리 팀', '순위'], tone: 'bad', delta: -3, comments: 2, vars: { ...common } });
      else if (prevRank > TOP && myRank <= TOP) add({ key: `${sy}:rin${d.day}`, t: t0 + 0.7, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'rank_in', scope: 'my', tags: ['우리 팀', '순위'], tone: 'good', delta: 2.5, comments: 2, vars: { ...common } });
    }
    // 진출 확정·탈락 확정: 남은 경기를 모두 져도(모두 이겨도) 6위 안에 든다(들 수 없다)고 승수만으로 확인되는 순간
    if (!clinched && !out && d.day >= 20) {
      const left = (id) => totalDays - (rec.get(id).w + rec.get(id).l);
      const others = order.filter((r) => r.id !== my);
      if (others.filter((r) => r.w + left(r.id) >= me.w).length <= TOP - 1) {
        clinched = true;
        add({ key: `${sy}:clinch`, t: t0 + 0.8, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'clinch', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'good', delta: 5, comments: 3, vars: { ...common } });
      } else if (others.filter((r) => r.w > me.w + left(my)).length >= TOP) {
        out = true;
        add({ key: `${sy}:out`, t: t0 + 0.8, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: 'eliminated', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'bad', delta: -6, comments: 3, vars: { ...common } });
      }
    }
    // 한 바퀴(9일)마다 결산
    const cycle = Math.round(src.teams.length - 1);
    if (d.day % cycle === 0) {
      const best = [...scorers.values()].filter((s) => s.g >= 5).sort((a, b) => b.pts / b.g - a.pts / a.g)[0];
      const vars = { ...common, cycle: d.day / cycle, ...(best ? { scorer: best.name, ppg: fmt1(best.pts / best.g) } : {}), ppgFor: fmt1(me.pf / (me.w + me.l)), ppgAgn: fmt1(me.pa / (me.w + me.l)) };
      const l5 = myResults.slice(-5); const w5 = l5.filter((x) => x.win).length;
      Object.assign(vars, { l5: recordText(w5, l5.length - w5), formWord: w5 >= 4 ? '좋다' : w5 <= 1 ? '무겁다' : '엇갈린다' });
      if (d.day === totalDays) {
        add({ key: `${sy}:end`, t: t0 + 0.9, season: seasonLabel, when: `${seasonLabel} 정규리그 종료`, kind: 'regular_end', scope: 'my', tags: ['우리 팀', '순위'], tone: myRank <= TOP ? 'good' : 'bad', delta: myRank <= TOP ? 2 : -2, comments: 2, vars: { ...vars, nextSeason: labelOf(sy + 1), tail: myRank <= TOP ? '플레이오프에 진출했다.' : '플레이오프에는 오르지 못했다.' } });
      } else {
        add({ key: `${sy}:cycle${d.day}`, t: t0 + 0.9, season: seasonLabel, when: `${seasonLabel} ${d.day}일차`, kind: d.day * 2 === totalDays ? 'midseason' : 'cycle', scope: 'my', tags: ['우리 팀', '순위'], tone: myRank <= TOP ? 'good' : 'bad', comments: 1, vars });
      }
    }
    prevRank = myRank; prevLeader = leader.id;
  }

  // ----- 플레이오프(현재 시즌이 진행 중이거나, 오프시즌에서 방금 끝난 시즌) -----
  const finalRank = (standings, id) => { const i = standings.findIndex((s) => s.id === id); return i >= 0 ? i + 1 : undefined; };
  const seriesEvents = (seriesList, y, label, standings, source) => {
    const myRankIn = finalRank(standings, my);
    const myPo = (list) => { // 우리 팀이 거친 라운드 요약
      const rounds = list.filter((s) => s.higherId === my || s.lowerId === my);
      if (!rounds.length) return undefined;
      const last = rounds.at(-1);
      return last.winnerId === my ? (last.round === '챔피언결정전' || last.round === '결승' ? '우승으로 마무리됐다' : `${last.round}을 통과해 다음 라운드로 올랐다`) : `${last.round}에서 멈췄다`;
    };
    seriesList.forEach((s, i) => {
      const round = s.round;
      const ro = ROUND_ORDER[round] ?? 1;
      const winner = s.winnerId; const loser = s.winnerId === s.higherId ? s.lowerId : s.higherId;
      const w = s.wins[winner]; const l = s.wins[loser];
      const wins = recordText(w, l);
      const key = `${y}:po${i}`; const t = base(y) + 100 + ro * 10 + i;
      const isMy = winner === my || loser === my;
      const final = ro === 3;
      // 경기별 스코어: 실시간은 경기 결과 배열, 기록은 [높은 시드 득점, 낮은 시드 득점]
      const pts = (s.games ?? []).map((g) => (Array.isArray(g) ? g : [g.homeId === s.higherId ? g.homePts : g.awayPts, g.homeId === s.higherId ? g.awayPts : g.homePts]));
      const gameList = pts.map((p, k) => `${k + 1}차전 ${nameOf(p[0] > p[1] ? s.higherId : s.lowerId)} ${Math.max(...p)}-${Math.min(...p)}`).join(', ');
      const sidePts = (id) => pts.map((p) => (id === s.higherId ? p[0] : p[1]));
      const avgPts = (arr) => (arr.length ? fmt1(arr.reduce((x, y) => x + y, 0) / arr.length) : undefined);
      const wr = finalRank(standings, winner); const lr = finalRank(standings, loser);
      const vp = {
        round, wins, season: label, winner: nameOf(winner), loser: nameOf(loser), team: nameOf(my), opp: nameOf(winner === my ? loser : winner),
        ...(pts.length ? { nGames: pts.length, gameList, winAvg: avgPts(sidePts(winner)), loseAvg: avgPts(sidePts(loser)) } : {}), ...(wr && lr ? { winnerRank: wr, loserRank: lr, upsetText: wr > lr ? '정규리그 순위가 낮은 팀이 시리즈를 가져갔다.' : '정규리그 순위가 높은 팀이 순리대로 시리즈를 가져갔다.' } : {}),
        ...(myRankIn ? { myRank: myRankIn, rank: myRankIn } : {}), ...(myPo(seriesList.slice(0, i + 1)) && isMy ? { myPoText: myPo(seriesList.slice(0, i + 1)) } : {}), ...(NEXT_ROUND[round] ? { nextRound: NEXT_ROUND[round] } : {}), ...(final ? {} : {})
      };
      if (final) {
        if (winner === my) add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_title_my', scope: 'my', tags: ['우리 팀', '플레이오프', '우승'], tone: 'good', delta: 12, comments: 3, vars: { ...vp, opp: nameOf(loser) }, src: source });
        else add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_title', scope: isMy ? 'my' : 'league', tags: ['플레이오프', '우승'], tone: isMy ? 'bad' : 'neutral', delta: isMy ? -5 : 0, comments: 2, vars: vp });
      } else if (isMy) {
        if (winner === my) add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_my_win', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'good', delta: 5, comments: 3, vars: { ...vp, opp: nameOf(loser) } });
        else add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_my_out', scope: 'my', tags: ['우리 팀', '플레이오프'], tone: 'bad', delta: -5, comments: 3, vars: { ...vp, opp: nameOf(winner) } });
      } else {
        add({ key, t, season: label, when: `${label} 플레이오프 ${round}`, kind: 'po_league', scope: 'league', tags: ['리그', '플레이오프'], comments: 1, vars: vp });
      }
    });
  };
  const curSeries = cur.playoffSeries ?? [];
  if (curSeries.length) seriesEvents(curSeries, sy, seasonLabel, rank().map((r) => ({ id: r.id })), 'live');

  // ----- 부상·시즌 중 선수단 변동(src/injuries.mjs, src/inseason.mjs) -----
  // 입력은 진행 중 시즌의 변동 기록(cur.rosterLog)과 끝난 시즌 항목의 요약(entry.roster: inj·mv 배열). 같은 모양으로 맞춰 기사를 만든다.
  const KIND_WORD = { minor: '경상', moderate: '중상', severe: '장기 부상', season: '시즌 아웃' };
  const SWAP_WORD = { temp: '일시교체', season: '시즌대체', other: '시즌대체(기타 사유)' };
  const SWAP_RULE = {
    temp: '외국선수 관리규정은 외국인 선수가 2주 이상의 진단을 받으면 부상 기간 동안 일시교체를 할 수 있게 한다.',
    season: '외국선수 관리규정은 8주 이상의 진단이면 시즌대체를 할 수 있고, 부상 사유의 교체는 횟수 제한이 없다고 정한다.',
    other: '외국선수 관리규정은 기타 사유의 시즌대체를 구단당 2회까지만 허용한다.'
  };
  const SWAP_RULE_ASIA = {
    temp: '아시아쿼터 선수의 교체를 정한 규정은 따로 없어서, 이 게임은 외국선수 관리규정의 기준(2주 이상 진단이면 일시교체)을 아시아쿼터 선수에게도 똑같이 적용한다.',
    season: '아시아쿼터 선수의 교체를 정한 규정은 따로 없어서, 이 게임은 외국선수 관리규정의 기준(8주 이상 진단이면 시즌대체, 부상 사유는 횟수 제한 없음)을 그대로 적용한다.',
    other: '아시아쿼터 선수의 교체를 정한 규정은 따로 없어서, 이 게임은 기타 사유 시즌대체를 구단당 2회까지만 허용하는 외국선수 관리규정의 기준을 그대로 적용한다.'
  };
  const SWAP_PAY = {
    temp: '일시교체 선수는 뛴 기간만큼만 보수를 받고, 부상 선수가 돌아오면 팀을 떠난다.',
    season: '떠나는 선수의 이번 시즌 보수는 계속 나가고, 새 선수는 합류한 뒤부터의 보수를 받는다.',
    other: '떠나는 선수의 이번 시즌 보수는 계속 나가고, 새 선수는 합류한 뒤부터의 보수를 받는다.'
  };
  const fromEntryRoster = (r) => (r ? [
    ...(r.inj ?? []).map(([playerId, teamId, day, games, kind, part, name]) => ({ type: 'injury', playerId, teamId, day, games, kind, part, name })),
    ...(r.mv ?? []).map((m) => (m[0] === 'wv' ? { type: m[1], day: m[2], teamId: m[3], name: m[4], fromTeamId: m[5], salaryEok: m[6], ovr: m[7], ...(m[8] ? { reason: m[8] } : {}) } : m[0] === 'fa' ? { type: 'fa', day: m[2], teamId: m[3], name: m[4], salaryEok: m[5], years: m[6], ovr: m[7] } : { type: 'foreign', kind: m[1], day: m[2], teamId: m[3], name: m[4], outName: m[5], ...(m[8] ? { asia: true, eok: m[6] } : { usd: m[6] }), ovr: m[7] }))
  ] : []);
  const rosterEvents = (y, label, rows) => {
    const tot = y === sy ? totalDays : games;
    const at = (day, i) => base(y) + day + 0.5 + i * 0.01;
    const gamesText = (g) => (g >= 99 ? '남은 시즌 전체' : `${g}경기`);
    const nmOf = (e) => cleanName(e.name ?? '');
    const injVars = (e) => {
      const back = e.games < 99 && e.day + e.games + 1 <= tot ? e.day + e.games + 1 : undefined;
      return {
        team: nameOf(e.teamId), player: nmOf(e), part: e.part, day: e.day, gamesText: gamesText(e.games), kindText: KIND_WORD[e.kind] ?? '부상', absence: e.games >= 99 ? '시즌 아웃' : `${e.games}경기 결장`,
        remain: Math.max(0, tot - e.day), ...(back ? { backDay: back } : {}), ...pInfo(e.playerId)
      };
    };
    const inj = rows.filter((e) => e.type === 'injury');
    inj.filter((e) => e.teamId === my && e.games >= 3).slice(0, 5).forEach((e, i) => add({ key: `${y}:inj:${e.playerId}:${e.day}`, t: at(e.day, i), season: label, when: `${label} ${e.day}일차 · 부상`, kind: 'injury_my', scope: 'my', tags: ['우리 팀', '부상'], tone: 'bad', delta: e.games >= 18 ? -2 : -1, comments: 2, vars: injVars(e) }));
    inj.filter((e) => e.teamId !== my && e.games >= 18).sort((a, b) => b.games - a.games || a.day - b.day).slice(0, 3).forEach((e, i) => add({ key: `${y}:inj:${e.playerId}:${e.day}`, t: at(e.day, i), season: label, when: `${label} ${e.day}일차 · 부상`, kind: 'injury_star', scope: 'league', tags: ['리그', '부상'], comments: 1, vars: injVars(e) }));
    rows.filter((e) => e.type === 'fa' && e.teamId === my).slice(0, 3).forEach((e, i) => add({ key: `${y}:fasn:${e.day}:${i}`, t: at(e.day, i), season: label, when: `${label} ${e.day}일차 · 시즌 중 영입`, kind: 'fa_season', scope: 'move', tags: ['우리 팀', 'FA'], tone: 'good', delta: 1, comments: 2, vars: { team: nameOf(my), player: nmOf(e), day: e.day, salary: fmt1(e.salaryEok), years: e.years, remain: Math.max(0, tot - e.day), ...pInfo(e.playerId ?? '') } }));
    const swaps = rows.filter((e) => e.type === 'foreign' && SWAP_WORD[e.kind]);
    // 외국인 교체와 아시아쿼터 교체는 각각 앞쪽 몇 건씩만 기사로 쓴다(한쪽이 많아도 다른 쪽이 밀려나지 않게)
    [...swaps.filter((e) => !e.asia).slice(0, 6), ...swaps.filter((e) => e.asia).slice(0, 4)].forEach((e, i) => {
      const mine = e.teamId === my;
      if (!mine && (e.asia ? i - Math.min(6, swaps.filter((x) => !x.asia).length) : i) >= 3) return;
      add({
        key: `${y}:fw:${e.day}:${e.teamId}:${e.kind}${e.asia ? ':a' : ''}`, t: at(e.day, i), season: label, when: `${label} ${e.day}일차 · ${e.asia ? '아시아쿼터' : '외국인'} 교체`, kind: mine ? 'foreign_swap_my' : 'foreign_swap_lg', scope: mine ? 'move' : 'league', tags: [mine ? '우리 팀' : '리그', e.asia ? '아시아쿼터' : '외국인'], tone: mine ? 'neutral' : 'neutral', delta: mine ? 0.5 : 0, comments: mine ? 2 : 1,
        vars: { team: nameOf(e.teamId), player: nmOf(e), outName: cleanName(e.outName ?? ''), kindText: SWAP_WORD[e.kind], day: e.day, ovr: e.ovr, usdText: e.asia ? `${fmt1(e.eok)}억 원` : `${Math.round(e.usd / 10000)}만 달러`, origText: e.asia ? '아시아쿼터 선수' : '외국인 선수', origShort: e.asia ? '아시아쿼터' : '외국인', ruleText: (e.asia ? SWAP_RULE_ASIA : SWAP_RULE)[e.kind], payText: SWAP_PAY[e.kind], remain: Math.max(0, tot - e.day) }
      });
    });
  };
  // 웨이버(src/waivers.mjs): 우리 구단이 공시한 선수, 우리 선수를 다른 구단이 양수하거나 FA로 풀린 결과, 우리가 양수 신청한 결과만 기사로 쓴다
  const WV_RULE = '규약 제101조는 웨이버 선수를 여러 구단이 원하면 전 시즌 정규 경기 순위의 역순으로 계약 우선권을 주고, 영입한 구단은 30일 안에 그 선수를 다시 웨이버 조치할 수 없다고 정한다.';
  const waiverEvents = (y, label, rows) => {
    const tot = y === sy ? totalDays : games;
    const at = (day, i) => base(y) + day + 0.6 + i * 0.01;
    const nmOf = (e) => cleanName(e.name ?? '');
    const J = (w, pair) => `${w}${josa(w, pair)}`;
    const mineRows = rows.filter((e) => (e.type === 'waive' && e.teamId === my) || (e.type === 'claim' && (e.teamId === my || e.fromTeamId === my)) || (e.type === 'waiver_fa' && e.teamId === my) || (e.type === 'claim_fail' && e.teamId === my));
    mineRows.slice(0, 6).forEach((e, i) => {
      const player = nmOf(e);
      const common = { team: nameOf(my), player, day: e.day, remain: Math.max(0, tot - e.day), ...pInfo(e.playerId ?? '') };
      let tone = 'neutral', delta = 0, v;
      if (e.type === 'waive') {
        const gamesLeft = e.until != null ? e.until - e.day : undefined;
        v = { outcomeShort: '공시', statusText: `${J(nameOf(my), '이/가')} ${e.day}일차에 ${J(player, '을/를')} 웨이버로 공시했다. ${gamesLeft ? `공시기간은 ${gamesLeft}경기일이고` : '공시기간 동안'} 다른 구단이 남은 계약을 양수할 수 있다.`, ruleText: WV_RULE, moneyText: `남은 계약 ${e.salaryEok != null ? `(연봉 ${fmt1(e.salaryEok)}억)` : ''}은 양수하는 구단이 없으면 해지 비용으로 정산되고, 양수 구단이 나오면 그 구단이 이어받는다.`, nextText: '공시가 끝나면 결과가 새 기사로 전해진다.' };
      } else if (e.type === 'claim' && e.fromTeamId === my) {
        tone = 'good'; delta = 0.5;
        v = { outcomeShort: `${nameOf(e.teamId)} 양수`, statusText: `${J(nameOf(e.teamId), '이/가')} ${e.day}일차에 ${J(nameOf(my), '이/가')} 공시한 ${player}의 남은 계약을 양수했다.`, ruleText: WV_RULE, moneyText: `${J(nameOf(my), '은/는')} 남은 보수를 지급할 의무에서 벗어나고, 공시기간까지의 보수만 정산한다.${e.salaryEok != null ? ` 이어받은 계약은 연봉 ${fmt1(e.salaryEok)}억이다.` : ''}`, nextText: '방출 비용이 사라진 만큼 시즌 자금에 여유가 생겼다.' };
      } else if (e.type === 'claim') {
        tone = 'good'; delta = 1;
        v = { outcomeShort: '양수 성공', statusText: `${J(nameOf(my), '이/가')} ${e.day}일차 공시가 끝나는 시점에 ${J(nameOf(e.fromTeamId), '이/가')} 내놓은 ${player}의 계약을 양수했다.`, ruleText: WV_RULE, moneyText: `${e.salaryEok != null ? `연봉 ${fmt1(e.salaryEok)}억` : '기존 연봉'}에 남은 계약 ${e.yearsLeft ?? '-'}년을 이어받았고, 합류한 뒤의 보수만 낸다.`, nextText: '영입일로부터 30일(약 10경기) 안에는 이 선수를 다시 웨이버 조치할 수 없다.' };
      } else if (e.type === 'waiver_fa') {
        v = { outcomeShort: '양수 없음, FA로', statusText: `${J(nameOf(my), '이/가')} 공시한 ${player}${josa(player, '을/를')} 양수하겠다는 구단이 나오지 않았다. ${e.day}일차에 공시가 끝나 FA 시장으로 풀렸다.`, ruleText: WV_RULE, moneyText: '남은 계약은 방출 비용으로 정산된다.', nextText: '시장에 나온 선수는 다른 구단이 FA로 영입할 수 있다.' };
      } else {
        tone = 'bad'; delta = -0.5;
        v = { outcomeShort: '양수 실패', statusText: `${J(nameOf(my), '이/가')} 신청한 ${player} 양수가 이뤄지지 않았다. ${e.reason ?? ''}`.trim(), ruleText: WV_RULE, moneyText: '양수에 실패했으므로 추가로 나가는 보수는 없다.', nextText: '다른 선수나 시즌 중 FA 시장에서 빈자리를 채우는 방법이 남아 있다.' };
      }
      add({ key: `${y}:wv:${e.type}:${e.playerId}:${e.day}:${i}`, t: at(e.day, i), season: label, when: `${label} ${e.day}일차 · 웨이버`, kind: 'waiver_my', scope: 'move', tags: ['우리 팀', '웨이버'], tone, delta, comments: 2, vars: { ...common, ...v } });
    });
  };
  if (cur.stage !== 'offseason') waiverEvents(sy, seasonLabel, cur.rosterLog ?? []);
  log.forEach((entry) => { if (entry.roster) waiverEvents(entry.startYear, entry.season, fromEntryRoster(entry.roster)); });
  if (cur.stage !== 'offseason') rosterEvents(sy, seasonLabel, (cur.rosterLog ?? []).filter((e) => e.type !== 'return' && e.type !== 'release'));
  log.forEach((entry) => { if (entry.roster) rosterEvents(entry.startYear, entry.season, fromEntryRoster(entry.roster)); });

  // ----- 끝난 시즌들(로그) -----
  log.forEach((entry, idx) => {
    const y = entry.startYear; const label = entry.season;
    const latest = idx === log.length - 1;
    const row = entry.standings.find((s) => s.id === my);
    const recText = row ? recordText(row.wins, row.losses) : '';
    if (entry.series?.length && (cur.stage === 'offseason' || !latest || y !== sy)) {
      const list = latest ? entry.series : entry.series.filter((s) => s.round === '챔피언결정전' || s.round === '결승');
      seriesEvents(list, y, label, entry.standings, 'log');
    }
    const st = entry.stage?.[my];
    const led = entry.ledger?.[my];
    const kind = row && row.rank <= 3 && st ? 'review_top' : st ? 'review_mid' : 'review_miss';
    const nextSeason = labelOf(y + 1);
    const lrow = lastRowOf(my, y);
    const myLeader = (entry.leaders ?? []).filter((l) => l.teamId === my).sort((a, b) => b.ppg - a.ppg)[0];
    const reviewVars = row ? {
      team: nameOf(my), season: label, rank: row.rank, record: recText, stage: STAGE_TEXT[st ?? ''] ?? '진출 실패', net: led ? `${led.net >= 0 ? '+' : '-'}${money(led.net)}` : '0.0',
      winPct: pct3(row.wins, row.losses), nextSeason, regChamp: nameOf(entry.standings[0].id), regChampRec: recordText(entry.standings[0].wins, entry.standings[0].losses), champName: nameOf(entry.championId), ...(led ? { revenue: money(led.revenue), payroll: money(led.payroll) } : {}),
      ...(lrow ? { lastRank: lrow.rank, lastRec: recordText(lrow.wins, lrow.losses), cmpWord: `이번 시즌은 ${row.rank < lrow.rank ? '순위가 올랐다' : row.rank > lrow.rank ? '순위가 내려갔다' : '순위가 같았다'}.` } : {}),
      ...(titlesOf(my) != null ? { titles: titlesOf(my) } : {}), ...(myLeader ? { tmName: cleanName(myLeader.name), tmPpg: fmt1(myLeader.ppg) } : {})
    } : null;
    if (row) add({ key: `${y}:review`, t: base(y) + 200, season: label, when: `${label} 시즌 결산`, kind, scope: 'my', tags: ['우리 팀', '결산'], tone: st ? 'good' : 'bad', delta: kind === 'review_top' ? 3 : kind === 'review_mid' ? 0 : -3, comments: 2, vars: reviewVars });
    const ev = entry.eval;
    if (ev?.goals?.length && row) {
      const total = ev.goals.length, met = ev.goals.filter((g) => g.met).length;
      const missed = ev.goals.filter((g) => !g.met).map((g) => GOAL_TEXT(g));
      const vars = {
        team: nameOf(my), season: label, nextSeason, goalsTotal: total, goalsMet: met, trust: ev.trust,
        goalsText: ev.goals.map((g) => GOAL_TEXT(g)).join(', '),
        trustMove: ev.delta > 0 ? `${ev.delta}점 올라 ${ev.trust}점` : ev.delta < 0 ? `${-ev.delta}점 내려 ${ev.trust}점` : `${ev.trust}점으로 변동이 없다`,
        ...(missed.length ? { missedText: missed.join(', ') } : { allMet: '올해 목표를 전부 채웠다는 평가다.' }),
        ...(ev.bonus ? { bonus: fmt1(ev.bonus) } : {})
      };
      if (ev.status === 'warn') vars.warnTrust = ev.trust; else if (ev.status === 'risk') vars.riskTrust = ev.trust;
      add({ key: `${y}:goals`, t: base(y) + 203, season: label, when: `${label} 모기업 평가`, kind: 'goals_eval', scope: 'my', tags: ['우리 팀', '모기업'], tone: met === total ? 'good' : met === 0 ? 'bad' : 'neutral', delta: ev.delta >= 10 ? 2 : ev.delta <= -8 ? -2 : 0, comments: 2, vars });
    }
    (entry.staffMoves ?? []).slice(0, 3).forEach((m, i) => { // AI 구단의 감독 교체(시즌이 끝날 때 하위권이면 가끔)
      const spec = (h) => `전술 이해 ${h.tac}·선수 육성 ${h.dev}·로테이션 운영 ${h.rot}`;
      const rk = entry.standings.findIndex((r) => r.id === m.teamId), r0 = entry.standings[rk];
      if (!r0) return;
      add({ key: `${y}:coach:${m.teamId}`, t: base(y) + 204 + i * 0.1, season: label, when: `${label} 시즌 종료 · 감독 교체`, kind: 'coach_change', scope: 'league', tags: ['리그', '감독'], tone: 'neutral', delta: 0, comments: 2, refTeam: m.teamId,
        vars: { team: nameOf(m.teamId), season: label, nextSeason, rank: rk + 1, record: recordText(r0.wins, r0.losses), oldHead: m.from.name, newHead: m.to.name, oldSpec: spec(m.from), newSpec: spec(m.to) } });
    });
    const aw = entry.awards;
    if (aw?.mvp && entry.lines?.[aw.mvp]) {
      const lineOf2 = (id) => entry.lines[id];
      const nm = (id) => cleanName(entry.playerNames?.[id] ?? pbn(id) ?? '');
      const teamOf2 = (id) => nameOf(lineOf2(id)?.[13] ?? entry.myTeamId);
      const avg = (id, i) => (lineOf2(id) && lineOf2(id)[0] ? lineOf2(id)[i] / lineOf2(id)[0] : null);
      const stat3 = (id) => (avg(id, 2) == null ? null : `경기당 ${fmt1(avg(id, 2))}점 ${fmt1(avg(id, 3))}리바 ${fmt1(avg(id, 4))}어시`);
      const mvpRow = entry.standings.find((r) => r.id === lineOf2(aw.mvp)[13]);
      const finalsRow = aw.finalsMvp ? (entry.po?.[aw.finalsMvp] ?? []).find((r) => r[0] === 'f') : null;
      const leaders = [['pts', '득점', 2], ['reb', '리바운드', 3], ['ast', '어시스트', 4], ['stl', '스틸', 5], ['blk', '블록', 6]].filter(([k]) => aw[k] && entry.lines?.[aw[k]])
        .map(([k, word, i]) => `${word} ${nm(aw[k])}(${fmt1(avg(aw[k], i))})`);
      const mineWon = [...(aw.best5 ?? []).map((id) => [id, '베스트5']), ...['mvp', 'finalsMvp', 'rookie', 'defense', 'improved', 'pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => aw[k]).map((k) => [aw[k], k === 'mvp' ? 'MVP' : k === 'finalsMvp' ? '챔피언결정전 MVP' : { rookie: '신인상', defense: '최우수 수비상', improved: '기량발전상', pts: '득점상', reb: '리바운드상', ast: '어시스트상', stl: '스틸상', blk: '블록상' }[k]])]
        .filter(([id]) => lineOf2(id)?.[13] === my);
      const byPlayer = new Map();
      for (const [id, what] of mineWon) byPlayer.set(id, [...(byPlayer.get(id) ?? []), what]);
      const myAwards = [...byPlayer].slice(0, 4).map(([id, list]) => `${nm(id)}(${list.join('·')})`).join(', ');
      const vars = {
        team: nameOf(my), season: label, champName: nameOf(entry.championId),
        mvp: nm(aw.mvp), mvpTeam: teamOf2(aw.mvp), mvpLine: stat3(aw.mvp), ...(mvpRow ? { mvpRank: mvpRow.rank, mvpRec: recordText(mvpRow.wins, mvpRow.losses) } : {}),
        ...(aw.best5?.length ? { best5: aw.best5.map(nm).join(', ') } : {}),
        ...(aw.rookie && lineOf2(aw.rookie) ? { rookie: nm(aw.rookie), rookieTeam: teamOf2(aw.rookie), rookieLine: stat3(aw.rookie) } : {}),
        ...(aw.defense && lineOf2(aw.defense) ? { dfName: nm(aw.defense), dfTeam: teamOf2(aw.defense), dfStl: fmt1(avg(aw.defense, 5)), dfBlk: fmt1(avg(aw.defense, 6)) } : {}),
        ...(aw.improved && lineOf2(aw.improved) ? { imName: nm(aw.improved), imTeam: teamOf2(aw.improved) } : {}),
        ...(leaders.length ? { leadersText: leaders.join(', ') } : {}),
        ...(finalsRow ? { fmName: nm(aw.finalsMvp), fmLine: `경기당 ${fmt1(finalsRow[6] / finalsRow[2])}점 ${fmt1(finalsRow[7] / finalsRow[2])}리바 ${fmt1(finalsRow[8] / finalsRow[2])}어시` } : {}),
        ...(myAwards ? { myAwards, player: nm(mineWon[0][0]) } : {})
      };
      add({ key: `${y}:awards`, t: base(y) + 205, season: label, when: `${label} 시즌 어워드`, kind: 'awards', scope: myAwards ? 'my' : 'league', tags: myAwards ? ['우리 팀', '어워드'] : ['리그', '어워드'], tone: myAwards ? 'good' : 'neutral', delta: myAwards ? 1 : 0, comments: 2, playerComment: !!myAwards, vars });
    }
    if (!latest) return;
    const wen = (when) => `${label} 오프시즌 · ${when}`;
    const offBase = row ? { team: nameOf(my), lastSeasonLabel: label, rank: row.rank, record: recText, stage: STAGE_TEXT[st ?? ''] ?? '진출 실패', nextSeason, ...ofTeam() } : { team: nameOf(my), nextSeason, ...ofTeam() };
    // 재정
    if (led) {
      if (led.penalty > 0) add({ key: `${y}:cap`, t: base(y) + 350, season: label, when: wen('재정'), kind: 'cap_over', scope: 'my', tags: ['우리 팀', '재정'], tone: 'bad', delta: -1.5, comments: 2, vars: { ...offBase, season: label, penalty: money(led.penalty), payroll: money(led.payroll), cap: money(src.capEok ?? 30) } });
      const plus = led.net >= 0;
      add({ key: `${y}:funds`, t: base(y) + 351, season: label, when: wen('재정'), kind: plus ? 'funds_plus' : 'funds_minus', scope: 'my', tags: ['우리 팀', '재정'], tone: plus ? 'good' : 'bad', delta: plus ? 1 : -1, comments: 1, vars: { ...offBase, season: label, net: `${plus ? '+' : '-'}${money(led.net)}`, profit: money(led.net), loss: money(led.net), revenue: money(led.revenue), ...(entry.fundsAfter?.[my] != null ? { fundsText: `오프시즌을 거친 구단 자금은 ${money(entry.fundsAfter[my])}억이다.` } : { fundsText: '' }) } });
    }
    // 오프시즌 보고서(완료된 오프시즌) 또는 진행 중인 오프시즌의 은퇴·성장
    const rep = entry.report;
    const retired = rep ? rep.retired : cur.offseason?.retired ?? [];
    const mineProg = rep ? rep.progressed.mine : (cur.offseason?.progressed ?? []).filter((p) => p.teamId === my);
    retired.filter((p) => p.teamId === my).slice(0, 3).forEach((p) => add({ key: `${y}:ret:${p.id}`, t: base(y) + 300, season: label, when: wen('은퇴'), kind: 'retire_my', scope: 'my', tags: ['우리 팀', '은퇴'], tone: 'neutral', delta: -1, comments: 2, vars: { ...offBase, player: pbn(p.id, p.name), pAge: p.age, pOvr: p.ovr, pPos: players.get(p.id)?.position ?? undefined, pSalary: undefined, age: p.age, ovr: p.ovr } }));
    const star = retired.filter((p) => p.teamId !== my).sort((a, b) => b.ovr - a.ovr)[0];
    if (star) add({ key: `${y}:ret:${star.id}`, t: base(y) + 300.5, season: label, when: wen('은퇴'), kind: 'retire_star', scope: 'league', tags: ['리그', '은퇴'], comments: 1, vars: { ...offBase, player: pbn(star.id, star.name), from: nameOf(star.teamId), age: star.age, ovr: star.ovr, pAge: star.age, pOvr: star.ovr } });
    const up = [...mineProg].sort((a, b) => b.delta - a.delta)[0];
    if (up && up.delta >= 2) add({ key: `${y}:up:${up.id}`, t: base(y) + 301, season: label, when: wen('성장'), kind: 'growth_up', scope: 'my', tags: ['우리 팀', '성장'], tone: 'good', delta: 1.5, comments: 2, playerComment: true, vars: { ...offBase, ...pInfo(up.id), player: pbn(up.id, up.name), from: up.from, to: up.to, delta: up.delta, deltaSign: `+${up.delta}`, age: up.age, pAge: up.age } });
    const down = [...mineProg].sort((a, b) => a.delta - b.delta)[0];
    if (down && down.delta <= -2) add({ key: `${y}:down:${down.id}`, t: base(y) + 302, season: label, when: wen('성장'), kind: 'growth_down', scope: 'my', tags: ['우리 팀', '성장'], tone: 'neutral', delta: -1.5, comments: 1, vars: { ...offBase, ...pInfo(down.id), player: pbn(down.id, down.name), from: down.from, to: down.to, delta: Math.abs(down.delta), deltaSign: `${down.delta}`, age: down.age, pAge: down.age } });
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
      add({ key: `${y}:trade${i}`, t: base(y) + 305 + i * 0.1, season: label, when: wen('트레이드'), kind: 'trade_done', scope: 'move', tags: ['우리 팀', '트레이드'], tone: 'neutral', delta: 0, comments: 2, vars: { ...offBase, partner: nameOf(partner), give: give.join(', '), get: get.join(', ') } });
    }
    // 재계약
    const renewed = rep.renewed.filter((r) => r.teamId === my);
    if (renewed.length) add({ key: `${y}:resign`, t: base(y) + 310, season: label, when: wen('재계약'), kind: 'resign_done', scope: 'move', tags: ['우리 팀', '재계약'], tone: 'good', delta: 1.5, comments: 2, vars: { ...offBase, count: renewed.length, names: renewed.slice(0, 3).map((r) => pbn(r.id, r.name)).join(', ') } });
    const refused = rep.refused.filter((r) => r.teamId === my);
    if (refused.length) add({ key: `${y}:refuse`, t: base(y) + 311, season: label, when: wen('재계약'), kind: 'resign_fail', scope: 'move', tags: ['우리 팀', '재계약'], tone: 'bad', delta: -2, comments: 2, vars: { ...offBase, count: refused.length, names: refused.slice(0, 3).map((r) => pbn(r.id, r.name)).join(', ') } });
    // FA
    const sigs = rep.signings;
    sigs.filter((s) => s.teamId === my).slice(0, 3).forEach((s) => add({ key: `${y}:fain:${s.id}`, t: base(y) + 320 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_in', scope: 'move', tags: ['우리 팀', 'FA'], tone: 'good', delta: 2, comments: 2, playerComment: true, vars: { ...offBase, ...pInfo(s.id), player: pbn(s.id, s.name), salary: fmt1(s.salaryEok), years: s.years, round: s.round } }));
    sigs.filter((s) => s.from === my && s.teamId !== my).slice(0, 3).forEach((s) => add({ key: `${y}:faout:${s.id}`, t: base(y) + 321 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_out', scope: 'move', tags: ['우리 팀', 'FA'], tone: 'bad', delta: -2, comments: 2, vars: { ...offBase, ...pInfo(s.id), player: pbn(s.id, s.name), to: nameOf(s.teamId), salary: fmt1(s.salaryEok), years: s.years } }));
    sigs.filter((s) => s.teamId !== my && s.from !== my).sort((a, b) => b.salaryEok - a.salaryEok).slice(0, 2).forEach((s) => add({ key: `${y}:fabig:${s.id}`, t: base(y) + 322 + s.round * 0.1, season: label, when: wen('FA'), kind: 'fa_big', scope: 'move', tags: ['리그', 'FA'], comments: 1, vars: { ...offBase, ...pInfo(s.id), player: pbn(s.id, s.name), to: nameOf(s.teamId), salary: fmt1(s.salaryEok), years: s.years, round: s.round } }));
    // 보상
    for (const c of rep.compensations.filter((x) => x.from === my || x.to === my)) {
      const sg = sigs.find((s) => s.id === c.playerId); if (!sg) continue;
      add({ key: `${y}:comp:${c.playerId}`, t: base(y) + 330, season: label, when: wen('FA 보상'), kind: 'comp', scope: 'move', tags: ['우리 팀', 'FA'], tone: c.to === my ? 'neutral' : 'good', delta: 0, comments: 1, vars: { ...offBase, ...pInfo(sg.id), player: pbn(sg.id, sg.name), from: nameOf(c.from), to: nameOf(c.to), compWhat: c.type === 'player' ? `선수 1명과 현금 ${fmt1(c.cashEok)}억` : `현금 ${fmt1(c.cashEok)}억` } });
    }
    // 드래프트
    rep.drafted.filter((d) => d.teamId === my).slice(0, 2).forEach((dd) => add({ key: `${y}:draft:${dd.id}`, t: base(y) + 340 + dd.pick * 0.01, season: label, when: wen('드래프트'), kind: 'draft_my', scope: 'move', tags: ['우리 팀', '드래프트'], tone: 'good', delta: 1, comments: 2, playerComment: true, vars: { ...offBase, ...pInfo(dd.id), player: pbn(dd.id, dd.name), pick: dd.pick, pos: dd.position, ovr: dd.ovr, potential: dd.potential, pPos: dd.position, pOvr: dd.ovr } }));
    const first = rep.drafted.find((d) => d.pick === 1);
    if (first && first.teamId !== my) add({ key: `${y}:draft1`, t: base(y) + 341, season: label, when: wen('드래프트'), kind: 'draft_top', scope: 'league', tags: ['리그', '드래프트'], comments: 1, vars: { ...offBase, ...pInfo(first.id), player: pbn(first.id, first.name), to: nameOf(first.teamId), pos: first.position, ovr: first.ovr, potential: first.potential, pPos: first.position, pOvr: first.ovr } });
  });

  // 정렬: 시간, 같은 시각이면 생성 순
  events.sort((a, b) => a.t - b.t || a.seq - b.seq);

  // ----- 글 만들기: 템플릿 고르기, 팬 심리, 댓글 -----
  let score = mood0;
  const hist = [];
  const recentH = {}; const recentS = {}; const recentC = {};
  const items = [];
  const usedNicks = new Set();
  for (const ev of events) {
    const group = TEMPLATES[ev.kind];
    const rng = mulberry32(hashString(`${src.seed}:${ev.key}`));
    const hi = pickIndex(group.h, ev.vars, rng, (recentH[ev.kind] ??= []));
    const headline = hi >= 0 ? fill(group.h[hi], ev.vars) : '';
    const { paragraphs, summary } = compose(ev.kind, ev.vars, rng, recentS);
    if (ev.delta) score = clamp(score + ev.delta, 5, 95);
    score += (50 - score) * 0.04;
    if (ev.flag === 'game' || ev.delta) hist.push(score);
    const trend = hist.length > 5 ? score - hist.at(-6) : hist.length ? score - hist[0] : 0;
    const label = moodLabel(score, trend);
    const comments = makeComments(ev, label, rng, src, usedNicks, recentC);
    items.push({
      id: ev.key, t: ev.t, season: ev.season, when: ev.when, kind: ev.kind, scope: ev.scope, tags: ev.tags, tone: ev.tone,
      outlet: OUTLETS[hashString(ev.key) % OUTLETS.length], headline, summary, paragraphs, body: paragraphs.join('\n\n'), comments, mood: Math.round(score)
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
  // 기사당 2~5개: 중요한 기사일수록 많다
  const n = clamp(2 + (ev.comments >= 2 ? 1 : 0) + (ev.comments >= 3 ? 1 : 0) + (rng() < 0.4 ? 1 : 0), 2, 5);
  const out = [];
  const myName = src.teamName(src.myTeamId);
  const offseasonKind = ev.scope === 'move' || /^(growth|retire)_/.test(ev.kind);
  for (let i = 0; i < n; i++) {
    const roll = rng();
    let type = 'mine';
    const isStar = ev.kind === 'star_points' || ev.kind === 'star_all';
    if (i > 0 && roll < 0.25 && out.some((c) => !c.replyTo)) type = 'reply';
    else if (isStar && ev.refTeam && roll > 0.55) type = 'fan';
    else if (ev.refTeam && roll > 0.8) type = 'rival';
    else if (roll > 0.88) type = 'neutral';
    let pool; let team; let replyTo;
    const vars = { ...ev.vars, team: myName };
    if (type === 'reply') {
      pool = COMMENTS.reply; const roots = out.filter((c) => !c.replyTo); const prev = roots[rng() < 0.7 ? roots.length - 1 : 0]; replyTo = prev.nick; team = prev.team === '중립' || rng() < 0.4 ? '중립' : `${myName} 팬`;
    } else if (type === 'fan') {
      pool = COMMENTS.star_fan; team = `${src.teamName(ev.refTeam)} 팬`;
    } else if (type === 'rival') {
      pool = ev.tone === 'good' ? COMMENTS.rival_good : COMMENTS.rival_bad; team = `${src.teamName(ev.refTeam)} 팬`;
    } else if (type === 'neutral') { pool = offseasonKind ? COMMENTS.move_neutral : COMMENTS.neutral; team = '중립'; }
    else {
      team = isStar && ev.starTeamId !== src.myTeamId ? '중립' : `${myName} 팬`;
      const detail = rng() < 0.35 && ev.scope === 'my' && !offseasonKind;
      if (ev.kind === 'preview') pool = rng() < 0.5 ? COMMENTS.preview : COMMENTS.preview_detail;
      else if (/^(cap_over|funds_)/.test(ev.kind)) pool = COMMENTS.finance;
      else if (ev.kind === 'injury_my') pool = COMMENTS.injury;
      else if (offseasonKind) pool = ev.playerComment && ev.tone !== 'bad' && rng() < 0.5 ? COMMENTS.player_good : ev.tone === 'good' ? COMMENTS.move_good : ev.tone === 'bad' ? COMMENTS.move_bad : COMMENTS.move_neutral;
      else if (ev.scope === 'league') pool = isStar ? (ev.starTeamId === src.myTeamId ? COMMENTS.player_good : COMMENTS.star_neutral) : COMMENTS.neutral;
      else if (detail) pool = ev.tone === 'bad' ? COMMENTS.detail_bad : COMMENTS.detail_good;
      else if (ev.playerComment && ev.tone !== 'bad' && rng() < 0.6) pool = COMMENTS.player_good;
      else if (ev.tone === 'good' && (label === '격앙' || label === '체념' || label === '불안') && rng() < 0.6) pool = COMMENTS.relief;
      else if (ev.tone === 'bad' && (label === '환호' || label === '기대') && rng() < 0.6) pool = COMMENTS.sting;
      else pool = COMMENTS[label];
    }
    const poolName = Object.keys(COMMENTS).find((k) => COMMENTS[k] === pool);
    let idx = pickIndex(pool, vars, rng, (recentC[poolName] ??= []));
    if (idx < 0) { pool = COMMENTS[label]; idx = pickIndex(pool, vars, rng, (recentC[label] ??= [])); if (idx < 0) continue; }
    let nick = NICKS[Math.floor(rng() * NICKS.length)];
    for (let k = 0; k < 6 && used.has(nick); k++) nick = NICKS[Math.floor(rng() * NICKS.length)];
    used.add(nick);
    const votes = 3 + Math.floor(rng() * rng() * 320 * (1 + ev.comments * 0.3) * (type === 'reply' ? 0.15 : 1));
    out.push({ nick, team, votes, text: fill(pool[idx], vars), ...(replyTo ? { replyTo } : {}) });
  }
  // 답글은 원 댓글 바로 아래에 붙이고, 나머지는 추천 순
  const roots = out.filter((c) => !c.replyTo).sort((a, b) => b.votes - a.votes);
  const replies = out.filter((c) => c.replyTo);
  const ordered = [];
  for (const r of roots) { ordered.push(r); for (const rp of replies.filter((x) => x.replyTo === r.nick)) ordered.push(rp); }
  for (const rp of replies) if (!ordered.includes(rp)) ordered.push(rp);
  return ordered;
}

/** 템플릿·댓글 전체 문자열(금지어 검사용) */
export function allTemplateStrings() {
  return [
    ...Object.values(TEMPLATES).flatMap((g) => [...g.h, ...g.b]), ...Object.values(SENT).flat(),
    ...Object.values(COMMENTS).flat(), ...Object.values(MOOD_DESC).flat(), ...NICKS, ...OUTLETS
  ];
}
