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

def trim(rgba):
    al = rgba[..., 3]
    ys, xs = np.where(al > 8)
    return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

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
    chars = [(cid, cut(i, g)) for cid, _, i, g in CHARS]
    boss = [(bid, cut(i)) for bid, _, i in BOSS]
    atlas, apos = pack(chars + boss, 640)
    props = [(pid, cut(i)) for pid, _, i in PROP_COMPS] + [(pid, rect(r)) for pid, _, r in PROP_RECTS]
    psheet, ppos = pack(props, 640)
    out = os.path.join(HERE, 'assets'); os.makedirs(out, exist_ok=True)
    # 용량 줄이기: 팔레트 PNG(알파 포함)
    def save(img, name):
        q = img.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(os.path.join(out, name), optimize=True)
        img.save(os.path.join(out, name.replace('.png', '.full.png')))
    save(atlas, 'atlas.png'); save(psheet, 'props.png')
    meta = {
        'atlas': {'file': 'atlas.png', 'w': atlas.width, 'h': atlas.height,
                  'chars': [{'id': cid, 'name': n, 'rect': apos[cid]} for cid, n, _, _ in CHARS],
                  'boss': [{'id': bid, 'name': n, 'rect': apos[bid]} for bid, n, _ in BOSS]},
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
