/* 扫雷 · 中文讲解
 *
 * 把求解器给出的推理翻译成人话。和数独那边的讲解一个套路：
 * 先讲「这一步是怎么看出来的」（针对当前盘面逐条推导），再讲原理、结论、常见误区。
 * 求解器只负责保证结论正确，措辞全在这里。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const M = (SD.Mines = SD.Mines || {});

  const LEVEL_NAME = M.solver.LEVEL_NAME;

  /** 坐标写成 R3C5 这种，盘面上好找 */
  const rc = (b, i) => 'R' + (Math.floor(i / b.w) + 1) + 'C' + ((i % b.w) + 1);

  function joinCells(b, cells, max) {
    const n = max || 6;
    const head = cells.slice(0, n).map((i) => rc(b, i));
    return cells.length > n ? head.join('、') + ' 等 ' + cells.length + ' 格' : head.join('、');
  }

  /** 某个数字格当前的处境：周围还剩几格未知、要放几颗雷 */
  function needOf(b, i) {
    let flags = 0;
    const cells = [];
    for (const j of b.nbr[i]) {
      if (b.open[j]) continue;
      if (b.flag[j]) flags++;
      else cells.push(j);
    }
    return { num: b.num[i], flags: flags, cells: cells, need: b.num[i] - flags };
  }

  const TECH_NAME = {};
  for (const t of M.solver.TECHNIQUES) TECH_NAME[t.id] = t.name;

  /**
   * @returns {{title, how: string[], conclusion: string, pitfall: string}}
   */
  function explain(b, step) {
    const d = step.detail || {};
    const title = TECH_NAME[step.id] || step.id;
    const how = [];
    let conclusion = '';
    let pitfall = '';

    if (step.id === 'single-safe') {
      const s = needOf(b, step.from[0]);
      how.push(rc(b, step.from[0]) + ' 上的数字是 ' + s.num + '，它周围已经有 ' + s.flags + ' 面旗了。');
      how.push('也就是说，这个数字要的雷已经全部找到了，剩下的未知格不可能再有雷。');
      conclusion = joinCells(b, step.safe) + ' 可以放心翻开。';
      pitfall = '旗必须是自己确认过的。如果旗插错了，这条结论会跟着一起错——'
        + '所以「插旗」这一步本身就是推理，不能随手标。';
    } else if (step.id === 'single-mine') {
      const s = needOf(b, step.from[0]);
      how.push(rc(b, step.from[0]) + ' 上的数字是 ' + s.num + '，周围插了 ' + s.flags + ' 面旗。');
      how.push('它周围没翻开的格子正好还剩 ' + s.cells.length + ' 格，而它还要 ' + s.need + ' 颗雷。');
      how.push('格子数和雷数一样多——每一格都跑不掉。');
      conclusion = joinCells(b, step.mines) + ' 全是雷，插旗。';
      pitfall = '注意数的是「还没翻开的格子」，不是「所有格子」。已经翻开的格子显然不是雷，不该算进去。';
    } else if (step.id === 'global-safe' || step.id === 'global-mine') {
      how.push('还没插旗的雷一共 ' + d.remaining + ' 颗，而没翻开的格子正好 ' + d.count + ' 格。');
      how.push(step.id === 'global-mine'
        ? '每颗雷都得有地方放，格子数又刚好够——这 ' + d.count + ' 格全是雷。'
        : '一颗都不剩了，这 ' + d.count + ' 格一个雷都没有。');
      conclusion = step.id === 'global-mine'
        ? joinCells(b, step.mines) + ' 全是雷。'
        : joinCells(b, step.safe) + ' 全部安全。';
      pitfall = '这条规则只在「格子数正好等于剩余雷数」时成立。差一个都不行——'
        + '那只能说明其中有几颗雷，说不清是哪几颗。';
    } else if (step.id === 'subset-mine' || step.id === 'subset-safe') {
      const A = d.aFrom;
      const B = d.bFrom;
      const an = A >= 0 ? needOf(b, A) : null;
      const bn = B >= 0 ? needOf(b, B) : null;
      if (an && bn) {
        how.push(rc(b, A) + ' 上的数字 ' + an.num + '：周围还有 ' + an.cells.length + ' 格未知，要放 ' + an.need + ' 颗雷。');
        how.push(rc(b, B) + ' 上的数字 ' + bn.num + '：周围还有 ' + bn.cells.length + ' 格未知，要放 ' + bn.need + ' 颗雷。');
        how.push('后者的范围把前者整个包住了。既然前者的 ' + an.need + ' 颗雷已经要占掉它的全部格子，'
          + '那么后者多出来的 ' + d.diff + ' 格里能放的雷就只有 ' + (bn.need - an.need) + ' 颗。');
      } else {
        how.push('拿一条已知的局部约束和整片未知区域作比较。');
      }
      conclusion = step.id === 'subset-mine'
        ? '多出来的 ' + joinCells(b, step.mines) + ' 正好要承担这个差额，全是雷。'
        : '差额是 0，多出来的 ' + joinCells(b, step.safe) + ' 一个雷都没有。';
      pitfall = '必须是一个范围「完全包住」另一个。只是重叠、或者部分相交，都推不出结论——'
        + '那种情况得靠 L4 的枚举。';
    } else if (step.id === 'enumerate-safe' || step.id === 'enumerate-mine') {
      how.push('把边界上所有可能的布雷方式穷举了一遍，一共 ' + (d.total || 0) + ' 种符合已翻开数字的排法。');
      how.push(step.id === 'enumerate-safe'
        ? '在每一种排法里，下面这些格子都不是雷。'
        : '在每一种排法里，下面这些格子都是雷。');
      conclusion = step.id === 'enumerate-safe'
        ? joinCells(b, step.safe) + ' 必然安全。'
        : joinCells(b, step.mines) + ' 必然是雷。';
      pitfall = '枚举只在「已知信息」上做，结论是严格的。但它算不到玩家自己插错的旗——'
        + '旗插错了，枚举出来的每一种排法都建立在错前提上。';
    } else if (step.id === 'guess') {
      how.push('把边界上所有可能的布雷方式穷举了一遍，没有哪一种排法能让某格必然安全或必然是雷。');
      how.push('也就是说，这一步只能猜。既然要猜，就挑概率最低的那格。');
      conclusion = joinCells(b, step.suggest || [], 4) + ' 是雷的概率最低（'
        + (d.prob * 100).toFixed(1) + '%，共 ' + (d.total || 0) + ' 种排法里算出来的）。';
      pitfall = '概率最低不等于安全。提示在这里能做的是「把赌注下在赔率最好的地方」，'
        + '不是「保证你不炸」——这正是扫雷的一部分。';
    } else {
      conclusion = '按这条推理操作即可。';
    }

    return { title: title, how: how, conclusion: conclusion, pitfall: pitfall };
  }

  /** 面板顶部那句概况 */
  function summary(b, analysis) {
    const left = analysis.remaining;
    return '剩余雷数 ' + (left >= 0 ? left : '?') + ' · 未翻开 ' + analysis.unknown.length + ' 格';
  }

  M.hints = {
    LEVEL_NAME: LEVEL_NAME,
    TECH_NAME: TECH_NAME,
    rc: rc,
    explain: explain,
    summary: summary,
    joinCells: joinCells,
  };
})(window);
