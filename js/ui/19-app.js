/* 数独 · 应用装配层
 * 把核心引擎、棋盘、控制器、面板连起来，并处理全局交互（快捷键、存档、胜利结算）。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const U = SD.UI;
  const { $, $$, el, clear, toast, modal, confirm } = U;

  let game = null;
  let view = null;
  let openTech = null;
  let hintList = [];   // 当前盘面所有可用解法，按等级从低到高
  let hintIndex = 0;  // 面板上正在看第几条
  let autoSave = null;

  /* ---------------- 主题 ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    SD.Store.set('theme', theme);
  }


  /** 提示等级下拉的选项来自设置面板的同一份清单，避免两处各写一遍 */
  function fillHintLevels(current) {
    const sel = $('#hint-level');
    sel.innerHTML = '';
    for (const h of SD.Settings.HINT_LEVELS) {
      const o = document.createElement('option');
      o.value = String(h.value);
      o.textContent = h.label;
      sel.appendChild(o);
    }
    sel.value = String(current || 3);
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    const st = game.state;
    const s = SD.Store.settings();
    view.render(st.board, {
      selected: st.selected,
      highlight: s.highlight,
      highlightSame: s.highlightSame,
      highlightPeer: s.highlightPeer,
      conflicts: game.conflicts(),
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
  }

  function renderStatus() {
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
    $('#puzzle-title').textContent = meta.title || meta.difficultyName || '自由练习';
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
    SD.Panels.renderHint($('#hint-output'), { list: hintList, index: hintIndex });
  }

  /** 切到某一条解法：只在盘面上预演高亮，不落子 */
  function selectHint(i) {
    if (i < 0 || i >= hintList.length) return;
    hintIndex = i;
    game.applyStep(hintList[i], false);
    render();
    renderHintPanel();
  }
  /** 设置面板的回调集合：两处调用共用，避免改了这里忘了另一处 */
  function settingsCtx() {
    return { rerender: render, applyTheme: applyTheme, fillHintLevels: fillHintLevels };
  }
  function renderAllPanels() {
    const st = game.state;
    U.$$('.panel').forEach((p) => {
      const key = p.dataset.panel;
      if (key === 'hint') renderHintPanel();
      else if (key === 'learn') {
        SD.Panels.renderAvailable($('#available-techniques'), st.board.grid);
        SD.Panels.renderLibrary($('#technique-library'), openTech);
      } else if (key === 'data') SD.Data.renderData($('#data-root'), { game: game, applyImported: applyImported });
      else if (key === 'image') SD.OCR.mount($('#ocr-root'), { applyImported: applyImported });
    });
  }

  /* ---------------- 对局启动 ---------------- */
  async function newGame(difficultyId, seed) {
    const cfg = SD.Generator.DIFFICULTY[difficultyId] || SD.Generator.DIFFICULTY.medium;
    showOverlay('正在出题…', '按目标难度挖洞并校验可解性，通常一两秒。');
    try {
      const gen = await SD.Generator.generate(difficultyId, seed, (p) => {
        const bar = overlayOf().querySelector('.progress i');
        if (bar) bar.style.width = Math.round(p * 100) + '%';
      });
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
      hideOverlay();
      toast('出题失败：' + e.message, 'err');
    }
  }

  /**
   * @param {boolean} keepView 保持当前视图。冷启动会先在后台备好一局，
   *   但玩家还站在首页，不能因为「备好了」就把他拽进游戏页。
   */
  function startWith(givens, meta, solution, keepView) {
    game.start(givens, meta, solution);
    game.clearHint();
    // 入口可能从首页发起，不切视图就等于点了没反应
    if (!keepView) showView('game');
    render();
    renderAllPanels();
    scheduleSave();
  }

  const scheduleSave = U.debounce(() => {
    const st = game.state;
    SD.Store.saveGame({
      givens: B.gridToString(st.givens || st.board.givens),
      grid: B.gridToString(st.board.grid),
      notes: Array.from(st.board.notes),
      meta: st.meta,
      hints: st.hints,
      mistakes: st.mistakes,
      elapsed: game.elapsedMs(),
      techniques: st.techniques,
    });
  }, 400);

  /* ---------------- 遮罩 ---------------- */
  // 遮罩要落在当前可见的那个视图上——从首页点「开始数独」时游戏页还没显示，
  // 盖在隐藏的棋盘上等于什么都没发生。
  const overlayOf = () => (document.documentElement.getAttribute('data-view') === 'home' ? $('#home-overlay') : $('#board-overlay'));

  function showOverlay(title, sub) {
    const ov = overlayOf();
    clear(ov);
    ov.hidden = false;
    ov.appendChild(el('div.ov-card', null, [
      el('div.ov-title', { text: title }),
      el('div.ov-sub', { text: sub || '' }),
      el('div.progress', null, el('i')),
    ]));
  }

  const hideOverlay = () => {
    const ov = overlayOf();
    ov.hidden = true;
    clear(ov);
  };

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

  /** 每日挑战入口：把战绩摊开摆给用户看，而不是只藏在数据面板里 */
  function openDailyDialog() {
    const d = SD.Store.dailyStats();
    const rec = d.record;
    const stats2 = el('div.daily-stats');
    const add = (label, value, hint) =>
      stats2.appendChild(el('div.daily-stat', null, [
        el('span.ds-label', { text: label }),
        el('b.ds-value', { text: value }),
        hint ? el('small', { text: hint }) : null,
      ]));

    add('今日', d.date, '所有人拿到的是同一道题');
    add('状态', d.done ? '已完成' : '待挑战', d.done ? '想再玩一遍可以直接重开' : '做完才算完成');
    if (d.done && rec.timeMs) add('今日用时', B.formatDuration(rec.timeMs), '提示 ' + rec.tries + ' 次');
    add('连续', d.streak + ' 天', d.streak >= 3 ? '保持住' : '连续完成会自动累计');
    add('最好成绩', d.bestTimeMs ? B.formatDuration(d.bestTimeMs) : '—', '共完成 ' + d.total + ' 天');

    const m = modal({
      title: '每日挑战',
      body: [
        el('p', { text: '题目由当天日期作种子生成——同一天全世界拿到的是同一道题，做完记一次成绩。' }),
        stats2,
      ],
      footer: [
        { label: '关闭' },
        {
          label: d.done ? '再玩一次' : '开始挑战',
          primary: true,
          onClick: () => {
            m.close();
            dailyChallenge(SD.Generator.dailySeed());
          },
        },
      ],
    });
  }
  function dailyChallenge(seed) {
    showOverlay('正在生成每日挑战…', '同一天全球拿到的是同一道题。');
    setTimeout(() => {
      SD.Generator.generate('medium', seed, () => {}).then((gen) => {
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
      }, (e) => {
        // 静默失败会让遮罩永远留在屏幕上，用户只看到点了一下没反应
        hideOverlay();
        toast('每日挑战出题失败：' + e.message, 'err');
      });
    }, 30);
  }

  /* ---------------- 视图切换 ---------------- */
  const VIEWS = ['home', 'game', 'page'];

  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'home';
    for (const v of VIEWS) {
      const node = $('#view-' + v);
      if (node) node.classList.toggle('is-active', v === name);
    }
    document.documentElement.setAttribute('data-view', name);
    if (name === 'game') {
      render();
      renderAllPanels();
    }
    if (name === 'home') renderHome();
    window.scrollTo(0, 0);
  }

  /** 整页：设置 / 关于 / 题库共用一个壳，只有标题和内容不同 */
  function openPage(title, render) {
    $('#page-title').textContent = title;
    const root = clear($('#page-root'));
    render(root);
    showView('page');
  }


  /** 启动页的五个入口。游戏页里没有这些按钮，所以这里是唯一的导航 */
  function handleHome(go) {
    if (go === 'play') { openNewGameDialog(); return; }
    if (go === 'bank') { openPage('题库', openBankPage); return; }
    if (go === 'daily') { openDailyDialog(); return; }
    if (go === 'settings') { openPage('设置', (root) => SD.Settings.renderSettings(root, settingsCtx())); return; }
    if (go === 'about') { openPage('关于', openAboutPage); return; }
  }
  /* ---------------- 启动页 ---------------- */
  function renderHome() {
    const st = SD.Store.stats();
    const d = SD.Store.dailyStats();
    const parts = [];
    if (st.wins) parts.push('累计完成 ' + st.wins + ' 局');
    parts.push(d.done ? '今日已完成' : '今日挑战待完成');
    if (d.streak) parts.push('连续 ' + d.streak + ' 天');
    $('#home-stats').textContent = parts.join(' · ');
    $('#home-daily-desc').textContent = d.done
      ? '今天做完了（' + B.formatDuration(d.record.timeMs) + '），可以再来一局'
      : '同一天全世界同一道题 · 连续 ' + d.streak + ' 天';
  }

  /* ---------------- 题库页 ---------------- */
  function openBankPage(root) {
    root.appendChild(el('p.lead', { text: '预先验过的固定题目，点一下就上盘，不用等出题。' }));
    const list = el('div.bank-list');
    for (const p of SD.Bank.LIST) {
      const info = SD.Bank.describe(p);
      list.appendChild(
        el('button.bank-item', {
          onclick: () => { playBank(p.id); },
        }, [
          el('div.bi-main', null, [
            el('b.bi-name', { text: p.name }),
            el('span.bi-band', { text: info.band }),
            info.needsGuess ? el('span.bi-warn', { text: '需试错' }) : null,
          ]),
          el('div.bi-meta', { text: info.clueCount + ' 个线索' }),
          el('div.bi-note', { text: p.note }),
        ])
      );
    }
    root.appendChild(list);
  }

  function playBank(id) {
    const p = SD.Bank.byId(id);
    if (!p) return;
    const info = SD.Bank.describe(p);
    const report = applyImported(p.grid, null, { source: '题库' });
    if (report) {
      game.state.meta.title = p.name;
      game.state.meta.difficultyName = info.band;
      render();
      showView('game');
    }
  }
  /* ---------------- 关于页 ---------------- */
  const ABOUT = [
    {
      h: '这是什么',
      p: [
        '一个纯前端的数独游戏。没有账号、没有服务器、没有埋点，所有数据只存在你自己的浏览器里。',
        '双击 index.html 就能玩；图片识别要用 Web Worker 读本地文件，受浏览器同源策略限制，需要用启动脚本起一个本地服务。',
      ],
    },
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
        '收录 13 种人类解题技巧，从唯一余数一直到链式推理（反证法）。每条提示都针对当前盘面逐步推导，讲清楚「为什么这一步成立」，并附上技巧原理与常见误区。',
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

  function openAboutPage(root) {
    for (const sec of ABOUT) {
      const card = el('div.card.about-card', null, el('h3', { text: sec.h }));
      for (const line of sec.p) card.appendChild(el('p', { text: line }));
      root.appendChild(card);
    }
    root.appendChild(
      el('p.foot-note', { text: '快捷键：N 换一题 · M 笔记 · H 提示 · C 检查 · D 每日挑战 · Ctrl+Z 撤销 · Ctrl+Y 重做' })
    );
  }
  function applyImported(text, json, extra) {
    const g = B.stringToGrid(text);
    const report = SD.Generator.inspect(g);
    const dlg = modal({
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
    SD.Store.recordGame({
      won: true,
      timeMs: timeMs,
      hints: st.hints,
      mistakes: st.mistakes,
      difficulty: st.meta.difficulty || 'custom',
      techniques: st.techniques,
      dailyKey: st.meta.dailyKey,
    });
    scheduleSave();
    render();
    renderAllPanels();

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
          el('div.result-tile', null, [el('div.rt-val', { text: String(game.conflicts().size) }), el('div.result-label', { text: '冲突' })]),
        ]),
        el('div.card', { style: { marginTop: '14px' } }, [el('h3', { text: '你用到的技巧' }), rows.length ? rows : el('p', { text: '全程自己推，没有用提示——这局是纯实力。' })]),
      ],
      footer: [
        { label: '看看复盘', onClick: () => switchTab('learn') },
        { label: '再来一局', primary: true, onClick: () => newGame(SD.Store.settings().lastDifficulty) },
      ],
    });
  }

  /* ---------------- 标签页 ---------------- */
  function switchTab(key) {
    U.$$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === key));
    U.$$('.panel').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === key));
    if (key === 'image') SD.OCR.drawStage();
    if (key === 'data') SD.Data.renderData($('#data-root'), { game: game, applyImported: applyImported });
    if (key === 'learn') {
      SD.Panels.renderAvailable($('#available-techniques'), game.state.board.grid);
      SD.Panels.renderLibrary($('#technique-library'), openTech);
    }
  }

  SD.App = { getGame: () => game, render: render, applyImported: applyImported, switchTab: switchTab, newGame: newGame, loadImported: loadImported, showView: showView, playBank: playBank, openPage: openPage, startWith: startWith };

  /* ---------------- 事件接线与启动 ---------------- */
  /** 讲解里的【R2C6】指到哪一格，棋盘就点亮哪一格；触屏没有 hover，用长按代替 */
  function bindCellRefs() {
    const out = $('#hint-output');
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
  function bindEvents() {
    $('#btn-new').addEventListener('click', openNewGameDialog);
    $('#btn-undo').addEventListener('click', () => { game.undo(); render(); scheduleSave(); });
    $('#btn-redo').addEventListener('click', () => { game.redo(); render(); scheduleSave(); });
    $('#btn-home').addEventListener('click', () => showView('home'));
    U.$$('.home-item').forEach((b) => b.addEventListener('click', () => handleHome(b.dataset.go)));
    $('#page-back').addEventListener('click', () => showView('home'));
    $('#btn-notes').addEventListener('click', () => { game.setNoteMode(); render(); });
    $('#btn-hint').addEventListener('click', doHint);
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
      SD.Store.set('defaultHintLevel', Number(e.target.value));
      hintIndex = 0;
      refreshHints();
      renderHintPanel();
    });

    U.$$('.np-digit, .np-erase').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = Number(btn.dataset.digit);
        if (d === 0) game.erase();
        else game.inputDigit(d);
        render();
        scheduleSave();
      });
    });

    U.$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

    // 提示面板里点选某一条解法（只预演，不落子）
    document.addEventListener('hintpick', (e) => selectHint(e.detail));

    document.addEventListener('techpick', (e) => {
      openTech = e.detail;
      SD.Panels.renderLibrary($('#technique-library'), openTech);
      SD.Panels.renderAvailable($('#available-techniques'), game.state.board.grid);
    });

    document.addEventListener('keydown', onKeyDown);

    window.addEventListener('resize', U.debounce(() => {
      if (document.documentElement.getAttribute('data-tab') === 'image') SD.OCR.drawStage();
    }, 200));

    window.addEventListener('beforeunload', () => SD.Store.flush());
  }

  /** 只讲解 / 讲解并执行：都作用于面板上当前选中的那一条解法 */
  function doHint(apply) {
    refreshHints();
    switchTab('hint');
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
    if (SD.Store.settings().confirmSolve) {
      confirm('自动求解', '会用人类技巧一步步把棋盘推完，无法推进时改用机器解。会记为一次提示。确定继续？', '求解').then((ok) => {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  function onKeyDown(e) {
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
        openDailyDialog();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        openNewGameDialog();
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

  /* ---------------- 启动 ---------------- */
  function boot() {
    const s = SD.Store.settings();
    applyTheme(s.theme);
    fillHintLevels(s.defaultHintLevel);

    view = SD.BoardView.create($('#board-mount'), {
      onSelect: (i) => {
        game.select(i);
        render();
      },
    });

    game = SD.Game.create({
      onChange: (kind) => {
        if (kind === 'win') onWin();
        else if (kind === 'tick') renderStatus();
      },
      onTick: () => renderStatus(),
    });

    bindEvents();
    bindCellRefs();
    document.documentElement.setAttribute('data-tab', 'hint');
    renderAllPanels();

    const saved = SD.Store.loadGame();
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
      }
    }
    if (!game.state.givens) {
      SD.Generator.generate(s.lastDifficulty || 'medium', null, () => {}).then((gen) => {
        startWith(gen.givens, {
          difficulty: gen.difficulty,
          difficultyName: gen.difficultyName,
          rating: gen.rating,
          clueCount: gen.clueCount,
          level: gen.level,
          title: gen.difficultyName + ' · ' + gen.clueCount + ' 个线索',
        }, gen.solution, true);
      }, (e) => {
        showView('home');
        toast('开局出题失败：' + e.message, 'err');
      });
    } else {
      render();
    }

    // 冷启动先落在首页；有未完成的旧局也由玩家自己决定要不要回去接着下
    showView('home');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
