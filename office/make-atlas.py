#!/usr/bin/env python3
"""70.webp(초록 배경 캐릭터·소품 시트) → assets/atlas.png, assets/props.png, assets/atlas.json
사용: python3 office/make-atlas.py <시트 이미지 경로> (기본: office/source/sheet.webp)
컷 번호는 cutout.components 결과(위→아래, 왼→오른쪽 정렬)이고, CHARS/BOSS/PROP_COMPS는 시트를 눈으로 보고 정한 목록이다.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import cutout

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'source', 'sheet.webp')
SRC2 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'source', 'sheet2.webp')  # 전설의 포켓몬·굼바 변형이 들어 있는 두 번째 시트

# (id, 한글 이름, 컷 번호, 초록 몸 여부)
CHARS = [
    ('squirtle', '꼬부기', 64, False), ('snivy', '주리비얀', 68, True), ('turtwig', '모부기', 65, True),
    ('shaymin', '쉐이미', 25, False), ('plusle', '플러시', 26, False), ('clefairy', '삐삐', 27, False),
    ('blissey', '해피너스', 28, False), ('jirachi', '지라치', 29, False), ('charmander', '파이리', 30, False),
    ('bulbasaur', '이상해씨', 31, True), ('quaxly', '꾸왁스', 32, False), ('espeon', '에브이', 33, False),
    ('mew', '뮤', 36, False), ('eevee', '이브이', 37, False), ('gengar', '팬텀', 38, False),
    ('ditto', '메타몽', 39, False), ('oddish', '뚜벅쵸', 40, False), ('slowpoke', '야돈', 42, False),
    ('froakie', '개구마르', 43, False), ('pikachu', '피카츄', 52, False), ('chansey', '럭키', 56, False),
    ('sprigatito', '나오하', 57, True), ('togepi', '토게피', 59, False), ('oshawott', '수댕이', 69, False),
    ('cyndaquil', '브케인', 70, False), ('fennekin', '푸호꼬', 71, False), ('persian', '페르시온', 73, False),
    ('meowth', '나옹', 82, False), ('porygonz', '폴리곤Z', 83, False), ('spiky', '레이스 요정', 84, False),
    ('rowlet', '나몰빼미', 89, False), ('pikipek', '콕코구리', 85, False), ('rattata', '꼬렛', 95, False),
    ('magnemite', '코일', 98, False), ('goomba', '굼바', 14, False), ('kingboo', '부끄왕', 16, False),
]
# 사장님(뮤츠) 상반신 표정 컷: 졸음/깸/웃음/대노(+예비). 몸 전체 컷(6)은 책상 없는 구도용
BOSS = [('boss_sleep', '뮤츠 졸음', 46), ('boss_awake', '뮤츠 깸', 45), ('boss_happy', '뮤츠 웃음', 17),
        ('boss_angry', '뮤츠 대노', 47), ('boss_angry2', '뮤츠 대노2', 19), ('boss_think', '뮤츠 고민', 18), ('boss_full', '뮤츠 전신', 6)]
# 소품: 연결 성분으로 잘 잘리는 것
PROP_COMPS = [('desk_boss', '사장님 책상+모니터', 10), ('water', '정수기', 61), ('extinguisher', '소화기', 66), ('vending', '자판기', 62),
              ('coffee', '커피머신장', 63), ('plant_round', '둥근 화분', 75), ('plant_pot', '화분', 76), ('plant_bush', '관목 화분', 86),
              ('whiteboard', '차트 화이트보드', 77), ('bookshelf', '책장', 87), ('board_chart', '차트 보드', 88), ('score', '점수판', 90),
              ('sign_1f', '1F', 91), ('sign_2f', '2F', 100), ('sign_3f', '3F', 102), ('sign_4f', '4F', 103), ('sign_5f', '5F', 104), ('sign_6f', '6F', 105)]
# 소품: 좌표(x0,y0,x1,y1)로 직접 자르는 것(서로 붙어 있어 연결 성분이 합쳐지는 것들)
PROP_RECTS = [('mon_gantt', '일정 모니터', (824, 355, 930, 416)), ('mon_score', '점수 모니터', (939, 355, 1076, 416)),
              ('mon_code1', '코드 모니터 1', (824, 419, 934, 468)), ('mon_code2', '코드 모니터 2', (824, 470, 934, 533)),
              ('mon_code_big', '큰 코드 모니터', (940, 418, 1074, 531)), ('desk_tablet', '태블릿 책상', (822, 538, 936, 626)),
              ('mon_code3', '코드 모니터 3', (945, 538, 1066, 626)),
              ('rack_a', '서버랙 A', (815, 652, 860, 757)), ('rack_b', '서버랙 B', (860, 652, 922, 757)), ('rack_c', '서버랙 C', (922, 655, 967, 757)),
              ('rack_tall', '높은 서버랙', (1006, 635, 1067, 758))]

# 두 번째 시트(sheet2.webp)에서 가져오는 컷: (id, 한글 이름, 컷 번호 또는 좌표(x0,y0,x1,y1))
#  - 사장실의 전설 직원(고정 장식), 청소부 굼바(서 있기·걷기 두 장), 부끄왕
EXTRA2 = [('solgaleo', '솔가레오풍', 53), ('necrozma', '네크로즈마풍', 54),
          ('palkia', '펄기아풍', (1189, 243, 1272, 324)), ('dialga', '디아루가풍', (1276, 240, 1318, 324)),
          ('goomba_a', '굼바(정면)', 21), ('goomba_b', '굼바(걸음)', 27), ('kingboo2', '부끄왕', 23)]

def trim(rgba):
    al = rgba[..., 3]
    ys, xs = np.where(al > 8)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

UP = 2  # 캐릭터 컷은 원본(약 60~90px, AI가 그린 부드러운 그림)을 2배로 키워 두고(라인츠 + 언샤프 + 알파 가장자리 선명화) 게임이 화면 크기에 맞춰 줄여 그린다.
        # 원본을 그대로 1.3~1.6배 키워 그리던 때의 번짐이 없어진다. (2×2를 묶어 낮은 해상도 도트로 만드는 방법도 해 봤으나 눈 같은 세부가 뭉개져 채택하지 않았다)

def enhance(arr, f=UP):
    """RGBA 컷 → f배 확대. 투명 칸의 색은 가까운 불투명 색으로 채워 어두운 테두리 번짐을 막고, 가장자리 초록 기운을 눌러 준다."""
    from scipy import ndimage as ndi
    from PIL import ImageFilter, ImageEnhance
    h, w = arr.shape[:2]
    al = arr[..., 3] / 255.0
    core = al > 0.5
    fill = arr[..., :3].astype(float).copy()
    if core.any() and not core.all():
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        fill[~core] = fill[iy[~core], ix[~core]]
    # 가장자리(바깥에서 3칸 안)의 초록 번짐: 초록 성분을 빨강·파랑 중 큰 값 이하로
    dist_in = ndi.distance_transform_edt(core)
    band = core & (dist_in <= 3)
    cap = np.maximum(fill[..., 0], fill[..., 2])
    g = fill[..., 1]; sp = band & (g > cap)
    fill[..., 1][sp] = cap[sp]
    rgb = Image.fromarray(np.clip(fill, 0, 255).astype(np.uint8), 'RGB').resize((w * f, h * f), Image.LANCZOS)
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=1.6 * f / 2, percent=110, threshold=2))
    rgb = ImageEnhance.Color(rgb).enhance(1.08)
    a = Image.fromarray((al * 255).astype(np.uint8), 'L').resize((w * f, h * f), Image.LANCZOS)
    A = np.clip((np.array(a).astype(float) / 255 - 0.5) * 3.2 + 0.5, 0, 1)
    return trim(np.dstack([np.array(rgb), (A * 255).astype(np.uint8)]))

def pack(items, width):
    """items: [(id, rgba array)] → (PIL 이미지, {id: [x,y,w,h]}). 선반(shelf) 방식, 2px 여백"""
    x = y = rowh = 0; pos = {}; pad = 2
    for k, arr in items:
        h, w = arr.shape[:2]
        if x + w + pad > width: x = 0; y += rowh + pad; rowh = 0
        pos[k] = [x, y, w, h]; x += w + pad; rowh = max(rowh, h)
    H = y + rowh + pad
    sheet = Image.new('RGBA', (width, H), (0, 0, 0, 0))
    for k, arr in items:
        sheet.alpha_composite(Image.fromarray(arr), (pos[k][0], pos[k][1]))
    return sheet, pos

def main():
    a = cutout.load(SRC)
    rgb, alpha = cutout.keyed(a)
    comps = cutout.components(alpha, minpix=120, dil=3)
    comps.sort(key=lambda c: (round(c[1] / 60), c[0]))
    def cut(idx, green=False):
        x0, y0, x1, y1, mask = comps[idx]
        pad = 3
        sl = (slice(max(0, y0 - pad), y1 + pad), slice(max(0, x0 - pad), x1 + pad))
        al = np.where(mask[sl], alpha[sl], 0)
        return trim(cutout.despill(rgb[sl], al, green))
    def rect(r, green=False):
        x0, y0, x1, y1 = r
        al = alpha[y0:y1, x0:x1].copy()
        out = trim(cutout.despill(rgb[y0:y1, x0:x1], al, green))
        # 시트의 칸 테두리(연두색 선)가 사각형 가장자리에 걸려 남는 것을 지운다: 바깥 3px 고리 안의 초록 픽셀 제거
        h, w = out.shape[:2]
        ring = np.ones((h, w), bool); ring[3:-3, 3:-3] = False
        g = out[..., 1].astype(int); m = np.maximum(out[..., 0], out[..., 2]).astype(int)
        out = out.copy(); out[ring & (g > m + 25), 3] = 0
        return trim(out)
    # 두 번째 시트
    a2 = cutout.load(SRC2); rgb2, alpha2 = cutout.keyed(a2)
    comps2 = cutout.components(alpha2, minpix=120, dil=3)
    comps2.sort(key=lambda c: (round(c[1] / 60), c[0]))
    def cut2(idx):
        x0, y0, x1, y1, mask = comps2[idx]; pad = 3
        sl = (slice(max(0, y0 - pad), y1 + pad), slice(max(0, x0 - pad), x1 + pad))
        al = np.where(mask[sl], alpha2[sl], 0)
        return trim(cutout.despill(rgb2[sl], al, False))
    def rect2(r):
        x0, y0, x1, y1 = r
        al = alpha2[y0:y1, x0:x1].copy()
        out = trim(cutout.despill(rgb2[y0:y1, x0:x1], al, False))
        h, w = out.shape[:2]; ring = np.ones((h, w), bool); ring[3:-3, 3:-3] = False
        g = out[..., 1].astype(int); m = np.maximum(out[..., 0], out[..., 2]).astype(int)
        out = out.copy(); out[ring & (g > m + 25), 3] = 0
        return trim(out)
    extra = [(eid, enhance(rect2(c) if isinstance(c, tuple) else cut2(c))) for eid, _, c in EXTRA2]
    chars = [(cid, enhance(cut(i, g))) for cid, _, i, g in CHARS]
    boss = [(bid, enhance(cut(i))) for bid, _, i in BOSS]
    atlas, apos = pack(chars + boss + extra, 1280)
    props = [(pid, cut(i)) for pid, _, i in PROP_COMPS] + [(pid, rect(r)) for pid, _, r in PROP_RECTS]
    psheet, ppos = pack(props, 640)
    out = os.path.join(HERE, 'assets'); os.makedirs(out, exist_ok=True)
    # 용량 줄이기: 팔레트 PNG(알파 포함)
    def save(img, name):
        q = img.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(os.path.join(out, name), optimize=True)
    atlas.save(os.path.join(out, 'atlas.png'), optimize=True); save(psheet, 'props.png')
    meta = {
        'atlas': {'file': 'atlas.png', 'w': atlas.width, 'h': atlas.height, 'up': UP,
                  'chars': [{'id': cid, 'name': n, 'rect': apos[cid]} for cid, n, _, _ in CHARS],
                  'boss': [{'id': bid, 'name': n, 'rect': apos[bid]} for bid, n, _ in BOSS],
                  'extra': [{'id': eid, 'name': n, 'rect': apos[eid]} for eid, n, _ in EXTRA2]},
        'props': {'file': 'props.png', 'w': psheet.width, 'h': psheet.height,
                  'items': [{'id': pid, 'name': n, 'rect': ppos[pid]} for pid, n, _ in PROP_COMPS] + [{'id': pid, 'name': n, 'rect': ppos[pid]} for pid, n, _ in PROP_RECTS]}}
    # 점수판: 숫자 자리(그림에 구워진 "6 1 0 62")를 찾아 게임이 위에 칠하고 실제 숫자를 쓸 수 있게 위치를 적는다
    sx, sy, sw, sh = ppos['score']
    arr = np.array(psheet.convert('RGBA')).astype(int)[sy:sy + sh, sx:sx + sw]
    bright = (arr[..., 0] > 190) & (arr[..., 1] > 190) & (arr[..., 2] > 170) & (arr[..., 3] > 200); bright[:int(sh * 0.62)] = False
    ys, xs = np.where(bright); cols = np.where(bright.any(axis=0))[0]; groups = []; st = pp = cols[0]
    for c in cols[1:]:
        if c - pp > 6: groups.append((int(st), int(pp))); st = c
        pp = c
    groups.append((int(st), int(pp)))
    panel = [int(v) for v in arr[int(ys.min()) - 3, 5][:3]]
    for it in meta['props']['items']:
        if it['id'] == 'score': it['numbers'] = {'y': [int(ys.min()), int(ys.max())], 'cols': groups, 'panel': panel}
    json.dump(meta, open(os.path.join(out, 'atlas.json'), 'w', encoding='utf8'), ensure_ascii=False)
    print('chars', len(CHARS), 'boss', len(BOSS), 'props', len(props), 'atlas', atlas.size, 'props', psheet.size)

if __name__ == '__main__':
    main()
