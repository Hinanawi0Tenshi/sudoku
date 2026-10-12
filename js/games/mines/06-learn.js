/* 扫雷 · 教程
 *
 * 每种技巧配一个「当场能触发」的演示盘面。做法和数独那边一样：
 * 用固定种子随机打若干局，第一局里出现该技巧的局面留下来当示例——
 * 这样示例必然是真的能用，不存在「图上画的和实际对不上」。
 *
 * 演示盘面按需现算并缓存：九种全算一遍要好几秒，而玩家一次只看一种。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const M = (SD.Mines = SD.Mines || {});
  const U = SD.Util;
  const { el, clear } = SD.UI;

  /** 每种技巧的静态讲解。求解器只保证结论对，措辞在这里。 */
  const TEXT = {
    'single-safe': {
      idea: '一个数字要的雷已经全被标出来了，它周围剩下的未知格就不可能再有雷。',
      how: '盯着一个已翻开的数字，数它周围插了几面旗。旗数正好等于数字，那剩下的格子全是安全的。',
      pitfall: '前提是旗插对了。随手标上去的旗会把这条推理整个带偏——插旗本身就是一步推理，不是做标记。',
    },
    'single-mine': {
      idea: '一个数字周围没翻开的格子数，正好等于它还需要的雷数，那这些格子全是雷。',
      how: '数字 3，周围插了 1 面旗，还有 2 格没翻开——2 格要放 2 颗雷，一格都跑不掉。',
      pitfall: '数的是「还没翻开的格子」，不是「所有格子」。已经翻开的格子显然不是雷，不该算进去。',
    },
    'global-safe': {
      idea: '所有该插旗的雷都插完了，剩下没翻开的格子一个雷都没有。',
      how: '看左上角还剩几颗雷。如果剩余雷数是 0，那所有没翻开的格子都可以放心点开。',
      pitfall: '这条依赖「旗插得准」。旗插错一颗，剩余雷数就是错的，结论跟着错。',
    },
    'global-mine': {
      idea: '还剩几颗雷没找到，而没翻开的格子正好也是这么多——那就全是雷。',
      how: '剩余雷数和未翻开格数相等时，每一格都得承担一颗雷，没有余量。',
      pitfall: '只在两者「正好相等」时成立。差一个都不行，那只能说明其中有几颗，说不清是哪几颗。',
    },
    'subset-mine': {
      idea: '两个数字的未知范围互相包含时，多出来的那几格能直接判定。',
      how: '一个 1 的范围是 {A,B}，旁边的 2 范围是 {A,B,C}。1 要的雷已经占满了它的两格，'
        + '2 比它多要一颗，那颗只能落在多出来的 C 上。',
      pitfall: '必须是一个范围「完全包住」另一个。只是重叠、部分相交，推不出结论——那得靠枚举。',
    },
    'subset-safe': {
      idea: '同上，但两个数字要的雷数一样——那么多出来的那几格就是安全的。',
      how: '1-2-1、1-2-2-1 这些口口相传的形状，都是这条规则在特定排列上的样子。'
        + '看到两个数字范围互相包含、要的雷数又相同，差集就全是安全的。',
      pitfall: '很多人会凭「看起来像 1-2-1」直接下结论。形状对不上就退化成普通的重叠，结论不成立。',
    },
    'enumerate-safe': {
      idea: '把边界上所有可能的布雷方式穷举一遍，某格在每一种里都安全，那它就是安全的。',
      how: '不需要人眼看出结构。只要把符合已知数字的排法全列出来，逐格统计就行——'
        + '这也是前面几条规则推不出来时最有用的兜底。',
      pitfall: '枚举只基于「已知信息」。玩家自己插错的旗会让枚举建立在一个不可能的前提上，'
        + '所以发现结论和直觉冲突时，先回头检查旗。',
    },
    'enumerate-mine': {
      idea: '同上，某格在每一种可能的排法里都是雷，那它就是雷。',
      how: '和「必然安全」是一体两面，一次枚举同时给出两个方向。',
      pitfall: '如果某格在有些排法里是雷、有些不是，那它就是不确定的——这时候只能说概率，不能说必然。',
    },
    guess: {
      idea: '没有任何必然的下一步时，挑雷概率最低的那格点。',
      how: '枚举出所有可能的布雷方式，统计每一格是雷的比例。比例最低的格子就是赔率最好的赌注。',
      pitfall: '概率低不等于安全。提示在这里能做的是「把赌注下在赔率最好的地方」，不是「保证你不炸」——'
        + '这正是扫雷的一部分。',
    },
  };

  const cache = {};
  let searching = {};

  /**
   * 找一局「真的会触发该技巧」的局面。
   * 用求解器自己打，所以局面是玩家真能走到的，不是硬凑出来的。
   */
  /** 这三条在随机对局里太罕见，直接用构造好的局面 */
  const FIXTURE_OF = { 'single-safe': 'singleSafe', 'global-safe': 'globalSafe', 'global-mine': 'globalMine' };

  function findDemo(id) {
    if (id in cache) return cache[id];
    cache[id] = null;

    const mk = M.fixtures && M.fixtures[FIXTURE_OF[id]];
    if (mk) {
      const fb = mk();
      const fa = M.solver.analyze(fb, { enumerate: true });
      const fs = fa.steps.find((x) => x.id === id);
      if (fs) {
        cache[id] = { board: fb, step: fs, level: { name: '构造示例' } };
        return cache[id];
      }
    }

    // 随机搜索要有时间预算：找不到时把整页冻住几秒，比「没找到」更让人难受。
    // 只在初级和中级里找——高级盘面一次分析就要十几毫秒，翻完一局够把预算耗光，
    // 而这几条规则在中级盘面上本来就常见。
    const deadline = Date.now() + 400;
    const pool = [M.LEVELS[0], M.LEVELS[1]];
    for (let s = 0; s < 40; s++) {
      if (Date.now() > deadline) break;
      const lv = pool[s % pool.length];
      const b = M.create(lv.w, lv.h, lv.mines, 'learn-' + id + '-' + s);
      const rng = U.makeRng('learn-pick-' + id + '-' + s);
      M.open(b, Math.floor(rng() * lv.w * lv.h));
      let guard = 0;
      while (!M.isOver(b) && guard++ < 80 && Date.now() < deadline) {
        const an = M.solver.analyze(b, { enumerate: true });
        const step = an.steps.find((x) => x.id === id);
        // 「猜测」只有在一条必然结论都没有时才算数，否则它根本不是猜
        const pure = !an.steps.some((x) => x.certain);
        if (step && (id !== 'guess' || pure)) {
          cache[id] = { board: M.deserialize(M.serialize(b)), step: step, level: lv };
          return cache[id];
        }
        const best = M.solver.bestStep(an);
        if (!best || !best.certain) break;
        if (best.safe.length) {
          for (const i of best.safe) if (!M.isOver(b)) M.open(b, i);
        } else if (best.mines.length) {
          for (const i of best.mines) M.toggleFlag(b, i);
        } else break;
      }
    }
    return null;
  }

  /** 演示盘面：只读，不接受点击，高亮这条推理涉及的格子 */
  function demoBoard(demo) {
    const box = el('div.mine-demo');
    const view = M.view.create(box, {});
    view.render(demo.board, { hint: demo.step });
    view.resize(demo.board);
    return box;
  }

  function render(root) {
    clear(root);
    root.appendChild(el('p.lead', {
      text: '扫雷不是靠运气——每一步都能推理出来。下面九种技巧按「用到的推理有多深」分级，'
        + '每种配一个当场能触发的演示盘面。点开哪一条就算哪一条的演示。',
    }));

    let lastLevel = null;
    for (const t of M.solver.TECHNIQUES) {
      if (t.level !== lastLevel) {
        lastLevel = t.level;
        root.appendChild(el('h3.sec-title', {
          text: 'L' + t.level + ' ' + M.solver.LEVEL_NAME[t.level],
        }));
      }
      root.appendChild(card(t));
    }
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
    if (text.idea) {
      box.appendChild(el('p.mine-learn-idea', { text: text.idea }));
    }
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

    const demo = findDemo(t.id);
    body.appendChild(el('h4.mine-learn-sub', { text: '演示' }));
    if (!demo) {
      body.appendChild(el('p.mine-learn-none', { text: '没能构造出这一条的可复现示例。' }));
      return;
    }
    const board = demoBoard(demo);
    body.appendChild(board);
    const ex = M.hints.explain(demo.board, demo.step);
    body.appendChild(el('p.mine-learn-concl', { text: ex.conclusion }));
    const from = demo.level.name === '构造示例'
      ? '这条规则在随机对局里太罕见，演示局面是手工摆出来的'
      : '演示局面取自一局真实对局（' + demo.level.name + '），不是硬凑的';
    body.appendChild(el('p.mine-learn-note', {
      text: '蓝底 = 这一步的依据，红底 = 判为雷，绿底 = 判为安全。' + from + '。',
    }));
  }

  M.learn = { render: render, findDemo: findDemo, TEXT: TEXT };
})(window);
