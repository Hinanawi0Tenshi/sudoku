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

  /* ==================== L2/L3 · 组合互斥 · 少解笼子组合 ==================== */

  const ODD_MASK = (function () { let m = 0; for (let d = 1; d <= 9; d += 2) m |= bit(d); return m; })();
  const EVEN_MASK = (function () { let m = 0; for (let d = 2; d <= 9; d += 2) m |= bit(d); return m; })();

  /**
   * 笼子剩余空格的「候选组合」：数字既不和笼内已填的重复，也得真的能落进某个空格。
   * 这一步只是粗筛（每个数字至少有一个落点），细筛交给 matchable。
   */
  function cageCombos(state, c, cap) {
    const { grid, cand, puz } = state;
    const r = C.remain(puz, grid, c);
    if (r.empty < 2) return null;
    const all = C.COMBOS[r.empty] && C.COMBOS[r.empty][r.left];
    if (!all || !all.length || all.length > cap) return null;
    const cells = puz.list[c].cells.filter((i) => !grid[i]);
    const out = [];
    for (const combo of all) {
      if (combo & r.used) continue;
      let ok = true;
      for (let t = 0; t < cells.length; t++) if (!(cand[cells[t]] & combo)) { ok = false; break; }
      if (ok) out.push(combo);
    }
    if (!out.length) return null;
    return { cells: cells, combos: out, used: r.used, left: r.left };
  }

  /**
   * 组合能不能真的摆进这些格子：数字和格子做二分匹配。
   * 只判「每个数字都有落点」是不够的——两个数字抢同一格时会漏判。
   * forced 用来固定某一格只能取某个数字，配合逐格试探算出「这一格可能拿到哪些数字」。
   */
  function matchable(cells, combo, cand, forced) {
    const digits = B.maskToDigits(combo);
    const n = cells.length;
    if (digits.length !== n) return false;
    const owner = new Int8Array(n).fill(-1);
    const visit = (ci, seen) => {
      const allow = forced && forced[ci] !== undefined ? forced[ci] : cand[cells[ci]];
      for (let di = 0; di < n; di++) {
        if (seen[di] || !(allow & bit(digits[di]))) continue;
        seen[di] = 1;
        if (owner[di] < 0 || visit(owner[di], seen)) { owner[di] = ci; return true; }
      }
      return false;
    };
    for (let ci = 0; ci < n; ci++) if (!visit(ci, new Int8Array(n))) return false;
    return true;
  }

  /** 逐格算出「在可行的摆法里，这一格可能拿到哪些数字」 */
  function cellReach(cells, combos, cand) {
    const n = cells.length;
    const reach = new Int32Array(n);
    for (const combo of combos) {
      if (!matchable(cells, combo, cand)) continue;
      for (let t = 0; t < n; t++) {
        for (const d of B.maskToDigits(cand[cells[t]] & combo)) {
          if (reach[t] & bit(d)) continue;
          const forced = {};
          forced[t] = bit(d);
          if (matchable(cells, combo, cand, forced)) reach[t] |= bit(d);
        }
      }
    }
    return reach;
  }

  register({
    id: 'cage-mutex',
    name: '组合互斥',
    alias: ['Cage Mutex', '组合与候选互斥'],
    level: 2,
    order: 3,
    tagline: '组合本身合法，不代表摆得进这些格子。',
    principle:
      '「3 格和为 8」的组合里可能有 {1,2,5}，但如果这三格里有两格的候选里都没有 5，这个组合就是废的。'
      + '把每个组合挨个往格子上摆一遍（数字互不相同，所以这是一次匹配），摆不进去的组合整个划掉；'
      + '剩下还摆得进去的组合里，从没出现在某格上的数字，就可以从那一格划掉。',
    howto: ['列出笼子的所有组合；', '逐个检查这个组合能不能摆进笼内的空格（每格都得有个它能取的数字）；', '把摆不进去的组合剔除；', '某格在所有剩下的组合里都拿不到的数字，划掉。'],
    pitfalls: '只看「每个数字都有落点」还不够——两个数字抢同一格时会误判。要确认整套组合能被分配下去。',
    find(state) {
      const { cand, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const p = cageCombos(state, c, 40);
        if (!p) continue;
        let union = 0;
        for (const x of p.combos) union |= x;
        const elims = [];
        for (const i of p.cells) {
          for (const d of B.maskToDigits(cand[i] & ~union)) elims.push({ cell: i, digit: d });
        }
        if (!elims.length) {
          // 粗筛筛不出东西时，再用匹配把「数字抢同一格」的组合剔掉。
          // 匹配是 O(n^3)，所以只在笼子小、组合少的时候做，否则每次刷新提示都要白付这份钱。
          if (p.cells.length > 5 || p.combos.length > 16) continue;
          const reach = cellReach(p.cells, p.combos, cand);
          for (let t = 0; t < p.cells.length; t++) {
            for (const d of B.maskToDigits(cand[p.cells[t]] & ~reach[t])) elims.push({ cell: p.cells[t], digit: d });
          }
        }
        if (!elims.length) continue;
        return baseStep('cage-mutex', {
          focusCell: p.cells[0],
          cells: puz.list[c].cells.slice(),
          eliminations: elims,
          detail: { cage: c, sum: puz.list[c].sum, combos: p.combos.length },
        });
      }
      return null;
    },
  });

  register({
    id: 'cage-few',
    name: '少解笼子组合',
    alias: ['Few Combinations', '组合少到能定数'],
    level: 3,
    order: 3,
    tagline: '组合只剩两三种时，笼内哪一格放哪个数字往往已经定了。',
    principle:
      '笼子的「和」和「格数」一起把组合限得很死时，剩下的组合常常只有两三种。'
      + '把这几种组合挨个往笼内的空格上分一遍，如果某一格在所有分得进去的摆法里都只拿到同一个数字，'
      + '那它就已经是定数了——不需要再等别的技巧。',
    howto: ['列出笼子剩余的组合；', '把每个组合按「每格取一个互不相同的数字」分到笼内的空格上；', '某一格在所有可行摆法里都只有同一个数字，就把它填上。'],
    pitfalls: '只对「组合少」的笼子做（≤3 种）。组合一多，几乎不会出现定数，白花计算。',
    find(state) {
      const { cand, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const p = cageCombos(state, c, 12);
        if (!p) continue;
        const alive = [];
        for (const combo of p.combos) if (matchable(p.cells, combo, cand)) alive.push(combo);
        if (!alive.length || alive.length > 3) continue;
        const reach = cellReach(p.cells, alive, cand);
        for (let t = 0; t < p.cells.length; t++) {
          const ds = B.maskToDigits(reach[t]);
          if (ds.length !== 1) continue;
          return baseStep('cage-few', {
            focusCell: p.cells[t],
            focusDigit: ds[0],
            cells: puz.list[c].cells.slice(),
            placements: [{ cell: p.cells[t], digit: ds[0] }],
            detail: { cage: c, sum: puz.list[c].sum, combos: alive.length, empty: p.cells.length },
          });
        }
      }
      return null;
    },
  });

  /* ==================== L3 · 笼子分割 / 宫线笼减 ==================== */

  /**
   * 笼子按单元边界切开后，探进某个单元的那一段和是多少？
   *
   * 这段本身不是笼子，和也不直接知道——但它只能是「笼子剩余组合」里的若干个数字，
   * 于是它的和落在一个区间里。用它去夹该单元里剩下的格子。
   *
   * exact=false：单元里正好还剩一格没被这个笼子盖住，用区间夹这一格。
   * exact=true ：单元被「笼内这一段 + 已填格」完全盖满，这一段的和是定值，
   *              于是它等价于一个和已知的虚拟笼子，可以按组合排除。
   */
  function unitPartFind(state, id, exact) {
    const { grid, cand, puz } = state;
    for (let c = 0; c < puz.list.length; c++) {
      const cells = puz.list[c].cells;
      const r = C.remain(puz, grid, c);
      if (!r.empty) continue;
      const combos = C.COMBOS[r.empty] && C.COMBOS[r.empty][r.left];
      if (!combos || !combos.length || combos.length > 80) continue;
      for (let u = 0; u < B.UNITS.length; u++) {
        const unit = B.UNITS[u];
        const inside = [];
        const outside = [];
        for (const i of cells) (unit.indexOf(i) >= 0 ? inside : outside).push(i);
        // 完全落在单元内的归 45 法则；完全在外面的和这个单元无关
        if (!inside.length || !outside.length) continue;
        const insideSet = new Set(inside);
        let fixed = 0;
        const emptyInside = [];
        for (const i of inside) { if (grid[i]) fixed += grid[i]; else emptyInside.push(i); }
        if (!emptyInside.length) continue;
        let restCell = -1;
        let restCount = 0;
        for (const i of unit) {
          if (insideSet.has(i)) continue;
          if (grid[i]) { fixed += grid[i]; continue; }
          restCount++;
          restCell = i;
        }
        const k = emptyInside.length;

        if (exact) {
          if (restCount !== 0) continue;
          const need = 45 - fixed;
          if (need < 1 || need > 45) continue;
          if (k === 1) {
            const i = emptyInside[0];
            if (need < 1 || need > 9 || !(cand[i] & bit(need))) continue;
            return baseStep(id, {
              focusCell: i, focusDigit: need, cells: cells.slice(), units: [u],
              placements: [{ cell: i, digit: need }],
              detail: { cage: c, sum: puz.list[c].sum, unit: u, need: need, count: k },
            });
          }
          const mask = C.possible(k, need);
          if (!mask) continue;
          const elims = [];
          for (const i of emptyInside) {
            for (const d of B.maskToDigits(cand[i] & ~mask)) elims.push({ cell: i, digit: d });
          }
          if (!elims.length) continue;
          return baseStep(id, {
            cells: cells.slice(), units: [u], eliminations: elims,
            detail: { cage: c, sum: puz.list[c].sum, unit: u, need: need, count: k, mask: mask },
          });
        }

        if (restCount !== 1) continue;
        // 探进单元的这一段最少取 k 个最小的、最多取 k 个最大的
        let lo = 99;
        let hi = -1;
        for (const combo of combos) {
          if (combo & r.used) continue;
          const ds = B.maskToDigits(combo);
          if (ds.length < k) continue;
          let small = 0;
          let big = 0;
          for (let t = 0; t < k; t++) { small += ds[t]; big += ds[ds.length - 1 - t]; }
          if (small < lo) lo = small;
          if (big > hi) hi = big;
        }
        if (hi < 0) continue;
        const vLo = Math.max(1, 45 - fixed - hi);
        const vHi = Math.min(9, 45 - fixed - lo);
        if (vLo > vHi) continue;
        const elims = [];
        for (const d of B.maskToDigits(cand[restCell])) {
          if (d < vLo || d > vHi) elims.push({ cell: restCell, digit: d });
        }
        if (!elims.length) continue;
        return baseStep(id, {
          focusCell: restCell, cells: cells.slice(), units: [u], eliminations: elims,
          detail: { cage: c, sum: puz.list[c].sum, unit: u, lo: vLo, hi: vHi },
        });
      }
    }
    return null;
  }

  register({
    id: 'cage-split',
    name: '笼子分割',
    alias: ['Cage Split', '跨单元笼子'],
    level: 3,
    order: 4,
    tagline: '笼子探进单元的那一段，和虽然没定，但有个范围。',
    principle:
      '笼子跨出单元时，落在单元里的那几格不能单独求和——它们只是笼子组合的一部分。'
      + '但组合只有那么几种，每种里「最小的几格之和」到「最大的几格之和」是能算出来的，'
      + '于是这一段的和一个区间。单元总和是 45，剩下的那一格就被夹在这个区间里。',
    howto: ['找一个探进某单元、又探出去的笼子；', '列出它的所有组合；', '算出探进单元的那几格的和的最小值与最大值；', '45 减去这段和、再减去单元里已填的数字，就是剩下那一格的范围。'],
    pitfalls: '只对「单元里正好还剩一格没被这个笼子盖住」成立。剩两格以上时只能算出两格之和的范围，夹不出单格。',
    find(state) { return unitPartFind(state, 'cage-split', false); },
  });

  register({
    id: 'cage-line',
    name: '宫线笼减',
    alias: ['Cage Line Reduction', '笼内定和'],
    level: 3,
    order: 5,
    tagline: '笼子探出单元的那一头填满了，探进来的一段和就定了。',
    principle:
      '一条线（或一个宫）被「某个笼子探进来的那几格」和「已经填好的格子」正好盖满时，'
      + '45 减去已填的数字，就是笼内那一段的和——它是定值。'
      + '于是这一段等价于一个和已知的虚拟笼子，可以按组合把候选划掉。',
    howto: ['挑一条线或一个宫；', '找一个探进来又探出去的笼子；', '确认单元里除了这个笼子的那几格，剩下的格子都已经填了；', '45 减去已填数字就是笼内这段的和，按组合排除。'],
    pitfalls: '必须「盖满」——单元里还有空格时等式不成立，那段的和是未知的。',
    find(state) { return unitPartFind(state, 'cage-line', true); },
  });

  /* ==================== L4 · 笼子比较 / 奇偶规则 ==================== */

  register({
    id: 'cage-compare',
    name: '笼子比较',
    alias: ['Cage Comparison', '两笼对照'],
    level: 4,
    order: 1,
    tagline: '一个笼子这么摆，会让旁边那个笼子彻底没得摆。',
    principle:
      '两个笼子如果整个落在同一个单元里，它们互相「看得见」——数字不能重复。'
      + '这时把笼 A 的每个组合拿去和笼 B 的所有组合比一遍：'
      + '如果 A 取某个组合之后，B 的每一种组合都和它撞数字，那 B 就没得摆了，说明 A 这个组合不可能。',
    howto: ['找两个整个落在同一行（列 / 宫）里的笼子；', '列出两个笼子各自剩余的组合；', '拿 A 的每个组合去比 B 的所有组合；', '让 B 无路可走的那些组合作废，只出现在作废组合里的数字划掉。'],
    pitfalls: '两个笼子必须整个落在同一个单元里。有一个探出单元，它们的数字就不再互相排斥，比不了。',
    find(state) {
      const { cand, puz } = state;
      const cache = [];
      for (let c = 0; c < puz.list.length; c++) cache[c] = cageCombos(state, c, 12);
      for (let u = 0; u < B.UNITS.length; u++) {
        const unit = B.UNITS[u];
        const unitSet = new Set(unit);
        const inner = [];
        for (let c = 0; c < puz.list.length; c++) {
          const p = cache[c];
          if (!p) continue;
          let inside = true;
          for (const i of puz.list[c].cells) if (!unitSet.has(i)) { inside = false; break; }
          if (inside) inner.push({ cage: c, p: p });
        }
        if (inner.length < 2) continue;
        for (let a = 0; a < inner.length; a++) {
          const A = inner[a];
          for (let b = 0; b < inner.length; b++) {
            if (b === a) continue;
            const other = inner[b].p.combos;
            const keep = [];
            for (const x of A.p.combos) {
              let ok = false;
              for (const y of other) if (!(x & y)) { ok = true; break; }
              if (ok) keep.push(x);
            }
            if (!keep.length || keep.length === A.p.combos.length) continue;
            const reach = new Int32Array(A.p.cells.length);
            for (const x of keep) for (let t = 0; t < A.p.cells.length; t++) reach[t] |= x;
            const elims = [];
            for (let t = 0; t < A.p.cells.length; t++) {
              for (const d of B.maskToDigits(cand[A.p.cells[t]] & ~reach[t])) elims.push({ cell: A.p.cells[t], digit: d });
            }
            if (!elims.length) continue;
            return baseStep('cage-compare', {
              focusCell: A.p.cells[0],
              cells: puz.list[A.cage].cells.slice(),
              units: [u],
              eliminations: elims,
              detail: { cage: A.cage, other: inner[b].cage, unit: u, kept: keep.length, total: A.p.combos.length },
            });
          }
        }
      }
      return null;
    },
  });

  register({
    id: 'cage-parity',
    name: '奇偶规则',
    alias: ['Parity', '奇偶夹逼'],
    level: 4,
    order: 2,
    tagline: '两格的和是奇数，这两格就一奇一偶。',
    principle:
      '两个数字相加，和的奇偶由两个数字的奇偶决定：一奇一偶得奇数，同奇或同偶得偶数。'
      + '所以笼子剩两格时，剩余和一旦定了，两格的奇偶关系也就定了。'
      + '如果其中一格的候选全是奇数（或全是偶数），另一格的奇偶就被逼死，可以删掉一半候选。',
    howto: ['找只剩两格没填的笼子；', '看剩下的和是奇数还是偶数；', '如果其中一格的候选只剩一种奇偶，另一格就必须是另一种（或同一种）；', '把另一格里不符合的候选划掉。'],
    pitfalls: '只对两格成立。三格以上时「和是奇数」只能推出「奇数的个数是奇数个」，推不出某格的奇偶。',
    find(state) {
      const { grid, cand, puz } = state;
      for (let c = 0; c < puz.list.length; c++) {
        const r = C.remain(puz, grid, c);
        if (r.empty !== 2) continue;
        const cells = puz.list[c].cells;
        const empty = cells.filter((i) => !grid[i]);
        if (empty.length !== 2) continue;
        const need = r.left;
        if (need < 3 || need > 17) continue;
        const opposite = need % 2 === 1;
        const [a, b] = empty;
        const elims = [];
        const force = (from, to) => {
          const oddOnly = !(cand[from] & EVEN_MASK);
          const evenOnly = !(cand[from] & ODD_MASK);
          if (oddOnly === evenOnly) return; // 两种奇偶都还有，逼不出东西
          const toOdd = oddOnly ? !opposite : opposite;
          const bad = toOdd ? EVEN_MASK : ODD_MASK;
          for (const d of B.maskToDigits(cand[to] & bad)) elims.push({ cell: to, digit: d });
        };
        force(a, b);
        force(b, a);
        if (!elims.length) continue;
        return baseStep('cage-parity', {
          focusCell: a, cells: cells.slice(), eliminations: elims,
          detail: { cage: c, sum: puz.list[c].sum, need: need, opposite: opposite },
        });
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
    // 新加的六条：权重只影响分数，不影响星级（星级看 level）。
    // 组合互斥最便宜，宫线笼减是 45 法则的变体，笼子比较最绕。
    'cage-mutex': 3,
    'cage-few': 6,
    'cage-split': 8,
    'cage-line': 9,
    'cage-compare': 11,
    'cage-parity': 8,
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
