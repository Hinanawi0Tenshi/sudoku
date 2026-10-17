/* 扫雷 · 游戏装配
 *
 * 扫雷这一款游戏的完整定义：首页入口、对局页骨架、提示面板、难度选择、战绩。
 * 平台层只通过 SD.Registry 里注册的那份描述调用它。
 *
 * 这一款和数独族没有共用逻辑：盘面、翻开规则、插旗、双击展开全在这里，
 * 复用的只有平台层那几样——主题、弹窗、存储、点数、顶栏。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const U = SD.UI;
  const { $, $$, el, clear, toast, modal, confirm } = U;
  const M = SD.Mines;
  const Store = M.store;
  const Util = SD.Util;

  let board = null;
  let meta = null;
  let view = null;
  let session = 0;
  let timer = null;
  let startedAt = 0;
  let elapsedMs = 0;
  let hintOpen = false;
  let analysis = null;
  // 面板按「技巧」归并，而不是一条推理一个 chip：
  // 一个盘面上「单格规则·全是雷」可能同时有十几处，一条一个 chip 会刷成一片。
  let groups = [];
  let groupIndex = 0;
  let homeRefs = {};
  let docBound = false;

  /**
   * 一局通关值多少点数。自定义盘面按雷数折算——
   * 用宽高算会被「拉长一条 30×5 放 5 颗雷」这种盘面刷分。
   */
  const WIN_POINTS = { beginner: 10, intermediate: 25, expert: 60 };
  function pointsFor(m) {
    const base = WIN_POINTS[m.levelId] || Util.clamp(Math.round((m.mines / 99) * 60), 5, 60);
    return m.dailyKey ? Math.round(base * 1.5) : base;
  }

  /* ---------------- 首页 ---------------- */
  const HOME_MENU = [
    { id: 'play', label: '开始游戏', desc: '初级 9×9，高级 30×16，也可以自己定', primary: true },
    { id: 'daily', label: '每日挑战', desc: '同一天全世界同一张雷图' },
    { id: 'learn', label: '教程', desc: '九种推理技巧，每种配一个演示盘面' },
    { id: 'mine', label: '我的', desc: '各档最佳成绩' },
  ];

  function buildHome(root) {
    root.appendChild(el('div.home-logo.mine-logo', { text: '💣' }));
    root.appendChild(el('h1.home-title', { text: '扫雷' }));
    root.appendChild(el('p.home-sub', { text: '经典三档，每一步都能推理出来' }));
    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const desc = el('span.hi-desc', { text: item.desc });
      if (item.id === 'daily') homeRefs.daily = desc;
      menu.appendChild(el('button.home-item' + (item.primary ? '.home-item-primary' : ''), {
        dataset: { go: item.id },
        onclick: () => handleHome(item.id),
      }, [el('span.hi-label', { text: item.label }), desc]));
    }
    root.appendChild(menu);
    homeRefs.stats = el('p.home-stats');
    root.appendChild(homeRefs.stats);
  }

  function handleHome(go) {
    if (go === 'play') { openLevelDialog(); return; }
    if (go === 'daily') { startDaily(); return; }
    if (go === 'learn') { SD.Shell.openPage('扫雷教程', (root) => M.learn.render(root)); return; }
    if (go === 'mine') { openMinePage(); return; }
  }

  function renderHome() {
    if (!homeRefs.stats) return;
    const d = Store.dailyStats();
    const st = Store.stats();
    const parts = [];
    const wins = M.LEVEL_ORDER.reduce((n, id) => n + (st[id] ? st[id].wins : 0), 0);
    if (wins) parts.push('累计通关 ' + wins + ' 局');
    parts.push(d.done ? '今日已完成' : '今日挑战待完成');
    if (d.streak) parts.push('连续 ' + d.streak + ' 天');
    homeRefs.stats.textContent = parts.join(' · ');
    if (homeRefs.daily) {
      homeRefs.daily.textContent = d.done
        ? '今天做完了（' + Util.formatDuration(d.record.timeMs) + '），可以再来一局'
        : '同一天全世界同一张雷图 · 连续 ' + d.streak + ' 天';
    }
  }

  /* ---------------- 对局页骨架 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
      el('div.stat', null, [el('span.stat-label', { text: '剩余雷数' }), el('b', { id: 'stat-mines', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '用时' }), el('b.mono', { id: 'stat-time', text: '00:00' })]),
      el('div.stat', null, [el('span.stat-label', { text: '难度' }), el('b', { id: 'stat-level', text: '—' })]),
    ]);

    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [el('button.btn', { id: 'btn-mine-restart', title: '重开一局 (R)', text: '重开' })],
    }));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-mine-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-mine-flag', title: '插旗模式 (F)：打开后点击即插旗，手机上也可以长按' }, [el('span.tool-ico', { text: '🚩' }), ' 插旗']),
      el('button.btn', { id: 'btn-mine-learn', title: '教程' }, [el('span.tool-ico', { text: '📖' }), ' 教程']),
    ]);

    const hintArea = el('aside.hint-area', { id: 'hint-area', hidden: true }, [
      el('header.hint-head', null, [
        el('b', { text: '提示' }),
        el('div.hint-head-actions', null, [
          el('button.btn.btn-icon', { id: 'btn-mine-hint-close', title: '收起提示', text: '✕' }),
        ]),
      ]),
      el('div.hint-output', { id: 'hint-output' }),
      el('div.hint-actions', null, [
        el('button.btn.btn-primary', { id: 'btn-mine-hint-apply', text: '执行这一步' }),
      ]),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.mine-wrap', null, el('div', { id: 'mine-mount' })),
        tools,
      ]),
      hintArea,
    ]));

    view = M.view.create($('#mine-mount'), {
      onOpen: (i) => { doOpen(i); },
      onFlag: (i) => { doFlag(i); },
      onChord: (i) => { doChord(i); },
      flagMode: () => Store.settings().flagMode,
    });
  }

  /* ---------------- 状态与渲染 ---------------- */
  function render() {
    if (!board || !view) return;
    const step = hintOpen ? currentStep() : null;
    view.render(board, { hint: step });
    renderStatus();
  }

  function renderStatus() {
    if (!board) return;
    $('#stat-mines').textContent = String(M.remaining(board));
    $('#stat-level').textContent = meta.dailyKey ? '每日挑战' : meta.name;
    $('#stat-time').textContent = Util.formatDuration(elapsedMs);
    $('#btn-mine-flag').classList.toggle('is-on', !!Store.settings().flagMode);
  }

  /* ---------------- 计时 ---------------- */
  function startTimer() {
    if (timer || !board || M.isOver(board)) return;
    startedAt = Date.now() - elapsedMs;
    timer = setInterval(() => {
      elapsedMs = Date.now() - startedAt;
      if (board) board.elapsed = elapsedMs;
      const node = $('#stat-time');
      if (node) node.textContent = Util.formatDuration(elapsedMs);
    }, 200);
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---------------- 落子 ---------------- */
  function doOpen(i) {
    if (!board || M.isOver(board)) return;
    const r = M.open(board, i);
    if (!r.ok) return;
    startTimer();
    afterMove();
  }

  function doFlag(i) {
    if (!board || M.isOver(board)) return;
    if (!M.toggleFlag(board, i)) return;
    afterMove();
  }

  function doChord(i) {
    if (!board || M.isOver(board)) return;
    const r = M.chord(board, i);
    if (!r.ok) return;
    afterMove();
  }

  function afterMove() {
    if (M.isOver(board)) { finish(board.state === 'won'); return; }
    refreshAnalysis();
    render();
    renderHintPanel();
    scheduleSave();
  }

  /* ---------------- 结算 ---------------- */
  function finish(won) {
    stopTimer();
    board.elapsed = elapsedMs;
    const timeMs = elapsedMs;
    const mineCount = board.mines;
    const levelId = meta.levelId;

    Store.recordGame({
      levelId: levelId, won: won, timeMs: timeMs, mines: mineCount,
      dailyKey: meta.dailyKey, w: board.w, h: board.h,
    });
    // 已经结束的局不再写存档。延迟保存里也有同样的判断，这里只是让它早点作数。
    Store.clearGame();

    const pts = won ? SD.Points.awardWin('mines', {
      levelId: levelId, mines: mineCount, dailyKey: meta.dailyKey,
    }) : 0;

    render();
    renderHintPanel();
    renderHome();

    const best = Store.bucket(levelId).bestTimeMs;
    const rows = [
      el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(timeMs) })]),
      el('div.kv', null, [el('span', { text: '难度' }), el('b', { text: meta.dailyKey ? '每日挑战' : meta.name })]),
      el('div.kv', null, [el('span', { text: '盘面' }), el('b', { text: board.w + '×' + board.h + ' · ' + mineCount + ' 雷' })]),
    ];
    if (won && best && best !== timeMs) {
      rows.push(el('div.kv', null, [el('span', { text: '该档最佳' }), el('b', { text: Util.formatDuration(best) })]));
    }

    modal({
      title: won ? '🎉 排完了！' : '💥 踩雷了',
      body: [
        won && best === timeMs ? el('div.notice.notice-ok', { text: '新纪录！' }) : null,
        el('div.card', null, rows),
        pts ? el('p.points-gain', { text: '+' + pts + ' 通关点数，累计 ' + SD.Points.total() }) : null,
        won ? null : el('p', { text: '插错的旗已经标出来了，雷也全部摊开了——可以重开一局再来。' }),
      ],
      footer: [
        { label: '回到首页', onClick: () => SD.Shell.showView('home') },
        { label: '再来一局', primary: true, onClick: () => restart() },
      ],
    });
  }

  /* ---------------- 开局 ---------------- */
  function begin(b, m) {
    session++;
    board = b;
    meta = m;
    elapsedMs = 0;
    groupIndex = 0;
    groups = [];
    analysis = null;
    hintOpen = false;
    stopTimer();
    const area = $('#hint-area');
    if (area) area.hidden = true;
    const layout = document.querySelector('.layout');
    if (layout) layout.classList.remove('is-split');
    render();
    if (board.state === 'playing') startTimer();
    scheduleSave();
    SD.Shell.showView('game');
  }

  function startLevel(levelId) {
    const lv = M.levelById(levelId);
    if (!lv) return;
    begin(M.create(lv.w, lv.h, lv.mines, null), {
      levelId: lv.id, name: lv.name, dailyKey: null,
    });
  }

  function startCustom(w, h, mines) {
    begin(M.create(w, h, mines, null), {
      levelId: 'custom', name: '自定义 ' + w + '×' + h, dailyKey: null,
    });
  }

  /**
   * 每日挑战：难度固定中级，整张图完全由日期播种。
   * 首点也由种子定下来并预先翻开——普通对局的首点是玩家自己点的，
   * 不把首点固定住，「同一天全世界同一张图」就只是句空话。
   */
  function startDaily() {
    const key = Util.dayKey();
    const lv = M.LEVELS[1];
    const b = M.create(lv.w, lv.h, lv.mines, 'mines-daily-' + key);
    M.open(b, M.seedFirstClick(b));
    begin(b, { levelId: lv.id, name: lv.name, dailyKey: key });
  }

  function restart() {
    if (meta && meta.dailyKey) { startDaily(); return; }
    if (meta && meta.levelId === 'custom') { startCustom(board.w, board.h, board.mines); return; }
    startLevel(meta ? meta.levelId : 'beginner');
  }

  /* ---------------- 难度对话框 ---------------- */
  function bestText(levelId) {
    const b = Store.bucket(levelId);
    if (!b.wins) return b.games ? '玩过 ' + b.games + ' 局，还没通关' : '还没玩过';
    return '最佳 ' + Util.formatDuration(b.bestTimeMs) + ' · 通关 ' + b.wins + '/' + b.games;
  }

  function openLevelDialog() {
    const list = el('div.mine-levels');
    for (const lv of M.LEVELS) {
      list.appendChild(el('button.mine-level', {
        onclick: () => { m.close(); startLevel(lv.id); },
      }, [
        el('b.mine-level-name', { text: lv.name }),
        el('span.mine-level-size', { text: lv.w + '×' + lv.h + ' · ' + lv.mines + ' 雷' }),
        el('span.mine-level-best', { text: bestText(lv.id) }),
      ]));
    }
    list.appendChild(el('button.mine-level', {
      onclick: () => { m.close(); openCustomDialog(); },
    }, [
      el('b.mine-level-name', { text: '自定义' }),
      el('span.mine-level-size', { text: M.CUSTOM.minW + '–' + M.CUSTOM.maxW + ' 列 · ' + M.CUSTOM.minH + '–' + M.CUSTOM.maxH + ' 行' }),
      el('span.mine-level-best', { text: '自己定宽、高和雷数' }),
    ]));

    const m = modal({
      title: '选择难度',
      body: [
        el('p', { text: '第一次点到哪，那一格连同周围八格都不会有雷——开局不会一点就炸。' }),
        list,
      ],
      footer: [{ label: '取消' }],
    });
  }

  function openCustomDialog() {
    const wIn = el('input', { type: 'number', min: String(M.CUSTOM.minW), max: String(M.CUSTOM.maxW), value: '16' });
    const hIn = el('input', { type: 'number', min: String(M.CUSTOM.minH), max: String(M.CUSTOM.maxH), value: '16' });
    const mIn = el('input', { type: 'number', min: '1', value: '40' });
    const warn = el('p.mine-warn');

    const clampAll = () => {
      const w = Util.clamp(Math.round(+wIn.value || 16), M.CUSTOM.minW, M.CUSTOM.maxW);
      const h = Util.clamp(Math.round(+hIn.value || 16), M.CUSTOM.minH, M.CUSTOM.maxH);
      const max = M.maxMines(w, h);
      const mines = Util.clamp(Math.round(+mIn.value || 40), 1, max);
      wIn.value = String(w); hIn.value = String(h); mIn.value = String(mines);
      mIn.max = String(max);
      // 雷数上限随宽高走，先说清楚，别让人填完才被默默改掉
      warn.textContent = w * h + ' 格最多放 ' + max + ' 颗雷（至少留一格放首点）。';
      return { w: w, h: h, mines: mines };
    };
    for (const n of [wIn, hIn, mIn]) n.addEventListener('input', clampAll);
    clampAll();

    const dlg = modal({
      title: '自定义盘面',
      body: [
        el('div.mine-custom', null, [
          el('label.field', null, [el('span', { text: '列数' }), wIn]),
          el('label.field', null, [el('span', { text: '行数' }), hIn]),
          el('label.field', null, [el('span', { text: '雷数' }), mIn]),
        ]),
        warn,
      ],
      footer: [
        { label: '取消' },
        {
          label: '开始', primary: true,
          onClick: () => { const c = clampAll(); startCustom(c.w, c.h, c.mines); },
        },
      ],
    });
    return dlg;
  }

  /* ---------------- 提示 ---------------- */
  function refreshAnalysis() {
    if (!board || M.isOver(board)) { analysis = null; groups = []; return null; }
    analysis = M.solver.analyze(board, { enumerate: true });
    groups = [];
    const by = new Map();
    for (const s of analysis.steps) {
      let g = by.get(s.id);
      if (!g) { g = { id: s.id, level: s.level, steps: [] }; by.set(s.id, g); groups.push(g); }
      g.steps.push(s);
    }
    if (groupIndex >= groups.length) groupIndex = 0;
    return analysis;
  }

  /** 当前技巧下先演示第一条；同一个技巧的其余位置在面板里报个数 */
  function currentStep() {
    const g = groups[groupIndex];
    return g ? g.steps[0] : null;
  }

  function renderHintPanel() {
    const out = $('#hint-output');
    if (!out) return;
    clear(out);
    if (!board) return;
    if (M.isOver(board)) {
      out.appendChild(el('p', { text: '这一局已经结束了，重开一局再来。' }));
      return;
    }
    const an = refreshAnalysis();
    out.appendChild(el('div.mine-sum', { text: M.hints.summary(board, an) }));

    if (an.conflict.length || an.inconsistent) {
      out.appendChild(el('div.notice.notice-err', {
        text: '你插的旗和已翻开的数字对不上——先把旗改对，后面的推理才作数。',
      }));
      return;
    }
    if (!an.steps.length) {
      out.appendChild(el('p', { text: '当前局面没有可用推理了。' }));
      return;
    }

    const strip = el('div.mine-steps');
    groups.forEach((g, k) => {
      strip.appendChild(el('button.mine-chip' + (k === groupIndex ? '.is-on' : ''), {
        text: 'L' + g.level + ' ' + M.hints.TECH_NAME[g.id] + (g.steps.length > 1 ? ' ×' + g.steps.length : ''),
        onclick: () => { groupIndex = k; render(); renderHintPanel(); },
      }));
    });
    out.appendChild(strip);

    const step = currentStep();
    const ex = M.hints.explain(board, step);
    out.appendChild(el('h4.mine-hint-title', { text: ex.title }));
    for (const p of ex.how) out.appendChild(el('p', { text: p }));
    out.appendChild(el('div.mine-concl', { text: ex.conclusion }));
    if (ex.pitfall) out.appendChild(el('p.mine-pitfall', { text: '注意：' + ex.pitfall }));
    if (!step.certain) {
      out.appendChild(el('div.notice.notice-warn', { text: '这一步是猜的，不是必然结论。' }));
    }
    const g = groups[groupIndex];
    if (g && g.steps.length > 1) {
      out.appendChild(el('p.mine-more', {
        text: '这个技巧在当前盘面上还有 ' + (g.steps.length - 1) + ' 处，做完这一处会自动接着出现。',
      }));
    }
    const btn = $('#btn-mine-hint-apply');
    if (btn) btn.textContent = step.certain ? '执行这一步' : '就点它（赌一把）';
  }

  function applyHint() {
    const an = analysis || refreshAnalysis();
    if (!an || !an.steps.length) return;
    const step = currentStep();
    if (!step) return;
    if (step.safe.length) {
      for (const i of step.safe) if (!M.isOver(board)) M.open(board, i);
    } else if (step.mines.length) {
      for (const i of step.mines) M.toggleFlag(board, i);
    } else if (step.suggest && step.suggest.length) {
      M.open(board, step.suggest[0]);
    }
    startTimer();
    afterMove();
  }

  /* ---------------- 提示区展开 / 收起 ---------------- */
  function setHintOpen(open) {
    const area = $('#hint-area');
    if (!area) return;
    document.documentElement.style.setProperty('--sheet-top', measureSheetTop());
    area.hidden = !open;
    hintOpen = open;
    const layout = document.querySelector('.layout');
    if (layout) layout.classList.toggle('is-split', open);
    if (open) { groupIndex = 0; renderHintPanel(); }
    render();
  }

  function measureSheetTop() {
    const wrap = document.querySelector('.mine-wrap');
    if (!wrap) return '50vh';
    const bottom = wrap.getBoundingClientRect().bottom + 8;
    return Math.round(Math.min(bottom, window.innerHeight * 0.7)) + 'px';
  }

  /* ---------------- 我的 ---------------- */
  function openMinePage() {
    SD.Shell.openPage('我的', (root) => {
      const d = Store.dailyStats();
      const pts = SD.Points.total();
      root.appendChild(el('p.lead', {
        text: '通关点数 ' + pts + '（全部游戏通用）。扫雷这部分的成绩只存在本机。',
      }));

      const card = el('div.card', null, el('h3', { text: '各档成绩' }));
      for (const lv of M.LEVELS) {
        const b = Store.bucket(lv.id);
        card.appendChild(el('div.kv', null, [
          el('span', { text: lv.name + '（' + lv.w + '×' + lv.h + ' · ' + lv.mines + ' 雷）' }),
          el('b', { text: b.wins ? Util.formatDuration(b.bestTimeMs) + ' · ' + b.wins + '/' + b.games : (b.games ? '未通关 · ' + b.games + ' 局' : '—') }),
        ]));
      }
      const cb = Store.bucket('custom');
      if (cb.games) {
        card.appendChild(el('div.kv', null, [
          el('span', { text: '自定义' }),
          el('b', { text: '通关 ' + cb.wins + '/' + cb.games }),
        ]));
      }
      root.appendChild(card);

      const daily = el('div.card', null, el('h3', { text: '每日挑战' }));
      daily.appendChild(el('div.kv', null, [el('span', { text: '今日' }), el('b', { text: d.done ? '已完成 ' + Util.formatDuration(d.record.timeMs) : '未完成' })]));
      daily.appendChild(el('div.kv', null, [el('span', { text: '连续' }), el('b', { text: d.streak + ' 天' })]));
      daily.appendChild(el('div.kv', null, [el('span', { text: '累计完成' }), el('b', { text: d.total + ' 天' })]));
      daily.appendChild(el('div.kv', null, [el('span', { text: '最好成绩' }), el('b', { text: d.bestTimeMs ? Util.formatDuration(d.bestTimeMs) : '—' })]));
      root.appendChild(daily);

      const danger = el('div.card', null, el('h3', { text: '维护' }));
      danger.appendChild(el('div.btn-row', null, [
        el('button.btn.btn-warn', {
          text: '清空扫雷成绩',
          onclick: () => {
            if (!confirm('只会清掉扫雷的战绩和每日挑战记录，数独的数据不受影响。确定吗？')) return;
            Store.resetStats();
            openMinePage();
            toast('扫雷成绩已清空');
          },
        }),
      ]));
      danger.appendChild(el('p', { text: '所有游戏的数据各存各的，这里清不掉别的游戏。' }));
      root.appendChild(danger);
    });
  }

  /* ---------------- 存档 ---------------- */
  const scheduleSave = U.debounce(() => {
    if (!board || M.isOver(board)) return;
    Store.saveGame({ board: M.serialize(board), meta: meta, elapsed: elapsedMs });
  }, 400);

  function restore() {
    const saved = Store.loadGame();
    if (!saved || !saved.board) return false;
    const b = M.deserialize(saved.board);
    if (!b || M.isOver(b)) { Store.clearGame(); return false; }
    board = b;
    meta = saved.meta || { levelId: 'custom', name: '自定义', dailyKey: null };
    elapsedMs = saved.elapsed || 0;
    render();
    renderStatus();
    if (b.state === 'playing') startTimer();
    return true;
  }

  /* ---------------- 事件 ---------------- */
  function bindPlay() {
    $('#btn-mine-restart').addEventListener('click', restart);
    $('#btn-mine-hint').addEventListener('click', () => {
      setHintOpen(true);
      renderHintPanel();
    });
    $('#btn-mine-hint-close').addEventListener('click', () => setHintOpen(false));
    $('#btn-mine-hint-apply').addEventListener('click', applyHint);
    $('#btn-mine-flag').addEventListener('click', () => {
      const on = !Store.settings().flagMode;
      Store.set('flagMode', on);
      renderStatus();
      toast(on ? '插旗模式：点击即插旗' : '插旗模式已关，点击即翻开');
    });
    $('#btn-mine-learn').addEventListener('click', () => {
      SD.Shell.openPage('扫雷教程', (root) => M.learn.render(root));
    });
  }

  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'h') { e.preventDefault(); setHintOpen(true); renderHintPanel(); }
    else if (k === 'f') { e.preventDefault(); $('#btn-mine-flag').click(); }
    else if (k === 'r') { e.preventDefault(); restart(); }
  }

  function bindDocument() {
    if (docBound) return;
    docBound = true;
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => {
      if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
      if (view && board) view.resize(board);
      const area = $('#hint-area');
      if (area && !area.hidden) setHintOpen(true);
    }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '每一步都能推理出来',
      p: [
        '扫雷不是靠运气的猜谜。已翻开的数字是约束，「周围这几格里有几颗雷」一条条列出来，'
        + '大部分格子都能推得出来——只有在真推不动的时候才需要赌，而且能算出该赌哪一格。',
        '提示面板收录九种技巧，从「数字已经够数了」一直到「把所有可能的排法穷举一遍」。'
        + '每一条结论都是可证明的：说某格安全就一定安全，说某格是雷就一定是雷。',
        '真推不动时，提示会明确标出「这一步是猜的」，并给出雷概率最低的那一格。'
        + '不把猜测混进必然结论里——那比不给提示更糟。',
      ],
    },
    {
      h: '首点必安全',
      p: [
        '第一次点到哪，那一格连同周围八格都不会有雷，保证开局不会一点就炸。'
        + '这是 XP 扫雷的规则，也是唯一一处「游戏替玩家兜底」的地方。',
        '雷太密、装不下九格安全区时，退到只保证首点本身——那时候开局本来就没有从容可言。',
      ],
    },
    {
      h: '每日挑战为什么是同一张图',
      p: [
        '普通对局的首点是玩家自己点的，而布雷要避开首点周围，所以同一颗种子换个位置点就是另一张图。'
        + '每日挑战因此把首点也交给日期决定，并预先翻开——这样整张图才真的完全由日期决定。',
      ],
    },
    {
      h: '关于猜测',
      p: [
        '高级盘面上，纯逻辑能走完的比例大约六成，剩下的要靠猜。这是扫雷本身的难度，不是提示做得不够。',
        '枚举能给出每一格的准确雷概率，所以「猜」也是有依据的：挑概率最低的那格，'
        + '而不是凭感觉。',
      ],
    },
  ];

  const def = {
    id: 'mines',
    name: '扫雷',
    tagline: '经典三档，也能自己定宽高和雷数',
    icon: '💣',
    accent: '#d97706',
    ready: true,
    mount: function (nodes) {
      session++;
      buildHome(nodes.home);
      buildPlay(nodes.play);
      bindPlay();
      bindDocument();
      renderHome();
      renderStatus();
      if (!board) restore();
      render();
    },
    unmount: function () {
      session++;
      stopTimer();
      if (board && !M.isOver(board)) Store.saveGame({ board: M.serialize(board), meta: meta, elapsed: elapsedMs });
      Store.flush();
    },
    onShow: function () {
      renderHome();
      render();
      renderStatus();
    },
    statusLine: function () {
      const d = Store.dailyStats();
      if (!d.done) return '今日挑战待完成';
      const st = Store.stats();
      const wins = M.LEVEL_ORDER.reduce((n, id) => n + (st[id] ? st[id].wins : 0), 0);
      return wins ? '累计 ' + wins + ' 局' : null;
    },
    settings: function (root, ctx) {
      const s = Store.settings();
      root.appendChild(el('h4.sub-title', { text: '操作' }));
      root.appendChild(el('label.switch.setting', null, [
        el('input', {
          type: 'checkbox',
          checked: !!s.flagMode,
          onchange: (e) => { Store.set('flagMode', e.target.checked); ctx.rerender(); renderStatus(); },
        }),
        el('span', null, [
          el('b', { text: '插旗模式' }),
          el('small', { text: '打开后点击即插旗。关着的时候：桌面右键插旗，手机长按插旗' }),
        ]),
      ]));
      root.appendChild(el('p', { text: '双击已翻开的数字可以快速展开周围——前提是旗数正好等于数字。旗插错了照样会炸。' }));
    },
    resetSettings: function () { Store.resetSettings(); },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  SD.Mines.app = {
    getBoard: () => board,
    getMeta: () => meta,
    analyze: () => analysis,
    startLevel: startLevel,
    startDaily: startDaily,
    restart: restart,
    render: render,
  };
})(window);
