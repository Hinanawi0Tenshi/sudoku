/* 杀手数独 · 人类解题技巧
 *
 * 杀手在数独原有的行列宫约束上又叠了一层「笼子」。技巧因此分两族：
 *   - 笼子族：笼内定数、笼内组合、笼内必含、45 法则（内格 / 外格）
 *   - 标准族：数独那 27 种，原样复用
 *
 * 标准族为什么能直接搬过来：它们的推理只依赖「行列宫候选数」，而那个集合
 * 永远包含真解数字（真解数字不会和同行列宫的任何格子冲突）。多一层笼子只会
 * 让真实候选更小，不会让标准技巧的结论失真。唯一要注意的是 trial 那一族——
 * 它们只用基础规则做局部传播，在杀手盘面上依然成立，只是比人慢。
 *
 * 笼子的候选过滤走「笼内组合」这一步显式做，而不是预先塞进候选数：
 * 否则那一步永远无事可做，玩家也就看不到「为什么这几个数字被排除了」。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;
  const C = K.cages;
  const KS = K.solver;

  const bit = B.bit;
  const ALL = B.ALL;
  const rc = SD.Techniques.rc;
  const unitName = SD.Techniques.unitName;

  function baseStep(id, o) {
    return Object.assign(
      { id: id, cells: [], units: [], placements: [], eliminations: [], marks: [], focusCell: null, focusDigit: 0, detail: {} },
      o
    );
  }

  const LIST = [];
  const register = (def) => { LIST.push(def); return def; };

  /* ==================== L1 · 笼内定数 ==================== */

  register({
    id: 'cage-last',
    name: '笼内定数',
    alias: ['笼内唯一', 'Cage Single'],
    level: 1,
    order: 1,
    tagline: '笼子里只剩一格没填，这一格就是还差的那个和。',
    principle:
      '笼子里的数字加起来必须等于给定的和。如果只剩一格空着，那么它只能是「目标和减去已填数字」的那个数——没有第二个选择。一格笼子是它的特例：和本身就是答案。',
    howto: ['看笼子的和；', '减去笼子里已经填上的数字；', '如果只剩一格空着，把差填进去。'],
    pitfalls: '一格笼子（和就是答案）最容易被忽略，扫盘时先把它清掉，能连锁简化周围一大片。',
    find(state) {
      const { grid, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const r = C.remain(puz, grid, c);
        if (r.empty !== 1) continue;
        if (r.left < 1 || r.left > 9) continue;
        let target = -1;
        for (const i of puz.list[c].cells) if (!grid[i]) target = i;
        if (target < 0) continue;
        return baseStep('cage-last', {
          focusCell: target,
          focusDigit: r.left,
          cells: [target],
          units: Array.from(B.UNITS_OF[target]),
          placements: [{ cell: target, digit: r.left }],
          detail: { cage: c, sum: puz.list[c].sum, filled: puz.list[c].cells.length - 1 },
        });
      }
      return null;
    },
  });

  /* ==================== L2 · 笼内组合 / 必含 ==================== */

  register({
    id: 'cage-combo',
    name: '笼内组合',
    alias: ['Cage Combination', '组合排除'],
    level: 2,
    order: 1,
    tagline: '笼子的「和」和「格数」一起，限定了里面能出现哪些数字。',
    principle:
      '一个 3 格笼子和为 7，可能的组合只有 {1,2,4}——8、9 再小也塞不进去。把「所有可能的组合」列出来，它们用不到的数字就可以从笼内每一格里划掉。格数越少、和越极端，这条越有力。',
    howto: ['看笼子的格数和和；', '列出所有「这么多个互不相同的数字加起来等于它」的组合；', '把从没在任何一个组合里出现过的数字，从笼内空格里划掉。'],
    pitfalls: '只能划掉「所有组合都没用到」的数字。只在部分组合里出现的数字不能删——它可能是对的。',
    find(state) {
      const { grid, cand, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const r = C.remain(puz, grid, c);
        if (r.empty < 2) continue;
        const mask = C.possible(r.empty, r.left) & ~r.used;
        if (!mask) continue;
        const elims = [];
        for (const i of puz.list[c].cells) {
          if (grid[i]) continue;
          for (const d of B.maskToDigits(cand[i] & ~mask)) elims.push({ cell: i, digit: d });
        }
        if (!elims.length) continue;
        return baseStep('cage-combo', {
          focusCell: puz.list[c].cells[0],
          cells: puz.list[c].cells.slice(),
          eliminations: elims,
          detail: {
            cage: c, sum: puz.list[c].sum, empty: r.empty, left: r.left,
            combos: C.comboCount(r.empty, r.left), mask: mask,
          },
        });
      }
      return null;
    },
  });

  register({
    id: 'cage-required',
    name: '笼内必含',
    alias: ['Cage Required Digit', '必含数排除'],
    level: 2,
    order: 2,
    tagline: '某个数字在每个组合里都出现——它一定在这个笼子里。',
    principle:
      '3 格笼子和为 6，唯一组合是 {1,2,3}：1、2、3 每一个都必须出现。这时如果整个笼子正好落在同一条线（行 / 列 / 宫）上，这条线里笼子以外的格子就不可能是 1、2、3——它们已经被笼子占用了。',
    howto: ['列出笼子的所有组合；', '找出在所有组合里都出现的数字；', '如果整个笼子落在同一个单元里，把这个数字从该单元笼子以外的格子划掉。'],
    pitfalls: '只有「整个笼子都在同一个单元里」才能向外排除。笼子跨行跨宫时，这个数字落在哪一格还没定，推不出去。',
    find(state) {
      const { grid, cand, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const r = C.remain(puz, grid, c);
        if (r.empty < 2) continue;
        const req = C.required(r.empty, r.left) & ~r.used;
        if (!req) continue;
        const cells = puz.list[c].cells;
        const inCage = new Set(cells);
        for (let u = 0; u < B.UNITS.length; u++) {
          const unit = B.UNITS[u];
          let inside = true;
          for (const i of cells) if (unit.indexOf(i) < 0) { inside = false; break; }
          if (!inside) continue;
          const elims = [];
          for (const d of B.maskToDigits(req)) {
            for (const i of unit) {
              if (inCage.has(i) || grid[i]) continue;
              if (cand[i] & bit(d)) elims.push({ cell: i, digit: d });
            }
          }
          if (!elims.length) continue;
          return baseStep('cage-required', {
            focusCell: cells[0],
            cells: cells.slice(),
            units: [u],
            eliminations: elims,
            detail: { cage: c, sum: puz.list[c].sum, required: req, unit: u },
          });
        }
      }
      return null;
    },
  });

  /* ==================== L3 · 45 法则 ==================== */

  /**
   * 45 法则的两种方向共用一段算术：
   *   一组笼子的和 = 它们落在单元内的格子 + 落在单元外的格子
   * 内格方向：取「完全在单元内」的笼子，单元里没被它们盖住的格子就是内格，
   *           45 - Σ笼和 = Σ内格。
   * 外格方向：取「与单元相交」的笼子，若它们把整个单元盖满，
   *           Σ笼和 - 45 = Σ外格。
   * 两种都归结为「这几个格子的和是定值」，于是要么直接定数，要么按组合过滤候选。
   */
  function sumStep(id, cells, need, cand, grid, detail, distinct) {
    // 一律先转成真数组。B.UNITS 里存的是 Int8Array，它的 filter/slice 返回的还是
    // Int8Array——而 Int8Array.prototype.map 会把返回的字符串强转成 0，
    // 于是讲解里的坐标全渲染成「0、0」。这个坑很隐蔽，是渲染出来才发现的。
    cells = Array.from(cells);
    const empty = cells.filter((i) => !grid[i]);
    if (!empty.length) return null;
    if (empty.length === 1) {
      const i = empty[0];
      if (need < 1 || need > 9) return null;
      if (!(cand[i] & bit(need))) return null;
      return baseStep(id, {
        focusCell: i, focusDigit: need, cells: cells,
        placements: [{ cell: i, digit: need }],
        detail: Object.assign({ need: need, count: cells.length }, detail),
      });
    }
    if (need < 1 || need > 45) return null;
    // 内格同属一个单元，数字必然互不相同；外格跨笼子，可以重复
    const mask = distinct === false
      ? C.possibleAny(empty.length, need)
      : C.possible(empty.length, need);
    if (!mask) return null;
    const elims = [];
    for (const i of empty) {
      for (const d of B.maskToDigits(cand[i] & ~mask)) elims.push({ cell: i, digit: d });
    }
    if (!elims.length) return null;
    return baseStep(id, {
      cells: cells, eliminations: elims,
      detail: Object.assign({ need: need, count: cells.length, mask: mask }, detail),
    });
  }

  register({
    id: 'innie',
    name: '45 法则 · 内格',
    alias: ['Innie', '单元内格'],
    level: 3,
    order: 1,
    tagline: '每一行、每一列、每一宫的数字加起来都是 45。',
    principle:
      '一条线（或一个宫）里 9 个数字各出现一次，所以和必然是 45。如果这条线里有一部分格子被若干个「完全落在线内」的笼子盖住了，那些笼子的和是已知的，剩下没被盖住的格子就承担了 45 与它的差额。',
    howto: ['挑一条线或一个宫；', '把「完全落在里面」的笼子的和加起来；', '45 减去这个和，就是剩下那几个没被笼子盖住的格子的和；', '只剩一格就定了，剩几格就按组合排除候选。'],
    pitfalls: '只能算「完全在单元内」的笼子。跨出单元的笼子不能直接计入——那部分格子不属于这个 45。',
    find(state) {
      const { grid, cand, puz } = state;
      for (let u = 0; u < B.UNITS.length; u++) {
        const unit = B.UNITS[u];
        const unitSet = new Set(unit);
        let sum = 0;
        let used = 0;
        const covered = new Set();
        for (let c = 0; c < puz.list.length; c++) {
          const cells = puz.list[c].cells;
          let inside = true;
          for (const i of cells) if (!unitSet.has(i)) { inside = false; break; }
          if (!inside) continue;
          sum += puz.list[c].sum;
          used++;
          for (const i of cells) covered.add(i);
        }
        if (!used) continue;
        const rest = Array.from(unit).filter((i) => !covered.has(i));
        if (!rest.length || rest.length > 4) continue;
        let need = 45 - sum;
        for (const i of rest) if (grid[i]) need -= grid[i];
        const step = sumStep('innie', rest, need, cand, grid, { unit: u, cages: used });
        if (step) {
          step.units = [u];
          return step;
        }
      }
      return null;
    },
  });

  register({
    id: 'outie',
    name: '45 法则 · 外格',
    alias: ['Outie', '单元外格'],
    level: 3,
    order: 2,
    tagline: '笼子探出单元的那几格，和也是定值。',
    principle:
      '把和某条线（或某个宫）相交的笼子全取来。如果它们的格子合起来正好把这条线盖满，那么这些笼子的和 = 45 + 探出线外那几格的和。于是外格的和 = Σ笼和 - 45，同样是个定值。',
    howto: ['挑一条线或一个宫；', '取所有与它相交的笼子；', '确认这些笼子把这条线盖满了；', 'Σ笼和 - 45 就是探出去那几格的和。'],
    pitfalls: '「盖满」是硬前提。少盖一格都不行——那说明还有格子没被这些笼子解释，等式不成立。',
    find(state) {
      const { grid, cand, puz } = state;
      for (let u = 0; u < B.UNITS.length; u++) {
        const unit = B.UNITS[u];
        const unitSet = new Set(unit);
        const inside = new Set();
        const outside = new Set();
        let sum = 0;
        let used = 0;
        for (let c = 0; c < puz.list.length; c++) {
          const cells = puz.list[c].cells;
          let touch = false;
          for (const i of cells) if (unitSet.has(i)) { touch = true; break; }
          if (!touch) continue;
          sum += puz.list[c].sum;
          used++;
          for (const i of cells) {
            if (unitSet.has(i)) inside.add(i);
            else outside.add(i);
          }
        }
        if (!used || !outside.size) continue;
        let full = true;
        for (const i of unit) if (!inside.has(i)) { full = false; break; }
        if (!full) continue;
        const out = Array.from(outside);
        if (out.length > 4) continue;
        let need = sum - 45;
        for (const i of out) if (grid[i]) need -= grid[i];
        // 外格跨笼子，不要求互不相同
        const step = sumStep('outie', out, need, cand, grid, { unit: u, cages: used }, false);
        if (step) {
          step.units = [u];
          return step;
        }
      }
      return null;
    },
  });

  /* ==================== L5 · 笼内试数 ==================== */

  register({
    id: 'cage-trial',
    name: '笼内试数',
    alias: ['Cage Trial', '带笼子反证'],
    level: 5,
    order: 1,
    // 这一条每次触发都要跑十几次完整求解。提示面板每刷新一次就把所有技巧跑一遍，
    // 不标出来就会变成「点一下卡半秒」。标了之后只有别的技巧全都推不动时才轮到它。
    expensive: true,
    tagline: '假设某格取某个数，把笼子一起算进去往下推，推出矛盾就说明假设不成立。',
    principle:
      '数独那套「试数」只按同行列宫往下推，在杀手盘面上往往推不动——笼子的和它完全没用上。'
      + '这里改成每假设一步就用带笼子约束的求解器重新算一遍：如果这个假设下整道题一个解都没有，'
      + '那这个候选必然是错的。',
    howto: ['挑候选数最少的格子；', '逐个假设它取某个候选；', '每个假设都让求解器带着笼子重算一遍；', '推不出解的那个候选直接删掉。'],
    pitfalls: '这是兜底手段，代价高。前面那些技巧都走完了才轮到它——手工做更慢，卡住了直接点提示。',
    find(state) {
      const { grid, cand, puz } = state;
      // 只在候选少的格子上试，链最短、矛盾出得最快
      const picks = [];
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (grid[i]) continue;
        const k = B.popcount(cand[i]);
        if (k >= 2 && k <= 4) picks.push(i);
      }
      picks.sort((a, b) => B.popcount(cand[a]) - B.popcount(cand[b]));
      const trial = new Uint8Array(grid);
      for (let n = 0; n < Math.min(3, picks.length); n++) {
        const i = picks[n];
        const elims = [];
        for (const d of B.maskToDigits(cand[i])) {
          trial[i] = d;
          const r = KS.solve(puz, 1, null, trial);
          trial[i] = 0;
          if (r.count === 0) elims.push({ cell: i, digit: d });
        }
        if (elims.length) {
          return baseStep('cage-trial', {
            focusCell: i,
            cells: [i],
            eliminations: elims,
            detail: { cell: i, tried: B.maskToDigits(cand[i]).length },
          });
        }
      }
      return null;
    },
  });

  /* ==================== 合并引擎 ==================== */

  /**
   * 杀手引擎 = 笼子族 + 标准族。
   * 排序按 (等级, order)，笼子族的 order 从 1 起，所以同等级里笼子技巧先出场——
   * 在杀手盘面上它们才是这个难度的真实来源。
   */
  const ALL_TECHS = LIST.concat(SD.Techniques.LIST)
    .sort((a, b) => (a.level - b.level) || ((a.order || 0) - (b.order || 0)));

  const byId = {};
  for (const t of ALL_TECHS) byId[t.id] = t;

  const decorate = SD.Techniques.decorate;
  const commit = SD.Techniques.commit;

  /**
   * 依赖「唯一解 + 致命模式」的技巧在杀手盘面上不成立，必须整族排除。
   *
   * 唯一矩形的论证是：这个形状一旦出现，把四个格子的两个数字对调就能得到
   * 另一个**标准数独**解。但杀手多了一层笼子和——对调很可能破坏笼和，
   * 于是「另一个解」根本不存在，形状本身可以合法地待在唯一解盘面上。
   * 保留它就会删掉真解数字。这条是性质测试逼出来的，不是推测。
   */
  const needsUnique = (t) => !!t.needsUnique;

  /**
   * 标准族里这几条在杀手盘面上特别贵。数独开局有三十来个已知数，它们的搜索空间
   * 被压得很小；杀手开局全空，同样的技巧搜索空间拉满——实测 finny-fish 一次 28ms、
   * 强制链 14ms，一轮 findAll 光它们就 60ms 往上。
   *
   * 它们本来也都是最后手段。前面有更简单的解法时把它们列出来只是噪音，
   * 所以只有别的技巧一条都给不出来时才跑。
   */
  const EXPENSIVE = new Set([
    'finny-fish', 'unit-forcing-chain', 'cell-forcing-chain', 'multiple-forcing-chain',
    'trial', 'jellyfish', 'swordfish', 'naked-set-placement', 'degenerate-fish', 'sue-de-coq',
  ]);
  const isExpensive = (t) => !!t.expensive || EXPENSIVE.has(t.id);

  function findStepFrom(state, opts) {
    const maxLevel = (opts && opts.maxLevel) || 5;
    const only = (opts && opts.only) || null;
    for (const t of ALL_TECHS) {
      if (t.level > maxLevel) continue;
      if (only && only.indexOf(t.id) < 0) continue;
      if (needsUnique(t)) continue;
      const step = decorate(t, t.find(state));
      if (step) return step;
    }
    return null;
  }

  /**
   * 列出当前局面所有可用解法。标了 expensive 的技巧（笼内试数）留到最后——
   * 只有别的技巧一条都给不出来时才跑，否则每次刷新提示面板都要付十几毫秒。
   */
  function findAll(state, maxLevel) {
    const out = [];
    const fallback = [];
    for (const t of ALL_TECHS) {
      if (t.level > (maxLevel || 5) || !t.find) continue;
      if (needsUnique(t)) continue;
      if (isExpensive(t)) { fallback.push(t); continue; }
      const s = decorate(t, t.find(state));
      if (s) out.push(s);
    }
    if (!out.length) {
      for (const t of fallback) {
        const s = decorate(t, t.find(state));
        if (s) out.push(s);
      }
    }
    return out;
  }

  function branchCount(state, maxLevel) {
    let acts = 0;
    for (const t of ALL_TECHS) {
      if (t.level > (maxLevel || 5) || !t.find) continue;
      if (needsUnique(t) || isExpensive(t)) continue;
      const s = t.find(state);
      if (!s) continue;
      acts += (s.placements ? s.placements.length : 0) + (s.eliminations ? s.eliminations.length : 0);
      if (acts > 1) return acts;
    }
    return acts;
  }

  function makeState(puz, grid) {
    return {
      grid: grid,
      // 起点只用行列宫候选。笼子的过滤交给「笼内组合」显式做一步，
      // 否则那一步永远无事可做，玩家看不到「为什么这几个数字被排除」。
      cand: SD.Validation.computeCandidates(grid),
      puz: puz,
    };
  }

  /**
   * 按等级上限反复推理，评估题目的「人类可解性」与难度构成。
   * 和数独那边的 simulate 同一套账：技巧天花板 + 瓶颈占比一起算难度。
   */
  function simulate(puz, maxLevel, maxSteps, budgetMs) {
    const g = new Uint8Array(B.CELL_COUNT);
    const state = makeState(puz, g);
    const cand = state.cand;
    const used = {};
    const seen = new Set();
    const cap = maxSteps || 4000;
    // 步数上限挡不住耗时：每一步都要跑一遍 branchCount（几十次技巧探测），
    // 个别盘面会一路走到几千步，一次评级就吃掉几十秒。所以再加一道墙钟。
    const deadline = Date.now() + (budgetMs || 400);
    let steps = 0;
    let level = 0;
    let contradiction = false;
    let bottlenecks = 0;
    let timedOut = false;

    while (steps < cap) {
      if (Date.now() > deadline) { timedOut = true; break; }
      if (SD.Validation.isComplete(g)) break;
      let starved = false;
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (!g[i] && !cand[i]) { starved = true; break; }
      }
      if (starved) { contradiction = true; break; }

      const step = findStepFrom(state, { maxLevel: maxLevel });
      if (!step) break;
      const sig = step.id + '|' + step.placements.map((p) => p.cell + ':' + p.digit).join(',') + '|' +
        step.eliminations.map((e) => e.cell + ':' + e.digit).sort().join(',');
      if (!step.placements.length && seen.has(sig)) break;
      seen.add(sig);

      steps++;
      if (step.level > level) level = step.level;
      used[step.id] = (used[step.id] || 0) + 1;
      if (branchCount(state, maxLevel) <= 1) bottlenecks++;
      commit(g, cand, step);
    }

    return {
      solved: SD.Validation.isComplete(g),
      contradiction: contradiction,
      steps: steps,
      used: used,
      level: level,
      bottlenecks: bottlenecks,
      timedOut: timedOut,
      finalGrid: g,
    };
  }

  const WEIGHT = {
    'cage-last': 1,
    'naked-single': 1,
    'hidden-single': 2,
    'cage-combo': 4,
    'cage-required': 6,
    'innie': 10,
    'outie': 12,
    'locked-pointing': 4,
    'locked-claiming': 4,
    'naked-pair': 6,
    'hidden-pair': 7,
  };
  const STAR_BREAK = [130, 280, 470, 800];

  /**
   * 评级用 L1–L4 量，把 cage-trial 排除在外。
   *
   * cage-trial 是个「用求解器兜底」的技巧，强到只要一用就必然通关。
   * 把它算进等级的话，几乎所有题都会落到 L5——等级这一维就彻底没有分辨力了。
   * 所以：等级 = 靠人类技巧能走到哪一级；「必须试数」单独作为最高一档。
   */
  function rate(puz, maxLevel) {
    const sim = simulate(puz, maxLevel || 4, undefined, 400);
    let weight = 0;
    let total = 0;
    const breakdown = [];
    for (const id of Object.keys(sim.used)) {
      const n = sim.used[id];
      const t = byId[id];
      const w = (WEIGHT[id] || 5) * n;
      weight += w;
      total += n;
      breakdown.push({ id: id, name: t ? t.name : id, level: t ? t.level : 0, count: n, weight: w });
    }
    breakdown.sort((a, b) => b.weight - a.weight);

    const level = sim.level;
    const choke = sim.steps ? sim.bottlenecks / sim.steps : 0;
    const shape = Math.round(choke * 120);
    // score 只用来在多次尝试之间排序（挑「最接近目标」的那一道），
    // 星级不走它——杀手一道题动辄几十步笼内定数，权重一累加就把 1 星题顶到 3 星，
    // 与玩家体感完全脱节。星级直接看「需要用到哪一级技巧」，瓶颈多再加一星。
    const score = level * 120 + Math.min(weight, 200) + shape + (sim.solved ? 0 : 900);
    const star = sim.solved ? Math.min(4, level + (choke > 0.55 ? 1 : 0)) : 5;

    return {
      solved: sim.solved,
      // 评级没跑完（撞上时间预算）。这一档数字不可信，出题时应当跳过这道题。
      timedOut: sim.timedOut,
      // 靠 L1–L4 推不动，必须动用笼内试数
      needsTrial: !sim.solved,
      contradiction: sim.contradiction,
      level: level,
      levelName: sim.solved ? (SD.Techniques.LEVEL_NAME[level] || '基础') : '需试数',
      star: star,
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

  K.techniques = {
    LIST: LIST,
    ALL: ALL_TECHS,
    byId: byId,
    makeState: makeState,
    findStepFrom: findStepFrom,
    findAll: findAll,
    branchCount: branchCount,
    simulate: simulate,
    rate: rate,
    WEIGHT: WEIGHT,
  };
})(window);
