/* 杀手数独 · 中文讲解
 *
 * 笼子族那几条自己写；标准族直接交给数独那边的讲解——同一个技巧、同一套措辞，
 * 没必要抄第二遍。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;

  const rc = SD.Techniques.rc;
  const unitName = SD.Techniques.unitName;
  const digits = B.maskToDigits;
  const list = (a) => a.join('、');
  const cellsOf = (arr) => list(arr.map(rc));

  const DERIVE = {
    'cage-last'(s, puz) {
      const cg = puz.list[s.detail.cage];
      const out = [];
      out.push('看 ' + cellsOf(cg.cells) + ' 这个笼子：它的和是 ' + cg.sum + '。');
      if (cg.cells.length === 1) {
        out.push('这个笼子只有一格。一格笼子的和就是这一格的数字——没有第二个选择。');
      } else {
        out.push('里面已经填了 ' + (cg.cells.length - 1) + ' 格，只剩下 ' + rc(s.focusCell) + ' 空着。');
        out.push('目标和 ' + cg.sum + ' 减去已填的数字，差正好是 ' + s.focusDigit + '。');
      }
      return out;
    },
    'cage-combo'(s, puz) {
      const d = s.detail;
      const cg = puz.list[d.cage];
      const out = [];
      out.push('笼子 ' + cellsOf(cg.cells) + ' 还有 ' + d.empty + ' 格没填，还差 ' + d.left + '。');
      out.push('把「' + d.empty + ' 个互不相同的数字加起来等于 ' + d.left + '」的组合全列出来，一共 ' + d.combos + ' 种。');
      out.push('这些组合里从没出现过的数字，就永远进不了这个笼子。');
      out.push('本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
    'cage-required'(s, puz) {
      const d = s.detail;
      const cg = puz.list[d.cage];
      const out = [];
      out.push('笼子 ' + cellsOf(cg.cells) + ' 还差 ' + d.left + '，组合只有那么几种。');
      out.push('数字 ' + list(digits(d.required).map(String)) + ' 在每一种组合里都出现——它们必定在这个笼子里。');
      out.push('而这个笼子整个落在' + unitName(d.unit) + '内，所以这条线上笼子以外的格子都不可能是它们。');
      return out;
    },
    innie(s) {
      const d = s.detail;
      const out = [];
      out.push('数一下' + unitName(d.unit) + '里「完全落在里面」的笼子，一共 ' + d.cages + ' 个，和加起来是 ' + (45 - d.need) + '。');
      out.push('这一行（列 / 宫）里 9 个数字各一次，总和必然是 45。');
      out.push('剩下 ' + cellsOf(s.cells) + ' 没被这些笼子盖住，它们就承担了差额：45 − ' + (45 - d.need) + ' = ' + d.need + '。');
      return out;
    },
    outie(s) {
      const d = s.detail;
      const out = [];
      out.push('把与' + unitName(d.unit) + '相交的笼子全取来，一共 ' + d.cages + ' 个，和加起来是 ' + (45 + d.need) + '。');
      out.push('它们的格子合起来正好把这一行（列 / 宫）盖满了。');
      out.push('这一区域本身是 45，多出来的部分就是探到区域外的那 ' + s.cells.length + ' 格：' + (45 + d.need) + ' − 45 = ' + d.need + '。');
      return out;
    },
    'cage-trial'(s) {
      const out = [];
      out.push('这个局面已经推不动了，改用反证：逐个假设 ' + rc(s.focusCell) + ' 取它的某个候选。');
      out.push('每假设一次，就用带笼子约束的求解器把整道题重算一遍。');
      out.push('有几个候选在假设下整道题一个解都没有——那些假设自相矛盾，对应的候选必然是错的。');
      out.push('本轮删掉：' + list(s.eliminations.map((e) => rc(e.cell) + '≠' + e.digit)) + '。');
      return out;
    },
    'cage-mutex'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 的和是 ' + d.sum + '，现在还剩 ' + d.combos + ' 种组合摆得进去。');
      out.push('组合本身合法，不等于摆得进这些格子：把每个组合挨个往笼内的空格上分一遍，每一格都得有一个它能取的数字。');
      out.push('分不进去的组合整条作废。作废之后，某些格子上再也拿不到的数字就能划掉。');
      out.push('本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
    'cage-few'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 的和是 ' + d.sum + '，还空着 ' + d.empty + ' 格。');
      out.push('把「' + d.empty + ' 个互不相同的数字加起来等于 ' + d.sum + '」的组合摆到这几格上，能摆进去的只剩 ' + d.combos + ' 种。');
      out.push('组合少到这个份上，就逐个摆一遍看每格能拿到什么。');
      out.push(rc(s.focusCell) + ' 在所有可行摆法里都只能是 ' + s.focusDigit + '——直接定数。');
      return out;
    },
    'cage-split'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 跨出了' + unitName(d.unit) + '，探进来的那几格不能单独求和。');
      out.push('但组合只有那么几种：每种里「最小的几格之和」到「最大的几格之和」都算得出来，所以这一段的和落在一个区间里。');
      out.push('这个单元里除了这几格，只剩 ' + rc(s.focusCell) + ' 一格空着。45 减去这段和、再减去已填的数字，它的范围就是 ' + d.lo + '~' + d.hi + '。');
      out.push('本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
    'cage-line'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('看' + unitName(d.unit) + '：笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 探进来一段，其余格子都已经填好了。');
      out.push('这一行（列 / 宫）里 9 个数字各一次，总和 45。45 减去已填的数字，就是笼内这一段的定值和：' + d.need + '。');
      out.push('这一段于是等价于一个「和为 ' + d.need + '」的虚拟笼子，可以按组合排除候选。');
      out.push(s.placements.length
        ? '只剩一格，直接填 ' + s.focusDigit + '。'
        : '本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
    'cage-compare'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 和笼子 ' + cellsOf(puz.list[d.other].cells) + ' 都整个落在' + unitName(d.unit) + '里。');
      out.push('同一单元里 9 个数字各用一次，两个笼子占的格子又不重叠，所以它们的数字集合必须完全不撞。');
      out.push('拿笼子 A 的 ' + d.total + ' 种组合逐个去比：只要和笼子 B 的某种组合不撞数字就还留着，比下来只剩 ' + d.kept + ' 种。');
      out.push('被砍掉的组合用不到的数字，可以从笼内格子上划掉。');
      out.push('本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
    'cage-parity'(s, puz) {
      const d = s.detail;
      const out = [];
      out.push('笼子 ' + cellsOf(puz.list[d.cage].cells) + ' 只剩两格没填，还差 ' + d.need + '。');
      out.push(d.opposite
        ? '两个数字相加，和是奇数，说明这两格必然一奇一偶。'
        : '两个数字相加，和是偶数，说明这两格奇偶相同——要么都奇，要么都偶。');
      out.push('其中一格的候选只剩下一种奇偶，另一格就被逼死了。');
      out.push('本轮划掉：' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。');
      return out;
    },
  };

  const CONCLUSION = {
    'cage-last': (s) => '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。',
    'cage-combo': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'cage-required': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    innie: (s) => (s.placements.length
      ? '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。'
      : '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。'),
    outie: (s) => (s.placements.length
      ? '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。'
      : '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。'),
    'cage-trial': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'cage-mutex': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'cage-few': (s) => (s.placements.length
      ? '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。'
      : '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。'),
    'cage-split': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
    'cage-line': (s) => (s.placements.length
      ? '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。'
      : '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。'),
    'cage-compare': (s) => (s.placements.length
      ? '把 ' + rc(s.focusCell) + ' 填成 ' + s.focusDigit + '。'
      : '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。'),
    'cage-parity': (s) => '删除 ' + list(s.eliminations.map((e) => rc(e.cell) + ' 的 ' + e.digit)) + '。',
  };

  const KILLER_IDS = Object.keys(DERIVE);

  function explainStep(step, puz) {
    // 标准族交给数独那边的讲解：同一个技巧、同一套措辞，没必要抄第二遍
    if (KILLER_IDS.indexOf(step.id) < 0) return SD.Hints.explainStep(step);
    const meta = K.techniques.byId[step.id];
    return {
      id: step.id,
      name: step.name,
      level: step.level,
      levelName: SD.Techniques.LEVEL_NAME[step.level] || '',
      color: SD.Techniques.LEVEL_COLOR[step.level] || '#888',
      tagline: step.tagline || (meta && meta.tagline) || '',
      principle: (meta && meta.principle) || '',
      howto: (meta && meta.howto) || [],
      pitfalls: (meta && meta.pitfalls) || '',
      derivation: DERIVE[step.id](step, puz),
      conclusion: CONCLUSION[step.id] ? CONCLUSION[step.id](step) : '按提示高亮的格子操作。',
      kind: step.placements.length ? 'place' : 'eliminate',
      oneLine:
        (step.placements.length
          ? rc(step.placements[0].cell) + ' = ' + step.placements[0].digit
          : list(step.eliminations.map((e) => rc(e.cell) + '≠' + e.digit)).slice(0, 6)) +
        '（' + step.name + '）',
    };
  }

  /** 当前局面所有可用解法，按等级从低到高 */
  function available(puz, grid, opts) {
    const o = opts || {};
    const state = K.techniques.makeState(puz, grid);
    // 把玩家的铅笔标记并进候选。笔记是玩家已经推出来的结论——不并进来的话，
    // 引擎每次从盘面重算，会把已经删掉的候选重新推出来，同一条消除型解法反复列出，
    // 面板按"做过"过滤之后列表就空了（实测简单档走 7 步、大师档走 4 步就卡住）。
    if (o.notes) {
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (state.grid[i] || !o.notes[i]) continue;
        // 只收窄「玩家确实做过笔记」的格子。笔记为空是「还没做笔记」，不是「候选被推没了」——
        // 一刀切地 &= 0 会把开局（笔记全空）判成无解：实测困难 / 大师档开局点提示 0 条解法，
        // 简单档也只剩 1 条。
        state.cand[i] &= o.notes[i];
      }
    }
    const steps = K.techniques.findAll(state, o.maxLevel || 5);
    return steps.map((step) => ({ step: step, explain: explainStep(step, puz) }));
  }

  /** 整局完整解法，供「自动求解」和教学演示用 */
  function walkthrough(puz, grid, maxLevel) {
    const g = Uint8Array.from(grid);
    const state = K.techniques.makeState(puz, g);
    const cand = state.cand;
    const steps = [];
    const seen = new Set();
    for (let i = 0; i < 3000; i++) {
      if (SD.Validation.isComplete(g)) break;
      let starved = false;
      for (let k = 0; k < B.CELL_COUNT; k++) if (!g[k] && !cand[k]) { starved = true; break; }
      if (starved) break;
      const step = K.techniques.findStepFrom(state, { maxLevel: maxLevel || 5 });
      if (!step) break;
      const sig = step.id + '|' + step.placements.map((p) => p.cell + ':' + p.digit).join(',') + '|' +
        step.eliminations.map((e) => e.cell + ':' + e.digit).sort().join(',');
      if (!step.placements.length && seen.has(sig)) break;
      seen.add(sig);
      steps.push({ step: step, explain: explainStep(step, puz), gridBefore: g.slice() });
      SD.Techniques.commit(g, cand, step);
    }
    return steps;
  }

  K.hints = { explainStep: explainStep, available: available, walkthrough: walkthrough, DERIVE: DERIVE };
})(window);
