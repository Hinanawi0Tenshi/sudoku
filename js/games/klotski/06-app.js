/* 华容道 · 游戏定义
 *
 * 交互是拖不是点：按住一块往某个方向拖，够一格就滑一格。也支持点选 + 方向键。
 * 提示**永远是最优解**——全状态表在手，不用退而求其次，这一点和数字华容道/2048 都不同。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const U = SD.UI;
  const { $, el, clear, toast, modal } = U;
  const K = SD.Klotski;
  const Store = K.store;
  const Util = SD.Util;

  let board = null;
  let meta = null;
  let view = null;
  let session = 0;
  let homeRefs = {};
  let elapsedMs = 0;
  let startedAt = 0;
  let timer = null;
  let selected = -1;
  let drag = null;

  const HOME_MENU = [
    { id: 'easy',   icon: '🟢', sub: '几步就能摆平' },
    { id: 'medium', icon: '🔵', sub: '需要想一下顺序' },
    { id: 'hard',   icon: '🟠', sub: '腾挪空间开始紧张' },
    { id: 'expert', icon: '🔴', sub: '一步错就得重来' },
    { id: 'master', icon: '⚫', sub: '经典「横刀立马」就在这一档' },
  ];

  const pointsFor = (m) => {
    const lv = K.byId(m.levelId);
    return lv ? lv.points : 8;
  };

  /* ---------------- 首页 ---------------- */
  function buildHome(root) {
    root.appendChild(el('div.home-logo', { text: '🀄' }));
    root.appendChild(el('h1.home-title', { text: '华容道' }));
    root.appendChild(el('p.home-sub', { text: '把曹操挪到底部出口，其余各块只能平移' }));

    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const lv = K.byId(item.id);
      const desc = el('span.hi-desc', { text: item.sub });
      homeRefs[item.id] = desc;
      menu.appendChild(el('button.home-item', {
        dataset: { go: item.id },
        onclick: () => startLevel(item.id),
      }, [el('span.hi-label', { text: item.icon + ' ' + lv.name }), desc]));
    }
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
        ? ('最好 ' + best.moves + ' 步 · ' + Util.formatDuration(best.ms))
        : item.sub;
    }
    if (!homeRefs.stats) return;
    const st = Store.stats();
    homeRefs.stats.textContent = st.wins ? ('通关 ' + st.wins + ' 局 · 开局 ' + st.plays + ' 次') : '';
  }

  function renderLearn(root) {
    root.appendChild(el('h4.sub-title', { text: '规则' }));
    for (const t of [
      '盘上有一块 2×2 的**曹操**、五块 1×2 或 2×1 的**大将**、四块 1×1 的**小兵**，还剩两格空。',
      '所有块只能上下左右平移，不能旋转、不能重叠、不能出界。',
      '把曹操挪到底部中间的出口就算赢。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '怎么操作' }));
    for (const t of [
      '按住一块往某个方向拖，够一格就滑一格，可以连着拖。',
      '也可以先点一块选中，再按方向键。',
      '只点一下不拖：如果这块只有一个方向能动，就直接帮它走一步。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '为什么这里的提示一定是最优的' }));
    for (const t of [
      '这个游戏的可达局面**只有两万多个**。所以程序开局时就把所有局面到出口的最短步数'
      + '一次性全算了出来（两遍广度优先，约 0.1 秒）。',
      '有了这张表，提示就是**沿最短路径走一步**——永远最优，不存在「算不动就退而求其次」。'
      + '难度也是从表里直接读出来的精确值，不是估的。',
      '经典布局「横刀立马」的最短解是 **116 步**（按走一格算一步），就在最高档里。',
    ]) root.appendChild(el('p', { text: t }));
  }

  /* ---------------- 对局页 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
      el('div.stat', null, [el('span.stat-label', { text: '难度' }), el('b', { id: 'st-level', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '步数' }), el('b', { id: 'st-moves', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '用时' }), el('b.mono', { id: 'st-time', text: '00:00' })]),
      el('div.stat', null, [el('span.stat-label', { text: '最佳' }), el('b', { id: 'st-best', text: '—' })]),
    ]);
    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [el('button.btn', { id: 'btn-k-restart', title: '重开一局 (R)', text: '重开' })],
    }));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-k-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-k-restart2', title: '重开一局 (R)' }, [el('span.tool-ico', { text: '↻' }), ' 重开']),
      el('button.btn', { id: 'btn-k-learn', title: '怎么玩' }, [el('span.tool-ico', { text: '📖' }), ' 怎么玩']),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.k-wrap', null, el('div', { id: 'k-mount' })),
        tools,
        el('p.k-tip', { text: '把曹操挪到底部缺口那里就算赢 · 按住块往空位方向拖，也可以点选后按方向键' }),
      ]),
    ]));

    view = K.view.create($('#k-mount'));
    view.onPick(onPick);
  }

  function renderStatus() {
    if (!board) return;
    const lv = K.byId(board.level);
    const set = (id, t) => { const n = $('#' + id); if (n) n.textContent = t; };
    set('st-level', lv ? lv.name : '—');
    set('st-moves', String(board.moves));
    set('st-time', Util.formatDuration(elapsedMs));
    const best = Store.best(board.level);
    set('st-best', best ? best.moves + ' 步' : '—');
  }

  function render() {
    if (!board) return;
    if (view) view.render(board, { selected: selected, hint: null });
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
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  /* ---------------- 操作 ---------------- */
  function legalDirs(i) {
    const out = [];
    for (const d of K.DIRS) if (K.canShift(board, i, d[0], d[1])) out.push(d);
    return out;
  }

  function doShift(i, dr, dc) {
    if (!K.shift(board, i, dr, dc)) return false;
    selected = i;
    afterMove();
    return true;
  }

  function afterMove() {
    render();
    scheduleSave();
    if (board.state === 'won') finish();
  }

  function onPick(i, e) {
    if (!board || board.state === 'won') return;
    selected = i;
    drag = { index: i, x: e.clientX, y: e.clientY, moved: false };
    if (e && e.pointerId !== undefined && view.root.setPointerCapture) {
      try { view.root.setPointerCapture(e.pointerId); } catch (err) { /* 某些浏览器不支持，忽略 */ }
    }
    render();
  }

  function onPointerMove(e) {
    if (!drag || !board || board.state === 'won') return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const th = Math.max(14, view.cellSize() * 0.4);
    if (Math.abs(dx) < th && Math.abs(dy) < th) return;
    let dr = 0, dc = 0;
    if (Math.abs(dx) > Math.abs(dy)) dc = dx > 0 ? 1 : -1;
    else dr = dy > 0 ? 1 : -1;
    if (doShift(drag.index, dr, dc)) {
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = true;
    }
  }

  function onPointerUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    // 只点了一下没拖：这块如果只有一个方向能动，就替玩家走一步
    if (!d.moved && board && board.state !== 'won') {
      const dirs = legalDirs(d.index);
      if (dirs.length === 1) doShift(d.index, dirs[0][0], dirs[0][1]);
    }
  }

  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (document.querySelector('#dialog-root .modal')) return;
    const map = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
      W: [-1, 0], S: [1, 0], A: [0, -1], D: [0, 1],
    };
    const mv = map[e.key];
    if (!mv) return;
    e.preventDefault();
    if (selected < 0 || !board) {
      // 没选块时，按方向键选第一块能动的那块——省得玩家先点一下
      for (let i = 0; i < board.pieces.length; i++) {
        if (K.canShift(board, i, mv[0], mv[1])) { selected = i; doShift(i, mv[0], mv[1]); return; }
      }
      return;
    }
    doShift(selected, mv[0], mv[1]);
  }

  /* ---------------- 提示 ----------------
   * 全状态表在手，这里**永远是最优解**，不需要像数字华容道/2048 那样分档降级。
   */
  function showHint() {
    if (!board || board.state === 'won') { toast('这局已经结束了'); return; }
    const m = K.solver.bestMove(board);
    if (!m) { toast('曹操已经在出口了'); return; }
    const NAME = { up: '上', down: '下', left: '左', right: '右' };
    if (view) view.render(board, { selected: selected, hint: m });
    modal({
      title: '💡 最优下一步',
      body: [
        el('div.card', null, [
          el('p', { text: '把「' + m.name + '」往' + NAME[m.dir] + '挪一格。' }),
          el('div.kv', null, [el('span', { text: '这一步之后最少还要' }), el('b', { text: m.remain - 1 + ' 步' })]),
        ]),
        el('div.mine-concl', { text: '挪「' + m.name + '」往' + NAME[m.dir] + '。' }),
        el('h4.mine-learn-sub', { text: '为什么这个一定最优' }),
        el('p', { text: '这个游戏的可达局面只有两万多个，程序已经把**每个局面到出口的最短步数**'
          + '全算出来了。所以提示就是沿着最短路径走一步——不是估的，是查表查出来的。' }),
        el('p.mine-pitfall', { text: '注意：最短解经常要先把某块往远离出口的方向挪，好给曹操腾位置。'
          + '看着"退了一步"不代表走错了。' }),
      ],
      footer: [
        { label: '只看看', onClick: () => { if (view) view.render(board, { selected: selected }); } },
        { label: '走这一步', primary: true, onClick: () => doShift(m.index, m.dr, m.dc) },
      ],
    });
  }

  /* ---------------- 结算 ---------------- */
  function finish() {
    stopTimer();
    board.elapsed = elapsedMs;
    const better = Store.recordWin(board.level, board.moves, elapsedMs, board.distance);
    Store.addPlay();
    Store.saveGame(null);
    const pts = SD.Points.awardWin('klotski', { levelId: board.level, moves: board.moves, distance: board.distance });
    const lv = K.byId(board.level);
    const best = Store.best(board.level);
    render();
    renderHome();

    modal({
      title: '🎉 曹操出关了！',
      body: [
        better ? el('div.notice.notice-ok', { text: '新纪录！' }) : null,
        el('div.card', null, [
          el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(elapsedMs) })]),
          el('div.kv', null, [el('span', { text: '你的步数' }), el('b', { text: String(board.moves) })]),
          el('div.kv', null, [el('span', { text: '最少步数' }), el('b', { text: String(board.distance) })]),
          el('div.kv', null, [el('span', { text: '难度' }), el('b', { text: lv ? lv.name : '—' })]),
          best ? el('div.kv', null, [el('span', { text: '该档最佳' }), el('b', { text: best.moves + ' 步' })]) : null,
        ]),
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
    selected = -1;
    drag = null;
    session++;
    if (view) view.render(board, { selected: selected });
    renderStatus();
    startTimer();
    SD.Shell.showView('game');
    scheduleSave();
  }

  function startLevel(levelId, seed) {
    const lv = K.byId(levelId);
    if (!lv) return;
    // 第一次进华容道要把全状态表算出来（约 0.1 秒，同步）。先弹遮罩让浏览器有机会
    // 把这一帧画出来，否则玩家看到的是"点了没反应，然后盘面突然出现"。
    if (!K.solver.isReady()) {
      SD.Shell.overlay('正在准备棋盘…', '第一次进华容道要先算出所有局面的最短步数，约 0.1 秒。');
      setTimeout(() => {
        const b = K.generate(levelId, seed);
        SD.Shell.hideOverlay();
        if (!b) { toast('这一档暂时没有可用局面'); return; }
        begin(b, { levelId: levelId, name: lv.name, seed: seed === undefined ? null : seed });
      }, 30);
      return;
    }
    const b = K.generate(levelId, seed);
    if (!b) { toast('这一档暂时没有可用局面'); return; }
    begin(b, { levelId: levelId, name: lv.name, seed: seed === undefined ? null : seed });
  }

  function restart() {
    if (!board) return;
    startLevel(board.level, meta && meta.seed !== undefined && meta.seed !== null ? meta.seed : undefined);
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
    const b = K.create(s.pieces);
    b.level = s.level;
    b.distance = s.distance;
    b.moves = s.moves || 0;
    b.seed = s.seed;
    b.state = 'playing';
    board = b;
    meta = { levelId: b.level, name: (K.byId(b.level) || {}).name || '', seed: s.seed };
    elapsedMs = s.elapsed || 0;
    selected = -1;
    if (view) view.render(board, { selected: selected });
    renderStatus();
    startTimer();
    return true;
  }

  /* ---------------- 绑定 ---------------- */
  function bindPlay() {
    const bind = (id, fn) => { const n = $('#' + id); if (n) n.addEventListener('click', fn); };
    bind('btn-k-hint', showHint);
    bind('btn-k-restart', restart);
    bind('btn-k-restart2', restart);
    bind('btn-k-learn', () => SD.Shell.openPage('华容道 · 怎么玩', (r) => renderLearn(r)));
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => { if (view && board) view.resize(board); }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '提示为什么一定是最优的',
      p: [
        '这个游戏的可达局面只有两万多个，是所有滑块类里最小的。',
        '所以程序在开局时就把**每个局面到出口的最短步数**全部算了出来（两遍广度优先，约 0.1 秒），'
        + '提示只是沿最短路径走一步。',
        '这跟数字华容道、2048 不一样——那两款的搜索空间大到实时搜不完，只能给"建议"。'
        + '这里给的是**精确最优解**。',
      ],
    },
    {
      h: '难度是算出来的，不是估的',
      p: [
        '有了那张全状态表，一个局面有多难 = 它离出口最少几步。这是精确值。',
        '所以出题也很简单：按距离区间筛一个局面出来就行，不用"切、验、评级"三步。',
        '经典布局「横刀立马」是 116 步（按走一格算一步），在最高档里。',
      ],
    },
    {
      h: '为什么最短解经常看着像绕远路',
      p: [
        '曹操要往下走，但它前面被大将和兵堵着。得先把这些块挪开，才有位置让它过。',
        '所以最优解里经常出现"把某块往反方向挪"的动作——那不是走错，是在腾位置。',
      ],
    },
  ];

  const def = {
    id: 'klotski',
    name: '华容道',
    tagline: '把曹操挪出重围',
    icon: '🀄',
    accent: '#b45309',
    brandSub: 'KLOTSKI',
    ready: true,
    mount: function (nodes) {
      session++;
      buildHome(nodes.home);
      buildPlay(nodes.play);
      bindPlay();
      renderHome();
      if (!board) restore();
      render();
    },
    unmount: function () {
      session++;
      stopTimer();
      drag = null;
      if (board && board.state !== 'won') { board.elapsed = elapsedMs; Store.saveGame(board); }
      Store.flush();
    },
    onShow: function () { renderHome(); render(); },
    statusLine: function () {
      const st = Store.stats();
      return st.wins ? ('通关 ' + st.wins + ' 局') : null;
    },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  K.app = {
    getBoard: () => board,
    startLevel: startLevel,
    restart: restart,
    shift: doShift,
    hint: () => (board ? K.solver.bestMove(board) : null),
    distance: () => (board ? K.solver.distanceOf(board.pieces) : -1),
    select: (i) => { selected = i; render(); },
    render: render,
  };
})(window);
