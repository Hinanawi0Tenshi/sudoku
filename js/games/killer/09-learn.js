/* 杀手数独 · 教程
 *
 * 笼子族五条技巧各配一个「当场能触发」的演示盘面。做法和扫雷、数独一致：
 * 用求解器自己打一局，在目标技巧成为「当前该走的那一步」时把局面截下来——
 * 这样示例必然是真的能用，也不存在「图上画的和实际对不上」。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const B = SD.Base;
  const { el, clear } = SD.UI;
  const KT = K.techniques;

  const TEXT = {
    'cage-last': {
      idea: '笼子里只剩一格没填，这一格就是还差的那个和。',
      how: '一格笼子最省事：和是多少，那一格就是多少。多格笼子填到只剩一格时同理——目标和减去已填数字就是答案。',
      pitfall: '扫盘时先把一格笼子清干净。它们往往能连锁带出周围一大片唯一余数。',
    },
    'cage-combo': {
      idea: '笼子的「和」和「格数」一起，限定了里面能出现哪些数字。',
      how: '3 格笼子和为 7，可能的组合只有 {1,2,4}——8、9 再怎么小也塞不进去。把组合列全，从没出现过的数字就能从笼内每一格划掉。',
      pitfall: '只能划掉「所有组合都没用到」的数字。只在部分组合里出现的不能删，它可能是对的。',
    },
    'cage-required': {
      idea: '某个数字在每一种组合里都出现——它必定在这个笼子里。',
      how: '3 格笼子和为 6 只有 {1,2,3}，三个数字全都要出现。如果整个笼子正好落在同一行（列 / 宫）里，这条线上笼子以外的格子就不可能再是它们。',
      pitfall: '只有「整个笼子都在同一个单元里」才能向外排除。笼子跨行跨宫时推不出去。',
    },
    innie: {
      idea: '每一行、每一列、每一宫的九个数字加起来都是 45。',
      how: '把一条线上「完全落在里面」的笼子的和加起来，45 减去它就是剩下那些没被笼子盖住的格子的和。只剩一格就直接定数，剩几格就按组合排除候选。',
      pitfall: '只能算「完全在单元内」的笼子。跨出单元的笼子不能直接计入——那部分格子不属于这个 45。',
    },
    outie: {
      idea: '笼子探出单元的那几格，和也是定值。',
      how: '把与某条线相交的笼子全取来。如果它们正好把这条线盖满，那么这些笼子的和 = 45 + 探出线外那几格的和。',
      pitfall: '「盖满」是硬前提。少盖一格等式就不成立——那说明还有格子没被这些笼子解释。',
    },
    'cage-trial': {
      idea: '假设某格取某个数，把笼子一起算进去往下推，推出矛盾就说明假设不成立。',
      how: '数独那套试数只按同行列宫推，在杀手盘面上往往推不动——笼子的和它完全没用上。这里每假设一步就用带笼子约束的求解器重算整道题。',
      pitfall: '这是兜底手段，代价高。前面几条都走完了才轮到它——手工做更慢，卡住了直接点提示。',
    },
  };

  /**
   * 演示局面是**离线算好的静态数据**（见 08-demos.js 和 tests/build-killer-demos.js）。
   *
   * 原先在浏览器里现算：出题、一局局推下去、逐个技巧找局面，点开教程要等好几秒。
   * 但这些局面跟玩家、跟时间都没关系——同一份数据对所有人都成立，
   * 那就不该让每个玩家各算一遍。现在点开是瞬时的。
   */
  const cache = {};

  /** 取某种技巧的演示局面；数据里没有就返回 null */
  function findDemo(id) {
    if (id in cache) return cache[id];
    const raw = K.demos && K.demos[id];
    if (!raw) { cache[id] = null; return null; }
    const puz = K.cages.create(raw.c.map((c) => ({ cells: c[0], sum: c[1] })));
    const grid = new Uint8Array(81);
    for (let i = 0; i < 81; i++) grid[i] = raw.g.charCodeAt(i) - 48;
    cache[id] = {
      puz: puz,
      grid: grid,
      // decorate 会补回 name / level / tagline / cells / elimCells
      step: SD.Techniques.decorate(KT.byId[raw.s.id], Object.assign({}, raw.s)),
      difficulty: raw.d,
    };
    return cache[id];
  }

  /** 只读演示盘面：不接受点击，笼子照画，这条推理涉及的格子高亮 */
  function demoBoard(demo) {
    const box = el('div.killer-demo');
    const view = SD.BoardView.create(box, {});
    view.render({ grid: demo.grid, notes: new Int32Array(81), isGiven: () => false }, {
      cages: demo.puz,
      hint: demo.step,
    });
    return box;
  }

  function render(root) {
    clear(root);
    root.appendChild(el('p.lead', {
      text: '杀手数独的提示分两族：笼子族（下面六条，杀手特有的）和标准族（数独那 27 种，在杀手盘面上照样成立）。'
        + '每种配一个当场能触发的演示盘面，点开哪一条就算哪一条的演示。',
    }));

    let lastLevel = null;
    for (const t of KT.LIST) {
      if (t.level !== lastLevel) {
        lastLevel = t.level;
        root.appendChild(el('h3.sec-title', { text: 'L' + t.level + ' ' + SD.Techniques.LEVEL_NAME[t.level] }));
      }
      root.appendChild(card(t));
    }

    root.appendChild(el('h3.sec-title', { text: '标准族' }));
    root.appendChild(el('p.lead', {
      text: '数独那 27 种技巧在杀手盘面上依然成立——它们的推理只依赖行列宫候选数，'
        + '而那个集合永远包含真解数字，多一层笼子只会让真实候选更小，不会让结论失真。'
        + '所以这一族直接复用了数独的引擎，讲解也共用同一份。',
    }));
    root.appendChild(el('p.lead', {
      text: '有一族例外：唯一矩形那种靠「致命模式」论证的技巧被主动排除了。'
        + '交换两格会破坏笼子和，「第二个解」根本不存在，照搬会删掉真解数字。',
    }));
  }

  function card(t) {
    const text = TEXT[t.id] || {};
    const body = el('div.mine-learn-body');
    let built = false;
    const box = el('div.mine-learn-card', null, [
      el('button.mine-learn-head', {
        onclick: () => {
          const on = box.classList.toggle('is-open');
          if (on && !built) { built = true; fill(body, t); }
        },
      }, [
        el('span.mine-learn-lv', { text: 'L' + t.level }),
        el('b.mine-learn-name', { text: t.name }),
        el('span.mine-learn-arrow', { text: '›' }),
      ]),
      body,
    ]);
    if (text.idea) box.appendChild(el('p.mine-learn-idea', { text: text.idea }));
    return box;
  }

  function fill(body, t) {
    const text = TEXT[t.id] || {};
    body.appendChild(el('h4.mine-learn-sub', { text: '怎么看' }));
    body.appendChild(el('p', { text: text.how || '' }));
    if (text.pitfall) {
      body.appendChild(el('h4.mine-learn-sub', { text: '常见误区' }));
      body.appendChild(el('p', { text: text.pitfall }));
    }
    body.appendChild(el('h4.mine-learn-sub', { text: '演示' }));
    const demo = findDemo(t.id);
    if (!demo) {
      body.appendChild(el('p.mine-learn-none', { text: '没能构造出这一条的可复现示例。' }));
      return;
    }
    body.appendChild(demoBoard(demo));
    const ex = K.hints.explainStep(demo.step, demo.puz);
    for (const line of ex.derivation || []) body.appendChild(el('p', { text: line }));
    body.appendChild(el('p.mine-learn-concl', { text: ex.conclusion }));
    body.appendChild(el('p.mine-learn-note', {
      text: '演示局面取自一局真实对局（' + demo.difficulty + '），不是硬凑的。'
        + '虚线是笼子边界，左上角的小数字是这个笼子的和。',
    }));
  }

  K.learn = { render: render, findDemo: findDemo, TEXT: TEXT };
})(window);
