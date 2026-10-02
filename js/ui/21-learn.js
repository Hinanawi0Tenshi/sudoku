/* 数独 · 技巧教学（独立页，带演示棋盘）
 *
 * 原来只在局内用弹窗讲技巧，纯文字看不懂。现在独立成页，
 * 每种技巧配一个当场真能触发的盘面（由 SD.Demo 现算），
 * 讲解和盘面对着看，不必再靠想象。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const el = SD.UI.el;

  let openId = null;

  /**
   * 演示棋盘。淡色小字是这格的候选数字，被这一步删掉的打叉；
   * 蓝框是技巧盯着的格，出数时把数字直接填进去。
   */
  function demoBoard(demo) {
    const board = el('div.demo-board');
    const step = demo.step;
    const elim = new Set();
    for (const e of step.eliminations || []) elim.add(e.cell + ':' + e.digit);
    const place = new Map();
    for (const p of step.placements || []) place.set(p.cell, p.digit);
    const mark = new Set(step.marks ? step.marks.map((m) => m.cell) : []);

    for (let i = 0; i < B.CELL_COUNT; i++) {
      const r = B.ROW_OF[i], c = B.COL_OF[i];
      // el() 用 split(/(?=[.#])/) 拆选择器，多个类名要点连、不能用空格；
      // 空格拼出来会被当成一个类名，classList.add 直接抛 InvalidCharacterError。
      let cls = 'dcell';
      if (c === 2 || c === 5) cls += '.dc';
      if (r === 2 || r === 5) cls += '.dr';
      if (demo.grid[i]) cls += '.dg';
      if (mark.has(i)) cls += '.dmark';
      if (i === step.focusCell) cls += '.dfocus';

      const cell = el('div.' + cls);
      if (demo.grid[i]) {
        cell.textContent = demo.grid[i];
      } else if (place.has(i)) {
        cell.textContent = place.get(i);
        cell.classList.add('dplace');
      } else {
        for (let d = 1; d <= 9; d++) {
          if (!(demo.cand[i] & B.bit(d))) continue;
          const chip = el('span.dcand');
          chip.textContent = d;
          if (elim.has(i + ':' + d)) chip.classList.add('out');
          cell.appendChild(chip);
        }
      }
      board.appendChild(cell);
    }
    return board;
  }

  function openBody(t) {
    const body = el('div.tech-body');
    const demo = SD.Demo.demoFor(t.id);
    body.appendChild(el('h5', { text: '演示' }));
    if (demo) {
      body.appendChild(el('p.demo-hint', { text: '蓝框是这一步盯着的格，淡色小字是候选数字，打叉的正是要删掉的。' }));
      body.appendChild(demoBoard(demo));
    } else {
      body.appendChild(el('p.demo-hint', { text: '这一种暂时没能造出演示盘面。' }));
    }
    if (t.tagline) { body.appendChild(el('h5', { text: '一句话' })); body.appendChild(el('p', { text: t.tagline })); }
    body.appendChild(el('h5', { text: '原理' }));
    body.appendChild(el('p', { text: t.principle || '—' }));
    if (t.howto && t.howto.length) {
      body.appendChild(el('h5', { text: '步骤' }));
      body.appendChild(el('ol', null, t.howto.map((x) => el('li', { text: x }))));
    }
    if (t.pitfalls) {
      body.appendChild(el('h5', { text: '常见误区' }));
      body.appendChild(el('p.hint-pitfall', { text: t.pitfalls }));
    }
    return body;
  }

  function renderLibrary(root) {
    const byLevel = {};
    for (const t of SD.Techniques.LIST) {
      (byLevel[t.level] = byLevel[t.level] || []).push(t);
    }
    for (const level of Object.keys(byLevel).sort()) {
      root.appendChild(el('div.tech-group-title', { text: 'L' + level + ' · ' + SD.Techniques.LEVEL_NAME[level] }));
      for (const t of byLevel[level]) {
        const open = openId === t.id;
        const card = el('div.tech-card' + (open ? '.is-open' : ''));
        card.appendChild(el('button.tech-head', {
          onclick: () => { openId = open ? null : t.id; renderLibrary(root); },
        }, [
          el('span.level-badge', { text: 'L' + t.level, style: { background: SD.Techniques.LEVEL_COLOR[t.level] } }),
          el('span', null, [el('span.tech-name', { text: t.name }), el('div.tech-alias', { text: (t.alias || []).join(' · ') })]),
          el('span.tech-arrow', { text: '›' }),
        ]));
        if (open) card.appendChild(openBody(t));
        root.appendChild(card);
      }
    }
  }

  function renderLearn(root) {
    root.appendChild(el('p.lead', { text: '每种技巧都配了一个当场能触发的盘面，对着图看比读文字快。' }));
    const lib = el('div.tech-library');
    renderLibrary(lib);
    root.appendChild(lib);
  }

  SD.Learn = { renderLearn: renderLearn };
})(window);