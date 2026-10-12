/* 数独 · 游戏装配
 *
 * 数独这一款游戏的完整定义：首页入口、对局页骨架、快捷键、结算、题库、每日挑战。
 * 平台层只通过 SD.Registry 里注册的那份描述调用它；
 * 这个文件里不出现「标题界面」「选游戏」之类的概念——那是壳的事。
 *
 * 对局页的骨架也从这里建，不再写死在 index.html 里：
 * 扫雷的盘面跟 9×9 完全不是一回事，壳不该预设任何控件。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间
  const B = SD.Base;
  const U = SD.UI;
  const { $, $$, el, clear, toast, modal, confirm } = U;
  const Store = SD.Sudoku.store;

  let game = null;
  let view = null;
  let openTech = null;
  let hintList = [];   // 当前盘面所有可用解法，按等级从低到高
  let hintIndex = 0;   // 面板上正在看第几条
  let mistakeAsked = false;
  let dailyNoted = false;
  // 会话令牌。出题是异步的，玩家可能在出题途中就退出去换游戏了；
  // 回调里比一下令牌，就知道这局还该不该落地。
  let session = 0;
  // 后台备局的令牌。进游戏时会先在后台备一局，玩家要是抢先自己开了局，
  // 那次备局晚一步落地就会把他刚选的题顶掉——所以任何一次明确开局都作废它。
  let preparing = 0;

  let homeStatsNode = null;
  let dailyDescNode = null;

  /* 每个难度同时只留一局正在做的。玩家可以五档各开一局，但同一档不重复占位。 */
  const QUEUE_KEEP = 1;

  /**
   * 一局通关值多少点数。按难度分档，每日挑战额外加成——
   * 它是每天只有一次机会的题，值得比平时多给一点。
   *
   * 不因为用了提示或自动求解打折：这是练习工具，
   * 用提示恰恰是它该被用的方式，扣分只会让人不敢点。
   */
  const WIN_POINTS = { easy: 5, medium: 10, hard: 20, expert: 35, master: 60 };
  function pointsFor(meta) {
    const base = WIN_POINTS[meta.difficulty] || 10;
    return meta.dailyKey ? Math.round(base * 1.5) : base;
  }

  /* ---------------- 首页 ---------------- */
  const HOME_MENU = [
    { id: 'play', label: '开始数独', desc: '按难度出一道新题', primary: true },
    { id: 'bank', label: '题库', desc: '精选题目，也可以从照片存自己的' },
    { id: 'daily', label: '每日挑战', desc: '同一天全世界同一道题' },
    { id: 'mine', label: '我的', desc: '战绩纪录与卡牌图鉴' },
    { id: 'learn', label: '技巧教学', desc: '每种技巧配一个演示棋盘' },
  ];

  function buildHome(root) {
    root.appendChild(el('div.home-logo', { text: '9' }));
    root.appendChild(el('h1.home-title', { text: '数独' }));
    root.appendChild(el('p.home-sub', { text: '会出题、会讲解、会从图片里读题' }));
    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const desc = el('span.hi-desc', { text: item.desc });
      if (item.id === 'daily') dailyDescNode = desc;
      menu.appendChild(el('button.home-item' + (item.primary ? '.home-item-primary' : ''), {
        dataset: { go: item.id },
        onclick: () => handleHome(item.id),
      }, [el('span.hi-label', { text: item.label }), desc]));
    }
    root.appendChild(menu);
    homeStatsNode = el('p.home-stats', { id: 'home-stats' });
    root.appendChild(homeStatsNode);
  }

  /** 启动页的入口。设置和关于在标题页上，三款游戏共用一份，这里不再各放一个 */
  function handleHome(go) {
    if (go === 'play') { openNewGameDialog(); return; }
    if (go === 'bank') { SD.Shell.openPage('题库', openBankPage); return; }
    if (go === 'daily') { calMonth = null; SD.Shell.openPage('每日挑战', openDailyPage); return; }
    if (go === 'mine') { openMinePage(); return; }
    if (go === 'learn') { SD.Shell.openPage('技巧教学', (root) => SD.Sudoku.learn.renderLearn(root)); return; }
  }

  function renderHome() {
    if (!homeStatsNode) return;
    const st = Store.stats();
    const d = Store.dailyStats();
    const parts = [];
    if (st.wins) parts.push('累计完成 ' + st.wins + ' 局');
    parts.push(d.done ? '今日已完成' : '今日挑战待完成');
    if (d.streak) parts.push('连续 ' + d.streak + ' 天');
    homeStatsNode.textContent = parts.join(' · ');
    if (dailyDescNode) {
      dailyDescNode.textContent = d.done
        ? '今天做完了（' + B.formatDuration(d.record.timeMs) + '），可以再来一局'
        : '同一天全世界同一道题 · 连续 ' + d.streak + ' 天';
    }
  }

  /* ---------------- 对局页骨架 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', { id: 'status-strip' }, [
      el('div.stat', null, [
        el('span.stat-label', { id: 'stat-difficulty-label', text: '难度' }),
        el('b', { id: 'stat-difficulty', text: '—' }),
      ]),
      el('div.stat', null, [el('span.stat-label', { text: '用时' }), el('b.mono', { id: 'stat-timer', text: '00:00' })]),
      el('div.stat', null, [el('span.stat-label', { text: '提示' }), el('b', { id: 'stat-hints', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '错误' }), el('b', { id: 'stat-mistakes', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '空格' }), el('b', { id: 'stat-empty', text: '0' })]),
    ]);

    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [
        el('button.btn', { id: 'btn-undo', title: '撤销 (Ctrl+Z)', text: '撤销' }),
        el('button.btn', { id: 'btn-redo', title: '重做 (Ctrl+Y)', text: '重做' }),
      ],
    }));

    const pad = el('div.number-pad', { id: 'number-pad' });
    for (let d = 1; d <= 9; d++) {
      pad.appendChild(el('button.np-digit', { dataset: { digit: String(d) } }, el('span', { text: String(d) })));
    }
    pad.appendChild(el('button.np-erase', { dataset: { digit: '0' }, title: '擦除 (Delete / 空格)' }, '⌫'));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-notes', title: '铅笔标记 (N)' }, [el('span.tool-ico', { text: '✎' }), ' 笔记']),
      el('button.btn', { id: 'btn-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-check', title: '检查 (C)' }, [el('span.tool-ico', { text: '✓' }), ' 检查']),
      el('button.btn', { id: 'btn-auto-notes', title: '按当前盘面重算所有铅笔标记', text: '一键笔记' }),
      el('button.btn.btn-warn', { id: 'btn-solve' }, [el('span.tool-ico', { text: '⚡' }), ' 自动求解']),
      el('button.btn', { id: 'btn-learn', title: '技巧教学' }, [el('span.tool-ico', { text: '📖' }), ' 技巧教学']),
    ]);

    const hintArea = el('aside.hint-area', { id: 'hint-area', hidden: true }, [
      el('header.hint-head', null, [
        el('b', { text: '提示' }),
        el('div.hint-head-actions', null, [
          el('label.field.field-inline', null, [
            el('span', { text: '等级上限' }),
            el('select', { id: 'hint-level' }),
          ]),
          el('button.btn.btn-icon', { id: 'btn-hint-close', title: '收起提示', text: '✕' }),
        ]),
      ]),
      el('div.hint-output', { id: 'hint-output' }),
      el('div.hint-actions', null, [
        el('button.btn', { id: 'btn-hint-show', text: '只讲解' }),
        el('button.btn.btn-primary', { id: 'btn-hint-apply', text: '讲解并执行' }),
        el('button.btn', { id: 'btn-hint-auto', text: '自动做完' }),
      ]),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.board-wrap', null, el('div', { id: 'board-mount' })),
        pad,
        tools,
      ]),
      hintArea,
    ]));
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    if (!game || !view) return;
    const st = game.state;
    const s = Store.settings();
    view.render(st.board, {
      selected: st.selected,
      highlight: s.highlight,
      highlightSame: s.highlightSame,
      highlightPeer: s.highlightPeer,
      conflicts: game.conflicts(),
      wrong: game.wrongCells(),
      hint: st.hint && st.hint.step ? st.hint.step : null,
      hintPlaced: st.hint ? st.hint.placedCells : null,
    });
    // 笔记态下把选中格已有的笔记点亮在数字键盘上
    const noteMask = st.noteMode && st.selected >= 0 ? st.board.notes[st.selected] : 0;
    view.renderPad(st.board, noteMask);
    renderStatus();
    $('#btn-undo').disabled = !st.history.length;
    $('#btn-redo').disabled = !st.future.length;
    $('#btn-notes').classList.toggle('is-on', st.noteMode);
    // 面板开着时跟着盘面重算解说。原先只在走提示按钮时才刷新，
    // 于是玩家自己填了一个数，讲解还停在上一步、结论指向已经填满的格子。
    // 关着面板时不重算，免得白白遍历一遍所有技巧。
    if ($('#hint-area') && !$('#hint-area').hidden) renderHintPanel();
  }

  function renderStatus() {
    if (!game) return;
    const st = game.state;
    const meta = st.meta || {};
    // 每日挑战把日期顶到状态栏第一格：标题写「每日挑战」已经够说明了，
    // 这里补上具体是哪天，免得跟别的日期看混
    const isDaily = !!meta.dailyKey;
    $('#stat-difficulty-label').textContent = isDaily ? '今日' : '难度';
    $('#stat-difficulty').textContent = isDaily ? meta.dailyKey.slice(6) : (meta.difficultyName || '自定义');
    $('#stat-timer').textContent = B.formatDuration(game.elapsedMs());
    $('#stat-hints').textContent = String(st.hints);
    $('#stat-mistakes').textContent = String(st.mistakes);
    let empty = 0;
    for (let i = 0; i < 81; i++) if (!st.board.grid[i]) empty++;
    $('#stat-empty').textContent = String(empty);
  }

  /** 提示等级下拉的选项来自设置面板的同一份清单，避免两处各写一遍 */
  function fillHintLevels(current) {
    const sel = $('#hint-level');
    if (!sel) return;
    sel.innerHTML = '';
    for (const h of SD.Sudoku.settings.HINT_LEVELS) {
      const o = document.createElement('option');
      o.value = String(h.value);
      o.textContent = h.label;
      sel.appendChild(o);
    }
    sel.value = String(current || 3);
  }

  /** 重算提示列表。盘面一变就必须重来，因为可用解法也跟着变 */
  function refreshHints() {
    const level = Number($('#hint-level').value) || 5;
    hintList = game.hintList(level);
    if (hintIndex >= hintList.length) hintIndex = Math.max(0, hintList.length - 1);
  }

  function renderHintPanel() {
    // 每次都重算：盘面随时会变，列表必须跟着变，否则面板上留的是过期的解法
    refreshHints();
    SD.Sudoku.panels.renderHint($('#hint-output'), { list: hintList, index: hintIndex });
  }

  /** 切到某一条解法：只在盘面上预演高亮，不落子 */
  function selectHint(i) {
    if (i < 0 || i >= hintList.length) return;
    hintIndex = i;
    game.applyStep(hintList[i], false);
    render();
    renderHintPanel();
  }

  function renderAllPanels() {
    renderHintPanel();
  }

  /* ---------------- 提示区展开 / 收起 ---------------- */
  /**
   * 手机上提示是一块从盘面下方升起的面板：棋盘大小和位置不动，
   * 面板顶边贴在棋盘下沿，盖住数字键盘与功能栏。
   * 这样讲解和盘面能同时看见——讲解里写【R2C8】，抬头就能找到是哪一格。
   */
  function setHintOpen(open) {
    const area = $('#hint-area');
    if (!area) return;
    document.documentElement.style.setProperty('--sheet-top', measureSheetTop());
    area.hidden = !open;
    document.querySelector('.layout').classList.toggle('is-split', open);
    if (open) renderHintPanel();
  }

  /** 面板顶边 = 棋盘下沿 + 一点缝；屏幕太矮时留至少 38% 给讲解 */
  function measureSheetTop() {
    const board = document.querySelector('.board-wrap');
    if (!board) return '50vh';
    const bottom = board.getBoundingClientRect().bottom + 8;
    // 顶边不越过屏幕 70%：再高就盖住棋盘最后两行，讲解里的坐标对不上格子了
    const cap = window.innerHeight * 0.7;
    return Math.round(Math.min(bottom, cap)) + 'px';
  }

  /** 技巧教学原先挤在侧栏标签里，现在点按钮弹出来，不占棋盘的横向空间 */
  function openLearnModal() {
    const body = el('div.learn-modal');
    const library = el('div.tech-library');
    body.appendChild(el('div.learn-intro', { text: '当前局面可用的技巧排在最前。点任意一条，就在那一条下面展开演示盘面和讲解。' }));
    body.appendChild(library);
    const draw = () => {
      SD.Sudoku.panels.renderTechIndex(library, game.state.board.grid, openTech);
    };
    library.addEventListener('techpick', (e) => {
      openTech = e.detail;
      draw();
    });
    draw();
    return modal({ title: '技巧教学', body, footer: [{ label: '关闭' }] });
  }

  /* ---------------- 遮罩 ----------------
   * 遮罩归壳管：全局只有一个，铺满整屏。
   * 原先每个视图各一个，出题途中切视图就会收错节点、灰幕留在屏幕上点不掉。
   */
  const showOverlay = (title, sub) => SD.Shell.overlay(title, sub);
  const hideOverlay = () => SD.Shell.hideOverlay();
  const overlayProgress = (p) => SD.Shell.overlayProgress(p);

  /* ---------------- 对局启动 ---------------- */
  async function newGame(difficultyId, seed) {
    const cfg = SD.Generator.DIFFICULTY[difficultyId] || SD.Generator.DIFFICULTY.medium;
    const my = session;
    preparing++;   // 已经明确要开这一局了，后台那次备局作废
    showOverlay('正在出题…', '按目标难度挖洞并校验可解性，通常一两秒。');
    try {
      const gen = await SD.Generator.generate(difficultyId, seed, overlayProgress);
      if (my !== session) return;
      startWith(gen.givens, {
        difficulty: gen.difficulty,
        difficultyName: gen.difficultyName,
        rating: gen.rating,
        clueCount: gen.clueCount,
        level: gen.level,
        seed: gen.seed,
        title: cfg.name + ' · ' + gen.clueCount + ' 个线索',
      }, gen.solution);
      hideOverlay();
    } catch (e) {
      if (my !== session) return;
      hideOverlay();
      toast('出题失败：' + e.message, 'err');
    }
  }

  /**
   * 填错超过上限后的选择：再给一次机会，或者同难度直接换一局。
   * 两种都不惩罚——数独是练习工具，卡死不如重来。
   */
  function askAfterMistakes() {
    if (mistakeAsked || game.state.won) return;
    mistakeAsked = true;
    const diff = game.state.meta.difficulty || 'medium';
    const limit = game.mistakeLimit;
    const body = el('p.lead', {
      text: '已经填错 ' + game.state.mistakes + ' 次（上限 ' + limit + '）。'
    });
    body.appendChild(el('p.lead', {
      text: '错过的格子已经用红色标出来了，可以点「检查」逐个改，也可以直接换一局重来。',
    }));
    modal({
      title: '错得有点多了',
      body: body,
      footer: [
        {
          label: '同难度换一局',
          primary: true,
          onClick: () => {
            mistakeAsked = false;
            newGame(diff);
          },
        },
        {
          label: '再给一次机会',
          onClick: () => {
            mistakeAsked = false;
            toast('继续加油，错了的格子标红');
          },
        },
      ],
    });
  }

  /**
   * 开一局。keepView 为真时留在当前视图，后台备局时用它避免把人拽走。
   */
  function startWith(givens, meta, solution, keepView) {
    preparing++;
    game.start(givens, meta, solution);
    game.clearHint();
    // 入口可能从首页发起，不切视图就等于点了没反应
    if (!keepView) SD.Shell.showView('game');
    render();
    renderAllPanels();
    scheduleSave();
  }

  const scheduleSave = U.debounce(() => {
    const st = game.state;
    Store.saveGame({
      givens: B.gridToString(st.givens || st.board.givens),
      grid: B.gridToString(st.board.grid),
      notes: Array.from(st.board.notes),
      meta: st.meta,
      hints: st.hints,
      mistakes: st.mistakes,
      elapsed: game.elapsedMs(),
      techniques: st.techniques,
      // 题面来源指纹。指纹由生成器自己算出——改了生成逻辑它就变，
      // 旧存档自动作废，不需要谁记得同步改版本号。
      genStamp: Store.generatorStamp(),
    });
    if (st.meta.dailyKey && !st.won) {
      let filled = 0;
      for (let i = 0; i < 81; i++) if (st.board.grid[i]) filled++;
      Store.recordDailyProgress(st.meta.dailyKey, filled, 81);
    }
  }, 400);

  /* ---------------- 新局对话框 ---------------- */
  const DIFF_DESC = {
    easy: '只需唯一余数，适合入门与休息',
    medium: '会用到区块摒除与数对',
    hard: '开始需要三数组、X-Wing 等技巧',
    expert: '通常要三链列或唯一矩形',
    master: '顶级技巧，或必须动用反证',
  };

  function openNewGameDialog() {
    const grid = el('div.difficulty-grid');
    for (const id of SD.Generator.DIFFICULTY_ORDER) {
      const d = SD.Generator.DIFFICULTY[id];
      grid.appendChild(
        el('button.diff-btn', { onclick: () => { m.close(); newGame(id); } }, [
          el('div.diff-stars', { text: '★'.repeat(d.star) + '☆'.repeat(5 - d.star) }),
          el('div.diff-name', { text: d.name }),
          el('div.diff-desc', { text: DIFF_DESC[id] || '' }),
        ])
      );
    }

    const m = modal({
      title: '新建对局',
      body: [
        el('p', { text: '选一个难度。系统会挖洞到指定线索数，再用人类技巧验算「可解且唯一」，并按实际需要的技巧等级评级——出题不会给你一道需要瞎猜的题。' }),
        grid,
      ],
      footer: [{ label: '取消' }],
    });
  }

  function dailyChallenge(seed) {
    const my = session;
    showOverlay('正在生成每日挑战…', '同一天全球拿到的是同一道题。');
    setTimeout(() => {
      if (my !== session) return;
      // 等级在 L2~L3 之间按日期定，纯同步但比普通出题慢一些。
      // 放在 setTimeout 里是为了先让遮罩画出来，不然会像卡住不动。
      let gen = null;
      try {
        gen = SD.Generator.generateDailySync(seed);
      } catch (e) {
        hideOverlay();
        toast('每日挑战出题失败：' + e.message, 'err');
        return;
      }
      hideOverlay();
      startWith(gen.givens, {
        difficulty: gen.difficulty,
        difficultyName: '每日挑战',
        rating: gen.rating,
        clueCount: gen.clueCount,
        seed: seed,
        dailyKey: seed,
        title: '每日挑战 · ' + seed.slice(6),
      }, gen.solution);
    }, 30);
  }

  /* ---------------- 「我的」页 ---------------- */
  /** 战绩与图鉴都是自己的积累，合成一页用标签切换 */
  function openMinePage() {
    SD.Shell.openPage('我的', (root) => {
      let tab = 'stats';
      const bar = el('div.tabbar');
      const body = el('div.tab-body');
      const tabs = [
        { id: 'stats', label: '战绩', render: (r) => SD.Sudoku.data.renderData(r, { game: game, applyImported: applyImported }) },
        { id: 'cards', label: '图鉴', render: (r) => SD.Sudoku.gacha.renderLibrary(r) },
      ];
      const draw = () => {
        clear(bar);
        for (const t of tabs) {
          bar.appendChild(el('button.tab' + (tab === t.id ? '.is-on' : ''), {
            text: t.label,
            onclick: () => { tab = t.id; draw(); },
          }));
        }
        clear(body);
        tabs.find((t) => t.id === tab).render(body);
      };
      draw();
      root.appendChild(bar);
      root.appendChild(body);
    });
  }

  /* ---------------- 题库页 ---------------- */
  /**
   * 补位出题。已经出现在待做队列、玩家自己题库、每日挑战里的题面一律跳过——
   * 用题面字符串做指纹，比按标题去重可靠得多。
   */
  function refillQueue(diff) {
    if (!diff || !SD.Generator.DIFFICULTY[diff]) return;
    // 题全部在本地现生成，不再从预生成题库里抽。
    // 那个 5000 道题库实测 95% 是唯一余数法，当不了分级依据；
    // 而玩家真正要的「做一题就存下来」由本地的我的题库承担。
    const gen = () => {
      const g = SD.Generator.generateSync(diff, null);
      return { grid: B.gridToString(g.givens), clues: g.clueCount, level: g.level };
    };
    Store.refillQueue(diff, QUEUE_KEEP, gen);
    return Store.queueOf(diff).length;
  }

  /**
   * 每日挑战的题面记进已用指纹，免得玩家今天做过的那道明天又在队列里出现。
   * 只在开题库页时算一次：放在每次补位里会反复重算每日挑战，
   * 大师档一秒一道，补五档位要多等好几秒。
   */
  function noteDailyGrid() {
    if (dailyNoted) return;
    dailyNoted = true;
    try {
      const g = SD.Generator.generateDailySync(SD.Generator.dailySeed());
      Store.noteGridUsed(B.gridToString(g.givens));
    } catch (e) {
      // 记指纹只是去重优化，出不来也不该拦住玩家做题
    }
  }

  function playQueueItem(item) {
    startWith(B.stringToGrid(item.grid), {
      difficulty: item.diff,
      difficultyName: SD.Generator.DIFFICULTY[item.diff].name,
      clueCount: item.clues,
      title: SD.Generator.DIFFICULTY[item.diff].name + ' · 待做题',
      queueId: item.id,
    });
  }

  function openBankPage(root) {
    noteDailyGrid();
    root.appendChild(el('p.lead', { text: '题目都由本机现出：做过的自动存进「我的题库」，也可以从照片把题读进来。' }));
    root.appendChild(el('h3.sec-title', { text: '从图片添加' }));
    const ocrBox = el('div.ocr-box');
    root.appendChild(ocrBox);
    root.appendChild(el('h3.sec-title', { text: '正在做' }));
    root.appendChild(el('p.lead', { text: '每档留 ' + QUEUE_KEEP + ' 个空位，点「开始」才现出一道题；做完一个自动补上一个。' }));
    const queueBox = el('div.bank-list');
    root.appendChild(queueBox);

    root.appendChild(el('h3.sec-title', { text: '做过的题' }));
    root.appendChild(el('p.lead', { text: '通关的题目会自动留在这里，随时可以重做；不想要了可以删。' }));
    const mine = el('div.bank-list');
    root.appendChild(mine);

    SD.Sudoku.ocr.mount(ocrBox, {
      applyImported: applyImported,
      onSave: (grid, report) => {
        const n = mine.querySelectorAll('.bank-item').length + 1;
        Store.addUserPuzzle(grid, '我的题目 ' + n, report.classification.name);
        drawMine();
        toast('已存进我的题库', 'ok');
      },
    });

    /** 迷你棋盘缩略图：一眼看出这道题长什么样，比光一行字强 */
    function thumb(grid) {
      const box = el('div.mini-board');
      const g = B.stringToGrid(grid);
      for (let i = 0; i < B.CELL_COUNT; i++) {
        let cls = 'mcell';
        if (B.COL_OF[i] === 2 || B.COL_OF[i] === 5) cls += '.mc';
        if (B.ROW_OF[i] === 2 || B.ROW_OF[i] === 5) cls += '.mr';
        box.appendChild(el('div.' + cls, { text: g[i] ? String(g[i]) : '' }));
      }
      return box;
    }

    function drawMine() {
      clear(mine);
      const saved = Store.userBank();
      if (!saved.length) {
        mine.appendChild(el('p.lead', { text: '做完的题会自动留在这里，想重做随时点开。' }));
        return;
      }
      for (const p of saved) {
        const clues = p.grid.replace(/\./g, '').length;
        mine.appendChild(
          el('div.bank-item.is-mine', null, [
            thumb(p.grid),
            el('div.bi-main', null, [
              el('b.bi-name', { text: p.band || '自定义' }),
              el('span.bi-band', { text: clues + ' 个线索' }),
              p.times > 1 ? el('span.bi-warn', { text: '做过 ' + p.times + ' 遍' }) : null,
            ]),
            el('div.bi-row', null, [
              el('button.btn.btn-primary', { text: '开始', onclick: () => playUserPuzzle(p) }),
              el('button.btn', {
                text: '删除',
                onclick: () => { Store.removeUserPuzzle(p.id); drawMine(); },
              }),
            ]),
          ])
        );
      }
    }

    /**
     * 正在做的局。只列真正开过的那几档——五档各能留一局，
     * 但没必要把没开过的档也摆出来占地方。新建一局才往这里加一条。
     */
    function drawQueue() {
      clear(queueBox);
      let any = false;
      for (const diff of SD.Generator.DIFFICULTY_ORDER) {
        const cfg = SD.Generator.DIFFICULTY[diff];
        const items = Store.queueOf(diff);
        if (!items.length) continue;
        any = true;
        const item = items[0];
        queueBox.appendChild(
          el('div.bank-item.is-queue', null, [
            el('div.bi-main', null, [
              el('b.bi-name', { text: cfg.name }),
              el('span.bi-band', { text: item.clues + ' 个线索 · 在做' }),
            ]),
            el('div.bi-row', null, [
              el('button.btn.btn-primary', { text: '继续', onclick: () => playQueueItem(item) }),
              el('button.btn', {
                text: '换一题',
                onclick: () => {
                  Store.removeQueueItem(item.id);
                  refillQueue(diff);
                  drawQueue();
                },
              }),
            ]),
          ])
        );
      }
      if (!any) {
        queueBox.appendChild(el('p.lead', { text: '还没有正在做的局。上面开一局，或回到首页按难度出题。' }));
      }
    }
    drawMine();
    drawQueue();
  }

  function playUserPuzzle(p) {
    if (applyImported(p.grid, null, { source: '我的题库' })) {
      game.state.meta.title = p.name;
      render();
      SD.Shell.showView('game');
    }
  }

  /* ---------------- 每日挑战日历 ---------------- */
  let calMonth = null;   // null 表示跟随当前月

  const monthKey = (d) => d.getFullYear() + '-' + B.pad2(d.getMonth() + 1);

  function openDailyPage(root) {
    const stats = Store.dailyStats();

    const summary = el('div.daily-stats');
    const add = (label, value, hint) =>
      summary.appendChild(el('div.daily-stat', null, [
        el('span.ds-label', { text: label }),
        el('b.ds-value', { text: value }),
        hint ? el('small', { text: hint }) : null,
      ]));
    add('今日', stats.date, '同一天全世界同一道题');
    add('连续', stats.streak + ' 天', stats.streak >= 3 ? '保持住' : '连续完成会自动累计');
    add('最好成绩', stats.bestTimeMs ? B.formatDuration(stats.bestTimeMs) : '—', '共完成 ' + stats.total + ' 天');
    root.appendChild(summary);
    const today = new Date();
    const cursor = calMonth
      ? new Date(calMonth + '-01T00:00:00')
      : new Date(today.getFullYear(), today.getMonth(), 1);

    const head = el('div.cal-head', null, [
      el('button.btn.btn-icon', {
        text: '‹',
        title: '上个月',
        onclick: () => { calMonth = shiftMonth(cursor, -1); SD.Shell.openPage('每日挑战', openDailyPage); },
      }),
      el('b.cal-title', { text: cursor.getFullYear() + ' 年 ' + (cursor.getMonth() + 1) + ' 月' }),
      el('button.btn.btn-icon', {
        text: '›',
        title: '下个月',
        onclick: () => { calMonth = shiftMonth(cursor, 1); SD.Shell.openPage('每日挑战', openDailyPage); },
      }),
    ]);
    root.appendChild(head);

    const grid = el('div.cal-grid');
    for (const w of ['日', '一', '二', '三', '四', '五', '六']) grid.appendChild(el('div.cal-wd', { text: w }));

    // 先补上前一个月的尾巴，让每一行都从周日开始
    const lead = cursor.getDay();
    for (let i = lead - 1; i >= 0; i--) {
      grid.appendChild(calCell(new Date(cursor.getFullYear(), cursor.getMonth(), -i), today));
    }
    const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      grid.appendChild(calCell(new Date(cursor.getFullYear(), cursor.getMonth(), i), today));
    }
    const tail = (7 - ((lead + days) % 7)) % 7;
    for (let i = 1; i <= tail; i++) {
      grid.appendChild(calCell(new Date(cursor.getFullYear(), cursor.getMonth(), days + i), today));
    }
    root.appendChild(grid);

    root.appendChild(el('p.foot-note', { text: '🏆 已完成 · 环的长度与底色深浅都是完成进度 · 空白是还没开始' }));
    root.appendChild(
      el('div.btn-row', null, [
        el('button.btn.btn-primary', {
          text: stats.done ? '今天已完成，再玩一次' : '开始今天的挑战',
          onclick: () => dailyChallenge(SD.Generator.dailySeed()),
        }),
      ])
    );
  }

  function shiftMonth(d, delta) {
    return monthKey(new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  /** 一天一格：完成了盖奖杯，做了一半画进度环，没碰过就干干净净 */
  function calCell(d, today) {
    const key = SD.Generator.dailySeed(d);
    const rec = Store.stats().daily[key];
    const won = !!(rec && rec.won);
    const filled = rec ? rec.filled || 0 : 0;
    const total = rec && rec.total ? rec.total : 81;
    const ratio = won ? 1 : Math.max(0, Math.min(1, filled / total));
    const isToday = key === SD.Generator.dailySeed(today);
    const future = d.getTime() > today.getTime() + 86400000;

    // el() 的类名语法是 div.card.is-on，类之间用点号而不是空格
    let cls = 'button.cal-day';
    if (isToday) cls += '.is-today';
    if (ratio > 0) cls += '.has-ring';
    if (won) cls += '.is-won';
    if (future) cls += '.is-future';

    return el(cls, {
      style: ratio > 0
        ? { '--p': Math.round(ratio * 100) + '%', background: 'color-mix(in srgb, var(--accent) ' + Math.round(ratio * 22) + '%, var(--surface))' }
        : null,
      title: won ? '已完成' : ratio > 0 ? '已完成 ' + Math.round(ratio * 100) + '%' : '',
      onclick: won || future ? null : () => dailyChallenge(SD.Generator.dailySeed(d)),
    }, [
      el('span.cal-num', { text: String(d.getDate()) }),
      won ? el('span.cal-trophy', { text: '🏆' }) : null,
    ]);
  }

  /* ---------------- 题面导入 ---------------- */
  function applyImported(text, json, extra) {
    const g = B.stringToGrid(text);
    const report = SD.Generator.inspect(g);
    modal({
      title: report.valid ? '题面体检通过' : '题面体检未通过',
      body: [
        el('div.notice.' + (report.valid ? 'notice-ok' : 'notice-err'), { text: report.reason }),
        el('div.kv', null, [el('span', { text: '线索数量' }), el('b', { text: report.clueCount })]),
        report.conflicts ? el('div.kv', null, [el('span', { text: '冲突格数' }), el('b', { text: report.conflicts })]) : null,
        report.valid
          ? el('div.kv', null, [
              el('span', { text: '实测难度' }),
              el('b', { text: report.classification.name + '（' + report.classification.star + ' 星）' }),
            ])
          : null,
        report.valid
          ? el('p', { text: '难度是按「人类最少需要用到哪一级技巧」算出来的，不是按线索多少猜的。' })
          : el('p', { text: '这道题必须修正后才能载入。数独要求 9 行 9 列 9 宫各出现一次 1–9，且解必须唯一。' }),
      ],
      footer: report.valid
        ? [{ label: '取消' }, { label: '载入', primary: true, onClick: () => loadImported(g, report, extra) }]
        : [{ label: '知道了' }],
    });
    return report;
  }

  function loadImported(g, report, extra) {
    startWith(g, {
      difficulty: 'custom',
      difficultyName: (extra && extra.source) || '导入',
      rating: null,
      clueCount: report.clueCount,
      level: report.classification ? report.classification.level : 0,
      title: ((extra && extra.source) || '导入题') + ' · ' + report.clueCount + ' 线索',
    }, report.solution);
    if (game.state.solution) game.state.board.locked.fill(0);
  }

  /* ---------------- 胜利结算 ---------------- */
  function onWin() {
    const st = game.state;
    const timeMs = game.elapsedMs();
    Store.recordGame({
      won: true,
      timeMs: timeMs,
      hints: st.hints,
      mistakes: st.mistakes,
      difficulty: st.meta.difficulty || 'custom',
      techniques: st.techniques,
      dailyKey: st.meta.dailyKey,
      grid: B.gridToString(st.givens || st.board.givens),
      difficultyName: st.meta.difficultyName,
    });
    scheduleSave();
    // 待做队列：做完一道立刻补一道，玩家手上永远有 QUEUE_KEEP 道可打。
    // 出题是同步的，最多一两秒，这里已经过了结算弹窗的时机。
    if (st.meta.queueId) {
      Store.finishQueueItem(st.meta.queueId);
      refillQueue(st.meta.difficulty);
    }
    render();
    renderAllPanels();
    renderHome();

    const pts = SD.Points.awardWin('sudoku', {
      difficulty: st.meta.difficulty || 'custom',
      difficultyName: st.meta.difficultyName,
      dailyKey: st.meta.dailyKey,
    });

    const used = {};
    for (const id of st.techniques) used[id] = (used[id] || 0) + 1;
    const rows = Object.keys(used)
      .sort((a, b) => used[b] - used[a])
      .map((id) => {
        const t = SD.Techniques.byId[id];
        return el('div.kv', null, [el('span', { text: t ? t.name : id }), el('b', { text: used[id] + ' 次' })]);
      });

    modal({
      title: '🎉 完成！',
      body: [
        el('div.result-grid', null, [
          el('div.result-tile', null, [el('div.rt-val', { text: B.formatDuration(timeMs) }), el('div.rt-label', { text: '用时' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(st.hints) }), el('div.rt-label', { text: '提示' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(st.mistakes) }), el('div.rt-label', { text: '错误' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(game.conflicts().size) }), el('div.rt-label', { text: '冲突' })]),
        ]),
        pts ? el('p.points-gain', { text: '+' + pts + ' 通关点数，累计 ' + SD.Points.total() }) : null,
        el('div.card', { style: { marginTop: '14px' } }, [el('h3', { text: '你用到的技巧' }), rows.length ? rows : el('p', { text: '全程自己推，没有用提示——这局是纯实力。' })]),
      ],
      footer: [
        { label: '看看复盘', onClick: openLearnModal },
        { label: '再来一局', primary: true, onClick: () => newGame(Store.settings().lastDifficulty) },
      ],
    });
  }

  /* ---------------- 事件 ---------------- */
  /** 讲解里的【R2C6】指到哪一格，棋盘就点亮哪一格；触屏没有 hover，用长按代替 */
  function bindHintRefs() {
    const out = $('#hint-output');
    if (!out) return;
    const of = (e) => {
      const node = e.target.closest ? e.target.closest('.ref') : null;
      return node ? [Number(node.dataset.cell)] : [];
    };
    out.addEventListener('mouseover', (e) => view.setRefs(of(e)));
    out.addEventListener('mouseleave', () => view.setRefs([]));
    let press = null;
    out.addEventListener('touchstart', (e) => {
      const cells = of(e);
      if (!cells.length) return;
      press = setTimeout(() => { view.setRefs(cells); press = null; }, 380);
    }, { passive: true });
    const end = () => {
      if (press) clearTimeout(press);
      press = null;
      view.setRefs([]);
    };
    out.addEventListener('touchend', end, { passive: true });
    out.addEventListener('touchcancel', end, { passive: true });
  }

  let docBound = false;
  /** 文档级监听只绑一次。每次进游戏都绑的话，切几次游戏就会重复触发几遍。 */
  function bindDocument() {
    if (docBound) return;
    docBound = true;
    document.addEventListener('hintpick', (e) => selectHint(e.detail));
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => {
      if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
      if (document.documentElement.getAttribute('data-tab') === 'image') SD.Sudoku.ocr.drawStage();
      // 面板顶边是量出来的，转屏或改窗口后要重新贴一次
      const area = $('#hint-area');
      if (area && !area.hidden) setHintOpen(true);
    }, 200));
  }

  /** 对局页的按钮每次进游戏都要重绑：DOM 是刚建的，旧节点已经扔掉了 */
  function bindPlay() {
    $('#btn-undo').addEventListener('click', () => { game.undo(); render(); scheduleSave(); });
    $('#btn-redo').addEventListener('click', () => { game.redo(); render(); scheduleSave(); });
    $('#btn-notes').addEventListener('click', () => { game.setNoteMode(); render(); });
    $('#btn-hint').addEventListener('click', () => { setHintOpen(true); doHint(false); });
    $('#btn-hint-close').addEventListener('click', () => setHintOpen(false));
    $('#btn-learn').addEventListener('click', openLearnModal);
    $('#btn-check').addEventListener('click', checkBoard);
    $('#btn-auto-notes').addEventListener('click', () => {
      // 一次性动作：按当前盘面把所有格子的候选数铺一遍，而不是开关
      const n = game.state.board.rebuildNotes();
      render();
      scheduleSave();
      toast(n ? '已按当前盘面标记 ' + n + ' 格的候选数' : '当前盘面没有可标记的候选');
    });
    $('#btn-solve').addEventListener('click', autoSolve);

    $('#btn-hint-show').addEventListener('click', () => doHint(false));
    $('#btn-hint-apply').addEventListener('click', () => doHint(true));
    $('#btn-hint-auto').addEventListener('click', autoSolve);

    $('#hint-level').addEventListener('change', (e) => {
      Store.set('defaultHintLevel', Number(e.target.value));
      hintIndex = 0;
      refreshHints();
      renderHintPanel();
    });

    $$('.np-digit, .np-erase').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = Number(btn.dataset.digit);
        if (d === 0) game.erase();
        else game.inputDigit(d);
        render();
        scheduleSave();
      });
    });

    bindHintRefs();
  }

  /** 只讲解 / 讲解并执行：都作用于面板上当前选中的那一条解法 */
  function doHint(apply) {
    refreshHints();
    setHintOpen(true);
    if (!hintList.length) {
      renderHintPanel();
      toast('当前局面没有可用解法了，试试调高「提示等级上限」', 'err');
      return;
    }
    const entry = hintList[hintIndex];
    const r = game.applyStep(entry, apply);
    if (r && r.explain.step && r.explain.step.cells && r.explain.step.cells.length) {
      game.select(r.explain.step.cells[0]);
    }
    render();
    if (apply) {
      // 落子之后盘面变了，可用解法也跟着变，回到第一条重新排
      hintIndex = 0;
      refreshHints();
      renderHintPanel();
      if (r && r.explain.step.cells && r.explain.step.cells.length) game.select(r.explain.step.cells[0]);
    } else {
      renderHintPanel();
    }
    render();
    scheduleSave();
  }

  function checkBoard() {
    const st = game.state;
    const conf = game.conflicts();
    const wrong = [];
    for (let i = 0; i < 81; i++) {
      const d = st.board.grid[i];
      if (d && !st.board.isGiven(i) && st.solution && st.solution[i] !== d) wrong.push(i);
    }
    if (conf.size) {
      toast('发现 ' + conf.size + ' 处冲突，已用红色标出', 'err');
      game.select(conf.keys().next().value);
    } else if (wrong.length) {
      toast('没有冲突，但有 ' + wrong.length + ' 格填错了（不告诉你位置，自己找）', 'err');
      st.wrongCells = new Set(wrong);
    } else {
      toast('目前没有发现错误', 'ok');
    }
    render();
  }

  function autoSolve() {
    const run = () => {
      const n = game.autoSolve();
      render();
      renderAllPanels();
      scheduleSave();
      const err = game.state.solveError;
      if (err) toast(err, 'err', 3600);
      else toast(n ? '已用人类技巧推完 ' + n + ' 步' : '已填满棋盘', 'ok');
    };
    if (Store.settings().confirmSolve) {
      confirm('自动求解', '会用人类技巧一步步把棋盘推完，无法推进时改用机器解。会记为一次提示。确定继续？', '求解').then((ok) => {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  function onKeyDown(e) {
    // 只有真的在对局页上才吃键。否则在标题页敲 m 会去切笔记模式，
    // 在别的游戏里敲数字会往数独盘里塞数字。
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const st = game.state;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) game.redo();
      else game.undo();
      render();
      scheduleSave();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      game.redo();
      render();
      scheduleSave();
      return;
    }

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      game.inputDigit(Number(e.key));
      render();
      scheduleSave();
      return;
    }

    switch (e.key) {
      case 'Backspace':
      case 'Delete':
      case ' ':
        e.preventDefault();
        game.erase();
        render();
        scheduleSave();
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        calMonth = null;
        SD.Shell.openPage('每日挑战', openDailyPage);
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        game.setNoteMode();
        render();
        break;
      case 'h':
      case 'H':
        e.preventDefault();
        doHint(false);
        break;
      case 'c':
      case 'C':
        e.preventDefault();
        checkBoard();
        break;
      case 'ArrowUp': case 'ArrowDown': case 'ArrowLeft': case 'ArrowRight': case 'Tab': {
        e.preventDefault();
        const cur = st.selected < 0 ? 40 : st.selected;
        let r = B.ROW_OF[cur];
        let c = B.COL_OF[cur];
        if (e.key === 'ArrowUp') r = (r + 8) % 9;
        else if (e.key === 'ArrowDown') r = (r + 1) % 9;
        else if (e.key === 'ArrowLeft') c = (c + 8) % 9;
        else if (e.key === 'ArrowRight' || e.key === 'Tab') c = (c + 1) % 9;
        game.select(r * 9 + c);
        render();
        const cell = view.cellAt(r * 9 + c);
        if (cell) cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        break;
      }
      default:
        break;
    }
  }

  /* ---------------- 进入 / 离开 ---------------- */
  /** 后台备一局。玩家可能还站在首页，不能因为「备好了」就把他拽进对局页。 */
  function prepareBackground() {
    const my = session;
    const token = ++preparing;
    SD.Generator.generate(Store.settings().lastDifficulty || 'medium', null, () => {}).then((gen) => {
      if (my !== session || token !== preparing) return;
      startWith(gen.givens, {
        difficulty: gen.difficulty,
        difficultyName: gen.difficultyName,
        rating: gen.rating,
        clueCount: gen.clueCount,
        level: gen.level,
        title: gen.difficultyName + ' · ' + gen.clueCount + ' 个线索',
      }, gen.solution, true);
    }, (e) => {
      if (my !== session || token !== preparing) return;
      toast('开局出题失败：' + e.message, 'err');
    });
  }

  function mount(nodes) {
    session++;
    buildHome(nodes.home);
    buildPlay(nodes.play);
    bindPlay();
    bindDocument();
    fillHintLevels(Store.settings().defaultHintLevel);

    // 棋盘渲染器和控制器各建一次。控制器持有对局状态，重新进游戏时要保住；
    // 渲染器只是往刚建的 DOM 上画，必须重建。
    view = SD.BoardView.create($('#board-mount'), {
      onSelect: (i) => { game.select(i); render(); },
    });
    if (!game) {
      game = SD.Sudoku.game.create({
        onChange: (kind) => {
          if (kind === 'win') onWin();
          else if (kind === 'mistakeLimit') askAfterMistakes();
          else if (kind === 'tick') renderStatus();
          // 落子、选择、撤销重做都要重绘：红字标记、冲突高亮都挂在盘面元素上，
          // 不重绘的话红标不会出现
          else render();
        },
        onTick: () => renderStatus(),
      });
    }

    renderHome();
    render();
    renderAllPanels();
    restoreOrPrepare();
  }

  /**
   * 恢复上次的对局；手上已经有局就不再读存档。
   * 不能每次都读：离开游戏再回来会整块重新挂载，此时若拿存档覆盖内存里的对局，
   * 撤销栈和计时都会平白丢掉——玩家只是去设置页转了一圈。
   */
  function restoreOrPrepare() {
    if (game.state.givens) { render(); return; }
    const saved = Store.loadGame();
    if (saved && saved.givens) {
      const g = B.stringToGrid(saved.givens);
      const report = SD.Generator.inspect(g);
      if (report.valid) {
        game.start(g, saved.meta || { difficultyName: '上次对局' }, report.solution);
        game.state.board.grid.set(B.stringToGrid(saved.grid || saved.givens));
        game.state.board.notes.set(Int32Array.from(saved.notes || []));
        game.state.hints = saved.hints || 0;
        game.state.mistakes = saved.mistakes || 0;
        game.state.elapsed = saved.elapsed || 0;
        game.pauseTimer();
        toast('已恢复上次的对局');
        render();
        return;
      }
    }
    if (!game.state.givens) prepareBackground();
  }

  function unmount() {
    // 令牌一变，还在路上的出题结果就会被丢掉，不会落到已经拆掉的页面上
    session++;
    if (game) game.pauseTimer();
    Store.flush();
  }

  /** 回到对局页时重画一次：在设置里改过高亮开关，盘面得跟着变 */
  function onShow() {
    renderHome();
    render();
    renderStatus();
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '出题不是随机的',
      p: [
        '随机出一道满盘，再逐个挖空。每挖掉一格都检查两件事：解还唯一吗？人类技巧还推得动吗？',
        '两条都满足才留下，所以不会出现「只能靠瞎猜」的题。难度按「人类最少需要用到哪一级技巧」评，不按线索个数猜。',
      ],
    },
    {
      h: '提示是真推理，不是报答案',
      p: [
        '收录 ' + SD.Techniques.LIST.length + ' 种人类解题技巧，从唯一余数一直到链式推理（反证法）。每种技巧都配了一个当场能触发的演示棋盘，对着图看比读文字快。',
        '面板会把此刻能用的解法一次列全并按等级排序，你可以自己挑下一步走哪条路，而不是只能按顺序接受。',
        '讲解里的坐标写成【R6C6】这种可点样式，鼠标停上去（或手机上长按）会在棋盘上把那一格点亮。',
      ],
    },
    {
      h: '图片识别的真实水平',
      p: [
        '流程是：局部对比度找暗线 → 连通域滤噪 → 凸包取最优四边形 → 单应变换校正透视 → 重新量一次网格线 → 逐格切图识别。',
        '干净扫描件实测 32/32 全对。手机翻拍的实物照片只能到三成左右，剩下的格子一律标黄等你确认。',
        '这是刻意的设计：低置信度的格子不会悄悄塞进棋盘。宁可让你多看一眼，也不要往盘里放错数字。导入前还会体检题面，重复数字和多解的题会被拦下来。',
        '拍不了平整的照片时，题库页有「手动填题」——照着一张模糊的图把数字敲进去，比对着图在纸上重抄一遍快。',
      ],
    },
    {
      h: '技术上的取舍',
      p: [
        '没有构建工具，没有 npm 依赖，全部是普通 script 标签——为的是双击就能玩、交付物自包含。',
        '候选数用 9 位掩码存，判断「某格能不能放 d」是一次位运算。OCR 引擎完全本地化，断网也能用。',
      ],
    },
    {
      h: '已知不足',
      p: [
        '难度评级偏保守，实测多数题落在 L1–L2，「困难」和「大师」的实际达成率不如预期。',
        '照片场景的网格复检在 JPEG 重压缩叠加透视重采样之后仍有残差。统计只存在本机，换设备不会同步。',
      ],
    },
  ];

  const def = {
    id: 'sudoku',
    name: '数独',
    tagline: '会出题、会讲解、会从图片里读题',
    icon: '9',
    brandSub: 'Sudoku Studio',
    accent: '#2f6fed',
    ready: true,
    mount: mount,
    unmount: unmount,
    onShow: onShow,
    statusLine: function () {
      const d = Store.dailyStats();
      if (!d.done) return '今日挑战待完成';
      const st = Store.stats();
      return st.wins ? '累计 ' + st.wins + ' 局' : null;
    },
    settings: (root, ctx) => SD.Sudoku.settings.render(root, ctx),
    resetSettings: () => Store.resetSettings(),
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  SD.Sudoku.app = {
    getGame: () => game,
    render: render,
    renderHome: renderHome,
    applyImported: applyImported,
    newGame: newGame,
    loadImported: loadImported,
    showView: SD.Shell.showView,
    openPage: SD.Shell.openPage,
    startWith: startWith,
    setHintOpen: setHintOpen,
  };
})(window);
