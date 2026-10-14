/* 数织 · 行求解器与整盘求解
 *
 * 一切推理都归结成一个问题：**给一行格子和它的线索，哪些格子一定是实心、哪些一定是空？**
 * 做法是把这一行所有合法的摆法枚举出来，逐格统计：
 *   · 每种摆法里都是实心 → 一定实心
 *   · 每种摆法里都是空   → 一定为空
 *   · 有的摆法实心有的空 → 还不知道
 *
 * 行长最多 20，线索段数不多，摆法数量很小，直接枚举就够。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  const UNKNOWN = 0, FILLED = 1, MARKED = 2;

  /**
   * 枚举一行所有合法摆法，统计每格。
   * @param {Uint8Array} line 0 未知 / 1 实心 / 2 空
   * @param {number[]} clue   连续实心段长度；[0] 表示整行全空
   * @returns {{count:number, fill:Int32Array, sample:number[][]}}
   */
  function lineSolve(line, clue) {
    const n = line.length;
    const fill = new Int32Array(n);
    let count = 0;
    const runs = clue.length === 1 && clue[0] === 0 ? [] : clue.slice();
    const sample = [];
    const cur = new Uint8Array(n);

    // 剩余段至少要占的格数（含段间必需的空隙），用来提前剪枝
    const suffix = new Int32Array(runs.length + 1);
    for (let k = runs.length - 1; k >= 0; k--) suffix[k] = suffix[k + 1] + runs[k] + 1;

    function rec(k, pos) {
      if (k === runs.length) {
        // 尾巴必须全是空的
        for (let i = pos; i < n; i++) if (line[i] === FILLED) return;
        count++;
        for (let i = 0; i < n; i++) if (cur[i]) fill[i]++;
        if (sample.length < 8) sample.push(Array.from(cur));
        return;
      }
      const len = runs[k];
      const last = n - (suffix[k] - 1);      // 这一段最晚能开始的位置
      for (let p = pos; p <= last; p++) {
        // 跳过的那几格必须是空的
        let ok = true;
        for (let i = pos; i < p; i++) if (line[i] === FILLED) { ok = false; break; }
        if (!ok) break;
        // 这一段本身不能踩到已标空的格子
        for (let i = p; i < p + len; i++) if (line[i] === MARKED) { ok = false; break; }
        if (!ok) continue;
        // 段后那一格必须是空的（否则会和下一段连起来）
        if (p + len < n && line[p + len] === FILLED) continue;
        for (let i = p; i < p + len; i++) cur[i] = 1;
        rec(k + 1, p + len + 1);
        for (let i = p; i < p + len; i++) cur[i] = 0;
      }
    }
    rec(0, 0);
    return { count: count, fill: fill, sample: sample };
  }

  /** 这一行是不是自相矛盾（一种摆法都没有） */
  const lineContradiction = (line, clue) => lineSolve(line, clue).count === 0;

  /**
   * 把一行能确定的格子写回盘面。
   * @returns {{filled:number[], marked:number[], contradiction:boolean}}
   */
  function applyLine(line, clue) {
    const r = lineSolve(line, clue);
    const filled = [], marked = [];
    if (r.count === 0) return { filled: filled, marked: marked, contradiction: true };
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== UNKNOWN) continue;
      if (r.fill[i] === r.count) filled.push(i);
      else if (r.fill[i] === 0) marked.push(i);
    }
    return { filled: filled, marked: marked, contradiction: false };
  }

  /**
   * 整盘求解：反复扫行和列，把能定的定下来，直到不动为止。
   * @returns {{cells:Uint8Array|null, stuck:boolean, contradiction:boolean, steps:number}}
   */
  function propagate(clues, w, h, initial) {
    const cells = initial ? Uint8Array.from(initial) : new Uint8Array(w * h);
    let steps = 0;
    for (;;) {
      let changed = false;
      for (let r = 0; r < h; r++) {
        const line = new Uint8Array(w);
        for (let c = 0; c < w; c++) line[c] = cells[r * w + c];
        const res = applyLine(line, clues.rows[r]);
        if (res.contradiction) return { cells: null, stuck: false, contradiction: true, steps: steps };
        for (const c of res.filled) { if (cells[r * w + c] !== FILLED) { cells[r * w + c] = FILLED; changed = true; } }
        for (const c of res.marked) { if (cells[r * w + c] !== MARKED) { cells[r * w + c] = MARKED; changed = true; } }
      }
      for (let c = 0; c < w; c++) {
        const line = new Uint8Array(h);
        for (let r = 0; r < h; r++) line[r] = cells[r * w + c];
        const res = applyLine(line, clues.cols[c]);
        if (res.contradiction) return { cells: null, stuck: false, contradiction: true, steps: steps };
        for (const r of res.filled) { if (cells[r * w + c] !== FILLED) { cells[r * w + c] = FILLED; changed = true; } }
        for (const r of res.marked) { if (cells[r * w + c] !== MARKED) { cells[r * w + c] = MARKED; changed = true; } }
      }
      steps++;
      if (!changed) break;
      if (steps > 400) break;
    }
    let unknown = 0;
    for (const v of cells) if (v === UNKNOWN) unknown++;
    return { cells: cells, stuck: unknown > 0, contradiction: false, steps: steps, unknown: unknown };
  }

  /** 只靠行列推理能不能推完——能的话就是"纯逻辑可解"的题 */
  function solvableByLine(clues, w, h) {
    const r = propagate(clues, w, h);
    return !r.contradiction && !r.stuck;
  }

  /**
   * 数解的个数（最多数到 limit 个）。用来验证题目唯一解。
   * 先做行列传播，推不动再挑一个未知格分支。
   */
  function countSolutions(clues, w, h, limit) {
    const cap = limit || 2;
    let found = 0;

    function rec(cells) {
      if (found >= cap) return;
      const p = propagate(clues, w, h, cells);
      if (p.contradiction) return;
      if (!p.stuck) { found++; return; }
      // 挑第一个未知格，先试实心再试空
      let idx = -1;
      for (let i = 0; i < p.cells.length; i++) if (p.cells[i] === UNKNOWN) { idx = i; break; }
      if (idx < 0) { found++; return; }
      for (const v of [FILLED, MARKED]) {
        const next = Uint8Array.from(p.cells);
        next[idx] = v;
        rec(next);
        if (found >= cap) return;
      }
    }
    rec(null);
    return found;
  }

  N.lineSolve = lineSolve;
  N.lineContradiction = lineContradiction;
  N.applyLine = applyLine;
  N.propagate = propagate;
  N.solvableByLine = solvableByLine;
  N.countSolutions = countSolutions;
})(window);
