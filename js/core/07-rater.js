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

  const STAR_BREAK = [120, 260, 450, 780];

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
    const score = level * 120 + weight + (sim.solved ? 0 : 900);
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
