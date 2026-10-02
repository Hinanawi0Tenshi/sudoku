/* 数独 · 批量题库（自动生成，请勿手改）
 *
 * 由 tests/gen-bank.js 离线生成，每道都当场复核过：解唯一、且不需要试错。
 * 数量：@@COUNTS@@。
 *
 * 单独一个文件而不是并进 08-bank.js：那份是精心挑的几道经典题，用途不同，
 * 混在一起会把精选淹没。
 *
 * 每道题存成「题面|标记」，标记是 等级*100+线索数，压成一个数字省掉每题一层字段。
 */
(function (global) {
  'use strict';

  const RAW = {
@@PARTS@@
  };

  const NAMES = { @@NAMES@@ };
  const ORDER = @@ORDER@@;

  // 惰性解析：这表总共几千道题，但玩家通常只看当前那一档，全量解析成对象没必要。
  const cache = {};

  function entriesOf(diff) {
    if (cache[diff]) return cache[diff];
    const raw = RAW[diff] || '';
    const out = [];
    let s = 0;
    let n = 0;
    for (let i = 0; i <= raw.length; i++) {
      if (i === raw.length || raw.charAt(i) === ',') {
        const seg = raw.slice(s, i);
        const bar = seg.lastIndexOf('|');
        if (bar > 0) {
          const mark = +seg.slice(bar + 1);
          out.push({ id: diff.charAt(0) + (n++), grid: seg.slice(0, bar), level: (mark / 100) | 0, clueCount: mark % 100 });
        }
        s = i + 1;
      }
    }
    cache[diff] = out;
    return out;
  }

  function shape(diff, e) {
    return {
      id: e.id,
      name: NAMES[diff] + ' ' + e.id,
      note: '线索 ' + e.clueCount + ' · 评级 L' + e.level,
      grid: e.grid,
      difficulty: diff,
      clueCount: e.clueCount,
      level: e.level,
    };
  }

  function of(diff) {
    return entriesOf(diff).map(function (e) { return shape(diff, e); });
  }

  function randomOf(diff) {
    const list = entriesOf(diff);
    if (!list.length) return null;
    return shape(diff, list[(Math.random() * list.length) | 0]);
  }

  function countOf(diff) { return entriesOf(diff).length; }

  // 题面指纹，用来避免和已经出现过的题重复
  function gridsOf(diff) {
    const s = new Set();
    for (const e of entriesOf(diff)) s.add(e.grid);
    return s;
  }

  global.SD.BankBig = { ORDER: ORDER, of: of, randomOf: randomOf, countOf: countOf, gridsOf: gridsOf };
})(window);