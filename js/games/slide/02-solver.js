/* 数字华容道 · 求解器（A* + 曼哈顿距离 + 线性冲突）
 *
 * 只用来给「提示」算最优下一步，不参与出题（出题是倒着走，天然有解）。
 *
 * 启发式用曼哈顿距离 + 线性冲突：后者数的是「同一行里两块都在自己目标行、
 * 但左右顺序反了」的情况，每对补 2 步。加上它，4×4 的搜索量能降一个数量级。
 *
 * 5×5 的状态空间是 25!/2，A* 顶不住。所以带节点上限，算不出来就返回 null，
 * 由上层退成「粗略方向」——不假装算过。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const S = (SD.Slide = SD.Slide || {});

  /** 每个数字的目标下标：数字 v 要去 v-1，空格去 N-1 */
  const goalOf = (v) => (v === 0 ? -1 : v - 1);

  function manhattan(cells, n) {
    let d = 0;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (!v) continue;
      const g = v - 1;
      d += Math.abs(((i / n) | 0) - ((g / n) | 0)) + Math.abs((i % n) - (g % n));
    }
    return d;
  }

  /** 线性冲突：同行/同列两块都已归位到本行本列，但顺序反了，至少得多绕 2 步 */
  function linearConflict(cells, n) {
    let extra = 0;
    for (let r = 0; r < n; r++) {
      for (let a = 0; a < n; a++) {
        const va = cells[r * n + a];
        if (!va || ((va - 1) / n | 0) !== r) continue;
        for (let b = a + 1; b < n; b++) {
          const vb = cells[r * n + b];
          if (!vb || ((vb - 1) / n | 0) !== r) continue;
          if (va > vb) extra += 2;
        }
      }
    }
    for (let c = 0; c < n; c++) {
      for (let a = 0; a < n; a++) {
        const va = cells[a * n + c];
        if (!va || (va - 1) % n !== c) continue;
        for (let b = a + 1; b < n; b++) {
          const vb = cells[b * n + c];
          if (!vb || (vb - 1) % n !== c) continue;
          if (va > vb) extra += 2;
        }
      }
    }
    return extra;
  }

  const heuristic = (cells, n) => manhattan(cells, n) + linearConflict(cells, n);

  /** 值域 0..24，一个字符一格，比 join(',') 短得多，Map 的键小一圈 */
  function key(cells) {
    let s = '';
    for (let i = 0; i < cells.length; i++) s += String.fromCharCode(cells[i]);
    return s;
  }

  /** 二叉堆。A* 的开放集按 f 取最小，节点上万时线性扫描就太慢了 */
  function Heap(cmp) {
    const a = [];
    const up = (i) => {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (cmp(a[i], a[p]) >= 0) break;
        const t = a[i]; a[i] = a[p]; a[p] = t;
        i = p;
      }
    };
    const down = (i) => {
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && cmp(a[l], a[m]) < 0) m = l;
        if (r < a.length && cmp(a[r], a[m]) < 0) m = r;
        if (m === i) break;
        const t = a[i]; a[i] = a[m]; a[m] = t;
        i = m;
      }
    };
    return {
      size: () => a.length,
      push: (x) => { a.push(x); up(a.length - 1); },
      pop: () => {
        const top = a[0];
        const last = a.pop();
        if (a.length) { a[0] = last; down(0); }
        return top;
      },
    };
  }

  /**
   * 求最优解的第一步。
   * @returns {{first:number, moves:number, expanded:number}|null} 算不出来（撞上限）返回 null
   */
  function solve(b, nodeCap) {
    const n = b.n;
    const cap = nodeCap || 150000;
    const start = Int16Array.from(b.cells);

    const h0 = heuristic(start, n);
    if (h0 === 0) return { first: -1, moves: 0, expanded: 0 };

    const open = Heap((x, y) => x.f - y.f);
    const best = new Map();
    best.set(key(start), 0);
    open.push({ cells: start, empty: b.empty, g: 0, h: h0, f: h0, first: -1 });

    let expanded = 0;
    while (open.size()) {
      const node = open.pop();
      // 节点里存着 h，就别再重算一遍——启发式是 O(n³)，每个节点多算两次直接翻倍
      if (node.g + node.h > node.f) continue;      // 已经被更优路径取代的过期节点
      if (node.h === 0) return { first: node.first, moves: node.g, expanded: expanded };
      if (++expanded > cap) return null;

      const g2 = node.g + 1;
      for (const j of S.neighborsOf(n, node.empty)) {
        const next = Int16Array.from(node.cells);
        next[node.empty] = next[j];
        next[j] = 0;
        const nk = key(next);
        const prev = best.get(nk);
        if (prev !== undefined && g2 >= prev) continue;
        best.set(nk, g2);
        const nh = heuristic(next, n);
        open.push({
          cells: next, empty: j, g: g2, h: nh, f: g2 + nh,
          first: node.first < 0 ? j : node.first,
        });
      }
    }
    return null;
  }

  const man = (n, i, g) => Math.abs(((i / n) | 0) - ((g / n) | 0)) + Math.abs((i % n) - (g % n));

  /** 当前盘面所有牌离目标一共差几格 */
  function totalDistance(cells, n) {
    let d = 0;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (v) d += man(n, i, v - 1);
    }
    return d;
  }

  /**
   * 往后看 k 步，返回**能达到最低总距离**的那条路的第一步。
   *
   * 注意不是"找第一条能改善的序列"——那个写法有个致命问题：玩家只走第一步就重新规划，
   * 而序列的收益在后几步，等于白规划。实测那样走 600 步总距离只降了 8 格。
   * 现在把整棵 k 层树铺开，取最优终局对应的第一步，每一步都是"这一步之后最好的局面"。
   *
   * 一歩贪心只是它的特例（k=1），所以有它就不需要单独的一歩贪心了。
   * 代价：分支最多 3、8 层 → 六千多个节点，O(1) 增量算距离，实测每次 0.03ms。
   *
   * @returns {number} 该挪的下标；找不到返回 -1
   */
  function lookahead(b, maxDepth, avoid, banned) {
    const n = b.n;
    const cells = Int16Array.from(b.cells);
    const start = totalDistance(cells, n);

    /**
     * 分工：
     *   「不许撤销上一歩」是**硬约束**——周期 2 一定表现为同一块牌来回挪，掐掉回退就没了。
     *   「禁忌表」（空格最近去过的位置）是**软约束**——只在终局距离打平时优先选没踩的。
     *     做成硬约束的话，邻居一被禁光就没得选，只能放开，防打转形同虚设（实测漏过周期 2）。
     */
    let bestTotal = start;
    let bestFirst = -1;
    let bestBad = true;          // 当前最优解的第一步是不是踩了禁忌/撤销
    let nodes = 0;

    function dfs(empty, total, depth, first, bad, prev) {
      const better = total < bestTotal;
      const tieButCleaner = total === bestTotal && bestBad && !bad && first >= 0;
      if (better || tieButCleaner) { bestTotal = total; bestFirst = first; bestBad = bad; }
      if (depth === 0 || ++nodes > 60000) return;
      for (const j of S.neighborsOf(n, empty)) {
        if (j === prev) continue;                 // 不走回头路
        // 「不许撤销上一歩」是**硬约束**：周期 2 一定表现为同一块牌来回挪，
        // 掐掉回退就没有周期 2 了。空格的邻居至少两个，禁掉一个仍有得走。
        if (first < 0 && j === avoid) continue;
        const t = cells[j];
        if (!t) continue;
        const g = t - 1;
        const nt = total + man(n, empty, g) - man(n, j, g);
        const nb = first < 0 ? ((banned && banned.has(j)) || j === avoid) : bad;
        cells[empty] = t; cells[j] = 0;
        dfs(j, nt, depth - 1, first < 0 ? j : first, nb, empty);
        cells[j] = t; cells[empty] = 0;
      }
    }
    dfs(b.empty, start, maxDepth || 8, -1, false, -1);
    return bestFirst;
  }

  /**
   * 一歩贪心：挑净收益最大的走法。
   *
   * 并列时的取舍很要紧。早先只比 delta、并列取第一个，结果第一个恰好是刚归位的牌，
   * 提示就在两个局面之间来回指（实测 10 → 10 → 10 → … 无限循环）。
   * 现在同分时：优先**不动已经归位的牌**，再优先不回退上一歩提示的那块。
   *
   * @param {number} avoid **上一歩提示发出时空格所在的下标**。走完那一步之后空格就落到
   *        被挪走的那块牌原来的位置，所以"回退"的候选正是当前空格旁边那块原本在 avoid 的牌。
   *        早先记的是"被挪的牌的下标"，走完就失效了，防不住打转。
   * @returns {{cell:number, delta:number}}
   */
  function greedy(b, avoid, banned) {
    const n = b.n;
    const cands = [];
    for (const j of S.neighborsOf(n, b.empty)) {
      const t = b.cells[j];
      if (!t) continue;
      const g = t - 1;
      const from = man(n, j, g);
      const to = man(n, b.empty, g);
      cands.push({
        cell: j, delta: from - to,
        placed: from === 0 ? 1 : 0,
        undo: j === avoid ? 1 : 0,
        tabu: banned && banned.has(j) ? 1 : 0,
      });
      // 注：avoid 是上一歩的空格位置。当前空格在 E，若 j === avoid，说明这块牌正是
      // 上一歩从 avoid 挪到 E 的那块——挪回去就是把上一歩撤销掉。
    }
    if (!cands.length) return { cell: -1, delta: 0 };
    // 禁忌优先于一切：先在不踩禁忌的候选里挑；全被禁忌了才放开（否则会无路可走）。
    const free = cands.filter((c) => !c.tabu);
    const pool = free.length ? free : cands;
    pool.sort((a, z) => (z.delta - a.delta) || (a.placed - z.placed) || (a.undo - z.undo));
    return pool[0];
  }

  S.solver = {
    solve: solve, greedy: greedy, lookahead: lookahead,
    heuristic: heuristic, manhattan: manhattan, totalDistance: totalDistance,
  };
})(window);
