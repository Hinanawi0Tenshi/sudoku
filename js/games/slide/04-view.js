/* 数字华容道 · 渲染
 *
 * 每块数字是一个绝对定位的 div，靠 transform: translate() 移动，
 * 交给 CSS transition 做滑动动画。用 grid 布局的话位置一变就是瞬移，
 * 没有"滑过去"的手感。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const S = (SD.Slide = SD.Slide || {});
  const U = SD.UI;
  const { el, clear } = U;

  const MAX_BOARD = 420;   // 盘面最大边长（px），再大在手机上就溢出了
  const PAD = 3;           // 每块四周留的缝，缝里透出底板色

  function create(root) {
    const box = el('div.slide-board');
    root.appendChild(box);
    let n = 0;
    let cell = 60;
    let tiles = [];        // tiles[数字] = 节点
    let onTap = null;

    function fit() {
      // 不量父元素：盘面的宽高就是父元素撑开的，量到的是循环依赖——首次渲染时父元素
      // 还没被撑开，clientWidth 是 0，盘面直接缩成一小撮。
      // 也不量 .board-area：它的宽度同样会被盘面内容反过来撑大，切档位时尺寸会飘。
      // 直接按视口算，三档尺寸稳定可预期。
      const avail = Math.min(MAX_BOARD, Math.max(240, window.innerWidth - 48));
      cell = Math.max(34, Math.floor((avail - PAD * 2 * n) / n));
      box.style.setProperty('--cell', cell + 'px');
      box.style.width = cell * n + 'px';
      box.style.height = cell * n + 'px';
    }

    function build(b) {
      clear(box);
      n = b.n;
      fit();
      tiles = new Array(n * n);
      for (let v = 1; v <= n * n - 1; v++) {
        const t = el('button.slide-tile', { dataset: { v: String(v) } }, [
          el('span.slide-num', { text: String(v) }),
        ]);
        t.addEventListener('click', () => { if (onTap) onTap(v); });
        tiles[v] = t;
        box.appendChild(t);
      }
      box.appendChild(el('div.slide-slot'));
      place(b);
    }

    function place(b) {
      const size = cell - PAD * 2;
      for (let i = 0; i < b.cells.length; i++) {
        const v = b.cells[i];
        if (!v) continue;
        const t = tiles[v];
        if (!t) continue;
        const r = (i / n) | 0;
        const c = i % n;
        t.style.width = size + 'px';
        t.style.height = size + 'px';
        t.style.transform = 'translate(' + (c * cell + PAD) + 'px,' + (r * cell + PAD) + 'px)';
      }
      const e = b.empty;
      const slot = box.querySelector('.slide-slot');
      if (slot) {
        slot.style.width = size + 'px';
        slot.style.height = size + 'px';
        slot.style.transform = 'translate(' + ((e % n) * cell + PAD) + 'px,' + (((e / n) | 0) * cell + PAD) + 'px)';
      }
    }

    /** hint 里的格子高亮：ref 是"该动的这一块" */
    function mark(hint) {
      for (const v in tiles) if (tiles[v]) tiles[v].classList.remove('is-ref', 'is-goal');
      if (!hint) return;
      const v = hint.tile;
      if (tiles[v]) tiles[v].classList.add('is-ref');
    }

    function render(b, state) {
      if (!tiles.length || n !== b.n) build(b);
      else place(b);
      mark(state && state.hint);
      box.classList.toggle('is-won', b.state === 'won');
    }

    return {
      render: render,
      root: box,
      /** 点哪一块 —— 由 app 决定，视图只管转发 */
      onTile: (fn) => { onTap = fn; },
      resize: (b) => { if (b) { fit(); place(b); } },
    };
  }

  S.view = { create: create };
})(window);
