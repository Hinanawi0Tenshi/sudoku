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
 *
 * 加新技巧的门槛：必须写得出定向用例，并且跑得过上面那条性质测试。
 * 参考里还有一批冷门技巧（WXYZ 翼、网、SK Loop、烟花、SDC 等），它们要么推导
 * 无法在基础候选数上自证，要么实测会误删，因此一律没有收录——宁可少给一条，
 * 也不能给一条错的方向。
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

  /* 四链鱼：鱼形家族在 size=4 的那一档。真实题面极罕见，order 排在三链之前一点，
     但仍晚于 X-Wing，保证常用技巧优先被提示。 */
  register({
    id: 'jellyfish',
    name: '四链列 / 四链行',
    alias: ['Jellyfish', '四链鱼', '四阶列', '水母'],
    level: 4,
    category: '高级',
    order: 39,
    tagline: 'X-Wing 的四行四列版本，原理完全一致。',
    principle:
      '把鱼形家族的规模从 2、3 提到 4：四行（或四列）里的 d 候选都落在同样四条覆盖线上，结论同样是覆盖线上其余位置的 d 全部作废。反证思路和 X-Wing 一致——覆盖线上多出来的格子若取了 d，每条基础线都会被逼回原处，形成矛盾。',
    howto: ['固定数字 d，找四行（或四列）；', '四行的 d 候选列必须完全一致，且不多不少正好四条；', '删掉这四列上其余行的 d 候选。'],
    pitfalls:
      '四链在真实题面里极罕见；如果四行的候选是五条或更多，那就不是鱼形，退回其他技巧。',
    find(state) {
      return findFish(state, 4);
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


  /** arr 里所有大小落在 [lo, hi] 的子集 */
  function subsets(arr, lo, hi) {
    const out = [];
    const n = arr.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let k = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) k++;
      if (k < lo || k > hi) continue;
      const s = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) s.push(arr[i]);
      out.push(s);
    }
    return out;
  }

  /**
   * 融合式待定数组。英文原名 Sue de Coq（SudokuWiki 写作融合式待定数组），
   * 最初叫 Two-Sector Disjoint Subsets，名字里的「de Coq」指行侧与宫侧的数字集不相交。
   *
   * 形制：宫 B 与行（或列）R 的交集里有 2 或 3 个空格组成 C；行侧另有若干格 D（不在 B 内），
   * 宫侧另有若干格 E（不在 R 内），它们的候选都取自 C 的候选并集 V，且 VD ∩ VE = ∅。
   * 这里只做 n=0 的标准型：|C| + |D| + |E| = |V|，并且 |D| = |VD|、|E| = |VE|，
   * 也就是两侧各自恰好用自己的格子数把数字占满。
   *
   * 计数推理：V 有 |V| 个数字而 C 只有 |C| 个格子，剩下的 |V| - |C| 个必须落在 D ∪ E 上；
   * 两侧数字不相交，于是这 |V| - |C| 个恰好分成 VD 与 VE 两堆，
   * 而 |VD| = |D|、|VE| = |E| 正好让 D 占满 VD、E 占满 VE。
   * 于是行 R 上位于 C ∪ D 之外的格，既放不下 VD（D 已占满），也放不下 V\VE 里剩下那堆（C 已占满），
   * 只能取 V 之外的数字；宫侧同理。
   */
  function findSueDeCoq(state) {
    const { grid, cand } = state;
    const openOf = (cells) => cells.filter((i) => !grid[i] && cand[i]);
    const unionOf = (cells) => cells.reduce((m, i) => m | cand[i], 0);
    const elimsIn = (cells, mask) => {
      const out = [];
      for (const i of cells) {
        const m = cand[i] & mask;
        for (let d = 1; d <= N; d++) if (m & bit(d)) out.push({ cell: i, digit: d });
      }
      return out;
    };

    for (let side = 0; side < 2; side++) {
      const armUnits = side === 0 ? B.UNITS.slice(0, 9) : B.UNITS.slice(9, 18);
      const armName = side === 0 ? '行' : '列';

      for (let box = 0; box < 9; box++) {
        const boxCells = B.UNITS[18 + box];
        const boxSet = new Set(boxCells);

        for (let arm = 0; arm < 9; arm++) {
          const armCells = armUnits[arm];
          const armSet = new Set(armCells);
          const cross = openOf(boxCells.filter((i) => armSet.has(i)));
          if (cross.length < 2) continue;
          const armOpen = openOf(armCells.filter((i) => !boxSet.has(i)));
          const boxRest = openOf(boxCells.filter((i) => !armSet.has(i)));

          for (const C of subsets(cross, 2, 3)) {
            const V = unionOf(C);
            if (popcount(V) < C.length + 2) continue;
            const need = popcount(V) - C.length;
            if (need < 2) continue;

            const D0 = armOpen.filter((i) => (cand[i] & ~V) === 0);
            const E0 = boxRest.filter((i) => (cand[i] & ~V) === 0);
            if (D0.length > 4 || E0.length > 4) continue;

            for (const D of subsets(D0, 1, need - 1)) {
              const VD = unionOf(D);
              if (popcount(VD) !== D.length) continue;   // D 必须自己把 VD 占满
              const wantE = need - D.length;
              if (wantE < 1 || wantE > E0.length) continue;
              for (const E of subsets(E0, wantE, wantE)) {
                const VE = unionOf(E);
                if (popcount(VE) !== E.length) continue;
                if (VD & VE) continue;                    // 要害：两侧数字必须不相交

                const cSet = new Set(C);
                const dSet = new Set(D);
                const eSet = new Set(E);
                const elims = []
                  .concat(elimsIn(armOpen.filter((i) => !cSet.has(i) && !dSet.has(i)), V & ~VE))
                  .concat(elimsIn(boxRest.filter((i) => !cSet.has(i) && !eSet.has(i)), V & ~VD));
                if (!elims.length) continue;

                return baseStep('sue-de-coq', {
                  focusCell: C[0],
                  focusDigit: 0,
                  cells: C.concat(D, E).concat(elims.map((x) => x.cell)),
                  units: [arm, 18 + box],
                  eliminations: elims,
                  marks: C.concat(D, E).flatMap((i) => digitsOf(cand[i]).map((v) => ({ cell: i, digit: v }))),
                  detail: { C: C, D: D, E: E, V: V, VD: VD, VE: VE, box: box, arm: arm, side: side, armName: armName },
                });
              }
            }
          }
        }
      }
    }
    return null;
  }

  register({
    id: 'sue-de-coq',
    name: '融合式待定数组',
    alias: ['Sue de Coq', 'SDC', 'Two-Sector Disjoint Subsets'],
    level: 5,
    category: '专家',
    order: 51,
    tagline: '宫与行（或列）的交集里挤着几个数字，两侧各自有数接应 → 两侧之外的位置全清。',
    principle:
      '宫 B 与行 R 的交集里有 2 到 3 个空格 C，它们的候选并集是 V。行侧另有 D（不在宫内）、宫侧另有 E（不在行内），两边候选都取自 V，且互不相交。当 |C|+|D|+|E| = |V| 且两侧各自用自己的格子数占满数字时，V 里分给 D、E 之外的那部分数字只能挤在 C 里。于是行 R 上位于 C 与 D 之外的格子再也放不下 V 中的任何数字，宫侧同理。名字里的 de Coq 就是「分开」——两侧数字必须不相交，否则推导不成立。',
    howto: ['找宫与行/列的交集，看里面的 2 到 3 个空格，它们的候选并集就是 V；', '在行侧（宫外）与宫侧（行外）各找若干格，候选全部落在 V 里；', '确认两侧候选不相交，且 |C|+|D|+|E| = |V|；', '删掉行上 C 与 D 之外各格里的 V 中数字，以及宫上 C 与 E 之外各格里的 V 中数字。'],
    pitfalls:
      '两侧数字一旦有交集就整条作废——那不再是「分开」的两堆。本作只实现 n=0 的标准型：两侧各自恰好用格子数占满数字；带额外候选的推广型容易误删，不收录。',
    find(state) {
      return findSueDeCoq(state);
    },
  });
  /* ==================== L4 · 链与翼 ==================== */

  /**
   * W 翼：A={w,x}、B={w,y} 两格共用 w，C={x,y} 且同时看得到 A 与 B。
   * 反证：设某格 E 含 w 且同时看得到 A、B。A 与 B 都被 E 挡掉 w，只能取 x 与 y；
   *   C 与 A、B 同区域，于是 x、y 都被占，C 无处可放。矛盾，所以这类格子里不能是 w。
   * C 必须真的看得到 A 与 B，否则 C 还能从别处取 x 或 y，推导不成立。
   */
  function findWWing(state) {
    const { grid, cand } = state;
    const bivals = [];
    for (let i = 0; i < B.CELL_COUNT; i++) if (!grid[i] && popcount(cand[i]) === 2) bivals.push(i);
    const pair = (i) => digitsOf(cand[i]);

    for (const a of bivals) {
      for (const b of B.PEERS[a]) {
        if (b <= a || grid[b] || popcount(cand[b]) !== 2) continue;
        const pa = pair(a);
        const pb = pair(b);
        const shared = pa.filter((v) => pb.includes(v));
        if (shared.length !== 1) continue;
        const w = shared[0];
        const x = pa.find((v) => v !== w);
        const y = pb.find((v) => v !== w);
        if (x === y) continue;

        // 第三格必须是 {x,y}，而且真的同时看得到 A 与 B
        for (const c of B.PEERS[a]) {
          if (c === b || grid[c] || popcount(cand[c]) !== 2) continue;
          const pc = pair(c);
          if (pc.indexOf(x) < 0 || pc.indexOf(y) < 0) continue;
          if (B.PEERS[b].indexOf(c) < 0) continue;

          const elims = [];
          for (const t of B.PEERS[a]) {
            if (t === b || grid[t]) continue;
            if (B.PEERS[b].indexOf(t) < 0) continue;
            if (cand[t] & bit(w)) elims.push({ cell: t, digit: w });
          }
          if (!elims.length) continue;

          return baseStep('w-wing', {
            focusCell: a,
            focusDigit: w,
            cells: [a, b, c].concat(elims.map((v) => v.cell)),
            units: [],
            eliminations: elims,
            marks: [a, b, c].flatMap((i) => pair(i).map((v) => ({ cell: i, digit: v }))),
            detail: { a: a, b: b, c: c, w: w, x: x, y: y },
          });
        }
      }
    }
    return null;
  }

  /**
   * XY 链：双值格串成一条路 C1={d,a1}、C2={a1,a2}、…、Cn={a(n-1),d}，
   * 相邻两格恰好共用一个数字且同属一个区域。
   * 反证：设某格 F 含 d 且同时看得到首尾两端。C1 被 F 挡掉 d，只能取 a1；
   *   a1 被 C1 占走后 C2 只能取 a2；照此推下去 Cn 必为 d，而 Cn 与 F 同区域，矛盾。
   * 链长上限 5：再长已经罕见到不值得扫，且每多一格误判面就大一分。
   */
  function findXyChain(state) {
    const { grid, cand } = state;
    const pair = (i) => digitsOf(cand[i]);
    const MAX = 5;

    for (let i = 0; i < B.CELL_COUNT; i++) {
      if (grid[i] || popcount(cand[i]) !== 2) continue;
      for (const d of pair(i)) {
        const chain = [i];
        const found = (function step(prev, carried) {
          if (chain.length >= MAX) return null;
          for (const nxt of B.PEERS[prev]) {
            if (chain.indexOf(nxt) >= 0 || grid[nxt] || popcount(cand[nxt]) !== 2) continue;
            const pn = pair(nxt);
            if (pn.indexOf(carried) < 0) continue;
            const other = pn.find((v) => v !== carried);
            chain.push(nxt);
            if (other === d) {
              const head = chain[0];
              const tail = nxt;
              const elims = [];
              for (const t of B.PEERS[head]) {
                if (t === tail || grid[t]) continue;
                if (B.PEERS[tail].indexOf(t) < 0) continue;
                if (cand[t] & bit(d)) elims.push({ cell: t, digit: d });
              }
              if (elims.length) {
                const marks = [];
                for (const cell of chain) for (const v of pair(cell)) marks.push({ cell: cell, digit: v });
                return { chain: chain.slice(), elims: elims, marks: marks };
              }
            } else {
              const got = step(nxt, other);
              if (got) return got;
            }
            chain.pop();
          }
          return null;
        })(i, pair(i).find((v) => v !== d));
        if (found) {
          return baseStep('xy-chain', {
            focusCell: found.chain[0],
            focusDigit: d,
            cells: found.chain.concat(found.elims.map((v) => v.cell)),
            units: [],
            eliminations: found.elims,
            marks: found.marks,
            detail: { chain: found.chain, d: d },
          });
        }
      }
    }
    return null;
  }

  /**
   * 裸二元集出数型：同一区域里 N 格，其中 N-1 格的候选恰好是同一个 N-1 元集合 A，
   * 剩下一格的候选是 A ∪ {e}，恰好多出一个数。
   * 推理：那 N-1 格构成裸 N-1 数组，把 A 占满了，落单那格只能取 e。
   * 只有「恰好多一个」才敢这么判；多出两个以上时它未必是 e，推导不成立。
   */
  function findAlsPlacement(state) {
    const { grid, cand } = state;
    for (let u = 0; u < UNITS.length; u++) {
      const cells = UNITS[u].filter((i) => !grid[i] && cand[i]);
      if (cells.length < 2) continue;
      for (let k = 2; k <= Math.min(cells.length, 5); k++) {
        for (const C of subsets(cells, k, k)) {
          if (C.length < 2) continue;
          const base = C.slice(0, C.length - 1);
          const odd = C[C.length - 1];
          const mask = cand[base[0]];
          if (popcount(mask) !== base.length) continue;
          if (!base.every((i) => cand[i] === mask)) continue;
          const extra = cand[odd] & ~mask;
          if (popcount(extra) !== 1) continue;
          const e = Math.log2(extra) + 1;
          return baseStep('almost-locked-set', {
            focusCell: odd,
            focusDigit: e,
            cells: C,
            units: [u],
            placements: [{ cell: odd, digit: e }],
            eliminations: [],
            marks: base.flatMap((i) => digitsOf(mask).map((v) => ({ cell: i, digit: v })))
                     .concat([{ cell: odd, digit: e }]),
            detail: { base: base, odd: odd, mask: mask, extra: extra, unit: u },
          });
        }
      }
    }
    return null;
  }

  register({
    id: 'w-wing',
    name: 'W 翼',
    alias: ['W-Wing'],
    level: 4,
    category: '高级',
    order: 43,
    tagline: '两格共用一个数，第三格看得到这两格 → 共用的那个数出不来。',
    principle:
      'A={w,x}、B={w,y} 两格共用 w，C={x,y} 且同时与 A、B 同区域。反证：若某格 E 含 w 且看得到 A、B，A、B 都被 E 挡掉 w，只能取 x 与 y；C 与它们同区域，x、y 全被占，无处可放。故 E 只能是 w 的否定。',
    howto: ['找两个双值格 A、B，恰好共用一个数字 w；', '再找一个候选恰是 A 与 B 各自另一个数字的第三格 C；', '确认 C 同时与 A、B 同区域；', '删掉同时看得到 A 与 B 的格子里的 w。'],
    pitfalls:
      'C 必须真的看得到 A 和 B。只「候选是 {x,y}」不够——C 若与 A 不同区域，它还能从别处取 x，推导立刻失效。',
    find(state) {
      return findWWing(state);
    },
  });

  register({
    id: 'xy-chain',
    name: 'XY 链',
    alias: ['XY-Chain', '交替推理链'],
    level: 5,
    category: '专家',
    order: 52,
    tagline: '一串双值格首尾都含同一个数 → 同时看得到两端的格子里删掉它。',
    principle:
      '一串双值格串成路 C1={d,a1}、C2={a1,a2}、…、Cn={a(n-1),d}，相邻两格恰好共用一个数字且同属一个区域。反证：若某格 F 含 d 且看得到首尾两端，C1 被 F 挡掉 d 只能取 a1；a1 被占走后 C2 只能取 a2；逐级推下去 Cn 必为 d，而 Cn 与 F 同区域，矛盾。',
    howto: ['找一个双值格，定下要消的数字 d 和它携带的另一个数字；', '顺着「与上一格恰好共用一个数字」往下走，每一格都必须与上一格同属一个区域；', '走回 d 就闭合成链；', '删掉同时看得到首尾两端的格子里的 d。'],
    pitfalls:
      '链上每一格都必须真的与前后格同区域，只是候选碰巧相同不算——那样「被占走」这一步就不成立。本作把链长限制在 5，再长既罕见又难向人解释。',
    find(state) {
      return findXyChain(state);
    },
  });

  register({
    id: 'almost-locked-set',
    name: '裸二元集（出数型）',
    alias: ['ALS', 'Almost Locked Set', '裸二元集'],
    level: 5,
    category: '专家',
    order: 53,
    tagline: '几个格子的候选挤成数组、只多出一个数 → 落单那格就是它。',
    principle:
      '同一区域里 N 格，其中 N-1 格的候选恰好是同一个 N-1 元集合 A，剩下一格的候选是 A 再多一个数 e。那 N-1 格构成裸 N-1 数组，把 A 占满了，于是落单那格只能取 e。',
    howto: ['在任一区域里找 N 格，其中 N-1 格候选完全一样且个数正好比格数少一；', '看落单那格的候选有没有恰好多出一个数 e；', '若有，落单那格填 e。'],
    pitfalls:
      '「恰好多一个」是硬条件。落单那格若多出两个以上，它未必是 e，推导不成立。本作只收出数这一型；裸二元集的删数型要额外谈「同时看得到整个数组」的格子，判定更啰嗦，暂未收录。',
    find(state) {
      return findAlsPlacement(state);
    },
  });
  /**
   * 区域强制链。对某个区域 U 里的某个数字 d：U 内所有能放 d 的格子，d 必须落在其中一处。
   * 对其中每一处分别假设 d 就在这里，各推到底；只要某个候选在所有分支里都被判为假，
   * 它一定为假。与数字强制链的区别在于前提集合不同：
   * 数字强制链的前提是单个候选，区域强制链的前提是这个区域的这个数在所有位置里必有一个成立。
   */
  function findUnitForcingChain(state) {
    const { grid, cand } = state;
    for (let u = 0; u < UNITS.length; u++) {
      for (let d = 1; d <= N; d++) {
        const mb = bit(d);
        const positions = Array.prototype.filter.call(UNITS[u], (i) => !grid[i] && (cand[i] & mb));
        if (positions.length < 2) continue;

        let commonOff = null;
        for (const p of positions) {
          const r = propagate(grid, cand, [[p, d]]);
          if (!r) continue;
          if (commonOff === null) commonOff = Int32Array.from(r.off);
          else for (let i = 0; i < B.CELL_COUNT; i++) commonOff[i] &= r.off[i];
        }
        if (!commonOff) continue;

        const elims = [];
        for (let i = 0; i < B.CELL_COUNT; i++) {
          if (grid[i]) continue;
          if (positions.indexOf(i) >= 0) continue;
          const m = commonOff[i] & cand[i];
          for (let k = 1; k <= N; k++) if (m & bit(k)) elims.push({ cell: i, digit: k });
        }
        if (!elims.length) continue;

        return baseStep('unit-forcing-chain', {
          focusCell: positions[0],
          focusDigit: d,
          cells: positions.concat(elims.map((x) => x.cell)),
          units: [u],
          eliminations: elims,
          marks: positions.map((x) => ({ cell: x, digit: d })),
          detail: { unit: u, digit: d, positions: positions },
        });
      }
    }
    return null;
  }

  /**
   * 单元格强制链。对某个格子 X：X 必有一个候选成立。
   * 对其中每个候选分别假设它成立，各推到底；只要某个候选在所有分支里都被判为假，
   * 它一定为假。这是唯一性最强的一类链：前提把整格的取值全部覆盖，推不动就说明前提矛盾。
   */
  function findCellForcingChain(state) {
    const { grid, cand } = state;
    for (let x = 0; x < B.CELL_COUNT; x++) {
      if (grid[x] || popcount(cand[x]) < 2) continue;
      const ds = digitsOf(cand[x]);

      let commonOff = null;
      for (const v of ds) {
        const r = propagate(grid, cand, [[x, v]]);
        if (!r) continue;
        if (commonOff === null) commonOff = Int32Array.from(r.off);
        else for (let i = 0; i < B.CELL_COUNT; i++) commonOff[i] &= r.off[i];
      }
      if (!commonOff) continue;

      const elims = [];
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (grid[i] || i === x) continue;
        const m = commonOff[i] & cand[i];
        for (let k = 1; k <= N; k++) if (m & bit(k)) elims.push({ cell: i, digit: k });
      }
      if (!elims.length) continue;

      return baseStep('cell-forcing-chain', {
        focusCell: x,
        focusDigit: ds[0],
        cells: [x].concat(elims.map((v) => v.cell)),
        units: B.UNITS_OF[x],
        eliminations: elims,
        marks: ds.map((v) => ({ cell: x, digit: v })),
        detail: { cell: x, candidates: ds },
      });
    }
    return null;
  }

  register({
    id: 'unit-forcing-chain',
    name: '区域强制链',
    alias: ['Unit Forcing Chains', '单位强制链'],
    level: 5,
    category: '专家',
    order: 52,
    tagline: '一个区域里的某个数必落在某一格 → 逐处假设，取公共结论。',
    principle:
      '某个区域里能放数字 d 的格子有若干处，d 必定落在其中一处。对每一处分别假设「d 就在这里」，只用基础规则往下推，再把所有分支的结论取交集。只要某个候选在每一条分支里都被判为假，它一定为假。与数字强制链不同，它的前提覆盖的是「这个区域这个数的所有位置」。',
    howto: ['挑一个区域与一个数字，列出区域内所有能放它的空格；', '逐处假设 d 在这里，各推到底；', '取所有分支的公共结论；', '交集里为假的候选删掉。'],
    pitfalls:
      '前提必须覆盖全部位置，漏掉一处交集就不成立了。某一处假设自身就推出矛盾时，说明 d 在那一处放不下，这本身就是结论。',
    find(state) {
      return findUnitForcingChain(state);
    },
  });

  register({
    id: 'cell-forcing-chain',
    name: '单元格强制链',
    alias: ['Cell Forcing Chains'],
    level: 5,
    category: '专家',
    order: 51,
    tagline: '一个格子必有一个候选成立 → 逐个假设，取公共结论。',
    principle:
      '某个格子必有一个候选成立。对它的每个候选分别假设它成立，只用基础规则往下推，再把所有分支取交集。只要某个候选在每一条分支里都被判为假，它一定为假。这是前提最紧的一类链：前提把整格的取值全部覆盖，因此它常常能直接逼出别处的结论。',
    howto: ['挑一个空格；', '逐个假设它取某个候选，各推到底；', '取所有分支的公共结论；', '交集里为假的候选删掉。'],
    pitfalls:
      '候选少于 2 个时这个格已经定了，不必走链。某一处假设自身就矛盾时说明该格不能取那个数，同样是有效结论。',
    find(state) {
      return findCellForcingChain(state);
    },
  });
  /* ==================== L5 · 假设与传播 ==================== */

  /**
   * 二元蕴含传播。设若干格已定为真，只用最基础的五条规则往下推：
   *   on(i,v) 为真 → 同格其余候选作废、关联格里 v 删掉；某格候选清空即矛盾。
   *   off(i,v) 为假 → 若原盘面里 i 本来就只剩另一个候选，它为真；
   *                 若原盘面里某区域的 v 本来就只在另两格，它为真；无处安放即矛盾。
   * 返回 null 代表推出矛盾（假设不成立）；否则返回 on / off 两个掩码数组。
   *
   * 关键：「只剩一个」「只剩两处」这类判定一律查原盘面 cand，不查传播途中的中间态。
   * 中间态里候选被删，往往只是某个假设成立的副作用，并不代表这格已经定死——
   * 照中间态判真会把合法假设误判成矛盾，试数就会删掉本来正确的候选。
   */
  function propagate(grid, cand, seeds, budget) {
    const on = new Int32Array(B.CELL_COUNT);
    const off = new Int32Array(B.CELL_COUNT);
    const c2 = Int32Array.from(cand);
    const queue = [];

    const put = (i, d, v) => {
      const mb = bit(d);
      if ((v ? off : on)[i] & mb) return false;   // 同一候选既真又假
      (v ? on : off)[i] |= mb;
      if (v) {
        off[i] |= cand[i] & ~mb;                 // 同格其余候选：按原盘面判假
        c2[i] &= mb;
        for (const p of B.PEERS[i]) {
          if (!(c2[p] & mb)) continue;
          c2[p] &= ~mb;
          if (!c2[p]) return false;
          queue.push([p, d, 0]);
        }
      } else {
        c2[i] &= ~mb;
        if (!c2[i]) return false;
        // 只有原盘面里本来就只剩这一个候选时，才轮得到它必为真
        if (popcount(cand[i]) === 1) queue.push([i, cand[i], 1]);
        for (const u of B.UNITS_OF[i]) {
          let n = 0;
          let last = -1;
          for (const k of B.UNITS[u]) if (cand[k] & mb) { n++; last = k; }
          for (const k of B.UNITS[u]) {
            n++;
            if (k !== i) last = k;
          }
          if (n === 0) return false;             // 原盘面里这个数只剩 i 一处，i 为假即矛盾
          if (n === 2 && last >= 0) queue.push([last, d, 2]);
        }
      }
      return true;
    };

    for (const s of seeds) if (!put(s[0], s[1], 1)) return null;
    const cap = budget || 3000;
    let steps = 0;
    while (queue.length) {
      if (++steps > cap) break;
      const [i, d, kind] = queue.pop();
      if (kind === 0) { if (!put(i, d, 0)) return null; }
      else { if (!put(i, d, 1)) return null; }
    }
    return { on: on, off: off };
  }

  /** 候选数少的格子链最短、最容易出结论，试数时优先挑它们 */
  function guessHubs(grid, cand, minCount) {
    const out = [];
    for (let i = 0; i < B.CELL_COUNT; i++) {
      if (grid[i]) continue;
      const n = popcount(cand[i]);
      if (n >= minCount) out.push([i, n]);
    }
    out.sort((a, b) => a[1] - b[1]);
    return out.map((x) => x[0]);
  }

  /**
   * 试数：逐个假设某格取某个数，只用基础规则往下推，推出矛盾就说明这个假设不成立，
   * 于是这个候选被排除。候选数少的格子先试——链短、矛盾出得快。
   */
  function findTrial(state) {
    const { grid, cand } = state;
    for (const c of guessHubs(grid, cand, 2)) {
      for (const v of digitsOf(cand[c])) {
        if (propagate(grid, cand, [[c, v]]) !== null) continue;
        const elims = [{ cell: c, digit: v }];
        return baseStep('trial', {
          focusCell: c,
          focusDigit: v,
          cells: [c],
          units: B.UNITS_OF[c],
          eliminations: elims,
          marks: [{ cell: c, digit: v }],
          detail: { hub: c, tried: v, candidates: digitsOf(cand[c]) },
        });
      }
    }
    return null;
  }

  /**
   * 组合链：挑一个候选数不少于 3 的格 C，对它的每个候选各假设一次，各推到底，
   * 再把所有分支的结论取交集——只要某个候选在每一条分支里都被判为假，它一定为假。
   * 某条分支自己就推出矛盾时，那条分支的前提直接否掉，也算一条结论。
   * 双向矩形是同一套机制换个观察角度：从中间格同时向两个方向出发，两条路最终汇合，形如矩形。
   */
  function findMultipleChain(state) {
    const { grid, cand } = state;
    for (const c of guessHubs(grid, cand, 3)) {
      const ds = digitsOf(cand[c]);
      let commonOff = null;
      let alive = 0;
      const dead = [];

      for (const v of ds) {
        const r = propagate(grid, cand, [[c, v]]);
        if (!r) { dead.push(v); continue; }
        alive++;
        if (commonOff === null) commonOff = Int32Array.from(r.off);
        else for (let i = 0; i < B.CELL_COUNT; i++) commonOff[i] &= r.off[i];
      }

      const elims = dead.map((d) => ({ cell: c, digit: d }));
      if (commonOff && alive >= 2) {
        for (let i = 0; i < B.CELL_COUNT; i++) {
          if (i === c || grid[i]) continue;
          const m = commonOff[i] & cand[i];
          for (let d = 1; d <= N; d++) if (m & bit(d)) elims.push({ cell: i, digit: d });
        }
      }
      if (!elims.length) continue;

      return baseStep('multiple-forcing-chain', {
        focusCell: c,
        focusDigit: elims[0].digit,
        cells: [c].concat(elims.map((x) => x.cell)),
        units: B.UNITS_OF[c],
        eliminations: elims,
        marks: elims.map((x) => ({ cell: x.cell, digit: x.digit })),
        detail: { hub: c, candidates: ds, dead: dead },
      });
    }
    return null;
  }

  register({
    id: 'trial',
    name: '试数',
    alias: ['Trial and Error', 'Tricking', '分岔试错'],
    level: 5,
    category: '专家',
    order: 54,
    tagline: '假设某格取某个数往下推，推出矛盾就说明这个假设不成立。',
    principle:
      '挑一个格，逐个假设它取某个候选，然后只用最基础的规则往下推——定真则同格其余候选作废；某格只剩一个候选则它必为真；某个区域里某数只剩一处则无处安放、矛盾。如果整盘推出矛盾，说明矛盾来自这个错误假设本身，于是这个候选一定不成立。这一族不需要题面唯一解。',
    howto: ['挑候选数最少的格子，链最短、矛盾出得最快；', '逐个假设它取某个候选；', '只用基础规则往下推；', '一旦推出矛盾，就把这个候选删掉。'],
    pitfalls:
      '手工做很耗时，卡住时用提示更快。它是兜底手段，前面那些技巧都做完了才轮到它。',
    find(state) {
      return findTrial(state);
    },
  });

  register({
    id: 'multiple-forcing-chain',
    name: '组合链',
    alias: ['Multiple Forcing Chains', 'MFC', '双向矩形'],
    level: 5,
    category: '专家',
    order: 53,
    tagline: '对一个多候选的格逐个假设，取所有分支的公共结论。',
    principle:
      '挑候选数不少于 3 的格 C，对它的每个候选各假设一次「C 就是它」，每次只用基础规则往下推，然后把所有分支的结论取交集。只要某个候选在每一条分支里都被判为假，它一定为假；某条分支自己就推出矛盾时，那条分支的前提直接被否掉，同样算结论。双向矩形是同一套机制换个观察角度——从中间格同时向两个方向出发，两条路最终汇合，形如矩形。',
    howto: ['挑一个候选不少于 3 的格，把它当枢纽；', '逐个假设它取某个候选，各推到底；', '把所有分支的结论取交集；', '交集里为假的候选删掉。'],
    pitfalls:
      '必须覆盖枢纽的每一个候选，漏掉任何一条分支交集就不成立了。这一族不需要题面唯一解，但代价高，引擎有步数上限兜着。',
    find(state) {
      return findMultipleChain(state);
    },
  });
  /**
   * 退化鱼（Franken Fish）：鱼形家族的放宽版。
   * 标准鱼形要求每条基础线里 d 的候选恰好落在同样 size 条覆盖线上；
   * 退化版允许某条基础线只有一个 d 候选——对应那个「鳍位」已经被别的数字占了。
   * 只要所有基础线的候选并起来仍正好是 size 条覆盖线，结论一样成立：
   * 反证与标准鱼形同源，覆盖线上多出来的格子若取 d，逐条基础线会被逼回原处，形成矛盾。
   * 基础线一条候选都没有时不提供任何信息，直接剔除，不参与本条鱼。
   */
  function findFrankenFish(state, size) {
    const { grid, cand } = state;

    const run = (baseIsRows) => {
      const at = (b, ci) => (baseIsRows ? b * N + ci : ci * N + b);

      for (let d = 1; d <= N; d++) {
        const mb = bit(d);
        for (const bases of combos(N, size)) {
          const baseSet = new Set(bases);
          const sets = bases.map((b) => {
            const s = [];
            for (let ci = 0; ci < N; ci++) {
              const i = at(b, ci);
              if (!grid[i] && cand[i] & mb) s.push(ci);
            }
            return s;
          });

          const cover = [];
          const seen = new Set();
          for (const s of sets) for (const ci of s) if (!seen.has(ci)) { seen.add(ci); cover.push(ci); }
          if (cover.length !== size) continue;
          // 至少一条基础线的候选数要严格少于 size，否则就是普通鱼形（X-Wing 会先命中），
          // 且退化放宽会引入不必要的风险；并且每条基础线都得至少有一个候选，
          // 全空说明它根本不需要这个数，参与推理会出错。
          if (!sets.some((s) => s.length < size)) continue;
          if (sets.some((s) => s.length === 0)) continue;

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
          for (let k = 0; k < bases.length; k++) {
            for (const ci of sets[k]) marks.push({ cell: at(bases[k], ci), digit: d });
          }

          return baseStep('franken-fish', {
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
    id: 'franken-fish',
    name: '退化鱼',
    alias: ['Franken Fish', 'Franken X-Wing', '退化鱼形'],
    level: 4,
    category: '高级',
    order: 44,
    tagline: '鱼形家族的放宽版：某条基础线只剩一个候选，鳍位已被别的数字占了。',
    principle:
      '标准鱼形要求每条基础线里 d 的候选恰好落在同样 size 条覆盖线上。退化版允许某条基础线只有一个 d 候选——那个位置已经被别的数字占了。只要所有基础线的候选合起来仍正好是 size 条覆盖线，结论一样成立：覆盖线上不属于任何基础线的格子若取了 d，每条基础线就被迫回到原处，与它候选只在覆盖线上矛盾。名字里的「退化」指这个鳍位残缺。',
    howto: ['固定数字 d，挑 size 条基础线（行或列）；', '把每条基础线里 d 的候选位置列出来；', '看它们的并集是否正好是 size 条覆盖线；', '删掉覆盖线上其余格子的 d 候选。'],
    pitfalls:
      '并集必须正好是 size 条。多一条说明不成鱼（退回标准鱼形判定），少一条说明覆盖不足、结论不成立。基础线一条候选都没有时不提供信息，应当剔除而不是硬凑。',
    find(state) {
      return findFrankenFish(state, 2);
    },
  });
  /**
   * 空矩形（Empty Rectangle）。
   * 形制：取宫 B、数字 d，宫内 d 的候选全部落在「宫内某一行 R ∪ 某一列 C」之内，
   * 剩下那 4 格不含 d。再找一条强链——某列里 d 的候选恰好只有 A、Bc 两格，且 A 落在行 R 上。
   * 于是 (行 Bc × 列 C) 这一格不可能是 d，删掉它的 d 候选。
   * 反证：设该格取 d。它与行 R 上那个 d 候选同区，挤掉了行 R 的另一处候选；
   *   而强链 A 与它同区，于是强链另一端 Bc 被迫占据该格的列——与它已取 d 矛盾。
   *
   * 关键几何约束：强链两格要么都在宫内，要么都在宫外；
   * 一内一外的混合配置存在反例，此时行 R 与列 C 构不成封闭区域。
   */
  function findEmptyRectangle(state) {
    const { grid, cand } = state;
    const boxRows = (b) => [((b / 3) | 0) * 3, ((b / 3) | 0) * 3 + 1, ((b / 3) | 0) * 3 + 2];
    const boxCols = (b) => [(b % 3) * 3, (b % 3) * 3 + 1, (b % 3) * 3 + 2];

    for (let b = 0; b < 9; b++) {
      for (let d = 1; d <= N; d++) {
        const mb = bit(d);
        const inBox = [];
        for (let i = 0; i < B.CELL_COUNT; i++) if (BOX[i] === b && !grid[i] && (cand[i] & mb)) inBox.push(i);
        if (inBox.length < 2) continue;

        for (const R of boxRows(b)) {
          for (const C of boxCols(b)) {
            // 宫内 d 候选必须全部落在 (行 R ∪ 列 C) 之内
            const ok = inBox.every((i) => ROW[i] === R || COL[i] === C);
            if (!ok) continue;

            for (let c2 = 0; c2 < N; c2++) {
              const spots = [];
              for (let r = 0; r < N; r++) {
                const i = r * N + c2;
                if (!grid[i] && (cand[i] & mb)) spots.push(i);
              }
              if (spots.length !== 2) continue;      // 强链：恰好两处候选
              const a = spots[0];
              const bc = spots[1];
              if (ROW[a] !== R && ROW[bc] !== R) continue;
              // A 必须落在行 R 上
              let A = -1;
              let Bc = -1;
              if (ROW[a] === R) { A = a; Bc = bc; } else { A = bc; Bc = a; }
              if (C === COL[A]) continue;            // A 已在列 C 上，考察格会重合

              // 强链两格要么同在宫内，要么同在宫外
              const linkInside = boxCols(b).indexOf(c2) >= 0;
              const bcInside = boxRows(b).indexOf(ROW[Bc]) >= 0;
              if (linkInside !== bcInside) continue;

              const t = ROW[Bc] * N + C;
              if (grid[t] || !(cand[t] & mb)) continue;

              return baseStep('empty-rectangle', {
                focusCell: t,
                focusDigit: d,
                cells: inBox.concat([A, Bc, t]),
                units: [18 + b, R, C],
                eliminations: [{ cell: t, digit: d }],
                marks: inBox.map((i) => ({ cell: i, digit: d }))
                  .concat([{ cell: A, digit: d }, { cell: Bc, digit: d }, { cell: t, digit: d }]),
                detail: { box: b, digit: d, row: R, col: C, A: A, Bc: Bc, target: t },
              });
            }
          }
        }
      }
    }
    return null;
  }

  register({
    id: 'empty-rectangle',
    name: '空矩形',
    alias: ['Empty Rectangle', 'ER', 'Rectangle Elimination'],
    level: 5,
    category: '专家',
    order: 45,
    tagline: '宫里的数字候选挤在两行两列内，借一条强链把宫外某格也排除掉。',
    principle:
      '宫 B 里数字 d 的候选全部落在「宫内某一行 R ∪ 某一列 C」之内，剩下 4 格不含 d。再找一条强链：某列里 d 的候选恰好只有 A、Bc 两格，且 A 落在行 R 上。于是 (行 Bc × 列 C) 这一格不可能是 d——反证：设它取 d，它挤掉了行 R 内的另一处 d 候选，而强链 A 与它同区，逼得 Bc 占据它已占的列，矛盾。',
    howto: ['看某宫里某数字的候选是不是全挤在两行或两列之内；', '找一条强链：该数字在某列恰好只有两个候选；', '确认强链有一端落在宫内的行上；', '两者的「行列」交叉格就是被排除的目标。'],
    pitfalls:
      '强链两格必须同在宫内或同在宫外，一内一外的混合配置会让行与列构不成封闭区域，此时结论不成立。',
    find(state) {
      return findEmptyRectangle(state);
    },
  });
  /**
   * 依赖「题目唯一解」这个前提：若第四格取了三数组里的某个数，整盘就能重排出第二组解。
   * 几何条件是四格恰好落在两个宫内——跨四个宫时推导不成立。
   */
  register({
    id: 'unique-rectangle',
    name: '唯一矩形（类型 1）',
    alias: ['UR1', 'Unique Rectangle', '唯一矩形'],
    needsUnique: true,   // 靠致命模式论证，题面多解时会给出错误提示
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

  /**
   * 唯一性检查的缓存。
   * 唯一矩形这一族靠「致命模式」论证，题面多解时会给出错误提示；
   * 而生成器出的题必然唯一、OCR 导入的题不一定，所以要在提示链路上真查一次。
   * 数解很贵，按题面缓存：同一局反复点提示不重复算，换题才算。
   */
  let uniqueKey = null;
  let uniqueVal = false;
  function gridUnique(grid) {
    const key = Array.prototype.join.call(grid, '');
    if (key !== uniqueKey) {
      uniqueVal = SD.Solver.solve(grid, 2).count === 1;
      uniqueKey = key;
    }
    return uniqueVal;
  }

  /** 当前局面所有可用技巧，供教学面板展示 */
  function findAll(grid, maxLevel) {
    const state = makeState(grid);
    const out = [];
    let unique = null;
    for (const t of LIST) {
      if (t.level > (maxLevel || 5) || !t.find) continue;
      if (t.needsUnique) {
        if (unique === null) unique = gridUnique(grid);
        if (!unique) continue;
      }
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
