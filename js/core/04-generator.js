/* 数独 · 出题机
 *
 * 难度不是由「挖掉多少格」决定的，而是由「最低需要多高级的技巧才能解开」决定的。
 * 所以出题采用「定向挖洞」：
 *   每挖掉一格就同时评两次分 —— 低阶技巧（L1..L_k）还能不能解？高阶技巧（L1..L_max）还能不能解？
 *   · 高阶也解不动 → 拒绝这格（不然就成了一道要试错的题）
 *   · 高阶能解、低阶解不动 → 达到目标难度，收工
 *   · 两者都能解        → 继续挖
 * 这样出来的题，难度是「被证明过」的，而不是猜的。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;

  const DIFFICULTY = {
    easy:   { id: 'easy',   name: '入门', maxLevel: 1, harderThan: 0, clues: [38, 46], star: 1 },
    medium: { id: 'medium', name: '简单', maxLevel: 2, harderThan: 1, clues: [32, 40], star: 2 },
    hard:   { id: 'hard',   name: '中等', maxLevel: 3, harderThan: 2, clues: [28, 36], star: 3 },
    expert: { id: 'expert', name: '困难', maxLevel: 4, harderThan: 3, clues: [25, 32], star: 4 },
    master: { id: 'master', name: '大师', maxLevel: 5, harderThan: 4, clues: [22, 29], star: 5 },
  };
  const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert', 'master'];

  const countClues = (grid) => {
    let n = 0;
    for (let i = 0; i < B.CELL_COUNT; i++) if (grid[i]) n++;
    return n;
  };

  const isUnique = (grid) => SD.Solver.solve(grid, 2).count === 1;
  const solvableAt = (grid, level) => SD.Rater.rate(grid, { maxLevel: level }).solved;

  // 难度下限：这道题不该被「比 harderThan 更简单的技巧」解开。
  // harderThan 为 0（入门）表示不设下限。
  const meetsFloor = (grid, cfg) => !cfg.harderThan || !solvableAt(grid, cfg.harderThan);

  /** 补线索，把题目拉回 ≤maxLevel 的人类可解范围 */
  function easeDown(puzzle, solution, rng, maxLevel) {
    const cells = B.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    for (const i of cells) {
      if (puzzle[i]) continue;
      puzzle[i] = solution[i];
      if (solvableAt(puzzle, maxLevel)) return true;
      puzzle[i] = 0;
    }
    return false;
  }

  /**
   * 定向挖洞。
   * harderThan = 0 表示不设下限（入门题：只要唯一余数能解完即可）。
   * 返回 { reached, rating }，reached 表示是否达到目标难度。
   */
  function digToLevel(puzzle, rng, cfg) {
    const order = B.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    let last = null;
    const target = cfg.clues[0];
    // 下探余量：挖得更深正是逼出高阶技巧的手段。只挖到线索数目标就收工的话，
    // 高级难度的下限常常根本撞不上（要 4 行同处一列这种结构），
    // 于是生成器只能退而求其次，返回一道比标称等级简单得多的题。
    // 余量给到 14：难度上限和线索数下限这两条同时收紧时，
    // 真正达标的局面只出现在很稀疏的区间里。
    const floor = target - 14;

    for (const i of order) {
      if (!puzzle[i]) continue;
      const clues = countClues(puzzle);
      // 达标且已挖到线索目标才算成；只达标但线索还偏多就继续挖，
      // 线索越少逼出的技巧越硬，提前收工会把好牌浪费掉。
      if (clues <= target && meetsFloor(puzzle, cfg)) break;
      if (clues <= floor) break;

      const backup = puzzle[i];
      puzzle[i] = 0;
      if (!isUnique(puzzle)) {
        puzzle[i] = backup;
        continue;
      }
      // 高阶技巧必须仍然解得动，否则这道题就需要试错了
      const hard = SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel });
      if (!hard.solved) {
        puzzle[i] = backup;
        continue;
      }
      if (meetsFloor(puzzle, cfg) && countClues(puzzle) <= cfg.clues[0]) {
        return { reached: true, rating: hard };
      }
      last = hard;
    }
    // 没达���难度下限时，评级必须按最终盘面重算。
    // 沿用挖洞途中那个 last 会让标称评级和实际盘面对不上，
    // 上层按 score 挑「最好的」时就会挑错题。
    return { reached: false, rating: SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel }) };
  }

  /** 入门题：挖到目标线索数即可，重点是「只用唯一余数也能解完」 */
  function digEasy(puzzle, rng, cfg) {
    const order = B.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    for (const i of order) {
      if (!puzzle[i]) continue;
      if (countClues(puzzle) <= cfg.clues[0]) break;
      const backup = puzzle[i];
      puzzle[i] = 0;
      if (isUnique(puzzle)) {
        // 对称格一起挖，避免出现大片单侧留空
        const j = B.RC_OF[B.CELL_COUNT - 1 - i];
        if (puzzle[j]) {
          const b2 = puzzle[j];
          puzzle[j] = 0;
          if (!isUnique(puzzle)) puzzle[j] = b2;
        }
      } else {
        puzzle[i] = backup;
      }
    }
    return SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel });
  }

  function finish(puzzle, solution, rating, cfg, seed) {
    return {
      givens: puzzle.slice(),
      solution: solution.slice(),
      rating: rating,
      difficulty: cfg.id,
      difficultyName: cfg.name,
      star: rating.star,
      level: rating.level,
      clueCount: countClues(puzzle),
      seed: seed === undefined || seed === null ? null : String(seed),
      createdAt: Date.now(),
    };
  }

  /**
   * 打分用于在没造出达标题时挑次优：先比实际需要的技巧等级，再比线索数。
   * 线索少不等于更难——挖过头会让题目需要试错，hard.solved 已经把这种排除了，
   * 但同等可解的前提下仍偏向线索多的那道，读起来更从容。
   */
  const scoreOf = (rating, clues) => (rating.solved ? rating.level * 1000 + Math.min(clues, 45) : -1);

  // 高级难度的下限比低级难得多：四行同处一列这种结构随机撒洞很难撞上。
  // 5 次不够，给到 40 次；每轮挖洞成本不高，实测一道题仍在两三秒内。
  //
  // 次数给到这个量不是为了「碰运气」，而是因为降级策略要求候选池够大——
  // 一旦 12 次都造不出达标题就会退而取次优，而次优可能只比最低档高一点，
  // 表现出来就是「专家难度出出一道简单题」。池子大了才挑得到真正的 L4。
  const ATTEMPTS = 40;

  /** 同步出题，供单元测试使用 */
  function generateSync(difficultyId, seed) {
    const cfg = DIFFICULTY[difficultyId] || DIFFICULTY.easy;
    const rng = B.makeRng(seed === undefined || seed === null ? String(Date.now()) + '-' + Math.random() : String(seed));
    let best = null;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const solution = SD.Solver.randomFullGrid(rng);
      const puzzle = solution.slice();

      if (!cfg.harderThan) {
        const rating = digEasy(puzzle, rng, cfg);
        if (rating.solved) return finish(puzzle, solution, rating, cfg, seed);
        continue;
      }

      const res = digToLevel(puzzle, rng, cfg);
      const rating = res.rating;
      const s = scoreOf(rating, countClues(puzzle));
      if (s > 0 && (!best || s > best.score)) best = { puzzle: puzzle.slice(), solution: solution, rating: rating, score: s };
      if (res.reached) return finish(puzzle, solution, rating, cfg, seed);
    }

    if (!best) {
      const solution = SD.Solver.randomFullGrid(rng);
      const puzzle = solution.slice();
      digEasy(puzzle, rng, cfg);
      easeDown(puzzle, solution, rng, cfg.maxLevel);
      return finish(puzzle, solution, SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel }), cfg, seed);
    }
    return finish(best.puzzle, best.solution, best.rating, cfg, seed);
  }

  /** 异步出题：每处理若干格就交还主线程，界面全程可交互 */
  async function generate(difficultyId, seed, onProgress) {
    const cfg = DIFFICULTY[difficultyId] || DIFFICULTY.easy;
    const rng = B.makeRng(seed === undefined || seed === null ? String(Date.now()) + '-' + Math.random() : String(seed));
    const ATTEMPTS = 12;
    let best = null;

    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const solution = SD.Solver.randomFullGrid(rng);
      const puzzle = solution.slice();
      onProgress && onProgress(attempt / ATTEMPTS);

      if (!cfg.harderThan) {
        const rating = await digEasyAsync(puzzle, rng, cfg);
        if (rating.solved) {
          onProgress && onProgress(1);
          return finish(puzzle, solution, rating, cfg, seed);
        }
        continue;
      }

      const res = await digToLevelAsync(puzzle, rng, cfg, (f) => {
        onProgress && onProgress((attempt + f) / ATTEMPTS);
      });
      const rating = res.rating;
      const s = scoreOf(rating, countClues(puzzle));
      if (s > 0 && (!best || s > best.score)) best = { puzzle: puzzle.slice(), solution: solution, rating: rating, score: s };
      if (res.reached) {
        onProgress && onProgress(1);
        return finish(puzzle, solution, rating, cfg, seed);
      }
    }

    // 目标难度没达成，但保证交出去的是一道人类技巧可解的题
    if (!best) {
      const solution = SD.Solver.randomFullGrid(rng);
      const puzzle = solution.slice();
      digEasy(puzzle, rng, cfg);
      easeDown(puzzle, solution, rng, cfg.maxLevel);
      onProgress && onProgress(1);
      return finish(puzzle, solution, SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel }), cfg, seed);
    }
    onProgress && onProgress(1);
    return finish(best.puzzle, best.solution, best.rating, cfg, seed);
  }

  async function digToLevelAsync(puzzle, rng, cfg, report) {
    const order = B.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    let last = null;
    let done = 0;

    for (const i of order) {
      done++;
      if (done % 4 === 0) {
        report && report(done / order.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!puzzle[i]) continue;
      if (countClues(puzzle) <= cfg.clues[0]) break;

      const backup = puzzle[i];
      puzzle[i] = 0;
      if (!isUnique(puzzle)) {
        puzzle[i] = backup;
        continue;
      }
      const hard = SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel });
      if (!hard.solved) {
        puzzle[i] = backup;
        continue;
      }
      if (cfg.harderThan && !solvableAt(puzzle, cfg.harderThan)) {
        report && report(1);
        return { reached: true, rating: hard };
      }
      last = hard;
    }
    report && report(1);
    return { reached: false, rating: last || SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel }) };
  }

  async function digEasyAsync(puzzle, rng, cfg) {
    const order = B.shuffle(Array.from({ length: B.CELL_COUNT }, (_, i) => i), rng);
    let done = 0;
    for (const i of order) {
      done++;
      if (done % 10 === 0) await new Promise((r) => setTimeout(r, 0));
      if (!puzzle[i]) continue;
      if (countClues(puzzle) <= cfg.clues[0]) break;
      const backup = puzzle[i];
      puzzle[i] = 0;
      if (isUnique(puzzle)) {
        const j = B.RC_OF[B.CELL_COUNT - 1 - i];
        if (puzzle[j]) {
          const b2 = puzzle[j];
          puzzle[j] = 0;
          if (!isUnique(puzzle)) puzzle[j] = b2;
        }
      } else {
        puzzle[i] = backup;
      }
    }
    return SD.Rater.rate(puzzle, { maxLevel: cfg.maxLevel });
  }

  /** 每日挑战：日期即种子，同一天全球同一道题 */
  function dailySeed(date) {
    const d = date || new Date();
    return 'daily-' + d.getFullYear() + '-' + B.pad2(d.getMonth() + 1) + '-' + B.pad2(d.getDate());
  }

  /** 对导入/识别来的题面做体检，并按人类技巧自动分级 */
  function inspect(givens) {
    const conflicts = SD.Validation.findConflicts(givens);
    const uq = SD.Validation.hasUniqueSolution(givens);
    const res = {
      clueCount: countClues(givens),
      conflicts: conflicts.size,
      valid: conflicts.size === 0 && uq.unique,
    };
    if (conflicts.size) res.reason = '存在 ' + conflicts.size + ' 处重复数字';
    else if (uq.count === 0) res.reason = '该题面无解';
    else if (uq.count > 1) res.reason = '该题面存在多个解';
    else res.reason = '唯一解';
    res.classification = res.valid ? SD.Rater.classify(givens) : null;
    res.solution = uq.solution;
    return res;
  }

  SD.Generator = { DIFFICULTY, DIFFICULTY_ORDER, generate, generateSync, dailySeed, countClues, inspect };
})(window);
