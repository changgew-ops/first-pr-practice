#!/usr/bin/env python3
"""Bundle Pixel Office into ONE html file (CSS, JS and fonts inlined) for hosts that block extra requests.

    python3 tools/build-single.py OUT.html

The output is a page *fragment* (<title>, <meta>, <style>, markup, <script>) without <html>/<head>/<body>,
which is the shape the Artifact publisher expects. Opening it directly in a browser also works.
"""
import base64, re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else 'pixel-office.single.html')
read = lambda p: (root / p).read_text(encoding='utf-8')

html = read('index.html')
body = html.split('<body>', 1)[1].split('</body>', 1)[0]
markup = body.split('<script', 1)[0].strip()
scripts = re.findall(r'<script src="([^"]+)"></script>', body)

css = read('css/style.css')
def font_uri(m):
    data = (root / 'css' / m.group(1)).read_bytes()
    return 'url("data:font/woff2;base64,' + base64.b64encode(data).decode() + '")'
# drop the unused Galmuri9 face, inline the rest
css = re.sub(r'@font-face \{ font-family: "Galmuri9";[^}]*\}\n', '', css)
css = re.sub(r'url\("\.\./(assets/fonts/[^"]+\.woff2)"\)', lambda m: font_uri(re.match(r'(.*)', '../' + m.group(1))), css)
css = css.replace('"Galmuri11", "Galmuri9", system-ui', '"Galmuri11", system-ui')
css += """
:root { color-scheme: dark; }
body { background: var(--bg); }
.app { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
"""

js = []
for s in scripts:
    code = read(s)
    assert '</script' not in code, s
    js.append(f'/* {s} */\n{code}')

page = f"""<meta charset="utf-8">
<title>Pixel Office</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{css}
</style>
{markup}
<script>
{chr(10).join(js)}
</script>
"""
out.write_text(page, encoding='utf-8')
print(f'wrote {out} ({out.stat().st_size / 1024:.0f} KB)')
