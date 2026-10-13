/* 数字华容道 · 提示
 *
 * 和数独/杀手不一样：滑块的每一步都不是「逻辑上被迫」的，没有唯一正确解，
 * 只有「最短」和「不最短」。所以提示分两档，而且**必须在界面上说清是哪一档**：
 *
 *   3×3  —— A* 秒出最优解，给「最优下一步」
 *   4×4+ —— A* 带节点上限试一把，算不动就退成「就近一步」，如实标注不保证最优
 *
 * 5×5 的状态空间是 25!/2，最优解基本不用想。假装算过比说算不动更糟。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const S = (SD.Slide = SD.Slide || {});

  /** 按板子大小给节点上限：越大越贵，3×3 干脆放开 */
  const CAPS = { 3: 200000, 4: 60000, 5: 15000 };

  /** 这块数字往哪个方向滑（它滑进空格里） */
  function directionOf(b, i) {
    const e = b.empty;
    if (e === i - b.n) return '上';
    if (e === i + b.n) return '下';
    if (e === i - 1) return '左';
    if (e === i + 1) return '右';
    return '';
  }

  function makeStep(b, cell, optimal, remaining, delta) {
    const tile = b.cells[cell];
    const dir = directionOf(b, cell);
    const r = (i) => ((i / b.n) | 0) + 1;
    const c = (i) => (i % b.n) + 1;
    const e = b.empty;
    return {
      id: optimal ? 'slide-best' : 'slide-near',
      level: 1,
      name: optimal ? '最优下一步' : '就近一步',
      cells: [cell, e],
      tile: tile,
      optimal: optimal,
      remaining: remaining,
      explain: {
        name: optimal ? '最优下一步' : '就近一步',
        derivation: [
          '空格在 R' + r(e) + 'C' + c(e) + '，能滑进来的只有它上下左右那几块。',
          optimal
            ? '把所有走法展开搜了一遍，这一步之后 ' + remaining + ' 步能收完，是最短的。'
            : (delta > 0
              ? '这一步能让 ' + tile + ' 离目标近 ' + delta + ' 格。'
              : '这一步会让 ' + tile + ' 离目标远一点——但它周围没有更划算的走法了，'
                + '得先把它挪开，给后面的块让路。'),
        ],
        conclusion: '把 ' + tile + ' 往' + dir + '滑。',
        principle: '滑块每一格都只有 2~4 种走法，所以「全部走法」是可以穷举的。'
          + '搜的时候用曼哈顿距离（每块离目标还差几格）加上线性冲突（同行两块顺序反了要多绕两步）'
          + '估一个下界，就能一路挑最有希望的方向先搜，不必真的把整棵树铺开。',
        pitfalls: optimal
          ? '最短解不等于「看起来最顺」——它常常要先绕远路，好给后面的块腾位置。'
          : '这条是按「离目标更近」就近挑的，不保证最短；板子越大越容易走到死胡同。',
      },
    };
  }

  /** 当前局面该走哪一步；没有可走的返回 null */
  function best(b) {
    // 用 solved() 而不是 state：刚 create 出来的板子是终局但 state 还是 ready，
    // 只看 state 会给终局也算出一条"提示"，那一步纯属凭空捏造。
    if (!b || S.solved(b)) return null;
    const cap = CAPS[b.n] || 20000;
    const r = S.solver.solve(b, cap);
    if (r && r.first >= 0) return makeStep(b, r.first, true, r.moves, 0);
    const g = S.solver.greedy(b);
    if (g.cell < 0) return null;      // 只有空格四面都出界时才会到这（盘面 1×1）
    return makeStep(b, g.cell, false, null, g.delta);
  }

  S.hints = { best: best, directionOf: directionOf, CAPS: CAPS };
})(window);
