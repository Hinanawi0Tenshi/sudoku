/* 数独 · 提示与算法教学
 *
 * 提示不止是「告诉你答案」，而是把一次推理完整讲出来：
 *   原理 → 盘面推导 → 结论 → 你该怎么动手。
 * 这样提示本身就是一堂课，配合技巧百科面板可以系统学习解法。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const T = SD.Techniques;
  const bit = B.bit;
  const digitsOf = B.maskToDigits;
  const ROW = B.ROW_OF;
  const COL = B.COL_OF;
  const BOX = B.BOX_OF;

  const rc = (i) => 'R' + (ROW[i] + 1) + 'C' + (COL[i] + 1);
  const unitName = (u) => (u < 9 ? '第 ' + (u + 1) + ' 行' : u < 18 ? '第 ' + (u - 8) + ' 列' : '第 ' + (u - 17) + ' 宫');
  const list = (arr) => arr.join('、');

  /* ---------- 针对当前盘面的推导文本 ---------- */
  const DERIVE = {
    'naked-single'(s) {
      const d = s.focusDigit;
      const out = [];
      const peers = s.detail.excluded || [];
      const digits = Array.from(new Set(peers.map((p) => p.digit))).sort((x, y) => x - y);
      out.push('看 ' + rc(s.focusCell) + ' 周围的 20 个关联格（同行 8 + 同列 8 + 同宫 4）。');
      out.push('它们已经出现了 ' + list(digits.map(String)) + '。');
      out.push('1 到 9 里没有在这 20 格里出现过的，只剩 ' + d + ' 一个 —— 这一格没有第二种可能。');
      return out;
    },
    'hidden-single'(s) {
      const d = s.focusDigit;
      const out = [];
      out.push('把 ' + unitName(s.units[0]) + ' 单独拎出来，只关注数字 ' + d + '。');
      out.push('这一区域里已经出现过 ' + d + '，而候选里还带 ' + d + ' 的空格只剩 ' + rc(s.focusCell) + '。');
      out.push('因为 ' + d + ' 在这一区域必须出现且只能出现一次，所以它只能落在 ' + rc(s.focusCell) + '。');
      return out;
    },
    'locked-pointing'(s) {
      const d = s.focusDigit;
      const box = s.units.find((u) => u >= 18);
      const other = s.units.find((u) => u < 18);
      const inside = list((s.marks || []).map((m) => rc(m.cell)));
      const out = [];
      out.push('在 ' + unitName(box) + ' 里，数字 ' + d + ' 的候选只出现在 ' + inside + ' 这几格，它们全都落在' + unitName(other) + '。');
      out.push('假设 ' + d + ' 最终落在' + unitName(other) + '，那么这几格里必定有一格是 ' + d + '。');
      out.push('既然' + unitName(other) + '已经有一个 ' + d + ' 了，这一行（列）宫外的其它格子就再也不能是 ' + d + '。');
      return out;
    },
    'locked-claiming'(s) {
      const d = s.focusDigit;
      const inside = list((s.marks || []).map((m) => rc(m.cell)));
      const out = [];
      out.push('在' + unitName(s.units[0]) + '里，数字 ' + d + ' 的候选全部集中在 ' + inside + '，也就是说它们同属' + unitName(s.units[1]) + '。');
      out.push('这一列（行）上的 ' + d + ' 必然落在这几格之中，占掉其中一格。');
      out.push('因此' + unitName(s.units[1]) + '上、' + unitName(s.units[0]) + '之外的格子都可以删掉 ' + d + '。');
      return out;
    },
    'naked-pair'(s) {
      const ds = digitsOf(s.detail.mask);
      const out = [];
      out.push(rc(s.detail.pair[0]) + ' 和 ' + rc(s.detail.pair[1]) + ' 同在' + unitName(s.units[0]) + '，候选都恰好是 ' + list(ds.map(String)) + '。');
      out.push('这两个数字必须在这一区域里各用掉一次，而这个区域只剩它们两个位置。');
      out.push('所以 ' + ds[0] + ' 和 ' + ds[1] + ' 已经被这两格「锁死」，区域内其它格子的这两个候选都可以删掉。');
      return out;
    },
    'hidden-pair'(s) {
      const ds = s.detail.digits;
      const out = [];
      out.push('在' + unitName(s.units[0]) + '里，数字 ' + ds[0] + ' 只可能出现在 ' + rc(s.detail.cells[0]) + '、' + rc(s.detail.cells[1]) + '；数字 ' + ds[1] + ' 也只可能出现在同样这两格。');
      out.push('两个数字、两个格子，一一对应，说明这两格就是 ' + ds[0] + ' 和 ' + ds[1] + ' 的家。');
      out.push('因此这两格里除 ' + list(ds.map(String)) + ' 以外的候选（' + list(s.eliminations.map((e) => e.digit).map(String)) + '）都可以删掉了。');
      return out;
    },
    'naked-triple'(s) {
      const ds = digitsOf(s.detail.mask);
      const out = [];
      out.push('在' + unitName(s.units[0]) + '里，' + list(s.detail.group.map(rc)) + ' 三格候选完全相同，都是 ' + list(ds.map(String)) + '。');
      out.push('三个数字必须在这一区域内各用一次，而区域里只有它们三个位置。');
      out.push('区域内其它格子的 ' + list(ds.map(String)) + ' 全部作废。');
      return out;
    },
    'hidden-triple'(s) {
      const ds = s.detail.digits;
      const out = [];
      out.push('在' + unitName(s.units[0]) + '里，' + list(ds.map(String)) + ' 这三个数字的候选合起来只落在 ' + list(s.detail.cells.map(rc)) + ' 这三格上。');
      out.push('三个数字、三个格子，位置已经被占满，彼此不会干扰。');
      out.push('这三格里剩下的其它候选数都可以删掉。');
      return out;
    },
    'x-wing'(s) {
      const d = s.detail.digit;
      const rows = s.detail.bases.map((r) => r + 1);
      const cols = s.detail.cover.map((c) => c + 1);
      const out = [];
      out.push('盯住数字 ' + d + '。它在' + list(rows.map((r) => '第 ' + r + ' 行')) + '里，候选都只落在' + list(cols.map((c) => '第 ' + c + ' 列')) + '这几个位置。');
      out.push('同时，这几列里的 ' + d + ' 也只出现在这几行 —— 双向都被锁住了。');
      out.push('无论 ' + d + ' 最终落在哪一格，另一列都必然落在另一行，两行两列一起被填满。');
      out.push('所以这几列的其它行里，' + d + ' 的候选可以删掉。');
      return out;
    },
    'swordfish'(s) {
      const d = s.detail.digit;
      const bs = s.detail.bases.map((x) => x + 1);
      const cs = s.detail.cover.map((x) => x + 1);
      const out = [];
      out.push('数字 ' + d + ' 在' + list(bs.map((r) => '第 ' + r + ' 行')) + '里都只有' + list(cs.map((c) => '第 ' + c + ' 列')) + '这几个落点。');
      out.push('这几列的 ' + d + ' 也同样只出现在这几行，双向闭合。');
      out.push('三行三列会被 ' + d + ' 完整占满，覆盖列的其它位置就不可能有 ' + d + '。');
      out.push('这就是 X-Wing 的三阶版本 —— 原理完全一样，只是规模更大。');
      return out;
    },
    'xy-wing'(s) {
      const d = s.detail;
      const out = [];
      out.push('枢纽 ' + rc(d.pivot) + ' 的候选是 { ' + d.x + ', ' + d.y + ' }，所以它只能是这两个之一。');
      out.push('两个翼分别是 ' + rc(d.biff1) + ' = { ' + d.shared + ', ' + d.z + ' } 与 ' + rc(d.biff2) + ' = { ' + d.other + ', ' + d.z + ' }，两翼互为关联格。');
      out.push('若枢纽取 ' + d.x + '，则第一翼只能取 ' + d.z + '，第二翼就被逼成 ' + d.other + '；凡同时看得到两翼的格子都不能是 ' + d.z + '。');
      out.push('对称地，若枢纽取 ' + d.y + '，这些格子也都不能是 ' + d.x + '。两条分支都成立，所以 ' + d.x + ' 和 ' + d.z + ' 都可以删。');
      return out;
    },
    'xyz-wing'(s) {
      const d = s.detail;
      const out = [];
      out.push('枢纽 ' + rc(d.pivot) + ' 的候选是 { ' + d.x + ', ' + d.y + ', ' + d.z + ' }。');
      out.push('两个翼 ' + rc(d.biff1) + ' = { ' + d.x + ', ' + d.y + ' } 与 ' + rc(d.biff2) + ' = { ' + d.y + ', ' + d.z + ' } 互为关联格。');
      out.push('若枢纽取 ' + d.y + '，两翼就必须同时取 ' + d.x + ' 和 ' + d.z + '，而它们同区域 —— 矛盾。');
      out.push('若枢纽取 ' + d.x + '，第二翼只能取 ' + d.z + '，与第一翼的 ' + d.x + ' 同区域 —— 还是矛盾。');
      out.push('所以枢纽只能是 ' + d.z + '，全盘任何格子都不能再放 ' + d.z + '。');
      return out;
    },
    'unique-rectangle'(s) {
      const ds = digitsOf(s.detail.mask);
      const out = [];
      out.push('取第 ' + (s.detail.rows[0] + 1) + '/' + (s.detail.rows[1] + 1) + ' 行与第 ' + (s.detail.cols[0] + 1) + '/' + (s.detail.cols[1] + 1) + ' 列，构成一个恰好横跨两个宫的 2×2 矩形。');
      out.push('其中 ' + list(s.detail.triple.map(rc)) + ' 三格候选完全相同，都是 { ' + list(ds.map(String)) + ' }。');
      out.push(rc(s.detail.triple[0]) + ' 与另外两格分别同行、同宫，所以后两格只能取「与它相反」的那个数字。');
      out.push('无论 ' + rc(s.detail.triple[0]) + ' 取哪一个，第四格 ' + rc(s.detail.fourth) + ' 都会被同宫或同行的另一个 ' + ds.map(String).join('/') + ' 挡掉；若它再取剩下的那个数，题目就会出现第二个解。');
      out.push('所以 ' + rc(s.detail.fourth) + ' 必须删掉 ' + list(s.eliminations.map((e) => e.digit).map(String)) + '。');
      return out;
    },
    'forcing-chain'(s) {
      const d = s.detail;
      const out = [];
      out.push('这里普通技巧已经推不动了，改用反证：先假设 ' + rc(d.cell) + ' 不是 ' + d.digit + '。');
      out.push('在这个错误假设下继续用 L1~L4 的技巧推理，推出了矛盾（出现候选为空的格子 / 直接冲突）。');
      out.push('假设不成立，说明矛盾是错误假设带来的，故 ' + rc(d.cell) + ' 一定不是 ' + d.digit + '。');
      out.push('这类推理在数独术语里叫「链」。它一定成立，但人工做很累 —— 实际遇到卡壳，直接用自动求解更省时间。');
      return out;
    },
  };

  const CONCLUSION = {
    'naked-single': (s) => '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。',
    'hidden-single': (s) => '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。',
    'locked-pointing': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'locked-claiming': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'naked-pair': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'hidden-pair': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'naked-triple': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'hidden-triple': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'x-wing': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'xy-wing': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'xyz-wing': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'swordfish': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'unique-rectangle': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'forcing-chain': (s) => '删除 ' + rc(s.detail.cell) + ' 的 ' + s.detail.digit + '。',
  };

  function explainStep(step) {
    const meta = T.byId[step.id];
    const derive = DERIVE[step.id] ? DERIVE[step.id](step) : ['按该技巧的规则推进即可。'];
    const conclusion = CONCLUSION[step.id] ? CONCLUSION[step.id](step) : '按提示高亮的格子操作。';
    return {
      id: step.id,
      name: step.name,
      level: step.level,
      levelName: T.LEVEL_NAME[step.level] || '',
      color: T.LEVEL_COLOR[step.level] || '#888',
      tagline: step.tagline || (meta && meta.tagline) || '',
      principle: (meta && meta.principle) || '',
      howto: (meta && meta.howto) || [],
      pitfalls: (meta && meta.pitfalls) || '',
      derivation: derive,
      conclusion: conclusion,
      kind: step.placements.length ? 'place' : 'eliminate',
      oneLine:
        (step.placements.length
          ? rc(step.placements[0].cell) + ' = ' + step.placements[0].digit
          : list(step.eliminations.map((e) => rc(e.cell) + '≠' + e.digit)).slice(0, 6)) +
        '（' + step.name + '）',
    };
  }

  /* ---------- 试错法 / 链式推理 ---------- */

  /** 用固定候选数组跑一遍技巧推理，返回是否崩溃 */
  function simulateWithCands(grid, cand, maxLevel, cap) {
    const g = Uint8Array.from(grid);
    const c = Int32Array.from(cand);
    const seen = new Set();
    let steps = 0;
    while (steps < (cap || 600)) {
      if (SD.Validation.isComplete(g)) return { ok: true, contradiction: false, steps: steps, grid: g };
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (!g[i] && !c[i]) return { ok: false, contradiction: true, steps: steps, grid: g };
      }
      const step = T.findStepFrom({ grid: g, cand: c }, { maxLevel: maxLevel });
      if (!step) return { ok: false, contradiction: false, steps: steps, grid: g };
      const sig = step.id + '|' + step.placements.map((p) => p.cell + ':' + p.digit).join(',') + '|' +
        step.eliminations.map((e) => e.cell + ':' + e.digit).sort().join(',');
      if (!step.placements.length && seen.has(sig)) return { ok: false, contradiction: false, steps: steps, grid: g };
      seen.add(sig);
      steps++;
      T.commit(g, c, step);
    }
    return { ok: false, contradiction: false, steps: steps, grid: g };
  }

  /**
   * 试错法：挑候选最少的几格，逐个候选做反证。
   * 只有当某个候选为假会导致「技巧推理崩溃」时才算找到一步链推理。
   */
  function assumeWrong(grid, maxLevel, limit) {
    const base = SD.Validation.computeCandidates(grid);
    const cells = [];
    for (let i = 0; i < B.CELL_COUNT; i++) {
      if (!grid[i] && B.popcount(base[i]) >= 2 && B.popcount(base[i]) <= 4) cells.push(i);
    }
    cells.sort((a, b) => B.popcount(base[a]) - B.popcount(base[b]) || a - b);
    const take = cells.slice(0, limit || 8);

    for (const cell of take) {
      for (const d of digitsOf(base[cell])) {
        const trial = Int32Array.from(base);
        trial[cell] &= ~bit(d);
        const r = simulateWithCands(grid, trial, (maxLevel || 5) >= 5 ? 4 : maxLevel || 4);
        if (r.contradiction) {
          return {
            id: 'forcing-chain',
            name: '链式推理（试错法）',
            level: 5,
            category: '专家',
            tagline: '假设某个候选为假，若推出矛盾则该候选被排除。',
            cells: [cell],
            units: B.UNITS_OF[cell].slice(),
            placements: [],
            eliminations: [{ cell: cell, digit: d }],
            marks: [],
            focusCell: cell,
            focusDigit: d,
            detail: { cell: cell, digit: d, assumptionSteps: r.steps },
          };
        }
      }
    }
    return null;
  }

  /* ---------- 对外接口 ---------- */

  /**
   * 列出当前局面在等级上限内的所有可用解法，按技巧等级从低到高排好。
   * 每种技巧只取一步——同一种技巧此刻往往有很多处可用，全列出来反而没法选。
   */
  function available(grid, opts) {
    const o = opts || {};
    const steps = T.findAll(grid, o.maxLevel || 5);
    const out = steps.map((step) => ({ step: step, explain: explainStep(step) }));
    if (!out.length && o.allowGuess !== false && (o.maxLevel || 5) >= 5) {
      const guess = assumeWrong(grid, o.maxLevel || 5);
      if (guess) out.push({ step: guess, explain: explainStep(guess) });
    }
    return out;
  }

  /**
   * 取得下一条提示（列表里的第一条）。
   * opts.maxLevel 限制可用的技巧等级（对应「只用基础技巧」这类偏好）。
   * opts.allowGuess 是否允许退回到试错法。
   */
  function next(grid, opts) {
    const all = available(grid, opts);
    return all.length ? all[0] : null;
  }

  /** 生成整局完整解法（教学模式的「一步步演示」） */
  function walkthrough(grid, maxLevel) {
    const g = Uint8Array.from(grid);
    const cand = SD.Validation.computeCandidates(g);
    const steps = [];
    const seen = new Set();
    for (let i = 0; i < 3000; i++) {
      if (SD.Validation.isComplete(g)) break;
      let starved = false;
      for (let k = 0; k < B.CELL_COUNT; k++) if (!g[k] && !cand[k]) { starved = true; break; }
      if (starved) break;
      const step = T.findStepFrom({ grid: g, cand: cand }, { maxLevel: maxLevel || 5 });
      if (!step) {
        const chain = assumeWrong(g, maxLevel || 5, 12);
        if (!chain) break;
        steps.push({ step: chain, explain: explainStep(chain), gridBefore: g.slice() });
        cand[chain.eliminations[0].cell] &= ~bit(chain.eliminations[0].digit);
        continue;
      }
      const sig = step.id + '|' + step.placements.map((p) => p.cell + ':' + p.digit).join(',') + '|' +
        step.eliminations.map((e) => e.cell + ':' + e.digit).sort().join(',');
      if (!step.placements.length && seen.has(sig)) break;
      seen.add(sig);
      steps.push({ step: step, explain: explainStep(step), gridBefore: g.slice() });
      T.commit(g, cand, step);
    }
    return steps;
  }

  SD.Hints = { available, next, explainStep, assumeWrong, walkthrough, simulateWithCands };
})(window);
