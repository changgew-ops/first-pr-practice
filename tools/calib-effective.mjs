// 유효 전력 환산값 qPerPower 재보정: 구단 편성의 (공격+수비) 점수를 기본 전력으로 회귀한 기울기를 구한다(8시즌×10구단). 결과 "Q per power"를 data/league-rules.json effective.qPerPower에 넣는다.
import { readFileSync } from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const imp=(p)=>import(`${root}/${p}`);
const { createLeague, playLeagueYear } = await imp('src/league.mjs'); const { mulberry32 } = await imp('src/rng.mjs'); const { loadHistory } = await imp('src/history.mjs');
const { buildLineup } = await imp('src/lineup.mjs'); const { teamRatings } = await imp('src/game.mjs');
const read=(p)=>JSON.parse(readFileSync(`${root}/data/${p}`,'utf8'));
const rules=read('league-rules.json'),teams=read('teams.json'),players=read('players.json');
const pow=(l)=>{const s=(a)=>a.reduce((x,p)=>x+p.ovr,0);return s(l.starters)/l.starters.length*0.7+s(l.bench)/l.bench.length*0.3;};
const xs=[],ys=[]; const rng=mulberry32(5); let league=createLeague(players,rules,{history:loadHistory(),teamData:teams});
for(let y=0;y<8;y++){ for(const t of teams){ const l=buildLineup(league.players.filter(p=>p.teamId===t.id),rules,rules.simulation.benchWeight); const r=teamRatings(l,rules.simulation); xs.push(pow(l)); ys.push(r.offense+r.defense);} league=playLeagueYear(league,teams,rules,rng,{}).league; }
const mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;
let c=0,v=0; xs.forEach((x,i)=>{c+=(x-mx)*(ys[i]-my);v+=(x-mx)**2;});
const slope=c/v; console.log('n',xs.length,'Q per power',slope.toFixed(3),'ratingScale',rules.simulation.ratingScale,'points per power',(slope*rules.simulation.ratingScale).toFixed(3));
