/* 数织 · 渲染
 *
 * 版面是「左上角一块留白 + 上方列线索 + 左侧行线索 + 右下网格」的四宫格。
 * 线索区的大小由**最长的那条线索**决定（10×10 的列线索最多 3 个数，20×20 可能 5 个），
 * 所以格子尺寸要按「线索区 + 网格」的总宽反推，不能只按网格宽算。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});
  const U = SD.UI;
  const { el, clear } = U;

  const UNKNOWN = 0, FILLED = 1, MARKED = 2;
  const MAX_BOARD = 560;
  const CLUE_RATIO = 0.62;    // 线索格的边长 = 格子边长 × 这个比例

  function create(root) {
    const box = el('div.ng-board');
    root.appendChild(box);
    let cell = 30;
    let grid = null;
    let cellEls = [];
    let clueEls = { rows: [], cols: [] };
    let onTap = null;

    /** 一行当前实心段 —— 和线索完全一致时把线索灰掉，玩家一眼看出这行做完了 */
    function runsOf(vals) {
      const out = [];
      let n = 0;
      for (const v of vals) {
        if (v === FILLED) n++;
        else { if (n) out.push(n); n = 0; }
      }
      if (n) out.push(n);
      return out;
    }
    const sameRuns = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

    function fit(b) {
      const cw = Math.max.apply(null, b.clues.rows.map((c) => c.length).concat([1]));
      const ch = Math.max.apply(null, b.clues.cols.map((c) => c.length).concat([1]));
      const availW = Math.min(MAX_BOARD, Math.max(220, window.innerWidth - 48));
      // 高度也要卡：20×20 加上顶部线索会超出屏幕
      const availH = Math.max(220, window.innerHeight - 260);
      const byW = Math.floor(availW / (b.w + cw * CLUE_RATIO));
      const byH = Math.floor(availH / (b.h + ch * CLUE_RATIO));
      cell = Math.max(12, Math.min(byW, byH, 46));
      box.style.setProperty('--cell', cell + 'px');
      box.style.setProperty('--clue', Math.round(cell * CLUE_RATIO) + 'px');
      box.style.setProperty('--w', b.w);
      box.style.setProperty('--h', b.h);
      box.style.setProperty('--cw', cw);
      box.style.setProperty('--ch', ch);
      return { cw: cw, ch: ch };
    }

    function build(b) {
      clear(box);
      const dim = fit(b);
      const cw = dim.cw, ch = dim.ch;

      box.appendChild(el('div.ng-corner'));
      const cols = el('div.ng-cols');
      const rows = el('div.ng-rows');
      grid = el('div.ng-grid');
      clueEls = { rows: [], cols: [] };

      for (let c = 0; c < b.w; c++) {
        const list = b.clues.cols[c];
        clueEls.cols.push([]);
        for (let k = 0; k < ch; k++) {
          const idx = k - (ch - list.length);
          const v = idx >= 0 ? list[idx] : null;
          const n = el('span.ng-clue', { text: v === null ? '' : String(v) });
          if (v !== null) clueEls.cols[c].push({ node: n, k: k, value: v });
          cols.appendChild(n);
        }
      }
      for (let r = 0; r < b.h; r++) {
        const list = b.clues.rows[r];
        clueEls.rows.push([]);
        for (let k = 0; k < cw; k++) {
          const idx = k - (cw - list.length);
          const v = idx >= 0 ? list[idx] : null;
          const n = el('span.ng-clue', { text: v === null ? '' : String(v) });
          if (v !== null) clueEls.rows[r].push({ node: n, k: k, value: v });
          rows.appendChild(n);
        }
      }

      cellEls = [];
      for (let i = 0; i < b.w * b.h; i++) {
        const c = el('button.ng-cell', { dataset: { i: String(i) } });
        c.addEventListener('pointerdown', (e) => { e.preventDefault(); if (onTap) onTap(i, e); });
        c.addEventListener('contextmenu', (e) => e.preventDefault());
        cellEls.push(c);
        grid.appendChild(c);
      }

      // 网格模板显式写成 repeat(n, ...)：把 var() 塞进 repeat() 的计数位在部分浏览器上不可靠
      box.style.gridTemplateColumns = Math.round(cw * cell * CLUE_RATIO) + 'px ' + (b.w * cell) + 'px';
      box.style.gridTemplateRows = Math.round(ch * cell * CLUE_RATIO) + 'px ' + (b.h * cell) + 'px';
      cols.style.gridTemplateColumns = 'repeat(' + b.w + ', ' + cell + 'px)';
      cols.style.gridTemplateRows = 'repeat(' + ch + ', ' + Math.round(cell * CLUE_RATIO) + 'px)';
      rows.style.gridTemplateColumns = 'repeat(' + cw + ', ' + Math.round(cell * CLUE_RATIO) + 'px)';
      rows.style.gridTemplateRows = 'repeat(' + b.h + ', ' + cell + 'px)';
      grid.style.gridTemplateColumns = 'repeat(' + b.w + ', ' + cell + 'px)';
      grid.style.gridTemplateRows = 'repeat(' + b.h + ', ' + cell + 'px)';

      // 每 5 格加一道重线：20×20 没有它根本数不清自己在看第几行
      for (let i = 0; i < b.w * b.h; i++) {
        const r = (i / b.w) | 0, c = i % b.w;
        cellEls[i].classList.toggle('is-g5c', (c + 1) % 5 === 0 && c + 1 < b.w);
        cellEls[i].classList.toggle('is-g5r', (r + 1) % 5 === 0 && r + 1 < b.h);
      }

      box.appendChild(cols);
      box.appendChild(rows);
      box.appendChild(grid);
    }

    function render(b, state) {
      if (!cellEls.length || cellEls.length !== b.w * b.h) build(b);
      else fit(b);
      for (let i = 0; i < cellEls.length; i++) {
        const v = b.cells[i];
        const c = cellEls[i];
        c.classList.toggle('is-fill', v === FILLED);
        c.classList.toggle('is-mark', v === MARKED);
        c.classList.toggle('is-wrong', !!(state && state.wrong && state.wrong.has(i)));
      }
      // 线索灰化：这一行/列的实心段已经和线索完全一致
      for (let r = 0; r < b.h; r++) {
        const vals = N.rowOf(b, r);
        const done = sameRuns(runsOf(vals), b.clues.rows[r].filter((v) => v !== 0));
        for (const it of clueEls.rows[r]) it.node.classList.toggle('is-done', done);
      }
      for (let c = 0; c < b.w; c++) {
        const vals = N.colOf(b, c);
        const done = sameRuns(runsOf(vals), b.clues.cols[c].filter((v) => v !== 0));
        for (const it of clueEls.cols[c]) it.node.classList.toggle('is-done', done);
      }
    }

    return {
      render: render, root: box, cellSize: () => cell,
      resize: (b) => { if (b && cellEls.length) { fit(b); } },
      onTap: (fn) => { onTap = fn; },
    };
  }

  N.view = { create: create };
})(window);
