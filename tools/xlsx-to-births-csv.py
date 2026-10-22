#!/usr/bin/env python3
"""KBL 선수 출생연도 xlsx(선수번호·생년월일 원문 포함) → data/players/births.csv.
  python3 -I tools/xlsx-to-births-csv.py <xlsx> [--out data/players/births.csv]
첫 시트(선수검색 명단)와 '추가 확인 대상' 시트를 합친다. 생년월일은 '원본 및 안내' 시트의 원문(YYYYMMDD)을 쓰고,
수식으로 계산된 출생연도 칸은 읽지 않는다. 날짜가 비어 있으면 빈 칸으로 둔다(추정하지 않는다)."""
import sys, csv, datetime
import openpyxl

args = sys.argv[1:]
out = 'data/players/births.csv'
if '--out' in args:
    i = args.index('--out'); out = args[i + 1]; del args[i:i + 2]
wb = openpyxl.load_workbook(args[0], data_only=False)

raw = {}
for r in wb['원본 및 안내'].iter_rows(min_row=11, values_only=True):
    if r[0] is None: continue
    raw[str(r[0])] = dict(nameEn=(r[2] or '').strip(), rawBirth=(str(r[9]).strip() if r[9] is not None else ''))

rows = []
for sheet, group, first in (('선수 출생연도', 'main', 10), ('추가 확인 대상', 'extra', 8)):
    for r in wb[sheet].iter_rows(min_row=first, values_only=True):
        if r[0] is None: continue
        no = str(r[4])
        d = r[2]
        birth = d.strftime('%Y-%m-%d') if isinstance(d, (datetime.datetime, datetime.date)) else ''
        rb = raw.get(no, {}).get('rawBirth', '')
        if birth and rb and rb.replace('-', '') != birth.replace('-', ''):
            sys.exit(f'생년월일 불일치 {no} {r[0]}: {birth} vs 원문 {rb}')
        note = r[7] or ''
        if rb and not birth:  # 달력에 없는 날짜(원문 오류)는 값으로 쓰지 않고 원문을 남긴다
            note = (note + '; ' if note else '') + f'생년월일 원문 오류 {rb}'
            print(f'  원문 오류: {no} {r[0]} {rb}')
        rows.append(dict(playerNo=no, name=r[0], nameEn=raw.get(no, {}).get('nameEn', ''), kind={'국내': 'domestic', '외국': 'foreign', '아시아쿼터': 'asia'}.get(r[3], r[3]),
                         team=(r[5] or ''), birth=birth, status=r[6] or '', note=note, list=group))

with open(out, 'w', newline='', encoding='utf-8') as f:
    f.write('# KBL 공식 선수 프로필 API에서 수집한 생년월일(사용자 제공 xlsx, 2026-10-23). team은 기록상 구단 표기(현재/과거, 전체 경력 아님). list=extra는 공식 선수검색 명단에 없던 번호.\n')
    w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator='\n')
    w.writeheader(); w.writerows(rows)
print(f'{len(rows)}행 → {out}  (생년월일 있음 {sum(1 for r in rows if r["birth"])})')
