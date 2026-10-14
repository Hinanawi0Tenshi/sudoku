/* 华容道 · 渲染
 *
 * 每块是一个绝对定位的 div，靠 transform 平移，CSS transition 做滑动。
 * 块的大小不一样（2×2 / 1×2 / 2×1 / 1×1），所以位置和尺寸都要按格算。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const K = (SD.Klotski = SD.Klotski || {});
  const U = SD.UI;
  const { el, clear } = U;

  const MAX_W = 360;      // 盘面最大宽度（4 列）
  const PAD = 3;          // 每块四周留的缝

  function create(root) {
    const box = el('div.k-board');
    root.appendChild(box);
    let cell = 80;
    let els = [];
    let onPick = null;

    function fit() {
      // 不量父元素：盘面撑开父元素，量到的是循环依赖。按视口算，尺寸稳定。
      const avail = Math.min(MAX_W, Math.max(200, window.innerWidth - 48));
      cell = Math.floor(avail / K.W);
      box.style.width = cell * K.W + 'px';
      box.style.height = cell * K.H + 'px';
      box.style.setProperty('--kcell', cell + 'px');
    }

    function place(b) {
      const size = cell - PAD * 2;
      for (let i = 0; i < b.pieces.length; i++) {
        const p = b.pieces[i];
        const n = els[i];
        if (!n) continue;
        n.style.width = (p.w * cell - PAD * 2) + 'px';
        n.style.height = (p.h * cell - PAD * 2) + 'px';
        n.style.transform = 'translate(' + (p.c * cell + PAD) + 'px,' + (p.r * cell + PAD) + 'px)';
      }
    }

    function build(b) {
      clear(box);
      fit();
      els = [];
      for (let i = 0; i < b.pieces.length; i++) {
        const p = b.pieces[i];
        const n = el('button.k-piece', {
          dataset: { i: String(i), type: String(p.type) },
          title: p.name,
        }, [el('span.k-name', { text: p.name })]);
        n.addEventListener('pointerdown', (e) => { if (onPick) onPick(i, e); });
        els.push(n);
        box.appendChild(n);
      }
      place(b);
    }

    function render(b, state) {
      if (!els.length || els.length !== b.pieces.length) build(b);
      else { fit(); place(b); }
      for (let i = 0; i < els.length; i++) els[i].classList.toggle('is-cao', i === 0);
      const sel = state && state.selected;
      for (let i = 0; i < els.length; i++) els[i].classList.toggle('is-sel', sel === i);
      const hint = state && state.hint;
      for (let i = 0; i < els.length; i++) els[i].classList.toggle('is-ref', !!hint && hint.index === i);
    }

    /** 屏幕坐标落在哪一块上——拖动时用来找目标块 */
    function pieceAt(b, clientX, clientY) {
      const r = box.getBoundingClientRect();
      const c = Math.floor((clientX - r.left) / cell);
      const row = Math.floor((clientY - r.top) / cell);
      if (c < 0 || row < 0 || c >= K.W || row >= K.H) return -1;
      for (let i = 0; i < b.pieces.length; i++) {
        const p = b.pieces[i];
        if (row >= p.r && row < p.r + p.h && c >= p.c && c < p.c + p.w) return i;
      }
      return -1;
    }

    return {
      render: render, root: box, cellSize: () => cell, pieceAt: pieceAt,
      onPick: (fn) => { onPick = fn; },
      resize: (b) => { if (b) { fit(); place(b); } },
    };
  }

  K.view = { create: create };
})(window);
