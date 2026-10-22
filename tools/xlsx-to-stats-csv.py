#!/usr/bin/env python3
"""KBL 기록실 "누적 기준" 엑셀 시트 → data/stats CSV (선수별 시즌 합계).

사용법:  python3 tools/xlsx-to-stats-csv.py <엑셀 파일> <시트 이름> <출력 CSV>
예:      python3 tools/xlsx-to-stats-csv.py 기록.xlsx 25-26 data/stats/2025-26.csv

- 출전 시간(MIN)은 엑셀이 "분:초"를 "시:분"으로 읽은 값이라, 시 부분을 분, 분 부분을 초로 되돌린다.
- 같은 이름의 선수가 둘 이상이면 이름 뒤에 (1), (2)를 붙인다(시트 순서 기준). 팀을 알게 되면 로스터 CSV에서 이름을 바꿔 쓴다.
- 읽은 값은 변환 직후 검증한다: 득점 = 2점×2 + 3점×3 + 자유투, 리바운드 = 공격 + 수비, 야투 = 2점 + 3점, 승 + 패 = 경기 수.
  하나라도 어긋나면 어느 선수인지 알려주고 멈춘다.
- openpyxl 이 필요하다 (pip install openpyxl).
"""
import collections
import csv
import datetime
import sys

import openpyxl

# 시트 컬럼 → CSV 컬럼
COLUMNS = [
    ('GP', 'games'), ('MIN', 'minutes'), ('PTS', 'pts'), ('REB', 'reb'), ('AST', 'ast'), ('STL', 'stl'), ('BLK', 'blk'),
    ('FGM', 'fgm'), ('FGA', 'fga'), ('3PM', 'tpm'), ('3PA', 'tpa'), ('FTM', 'ftm'), ('FTA', 'fta'),
    ('OREB', 'oreb'), ('DREB', 'dreb'), ('TO', 'to'), ('PF', 'pf'), ('GD', 'gd'), ('DK', 'dk'), ('DKA', 'dka'),
    ('PP', 'pp'), ('PPA', 'ppa'), ('+/-', '+/-'), ('DD2', 'dd2'), ('TD3', 'td3'), ('SAST', 'sast'), ('DFL', 'dfl'),
    ('W', 'w'), ('L', 'l'),
]


def to_minutes(v):
    if isinstance(v, datetime.timedelta):
        s = int(v.total_seconds())
        return s // 3600 + ((s % 3600) // 60) / 60
    if isinstance(v, datetime.time):
        return v.hour + v.minute / 60 + v.second / 3600
    return float(v)


def read_sheet(path, sheet):
    ws = openpyxl.load_workbook(path, data_only=True)[sheet]
    header, rows = None, []
    for r in ws.iter_rows(values_only=True):
        if r and '팀/선수' in r:
            header = list(r)
            continue
        if header and any(v is not None for v in r):
            d = {h: r[i] for i, h in enumerate(header) if h and h != '#'}
            d['MIN'] = to_minutes(d['MIN'])
            rows.append(d)
    return rows


def check(d):
    errs = []
    if 2 * d['2PM'] + 3 * d['3PM'] + d['FTM'] != d['PTS']:
        errs.append('득점 합이 맞지 않음')
    if d['OREB'] + d['DREB'] != d['REB']:
        errs.append('리바운드 합이 맞지 않음')
    if d['2PM'] + d['3PM'] != d['FGM'] or d['2PA'] + d['3PA'] != d['FGA']:
        errs.append('야투 합이 맞지 않음')
    if d['W'] + d['L'] != d['GP']:
        errs.append('승+패가 경기 수와 다름')
    if d['GP'] > 0 and d['MIN'] <= 0:
        errs.append('출전 시간이 0')
    return errs


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    path, sheet, out = sys.argv[1:]
    rows = read_sheet(path, sheet)
    names = collections.Counter(d['팀/선수'] for d in rows)
    seen = collections.Counter()
    bad = []
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['name'] + [c for _, c in COLUMNS])
        for d in rows:
            name = d['팀/선수']
            if names[name] > 1:
                seen[name] += 1
                name = f'{name}({seen[name]})'
            errs = check(d)
            if errs:
                bad.append((name, errs))
            w.writerow([name] + [round(d[s], 2) if s == 'MIN' else d[s] for s, _ in COLUMNS])
    dup = [n for n, c in names.items() if c > 1]
    print(f'{len(rows)}명 → {out}' + (f' (같은 이름 {len(dup)}개: {", ".join(dup)} → (1),(2)로 구분)' if dup else ''))
    if bad:
        sys.exit('검증 실패:\n' + '\n'.join(f'  {n}: {", ".join(e)}' for n, e in bad))
    print('검증 통과 (득점·리바운드·야투 합, 승+패=경기 수, 출전 시간)')


if __name__ == '__main__':
    main()
