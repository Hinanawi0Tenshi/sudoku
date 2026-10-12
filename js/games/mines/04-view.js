/* 扫雷 · 盘面渲染
 *
 * 只负责把状态画出来，不持有任何游戏逻辑。
 * 格子节点建一次，之后每次渲染只改 className 和文本——
 * 重建会让长按、双击这些手势在中途断掉。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const M = (SD.Mines = SD.Mines || {});
  const { el, clear } = SD.UI;

  const LONG_PRESS_MS = 380;
  const CELL_MIN = 20;
  const CELL_MAX = 34;

  function create(root, opts) {
    const o = opts || {};
    let board = null;
    let cells = [];
    let hintCells = { ref: [], mine: [], safe: [], suggest: [] };

    function build(b) {
      clear(root);
      const grid = el('div.mine-grid', {
        style: { '--mw': b.w, '--mh': b.h },
        role: 'grid',
        'aria-label': '扫雷棋盘',
      });
      cells = new Array(b.w * b.h);
      for (let i = 0; i < b.w * b.h; i++) {
        const c = el('div.mcell', {
          role: 'gridcell',
          dataset: { i: String(i) },
        });
        c._num = el('span.mc-num');
        c._flag = el('span.mc-flag');
        c.appendChild(c._num);
        c.appendChild(c._flag);
        bind(c, i);
        cells[i] = c;
        grid.appendChild(c);
      }
      root.appendChild(grid);
      board = b;
      sizeToFit(grid, b);
    }

    /**
     * 高级档 30 列，手机上塞不下。按容器宽度算格子大小，到下限就让盘面横向滚动——
     * 缩小到点不准的程度，不如让人滑一下。
     */
    function sizeToFit(grid, b) {
      const avail = root.clientWidth || 320;
      const fit = Math.floor((avail - 2) / b.w);
      const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, fit));
      grid.style.setProperty('--cell', cell + 'px');
    }

    function bind(node, i) {
      let pressTimer = null;
      let longPressed = false;

      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (o.onFlag) o.onFlag(i);
      });

      node.addEventListener('click', () => {
        // 长按已经插过旗了，抬手时的那次 click 不能再翻一次
        if (longPressed) { longPressed = false; return; }
        if (o.flagMode && o.flagMode()) { if (o.onFlag) o.onFlag(i); return; }
        if (o.onOpen) o.onOpen(i);
      });

      node.addEventListener('dblclick', (e) => {
        e.preventDefault();
        if (o.onChord) o.onChord(i);
      });

      node.addEventListener('touchstart', (e) => {
        longPressed = false;
        pressTimer = setTimeout(() => {
          longPressed = true;
          if (o.onFlag) o.onFlag(i);
        }, LONG_PRESS_MS);
      }, { passive: true });
      const cancel = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
      node.addEventListener('touchend', cancel, { passive: true });
      node.addEventListener('touchmove', cancel, { passive: true });
      node.addEventListener('touchcancel', cancel, { passive: true });
    }

    const inSet = (list, i) => list && list.indexOf(i) >= 0;

    function render(b, state) {
      if (!board || board.w !== b.w || board.h !== b.h) build(b);
      const s = state || {};
      const hint = s.hint || null;
      hintCells = {
        ref: (hint && hint.from) || [],
        mine: (hint && hint.mines) || [],
        safe: (hint && hint.safe) || [],
        suggest: (hint && hint.suggest) || [],
      };
      const over = b.state === 'won' || b.state === 'lost';

      for (let i = 0; i < cells.length; i++) {
        const node = cells[i];
        const open = !!b.open[i];
        let cls = 'mcell';

        if (open) {
          cls += '.is-open';
          if (b.mine[i]) cls += '.is-mine';
          if (i === b.boom) cls += '.is-boom';
        } else if (b.flag[i]) {
          cls += '.is-flag';
          // 输了以后把插错的旗标出来，不然玩家不知道自己错在哪
          if (over && !b.mine[i]) cls += '.is-wrong-flag';
        }

        if (!open && inSet(hintCells.ref, i)) cls += '.is-ref';
        if (!open && inSet(hintCells.mine, i)) cls += '.is-elim';
        if (!open && inSet(hintCells.safe, i)) cls += '.is-safe';
        if (!open && inSet(hintCells.suggest, i)) cls += '.is-suggest';

        if (node.className !== cls.replace(/\./g, ' ').trim()) {
          node.className = cls.replace(/\./g, ' ').trim();
        }

        const num = open && !b.mine[i] && b.num[i] > 0 ? String(b.num[i]) : '';
        if (node._num.textContent !== num) node._num.textContent = num;
        node.dataset.n = open && !b.mine[i] && b.num[i] > 0 ? String(b.num[i]) : '';
        node._flag.textContent = (!open && b.flag[i]) || (open && b.mine[i] && b.state === 'lost') ? '🚩' : '';
      }
    }

    function cellAt(i) { return cells[i] || null; }
    const resize = (b) => { if (b) sizeToFit(root.firstChild, b); };

    return { render: render, cellAt: cellAt, resize: resize, root: root };
  }

  M.view = { create: create };
})(window);
