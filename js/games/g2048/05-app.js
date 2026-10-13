/* 2048 · 游戏定义
 *
 * 结构照抄数字华容道/扫雷：首页选档位 → 对局页顶栏 + 盘面 + 工具栏 → 结算弹窗。
 * 平台层一行没改。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const U = SD.UI;
  const { $, el, clear, toast, modal } = U;
  const G = SD.G2048;
  const Store = G.store;
  const Util = SD.Util;

  let board = null;
  let meta = null;
  let view = null;
  let session = 0;
  let homeRefs = {};
  let elapsedMs = 0;
  let startedAt = 0;
  let timer = null;
  let wonShown = false;
  let rng = null;

  const HOME_MENU = [
    { id: 'tiny', icon: '🔹', sub: '九格小盘，目标 256' },
    { id: 'classic', icon: '🔸', sub: '经典四乘四，目标 2048' },
    { id: 'large', icon: '🔶', sub: '二十五格大盘，目标 4096' },
  ];

  function pointsFor(m) {
    const lv = G.byId(m.levelId);
    if (!lv) return 10;
    // 2048 的目标越大越难，但同一档里分数还能继续涨，所以按目标给基础分
    return lv.points;
  }

  /* ---------------- 首页 ---------------- */
  function buildHome(root) {
    root.appendChild(el('div.home-logo', { text: '🔢' }));
    root.appendChild(el('h1.home-title', { text: '2048' }));
    root.appendChild(el('p.home-sub', { text: '方向键推牌，相同的两块碰在一起就翻倍' }));

    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const lv = G.byId(item.id);
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
      d.textContent = best ? ('最高 ' + best + ' 分') : item.sub;
    }
    if (!homeRefs.stats) return;
    const st = Store.stats();
    const parts = [];
    if (st.plays) parts.push('开局 ' + st.plays + ' 次');
    if (st.maxTile) parts.push('最大牌 ' + st.maxTile);
    homeRefs.stats.textContent = parts.join(' · ');
  }

  /* ---------------- 对局页 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
      el('div.stat', null, [el('span.stat-label', { text: '得分' }), el('b', { id: 'st-score', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '最高' }), el('b', { id: 'st-best', text: '0' })]),
      el('div.stat', null, [el('span.stat-label', { text: '最大牌' }), el('b', { id: 'st-max', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '步数' }), el('b.mono', { id: 'st-moves', text: '0' })]),
    ]);
    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [el('button.btn', { id: 'btn-g-restart', title: '重开一局 (R)', text: '重开' })],
    }));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-g-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-g-restart2', title: '重开一局 (R)' }, [el('span.tool-ico', { text: '↻' }), ' 重开']),
      el('button.btn', { id: 'btn-g-learn', title: '怎么玩' }, [el('span.tool-ico', { text: '📖' }), ' 怎么玩']),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.g-wrap', null, el('div', { id: 'g-mount' })),
        tools,
        el('p.g-tip', { text: '方向键 / WASD 推牌，手机上直接滑' }),
      ]),
    ]));

    view = G.view.create($('#g-mount'));
  }

  function renderLearn(root) {
    root.appendChild(el('h4.sub-title', { text: '规则' }));
    for (const t of [
      '每次往一个方向推，所有牌一起滑到底。',
      '两块**数字相同**的牌撞在一起就合并成一块，数字翻倍，得分加上合并后的值。',
      '每推一次，空位里会多出一块新牌：90% 是 2，10% 是 4。',
      '推出目标数字就算赢（4×4 是 2048），但可以继续打；没位置可推也没得合并就结束。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '为什么不能只盯着一边推' }));
    for (const t of [
      '只往一个方向推会很快把牌挤死。稳的打法是**把最大的牌固定在一个角上**，'
      + '然后让其余牌按大小顺序排开，始终留着空位腾挪。',
      '提示就是按这个思路算的：它给每个方向估一个期望分，'
      + '其中「空位数」权重最高，「单调性」（牌是否按顺序排开）次之。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '提示是怎么算的' }));
    for (const t of [
      '2048 每一步都有随机成分——新牌落在哪、是 2 还是 4，都不由你决定。'
      + '所以不能像棋类那样做极小极大，得用**期望最大化**：'
      + '玩家节点取最大，随机节点按概率加权取平均。',
      '它给的是**期望分最高的方向**，不是保证最优。'
      + '所以提示写的是「建议」——2048 本来就没有必赢的走法。',
    ]) root.appendChild(el('p', { text: t }));
  }

  function renderStatus() {
    if (!board) return;
    const set = (id, t) => { const n = $('#' + id); if (n) n.textContent = t; };
    set('st-score', String(board.score));
    set('st-best', String(Store.best(board.level)));
    set('st-max', board.score ? String(G.maxTile(board)) : '—');
    set('st-moves', String(board.moves));
  }

  function render() {
    if (!board) return;
    if (view) view.settle(board);
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
    }, 500);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  /* ---------------- 推牌 ---------------- */
  function doMove(dir) {
    if (!board || board.state === 'over') return false;
    const delta = G.move(board, dir);
    if (!delta) return false;
    const sp = G.spawn(board, rng);
    const st = G.settle(board);
    if (view) view.animate(board, delta, sp ? sp.index : -1);
    renderStatus();
    scheduleSave();
    if (st === 'won' && !wonShown) { wonShown = true; setTimeout(showWin, 260); }
    else if (st === 'over') setTimeout(showOver, 300);
    return true;
  }

  const KEYMAP = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    a: 'left', d: 'right', w: 'up', s: 'down',
    A: 'left', D: 'right', W: 'up', S: 'down',
  };

  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (document.querySelector('#dialog-root .modal')) return;
    const dir = KEYMAP[e.key];
    if (!dir) return;
    e.preventDefault();
    doMove(dir);
  }

  /* ---------------- 结算 ---------------- */
  function showWin() {
    const pts = SD.Points.awardWin('g2048', { levelId: board.level, score: board.score, target: board.target });
    Store.record(board.level, board.score, G.maxTile(board));
    renderHome();
    renderStatus();
    modal({
      title: '🎉 到 ' + board.target + ' 了！',
      body: [
        el('div.card', null, [
          el('div.kv', null, [el('span', { text: '得分' }), el('b', { text: String(board.score) })]),
          el('div.kv', null, [el('span', { text: '步数' }), el('b', { text: String(board.moves) })]),
          el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(elapsedMs) })]),
        ]),
        pts ? el('p.points-gain', { text: '+' + pts + ' 通关点数，累计 ' + SD.Points.total() }) : null,
        el('p', { text: '还能接着打——继续刷新分数，或者重开一局。' }),
      ],
      footer: [
        { label: '重开一局', onClick: () => restart() },
        { label: '接着打', primary: true, onClick: () => {} },
      ],
    });
  }

  function showOver() {
    stopTimer();
    board.elapsed = elapsedMs;
    const better = Store.record(board.level, board.score, G.maxTile(board));
    Store.addPlay();
    Store.saveGame(null);
    renderHome();
    renderStatus();
    modal({
      title: '没有可推的方向了',
      body: [
        better ? el('div.notice.notice-ok', { text: '新纪录！' }) : null,
        el('div.card', null, [
          el('div.kv', null, [el('span', { text: '得分' }), el('b', { text: String(board.score) })]),
          el('div.kv', null, [el('span', { text: '最大牌' }), el('b', { text: String(G.maxTile(board)) })]),
          el('div.kv', null, [el('span', { text: '步数' }), el('b', { text: String(board.moves) })]),
          el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(elapsedMs) })]),
          el('div.kv', null, [el('span', { text: '该档最高' }), el('b', { text: String(Store.best(board.level)) })]),
        ]),
      ],
      footer: [
        { label: '回到首页', onClick: () => SD.Shell.showView('home') },
        { label: '再来一局', primary: true, onClick: () => restart() },
      ],
    });
  }

  /* ---------------- 提示 ----------------
   * 2048 有随机成分，没有"必然正确"的一步，所以提示是建议而不是结论。
   * 界面上写成「建议」而不是「最优」。
   */
  function showHint() {
    if (!board || board.state === 'over') { toast('这局已经结束了'); return; }
    const rank = G.solver.rank(board, 3);
    if (!rank.length) { toast('没有能推的方向了'); return; }
    const best = rank[0];
    const NAME = { left: '往左', right: '往右', up: '往上', down: '往下' };
    const empty = G.emptyCells(board).length;
    modal({
      title: '💡 建议 ' + NAME[best.dir],
      body: [
        el('div.card', null, [
          el('p', { text: '把四个方向各推一遍，往后算几步、把随机落牌按概率加权，'
            + '估出来的期望分是这样的：' }),
          el('div.g-rank', null, rank.map((r) => el('div.kv', null, [
            el('span', { text: NAME[r.dir] + (r.dir === best.dir ? '（建议）' : '') }),
            el('b', { text: Math.round(r.expect) }),
          ]))),
        ]),
        el('div.mine-concl', { text: '推' + NAME[best.dir].slice(1) + '。' }),
        el('h4.mine-learn-sub', { text: '技巧原理' }),
        el('p', { text: '这个估值里权重最高的是**空位数**——留着空位才有腾挪余地；'
          + '其次是**单调性**，也就是让牌沿着一个方向从大到小排开，'
          + '这样新牌冒出来时不会把大牌堵死。' }),
        el('p.mine-pitfall', { text: '注意：这是**期望分最高**的方向，不是保证最优。'
          + '2048 每一步都有随机落牌，本来就不存在必赢的走法。当前空位 ' + empty + ' 个。' }),
      ],
      footer: [
        { label: '只看看', onClick: () => {} },
        { label: '推这一步', primary: true, onClick: () => doMove(best.dir) },
      ],
    });
  }

  /* ---------------- 开局 ---------------- */
  function begin(b, m) {
    board = b;
    meta = m;
    elapsedMs = 0;
    wonShown = b.state === 'won';
    rng = Util.makeRng('g2048|' + (b.seed || '') + '|' + Date.now());
    session++;
    if (view) view.settle(board);
    renderStatus();
    startTimer();
    SD.Shell.showView('game');
    scheduleSave();
  }

  function startLevel(levelId, seed) {
    const lv = G.byId(levelId);
    if (!lv) return;
    begin(G.start(levelId, seed), { levelId: levelId, name: lv.name, seed: seed === undefined ? null : seed });
  }

  function restart() {
    if (!board) return;
    startLevel(board.level, meta && meta.seed !== undefined && meta.seed !== null ? meta.seed : undefined);
  }

  /* ---------------- 存档 ---------------- */
  const scheduleSave = U.debounce(() => {
    if (!board || board.state === 'over') return;
    board.elapsed = elapsedMs;
    Store.saveGame(board);
  }, 400);

  function restore() {
    const s = Store.savedGame();
    if (!s) return false;
    const b = G.create(s.size, s.seed);
    b.cells = Int16Array.from(s.cells);
    b.score = s.score || 0;
    b.moves = s.moves || 0;
    b.target = s.target || 2048;
    b.level = s.level || 'classic';
    b.state = 'playing';
    board = b;
    meta = { levelId: b.level, name: (G.byId(b.level) || {}).name || '', seed: s.seed };
    elapsedMs = s.elapsed || 0;
    wonShown = G.maxTile(b) >= b.target;
    rng = Util.makeRng('g2048|' + (b.seed || '') + '|resume');
    if (view) view.settle(board);
    renderStatus();
    startTimer();
    return true;
  }

  /* ---------------- 触摸滑动 ---------------- */
  let touchStart = null;
  function bindTouch() {
    const box = view.root;
    box.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY, at: Date.now() };
    }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      touchStart = null;
      if (Math.max(adx, ady) < 24) return;      // 太短，当点击忽略
      doMove(adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    }, { passive: true });
  }

  /* ---------------- 绑定 ---------------- */
  function bindPlay() {
    const bind = (id, fn) => { const n = $('#' + id); if (n) n.addEventListener('click', fn); };
    bind('btn-g-hint', showHint);
    bind('btn-g-restart', restart);
    bind('btn-g-restart2', restart);
    bind('btn-g-learn', () => SD.Shell.openPage('2048 · 怎么玩', (r) => renderLearn(r)));
    bindTouch();
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => { if (view && board) view.resize(board); }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '为什么提示写「建议」不写「最优」',
      p: [
        '2048 每一步都有随机成分——新牌落在哪个空位、是 2 还是 4，都不由玩家决定。'
        + '所以不存在「这一步之后必胜」的走法。',
        '提示用的是期望最大化：玩家节点取最大，随机节点按 0.9 / 0.1 的概率加权取平均，'
        + '往后算三步。它给的是期望分最高的方向。',
        '把建议写成结论，比不给提示更糟。',
      ],
    },
    {
      h: '估值看什么',
      p: [
        '权重最高的是空位数——留着空位才有腾挪余地，一盘挤死就完了。',
        '其次是单调性：让牌沿着一个方向从大到小排开，新牌冒出来时不容易把大牌堵死。',
        '最后是平滑度：相邻两块的数值别差太远，差太远说明排布是乱的。',
      ],
    },
    {
      h: '稳的打法',
      p: [
        '把最大的牌固定在一个角上，之后尽量别往那个角的反方向推。',
        '其余牌按大小顺序沿着一行或一列排开，始终留出一两条空行当缓冲区。',
        '三档难度只是棋盘大小和目标不同，打法是一样的。',
      ],
    },
  ];

  const def = {
    id: 'g2048',
    name: '2048',
    tagline: '推牌合并，凑出 2048',
    icon: '🔢',
    accent: '#edc22e',
    brandSub: '2048',
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
      if (board && board.state !== 'over') { board.elapsed = elapsedMs; Store.saveGame(board); }
      Store.flush();
    },
    onShow: function () { renderHome(); render(); },
    statusLine: function () {
      const st = Store.stats();
      if (!st.plays) return null;
      return st.maxTile ? ('最大牌 ' + st.maxTile) : ('开局 ' + st.plays + ' 次');
    },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  G.app = {
    getBoard: () => board,
    startLevel: startLevel,
    restart: restart,
    move: doMove,
    hint: () => (board ? (G.solver.rank(board, 3)[0] || null) : null),
    rank: () => (board ? G.solver.rank(board, 3) : []),
    render: render,
  };
})(window);
