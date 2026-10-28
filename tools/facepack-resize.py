#!/usr/bin/env python3
"""페이스팩 사진을 HTML 내장용으로 줄인다(tools/build-facepack-embed.mjs가 부른다).
사용: python3 -I tools/facepack-resize.py <facepack 폴더> <출력 JSON> [사진배율=0.625] [사진품질=50] [몸통배율=0.5] [몸통품질=70] [아틀라스너비=640] [아틀라스품질=70]
사진 전체를 같은 비율로 줄이므로 data.js의 faceBox(원본 대비 비율)와 rotation이 그대로 맞는다.
출력: { "photos": { id: base64 }, "uniforms": { teamId: base64 }, "atlas": base64, "stats": {...} }"""
import base64, glob, io, json, os, sys
from PIL import Image

root, out = sys.argv[1], sys.argv[2]
ps = float(sys.argv[3]) if len(sys.argv) > 3 else 0.625
pq = int(sys.argv[4]) if len(sys.argv) > 4 else 50
us = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
uq = int(sys.argv[6]) if len(sys.argv) > 6 else 70
aw = int(sys.argv[7]) if len(sys.argv) > 7 else 640
aq = int(sys.argv[8]) if len(sys.argv) > 8 else 70


def webp(im, q, method=4):
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=q, method=method)
    return b.getvalue()


def b64(raw):
    return base64.b64encode(raw).decode('ascii')


photos, size = {}, 0
for f in sorted(glob.glob(os.path.join(root, 'faces', '*.webp'))):
    pid = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGBA')
    w, h = max(8, round(im.width * ps)), max(8, round(im.height * ps))
    raw = webp(im.resize((w, h), Image.LANCZOS), pq, 4)  # 방법 4: 6보다 크기 차이가 1%대인데 빌드가 5배 빠르다
    photos[pid] = b64(raw)
    size += len(raw)

uniforms, usize = {}, 0
for f in sorted(glob.glob(os.path.join(root, 'uniforms', '*.webp'))):
    tid = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGBA')
    raw = webp(im.resize((round(im.width * us), round(im.height * us)), Image.LANCZOS), uq, 6)
    uniforms[tid] = b64(raw)
    usize += len(raw)

atlas_path = os.path.join(root, 'generated', 'atlas.webp')
atlas, asize = None, 0
if os.path.exists(atlas_path):
    im = Image.open(atlas_path).convert('RGBA')
    k = aw / im.width
    raw = webp(im.resize((aw, round(im.height * k)), Image.LANCZOS), aq, 6)
    atlas, asize = b64(raw), len(raw)

with open(out, 'w', encoding='utf8') as fp:
    json.dump({'v': 1, 'photos': photos, 'uniforms': uniforms, 'atlas': atlas,
               'stats': {'photos': len(photos), 'photoBytes': size, 'uniformBytes': usize, 'atlasBytes': asize,
                         'params': {'photoScale': ps, 'photoQuality': pq, 'uniformScale': us, 'uniformQuality': uq, 'atlasWidth': aw, 'atlasQuality': aq}}},
              fp, separators=(',', ':'))
print(json.dumps({'photos': len(photos), 'photoBytes': size, 'uniformBytes': usize, 'atlasBytes': asize}))
