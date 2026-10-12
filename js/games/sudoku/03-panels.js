/* 数独 · 提示面板与技巧教学面板 */
(function (global) {
  'use strict';

  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间
  const B = SD.Base;
  const { el, clear } = SD.UI;

  const LEVEL_COLOR = SD.Techniques.LEVEL_COLOR;
  const LEVEL_NAME = SD.Techniques.LEVEL_NAME;

  const REF_RE = /R(\d{1,2})C(\d{1,2})/g;

  /**
   * 把讲解里的 R2C4 变成可点的【R2C4】。
   * 用全角括号包起来是为了让它在一堆数字里一眼能被看见，鼠标停上去能在棋盘上点亮那一格。
   */
  function rich(text) {
    const s = String(text === null || text === undefined ? '' : text);
    const out = [];
    let last = 0;
    let m;
    REF_RE.lastIndex = 0;
    while ((m = REF_RE.exec(s)) !== null) {
      const r = Number(m[1]);
      const c = Number(m[2]);
      if (r < 1 || r > 9 || c < 1 || c > 9) continue;
      if (m.index > last) out.push(s.slice(last, m.index));
      out.push(el('span.ref', { dataset: { cell: String((r - 1) * 9 + (c - 1)) }, text: '【R' + r + 'C' + c + '】' }));
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  /** 选中那一条的讲解卡片 */
  function buildCard(explain) {
    const kindLabel = explain.kind === 'place' ? '落子' : '消除候选';
    const card = el('div.hint-card', null, [
      el('div.hint-head', null, [
        el('span.hint-tech', { text: explain.name }),
        el('span.level-badge', { text: explain.levelName + ' L' + explain.level, style: { background: explain.color || LEVEL_COLOR[explain.level] } }),
        el('span.hint-kind' + (explain.kind === 'elim' ? '.elim' : ''), { text: kindLabel }),
      ]),
    ]);

    if (explain.tagline) card.appendChild(el('div.hint-section', null, el('p', null, rich(explain.tagline))));

    if (explain.derivation && explain.derivation.length) {
      card.appendChild(
        el('div.hint-section', null, [
          el('h4', { text: '这一步是怎么看出来的' }),
          el('ol', null, explain.derivation.map((t) => el('li', null, rich(t)))),
        ])
      );
    }
    if (explain.principle) {
      card.appendChild(el('div.hint-section', null, [el('h4', { text: '技巧原理' }), el('p', null, rich(explain.principle))]));
    }
    if (explain.howto && explain.howto.length) {
      card.appendChild(
        el('div.hint-section', null, [el('h4', { text: '怎么用' }), el('ol', null, explain.howto.map((t) => el('li', null, rich(t))))])
      );
    }
    card.appendChild(el('div.hint-conclusion', null, rich('结论：' + explain.conclusion)));
    if (explain.pitfalls) {
      card.appendChild(el('div.hint-section', null, [el('h4', { text: '常见误区' }), el('p.hint-pitfall', null, rich(explain.pitfalls))]));
    }
    return card;
  }

  /**
   * 提示面板：把当前盘面所有可用解法按等级从低到高一次列全，
   * 顶部 ‹ n / xx › 翻页、中间技巧条点选，下方是选中那条的完整讲解。
   * 排序从低到高是刻意的：先用简单技巧走，实在推不动了再上高级技巧。
   */
  function renderHint(root, view) {
    clear(root);
    const list = (view && view.list) || [];
    if (!list.length) {
      root.appendChild(el('div.hint-empty', { text: '当前局面没有可用解法了——要么已经推完，要么把上面的「提示等级上限」调高一点。' }));
      return;
    }
    const index = Math.max(0, Math.min(list.length - 1, (view && view.index) || 0));
    const pick = (i) => {
      if (i < 0 || i >= list.length || i === index) return;
      root.dispatchEvent(new CustomEvent('hintpick', { detail: i, bubbles: true }));
    };

    root.appendChild(
      el('div.hint-pager', null, [
        el('button.pg', { text: '‹', title: '上一条', onclick: () => pick(index - 1) }),
        el('span.pg-num', { text: (index + 1) + ' / ' + list.length }),
        el('button.pg', { text: '›', title: '下一条', onclick: () => pick(index + 1) }),
      ])
    );

    const strip = el('div.hint-strip');
    list.forEach((entry, i) => {
      const c = LEVEL_COLOR[entry.explain.level] || '#64748b';
      strip.appendChild(
        el('button.hint-chip' + (i === index ? '.is-on' : ''), {
          text: entry.explain.name,
          title: (entry.explain.tagline || '') + '（L' + entry.explain.level + '）',
          style: { color: c, borderColor: i === index ? c : '' },
          onclick: () => pick(i),
        })
      );
    });
    root.appendChild(strip);

    root.appendChild(buildCard(list[index].explain));

    // 换一条解法就等于换了一篇讲解：正文要回到开头，否则停在上一篇的半截上，
    // 技巧条也要把当前这条滚进可视范围——它现在是横滑的一行，选中的可能在屏外
    root.scrollTop = 0;
    const on = strip.querySelector('.hint-chip.is-on');
    if (on) {
      // 居中值常常超出可滚动范围，会被浏览器截到最大值，结果末尾那条露不全。
      // 夹一次范围，再按实际超出量补一次。
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
      let want = on.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
      want = Math.max(0, Math.min(want, max));
      strip.scrollLeft = want;
      const over = on.offsetLeft + on.offsetWidth - (strip.scrollLeft + strip.clientWidth);
      if (over > 0) strip.scrollLeft = Math.min(max, strip.scrollLeft + over);
    }
  }
  /* ---------------- 技巧百科 ---------------- */
  function renderAvailable(root, grid) {
    clear(root);
    if (!grid) return;
    const available = SD.Techniques.findAll(grid, 5);
    if (!available.length) {
      root.appendChild(el('div.learn-intro', { text: '当前局面没有可用的进阶技巧——要么已经推完了，要么只剩简单技巧。' }));
      return;
    }
    root.appendChild(el('div.learn-intro', { text: '当前局面可用（' + available.length + ' 种）：' }));
    for (const step of available) {
      root.appendChild(
        el('button.tech-chip', {
          text: step.name,
          style: { color: LEVEL_COLOR[step.level] },
          title: step.tagline || '',
          onclick: () => {
            root.dispatchEvent(new CustomEvent('techpick', { detail: step.id, bubbles: true }));
          },
        })
      );
    }
  }
  /**
   * 技巧列表：可用的排前面，其余按等级接在后面，合成一张清单。
   *
   * 原先拆成「可用技巧的 chips」和「下面一整份百科」两块，点上面的 chip
   * 展开的是下面那张卡片，内容落在页面最底下，用户根本不知道该看哪儿。
   * 合成一张之后，点哪一条就在哪一条下面就地展开。
   */
  function renderTechIndex(root, grid, openId) {
    clear(root);
    const usable = {};
    if (grid) {
      for (const s of SD.Techniques.findAll(grid, 5)) usable[s.id] = true;
    }
    const list = SD.Techniques.LIST.slice().sort(function (a, b) {
      const ua = usable[a.id] ? 0 : 1;
      const ub = usable[b.id] ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return a.level - b.level || a.order - b.order;
    });

    let lastGroup = '';
    for (const t of list) {
      const on = usable[t.id];
      const group = on ? '当前局面可用' : 'L' + t.level + ' · ' + LEVEL_NAME[t.level];
      if (group !== lastGroup) {
        root.appendChild(el('div.tech-group-title', { text: group }));
        lastGroup = group;
      }
      const open = openId === t.id;
      const card = el('div.tech-card' + (open ? '.is-open' : '') + (on ? '.is-usable' : ''));
      card.appendChild(el('button.tech-head', {
        onclick: function () {
          var closing = open;
          renderTechIndex(root, grid, closing ? null : t.id);
          root.dispatchEvent(new CustomEvent('techpick', { detail: closing ? null : t.id, bubbles: true }));
          // 展开后把这条滚进视野：清单很长，不滚过去等于没展开
          if (!closing) {
            requestAnimationFrame(function () {
              var node = root.querySelector('.tech-card.is-open');
              if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            });
          }
        },
      }, [
        el('span.level-badge', { text: 'L' + t.level, style: { background: LEVEL_COLOR[t.level] } }),
        el('span', null, [
          el('span.tech-name', { text: t.name }),
          el('div.tech-alias', { text: (t.alias || []).join(' · ') }),
        ]),
        on ? el('span.tech-flag', { text: '可用' }) : null,
        el('span.tech-arrow', { text: '›' }),
      ]));
      if (open) card.appendChild(openBody(t));
      root.appendChild(card);
    }
  }

  /**
   * 演示棋盘：淡色小字是候选，被这一步删掉的打叉；蓝框是技巧盯着的格。
   * 局内弹窗也用它——独立页早就有了，这里补上，
   * 两处讲同一种技巧时看到的是同一张图，不会各说各话。
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
      // el() 用 split(/(?=[.#])/) 拆选择器，多个类名要点连、不能用空格
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

  /** 展开的技巧正文：演示盘面 + 一句话 + 原理 + 步骤 + 常见误区 */
  function openBody(t) {
    const body = el('div.tech-body');
    const demo = SD.Demo && SD.Demo.demoFor ? SD.Demo.demoFor(t.id) : null;
    if (demo) {
      body.appendChild(el('h5', { text: '演示' }));
      body.appendChild(el('p.demo-hint', { text: '蓝框是这一步盯着的格，淡色小字是候选数字，打叉的正是要删掉的。' }));
      body.appendChild(demoBoard(demo));
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
  SD.Sudoku.panels = { renderHint: renderHint, renderTechIndex: renderTechIndex, renderAvailable: renderAvailable };
})(window);
