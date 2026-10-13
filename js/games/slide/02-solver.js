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

  /**
   * 算不动时的退路：挑「能让某一块离目标更近」的那一步。
   *
   * 注意**不能要求一定有正收益**：滑块经常出现「所有走法都会让某块变远」的局面——
   * 那正是要给后面的块让路的时候。早先这里返回 -1，提示就变成了 null，
   * 界面上表现成「点了提示没反应」。所以哪怕全是负收益，也要挑最好的那一步。
   *
   * @returns {{cell:number, delta:number}} delta > 0 表示这一步净缩短了几格
   */
  function greedy(b) {
    const n = b.n;
    let bestCell = -1, bestDelta = -Infinity;
    for (const j of S.neighborsOf(n, b.empty)) {
      const t = b.cells[j];
      if (!t) continue;
      const g = t - 1;
      const from = Math.abs(((j / n) | 0) - ((g / n) | 0)) + Math.abs((j % n) - (g % n));
      const to = Math.abs(((b.empty / n) | 0) - ((g / n) | 0)) + Math.abs((b.empty % n) - (g % n));
      const delta = from - to;
      if (delta > bestDelta) { bestDelta = delta; bestCell = j; }
    }
    return { cell: bestCell, delta: bestCell < 0 ? 0 : bestDelta };
  }

  S.solver = { solve: solve, greedy: greedy, heuristic: heuristic, manhattan: manhattan };
})(window);
