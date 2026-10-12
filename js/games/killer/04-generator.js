/* 杀手数独 · 出题
 *
 * 流程和数独那边不一样：数独是「先出终盘、再挖洞」，杀手是「先出终盘、再切笼子」。
 * 笼子切好之后和就自动定了，剩下的问题只有一个——这样切出来的题唯一解吗？
 * 不唯一就换一种切法重来。实测：笼子越小越容易唯一（2 格笼 83%，5 格笼 23%），
 * 所以重试几次总能出题。
 *
 * 难度不靠笼子大小直接决定，而是切完之后用技巧引擎实测一遍——
 * 笼子大小只决定「往哪个方向切」，真正评级的是「人需要用到哪一级技巧」。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;
  const U = SD.Util;
  const C = K.cages;
  const KS = K.solver;
  const KT = K.techniques;

  /**
   * 难度阶梯由两件事一起定：
   *   sizeLo / sizeHi —— 笼子切多大。笼子越大，「和」提供的信息越弱、组合越多，
   *                      结构上就越费劲；但太大又切不出唯一解（实测 5 格笼唯一解率 20%、
   *                      6 格笼直接是 0%），所以上限卡在 4。
   *   minLevel / minStar —— 切完用技巧引擎实测，达不到就重切。
   *
   * 实测数据（各档抽 10 道）：
   *   1-2 → 3ms/道，全是 L1；1-3 → 2ms，L2；1-4 → 22ms，L3；
   *   2-4 → 76ms，L3 但大笼子更多；2-4 要求必须试数 → 139ms，全是 L5。
   */
  const DIFFICULTY = {
    easy:   { id: 'easy',   name: '入门', star: 1, sizeLo: 1, sizeHi: 2, minLevel: 1, minStar: 1 },
    medium: { id: 'medium', name: '简单', star: 2, sizeLo: 1, sizeHi: 3, minLevel: 2, minStar: 2 },
    hard:   { id: 'hard',   name: '中等', star: 3, sizeLo: 1, sizeHi: 4, minLevel: 3, minStar: 3 },
    expert: { id: 'expert', name: '困难', star: 4, sizeLo: 2, sizeHi: 4, minLevel: 3, minStar: 3 },
    master: { id: 'master', name: '大师', star: 5, sizeLo: 2, sizeHi: 4, minLevel: 5, minStar: 5 },
  };
  const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert', 'master'];

  /** 上下左右相邻。笼子必须是连通块，斜着不算。 */
  function neighborsOf(i) {
    const r = B.ROW_OF[i];
    const c = B.COL_OF[i];
    const out = [];
    if (r > 0) out.push(i - 9);
    if (r < 8) out.push(i + 9);
    if (c > 0) out.push(i - 1);
    if (c < 8) out.push(i + 1);
    return out;
  }

  /**
   * 把终盘切成笼子：从随机一个未分配的格子开始往外长，
   * 长出的大小落在 [sizeLo, sizeHi] 内，且笼内数字不能重复——
   * 笼子的规则本来就是「数字互不相同」，切的时候就不能切出重复的来。
   */
  function partition(solution, rng, cfg) {
    const assigned = new Uint8Array(B.CELL_COUNT);
    const order = U.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    const span = cfg.sizeHi - cfg.sizeLo + 1;
    const list = [];
    for (const seed of order) {
      if (assigned[seed]) continue;
      const cells = [seed];
      assigned[seed] = 1;
      const digits = new Set([solution[seed]]);
      const target = cfg.sizeLo + Math.floor(rng() * span);
      while (cells.length < target) {
        const cands = [];
        for (const c of cells) {
          for (const j of neighborsOf(c)) {
            if (assigned[j] || digits.has(solution[j])) continue;
            cands.push(j);
          }
        }
        if (!cands.length) break;
        const pick = cands[Math.floor(rng() * cands.length)];
        assigned[pick] = 1;
        digits.add(solution[pick]);
        cells.push(pick);
      }
      let sum = 0;
      for (const i of cells) sum += solution[i];
      list.push({ cells: cells, sum: sum });
    }
    return list;
  }

  const MAX_ATTEMPTS = 400;
  /**
   * 出题时间预算。笼子开大之后唯一解会变稀有，偶尔会连切几百次都不达标——
   * 与其让玩家对着「正在出题」干等，不如到点就用目前最好的一道，
   * 并且把**实测出来的**难度如实报出去（rating 是量出来的，不是标签）。
   */
  const TIME_BUDGET_MS = 2500;

  const randomSeed = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  /**
   * @param {string} difficultyId
   * @param {string|number} [seed] 传了就完全可复现（每日挑战靠它）
   */
  function generateSync(difficultyId, seed) {
    const cfg = DIFFICULTY[difficultyId] || DIFFICULTY.medium;
    const rng = U.makeRng(seed === undefined || seed === null ? randomSeed() : String(seed));
    const deadline = Date.now() + TIME_BUDGET_MS;
    let fallback = null;
    let attempts = 0;
    let hit = false;

    for (let k = 0; k < MAX_ATTEMPTS; k++) {
      if (k > 0 && Date.now() > deadline) break;
      attempts++;
      const solution = SD.Solver.randomFullGrid(rng);
      const list = partition(solution, rng, cfg);
      const puz = C.create(list);
      if (KS.validateShape(puz)) continue;
      if (!KS.hasUnique(puz).unique) continue;

      const rating = KT.rate(puz);
      if (!fallback || rating.score > fallback.rating.score) {
        fallback = { puzzle: puz, solution: solution, rating: rating };
      }
      // 达标就收工：等级够、星级也够
      if (rating.solved && rating.level >= cfg.minLevel && rating.star >= cfg.minStar) {
        fallback = { puzzle: puz, solution: solution, rating: rating };
        hit = true;
        break;
      }
    }

    if (!fallback) {
      // 连一次唯一解都没切出来。笼子开得太大时会走到这里，报出来比静默返回 null 好。
      throw new Error('没能切出唯一解的笼子（' + attempts + ' 次尝试）');
    }
    return {
      puzzle: fallback.puzzle,
      cages: fallback.puzzle.list,
      solution: fallback.solution,
      rating: fallback.rating,
      difficulty: cfg.id,
      difficultyName: cfg.name,
      cageCount: fallback.puzzle.list.length,
      attempts: attempts,
      // 是否切到了目标难度。false 说明是时间预算到了、退而求其次，
      // UI 会按 rating 报实际难度，不会拿档位标签糊弄人。
      hitTarget: hit,
      seed: seed === undefined || seed === null ? null : String(seed),
    };
  }

  /** 题面体检：笼子切得对不对、唯一不唯一 */
  function inspect(list) {
    const puz = C.create(list);
    const shape = KS.validateShape(puz);
    if (shape) return { valid: false, reason: shape };
    const r = KS.solve(puz, 2);
    if (r.count === 0) return { valid: false, reason: '这道题无解' };
    if (r.count > 1) return { valid: false, reason: '这道题有多个解' };
    const rating = KT.rate(puz);
    return { valid: true, solution: r.solution, rating: rating, cageCount: list.length, reason: '唯一解' };
  }

  K.generator = {
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    partition: partition,
    generateSync: generateSync,
    inspect: inspect,
    neighborsOf: neighborsOf,
  };
})(window);
