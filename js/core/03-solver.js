/* 数独 · 机器求解器
 *
 * 用途有两个：
 * 1. 生成题目时判断「剩余盘面是否仍然唯一解」（挖洞与难度回退都依赖它）。
 * 2. 校验用户导入或图片识别来的棋局是否合法、是否有唯一解。
 *
 * 速度关键：位掩码 + MRV（最少候选优先）+ 每次递归重新统计候选。
 * 典型 9x9 盘面一次求解在 1ms 以内，挖一整道题的几十次判定也只有几十毫秒。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const ALL = B.ALL;
  const bit = B.bit;

  function emptyMasks() {
    return {
      row: new Uint16Array(9),
      col: new Uint16Array(9),
      box: new Uint16Array(9),
    };
  }

  /**
   * @param {Uint8Array|number[]} grid 0 表示空格
   * @param {number} limit 找到这么多个解就提前停止
   * @returns {{count:number, solution:Uint8Array|null, nodes:number, exhausted:boolean}}
   */
  function solve(grid, limit = 2, rng) {
    const g = Uint8Array.from(grid);
    const m = emptyMasks();
    let nodes = 0;
    let count = 0;
    let first = null;

    // 先把已有数字装进掩码；出现重复说明题面本身已矛盾，直接返回 0 解
    for (let i = 0; i < B.CELL_COUNT; i++) {
      const d = g[i];
      if (!d) continue;
      const b = bit(d);
      const r = B.ROW_OF[i];
      const c = B.COL_OF[i];
      const x = B.BOX_OF[i];
      if (m.row[r] & b || m.col[c] & b || m.box[x] & b) {
        return { count: 0, solution: null, nodes, exhausted: false };
      }
      m.row[r] |= b;
      m.col[c] |= b;
      m.box[x] |= b;
    }

    function rec() {
      // 选候选最少的空格；并列时优先靠近已有数字的位置，让搜索更早收敛
      let best = -1;
      let bestMask = 0;
      let bestCount = 10;
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (g[i]) continue;
        const mask = ALL & ~(m.row[B.ROW_OF[i]] | m.col[B.COL_OF[i]] | m.box[B.BOX_OF[i]]);
        const c = B.popcount(mask);
        if (c < bestCount) {
          bestCount = c;
          best = i;
          bestMask = mask;
          if (c <= 1) break;
        }
      }
      if (best === -1) {
        count++;
        if (!first) first = g.slice();
        return count >= limit;
      }
      if (bestCount === 0) return false;

      const r = B.ROW_OF[best];
      const c = B.COL_OF[best];
      const x = B.BOX_OF[best];
      let mask = bestMask;
      if (rng) {
        // 随机试数字的顺序：确定性回溯在空盘上永远返回同一个解，
        // 那样生成出来的每一道题解出来都一样。
        const bits = [];
        let mm = mask;
        while (mm) {
          const lb = mm & -mm;
          mm ^= lb;
          bits.push(lb);
        }
        for (let k = bits.length - 1; k > 0; k--) {
          const j = (rng() * (k + 1)) | 0;
          const t = bits[k]; bits[k] = bits[j]; bits[j] = t;
        }
        for (const lb of bits) {
          nodes++;
          g[best] = Math.round(Math.log2(lb)) + 1;
          m.row[r] |= lb;
          m.col[c] |= lb;
          m.box[x] |= lb;
          const stop = rec();
          m.row[r] &= ~lb;
          m.col[c] &= ~lb;
          m.box[x] &= ~lb;
          g[best] = 0;
          if (stop) return true;
        }
        return false;
      }
      while (mask) {
        const lb = mask & -mask;
        mask ^= lb;
        nodes++;
        g[best] = Math.round(Math.log2(lb)) + 1;
        m.row[r] |= lb;
        m.col[c] |= lb;
        m.box[x] |= lb;
        const stop = rec();
        m.row[r] &= ~lb;
        m.col[c] &= ~lb;
        m.box[x] &= ~lb;
        g[best] = 0;
        if (stop) return true;
      }
      return false;
    }

    rec();
    return { count, solution: first, nodes, exhausted: count < limit };
  }

  /** 只要一个解；无解返回 null。传 rng 可让搜索顺序随机化。 */
  function solveOne(grid, rng) {
    const r = solve(grid, 1, rng);
    return r.solution;
  }

  /**
   * 挖洞生成完整盘面：随机回溯填满 9x9。
   * 先随机撒 30% 左右数字再求解，比纯顺序回溯能产出更「自然」的终盘。
   */
  function randomFullGrid(rng) {
    const g = new Uint8Array(B.CELL_COUNT);
    for (let i = 0; i < B.CELL_COUNT; i++) if (rng() < 0.3) g[i] = 1 + ((rng() * 9) | 0);
    const s = solveOne(g);
    if (s) return s;

    // 撒的种子太倒霉时退回纯随机回溯兜底
    const empty = new Uint8Array(B.CELL_COUNT);
    return solveOne(empty);
  }

  /**
   * 随机生成一个完整合法终盘。
   * 直接在空盘上做随机顺序回溯：确定性回溯每次都会返回同一个规范解
   * （123456789 / 456789123 / 789123456 那个循环格），那样每一道题解出来都一样。
   * 早先的写法是先撒 30% 随机数再求解，但那些盘面经常自带冲突、根本没有解，
   * 于是每次都退回空盘求解——终盘因此完全固定。
   */
  function randomFullGrid(rng) {
    const s = solveOne(new Uint8Array(B.CELL_COUNT), rng);
    return s || solveOne(new Uint8Array(B.CELL_COUNT), rng);
  }

  /** 基于给定终盘，随机回溯出一条到达它的合法填法（用于终盘多样化） */
  function randomizedSolve(grid, rng, limit = 2) {
    return solve(grid, limit, rng);
  }

  SD.Solver = { solve, solveOne, randomFullGrid };
})(window);
