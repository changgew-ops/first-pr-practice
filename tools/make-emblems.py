# 사용자가 준 구단 로고 스크린샷(카드 배경 회색)에서 로고만 잘라 투명 PNG로 저장한다.
# 사용: python3 tools/make-emblems.py <스크린샷.png>  → web/assets/emblems/<구단id>.png
import sys
from PIL import Image
import numpy as np
from collections import deque

IDS = [['wonju-db', 'seoul-samsung', 'goyang-sono'], ['seoul-sk', 'changwon-lg', 'anyang-jungkwanjang'], ['busan-kcc', 'suwon-kt', 'daegu-kogas'], ['ulsan-hyundai-mobis']]
COLS = [(0, 376), (406, 786), (816, 1196)]
ROWS = [(17, 149), (179, 311), (341, 473), (503, 635)]
LOGO_W = 98  # 카드 왼쪽에서 로고가 있는 폭(버튼 앞까지)
BG = np.array([249, 249, 249])

im = Image.open(sys.argv[1]).convert('RGB')
a = np.array(im).astype(int)
for ri, row in enumerate(IDS):
    for ci, tid in enumerate(row):
        x0, x1 = COLS[ci][0], COLS[ci][0] + LOGO_W
        y0, y1 = ROWS[ri]
        reg = a[y0 + 6:y1 - 6, x0 + 4:x1]
        d = np.abs(reg - BG).sum(axis=2)
        ys, xs = np.where(d > 24)
        if not len(xs):
            print('빈 칸', tid); continue
        bx0, bx1, by0, by1 = max(0, xs.min() - 2), min(reg.shape[1], xs.max() + 3), max(0, ys.min() - 2), min(reg.shape[0], ys.max() + 3)
        crop = reg[by0:by1, bx0:bx1].copy()
        h, w = crop.shape[:2]
        dist = np.abs(crop - BG).sum(axis=2)
        # 가장자리에서 이어진 배경색 영역만 투명(로고 안쪽 흰색은 지키려고 flood fill)
        bgmask = np.zeros((h, w), bool)
        dq = deque()
        for y in range(h):
            for x in (0, w - 1):
                if dist[y, x] < 18: dq.append((y, x)); bgmask[y, x] = True
        for x in range(w):
            for y in (0, h - 1):
                if dist[y, x] < 18 and not bgmask[y, x]: dq.append((y, x)); bgmask[y, x] = True
        while dq:
            y, x = dq.popleft()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and not bgmask[ny, nx] and dist[ny, nx] < 18:
                    bgmask[ny, nx] = True; dq.append((ny, nx))
        alpha = np.where(bgmask, 0, 255).astype(np.uint8)
        # 경계의 부드러운 반투명: 배경에 가까운 경계 픽셀은 알파를 낮춘다
        edge = (~bgmask) & (dist < 90)
        # 경계 이웃 판정
        near = np.zeros((h, w), bool)
        near[1:, :] |= bgmask[:-1, :]; near[:-1, :] |= bgmask[1:, :]; near[:, 1:] |= bgmask[:, :-1]; near[:, :-1] |= bgmask[:, 1:]
        sel = edge & near
        alpha[sel] = np.clip(dist[sel] * 255 // 90, 60, 255).astype(np.uint8)
        out = np.dstack([crop.astype(np.uint8), alpha])
        Image.fromarray(out, 'RGBA').save(f'web/assets/emblems/{tid}.png')
        print(tid, (w, h))
