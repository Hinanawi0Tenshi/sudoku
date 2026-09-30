/* 数独 · 人类解题技巧引擎
 *
 * 每个技巧提供两样东西：
 *   find(state) —— 在当前局面找出一步推理，返回结构化 Step
 *   元数据      —— 等级、类别、原理、步骤、常见误区，供「算法教学」面板使用
 *
 * 三条硬性约束，都是被测试逼出来的：
 * 1. 所有推理只基于「基础候选数」（只扣同行/列/宫已有数字），因此对人是可解释的。
 * 2. 每条技巧的结论都必须在「唯一解」的题目上成立。依赖唯一性前提的技巧
 *    （唯一矩形）只在唯一解题面上有效，这一点在测试里单独隔离验证。
 * 3. 删除的候选必须是「所有分支都成立」的那一个。XY-Wing 只删 z 不删 x，
 *    就是因为 x 只在一条分支下成立——错删会直接把人带沟里。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const bit = B.bit;
  const ALL = B.ALL;
  const popcount = B.popcount;
  const digitsOf = B.maskToDigits;
  const ROW = B.ROW_OF;
  const COL = B.COL_OF;
  const BOX = B.BOX_OF;
  const UNITS = B.UNITS;
  const N = B.N;

  const rc = (i) => 'R' + (ROW[i] + 1) + 'C' + (COL[i] + 1);
  const unitName = (u) => (u < N ? '第 ' + (u + 1) + ' 行' : u < 2 * N ? '第 ' + (u - N + 1) + ' 列' : '第 ' + (u - 2 * N + 1) + ' 宫');

  function sharesUnit(a, b) {
    return ROW[a] === ROW[b] || COL[a] === COL[b] || BOX[a] === BOX[b];
  }

  function baseStep(id, o) {
    return Object.assign(
      { id: id, cells: [], units: [], placements: [], eliminations: [], marks: [], focusCell: null, focusDigit: 0, detail: {} },
      o
    );
  }

  const LIST = [];
  const register = (def) => { LIST.push(def); return def; };

  /* ==================== L1 · 基础 ==================== */

  register({
    id: 'naked-single',
    name: '唯一余数法',
    alias: ['唯一候选数', 'Last Digit'],
    level: 1,
    category: '基础',
    order: 10,
    tagline: '某个空格只剩一个候选数，不用再想，直接填。',
    principle:
      '每个格子最终只能放 1 到 9 中的一个数字。如果周围 20 格（同行 8 + 同列 8 + 同宫 4）里已经出现了其余 8 个数字，那这一格别无选择。',
    howto: ['扫一遍盘面，找候选数只剩 1 个的空格；', '直接落子；', '填完立刻更新同行、同列、同宫的候选数，往往会连锁触发更多唯一余数。'],
    pitfalls: '同一区域里一旦出现重复数字，后续所有唯一余数都不可信——先修冲突再谈推理。',
    find(state) {
      const { grid, cand } = state;
      let best = -1;
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (grid[i] || popcount(cand[i]) !== 1) continue;
        if (best < 0 || cand[i] < cand[best]) best = i;
      }
      if (best < 0) return null;
      const d = B.firstDigit(cand[best]);
      return baseStep('naked-single', {
        focusCell: best,
        focusDigit: d,
        cells: [best],
        units: Array.from(B.UNITS_OF[best]),
        placements: [{ cell: best, digit: d }],
        marks: Array.from(B.PEERS[best]).filter((p) => !grid[p]).map((p) => ({ cell: p, digit: d })),
        detail: { excluded: Array.from(B.PEERS[best]).filter((p) => grid[p]).map((p) => ({ cell: p, digit: grid[p] })) },
      });
    },
  });

  register({
    id: 'hidden-single',
    name: '隐性唯一余数',
    alias: ['区块摒除', 'Hidden Single', '唯一位置'],
    level: 1,
    category: '基础',
    order: 11,
    tagline: '某个数字在一条线（行 / 列 / 宫）里只剩一个落点。',
    principle: '数字 d 在每一行、每一列、每一宫都必须恰好出现一次。若在一行里，d 的候选只落在一个格子上，那个格子就是 d 唯一的家。',
    howto: ['按行、列、宫逐个扫描某个数字的候选位置；', '当该数字在这条线里只剩 1 个候选格时，把它填进去；', '注意这一格本身往往还有多个候选数。'],
    pitfalls: '别只盯着「候选数只剩一个」的格子——隐性唯一的答案格可能候选很多。',
    find(state) {
      const { grid, cand } = state;
      for (let u = 0; u < UNITS.length; u++) {
        const unit = UNITS[u];
        for (let d = 1; d <= N; d++) {
          const mb = bit(d);
          let count = 0;
          let target = -1;
          for (let k = 0; k < N; k++) {
            const i = unit[k];
            if (grid[i] || !(cand[i] & mb)) continue;
            count++;
            target = i;
            if (count > 1) break;
          }
          if (count === 1) {
            return baseStep('hidden-single', {
              focusCell: target,
              focusDigit: d,
              cells: [target],
              units: [u],
              placements: [{ cell: target, digit: d }],
              marks: Array.from(unit).filter((i) => !grid[i]).map((i) => ({ cell: i, digit: d })),
              detail: { unit: u, unitCells: Array.from(unit) },
            });
          }
        }
      }
      return null;
    },
  });

  /* ==================== L2 · 排除 ==================== */

  /**
   * 区块摒除。两种形态互为镜像：
   *   pointing：看宫，候选挤在同一行 / 同一列 → 删该行 / 列在宫外的候选。
   *   claiming：看行 / 列，候选全挤在同一个宫 → 删该宫在行 / 列外的候选。
   * 关键区别在于「谁被锁住」：宫区块锁的是宫，行列区块锁的是行列。
   */
  function lockedCandidates(state, mode) {
    const { grid, cand } = state;
    const scanUnits =
      mode === 'pointing'
        ? [18, 19, 20, 21, 22, 23, 24, 25, 26]
        : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

    for (const u of scanUnits) {
      const unit = UNITS[u];
      for (let d = 1; d <= N; d++) {
        const mb = bit(d);
        const positions = [];
        for (let k = 0; k < N; k++) {
          const i = unit[k];
          if (!grid[i] && cand[i] & mb) positions.push(i);
        }
        if (positions.length < 2) continue;

        if (mode === 'pointing') {
          const box = BOX[positions[0]];
          const rows = new Set(positions.map((i) => ROW[i]));
          const cols = new Set(positions.map((i) => COL[i]));

          if (rows.size === 1) {
            const r = ROW[positions[0]];
            const elims = [];
            for (let c = 0; c < N; c++) {
              const i = r * N + c;
              if (BOX[i] === box || grid[i] || !(cand[i] & mb)) continue;
              elims.push({ cell: i, digit: d });
            }
            if (elims.length) {
              return baseStep('locked-pointing', {
                focusCell: positions[0],
                focusDigit: d,
                cells: positions.concat(elims.map((x) => x.cell)),
                units: [u, r],
                eliminations: elims,
                marks: positions.map((i) => ({ cell: i, digit: d })),
                detail: { box: box, row: r, col: -1 },
              });
            }
          }

          if (cols.size === 1) {
            const c = COL[positions[0]];
            const elims = [];
            for (let r = 0; r < N; r++) {
              const i = r * N + c;
              if (BOX[i] === box || grid[i] || !(cand[i] & mb)) continue;
              elims.push({ cell: i, digit: d });
            }
            if (elims.length) {
              return baseStep('locked-pointing', {
                focusCell: positions[0],
                focusDigit: d,
                cells: positions.concat(elims.map((x) => x.cell)),
                units: [u, N + c],
                eliminations: elims,
                marks: positions.map((i) => ({ cell: i, digit: d })),
                detail: { box: box, row: -1, col: c },
              });
            }
          }
          continue;
        }

        const boxes = new Set(positions.map((i) => BOX[i]));
        if (boxes.size !== 1) continue;
        const box = BOX[positions[0]];
        const isRow = u < N;
        const elims = [];
        for (const cell of UNITS[18 + box]) {
          if (isRow ? ROW[cell] === ROW[positions[0]] : COL[cell] === COL[positions[0]]) continue;
          if (grid[cell] || !(cand[cell] & mb)) continue;
          elims.push({ cell: cell, digit: d });
        }
        if (!elims.length) continue;
        return baseStep('locked-claiming', {
          focusCell: positions[0],
          focusDigit: d,
          cells: positions.concat(elims.map((x) => x.cell)),
          units: isRow ? [u, 18 + box] : [u, 18 + box],
          eliminations: elims,
          marks: positions.map((i) => ({ cell: i, digit: d })),
          detail: { box: box, fromRow: isRow },
        });
      }
    }
    return null;
  }

  register({
    id: 'locked-pointing',
    name: '宫区块摒除',
    alias: ['宫区块', 'Block Intersection', '指针法'],
    level: 2,
    category: '排除',
    order: 20,
    tagline: '某数字在宫里挤在同一行 / 同一列上，宫外同行 / 同列删候选。',
    principle:
      '假设数字 d 在某个宫里能放的位置只剩同一行的两格。若 d 最终落在这一行，两格中必有一格是 d，于是该行的宫外格子都不可能是 d。',
    howto: ['逐宫扫描某个数字的全部候选位置；', '若它们全在同一行 → 该行宫外的格子删掉这个候选；', '若全在同一列 → 同理处理该列。'],
    pitfalls: '候选只剩 1 个时，这条已经退化成隐性唯一余数，没有额外信息量。',
    find(state) {
      return lockedCandidates(state, 'pointing');
    },
  });

  register({
    id: 'locked-claiming',
    name: '行列区块摒除',
    alias: ['行列区块', 'Block Intersection', 'Claiming'],
    level: 2,
    category: '排除',
    order: 21,
    tagline: '某数字在一行里全挤在同一个宫上，该宫的宫外删候选。',
    principle:
      '若数字 d 在某行里的候选全部落在同一个宫内，那么这一行必然要装一个 d，只能落在那个宫的格子里，于是这个宫已经被「用掉」，宫内该行之外的格子都不能是 d。列的情形完全对称。',
    howto: ['逐行、逐列扫描某个数字的候选位置；', '若它们全在同一个宫 → 该宫内、行外（或列外）的格子删掉这个候选。'],
    pitfalls: '条件是「全在同一个宫」，不是「全在同一列」——同一行的同一列只可能有一个格子，那样的条件永远无法成立。',
    find(state) {
      return lockedCandidates(state, 'claiming');
    },
  });

  register({
    id: 'naked-pair',
    name: '显性数对',
    alias: ['显性对子', 'Naked Pair', '明确数对'],
    level: 2,
    category: '排除',
    order: 22,
    tagline: '同区域两格候选完全相同且只有两个 → 该区域其余格删掉这两个数。',
    principle: '若同一行 / 列 / 宫里恰好两格的候选都是 {a, b}，那么 a 和 b 必然被这两格用掉，区域内其他格自然不可能再是 a 或 b。',
    howto: ['在每个行 / 列 / 宫里找候选数只有 2 个的格子；', '若另一个格子候选完全相同 → 成对；', '在该区域内其余格删掉这两个候选。'],
    pitfalls: '数对必须落在同一个「区域」内才成立，跨区域的同候选不算。',
    find(state) {
      const { grid, cand } = state;
      for (let u = 0; u < UNITS.length; u++) {
        const unit = UNITS[u];
        for (let a = 0; a < N; a++) {
          const i = unit[a];
          if (grid[i] || popcount(cand[i]) !== 2) continue;
          for (let bI = a + 1; bI < N; bI++) {
            const j = unit[bI];
            if (grid[j] || cand[j] !== cand[i]) continue;
            const elims = [];
            for (let k = 0; k < N; k++) {
              const t = unit[k];
              if (t === i || t === j || grid[t]) continue;
              const hit = cand[t] & cand[i];
              if (!hit) continue;
              for (const d of digitsOf(hit)) elims.push({ cell: t, digit: d });
            }
            if (!elims.length) continue;
            const ds = digitsOf(cand[i]);
            return baseStep('naked-pair', {
              focusCell: i,
              focusDigit: ds[0],
              cells: [i, j].concat(elims.map((x) => x.cell)),
              units: [u],
              eliminations: elims,
              marks: [
                { cell: i, digit: ds[0] }, { cell: i, digit: ds[1] },
                { cell: j, digit: ds[0] }, { cell: j, digit: ds[1] },
              ],
              detail: { pair: [i, j], mask: cand[i] },
            });
          }
        }
      }
      return null;
    },
  });

  register({
    id: 'hidden-pair',
    name: '隐性数对',
    alias: ['隐性对子', 'Hidden Pair'],
    level: 2,
    category: '排除',
    order: 23,
    tagline: '两个数字在一个区域里只能挤进同两格 → 这两格删掉其它候选。',
    principle: '若数字 a、b 在某行 / 列 / 宫里的全部候选位置合起来恰好是两格，那么这两格必然是 a 和 b，其余候选数都可以删掉。',
    howto: ['在区域内统计每个数字的候选格数；', '找两个数字，其候选格并集恰好为 2 格；', '把这 2 格里的其它候选删掉。'],
    pitfalls: '隐性数对的目标格里可能已经填了数——那是隐性唯一余数，不必再删。',
    find(state) {
      const { grid, cand } = state;
      for (let u = 0; u < UNITS.length; u++) {
        const unit = UNITS[u];
        const posOf = {};
        for (let d = 1; d <= N; d++) {
          const list = [];
          for (let k = 0; k < N; k++) {
            const i = unit[k];
            if (!grid[i] && cand[i] & bit(d)) list.push(i);
          }
          if (list.length >= 2 && list.length <= 4) posOf[d] = list;
        }
        const ds = Object.keys(posOf).map(Number);
        for (let x = 0; x < ds.length; x++) {
          for (let y = x + 1; y < ds.length; y++) {
            const union = Array.from(new Set(posOf[ds[x]].concat(posOf[ds[y]])));
            if (union.length !== 2) continue;
            const keep = bit(ds[x]) | bit(ds[y]);
            const elims = [];
            for (const i of union) {
              const m = cand[i] & ~keep;
              if (m === cand[i]) continue;
              for (const d of digitsOf(m)) elims.push({ cell: i, digit: d });
            }
            if (!elims.length) continue;
            return baseStep('hidden-pair', {
              focusCell: union[0],
              focusDigit: ds[x],
              cells: union.concat(elims.map((z) => z.cell)),
              units: [u],
              eliminations: elims,
              marks: [
                { cell: union[0], digit: ds[x] }, { cell: union[0], digit: ds[y] },
                { cell: union[1], digit: ds[x] }, { cell: union[1], digit: ds[y] },
              ],
              detail: { digits: [ds[x], ds[y]], cells: union },
            });
          }
        }
      }
      return null;
    },
  });

  /* ==================== L3 · 进阶 ==================== */

  /** 显式 k 格组：区域内若干格候选完全相同且个数恰好为 k */
  function findNakedSubset(state, k, id) {
    const { grid, cand } = state;
    for (let u = 0; u < UNITS.length; u++) {
      const unit = UNITS[u];
      for (let a = 0; a < N; a++) {
        const i = unit[a];
        if (grid[i] || popcount(cand[i]) !== k) continue;
        const group = [i];
        for (let kk = 0; kk < N; kk++) {
          const t = unit[kk];
          if (t !== i && !grid[t] && cand[t] === cand[i]) group.push(t);
        }
        if (group.length !== k) continue;
        const elims = [];
        for (let kk = 0; kk < N; kk++) {
          const t = unit[kk];
          if (group.indexOf(t) >= 0 || grid[t]) continue;
          const hit = cand[t] & cand[i];
          if (!hit) continue;
          for (const d of digitsOf(hit)) elims.push({ cell: t, digit: d });
        }
        if (!elims.length) continue;
        const marks = [];
        for (const g of group) for (const d of digitsOf(cand[g])) marks.push({ cell: g, digit: d });
        return baseStep(id, {
          focusCell: i,
          focusDigit: digitsOf(cand[i])[0],
          cells: group.concat(elims.map((x) => x.cell)),
          units: [u],
          eliminations: elims,
          marks: marks,
          detail: { group: group, mask: cand[i] },
        });
      }
    }
    return null;
  }

  /** 隐性 k 格组：区域内 k 个数字的候选并集恰好为 k 格，则这 k 格只能是这些数字 */
  function findHiddenSubset(state, k, id) {
    const { grid, cand } = state;
    for (let u = 0; u < UNITS.length; u++) {
      const unit = UNITS[u];
      const posOf = {};
      for (let d = 1; d <= N; d++) {
        const list = [];
        for (let kk = 0; kk < N; kk++) {
          const i = unit[kk];
          if (!grid[i] && cand[i] & bit(d)) list.push(i);
        }
        if (list.length >= 2 && list.length <= k + 1) posOf[d] = list;
      }
      const ds = Object.keys(posOf).map(Number);

      // 必须是恰好 k 个数字：数字少于 k 时并集等于 k 格并不能保证每格都被占住，
      // 此时删候选会把合法解剪掉。
      for (const combo of combos(ds.length, k)) {
        const digits = combo.map((idx) => ds[idx]);
        const union = new Set();
        for (const d of digits) for (const i of posOf[d]) union.add(i);
        if (union.size !== k) continue;

        const cells = Array.from(union);
        const keep = digits.reduce((m, d) => m | bit(d), 0);
        const elims = [];
        for (const i of cells) {
          const m = cand[i] & ~keep;
          if (m === cand[i]) continue;
          for (const d of digitsOf(m)) elims.push({ cell: i, digit: d });
        }
        if (!elims.length) continue;

        const marks = [];
        for (const i of cells) for (const d of digits) marks.push({ cell: i, digit: d });
        return baseStep(id, {
          focusCell: cells[0],
          focusDigit: digits[0],
          cells: cells.concat(elims.map((x) => x.cell)),
          units: [u],
          eliminations: elims,
          marks: marks,
          detail: { digits: digits, cells: cells, unit: u },
        });
      }
    }
    return null;
  }
  register({
    id: 'naked-triple',
    name: '显性三数组',
    alias: ['Naked Triple'],
    level: 3,
    category: '进阶',
    order: 30,
    tagline: '同区域三格候选完全相同且只有三个 → 其余格删掉这三个数。',
    principle: '显性数对的推广：同区域三格候选都是 {a, b, c}，这三个数必然被这三格用尽。',
    howto: ['区域内找候选恰好 3 个的格子；', '若三格候选完全一致 → 三数组；', '区域内其它格子删掉这三个候选。'],
    pitfalls: '三组候选不必相邻，但必须同属一个区域。',
    find(state) {
      return findNakedSubset(state, 3, 'naked-triple');
    },
  });

  register({
    id: 'hidden-triple',
    name: '隐性三数组',
    alias: ['Hidden Triple'],
    level: 3,
    category: '进阶',
    order: 31,
    tagline: '三个数字在一个区域里只能挤进同三格 → 这三格删掉其它候选。',
    principle: '隐性数对的推广：三个数字的候选并集恰好等于三个格子。',
    howto: ['区域内统计三个数字的候选格并集；', '并集为 3 格即成立；', '这 3 格删掉并集之外的候选。'],
    pitfalls: '并集一旦混入第 4 个格子就不成立，别把两对误当成三组。',
    find(state) {
      return findHiddenSubset(state, 3, 'hidden-triple');
    },
  });

  /** 从 n 个元素里取 k 个的组合，按字典序 */
  function combos(n, k) {
    const out = [];
    const cur = [];
    (function rec(start) {
      if (cur.length === k) {
        out.push(cur.slice());
        return;
      }
      for (let i = start; i < n; i++) {
        cur.push(i);
        rec(i + 1);
        cur.pop();
      }
    })(0);
    return out;
  }

  /**
   * X-Wing（size=2）与三链列（size=3）。
   * 成立条件：每条基础线里 d 的候选都恰好落在同样 size 条覆盖线上。
   * 结论：覆盖线上、基础线之外的 d 候选全部作废。
   * 反证：设覆盖线 C 上基础线之外的格子 r 取了 d，则 C 用掉后基础线 B1 只能走另一条
   * 覆盖线 C'；C' 用掉又逼 B2 回到 C，与 B2 的候选只在覆盖线上矛盾。
   */
  function findFish(state, size) {
    const { grid, cand } = state;
    const id = size === 2 ? 'x-wing' : 'swordfish';

    const run = (baseIsRows) => {
      const at = (b, ci) => (baseIsRows ? b * N + ci : ci * N + b);

      for (let d = 1; d <= N; d++) {
        const mb = bit(d);
        for (const bases of combos(N, size)) {
          const baseSet = new Set(bases);
          const sets = bases.map((b) => {
            const s = new Set();
            for (let ci = 0; ci < N; ci++) {
              const i = at(b, ci);
              if (!grid[i] && cand[i] & mb) s.add(ci);
            }
            return s;
          });

          const cover = Array.from(sets[0]);
          if (cover.length !== size) continue;
          let same = true;
          for (let k = 1; k < sets.length && same; k++) {
            if (sets[k].size !== size) {
              same = false;
              break;
            }
            for (const ci of cover) {
              if (!sets[k].has(ci)) {
                same = false;
                break;
              }
            }
          }
          if (!same) continue;

          const elims = [];
          for (const ci of cover) {
            for (let k = 0; k < N; k++) {
              const i = baseIsRows ? k * N + ci : ci * N + k;
              const bi = baseIsRows ? ROW[i] : COL[i];
              if (baseSet.has(bi) || grid[i] || !(cand[i] & mb)) continue;
              elims.push({ cell: i, digit: d });
            }
          }
          if (!elims.length) continue;

          const marks = [];
          for (const b of bases) for (const ci of cover) marks.push({ cell: at(b, ci), digit: d });

          return baseStep(id, {
            focusCell: marks[0].cell,
            focusDigit: d,
            cells: marks.map((m) => m.cell).concat(elims.map((x) => x.cell)),
            units: (baseIsRows ? bases : bases.map((b) => N + b)).concat(
              baseIsRows ? cover.map((c) => N + c) : cover
            ),
            eliminations: elims,
            marks: marks,
            detail: { digit: d, bases: bases, cover: cover, baseIsRows: baseIsRows, size: size },
          });
        }
      }
      return null;
    };

    return run(true) || run(false);
  }

  register({
    id: 'x-wing',
    name: 'X-Wing',
    alias: ['双阶列', 'X 翼'],
    level: 3,
    category: '进阶',
    order: 32,
    tagline: '某数字在两行都只落在同样两列上 → 覆盖两列其余行的候选删掉。',
    principle:
      '设数字 d 在两行里的候选都只落在同样两列 c1、c2。反证：若 c1 列别处的一格取 d，则 c1 用掉后第一行只能取 c2；c2 用掉又逼第二行回到 c1 —— 与第二行候选只在 c1、c2 矛盾。所以这两列上其余位置的 d 全部作废。',
    howto: ['固定一个数字 d，找两行，它们的 d 候选都恰好落在同样两列；', '确认两行的候选列完全一致；', '删掉这两列其余行里的 d 候选。'],
    pitfalls: '行与列可以互换（转置的 X-Wing 同样成立）。若两列的候选本来就只在这两行，说明已被隐性唯一余数解决，不会产生删除。',
    find(state) {
      return findFish(state, 2);
    },
  });

  register({
    id: 'xy-wing',
    name: 'XY-Wing',
    alias: ['XY 翼'],
    level: 3,
    category: '进阶',
    order: 33,
    tagline: '一个 {x,y} 枢纽配两个 {x,z} / {y,z} 翼 → 同时看得到两翼的格子里删掉 z。',
    principle:
      '枢纽 P 的候选是 {x, y}，两个翼分别是 {x, z} 与 {y, z}，且 P 与每个翼各自同属一个区域（否则 P 取什么值都锁不住翼）。设 W 同时看得到两个翼：若 P = x，因 P 与第一翼同区域，第一翼被迫取 z，W 便不能是 z；若 P = y，同理第二翼被迫取 z，W 同样不能是 z。两条分支指向同一结论。',
    howto: [
      '找候选恰好是 {x, y} 的枢纽格 P；',
      '在 P 的关联格里找两个 2 候选格 {x, z} 与 {y, z}（典型布局是各在 P 的一行、一列）；',
      '在同时看得到这两个翼的格子里删掉 z。',
    ],
    pitfalls:
      '结论只针对 z。x 只在「枢纽取 y」这一条分支下成立，绝不能跟着一起删——这是最常见的误用。反过来，若要求「枢纽与翼不同区域」，条件会自相矛盾，永远解不出来。',
    find(state) {
      const { grid, cand } = state;
      const bivals = [];
      for (let i = 0; i < B.CELL_COUNT; i++) if (!grid[i] && popcount(cand[i]) === 2) bivals.push(i);

      for (const p of bivals) {
        const pd = digitsOf(cand[p]);
        const x = pd[0];
        const y = pd[1];

        for (const b1 of B.PEERS[p]) {
          if (grid[b1] || popcount(cand[b1]) !== 2) continue;
          const d1 = digitsOf(cand[b1]);
          let z = -1;
          let shared = -1;
          for (const d of d1) {
            if (d === x) shared = x;
            else if (d === y) shared = y;
            else z = d;
          }
          if (shared < 0 || z < 0) continue;
          const other = shared === x ? y : x;

          for (const b2 of B.PEERS[p]) {
            if (b2 <= b1 || grid[b2] || popcount(cand[b2]) !== 2) continue;
            const d2 = digitsOf(cand[b2]);
            if (d2.length !== 2 || !d2.includes(other) || !d2.includes(z)) continue;

            const elims = [];
            for (const t of B.PEERS[b1]) {
              if (t === p || B.PEERS[b2].indexOf(t) < 0 || grid[t]) continue;
              if (cand[t] & bit(z)) elims.push({ cell: t, digit: z });
            }
            if (!elims.length) continue;

            return baseStep('xy-wing', {
              focusCell: p,
              focusDigit: z,
              cells: [p, b1, b2].concat(elims.map((v) => v.cell)),
              units: [],
              eliminations: elims,
              marks: [
                { cell: p, digit: x }, { cell: p, digit: y },
                { cell: b1, digit: shared }, { cell: b1, digit: z },
                { cell: b2, digit: other }, { cell: b2, digit: z },
              ],
              detail: { pivot: p, biff1: b1, biff2: b2, x: x, y: y, z: z, shared: shared, other: other },
            });
          }
        }
      }
      return null;
    },
  });
  /* ==================== L4 · 高级 ==================== */

  register({
    id: 'swordfish',
    name: '三链列 / 三链行',
    alias: ['Swordfish', '三链鱼', '三阶列'],
    level: 4,
    category: '高级',
    order: 40,
    tagline: 'X-Wing 的三行三列版本，原理完全一致。',
    principle: '把 X-Wing 的 2×2 换成 3×3：三行里的 d 候选都落在同样三列上，结论同样是覆盖列上其余位置的 d 全部作废。',
    howto: ['固定数字 d，找三行（或三列）；', '三行的 d 候选列必须完全一致；', '删掉覆盖列其余行的 d 候选。'],
    pitfalls: '四链（4×4）在真实题目里极罕见，本作只在三链成立时才提示。',
    find(state) {
      return findFish(state, 3);
    },
  });

  /**
   * 唯一矩形类型 1。
   * 依赖「题目唯一解」这个前提：若第四格取了三数组里的某个数，整盘就能重排出第二组解。
   * 几何条件是四格恰好落在两个宫内——跨四个宫时推导不成立。
   */
  register({
    id: 'unique-rectangle',
    name: '唯一矩形（类型 1）',
    alias: ['UR1', 'Unique Rectangle', '唯一矩形'],
    level: 4,
    category: '高级',
    order: 41,
    tagline: '2×2 矩形恰好落在两个宫里，三格同为一对候选 → 第四格删掉其中一个数。',
    principle:
      '设矩形为 a(r1c1)、b(r1c2)、c(r2c1)、d(r2c2)，恰好占两个宫（a、c 同宫，b、d 同宫）。若 a、b、c 三格候选都是 {x, y}：a 与 b 同行、与 c 同宫，所以 b 和 c 只能取「与 a 相反」的那个数。无论 a 取 x 还是 y，第四格 d 都会被同宫或同行的另一格挡掉；若 d 偏要取剩下的那个数，题目就会出现第二个解。故 d ≠ 该数字。',
    howto: ['找两行两列构成的 2×2 矩形，要求四格恰好落在两个宫内；', '枚举哪一格是第四格，其余三格必须是完全相同的两个候选；', '第四格若含这两个候选之一，删掉它。'],
    pitfalls: '矩形横跨四个宫时推理不成立（此时第四格仍可能取该数字），务必确认格子恰好占两个宫。',
    find(state) {
      const { grid, cand } = state;
      for (let r1 = 0; r1 < N; r1++) {
        for (let r2 = r1 + 1; r2 < N; r2++) {
          for (let c1 = 0; c1 < N; c1++) {
            for (let c2 = c1 + 1; c2 < N; c2++) {
              const cells = [r1 * N + c1, r1 * N + c2, r2 * N + c1, r2 * N + c2];
              if (grid[cells[0]] || grid[cells[1]] || grid[cells[2]] || grid[cells[3]]) continue;
              if (new Set(cells.map((i) => BOX[i])).size !== 2) continue;

              for (let k = 0; k < 4; k++) {
                const fourth = cells[k];
                const triple = cells.filter((_, idx) => idx !== k);
                const mask = cand[triple[0]];
                if (popcount(mask) !== 2) continue;
                if (cand[triple[1]] !== mask || cand[triple[2]] !== mask) continue;
                const hit = cand[fourth] & mask;
                if (!hit) continue;

                const elims = [];
                for (const d of digitsOf(hit)) elims.push({ cell: fourth, digit: d });
                const marks = [];
                for (const i of triple) for (const d of digitsOf(mask)) marks.push({ cell: i, digit: d });

                return baseStep('unique-rectangle', {
                  focusCell: fourth,
                  focusDigit: elims[0].digit,
                  cells: cells,
                  units: [r1, N + c1, r2, N + c2],
                  eliminations: elims,
                  marks: marks,
                  detail: { triple: triple, fourth: fourth, mask: mask, rows: [r1, r2], cols: [c1, c2] },
                });
              }
            }
          }
        }
      }
      return null;
    },
  });

  /* ==================== L5 · 专家 ==================== */

  register({
    id: 'forcing-chain',
    name: '链式推理（试错法）',
    alias: ['链', 'Chain', '假设法', '反证法'],
    level: 5,
    category: '专家',
    order: 50,
    tagline: '假设某个候选为假，若整套人类技巧推出矛盾，则该候选被排除。',
    principle:
      '这是所有技巧的兜底。任选一个候选数，假定它是错的，重新跑一遍前面所有技巧；一旦推出矛盾，说明矛盾来自这个错误假设，原候选一定被排除。',
    howto: ['挑候选数最少的格子；', '逐个尝试「假定这里不是 x」；', '用 L1 到 L4 的技巧继续推理；', '一旦出现候选为空的格子或直接冲突，判定该候选为假。'],
    pitfalls: '人工做链非常耗时。遇到卡壳时直接用自动求解往往更快。',
    find() {
      // 由 Hints.assumeWrong 接管：它需要反复调用 simulate，普通 find 无法胜任
      return null;
    },
  });

  /* ==================== 引擎 ==================== */

  const byId = {};
  for (const t of LIST) byId[t.id] = t;
  LIST.sort((a, b) => a.level - b.level || a.order - b.order);

  const LEVEL_NAME = { 1: '基础', 2: '排除', 3: '进阶', 4: '高级', 5: '专家' };
  const LEVEL_COLOR = { 1: '#22c55e', 2: '#06b6d4', 3: '#3b82f6', 4: '#a855f7', 5: '#f43f5e' };

  function makeState(grid, cand) {
    return { grid: grid, cand: cand || SD.Validation.computeCandidates(grid) };
  }

  function decorate(t, step) {
    if (!step) return null;
    step.id = t.id;
    step.name = t.name;
    step.level = t.level;
    step.category = t.category;
    step.tagline = t.tagline;
    return step;
  }

  /** 在给定状态上按「等级 → order」找一步；顺序稳定，保证提示可复现 */
  function findStepFrom(state, opts) {
    const maxLevel = (opts && opts.maxLevel) || 5;
    const only = (opts && opts.only) || null;
    for (const t of LIST) {
      if (t.level > maxLevel) continue;
      if (only && only.indexOf(t.id) < 0) continue;
      const step = decorate(t, t.find(state));
      if (step) return step;
    }
    return null;
  }

  function findStep(grid, opts) {
    return findStepFrom(makeState(grid), opts);
  }

  /** 当前局面所有可用技巧，供教学面板展示 */
  function findAll(grid, maxLevel) {
    const state = makeState(grid);
    const out = [];
    for (const t of LIST) {
      if (t.level > (maxLevel || 5) || !t.find) continue;
      const s = decorate(t, t.find(state));
      if (s) out.push(s);
    }
    return out;
  }

  /**
   * 把一步推理落到「盘面 + 逻辑候选」上。
   * 消除类技巧只删候选、不改格值，候选掩码必须跟着走，
   * 否则下一步会重新看见已删掉的候选，形成死循环。
   */
  function commit(g, cand, step) {
    for (const p of step.placements) {
      const mb = bit(p.digit);
      g[p.cell] = p.digit;
      cand[p.cell] = 0;
      for (const q of B.PEERS[p.cell]) cand[q] &= ~mb;
    }
    for (const e of step.eliminations) cand[e.cell] &= ~bit(e.digit);
    return { grid: g, cand: cand };
  }

  /** 只应用落子部分，用于提示后自动填入 */
  function applyPlacements(grid, step) {
    const g = Uint8Array.from(grid);
    for (const p of step.placements) g[p.cell] = p.digit;
    return g;
  }

  /**
   * 按等级上限反复推理，评估题目的「人类可解性」与难度构成。
   * solved=false 说明纯靠 ≤maxLevel 的技巧推不动。
   */
  function simulate(grid, maxLevel, maxSteps) {
    const g = Uint8Array.from(grid);
    const cand = SD.Validation.computeCandidates(g);
    const used = {};
    const seen = new Set();
    const cap = maxSteps || 4000;
    let steps = 0;
    let level = 0;
    let firstAdvanced = null;
    let contradiction = false;

    while (steps < cap) {
      if (SD.Validation.isComplete(g)) break;

      let starved = false;
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (!g[i] && !cand[i]) {
          starved = true;
          break;
        }
      }
      if (starved) {
        contradiction = true;
        break;
      }

      const step = findStepFrom({ grid: g, cand: cand }, { maxLevel: maxLevel });
      if (!step) break;

      const sig =
        step.id + '|' + step.placements.map((p) => p.cell + ':' + p.digit).join(',') + '|' +
        step.eliminations.map((e) => e.cell + ':' + e.digit).sort().join(',');
      if (!step.placements.length && seen.has(sig)) break;
      seen.add(sig);

      steps++;
      if (step.level > level) level = step.level;
      if (step.level >= 3 && !firstAdvanced) firstAdvanced = step.id;
      used[step.id] = (used[step.id] || 0) + 1;
      commit(g, cand, step);
    }

    return {
      solved: SD.Validation.isComplete(g),
      contradiction: contradiction,
      steps: steps,
      used: used,
      level: level,
      firstAdvanced: firstAdvanced,
      finalGrid: g,
    };
  }

  SD.Techniques = {
    LIST: LIST,
    byId: byId,
    LEVEL_NAME: LEVEL_NAME,
    LEVEL_COLOR: LEVEL_COLOR,
    makeState: makeState,
    findStep: findStep,
    findStepFrom: findStepFrom,
    findAll: findAll,
    commit: commit,
    applyPlacements: applyPlacements,
    simulate: simulate,
    unitName: unitName,
    rc: rc,
  };
})(window);
