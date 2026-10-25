#!/usr/bin/env python3
"""초록 배경 캐릭터·소품 시트(source/sheet~sheet4.webp) → assets/atlas.png, assets/props.png, assets/atlas.json
사용: python3 office/make-atlas.py   (인자 없이 한 번에 재생성)
컷 번호는 cutout.components 결과(위→아래, 왼→오른쪽 정렬)이고, CHARS/BOSS/PROP_COMPS 등은 시트를 눈으로 보고 정한 목록이다.
'sN' 표기는 시트 번호(s1=sheet, s2=sheet2, s3=sheet3, s4=sheet4)이고, 컷 번호 또는 좌표(x0,y0,x1,y1)를 쓴다.
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image
import cutout

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'source', 'sheet.webp')
SRC2 = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'source', 'sheet2.webp')  # 전설의 포켓몬·굼바 변형이 들어 있는 두 번째 시트
SRC3 = os.path.join(HERE, 'source', 'sheet3.webp')                                         # 세 번째 시트(76.webp): 루나아라·아르세우스·제크로무·카멕·키노피오·잉어킹·신규 직원 종이 있다
SRC4 = os.path.join(HERE, 'source', 'sheet4.webp')                                         # 네 번째 시트(78.webp): 팝고래·뜨아거 등 신규 종과 사무 소품이 있다

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
# 사장님(뮤츠): 전신 컷(sheet3 맨 윗줄 4컷 = 같은 자세, 표정만 다름). 상태별로 표정이 맞는 컷을 배정하고, 같은 캔버스(같은 크기·바닥 중앙 기준)에 맞춘다.
#  sheet3 컷 10 = 차분히 눈 뜸(깸·전신), 11 = 눈을 반쯤 감음(졸음), 12 = 눈썹 올리고 눈 뜸(웃음·들뜸), 13 = 찌푸린 눈(대노). 컷 43("Legendary" 칸) = 팔을 내린 다른 자세(고민).
BOSS = [('boss_sleep', '뮤츠 졸음', ('s3', 11)), ('boss_awake', '뮤츠 깸', ('s3', 10)), ('boss_happy', '뮤츠 웃음', ('s3', 12)),
        ('boss_angry', '뮤츠 대노', ('s3', 13)), ('boss_angry2', '뮤츠 대노2', ('s3', 13)), ('boss_think', '뮤츠 고민', ('s3', 43)), ('boss_full', '뮤츠 전신', ('s3', 10))]
BOSS_SAME = ('boss_sleep', 'boss_awake', 'boss_happy', 'boss_angry', 'boss_angry2', 'boss_full')   # 같은 캔버스 크기·바닥 기준으로 맞춘다
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

# 건물 직원·장식 컷(extra): (id, 한글 이름, (시트, 컷 번호 또는 좌표(x0,y0,x1,y1)))
#  - 사장실의 전설 직원(고정 장식), 청소부 굼바(서 있기·걷기 두 장), 부끄왕, 카멕, 휴게실 소품(키노피오·뻐끔플라워·잉어킹)
#  - 디아루가: 예전 컷(sheet2 좌표 컷)은 오른쪽이 옆 칸 의자에 가려 잘렸다 → sheet3 "Legendary" 영역의 온전한 컷(좌표)으로 교체.
#    펄기아: sheet3의 것은 오른쪽(꼬리)이 칸 경계에서 잘려 있어 sheet2의 온전한 컷을 그대로 쓴다(sheet4 것과 같은 그림)
#  - 루나아라·아르세우스·제크로무(기라티나 자리)·카멕: sheet3 "Legendary Pokémon Employees" / "Mario Characters" 영역
EXTRA = [('solgaleo', '솔가레오풍', ('s2', 53)), ('necrozma', '네크로즈마풍', ('s2', 54)),
         ('palkia', '펄기아풍', ('s2', (1189, 243, 1272, 324))), ('dialga', '디아루가풍', ('s3', (824, 462, 920, 557))),
         ('goomba_a', '굼바(정면)', ('s2', 21)), ('goomba_b', '굼바(걸음)', ('s2', 27)), ('kingboo2', '부끄왕', ('s2', 23)),
         ('lunala', '루나아라', ('s3', 47)), ('arceus', '아르세우스', ('s3', 61)), ('zekrom', '제크로무', ('s3', 58)), ('kamek', '카멕', ('s3', 21)),
         ('toad', '키노피오', ('s3', 23)), ('piranha', '뻐끔플라워(화분)', ('s3', (983, 124, 1064, 206))), ('magikarp', '잉어킹', ('s3', 84))]
# 에이전트 종 추가(CHARS 뒤에 이어 붙인다 — SPR 인덱스가 순서에 의존하므로 기존 순서는 바꾸지 않는다): (id, 한글 이름, (시트, 컷), 초록 몸 여부)
NEWCHARS = [('psyduck', '고라파덕(책상)', ('s3', 73), False), ('machamp', '근육몬', ('s3', (104, 550, 193, 650)), False),
            ('golem', '딱구리', ('s3', (194, 550, 286, 650)), False), ('magneton', '레어코일', ('s3', (287, 552, 370, 650)), False),
            ('lucario_desk', '루카리오(책상)', ('s3', (371, 552, 461, 650)), False), ('rotom_a', '로토무(렌즈)', ('s3', 76), True),
            ('gardevoir', '가디안', ('s3', 77), False), ('rotom_b', '로토무(집게)', ('s3', 78), True), ('rotom_c', '로토무(파랑 렌즈)', ('s3', 79), True),
            ('vaporeon', '샤미드', ('s3', 83), False), ('sylveon', '님피아', ('s3', 85), False), ('lucario', '루카리오', ('s3', 86), False),
            ('garchomp', '한카리아스', ('s3', 87), False), ('arcanine', '윈디(가디 진화형)', ('s3', (549, 657, 639, 757)), False),
            ('popplio', '누리공', ('s4', 96), True), ('fuecoco', '뜨아거', ('s4', 97), True), ('grookey', '흥나숭', ('s4', 98), True),
            ('scorbunny', '염버니', ('s4', 99), False), ('sobble', '울머기', ('s4', 100), False), ('sudowoodo', '꼬지모', ('s4', 103), False),
            ('smeargle', '루브도', ('s4', 104), False)]
# 소품 추가(sheet4): (id, 한글 이름, (시트, 컷 번호 또는 좌표))
PROP_NEW = [('chair_red', '빨간 의자', ('s4', 89)), ('chair_blue', '파란 의자', ('s4', 90)), ('chair_black', '검정 의자', ('s4', 106)),
            ('bonsai_a', '분재 A', ('s4', 91)), ('bonsai_b', '분재 B', ('s4', 92)), ('bonsai_c', '분재 C', ('s4', 93)), ('aloe', '알로에 화분', ('s4', 94)),
            ('desk_l', 'ㄱ자 책상', ('s4', 107)), ('desk_gray', '회색 책상', ('s4', 108)), ('binders', '바인더 선반', ('s4', 109)),
            ('calculator', '계산기', ('s4', 110)), ('stapler', '스테이플러', ('s4', 111)), ('microwave', '전자레인지', ('s4', 112)),
            ('fan_rotom', '선풍기 로토무', ('s4', (1098, 327, 1160, 382))), ('fridge_rotom', '냉장고 로토무', ('s4', (1160, 327, 1223, 382)))]

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

class Sheet:
    """초록 배경 시트 한 장: 크로마키 → 연결 성분 컷(cut) / 좌표 컷(rect)"""
    def __init__(self, path):
        self.rgb, self.alpha = cutout.keyed(cutout.load(path))
        self.comps = cutout.components(self.alpha, minpix=120, dil=3)
        self.comps.sort(key=lambda c: (round(c[1] / 60), c[0]))
    def cut(self, idx, green=False):
        x0, y0, x1, y1, mask = self.comps[idx]; pad = 3
        sl = (slice(max(0, y0 - pad), y1 + pad), slice(max(0, x0 - pad), x1 + pad))
        al = np.where(mask[sl], self.alpha[sl], 0)
        return trim(cutout.despill(self.rgb[sl], al, green))
    def rect(self, r, green=False):
        x0, y0, x1, y1 = r
        al = self.alpha[y0:y1, x0:x1].copy()
        out = trim(cutout.despill(self.rgb[y0:y1, x0:x1], al, green))
        # 시트의 칸 테두리(연두색 선)가 사각형 가장자리에 걸려 남는 것을 지운다: 바깥 3px 고리 안의 초록 픽셀 제거
        h, w = out.shape[:2]; ring = np.ones((h, w), bool); ring[3:-3, 3:-3] = False
        g = out[..., 1].astype(int); m = np.maximum(out[..., 0], out[..., 2]).astype(int)
        out = out.copy(); out[ring & (g > m + 25), 3] = 0
        return trim(out)
    def get(self, ref, green=False):
        return self.rect(ref, green) if isinstance(ref, tuple) else self.cut(ref, green)

def defringe(arr, band=4, kill=False):
    """윤곽 가까이에 남은 노란 초록 번짐(배경 초록이 주황·갈색 몸과 섞인 올리브색)을 안쪽의 가까운 색으로 덮는다. 어두운 윤곽선은 건드리지 않는다."""
    from scipy import ndimage as ndi
    a = arr.copy(); al = a[..., 3] > 128
    d = ndi.distance_transform_edt(al)
    r, g, b = [a[..., i].astype(int) for i in range(3)]
    bad = al & (d <= band) & (g - np.minimum(r, b) > 45) & (g >= np.maximum(r, b) * 0.9) & (np.maximum(r, b) > 100)
    core = al & (d > band)
    if kill:   # 얇은 팔다리처럼 안쪽 색이 없는 곳은 초록 번짐을 지운다(몸이 초록이 아닌 컷 전용)
        spill = al & (g - np.maximum(r, b) > 30)
        a[spill, 3] = 0
    if bad.any() and core.any():
        _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
        a[bad, :3] = a[iy[bad], ix[bad], :3]
    return a

def keep_main(arr, dil=2):
    """가장 큰 덩어리만 남긴다(시트 격자선 조각이 발밑에 점선처럼 붙는 것을 지운다)"""
    from scipy import ndimage as ndi
    m = ndi.binary_dilation(arr[..., 3] > 40, iterations=dil)
    lab, n = ndi.label(m, structure=np.ones((3, 3)))
    out = arr.copy()
    if n >= 2:
        big = np.argmax(ndi.sum(m, lab, range(1, n + 1))) + 1
        out[lab != big, 3] = 0
    # 발밑에 가로로 걸린 격자선 조각(맨 아래 3줄의 어두운 픽셀)을 지운다
    low = out[-3:]; low[(low[..., :3].max(axis=-1) < 90)] = 0
    cnt = (out[..., 3] > 40).sum(axis=1); keep = len(cnt)
    while keep > 1 and cnt[keep - 1] < 6: keep -= 1           # 발 아래에 한두 점 남은 줄은 잘라 발바닥 기준을 맞춘다
    return trim(out[:keep])

def prop_fix(pid, arr):
    """초록 번짐이 눈에 띄는 의자는 초록 가장자리를 지운다(식물은 despill의 green 모드만)"""
    return defringe(arr, band=3, kill=True) if pid.startswith('chair') else arr

def same_canvas(arrs):
    """같은 크기 캔버스에 아래 중앙 기준으로 맞춘다(뮤츠 상태 컷이 상태가 바뀌어도 키·발 위치가 같도록)"""
    H = max(a.shape[0] for a in arrs); W = max(a.shape[1] for a in arrs); out = []
    for a in arrs:
        c = np.zeros((H, W, 4), np.uint8); h, w = a.shape[:2]
        c[H - h:, (W - w) // 2:(W - w) // 2 + w] = a; out.append(c)
    return out

def main():
    S = {'s1': Sheet(SRC), 's2': Sheet(SRC2), 's3': Sheet(SRC3), 's4': Sheet(SRC4)}
    def get(ref, green=False):
        return S[ref[0]].get(ref[1], green)
    extra = [(eid, enhance(get(ref))) for eid, _, ref in EXTRA]
    chars = [(cid, enhance(S['s1'].cut(i, g))) for cid, _, i, g in CHARS] + [(cid, enhance(defringe(get(ref, g), kill=cid.startswith('rotom') or cid == 'fuecoco') if g else get(ref, g))) for cid, _, ref, g in NEWCHARS]
    bcuts = {bid: keep_main(enhance(get(ref))) for bid, _, ref in BOSS}
    same = same_canvas([bcuts[k] for k in BOSS_SAME])
    for k, arr in zip(BOSS_SAME, same): bcuts[k] = arr
    boss = [(bid, bcuts[bid]) for bid, _, _ in BOSS]
    atlas, apos = pack(chars + boss + extra, 1280)
    s1 = S['s1']
    props = [(pid, s1.cut(i)) for pid, _, i in PROP_COMPS] + [(pid, s1.rect(r)) for pid, _, r in PROP_RECTS] + [(pid, prop_fix(pid, get(ref, pid.startswith(('bonsai', 'aloe', 'chair'))))) for pid, _, ref in PROP_NEW]
    psheet, ppos = pack(props, 640)
    out = os.path.join(HERE, 'assets'); os.makedirs(out, exist_ok=True)
    # 용량 줄이기: 팔레트 PNG(알파 포함)
    def save(img, name):
        q = img.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        q.save(os.path.join(out, name), optimize=True)
    atlas.save(os.path.join(out, 'atlas.png'), optimize=True); save(psheet, 'props.png')
    meta = {
        'atlas': {'file': 'atlas.png', 'w': atlas.width, 'h': atlas.height, 'up': UP,
                  'chars': [{'id': cid, 'name': n, 'rect': apos[cid]} for cid, n, _, _ in CHARS] + [{'id': cid, 'name': n, 'rect': apos[cid]} for cid, n, _, _ in NEWCHARS],
                  'boss': [{'id': bid, 'name': n, 'rect': apos[bid]} for bid, n, _ in BOSS],
                  'extra': [{'id': eid, 'name': n, 'rect': apos[eid]} for eid, n, _ in EXTRA]},
        'props': {'file': 'props.png', 'w': psheet.width, 'h': psheet.height,
                  'items': [{'id': pid, 'name': n, 'rect': ppos[pid]} for pid, n, _ in PROP_COMPS] + [{'id': pid, 'name': n, 'rect': ppos[pid]} for pid, n, _ in PROP_RECTS] + [{'id': pid, 'name': n, 'rect': ppos[pid]} for pid, n, _ in PROP_NEW]}}
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
