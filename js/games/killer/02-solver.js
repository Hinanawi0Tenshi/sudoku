/* 杀手数独 · 机器求解器
 *
 * 和数独求解器的区别只有一处：候选数多了「笼子」这一层约束。
 * 因此传播更强、搜索更浅，代价是每次取候选要查一次组合表。
 *
 * 用途和数独那边一样：出题时判断唯一解、校验导入的题目。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;
  const C = K.cages;

  /**
   * @param {object} puz   K.cages.create(...) 的产物
   * @param {number} limit 找到这么多个解就提前停下
   * @param {function} [rng] 打乱试数顺序，生成终盘时要
   * @param {Uint8Array} [initial] 从这个盘面接着解（试数技巧要用）
   * @returns {{count:number, solution:Uint8Array|null, nodes:number}}
   */
  function solve(puz, limit, rng, initial) {
    const n = B.CELL_COUNT;
    const g = initial ? Uint8Array.from(initial) : new Uint8Array(n);
    const row = new Uint16Array(9);
    const col = new Uint16Array(9);
    const box = new Uint16Array(9);
    const cUsed = new Int32Array(puz.list.length);
    const cEmpty = new Int32Array(puz.list.length);
    const cLeft = new Int32Array(puz.list.length);
    for (let c = 0; c < puz.list.length; c++) {
      cEmpty[c] = puz.list[c].cells.length;
      cLeft[c] = puz.list[c].sum;
    }
    // 已经有值的格子先装进各行列宫和笼子的掩码里；出现重复说明前提已矛盾，直接 0 解
    if (initial) {
      for (let i = 0; i < n; i++) {
        const d = g[i];
        if (!d) continue;
        const b = B.bit(d);
        const r = B.ROW_OF[i];
        const cc = B.COL_OF[i];
        const bx = B.BOX_OF[i];
        const c = puz.cageOf[i];
        if (row[r] & b || col[cc] & b || box[bx] & b || cUsed[c] & b) {
          return { count: 0, solution: null, nodes: 0 };
        }
        row[r] |= b; col[cc] |= b; box[bx] |= b;
        cUsed[c] |= b; cEmpty[c]--; cLeft[c] -= d;
      }
    }

    let nodes = 0;
    let count = 0;
    let first = null;

    function candOf(i) {
      const c = puz.cageOf[i];
      const cm = C.possible(cEmpty[c], cLeft[c]);
      if (!cm) return 0;
      return B.ALL & ~(row[B.ROW_OF[i]] | col[B.COL_OF[i]] | box[B.BOX_OF[i]]) & cm & ~cUsed[c];
    }

    function rec() {
      // MRV：选候选最少的空格。笼子约束一叠，多数节点一进递归就只剩一两格可选。
      let best = -1;
      let bestMask = 0;
      let bestCount = 10;
      for (let i = 0; i < n; i++) {
        if (g[i]) continue;
        const m = candOf(i);
        const k = B.popcount(m);
        if (k < bestCount) {
          bestCount = k;
          best = i;
          bestMask = m;
          if (k <= 1) break;
        }
      }
      if (best < 0) {
        count++;
        if (!first) first = g.slice();
        return count >= limit;
      }
      if (bestCount === 0) return false;

      const c = puz.cageOf[best];
      const r = B.ROW_OF[best];
      const cc = B.COL_OF[best];
      const bx = B.BOX_OF[best];
      let mask = bestMask;
      const bits = [];
      while (mask) {
        const lb = mask & -mask;
        mask ^= lb;
        bits.push(lb);
      }
      if (rng) {
        for (let k = bits.length - 1; k > 0; k--) {
          const j = (rng() * (k + 1)) | 0;
          const t = bits[k]; bits[k] = bits[j]; bits[j] = t;
        }
      }
      for (const lb of bits) {
        const d = Math.round(Math.log2(lb)) + 1;
        nodes++;
        g[best] = d;
        row[r] |= lb; col[cc] |= lb; box[bx] |= lb;
        cUsed[c] |= lb; cEmpty[c]--; cLeft[c] -= d;
        const stop = rec();
        cUsed[c] &= ~lb; cEmpty[c]++; cLeft[c] += d;
        row[r] &= ~lb; col[cc] &= ~lb; box[bx] &= ~lb;
        g[best] = 0;
        if (stop) return true;
      }
      return false;
    }

    rec();
    return { count: count, solution: first, nodes: nodes };
  }

  const countSolutions = (puz, limit) => solve(puz, limit || 2).count;

  /** 唯一解判定。导入和生成都要过这一关。 */
  function hasUnique(puz) {
    const r = solve(puz, 2);
    return r.count === 1 ? { unique: true, solution: r.solution } : { unique: false, count: r.count };
  }

  /** 题目自洽性：每个格子恰好属于一个笼子，笼内数字在真解里不重复 */
  function validateShape(puz) {
    const seen = new Uint8Array(B.CELL_COUNT);
    for (const cg of puz.list) {
      if (!cg.cells.length) return '有空笼子';
      if (cg.cells.length > 9) return '笼子超过 9 格';
      for (const i of cg.cells) {
        if (seen[i]) return '第 ' + i + ' 格属于多个笼子';
        seen[i] = 1;
      }
    }
    for (let i = 0; i < B.CELL_COUNT; i++) if (!seen[i]) return '第 ' + i + ' 格不属于任何笼子';
    return null;
  }

  K.solver = { solve: solve, countSolutions: countSolutions, hasUnique: hasUnique, validateShape: validateShape };
})(window);
