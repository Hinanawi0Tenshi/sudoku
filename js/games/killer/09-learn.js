/* 杀手数独 · 教程
 *
 * 笼子族每条技巧各配一个「当场能触发」的演示盘面。做法和扫雷、数独一致：
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
    'cage-mutex': {
      idea: '组合合法不代表摆得进这些格子——数字之间会抢位置。',
      how: '笼子「3 格和为 8」的组合里有 {1,2,5}，可如果这三格中没有任何一格能取 5，这个组合就是废的。把每个组合挨个往格子上分一遍（数字互不相同，本质上是一次匹配），分不进去的整条划掉；剩下的组合里某格从没拿到过的数字，就能删。',
      pitfall: '只检查「每个数字都还有落点」是不够的——两个数字抢同一格时会漏判。要确认整套组合能被分配下去。',
    },
    'cage-few': {
      idea: '组合只剩两三种时，笼内哪一格放哪个数字往往已经定了。',
      how: '笼子的「和」和「格数」一起把组合限得很死时，剩下的组合常常只有两三种。把这几种组合挨个往笼内的空格上分一遍（每格取一个互不相同的数字），如果某一格在所有分得进去的摆法里都只拿到同一个数字，那它就是定数。',
      pitfall: '只对「组合少」的笼子做。组合一多几乎不会出现定数，白花计算——所以这条技巧自己会先看组合数，超过三种就不往下做。',
    },
    'cage-split': {
      idea: '跨出单元的笼子，探进来那一段的和虽然没定，但有个范围。',
      how: '笼子探进某单元几格、又探出去几格时，探进来这段不能单独求和——它只是组合的一部分。但组合只有那么几种，每种里「最小的几格之和」到「最大的几格之和」算得出来，于是这段的和落在一个区间里。单元总和 45，减去这段和与已填数字，剩下的那一格就被夹住了。',
      pitfall: '只对「单元里正好还剩一格没被这个笼子盖住」成立。剩两格以上只能得到两格之和的范围，夹不出单格。',
    },
    'cage-line': {
      idea: '单元被「笼内这一段 + 已填格」盖满时，这段的和是定值。',
      how: '一条线或一个宫，如果除了某个笼子探进来的那几格以外全都填好了，那么 45 减去已填的数字，就是笼内这一段的定值和。于是这一段等价于一个「和已知的虚拟笼子」，可以按组合把候选删掉。',
      pitfall: '「盖满」是硬前提。单元里还剩空格时等式不成立，那段的和就是未知的。',
    },
    'cage-compare': {
      idea: '一个笼子这么摆，会让旁边那个笼子彻底没得摆。',
      how: '两个笼子如果整个落在同一个单元里，它们互相「看得见」——数字不能重复。这时把笼 A 的每个组合拿去和笼 B 的所有组合比一遍：如果 A 取某个组合之后，B 的每一种组合都和它撞数字，那 B 就没得摆了，说明 A 这个组合根本不可能。作废组合里独有的数字就能划掉。',
      pitfall: '两个笼子必须整个落在同一个单元里。有一个探出单元，它们的数字就不再互相排斥，比不了。',
    },
    'cage-parity': {
      idea: '两格的和是奇数，这两格就必然一奇一偶。',
      how: '两个数字相加，和的奇偶由两数的奇偶决定：一奇一偶得奇数，同奇或同偶得偶数。笼子剩两格时剩余和一旦确定，两格的奇偶关系也就定了。如果其中一格候选全是奇数（或全是偶数），另一格的奇偶就被逼死，可以删掉一半候选。',
      pitfall: '只对两格成立。三格以上时「和是奇数」只能推出「奇数的个数是奇数个」，推不出某一格的奇偶。',
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
      text: '杀手数独的提示分两族：笼子族（下面十二条，杀手特有的）和标准族（数独那 27 种，在杀手盘面上照样成立）。'
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
