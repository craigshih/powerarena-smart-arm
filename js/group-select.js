// 分組下拉選單：外觀照報告附圖（深色面板、粗體分組標題、選項縮排、選到的那一項淺藍底）
// 底層仍是原本的 <select>（值與 change 事件不變）；只把彈出的清單換成自繪。觸控裝置保留系統原生選單。
const coarse = matchMedia('(pointer: coarse)');
let open = null;

function close() {
  if (!open) return;
  open.pop.remove();
  open.sel.setAttribute('aria-expanded', 'false');
  open = null;
}

function show(sel) {
  close();
  const z = sel.currentCSSZoom ?? 1;
  const pop = document.createElement('div');
  pop.className = 'gsel-pop';
  pop.setAttribute('role', 'listbox');
  pop.style.zoom = z;
  for (const node of sel.children) {
    const opts = node.tagName === 'OPTGROUP' ? [...node.children] : [node];
    if (node.tagName === 'OPTGROUP') {
      const h = document.createElement('div');
      h.className = 'gsel-head';
      h.textContent = node.label;
      pop.append(h);
    }
    for (const o of opts) {
      const b = document.createElement('div');
      b.className = 'gsel-opt';
      b.setAttribute('role', 'option');
      b.dataset.value = o.value;
      b.textContent = o.text;
      if (o.value === sel.value) b.classList.add('on');
      pop.append(b);
    }
  }
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('mousemove', (e) => {
    const b = e.target.closest('.gsel-opt');
    if (b) pop.querySelectorAll('.gsel-opt').forEach((x) => x.classList.toggle('on', x === b));
  });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('.gsel-opt');
    if (!b) return;
    close();
    if (sel.value !== b.dataset.value) {
      sel.value = b.dataset.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sel.focus();
  });
  document.body.append(pop);

  // 位置：選單上方空間夠就往上開（同附圖），否則往下；座標換算成彈出層自己的縮放
  const r = sel.getBoundingClientRect();
  const w = Math.max(r.width, pop.offsetWidth * z);
  const h = pop.offsetHeight * z;
  const up = r.top - h - 4 >= 8 || r.top > innerHeight - r.bottom;
  const top = up ? Math.max(8, r.top - h - 4) : Math.min(r.bottom + 4, innerHeight - h - 8);
  const left = Math.min(r.left, innerWidth - w - 8);
  pop.style.minWidth = `${r.width / z}px`;
  pop.style.maxHeight = `${(innerHeight - 16) / z}px`;
  pop.style.left = `${Math.max(8, left) / z}px`;
  pop.style.top = `${Math.max(8, top) / z}px`;
  pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  sel.setAttribute('aria-expanded', 'true');
  open = { sel, pop };
}

export function groupSelect(sel) {
  sel.addEventListener('mousedown', (e) => {
    if (coarse.matches || e.button !== 0) return;
    e.preventDefault();
    sel.focus();
    if (open?.sel === sel) close();
    else show(sel);
  });
  sel.addEventListener('keydown', (e) => {
    if (!open || open.sel !== sel) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  sel.addEventListener('change', () => close());
}

document.addEventListener('mousedown', (e) => {
  if (open && !open.pop.contains(e.target) && e.target !== open.sel) close();
});
addEventListener('resize', close);
addEventListener('scroll', (e) => { if (open && !open.pop.contains(e.target)) close(); }, true);
