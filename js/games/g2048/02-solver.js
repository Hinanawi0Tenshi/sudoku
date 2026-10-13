/* 2048 · 走法评估（expectimax）
 *
 * 2048 每一步都有随机成分（新牌落哪、是 2 还是 4），所以不能像棋类那样做极小极大。
 * 玩家节点取最大、随机节点取期望——这就是 expectimax。
 *
 * 只用来给「提示」判断该往哪边推，不参与出题（2048 没有出题，开局全是随机）。
 * 它给的是**期望分最高的方向**，不是保证最优——所以界面上必须写成「建议」，
 * 不能写成「最优」。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const G = (SD.G2048 = SD.G2048 || {});

  /* 权重取自经典的 2048 AI。空位最重要（留出腾挪空间），单调性次之
   * （让大牌聚在一角、按顺序排开），平滑度再次（相邻牌差距别太大）。 */
  const W_EMPTY = 270;
  const W_MONO = 47;
  const W_SMOOTH = 8;

  function evaluate(cells, n) {
    let empty = 0;
    let smooth = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = cells[r * n + c];
        if (!v) { empty++; continue; }
        const lv = Math.log2(v);
        if (c + 1 < n && cells[r * n + c + 1]) {
          smooth -= Math.abs(lv - Math.log2(cells[r * n + c + 1]));
        }
        if (r + 1 < n && cells[(r + 1) * n + c]) {
          smooth -= Math.abs(lv - Math.log2(cells[(r + 1) * n + c]));
        }
      }
    }

    // 单调性：行和列各自算「递增方向」和「递减方向」哪个更划算，取大的那个再加起来
    let mono = 0;
    for (let r = 0; r < n; r++) {
      let inc = 0, dec = 0;
      for (let c = 0; c + 1 < n; c++) {
        const a = cells[r * n + c] ? Math.log2(cells[r * n + c]) : 0;
        const b = cells[r * n + c + 1] ? Math.log2(cells[r * n + c + 1]) : 0;
        if (a > b) dec += b - a; else inc += a - b;
      }
      mono += Math.max(inc, dec);
    }
    for (let c = 0; c < n; c++) {
      let inc = 0, dec = 0;
      for (let r = 0; r + 1 < n; r++) {
        const a = cells[r * n + c] ? Math.log2(cells[r * n + c]) : 0;
        const b = cells[(r + 1) * n + c] ? Math.log2(cells[(r + 1) * n + c]) : 0;
        if (a > b) dec += b - a; else inc += a - b;
      }
      mono += Math.max(inc, dec);
    }

    return empty * W_EMPTY + smooth * W_SMOOTH + mono * W_MONO;
  }

  let nodes = 0;

  function search(cells, n, depth, player) {
    if (++nodes > 200000) return evaluate(cells, n);
    if (depth <= 0) return evaluate(cells, n);

    if (player) {
      let best = -Infinity;
      for (const dir of G.DIRS) {
        const r = G.preview(cells, n, dir);
        if (!r) continue;
        const v = search(r.cells, n, depth - 1, false);
        if (v > best) best = v;
      }
      // 一步都推不动：这盘死了，给一个极低的估值
      return best === -Infinity ? -1e9 : best;
    }

    const free = [];
    for (let i = 0; i < cells.length; i++) if (!cells[i]) free.push(i);
    if (!free.length) return search(cells, n, depth - 1, true);

    // 每个空格都有机会落牌，落 2 的概率 0.9、落 4 的 0.1
    let total = 0;
    for (const i of free) {
      for (const pair of [[2, 0.9], [4, 0.1]]) {
        const next = Int16Array.from(cells);
        next[i] = pair[0];
        total += pair[1] * search(next, n, depth - 1, true);
      }
    }
    return total / free.length;
  }

  /**
   * 四个方向各算一个期望分，返回排好序的候选。
   * @returns {Array<{dir:string, expect:number}>} 推不动的方向不在里面
   */
  function rank(b, depth) {
    nodes = 0;
    const d = depth || 3;
    const out = [];
    for (const dir of G.DIRS) {
      const r = G.preview(b.cells, b.size, dir);
      if (!r) continue;
      out.push({ dir: dir, expect: search(r.cells, b.size, d - 1, false) + r.gained });
    }
    out.sort((a, x) => x.expect - a.expect);
    return out;
  }

  G.solver = { rank: rank, evaluate: evaluate, nodes: () => nodes };
})(window);
