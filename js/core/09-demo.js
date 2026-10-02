/* 数独 · 技巧演示局面
 *
 * 纯文字讲不清技巧，所以每个技巧配一个「当场能触发」的盘面。
 * 做法是随机撒洞、跑一遍该技巧的 find()，第一个有结论的局面留下来当示例——
 * 这样示例必然是真的能用，不存在「图上画的和实际对不上」。
 *
 * 只在页面里现算、不预生成文件：27 种技巧全跑一遍约 170ms，
 * 按单种懒算并缓存，用户点开哪种才算哪种。
 */
(function (global) {
  'use strict';

  const SD = global.SD;

  const cache = new Map();

  // 四阶鱼罕见得多：它要 4 条基础线各 4 个候选同时落在同样 4 条覆盖线上，
  // 盘面太稀（候选太多）或太密（候选太少）都撞不出来，实测保留率 0.6 时最容易命中。
  const PROFILE = { jellyfish: { budget: 3000, keep: 0.6 } };

  function actsOf(step) {
    return (step.eliminations || []).length + (step.placements || []).length;
  }

  /** 从完整解随机挖洞，直到该技巧能给出结论 */
  function search(id, profile) {
    const tech = SD.Techniques.byId[id];
    if (!tech || typeof tech.find !== 'function') return null;
    const budget = (profile && profile.budget) || 120;
    const keep = (profile && profile.keep) || 0.45;
    const rng = SD.Base.makeRng('demo-' + id);
    for (let k = 0; k < budget; k++) {
      const solution = SD.Solver.randomFullGrid(rng);
      const grid = solution.slice();
      for (const i of SD.Base.shuffle(Array.from({ length: 81 }, (_, n) => n), rng)) {
        if (grid[i] && rng() < keep) grid[i] = 0;
      }
      const cand = SD.Validation.computeCandidates(grid);
      let dead = false;
      for (let i = 0; i < 81; i++) if (!grid[i] && cand[i] === 0) { dead = true; break; }
      if (dead) continue;
      let step;
      try { step = tech.find({ grid: grid, cand: cand }); } catch (e) { step = null; }
      if (step && actsOf(step)) return { grid: Array.from(grid), cand: Array.from(cand), step: step };
    }
    return null;
  }

  /**
   * 推理链没有独立的 find（它由 assumeWrong 统一接管），
   * 这里直接拿一个二分盘面跑一次 assumeWrong，把它顶住的结论取出来。
   */
  function forcingChainDemo() {
    const rng = SD.Base.makeRng('demo-forcing-chain');
    for (let k = 0; k < 400; k++) {
      const solution = SD.Solver.randomFullGrid(rng);
      const grid = solution.slice();
      for (const i of SD.Base.shuffle(Array.from({ length: 81 }, (_, n) => n), rng)) {
        if (grid[i] && rng() < 0.5) grid[i] = 0;
      }
      const cand = SD.Validation.computeCandidates(grid);
      let dead = false;
      for (let i = 0; i < 81; i++) if (!grid[i] && cand[i] === 0) { dead = true; break; }
      if (dead) continue;
      let step;
      try { step = SD.Hints.assumeWrong(grid, 5, 8); } catch (e) { step = null; }
      if (step && actsOf(step)) return { grid: Array.from(grid), cand: Array.from(SD.Validation.computeCandidates(grid)), step: step };
    }
    return null;
  }

  /** 取某技巧的演示局面，算过一次就缓存 */
  function demoFor(id) {
    if (cache.has(id)) return cache.get(id);
    const out = id === 'forcing-chain' ? forcingChainDemo() : search(id, PROFILE[id]);
    cache.set(id, out);
    return out;
  }

  SD.Demo = { demoFor: demoFor };
})(window);