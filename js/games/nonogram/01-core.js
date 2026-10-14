/* 数织（Nonogram）· 棋盘模型
 *
 * 数织的题目不是"生成"出来的，而是**先有一张图，线索从图里读出来**。
 * 所以这里和别处反过来：solution 是输入，clues 是推导结果。
 *
 * 格子三态：0 未知、1 实心、2 标记为空。线索是每行/每列连续实心段的长度。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  const UNKNOWN = 0, FILLED = 1, MARKED = 2;

  /**
   * 从一张图算出线索。
   * @param {Uint8Array} sol 长度 w*h，1 表示实心
   */
  function cluesOf(sol, w, h) {
    const rows = [], cols = [];
    for (let r = 0; r < h; r++) {
      const run = [];
      let n = 0;
      for (let c = 0; c < w; c++) {
        if (sol[r * w + c]) n++;
        else { if (n) run.push(n); n = 0; }
      }
      if (n) run.push(n);
      rows.push(run.length ? run : [0]);
    }
    for (let c = 0; c < w; c++) {
      const run = [];
      let n = 0;
      for (let r = 0; r < h; r++) {
        if (sol[r * w + c]) n++;
        else { if (n) run.push(n); n = 0; }
      }
      if (n) run.push(n);
      cols.push(run.length ? run : [0]);
    }
    return { rows: rows, cols: cols };
  }

  /** 把 '.#' 之类的字符串转成解 */
  function parseRows(rows, w, h) {
    const sol = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      const line = rows[r] || '';
      for (let c = 0; c < w; c++) {
        const ch = line[c];
        sol[r * w + c] = (ch === '#' || ch === 'X' || ch === '1') ? 1 : 0;
      }
    }
    return sol;
  }

  function create(pic) {
    const w = pic.w, h = pic.h;
    const sol = parseRows(pic.rows, w, h);
    return {
      w: w, h: h,
      name: pic.name || '未命名',
      id: pic.id || null,
      solution: sol,
      clues: cluesOf(sol, w, h),
      cells: new Uint8Array(w * h),
      moves: 0,
      state: 'playing',      // playing | won
      elapsed: 0,
    };
  }

  /** 按线索造一个空盘（用于玩家自绘的题目） */
  function fromSolution(sol, w, h, name) {
    return {
      w: w, h: h, name: name || '自绘', id: null,
      solution: sol, clues: cluesOf(sol, w, h),
      cells: new Uint8Array(w * h),
      moves: 0, state: 'playing', elapsed: 0,
    };
  }

  /** 这一行/列目前的状态数组（给行求解器用） */
  function rowOf(b, r) {
    const out = new Uint8Array(b.w);
    for (let c = 0; c < b.w; c++) out[c] = b.cells[r * b.w + c];
    return out;
  }
  function colOf(b, c) {
    const out = new Uint8Array(b.h);
    for (let r = 0; r < b.h; r++) out[r] = b.cells[r * b.w + c];
    return out;
  }

  function setCell(b, i, v) {
    if (i < 0 || i >= b.cells.length) return false;
    if (b.cells[i] === v) return false;
    b.cells[i] = v;
    b.moves++;
    return true;
  }

  const toggle = (b, i) => setCell(b, i, b.cells[i] === FILLED ? UNKNOWN : FILLED);
  const mark = (b, i) => setCell(b, i, b.cells[i] === MARKED ? UNKNOWN : MARKED);

  /** 每一格都和答案对上了才算完成（多填一格都不算） */
  function isSolved(b) {
    for (let i = 0; i < b.cells.length; i++) {
      const want = b.solution[i] ? FILLED : MARKED;
      if (b.cells[i] !== want && !(b.cells[i] === UNKNOWN && !b.solution[i])) return false;
    }
    return true;
  }

  /**
   * 只按「已填的实心」判断完成——玩家不需要把空位也一个个标出来。
   * 这是数织的通用判定：实心格全对就算赢。
   */
  function isComplete(b) {
    for (let i = 0; i < b.cells.length; i++) {
      if ((b.cells[i] === FILLED) !== !!b.solution[i]) return false;
    }
    return true;
  }

  /** 当前填错的实心格（用来做即时纠错） */
  function wrongCells(b) {
    const out = [];
    for (let i = 0; i < b.cells.length; i++) {
      if (b.cells[i] === FILLED && !b.solution[i]) out.push(i);
    }
    return out;
  }

  /** 把解渲染成文本（调试和测试用） */
  function toText(sol, w, h) {
    const out = [];
    for (let r = 0; r < h; r++) {
      let s = '';
      for (let c = 0; c < w; c++) s += sol[r * w + c] ? '#' : '.';
      out.push(s);
    }
    return out.join('\n');
  }

  N.UNKNOWN = UNKNOWN;
  N.FILLED = FILLED;
  N.MARKED = MARKED;
  N.cluesOf = cluesOf;
  N.parseRows = parseRows;
  N.create = create;
  N.fromSolution = fromSolution;
  N.rowOf = rowOf;
  N.colOf = colOf;
  N.setCell = setCell;
  N.toggle = toggle;
  N.mark = mark;
  N.isSolved = isSolved;
  N.isComplete = isComplete;
  N.wrongCells = wrongCells;
  N.toText = toText;
})(window);
