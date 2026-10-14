/* 华容道 · 全状态 BFS
 *
 * 这个游戏有个别处没有的便利：**可达状态只有五万多个**。所以不必逐步搜索——
 * 一次 BFS 把所有状态到目标的最短距离全算出来，之后：
 *   · 提示 = 沿最短路径走一步（永远最优，不存在"算不动"）
 *   · 难度 = 最短步数，直接读表
 *   · 出题 = 从表里挑一个指定距离的局面
 *
 * 目标不是一个局面，而是「曹操在底部中间」的一整族局面（实测 6795 个），
 * 所以 BFS 从**所有**目标局面一起出发（多源 BFS）。移动可逆，反向 BFS 等价于正向。
 *
 * 实现上用「每格属于哪一块」的格子，碰撞就是查那几格是不是空的——
 * 比拿矩形两两判重叠快好几倍（200 多万次循环，这里省下来的是秒级的差别）。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const K = (SD.Klotski = SD.Klotski || {});

  const W = K.W, H = K.H, N = 10;
  const EMPTY = 255;

  /** 键里的空格用 4（类型只有 0~3），和 01-core.js 的编码保持一致 */
  const KEY_EMPTY = 4;

  const KEY_BUF = new Uint8Array(W * H);
  function keyOfGrid(grid, types) {
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      KEY_BUF[i] = v === EMPTY ? KEY_EMPTY : types[v];
    }
    return String.fromCharCode.apply(null, KEY_BUF);
  }

  function shapeArrays() {
    const base = K.classicPieces();
    const types = new Uint8Array(N), pw = new Uint8Array(N), ph = new Uint8Array(N);
    for (let i = 0; i < N; i++) { types[i] = base[i].type; pw[i] = base[i].w; ph[i] = base[i].h; }
    return { types: types, pw: pw, ph: ph, names: base.map((p) => p.name) };
  }

  /** 目标族：曹操固定在 (3,1)，其余 9 块自由摆放 */
  function enumerateGoals(pw, ph) {
    const out = [];
    const grid = new Uint8Array(W * H).fill(EMPTY);
    for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) grid[(3 + dr) * W + (1 + dc)] = 0;
    (function rec(k) {
      if (k === N) { out.push(Uint8Array.from(grid)); return; }
      const w = pw[k], h = ph[k];
      for (let r = 0; r + h <= H; r++) {
        for (let c = 0; c + w <= W; c++) {
          let ok = true;
          for (let dr = 0; dr < h && ok; dr++) {
            for (let dc = 0; dc < w; dc++) if (grid[(r + dr) * W + c + dc] !== EMPTY) { ok = false; break; }
          }
          if (!ok) continue;
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[(r + dr) * W + c + dc] = k;
          rec(k + 1);
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) grid[(r + dr) * W + c + dc] = EMPTY;
        }
      }
    })(1);
    return out;
  }

  /** 从一批源局面做多源 BFS，返回每个可达局面的最短距离和位置表 */
  function bfs(sources, types, pw, ph) {
    const dist = new Map();
    const states = [];
    const dq = [];
    let head = 0;

    // 队列里存「每块左上角在哪」（10 块 × 2 个数），不存格子图。
    // 出队时再铺一次格子（20 次写），比每次扫 200 格去找每块的位置便宜一个量级。
    for (const pos of sources) {
      const k = keyOfGrid(gridFromPos(pos, pw, ph), types);
      if (dist.has(k)) continue;
      dist.set(k, 0);
      states.push(Uint8Array.from(pos));
      dq.push(0);
    }

    const next = new Uint8Array(W * H);
    const grid = new Uint8Array(W * H);
    while (head < states.length) {
      const pos = states[head];
      const d = dq[head];
      head++;
      grid.fill(EMPTY);
      for (let i = 0; i < N; i++) {
        const pr = pos[i * 2], pc = pos[i * 2 + 1];
        for (let dr = 0; dr < ph[i]; dr++) for (let dc = 0; dc < pw[i]; dc++) grid[(pr + dr) * W + pc + dc] = i;
      }
      for (let i = 0; i < N; i++) {
        const pr = pos[i * 2], pc = pos[i * 2 + 1];
        const w = pw[i], h = ph[i];
        for (let k2 = 0; k2 < 4; k2++) {
          const dir = K.DIRS[k2];
          const nr = pr + dir[0], nc = pc + dir[1];
          if (nr < 0 || nc < 0 || nr + h > H || nc + w > W) continue;
          let ok = true;
          for (let dr = 0; dr < h && ok; dr++) {
            for (let dc = 0; dc < w; dc++) {
              const v = grid[(nr + dr) * W + nc + dc];
              if (v !== EMPTY && v !== i) { ok = false; break; }
            }
          }
          if (!ok) continue;
          next.set(grid);
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) next[(pr + dr) * W + pc + dc] = EMPTY;
          for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) next[(nr + dr) * W + nc + dc] = i;
          const key = keyOfGrid(next, types);
          if (dist.has(key)) continue;
          const npos = Uint8Array.from(pos);
          npos[i * 2] = nr; npos[i * 2 + 1] = nc;
          dist.set(key, d + 1);
          states.push(npos);
          dq.push(d + 1);
        }
      }
    }
    return { dist: dist, states: states, dq: dq };
  }

  function gridFromPos(pos, pw, ph) {
    const g = new Uint8Array(W * H).fill(EMPTY);
    for (let i = 0; i < N; i++) {
      const pr = pos[i * 2], pc = pos[i * 2 + 1];
      for (let dr = 0; dr < ph[i]; dr++) for (let dc = 0; dc < pw[i]; dc++) g[(pr + dr) * W + pc + dc] = i;
    }
    return g;
  }

  let cache = null;

  /**
   * 建表。**两遍 BFS，不枚举目标族。**
   *
   * 目标不是一个局面，而是「曹操在底部中间」的一整族（6795 个）。直觉做法是把它们
   * 全枚举出来当源，但实测枚举本身要 1.4 秒，比 BFS 本体（322ms）贵四倍还多。
   *
   * 换个思路：先从经典开局 BFS 一遍，可达状态就那么五万多个；再从里面挑出
   * 「曹操在底部中间」的那些当第二遍的源。两遍加起来 644ms，枚举整块省掉。
   */
  function buildTable() {
    if (cache) return cache;
    const t0 = Date.now();
    const sh = shapeArrays();
    const { types, pw, ph } = sh;

    const classic = K.classicPieces();
    const startPos = new Uint8Array(N * 2);
    for (let i = 0; i < N; i++) { startPos[i * 2] = classic[i].r; startPos[i * 2 + 1] = classic[i].c; }

    const pass1 = bfs([startPos], types, pw, ph);
    const goals = pass1.states.filter((pos) => pos[0] === 3 && pos[1] === 1);
    const pass2 = bfs(goals, types, pw, ph);

    let maxDist = 0;
    for (const v of pass2.dist.values()) if (v > maxDist) maxDist = v;
    cache = {
      dist: pass2.dist, states: pass2.states, dq: pass2.dq, shapes: sh,
      reachable: pass1.states.length, goalCount: goals.length,
      maxDist: maxDist, ms: Date.now() - t0,
    };
    return cache;
  }

  const table = () => buildTable();
  /** 表建好了没——app 用它决定要不要先弹「正在准备」的遮罩 */
  const isReady = () => cache !== null;

  /** 由 pieces 生成格子 */
  function gridOf(pieces) {
    const g = new Uint8Array(W * H).fill(EMPTY);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) g[(p.r + dr) * W + p.c + dc] = i;
    }
    return g;
  }

  function distanceOf(pieces) {
    const t = buildTable();
    const v = t.dist.get(K.keyOf(pieces));
    return v === undefined ? -1 : v;
  }

  /**
   * 最优下一步。全状态表在手，这里**永远是最优**，不存在"算不动就退而求其次"。
   */
  function bestMove(b) {
    const t = buildTable();
    const cur = K.keyOf(b.pieces);
    const d = t.dist.get(cur);
    if (d === undefined || d === 0) return null;
    const grid = gridOf(b.pieces);
    for (let i = 0; i < b.pieces.length; i++) {
      const p = b.pieces[i];
      for (let k2 = 0; k2 < 4; k2++) {
        const dir = K.DIRS[k2];
        const nr = p.r + dir[0], nc = p.c + dir[1];
        if (nr < 0 || nc < 0 || nr + p.h > H || nc + p.w > W) continue;
        if (!K.canShift(b, i, dir[0], dir[1])) continue;
        const next = Uint8Array.from(grid);
        for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) next[(p.r + dr) * W + p.c + dc] = EMPTY;
        for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) next[(nr + dr) * W + nc + dc] = i;
        const nk = keyOfGrid(next, t.shapes.types);
        if (t.dist.get(nk) === d - 1) {
          return { index: i, dr: dir[0], dc: dir[1], dir: dir[2], remain: d, name: p.name };
        }
      }
    }
    return null;
  }

  /** 由位置数组还原成 pieces（出题和测试都要用） */
  function piecesOf(pos, sh) {
    const out = [];
    for (let i = 0; i < N; i++) {
      out.push({ type: sh.types[i], name: sh.names[i], w: sh.pw[i], h: sh.ph[i], r: pos[i * 2], c: pos[i * 2 + 1] });
    }
    return out;
  }

  K.solver = {
    buildTable: buildTable, table: table, distanceOf: distanceOf, bestMove: bestMove,
    keyOfGrid: keyOfGrid, gridOf: gridOf, enumerateGoals: enumerateGoals, shapeArrays: shapeArrays,
    piecesOf: piecesOf, isReady: isReady,
  };
})(window);
