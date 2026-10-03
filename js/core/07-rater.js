/* 数独 · 难度评级
 *
 * 难度不看线索个数，只看「人类需要用到多高级的技巧、总共要走多少步」。
 * 同样是 28 个线索，可能只需唯一余数，也可能必须上三链列，体感天差地别。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;

  /** 每个技巧的「难度权重」：越靠后越贵 */
  const WEIGHT = {
    'naked-single': 1,
    'hidden-single': 2,
    'locked-pointing': 4,
    'locked-claiming': 4,
    'naked-pair': 6,
    'hidden-pair': 7,
    'naked-triple': 12,
    'hidden-triple': 13,
    'x-wing': 16,
    'xy-wing': 18,
    'xyz-wing': 22,
    'swordfish': 28,
    'unique-rectangle': 30,
    'forcing-chain': 40,
  };

  /**
   * 星级断点。用「技巧天花板 + 路径形状」两项一起算分。
   *
   * 只看最高技巧是天花板指标，答不了「同样只用区块摒除的两道题，
   * 一道到处顺手、一道处处瓶颈」的差别。后者体感上要慢得多，
   * 所以瓶颈占比必须计入分数——这是国际惯例（Conceptis 的 bottleneck）
   * 里难度的另一半真相。
   */
  const STAR_BREAK = [130, 280, 470, 800];

  /** 瓶颈占比：0 表示每一步都有多个选择，1 表示全程只能照着唯一一条路走 */
  function chokeRatio(sim) {
    return sim.steps ? sim.bottlenecks / sim.steps : 0;
  }

  function rate(grid, opts) {
    const maxLevel = (opts && opts.maxLevel) || 5;
    const sim = SD.Techniques.simulate(grid, maxLevel);

    let weight = 0;
    let total = 0;
    const breakdown = [];
    for (const id of Object.keys(sim.used)) {
      const n = sim.used[id];
      const t = SD.Techniques.byId[id];
      const w = (WEIGHT[id] || 5) * n;
      weight += w;
      total += n;
      breakdown.push({ id: id, name: t ? t.name : id, level: t ? t.level : 0, count: n, weight: w });
    }
    breakdown.sort((a, b) => b.weight - a.weight);

    // 推不动就意味着必须靠试错，星级直接拉满
    const level = sim.level;
    const choke = chokeRatio(sim);
    // 瓶颈占八成的题星级额外上浮：同样的技巧天花板，它明显更难熬
    const shape = Math.round(choke * 120);
    const score = level * 120 + weight + shape + (sim.solved ? 0 : 900);
    let star = 1;
    for (let i = 0; i < STAR_BREAK.length; i++) if (score > STAR_BREAK[i]) star = i + 2;
    if (star > 5) star = 5;

    return {
      solved: sim.solved,
      contradiction: sim.contradiction,
      level: level,
      levelName: sim.solved ? SD.Techniques.LEVEL_NAME[level] || '基础' : '需试错',
      star: sim.solved ? star : 5,
      score: score,
      steps: sim.steps,
      total: total,
      bottlenecks: sim.bottlenecks,
      choke: choke,
      used: sim.used,
      breakdown: breakdown,
      needsGuess: !sim.solved,
    };
  }

  /** 用给定等级上限评估题目的「最高可解等级」，用于导入棋局的自动分级 */
  function classify(grid) {
    const full = rate(grid, { maxLevel: 5 });
    if (!full.solved) {
      return { solvableByHuman: false, star: 5, name: '需试错', level: 5 };
    }
    const names = { 1: '入门', 2: '简单', 3: '中等', 4: '困难', 5: '大师' };
    const name = full.level === 5 ? '大师' : names[full.level];
    return { solvableByHuman: true, star: full.star, name: name, level: full.level, breakdown: full.breakdown };
  }

  SD.Rater = { rate, classify, WEIGHT };
})(window);
