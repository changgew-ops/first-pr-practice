#!/usr/bin/env python3
"""KBL 선수기록 화면 녹화(프레임 이미지)에서 선수별 팀 아이콘을 읽어 소속 CSV를 만든다.

사용법:
  ffmpeg -i 녹화.mp4 -vf fps=2 frames/f%03d.png
  node tools/team-totals.mjs 2023-24 > totals.json
  python3 tools/read-team-icons.py --stats data/stats/2023-24.csv --frames 'frames/f*.png' --first-page 1 --totals totals.json --out data/players/team-2023-24.csv

가정
- 화면은 PTS 순(누적, 1차 스탯)이고 한 페이지가 20명이다. 같은 득점은 이름 순으로 정렬된다(25-26·24-25에서 확인).
- 녹화는 --first-page 부터 한 페이지씩 앞으로 넘긴다. 프레임을 화면 내용이 바뀌는 곳에서 나눠 페이지 순서로 센다.
- 아이콘은 data/players/icon-templates.json(2023-24 이후 로고)과 가장 가까운 것으로 판정한다. 구단 로고가 시즌마다 바뀌므로(2022-23은 캐롯·옛 KGC·전주 KCC)
  `--cluster`를 주면 이 시즌 아이콘을 10묶음으로 나눈 뒤 승·패 한도로 묶음 ↔ 구단을 짝지어(scipy 필요) 시즌별 템플릿 `data/players/icon-templates-<시즌>.json`을 저장한다.
  이후에는 `--templates <그 파일>`로 같은 판독을 다시 할 수 있다.
검증
- 선수가 뛴 경기의 팀 승·패가 구단 시즌 합계(정규리그+플레이오프, --totals)를 넘으면 표시한다. 시즌 중 이적한 선수는 한 구단 한도를 넘어 걸리며(아이콘은 마지막 소속), 판독 오류도 여기서 걸린다.
"""
import argparse, csv, glob, json, os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
base = lambda n: re.sub(r'\(\d+\)$', '', n)


def load_templates():
    j = json.load(open(os.path.join(ROOT, 'data/players/icon-templates.json'), encoding='utf-8'))
    return {t: np.array(v) for t, v in j['templates'].items()}


def colored(a):
    return (a.max(2) - a.min(2)) > 60


def is_table(a):
    """표가 다 떴는지: 아이콘 열에 색 있는 행이 많아야 한다(로딩 중이면 스피너와 푸터뿐)."""
    m = colored(a)[170:, 30:200]
    return m.sum() > 250  # 마지막 페이지는 행이 적어도 된다. 로딩 스피너는 가운데에 있어 이 띠에 색이 없다


def locate(a):
    """아이콘 열 x와 첫 행 y를 찾는다. 행 간격은 36px."""
    m = colored(a)
    H = m.shape[0]
    prof = m[170:, :220].sum(0).astype(float)
    win = np.convolve(prof, np.ones(24), 'valid')
    x = int(win.argmax() + 12)
    band = m[:, x - 12:x + 12].sum(1).astype(float)
    best, y0 = -1, None
    for cand in range(150, 300):
        ys = [cand + 36 * k for k in range(20)]
        if ys[-1] + 12 >= H:
            ys = [y for y in ys if y + 12 < H]  # 마지막 페이지처럼 화면이 짧은 경우
        sc = sum(band[y - 8:y + 8].sum() for y in ys) - 0.0 * len(ys)
        if sc > best:
            best, y0 = sc, cand
    return x, y0


def crop(im, x, y):
    """아이콘 영역에서 흰 배경이 아닌 부분의 외곽 상자를 잘라 16x16으로 줄인다(녹화마다 화면 배율이 달라 크기를 맞춘다)."""
    box = im.crop((x - 13, y - 13, x + 13, y + 13))
    a = np.asarray(box, dtype=int)
    mask = (255 - a.min(2)) > 40
    ys, xs = np.where(mask)
    if len(ys) < 10:
        return np.zeros(16 * 16 * 3)
    box = box.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    return np.asarray(box.resize((16, 16), Image.LANCZOS), dtype=float).ravel()


def cluster_templates(X, names, rows_by_name, totals, k=10, restarts=200):
    """아이콘을 k묶음으로 나누고(k-means++) 묶음 ↔ 구단을 승·패 한도로 짝짓는다. 반환: {구단: 묶음 평균 벡터}"""
    from scipy.optimize import linear_sum_assignment
    rng = np.random.default_rng(0)
    teams = list(totals)
    best = None
    for _ in range(restarts):
        C = [X[rng.integers(len(X))]]
        for _ in range(k - 1):
            d = np.min([((X - c) ** 2).sum(1) for c in C], axis=0)
            C.append(X[rng.choice(len(X), p=d / d.sum())])
        C = np.array(C)
        for _ in range(60):
            lab = ((X[:, None] - C[None]) ** 2).sum(2).argmin(1)
            C = np.array([X[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        inertia = ((X - C[lab]) ** 2).sum()
        if best is None or inertia < best[2]:
            best = (lab, C, inertia)
    lab, C, _ = best
    WL = np.array([[rows_by_name[n]['w'], rows_by_name[n]['l']] for n in names])
    cost = np.zeros((k, len(teams)))
    for j in range(k):
        ws = WL[lab == j]
        for t, tn in enumerate(teams):
            viol = ((ws[:, 0] > totals[tn]['w']) | (ws[:, 1] > totals[tn]['l'])).sum()
            top = lambda col: np.sort(ws[:, col])[-3:].mean()
            slack = (totals[tn]['w'] - top(0)) + (totals[tn]['l'] - top(1)) if len(ws) >= 3 else 50
            cost[j, t] = viol * 100 + max(slack, 0)  # 한도를 넘는 선수는 시즌 중 이적자일 수 있어 벌점만 준다
    rr, cc = linear_sum_assignment(cost)
    print('묶음 크기: ' + ', '.join(str(int((lab == j).sum())) for j in range(k)), file=sys.stderr)
    return {teams[t]: C[j] for j, t in zip(rr, cc)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stats', required=True)
    ap.add_argument('--frames', required=True, action='append', help='프레임 glob (여러 번 쓰면 이어 붙인다)')
    ap.add_argument('--first-page', type=int, default=1)
    ap.add_argument('--totals', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cluster', action='store_true', help='이 시즌 아이콘을 묶어 구단을 짝짓고 시즌별 템플릿을 저장한다')
    ap.add_argument('--templates', help='시즌별 템플릿 JSON(--cluster가 만든 것)')
    ap.add_argument('--season', help='시즌 이름(예: 2024-25). 있으면 data/players/team-overrides.csv의 정정값을 적용한다')
    ap.add_argument('--append', action='store_true', help='기존 출력 CSV에 없는 선수만 덧붙인다')
    ap.add_argument('--diff', type=float, default=1.5, help='페이지가 바뀌었다고 볼 변한 픽셀 비율(%%)')
    args = ap.parse_args()

    totals = json.load(open(args.totals))
    T = load_templates()
    if args.templates:
        T = {t: np.array(v) for t, v in json.load(open(args.templates, encoding='utf-8'))['templates'].items()}
    rows = list(csv.DictReader(open(args.stats, encoding='utf-8')))
    for r in rows:
        for k in ('pts', 'w', 'l'):
            r[k] = float(r[k])
    srt = sorted(rows, key=lambda r: (-r['pts'], base(r['name'])))

    files = sorted(sum((glob.glob(g) for g in args.frames), []))
    expected = -(-len(srt) // 20) - args.first_page + 1  # 통계 시트의 선수 수로 계산한 남은 페이지 수
    loaded = []
    for f in files:
        im = Image.open(f).convert('RGB')
        if is_table(np.asarray(im).astype(int)):
            loaded.append((f, np.asarray(im.convert('L').resize((300, 400)), dtype=float)))

    def split(threshold):
        groups, cur, last = [], [], None
        for f, sig in loaded:
            # 페이지가 넘어가면 표의 숫자가 거의 다 바뀐다. 마우스 커서나 로딩 깜빡임은 일부 픽셀만 바꾼다
            if last is not None and (np.abs(sig - last) > 40).mean() * 100 > threshold:
                groups.append(cur); cur = []
            cur.append(f); last = sig
        if cur:
            groups.append(cur)
        return groups

    groups = split(args.diff)
    for th in (1.0, 0.6, 0.35, 0.2):  # 마지막 페이지처럼 행이 적은 화면은 변화가 작아 못 가를 수 있다
        if len(groups) >= expected:
            break
        groups = split(th)
    print(f'프레임 {len(files)}개 → 페이지 {len(groups)}개 (첫 페이지 {args.first_page}, 기대 {expected})', file=sys.stderr)
    if len(groups) != expected:
        print('경고: 페이지 수가 기대와 다릅니다. --first-page와 녹화 범위를 확인하세요.', file=sys.stderr)

    pages = []
    for gi, g in enumerate(groups):
        im = Image.open(g[-1]).convert('RGB')
        x, y0 = locate(np.asarray(im).astype(int))
        pages.append((gi, g[-1], im, x, y0))
    if args.cluster:
        X, names = [], []
        for gi, f, im, x, y0 in pages:
            for i in range(20):
                idx = (args.first_page - 1 + gi) * 20 + i
                if idx >= len(srt):
                    break
                X.append(crop(im, x, y0 + 36 * i)); names.append(srt[idx]['name'])
        T = cluster_templates(np.array(X), names, {r['name']: r for r in srt}, totals)
        out_t = os.path.join(ROOT, f'data/players/icon-templates-{args.season}.json')
        json.dump({'size': 16, 'note': f'{args.season} 시즌 아이콘 묶음 평균(승·패 한도로 구단 지정). tools/read-team-icons.py --cluster가 만든다', 'templates': {t: [round(float(v), 1) for v in vec] for t, vec in T.items()}}, open(out_t, 'w'))
        print(f'→ {out_t}', file=sys.stderr)

    assign, flags = {}, []
    for gi, g in enumerate(groups):
        page = args.first_page + gi
        f = g[-1]
        im = Image.open(f).convert('RGB')
        x, y0 = locate(np.asarray(im).astype(int))
        for i in range(20):
            idx = (page - 1) * 20 + i
            if idx >= len(srt):
                break
            r = srt[idx]
            v = crop(im, x, y0 + 36 * i)
            d = sorted(((v - T[t]) ** 2).sum() for t in T), min(T, key=lambda t: ((v - T[t]) ** 2).sum())
            team = d[1]
            ratio = d[0][0] / d[0][1]
            tot = totals[team]
            viol = r['w'] > tot['w'] or r['l'] > tot['l']
            assign[r['name']] = team
            if viol or ratio > 0.8:
                flags.append((r['name'], page, i + 1, team, int(r['w']), int(r['l']), 'W/L 한도 초과(시즌 중 이적 또는 오독)' if viol else f'판별 여유 작음 {ratio:.2f}'))
        print(f'  {page}페이지: 프레임 {f} (x={x}, y0={y0})', file=sys.stderr)

    # 사람이 확인해 바로잡은 값(나무위키 FA·트레이드 기록 등)은 판독보다 우선한다
    ov_path = os.path.join(ROOT, 'data/players/team-overrides.csv')
    if args.season and os.path.exists(ov_path):
        for r in csv.DictReader(l for l in open(ov_path, encoding='utf-8') if l.strip() and not l.startswith('#')):
            if r['season'] == args.season and r['name'] in assign:
                assign[r['name']] = r['team']

    existing = {}
    if args.append and os.path.exists(args.out):
        for l in open(args.out, encoding='utf-8').read().splitlines():
            if l and not l.startswith('#') and l != 'name,team':
                n, t = l.split(',')[:2]; existing[n] = t
    merged = {**assign, **existing} if args.append else assign
    with open(args.out, 'w', encoding='utf-8') as fo:
        fo.write(f'# {os.path.basename(args.stats)} 시즌 소속(선수기록 화면의 팀 아이콘 판독). 시즌 중 이적한 선수는 마지막 소속이다\nname,team\n')
        for n, t in merged.items():
            fo.write(f'{n},{t}\n')
    print(f'{len(assign)}명 판독 → {args.out} (총 {len(merged)}명)')
    for n, p, i, t, w, l, why in flags:
        print(f'  확인: {n} ({p}페이지 {i}번째) {t} {w}-{l}  {why}')


if __name__ == '__main__':
    main()
