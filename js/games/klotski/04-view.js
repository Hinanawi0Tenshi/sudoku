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
    let wallH = 26;
    let els = [];
    let wallEl = null;
    let gapEl = null;
    let onPick = null;

    function fit() {
      // 不量父元素：盘面撑开父元素，量到的是循环依赖。按视口算，尺寸稳定。
      const avail = Math.min(MAX_W, Math.max(200, window.innerWidth - 48));
      cell = Math.floor(avail / K.W);
      wallH = Math.max(18, Math.round(cell * 0.32));
      box.style.width = cell * K.W + 'px';
      box.style.height = (cell * K.H + wallH) + 'px';
      box.style.setProperty('--kcell', cell + 'px');
    }

    function place(b) {
      const size = cell - PAD * 2;
      // 出口：曹操要落到的 2×2 位置（左上角在 (3,1)）
      // 出口 = 底墙上的一个缺口。曹操落位后缺口亮起来。
      // 不再画 2×2 的虚线框——那个框标的是"曹操要占的位置"，压在棋子上既别扭，
      // 也容易让人以为那是出口本身。
      if (gapEl) {
        const w = 2 * cell - PAD * 2;
        gapEl.style.width = w + 'px';
        gapEl.style.height = wallH + 'px';
        gapEl.style.transform = 'translate(' + (1 * cell + PAD) + 'px,' + (K.H * cell) + 'px)';
        const done = b.pieces[0].r === 3 && b.pieces[0].c === 1;
        gapEl.classList.toggle('is-open', done);
      }
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
      // 底墙 + 墙上的缺口。缺口在棋盘**外面**，永远不会被棋子挡住。
      wallEl = el('div.k-wall');
      wallEl.style.height = wallH + 'px';
      wallEl.style.transform = 'translate(0,' + (K.H * cell) + 'px)';
      gapEl = el('div.k-gap', null, [
        el('span.k-gap-arrow', { text: '▼' }),
        el('span.k-gap-txt', { text: '出口' }),
      ]);
      box.appendChild(wallEl);
      box.appendChild(gapEl);
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
      // 每格画一道浅线，空位才看得出是"格子"而不是背景
      for (let r = 0; r < K.H; r++) {
        for (let c = 0; c < K.W; c++) {
          const g = el('i.k-slot');
          g.style.width = (cell - PAD * 2) + 'px';
          g.style.height = (cell - PAD * 2) + 'px';
          g.style.transform = 'translate(' + (c * cell + PAD) + 'px,' + (r * cell + PAD) + 'px)';
          box.appendChild(g);
        }
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
