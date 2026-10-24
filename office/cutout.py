# 70.webp(초록 배경 시트) → 알파 컷아웃 + 연결 성분 분리. make-atlas.py가 불러 쓴다.
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BG = np.array([52, 251, 39], float)

def load(path):
    return np.array(Image.open(path).convert('RGB')).astype(float)

def grid_mask(a, minrun=40):
    """격자선(어두운 초록 1~2px 가로·세로 긴 선)을 찾는다."""
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    line = (r < 45) & (g > 120) & (g < 215) & (b < 45)
    out = np.zeros(line.shape, bool)
    # 가로 run
    for y in range(line.shape[0]):
        row = line[y]
        if row.sum() < minrun: continue
        lab, n = ndi.label(row)
        for i in range(1, n + 1):
            xs = np.where(lab == i)[0]
            if len(xs) >= minrun: out[y, xs.min():xs.max() + 1] = True
    for x in range(line.shape[1]):
        col = line[:, x]
        if col.sum() < minrun: continue
        lab, n = ndi.label(col)
        for i in range(1, n + 1):
            ys = np.where(lab == i)[0]
            if len(ys) >= minrun: out[ys.min():ys.max() + 1, x] = True
    return ndi.binary_dilation(out, iterations=1)

def keyed(a):
    """RGB → (rgb 배경색 섞임 제거, alpha). 초록 배경·격자선을 투명으로."""
    grid = grid_mask(a)
    dist = np.linalg.norm(a - BG, axis=-1)
    alpha = np.clip((dist - 38) / 70, 0, 1)
    alpha[grid] = 0
    # 격자선 주변 번짐: 선에서 2px 이내의 어두운 초록은 배경 처리
    near = ndi.binary_dilation(grid, iterations=2)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    spillish = (g - np.maximum(r, b) > 60) & (g < 215)
    alpha[near & spillish] = 0
    rgb = a.copy()
    # 부분 투명 픽셀: 배경색 섞임 제거(unmix)
    m = (alpha > 0) & (alpha < 1)
    al = np.maximum(alpha, 1e-3)[..., None]
    un = (a - (1 - al) * BG) / al
    rgb[m] = np.clip(un[m], 0, 255)
    return rgb, alpha

def despill(rgb, alpha, green_sprite):
    """컷 하나의 번짐 제거. 초록 몸 캐릭터(green_sprite)는 바깥 2px만 안쪽 색으로 바꾸고, 나머지는 윤곽 8px 안의 초록 성분을 눌러 없앤다."""
    rgb = rgb.copy()
    inside = alpha > 0.2
    dist_out = ndi.distance_transform_edt(inside)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if green_sprite:
        core = inside & (dist_out > 2)
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        band = inside & (dist_out <= 2) & (g > np.maximum(r, b) + 30)
        rgb[band] = rgb[iy[band], ix[band]]
    else:
        band = inside & (dist_out <= 10)
        cap = np.maximum(r, b) + 4
        sp = band & (g > cap)
        rgb[..., 1][sp] = cap[sp]
    al = alpha.copy()
    al = np.where(dist_out <= 1, 0, al)
    return np.dstack([np.clip(rgb, 0, 255), al * 255]).astype(np.uint8)

def components(alpha, minpix=60, dil=2):
    """알파가 있는 덩어리를 연결 성분으로 나눈다(작은 틈은 dil만큼 팽창해 한 덩어리로). 반환: [(x0,y0,x1,y1,mask)]"""
    solid = alpha > 0.3
    solid = ndi.binary_opening(solid, iterations=1)
    big = ndi.binary_dilation(solid, iterations=dil)
    lab, n = ndi.label(big, structure=np.ones((3, 3)))
    objs = ndi.find_objects(lab)
    res = []
    for i, sl in enumerate(objs, 1):
        y0, y1 = sl[0].start, sl[0].stop; x0, x1 = sl[1].start, sl[1].stop
        m = (lab[sl] == i) & ndi.binary_dilation(solid[sl], iterations=dil)
        if (solid[sl] & (lab[sl] == i)).sum() < minpix: continue
        res.append((x0, y0, x1, y1, lab == i))
    return res
