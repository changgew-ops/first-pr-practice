// 팀 이력 조회: data/history/seasons.json, franchises.json 을 읽고 구단별 요약을 만든다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../data/history');

export function loadHistory(dir = DATA) {
  return {
    seasons: JSON.parse(readFileSync(join(dir, 'seasons.json'), 'utf8')),
    franchises: JSON.parse(readFileSync(join(dir, 'franchises.json'), 'utf8'))
  };
}

export { champions, franchiseSummary, recentForm } from './history-summary.mjs';
