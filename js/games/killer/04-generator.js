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
  /**
   * roomy —— 种子是否优先挑「还有未分配邻居」的格子。
   *   开着：笼子能长起来，盘面干净、单格笼几乎为零（中等以上都开）。
   *   关掉：按随机顺序切，靠后的格子长不出第二格，会留下一堆单格笼。
   *         这恰恰是入门题该有的样子——单格笼等于白送一个数字，
   *         整盘靠「笼内定数」就能推完，不会一上来就要 45 法则。
   * absorb —— 收编单格笼时允许并进的笼子最大到几格。设 1 等于不收。
   */
  const DIFFICULTY = {
    easy:   { id: 'easy',   name: '入门', star: 1, sizeLo: 1, sizeHi: 2, absorb: 1, roomy: 0,   minLevel: 1, minStar: 1 },
    medium: { id: 'medium', name: '简单', star: 2, sizeLo: 1, sizeHi: 3, absorb: 3, roomy: 0.5, minLevel: 1, minStar: 1 },
    hard:   { id: 'hard',   name: '中等', star: 3, sizeLo: 1, sizeHi: 3, absorb: 3, roomy: 1,   minLevel: 1, minStar: 1 },
    expert: { id: 'expert', name: '困难', star: 4, sizeLo: 2, sizeHi: 3, absorb: 3, roomy: 1,   minLevel: 1, minStar: 1 },
    master: { id: 'master', name: '大师', star: 5, sizeLo: 2, sizeHi: 3, absorb: 4, roomy: 1,   minLevel: 1, minStar: 1 },
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
   *
   * 种子不能随便挑。按固定随机顺序处理时，轮到靠后的格子，它的四邻早被分完了，
   * 一格都长不出来，直接变成单格笼——实测 1-4 档平均每局 15.7 个单格笼，
   * 整盘碎成一片，又难看又没意思。所以优先挑「还有未分配邻居」的格子当种子。
   */
  function partition(solution, rng, cfg) {
    const assigned = new Uint8Array(B.CELL_COUNT);
    const pending = Array.from({ length: B.CELL_COUNT }, (_, i) => i);
    const span = cfg.sizeHi - cfg.sizeLo + 1;
    const list = [];

    while (true) {
      const free = [];
      const roomy = [];
      for (const i of pending) {
        if (assigned[i]) continue;
        free.push(i);
        if (neighborsOf(i).some((j) => !assigned[j])) roomy.push(i);
      }
      if (!free.length) break;
      // roomy 可以是 true/false，也可以是 0~1 的概率——中间档留一点碎笼当缓冲，
      // 否则「简单」和「中等」之间会从 L2 直接跳到 L5，跨度大得不像同一套难度表。
      const useRoomy = cfg.roomy === true
        || (typeof cfg.roomy === 'number' && rng() < cfg.roomy);
      const pool = useRoomy && roomy.length ? roomy : free;
      const seed = pool[Math.floor(rng() * pool.length)];

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
      list.push({ cells: cells, sum: 0 });
    }

    return absorbSingletons(list, solution, cfg, rng);
  }

  /**
   * 收尾：把剩下的单格笼并进相邻的笼子。
   * 长不出来的格子是少数，但单格笼在盘面上很扎眼（它就是白送一个数字），
   * 正式杀手题里很少见。只要相邻笼子不含这个数字、又没到尺寸上限，就并进去。
   */
  function absorbSingletons(list, solution, cfg, rng) {
    const of = new Int8Array(B.CELL_COUNT).fill(-1);
    for (let k = 0; k < list.length; k++) for (const i of list[k].cells) of[i] = k;
    const gone = new Uint8Array(list.length);

    for (let k = 0; k < list.length; k++) {
      if (gone[k] || list[k].cells.length !== 1) continue;
      const i = list[k].cells[0];
      const d = solution[i];
      const opts = [];
      for (const j of neighborsOf(i)) {
        const t = of[j];
        if (t < 0 || t === k || gone[t]) continue;
        // absorb 是收编上限，通常比 sizeHi 宽一格：单格笼最常见的处境就是
        // 「邻居都满了」，卡死在这只会让它留在盘面上扎眼。
        // 但入门档故意收得紧——单格笼就是白送一个数字，正是入门题该有的样子。
        if (list[t].cells.length > (cfg.absorb || cfg.sizeHi)) continue;
        let clash = false;
        for (const x of list[t].cells) if (solution[x] === d) { clash = true; break; }
        if (!clash) opts.push(t);
      }
      if (!opts.length) continue;
      const t = opts[Math.floor(rng() * opts.length)];
      list[t].cells.push(i);
      of[i] = t;
      list[k].cells = [];
      gone[k] = 1;
    }

    const out = [];
    for (const c of list) {
      if (!c.cells.length) continue;
      let sum = 0;
      for (const i of c.cells) sum += solution[i];
      out.push({ cells: c.cells, sum: sum });
    }
    return out;
  }

  const MAX_ATTEMPTS = 400;
  /**
   * 单轮尝试的次数上限。笼子开大时唯一解率只有个位数百分比，死磕下去可能几分钟
   * 都撞不到一道——与其如此，不如早点放弃这一轮、换更小的笼子重来（那几乎必成）。
   */
  const ATTEMPT_LIMIT = 15;
  /**
   * 出题时间预算。笼子开大之后唯一解会变稀有，偶尔会连切几百次都不达标——
   * 与其让玩家对着「正在出题」干等，不如到点就用目前最好的一道，
   * 并且把**实测出来的**难度如实报出去（rating 是量出来的，不是标签）。
   */
  const TIME_BUDGET_MS = 1500;

  const randomSeed = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  /**
   * 一轮尝试：在给定笼子范围里切，直到切出一道达标的题。
   * 找不到就返回 null，由上层收窄范围重来。
   */
  function attempt(cfg, range, seed, hardDeadline) {
    const rng = U.makeRng(seed);
    const deadline = Date.now() + TIME_BUDGET_MS;
    let fallback = null;
    let attempts = 0;
    let hit = false;

    for (let k = 0; k < MAX_ATTEMPTS; k++) {
      // 先拿到一道唯一解的题，再谈时间预算。反过来的话，预算到点时手上空空，
      // 只能抛「出题失败」——那比多等一两秒糟得多。笼子开大时唯一解率只有 5%，
      // 试二十来次才撞到一道是常态。
      // 硬上限必须在这里也查一遍。只放在外层的话，一次 attempt 最多能跑
      // ATTEMPT_LIMIT 次求解（每次可能一秒），加起来几十秒——实测就是它把
      // 教程的演示搜索拖到了 48 秒。
      if (Date.now() > hardDeadline) break;
      if (fallback && Date.now() > deadline) break;
      if (!fallback && k >= ATTEMPT_LIMIT) break;
      attempts++;
      const solution = SD.Solver.randomFullGrid(rng);
      const list = partition(solution, rng, range);
      const puz = C.create(list);
      if (KS.validateShape(puz)) continue;
      if (!KS.hasUnique(puz).unique) continue;

      const rating = KT.rate(puz);
      // 评级没跑完的题不当正式候选（半截数据会把难度阶梯带偏），
      // 但留着当兜底——否则一个都没评完时会直接抛错，玩家看到的是「出题失败」。
      if (!fallback || (!rating.timedOut && rating.score > fallback.rating.score)) {
        fallback = { puzzle: puz, solution: solution, rating: rating };
      }
      // 达标就收工：等级够、星级也在区间内。
      // 这里不看 rating.solved ——「必须试数」的题在星级上已经是 5，该不该收由 minStar / maxStar 管。
      // maxStar 是给中低档用的：那些档位不该冒出「必须试数」的题（星级 5），
      // 靠 minStar 表达不了「要 3 星但不要 5 星」。
      if (!rating.timedOut && rating.level >= cfg.minLevel && rating.star >= cfg.minStar &&
          (!cfg.maxStar || rating.star <= cfg.maxStar)) {
        fallback = { puzzle: puz, solution: solution, rating: rating };
        hit = true;
        break;
      }
    }

    if (!fallback) return null;
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
      sizeLo: range.sizeLo,
      sizeHi: range.sizeHi,
    };
  }

  /**
   * @param {string} difficultyId
   * @param {string|number} [seed] 传了就完全可复现（每日挑战靠它）
   *
   * 笼子越大越难切出唯一解（实测 2 格笼 83%、5 格笼 20%、6 格笼 0%）。
   * 目标范围切不出来时**逐级收窄笼子尺寸**再试，保证一定能出题——
   * 宁可这一局的笼子比目标小一档，也不要让玩家对着「出题失败」发呆，
   * 或者对着「正在出题」等上几分钟。收窄后的实际尺寸会随结果一起返回。
   */
  function generateSync(difficultyId, seed) {
    const cfg = DIFFICULTY[difficultyId] || DIFFICULTY.medium;
    const base = seed === undefined || seed === null ? randomSeed() : String(seed);
    // 整轮出题的硬上限：收窄到 2 格笼时唯一解率 85%，几乎必成，
    // 所以正常情况下走不到这个上限；留它是为了防止任何没预料到的组合把页面冻住。
    const hardDeadline = Date.now() + 4000;
    for (let hi = cfg.sizeHi; hi >= 2; hi--) {
      if (Date.now() > hardDeadline) break;
      const range = {
        sizeLo: Math.min(cfg.sizeLo, hi),
        sizeHi: hi,
        roomy: cfg.roomy,
        absorb: Math.min(cfg.absorb, hi + 1),
      };
      const got = attempt(cfg, range, base + '|' + hi, hardDeadline);
      if (got) return got;
    }
    throw new Error('没能切出唯一解的笼子');
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
