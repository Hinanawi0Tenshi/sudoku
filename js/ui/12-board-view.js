/* 数独 · 棋盘渲染与高亮
 * 只负责「把状态画出来」，不持有游戏逻辑。
 * 格子节点只创建一次，之后每次渲染只改 className 和文本，避免重建导致丢失焦点。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const { el, clear } = SD.UI;

  function create(root, opts) {
    const o = opts || {};
    const cells = [];
    // 棋盘容器由这里创建，HTML 里只留一个空的挂载点，避免出现两个 .board
    const board = el('div#board.board', { role: 'grid', 'aria-label': '数独棋盘', tabindex: '0' });
    root.appendChild(board);

    for (let i = 0; i < B.CELL_COUNT; i++) {
      const c = el('div.cell', {
        role: 'gridcell',
        dataset: { index: String(i), row: String(B.ROW_OF[i] + 1), col: String(B.COL_OF[i] + 1) },
        onclick: (e) => o.onSelect && o.onSelect(i, e),
      });
      const value = el('span.cell-value');
      const notes = el('div.cell-notes');
      c.appendChild(value);
      c.appendChild(notes);
      c._value = value;
      c._notes = notes;
      cells.push(c);
      board.appendChild(c);
    }

    // 3×3 分区：粗分隔线 + 相邻宫交替的极淡底色，一眼就能分块。
    // 存成字符串而不是直接加类名——render() 每次都会整体重写 className，直接加的会被冲掉。
    // 提示里被指名的格子，独立于 render 维护：悬停引用不该触发整盘重绘
    let refCells = new Set();
    const staticCls = new Array(B.CELL_COUNT).fill('');
    for (let i = 0; i < B.CELL_COUNT; i++) {
      let s = '';
      if (B.COL_OF[i] % 3 === 2 && B.COL_OF[i] !== 8) s += ' bx-end';
      if (B.ROW_OF[i] % 3 === 2 && B.ROW_OF[i] !== 8) s += ' by-end';
      if (B.BOX_OF[i] % 2 === 1) s += ' box-alt';
      staticCls[i] = s;
    }

    /**
     * @param {SudokuBoard} board 棋盘模型
     * @param {object} ui  { selected, highlight, highlightSame, highlightPeer,
     *                       mistakes, hint, lockedCells, conflicts }
     */
    function render(boardModel, ui) {
      const u = ui || {};
      const sel = u.selected === undefined || u.selected === null ? -1 : u.selected;
      const selDigit = sel >= 0 ? boardModel.grid[sel] : 0;
      const selRow = sel >= 0 ? B.ROW_OF[sel] : -1;
      const selCol = sel >= 0 ? B.COL_OF[sel] : -1;
      const selBox = sel >= 0 ? B.BOX_OF[sel] : -1;
      const conflicts = u.conflicts || new Map();
      const hintCells = u.hint ? new Set(u.hint.cells || []) : null;
      // 删候选的格子：红色。技巧盯着的格子：蓝色。两者含义不同，必须分开。
      const elimCells = u.hint ? new Set(u.hint.elimCells || []) : null;
      const hintMarks = new Map();
      if (u.hint) {
        for (const m of u.hint.marks || []) hintMarks.set(m.cell + ':' + m.digit, 'keep');
        for (const e of u.hint.eliminations || []) hintMarks.set(e.cell + ':' + e.digit, 'elim');
        for (const p of u.hint.placements || []) hintMarks.set(p.cell + ':' + p.digit, 'place');
        if (!u.hint.elimCells && u.hint.eliminations) {
          for (const e of u.hint.eliminations) elimCells.add(e.cell);
        }
      }

      for (let i = 0; i < B.CELL_COUNT; i++) {
        const c = cells[i];
        const d = boardModel.grid[i];
        const given = boardModel.isGiven(i);
        const bad = conflicts.has(i);

        let cls = '';
        if (given) cls += ' is-given';
        else if (d) cls += ' is-user';

        if (u.highlight) {
          if (sel >= 0 && i !== sel) {
            const peer = B.ROW_OF[i] === selRow || B.COL_OF[i] === selCol || B.BOX_OF[i] === selBox;
            const same = d && selDigit && d === selDigit;
            if (peer && u.highlightPeer) cls += ' is-peer';
            if (same && u.highlightSame) cls += ' is-same';
          }
        }
        if (bad) cls += ' is-conflict';
        if (i === sel) cls += ' is-selected';
        if (hintCells && hintCells.has(i)) cls += ' is-hint';
        // 红盖过蓝：同一格既被技巧盯着又要删候选时，红色是更该被看见的信息
        if (elimCells && elimCells.has(i)) cls += ' is-elim';
        if (u.hintPlaced && u.hintPlaced.has(i)) cls += ' is-hint-value';
        if (refCells.has(i)) cls += ' is-ref';
        c.className = 'cell' + staticCls[i] + cls;

        if (d) {
          c._value.textContent = String(d);
          c._notes.textContent = '';
          c._notes.style.display = 'none';
        } else {
          c._value.textContent = '';
          const mask = boardModel.notes[i];
          if (mask) {
            c._notes.style.display = '';
            const kids = c._notes.children;
            while (kids.length < 9) c._notes.appendChild(el('span'));
            for (let k = 0; k < 9; k++) {
              const digit = k + 1;
              const on = (mask & B.bit(digit)) !== 0;
              const mark = hintMarks.get(i + ':' + digit);
              kids[k].textContent = on ? String(digit) : '';
              kids[k].className = mark === 'elim' ? 'elim' : on ? '' : 'gone';
              kids[k].style.visibility = on || mark ? 'visible' : 'hidden';
            }
          } else {
            c._notes.style.display = 'none';
          }
        }
      }
    }

    /**
     * 数字键盘：某个数字填满 9 个就整个藏起来，不再占位也不需要再看计数；
     * 笔记态下把选中格已有的笔记点亮，方便照着补删。
     */
    function renderPad(boardModel, noteMask) {
      const counts = new Array(10).fill(0);
      for (let i = 0; i < B.CELL_COUNT; i++) {
        const d = boardModel.grid[i];
        if (d) counts[d]++;
      }
      const pad = document.querySelectorAll('.np-digit');
      for (const btn of pad) {
        const d = Number(btn.dataset.digit);
        btn.classList.toggle('is-full', counts[d] >= 9);
        btn.classList.toggle('is-note', !!(noteMask & B.bit(d)));
      }
      return counts;
    }

    /** 点亮被提示点名的格子；传空数组即取消 */
    function setRefs(list) {
      const next = new Set(list || []);
      if (next.size === refCells.size) {
        let same = true;
        for (const v of next) if (!refCells.has(v)) { same = false; break; }
        if (same) return;
      }
      const before = Array.from(refCells);
      refCells = next;
      for (const i of before) if (!refCells.has(i)) cells[i].classList.remove('is-ref');
      for (const i of refCells) cells[i].classList.add('is-ref');
    }

    function cellAt(i) {
      return cells[i];
    }

    function boardElement() {
      return board;
    }

    return { render: render, renderPad: renderPad, setRefs: setRefs, cellAt: cellAt, boardElement: boardElement, cells: cells };
  }

  SD.BoardView = { create: create };
})(window);
