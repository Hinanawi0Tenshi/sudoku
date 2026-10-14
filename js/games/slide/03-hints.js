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

  /**
   * 只在这些距离以内才试 A*。
   *
   * A* 失败时要把节点上限跑满才肯放弃——5×5 那是 60ms 白等。而实测 5×5 打乱超过
   * 80 步之后 A* 的成功率就是 0/8，继续试纯属浪费。距离远就直接走启发式。
   */
  const GATE = { 3: 9999, 4: 34, 5: 26 };

  /** 这块数字往哪个方向滑（它滑进空格里） */
  function directionOf(b, i) {
    const e = b.empty;
    if (e === i - b.n) return '上';
    if (e === i + b.n) return '下';
    if (e === i - 1) return '左';
    if (e === i + 1) return '右';
    return '';
  }

  /**
   * 上一歩提示发出时空格在哪。
   * 记"空格位置"而不是"被挪的牌"：走完那一步后空格落到那块牌原来的位置，
   * 所以"撤销上一歩"的候选就是当前空格旁边那块原本在 avoid 的牌。记牌的下标走完就失效了。
   */
  let lastEmpty = -1;

  /**
   * 最近几次提示发出时空格在哪——禁忌表。
   *
   * 为什么需要：一歩贪心（曼哈顿距离）在滑块上必然有局部最优，卡住时提示会来回指，
   * 玩家看到的是"把 10 往下滑"接着"把 10 往上滑"，实测能无限循环。
   * 光靠"别撤销上一歩"防不住——回退那一步往往恰好是 delta 最高的。
   * 禁忌表直接禁止空格在短期内回到去过的位置，短周期从根上没了。
   */
  const tabu = [];
  // 只记最近 3 个。记 10 个会把空格的邻居全禁光，lookahead 只能放开限制，
  // 防打转就漏了（实测周期 2 会从这儿钻进来）。3 个正好够挡住周期 2 和周期 3。
  const TABU_LEN = 3;

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
              : '这一步看着是往回走，但它往后连着几步是唯一能继续推进的走法——'
                + '先把它挪开给后面的块让路。'),
        ],
        conclusion: '把 ' + tile + ' 往' + dir + '滑。',
        principle: '滑块每一格都只有 2~4 种走法，所以「全部走法」是可以穷举的。'
          + '搜的时候用曼哈顿距离（每块离目标还差几格）加上线性冲突（同行两块顺序反了要多绕两步）'
          + '估一个下界，就能一路挑最有希望的方向先搜，不必真的把整棵树铺开。',
        pitfalls: optimal
          ? '最短解不等于「看起来最顺」——它常常要先绕远路，好给后面的块腾位置。'
          : '这条是启发式给的，**不保证最短**。板子越大（尤其 5×5）越可能绕远路；'
            + '按它走一定能往前推进，但步数会比最优解多不少。',
      },
    };
  }

  /** 当前局面该走哪一步；没有可走的返回 null */
  function best(b) {
    // 用 solved() 而不是 state：刚 create 出来的板子是终局但 state 还是 ready，
    // 只看 state 会给终局也算出一条"提示"，那一步纯属凭空捏造。
    if (!b || S.solved(b)) return null;
    const cap = CAPS[b.n] || 20000;
    const avoid = lastEmpty;
    const banned = new Set(tabu);
    lastEmpty = b.empty;              // 提示发出时空格的位置，供下一次防回退

    const dist = S.solver.totalDistance(b.cells, b.n);
    if (dist <= (GATE[b.n] || 30)) {
      const r = S.solver.solve(b, cap);
      if (r && r.first >= 0) { remember(b); return makeStep(b, r.first, true, r.moves, 0); }
    }

    // 往后看几步取最优终局对应的第一步。一歩贪心只是它的 k=1 特例，所以不用分开做。
    const look = S.solver.lookahead(b, 8, avoid, banned);
    if (look >= 0) {
      const before = S.solver.totalDistance(b.cells, b.n);
      const step = makeStep(b, look, false, null, 0);
      const tile = b.cells[look];
      const g = tile - 1;
      const delta = S.solver.manhattan(b.n, look, g) - S.solver.manhattan(b.n, b.empty, g);
      step.explain.derivation[1] = delta > 0
        ? '这一步能让 ' + tile + ' 离目标近 ' + delta + ' 格。'
        : '这一步本身看着是往回走，但往后看几步，它是能走到的局面里最好的那一步。';
      step.explain.pitfalls = '这条是启发式给的，**不保证最短**。板子越大（尤其 5×5）越可能绕远路；'
        + '按它走能往前推进，但步数会比最优解多。';
      remember(b);
      return step;
    }

    const g = S.solver.greedy(b, avoid, banned);
    if (g.cell < 0) return null;      // 只有空格四面都出界时才会到这（盘面 1×1）
    remember(b);
    return makeStep(b, g.cell, false, null, g.delta);
  }

  /** 把当前空格位置记进禁忌表 */
  function remember(b) {
    tabu.push(b.empty);
    if (tabu.length > TABU_LEN) tabu.shift();
  }

  S.hints = {
    best: best, directionOf: directionOf, CAPS: CAPS,
    reset: () => { lastEmpty = -1; tabu.length = 0; },
    tabuSize: () => tabu.length,
  };
})(window);
