#!/usr/bin/env python3
"""每次改完要上線前跑一次：python3 bump-version.py

GitHub Pages 讓瀏覽器快取檔案 10 分鐘，改版後常看到舊畫面。
這支程式給 index.html 裡的 css、main.js 和 importmap 中每個 js 檔加上新的版本號（?v=時間），
瀏覽器看到網址變了就會重新下載。
"""
import pathlib
import re
import time

root = pathlib.Path(__file__).resolve().parent
html_path = root / 'index.html'
v = time.strftime('%Y%m%d%H%M%S')
html = html_path.read_text(encoding='utf8')

files = sorted(p.relative_to(root).as_posix() for p in (root / 'js').rglob('*.js'))
entries = ',\n'.join(f'      "./{f}": "./{f}?v={v}"' for f in files)
block = f'''<script type="importmap">
    {{ "imports": {{
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/",
{entries}
    }} }}
  </script>'''
html, n = re.subn(r'<script type="importmap">.*?</script>', block, html, count=1, flags=re.S)
assert n == 1, 'importmap not found'
html = re.sub(r'href="css/style\.css(\?v=\d+)?"', f'href="css/style.css?v={v}"', html)
html = re.sub(r'src="js/main\.js(\?v=\d+)?"', f'src="js/main.js?v={v}"', html)
html_path.write_text(html, encoding='utf8')
print('version', v, '·', len(files), 'js files')
