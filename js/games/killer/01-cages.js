/* 杀手数独 · 笼子模型
 *
 * 笼子是「一组格子，数字互不相同、和等于给定值」的约束。它和数独原本的
 * 行列宫约束是叠加的，不是替代的——所以这个文件只负责笼子那一半，
 * 行/列/宫的候选扣除仍然走 SD.Validation。
 *
 * 组合表在加载时一次算完：笼子只有 9 种尺寸、和只到 45，
 * 全部子集也就 512 个，穷举一遍一劳永逸。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;
  const N = B.N;

  /** COMBOS[k][s] = 所有「k 个不同数字、和为 s」的组合，每个组合是一个 9 位掩码 */
  const COMBOS = [];
  for (let k = 0; k <= N; k++) {
    COMBOS[k] = [];
    for (let s = 0; s <= 45; s++) COMBOS[k][s] = [];
  }
  for (let mask = 0; mask < (1 << N); mask++) {
    let k = 0;
    let sum = 0;
    for (let d = 1; d <= N; d++) {
      if (mask & (1 << (d - 1))) { k++; sum += d; }
    }
    COMBOS[k][sum].push(mask);
  }
  COMBOS[0][0] = [0];

  /** 还剩 k 格、还差 s 时，笼子里可能出现哪些数字（并集） */
  function possible(k, s) {
    const list = k >= 0 && k <= N && s >= 0 && s <= 45 ? COMBOS[k][s] : null;
    if (!list || !list.length) return 0;
    let m = 0;
    for (const x of list) m |= x;
    return m;
  }

  /** 哪些数字必定在笼子里（所有组合都含它）。用于向外排除。 */
  function required(k, s) {
    const list = k >= 0 && k <= N && s >= 0 && s <= 45 ? COMBOS[k][s] : null;
    if (!list || !list.length) return 0;
    let m = B.ALL;
    for (const x of list) m &= x;
    return m;
  }

  const comboCount = (k, s) => (COMBOS[k] && COMBOS[k][s] ? COMBOS[k][s].length : 0);

  /** 把笼子列表包成题目对象，顺便建出「每格属于哪个笼子」的查表 */
  function create(list) {
    const cageOf = new Int8Array(B.CELL_COUNT).fill(-1);
    for (let c = 0; c < list.length; c++) {
      for (const i of list[c].cells) cageOf[i] = c;
    }
    return { list: list, cageOf: cageOf };
  }

  /** 笼子还剩几格、还差多少和。用于组合查询。 */
  function remain(puz, grid, c) {
    let used = 0;
    let empty = 0;
    let left = puz.list[c].sum;
    for (const i of puz.list[c].cells) {
      const d = grid[i];
      if (d) { used |= B.bit(d); left -= d; } else empty++;
    }
    return { used: used, empty: empty, left: left };
  }

  /**
   * 每格的「笼子候选掩码」：把笼内已填数字、剩余格数、剩余和三条一起考虑后，
   * 该格还可能放哪些数字。这是笼子组合法在人这一侧的完整表达。
   */
  function masks(puz, grid) {
    const out = new Int32Array(B.CELL_COUNT);
    for (let c = 0; c < puz.list.length; c++) {
      const r = remain(puz, grid, c);
      if (!r.empty) continue;
      const m = possible(r.empty, r.left) & ~r.used;
      for (const i of puz.list[c].cells) if (!grid[i]) out[i] = m;
    }
    return out;
  }

  /** 行列宫 + 笼子，两边一起扣 */
  function computeCandidates(puz, grid) {
    const base = SD.Validation.computeCandidates(grid);
    const cm = masks(puz, grid);
    const out = new Int32Array(B.CELL_COUNT);
    for (let i = 0; i < B.CELL_COUNT; i++) out[i] = grid[i] ? 0 : (base[i] & cm[i]);
    return out;
  }

  /**
   * 盘面是否符合这个笼子题目。返回 null 表示没问题，否则给一句人话。
   * 用于「检查」按钮和导入校验——只说「错了」帮不上忙，得说清错在哪。
   */
  function check(puz, grid) {
    for (let c = 0; c < puz.list.length; c++) {
      const cg = puz.list[c];
      let sum = 0;
      let seen = 0;
      let filled = 0;
      for (const i of cg.cells) {
        const d = grid[i];
        if (!d) continue;
        filled++;
        sum += d;
        if (seen & B.bit(d)) return { cage: c, reason: '笼子里的数字重复了' };
        seen |= B.bit(d);
      }
      if (filled === cg.cells.length && sum !== cg.sum) {
        return { cage: c, reason: '笼子的和是 ' + sum + '，要求 ' + cg.sum };
      }
      if (sum > cg.sum) return { cage: c, reason: '笼子的和已经超过要求了' };
    }
    const conflict = SD.Validation.findConflicts(grid);
    if (conflict.size) return { cage: -1, reason: '有重复数字' };
    return null;
  }

  /** 笼子填满了没有 */
  const cageFull = (puz, grid, c) => puz.list[c].cells.every((i) => grid[i]);

  K.cages = {
    COMBOS: COMBOS,
    possible: possible,
    required: required,
    comboCount: comboCount,
    create: create,
    remain: remain,
    masks: masks,
    computeCandidates: computeCandidates,
    check: check,
    cageFull: cageFull,
  };
})(window);
