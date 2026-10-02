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
    renderHintPanel();
  }

  /* ---------------- 提示区展开 / 收起 ---------------- */
  /**
   * 手机上提示是一块从盘面下方升起的面板：棋盘大小和位置不动，
   * 面板顶边贴在棋盘下沿，盖住数字键盘与功能栏。
   * 这样讲解和盘面能同时看见——讲解里写【R2C8】，抬头就能找到是哪一格。
   */
  function setHintOpen(open) {
    document.documentElement.style.setProperty('--sheet-top', measureSheetTop());
    $('#hint-area').hidden = !open;
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
    const available = el('div.tech-available');
    const library = el('div.tech-library');
    body.appendChild(el('div.learn-intro', { text: '当前局面可用的技巧会高亮显示。点开任意技巧，看它的原理、步骤与常见误区。' }));
    body.appendChild(available);
    body.appendChild(library);
    const draw = () => {
      SD.Panels.renderAvailable(available, game.state.board.grid);
      SD.Panels.renderLibrary(library, openTech);
    };
    library.addEventListener('techpick', (e) => {
      openTech = e.detail;
      draw();
    });
    draw();
    return modal({ title: '技巧教学', body, footer: [{ label: '关闭' }] });
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
      // 题面来源标记：换过生成器之后，旧存档该被丢弃而不是反复恢复出来
      genVersion: 2,
    });
    if (st.meta.dailyKey && !st.won) {
      let filled = 0;
      for (let i = 0; i < 81; i++) if (st.board.grid[i]) filled++;
      SD.Store.recordDailyProgress(st.meta.dailyKey, filled, 81);
    }
  }, 400);

  /* ---------------- 遮罩 ---------------- */
  // 遮罩要落在当前可见的那个视图上——从首页点「开始数独」时游戏页还没显示，
  // 盖在隐藏的棋盘上等于什么都没发生。
  const overlayOf = () => (document.documentElement.getAttribute('data-view') === 'home' ? $('#home-overlay') : $('#board-overlay'));

  // 记下 show 时落在哪个节点上。出题是异步的，中间很可能已经切了视图，
  // 收起时再按当前视图去找就会收错地方，遮罩就永远留在屏幕上。
  let shownOverlay = null;

  function showOverlay(title, sub) {
    const ov = overlayOf();
    shownOverlay = ov;
    clear(ov);
    ov.hidden = false;
    ov.appendChild(el('div.ov-card', null, [
      el('div.ov-title', { text: title }),
      el('div.ov-sub', { text: sub || '' }),
      el('div.progress', null, el('i')),
    ]));
  }

  function hideOverlay() {
    if (!shownOverlay) return;
    shownOverlay.hidden = true;
    clear(shownOverlay);
    shownOverlay = null;
  }


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
    // 切视图时两个遮罩都收干净。遮罩是出题期间的临时状态，跟着视图走就会出岔子：
    // 出题途中回首页，收起时按新视图去找就找错了节点，灰幕留在屏幕上点不掉。
    hideOverlay();
    for (const id of ['#home-overlay', '#board-overlay']) {
      const ov = $(id);
      if (ov) {
        ov.hidden = true;
        clear(ov);
      }
    }
    window.scrollTo(0, 0);
  }

  /** 整页：设置 / 关于 / 题库共用一个壳，只有标题和内容不同 */
  function openPage(title, render) {
    $('#page-title').textContent = title;
    const root = clear($('#page-root'));
    render(root);
    showView('page');
  }


  /** 「我的」页：战绩与图鉴都是自己的积累，合成一页用标签切换 */
  function openMinePage() {
    let tab = 'stats';
    $('#page-title').textContent = '我的';
    const root = clear($('#page-root'));
    const bar = el('div.tabbar');
    const body = el('div.tab-body');
    const tabs = [
      { id: 'stats', label: '战绩', render: (r) => SD.Data.renderData(r, { game: game, applyImported: applyImported }) },
      { id: 'cards', label: '图鉴', render: (r) => SD.Gacha.renderLibrary(r) },
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
    showView('page');
  }

  /** 启动页的入口。游戏页里没有这些按钮，所以这里是唯一的导航 */
  function handleHome(go) {
    if (go === 'play') { openNewGameDialog(); return; }
    if (go === 'bank') { openPage('题库', openBankPage); return; }
    if (go === 'daily') { calMonth = null; openPage('每日挑战', openDailyPage); return; }
    if (go === 'mine') { openMinePage(); return; }
    if (go === 'learn') { openPage('技巧教学', (root) => SD.Learn.renderLearn(root)); return; }
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
  /** 每档自动攒几道待做题，做完一道补一道 */
  const QUEUE_KEEP = 3;

  /**
   * 补位出题。已经出现在待做队列、玩家自己题库、每日挑战里的题面一律跳过——
   * 用题面字符串做指纹，比按标题去重可靠得多。
   */
  function refillQueue(diff) {
    if (!diff || !SD.Generator.DIFFICULTY[diff]) return;
    const gen = () => {
      // 优先从批量题库里抽：那里有几千道已复核过的题，抽中就是零成本，
      // 而且不会再和「已经出现过」的题相撞——题库本身就是去重过的全集。
      if (SD.BankBig && SD.BankBig.countOf(diff)) {
        const bank = SD.BankBig.randomOf(diff);
        if (bank) {
          const used = SD.Store.usedGrids();
          for (let i = 0; i < 20 && used[bank.grid]; i++) bank = SD.BankBig.randomOf(diff);
          if (bank && !used[bank.grid]) {
            return { grid: bank.grid, clues: bank.clueCount, level: bank.level };
          }
        }
      }
      const g = SD.Generator.generateSync(diff, null);
      return { grid: B.gridToString(g.givens), clues: g.clueCount, level: g.level };
    };
    SD.Store.refillQueue(diff, QUEUE_KEEP, gen);
    return SD.Store.queueOf(diff).length;
  }

  /**
   * 每日挑战的题面记进已用指纹，免得玩家今天做过的那道明天又在队列里出现。
   * 只在开题库页时算一次：放在每次补位里会反复重算每日挑战，
   * 大师档一秒一道，补五档位要多等好几秒。
   */
  let dailyNoted = false;
  function noteDailyGrid() {
    if (dailyNoted) return;
    dailyNoted = true;
    SD.Store.noteGridUsed(B.gridToString(SD.Generator.generateSync('medium', SD.Generator.dailySeed()).givens));
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
    root.appendChild(el('p.lead', { text: '精选题目点一下就上盘；也可以从照片把题读出来，存进你自己的题库。' }));
    root.appendChild(el('h3.sec-title', { text: '从图片添加' }));
    const ocrBox = el('div.ocr-box');
    root.appendChild(ocrBox);
    root.appendChild(el('h3.sec-title', { text: '待做题' }));
    root.appendChild(el('p.lead', { text: '每档自动攒 ' + QUEUE_KEEP + ' 道，做完一道立刻补一道。题目不会和题库、每日挑战重复。' }));
    const queueBox = el('div.bank-list');
    root.appendChild(queueBox);

    root.appendChild(el('h3.sec-title', { text: '我的题库' }));
    const mine = el('div.bank-list');
    root.appendChild(mine);
    root.appendChild(el('h3.sec-title', { text: '精选题目' }));
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

    SD.OCR.mount(ocrBox, {
      applyImported: applyImported,
      onSave: (grid, report) => {
        const n = mine.querySelectorAll('.bank-item').length + 1;
        SD.Store.addUserPuzzle(grid, '我的题目 ' + n, report.classification.name);
        drawMine();
        toast('已存进我的题库', 'ok');
      },
    });

    function drawMine() {
      U.clear(mine);
      const saved = SD.Store.userBank();
      if (!saved.length) {
        mine.appendChild(el('p.lead', { text: '还没有自己存的题。上面识别成功后点「存进我的题库」。' }));
        return;
      }
      for (const p of saved) {
        const clues = p.grid.replace(/\./g, '').length;
        mine.appendChild(
          el('div.bank-item.is-mine', null, [
            el('div.bi-main', null, [
              el('b.bi-name', { text: p.name }),
              el('span.bi-band', { text: p.band || '自定义' }),
            ]),
            el('div.bi-meta', { text: clues + ' 个线索' }),
            el('div.bi-row', null, [
              el('button.btn.btn-primary', { text: '开始', onclick: () => playUserPuzzle(p) }),
              el('button.btn', {
                text: '删除',
                onclick: () => { SD.Store.removeUserPuzzle(p.id); drawMine(); },
              }),
            ]),
          ])
        );
      }
    }
    drawMine();
    drawQueue();

    function drawQueue() {
      U.clear(queueBox);
      let any = false;
      for (const diff of SD.Generator.DIFFICULTY_ORDER) {
        const cfg = SD.Generator.DIFFICULTY[diff];
        const items = SD.Store.queueOf(diff);
        if (!items.length) {
          queueBox.appendChild(el('p.lead', { text: cfg.name + '：暂无' }));
          continue;
        }
        any = true;
        const line = el('div.bank-item.is-queue', null, [
          el('div.bi-main', null, [
            el('b.bi-name', { text: cfg.name + '（' + items.length + ' 道）' }),
            el('span.bi-band', { text: '待做' }),
          ]),
          el('div.bi-meta', { text: '做完一道自动补一道' }),
          el('div.bi-row', null, [
            el('button.btn.btn-primary', { text: '开始', onclick: () => playQueueItem(items[0]) }),
          ]),
        ]);
        queueBox.appendChild(line);
      }
      if (!any) {
        // 一档都没有时现场补一次。补不上就照实说，别转圈——
        // generateSync 理论上总能出题，但这里不该拿死循环赌。
        noteDailyGrid();
        let added = 0;
        for (const diff of SD.Generator.DIFFICULTY_ORDER) added += refillQueue(diff);
        if (added) drawQueue();
        else queueBox.appendChild(el('p.lead', { text: '暂时没能出题，请稍后再试。' }));
      }
    }
  }

  function playBank(id) {
    const p = SD.Bank.byId(id);
    if (!p) return;
    const info = SD.Bank.describe(p);
    if (applyImported(p.grid, null, { source: '题库' })) {
      game.state.meta.title = p.name;
      game.state.meta.difficultyName = info.band;
      render();
      showView('game');
    }
  }
  function playUserPuzzle(p) {
    if (applyImported(p.grid, null, { source: '我的题库' })) {
      game.state.meta.title = p.name;
      render();
      showView('game');
    }
  }
  /* ---------------- 每日挑战日历 ---------------- */
  let calMonth = null;   // null 表示跟随当前月

  const monthKey = (d) => d.getFullYear() + '-' + B.pad2(d.getMonth() + 1);

  function openDailyPage(root) {
    const stats = SD.Store.dailyStats();

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
        onclick: () => { calMonth = shiftMonth(cursor, -1); openPage('每日挑战', openDailyPage); },
      }),
      el('b.cal-title', { text: cursor.getFullYear() + ' 年 ' + (cursor.getMonth() + 1) + ' 月' }),
      el('button.btn.btn-icon', {
        text: '›',
        title: '下个月',
        onclick: () => { calMonth = shiftMonth(cursor, 1); openPage('每日挑战', openDailyPage); },
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
      grid.appendChild(calCell(new Date(cursor.getFullYear(), cursor.getMonth() + days + i), today));
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
    const rec = SD.Store.stats().daily[key];
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

    const cell = el(cls, {
      style: ratio > 0
        ? { '--p': Math.round(ratio * 100) + '%', background: 'color-mix(in srgb, var(--accent) ' + Math.round(ratio * 22) + '%, var(--surface))' }
        : null,
      title: won ? '已完成' : ratio > 0 ? '已完成 ' + Math.round(ratio * 100) + '%' : '',
      onclick: won || future ? null : () => dailyChallenge(SD.Generator.dailySeed(d)),
    }, [
      el('span.cal-num', { text: String(d.getDate()) }),
      won ? el('span.cal-trophy', { text: '🏆' }) : null,
    ]);
    return cell;
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
    // 把版本号摆出来：发布出问题时要能一眼分清
    // 「发上去了但用户还在看旧缓存」和「压根没发上去」。
    root.appendChild(
      el('p.foot-note', { text: '版本 ' + (window.SD_BUILD || '本地开发版') + ' · ' + SD.Techniques.LIST.length + ' 种技巧' })
    );
    root.appendChild(
    el('p.foot-note', { text: '快捷键：Esc 回首页 · M 笔记 · H 提示 · C 检查 · D 每日挑战 · Ctrl+Z 撤销 · Ctrl+Y 重做' })
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
    // 待做队列：做完一道立刻补一道，玩家手上永远有 QUEUE_KEEP 道可打。
    // 出题是同步的，最多一两秒，这里已经过了结算弹窗的时机。
    if (st.meta.queueId) {
      SD.Store.finishQueueItem(st.meta.queueId);
      refillQueue(st.meta.difficulty);
    }
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
        { label: '看看复盘', onClick: openLearnModal },
        { label: '再来一局', primary: true, onClick: () => newGame(SD.Store.settings().lastDifficulty) },
      ],
    });
  }


  SD.App = { getGame: () => game, render: render, applyImported: applyImported, newGame: newGame, loadImported: loadImported, showView: showView, playBank: playBank, openPage: openPage, startWith: startWith, setHintOpen: setHintOpen };

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
    $('#btn-undo').addEventListener('click', () => { game.undo(); render(); scheduleSave(); });
    $('#btn-redo').addEventListener('click', () => { game.redo(); render(); scheduleSave(); });
    $('#btn-home').addEventListener('click', () => showView('home'));
    $('#btn-home-back').addEventListener('click', () => showView('home'));
    U.$$('.home-item').forEach((b) => b.addEventListener('click', () => handleHome(b.dataset.go)));
    $('#page-back').addEventListener('click', () => showView('home'));
    $('#btn-notes').addEventListener('click', () => { game.setNoteMode(); render(); });
    $('#btn-hint').addEventListener('click', () => {
      setHintOpen(true);
      doHint(false);
    });
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

    // 提示区里点选某一条解法（只预演，不落子）
    document.addEventListener('hintpick', (e) => selectHint(e.detail));

    document.addEventListener('keydown', onKeyDown);

    window.addEventListener('resize', U.debounce(() => {
      if (document.documentElement.getAttribute('data-tab') === 'image') SD.OCR.drawStage();
      // 面板顶边是量出来的，转屏或改窗口后要重新贴一次
      if (!$('#hint-area').hidden) setHintOpen(true);
    }, 200));

    window.addEventListener('beforeunload', () => SD.Store.flush());
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
    if (SD.Store.settings().confirmSolve) {
      confirm('自动求解', '会用人类技巧一步步把棋盘推完，无法推进时改用机器解。会记为一次提示。确定继续？', '求解').then((ok) => {
        if (ok) run();
      });
    } else {
      run();
    }
  }

  function onKeyDown(e) {
    // 弹窗开着时 Esc 归弹窗管，否则关掉弹窗的同时还会把当前视图切走
    if (e.key === 'Escape' && !document.querySelector('#dialog-root .modal')) {
      e.preventDefault();
      showView('home');
      return;
    }
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
        openPage('每日挑战', openDailyPage);
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
