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
