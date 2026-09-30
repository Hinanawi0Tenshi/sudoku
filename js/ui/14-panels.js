/* 数独 · 提示面板与技巧教学面板 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const { el, clear } = SD.UI;

  const LEVEL_COLOR = SD.Techniques.LEVEL_COLOR;

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

  function renderLibrary(root, openId) {
    clear(root);
    const byLevel = {};
    for (const t of SD.Techniques.LIST) {
      (byLevel[t.level] = byLevel[t.level] || []).push(t);
    }
    for (const level of Object.keys(byLevel).sort()) {
      root.appendChild(
        el('div.tech-group-title', { text: 'L' + level + ' · ' + SD.Techniques.LEVEL_NAME[level] })
      );
      for (const t of byLevel[level]) {
        const open = openId === t.id;
        const card = el('div.tech-card' + (open ? '.is-open' : ''));
        const head = el('button.tech-head', {
          onclick: () => {
            const isOpen = card.classList.contains('is-open');
            renderLibrary(root, isOpen ? null : t.id);
            root.dispatchEvent(new CustomEvent('techpick', { detail: isOpen ? null : t.id, bubbles: true }));
          },
        }, [
          el('span.level-badge', { text: 'L' + t.level, style: { background: LEVEL_COLOR[t.level] } }),
          el('span', null, [el('span.tech-name', { text: t.name }), el('div.tech-alias', { text: (t.alias || []).join(' · ') })]),
          el('span.tech-arrow', { text: '›' }),
        ]);
        card.appendChild(head);

        if (open) {
          const body = el('div.tech-body');
          if (t.tagline) body.appendChild(el('h5', { text: '一句话' }));
          if (t.tagline) body.appendChild(el('p', { text: t.tagline }));
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
          card.appendChild(body);
        }
        root.appendChild(card);
      }
    }
  }

  SD.Panels = { renderHint: renderHint, renderLibrary: renderLibrary, renderAvailable: renderAvailable };
})(window);
