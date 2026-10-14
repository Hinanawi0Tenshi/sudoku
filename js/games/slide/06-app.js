/* 数字华容道 · 游戏定义
 *
 * 结构照抄扫雷：首页选难度 → 对局页顶栏 + 盘面 + 工具栏 → 通关弹窗结算。
 * 平台层一行没改，这就是当初把 registry 抽出来的意义。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const U = SD.UI;
  const { $, el, clear, toast, modal } = U;
  const S = SD.Slide;
  const Store = S.store;
  const Util = SD.Util;

  let board = null;
  let meta = null;
  let view = null;
  let session = 0;
  let homeRefs = {};
  let elapsedMs = 0;
  let startedAt = 0;
  let timer = null;

  const HOME_MENU = [
    { id: 'n3', icon: '🟦', sub: '九格，热身' },
    { id: 'n4', icon: '🟩', sub: '十六格，经典' },
    { id: 'n5', icon: '🟪', sub: '二十五格，硬仗' },
  ];

  function pointsFor(m) {
    const lv = S.byId(m.levelId);
    return lv ? lv.points : 6;
  }

  /* ---------------- 首页 ---------------- */
  function buildHome(root) {
    root.appendChild(el('div.home-logo', { text: '🔢' }));
    root.appendChild(el('h1.home-title', { text: '数字华容道' }));
    root.appendChild(el('p.home-sub', { text: '点空格旁边的数字，把它推回原位' }));

    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const lv = S.byId(item.id);
      const desc = el('span.hi-desc', { text: item.sub });
      homeRefs[item.id] = desc;
      menu.appendChild(el('button.home-item', {
        dataset: { go: item.id },
        onclick: () => startLevel(item.id),
      }, [el('span.hi-label', { text: item.icon + ' ' + lv.name }), desc]));
    }
    // 4×4 是默认档，给它主按钮样式，一眼看得出点哪个开始
    const first = menu.querySelector('.home-item');
    if (first) first.classList.add('home-item-primary');
    root.appendChild(menu);

    homeRefs.stats = el('p.home-stats');
    root.appendChild(homeRefs.stats);
  }

  function renderHome() {
    for (const item of HOME_MENU) {
      const d = homeRefs[item.id];
      if (!d) continue;
      const best = Store.best(item.id);
      d.textContent = best
        ? '最好 ' + best.moves + ' 步 · ' + Util.formatDuration(best.ms)
        : item.sub;
    }
    if (!homeRefs.stats) return;
    const st = Store.stats();
    homeRefs.stats.textContent = st.wins ? ('通关 ' + st.wins + ' 局 · 开局 ' + st.plays + ' 次') : '';
  }

  function renderLearn(root) {
    clear(root);
    const add = (h, ps) => {
      root.appendChild(el('h4.sub-title', { text: h }));
      for (const p of ps) root.appendChild(el('p', { text: p }));
    };
    add('规则', [
      '一块 n×n 的板，放着 1 到 n²-1 这些数字，剩下一格是空的。',
      '点空格上下左右那四块里的任何一块，它就滑进空格里——等于空格换了个位置。',
      '把数字按 1、2、3……的顺序从左到右、从上到下排好，空格落在右下角，就赢了。',
    ]);
    add('为什么一定解得开', [
      '如果把数字随便打乱，有一半的局面是永远排不回去的——判断依据是「逆序数的奇偶性」，'
      + '排列的奇偶性和终局不一致就无解。',
      '这个游戏打乱的做法是「从终局倒着走」：先摆好终局，再随机走几百步。'
      + '每一步都是合法移动，所以走出来的局面**必然能走回去**，根本不用判奇偶。',
    ]);
    add('为什么越大的板越难', [
      '3×3 最多 31 步就能排好，随便搜一下就有最优解。',
      '4×4 的最优解常常要 50 步以上，5×5 更是上百步——状态数分别是一万亿和一万亿亿级别，'
      + '所以 4×4 以上不提供「保证最短」的提示，只给一个就近方向。',
    ]);
  }

  /* ---------------- 对局页 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
      el('div.stat', null, [el('span.stat-label', { text: '难度' }), el('b', { id: 'st-level', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '用时' }), el('b.mono', { id: 'st-time', text: '00:00' })]),
      el('div.stat', null, [el('span.stat-label', { text: '步数' }), el('b', { id: 'st-moves', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '最佳' }), el('b', { id: 'st-best', text: '—' })]),
    ]);
    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [el('button.btn', { id: 'btn-s-restart', title: '重开一局 (R)', text: '重开' })],
    }));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-s-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-s-restart2', title: '重开一局 (R)' }, [el('span.tool-ico', { text: '↻' }), ' 重开']),
      el('button.btn', { id: 'btn-s-learn', title: '怎么玩' }, [el('span.tool-ico', { text: '📖' }), ' 怎么玩']),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.slide-wrap', null, el('div', { id: 'slide-mount' })),
        tools,
      ]),
    ]));

    view = S.view.create($('#slide-mount'));
    view.onTile(tap);
  }

  function renderStatus() {
    if (!board) return;
    const lv = S.byId(board.level);
    const set = (id, t) => { const n = $('#' + id); if (n) n.textContent = t; };
    set('st-level', lv ? lv.name : '—');
    set('st-time', Util.formatDuration(elapsedMs));
    set('st-moves', String(board.moves));
    const best = Store.best(board.level);
    set('st-best', best ? best.moves + ' 步' : '—');
  }

  function render() {
    if (!board) return;
    if (view) view.render(board, {});
    renderStatus();
  }

  /* ---------------- 计时 ---------------- */
  function startTimer() {
    stopTimer();
    startedAt = Date.now() - elapsedMs;
    const my = session;
    timer = setInterval(() => {
      if (my !== session) return;
      elapsedMs = Date.now() - startedAt;
      renderStatus();
    }, 250);
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---------------- 操作 ---------------- */
  function tap(value) {
    if (!board || board.state === 'won') return;
    let idx = -1;
    for (let i = 0; i < board.cells.length; i++) if (board.cells[i] === value) { idx = i; break; }
    if (idx < 0 || !S.canMove(board, idx)) return;
    // 玩家自己动手了，提示的"上一歩"上下文就作废了——不清的话防回退会误判
    S.hints.reset();
    S.move(board, idx);
    render();
    scheduleSave();
    if (board.state === 'won') finish();
  }

  /** 键盘：按方向键等于把空格那一侧的数字推过来，和大多数滑块游戏的手感一致 */
  function arrowTo(dir) {
    if (!board || board.state === 'won') return;
    const n = board.n, e = board.empty;
    const map = { left: e + 1, right: e - 1, up: e + n, down: e - n };
    const i = map[dir];
    if (i === undefined || i < 0 || i >= n * n) return;
    tap(board.cells[i]);
  }

  function finish() {
    stopTimer();
    board.elapsed = elapsedMs;
    Store.recordWin(board.level, board.moves, elapsedMs);
    Store.addPlay();
    Store.saveGame(null);
    const pts = SD.Points.awardWin('slide', { levelId: board.level, moves: board.moves, ms: elapsedMs });
    const lv = S.byId(board.level);
    const best = Store.best(board.level);
    render();
    renderHome();

    const rows = [
      el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(elapsedMs) })]),
      el('div.kv', null, [el('span', { text: '步数' }), el('b', { text: String(board.moves) })]),
      el('div.kv', null, [el('span', { text: '难度' }), el('b', { text: lv ? lv.name : '—' })]),
      best ? el('div.kv', null, [el('span', { text: '该档最佳' }), el('b', { text: best.moves + ' 步' })]) : null,
    ];
    modal({
      title: '🎉 排好了！',
      body: [
        best && best.moves === board.moves ? el('div.notice.notice-ok', { text: '新纪录！' }) : null,
        el('div.card', null, rows),
        pts ? el('p.points-gain', { text: '+' + pts + ' 通关点数，累计 ' + SD.Points.total() }) : null,
      ],
      footer: [
        { label: '回到首页', onClick: () => SD.Shell.showView('home') },
        { label: '再来一局', primary: true, onClick: () => restart() },
      ],
    });
  }

  /* ---------------- 开局 ---------------- */
  function begin(b, m) {
    board = b;
    meta = m;
    elapsedMs = 0;
    session++;
    render();
    startTimer();
    SD.Shell.showView('game');
    scheduleSave();
  }

  function startLevel(levelId, seed) {
    const lv = S.byId(levelId);
    if (!lv) return;
    begin(S.start(levelId, seed), { levelId: levelId, name: lv.name, seed: seed === undefined ? null : seed });
  }

  function restart() {
    if (!board) return;
    startLevel(board.level, meta && meta.seed !== undefined ? meta.seed : undefined);
  }

  /* ---------------- 提示 ----------------
   * 滑块没有「逻辑上被迫」的一步，所以提示是建议而不是必然结论。
   * 界面上必须说清拿到的是「最优解」还是「就近方向」——混着给等于骗人。
   */
  function showHint() {
    if (!board || board.state === 'won') { toast('这局已经结束了'); return; }
    const h = S.hints.best(board);
    if (!h) { toast('现在没有能走的格子'); return; }
    // 提示算出来的这一步也算"玩家即将走的一步"，清掉上下文避免连点两次互相打架
    const keep = h.cells[0];
    if (view) view.render(board, { hint: h });
    const e = h.explain;
    modal({
      title: '💡 ' + e.name,
      body: [
        el('div.card', null, (e.derivation || []).map((t) => el('p', { text: t }))),
        el('div.mine-concl', { text: e.conclusion }),
        e.pitfalls ? el('p.mine-pitfall', { text: '注意：' + e.pitfalls }) : null,
        el('h4.mine-learn-sub', { text: '技巧原理' }),
        el('p', { text: e.principle }),
      ],
      footer: [
        { label: '只看看', onClick: () => { S.hints.reset(); if (view) view.render(board, {}); } },
        { label: '走这一步', primary: true, onClick: () => { S.move(board, keep); afterMove(); } },
      ],
    });
  }

  /* ---------------- 存档 ---------------- */
  const scheduleSave = U.debounce(() => {
    if (!board || board.state === 'won') return;
    board.elapsed = elapsedMs;
    Store.saveGame(board);
  }, 400);

  function restore() {
    const s = Store.savedGame();
    if (!s) return false;
    const b = S.create(s.n, s.seed);
    b.cells = Int16Array.from(s.cells);
    b.empty = s.empty;
    b.moves = s.moves;
    b.state = S.solved(b) ? 'won' : 'playing';
    b.level = s.level;
    board = b;
    meta = { levelId: s.level, name: (S.byId(s.level) || {}).name || '' };
    elapsedMs = s.elapsed || 0;
    if (b.state !== 'won') startTimer();
    render();
    return true;
  }

  /* ---------------- 绑定 ---------------- */
  function bindPlay() {
    const bind = (id, fn) => { const n = $('#' + id); if (n) n.addEventListener('click', fn); };
    bind('btn-s-hint', showHint);
    bind('btn-s-hint2', showHint);
    bind('btn-s-restart', restart);
    bind('btn-s-restart2', restart);
    bind('btn-s-learn', () => SD.Shell.openPage('数字华容道 · 怎么玩', (r) => renderLearn(r)));
  }

  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (document.querySelector('#dialog-root .modal')) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    arrowTo(dir);
  }

  function bindDocument() {
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => { if (view && board) view.resize(board); }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '为什么一定解得开',
      p: [
        '随便打乱的数字滑块，有一半局面是永远排不回去的——判断依据是逆序数的奇偶性。',
        '这里打乱的做法是「从终局倒着走」：先摆好终局，再随机走几百步。'
        + '每一步都是合法移动，走出来的局面必然能走回去，不用判奇偶，也不用担心开了个死局。',
      ],
    },
    {
      h: '提示为什么分两档',
      p: [
        '3×3 的最优解搜一下就出来，所以给的是「最优下一步」。',
        '4×4 的最优解常常要 50 步以上、5×5 上百步，状态数分别是一万亿和一万亿亿级别，'
        + '实时搜不完。这时候退成「就近一步」，并在弹窗里写明它不保证最短。',
        '滑块不像数独有「逻辑上被迫」的一步，所以这里给的本来就是建议，不是必然结论。'
        + '把两档混着给、不说明白，比不给提示更糟。',
      ],
    },
    {
      h: '成绩怎么算',
      p: [
        '按步数排名，步数相同再看用时。步数是最干净的指标——慢慢想和手忙脚乱是两回事。',
      ],
    },
  ];

  const def = {
    id: 'slide',
    name: '数字华容道',
    tagline: '3×3 到 5×5，把数字推回原位',
    icon: '🔢',
    accent: '#0ea5e9',
    brandSub: 'SLIDE',
    ready: true,
    mount: function (nodes) {
      session++;
      buildHome(nodes.home);
      buildPlay(nodes.play);
      bindPlay();
      bindDocument();
      renderHome();
      if (!board) restore();
      render();
    },
    unmount: function () {
      session++;
      stopTimer();
      if (board && board.state !== 'won') { board.elapsed = elapsedMs; Store.saveGame(board); }
      Store.save();
    },
    onShow: function () { renderHome(); render(); },
    statusLine: function () {
      const st = Store.stats();
      if (!st.wins) return null;
      return '通关 ' + st.wins + ' 局';
    },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  S.app = {
    getBoard: () => board,
    startLevel: startLevel,
    restart: restart,
    tap: tap,
    hint: () => (board ? S.hints.best(board) : null),
    render: render,
  };
})(window);
