/* 数织 · 游戏定义
 *
 * 和其他五款最大的不同：**题目名在对局中不能显示**——画的是什么就是谜底本身。
 * 所以顶栏只显示难度和尺寸，通关后才揭晓名字并把整幅图亮出来。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const U = SD.UI;
  const { $, el, clear, toast, modal } = U;
  const N = SD.Nonogram;
  const Store = N.store;
  const Util = SD.Util;

  const FILLED = N.FILLED, MARKED = N.MARKED, UNKNOWN = N.UNKNOWN;

  let board = null;
  let meta = null;
  let view = null;
  let session = 0;
  let homeRefs = {};
  let elapsedMs = 0;
  let startedAt = 0;
  let timer = null;
  let markMode = false;

  const HOME_MENU = [
    { id: 'easy',   icon: '🟢', sub: '5×5，一眼看出画的什么' },
    { id: 'medium', icon: '🔵', sub: '10×10，纯推理' },
    { id: 'hard',   icon: '🟠', sub: '15×15' },
    { id: 'expert', icon: '🔴', sub: '20×20，耐心活' },
    { id: 'master', icon: '⚫', sub: '光靠行列推不完，得假设' },
  ];

  const pointsFor = (m) => {
    const lv = N.byId(m.levelId);
    return lv ? lv.points : 6;
  };

  /* ---------------- 首页 ---------------- */
  function buildHome(root) {
    root.appendChild(el('div.home-logo', { text: '🖼️' }));
    root.appendChild(el('h1.home-title', { text: '数织' }));
    root.appendChild(el('p.home-sub', { text: '按行列的数字提示，把隐藏的图案一格一格推理出来' }));

    const menu = el('nav.home-menu');
    for (const item of HOME_MENU) {
      const lv = N.byId(item.id);
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
      d.textContent = best ? ('最快 ' + Util.formatDuration(best.ms)) : item.sub;
    }
    if (!homeRefs.stats) return;
    const st = Store.stats();
    const parts = [];
    if (st.wins) parts.push('已解出 ' + st.wins + ' 幅');
    const rev = Store.revealed();
    if (rev.length) parts.push('画册 ' + rev.length + ' 张');
    homeRefs.stats.textContent = parts.join(' · ');
  }

  /** 画册：解出来过的图，按名字列出来 */
  function openGallery() {
    SD.Shell.openPage('画册', (root) => {
      const rev = Store.revealed();
      if (!rev.length) {
        root.appendChild(el('p.lead', { text: '还没有解出过任何一幅。去玩一局吧。' }));
        return;
      }
      root.appendChild(el('p.lead', { text: '共 ' + rev.length + ' 张。点一张可以再玩一次同一幅。' }));
      const list = el('div.gallery');
      for (const it of rev) {
        const pic = N.picById(it.id);
        if (!pic) continue;
        list.appendChild(el('button.gallery-item', {
          onclick: () => {
            const b = N.create(pic);
            b.level = meta && meta.levelId ? meta.levelId : 'medium';
            begin(b, { levelId: b.level, name: pic.name, seed: null, free: true });
          },
        }, [
          el('span.gal-name', { text: it.name }),
          el('span.gal-size', { text: pic.w + '×' + pic.h }),
        ]));
      }
      root.appendChild(list);
    });
  }

  function renderLearn(root) {
    root.appendChild(el('h4.sub-title', { text: '规则' }));
    for (const t of [
      '每一行左边、每一列上边都有一串数字。它表示**这一行/这一列里连续实心段的长度**，按从左到右（上到下）的顺序。',
      '比如一行的提示是「3 1」，就表示这一行里有「连续 3 格实心，中间至少空一格，再连续 1 格实心」，前面后面还可以有空。',
      '把所有实心格都填对就通关——空位不需要一个个标出来。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '怎么操作' }));
    for (const t of [
      '点格子填实心，再点一下取消。',
      '「标记」模式下点格子是打叉（表示"这格确定是空"）——打叉只是给自己做记号，标错了不影响判定。',
      '桌面端右键也可以直接打叉。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '重叠法：数织最该会的一条' }));
    for (const t of [
      '一行有 10 格，提示是「6」。这 6 格可以靠左、靠右、或者停在中间任意位置——光看这一条推不出具体位置。',
      '但把**所有可能的摆法叠在一起看**，正中间那几格在每一种摆法里都被盖住。',
      '心算办法是「长度 × 2 − 行长度」：6 × 2 − 10 = 2，所以中间必有 2 格是铁的。',
      '提示面板会把你正在看的那一行所有摆法叠起来，告诉你哪几格被逼死了——'
      + '这就是数织的全部推理，剩下都是它的重复。',
    ]) root.appendChild(el('p', { text: t }));

    root.appendChild(el('h4.sub-title', { text: '画是从哪来的' }));
    for (const t of [
      '数织和别的品类反过来：**先有画，线索是从画里读出来的**。所以"画从哪来"是这个品类的核心问题。',
      '这里的每张图都离线验过两件事：**解唯一**，以及**光靠行列推理能不能推完**。'
      + '有些图形（比如五角星、斜叉）解是唯一的，但纯推理推不完，必须假设——那些被归到「大师」档。',
      '画册里能看到你已经解出过的图。',
    ]) root.appendChild(el('p', { text: t }));
  }

  /* ---------------- 对局页 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
      el('div.stat', null, [el('span.stat-label', { text: '难度' }), el('b', { id: 'st-level', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '尺寸' }), el('b', { id: 'st-size', text: '—' })]),
      el('div.stat', null, [el('span.stat-label', { text: '用时' }), el('b.mono', { id: 'st-time', text: '00:00' })]),
      el('div.stat', null, [el('span.stat-label', { text: '最快' }), el('b', { id: 'st-best', text: '—' })]),
    ]);
    root.appendChild(SD.Shell.topbar({
      status: status,
      actions: [el('button.btn', { id: 'btn-n-restart', title: '重开一局 (R)', text: '重开' })],
    }));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-n-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-n-mode', title: '切换填色 / 标记 (F)' }, [el('span.tool-ico', { text: '✏️' }), ' 填色']),
      el('button.btn', { id: 'btn-n-check', title: '检查' }, [el('span.tool-ico', { text: '✓' }), ' 检查']),
      el('button.btn', { id: 'btn-n-undo', title: '撤回一歩 (Ctrl+Z)' }, [el('span.tool-ico', { text: '↶' }), ' 撤回']),
      el('button.btn', { id: 'btn-n-restart2', title: '重开一局 (R)' }, [el('span.tool-ico', { text: '↻' }), ' 重开']),
      el('button.btn', { id: 'btn-n-learn', title: '怎么玩' }, [el('span.tool-ico', { text: '📖' }), ' 怎么玩']),
    ]);

    root.appendChild(el('main.layout', null, [
      el('section.board-area', null, [
        el('div.ng-wrap', null, el('div', { id: 'n-mount' })),
        tools,
      ]),
    ]));

    view = N.view.create($('#n-mount'));
    view.onPaint({ start: paintStart, at: paintAt, end: paintEnd });
  }

  function renderStatus() {
    if (!board) return;
    const lv = N.byId(board.level);
    const set = (id, t) => { const n = $('#' + id); if (n) n.textContent = t; };
    set('st-level', lv ? lv.name : '—');
    set('st-size', board.w + '×' + board.h);
    set('st-time', Util.formatDuration(elapsedMs));
    const best = Store.best(board.level);
    set('st-best', best ? Util.formatDuration(best.ms) : '—');
    const mode = $('#btn-n-mode');
    if (mode) {
      mode.classList.toggle('is-on', markMode);
      mode.lastChild.textContent = markMode ? ' 标记' : ' 填色';
    }
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
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

  /* ---------------- 操作 ---------------- */
  /**
   * 拖拽批量填格。
   *
   * 单点一下还是原来的行为（填/取消），但按住划过去会**把划过的格子一起处理**——
   * 20×20 一个个点要六百多次，实在受不了。
   * 操作类型由**第一格**决定：第一格本来是空的就一路填，本来是实心的就一路清。
   * 这样"按住拖过去擦掉一片"和"按住拖过去填一片"都很自然。
   */
  let paintMode = null;

  function paintValue() {
    if (paintMode === 'fill') return FILLED;
    if (paintMode === 'mark') return MARKED;
    return UNKNOWN;
  }

  /**
   * 撤回栈。粒度是**一次操作**（一划、一点、一次"走这一步"），不是一格——
   * 拖过一片之后按撤回，期望的是整片回来，不是一格格退。
   * 快照就一份盘面数组（最多 400 字节），存 50 份也无所谓。
   */
  const undoStack = [];
  const UNDO_MAX = 50;

  function pushUndo() {
    if (!board) return;
    undoStack.push({ cells: Uint8Array.from(board.cells), moves: board.moves });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }

  function undo() {
    if (!board) return;
    const snap = undoStack.pop();
    if (!snap) { toast('没有可撤回的了'); return; }
    board.cells.set(snap.cells);
    board.moves = snap.moves;
    board.state = 'playing';       // 万一刚才那歩刚好收局，撤回之后要能接着玩
    render();
    scheduleSave();
  }

  function paintStart(i, rightClick) {
    if (!board || board.state === 'won') return;
    pushUndo();
    const cur = board.cells[i];
    const asMark = markMode !== !!rightClick;    // 标记模式下左键打叉；普通模式下右键打叉
    if (asMark) paintMode = cur === MARKED ? 'clear' : 'mark';
    else paintMode = cur === FILLED ? 'clear' : 'fill';
    paintAt(i);
  }

  function paintAt(i) {
    if (!board || board.state === 'won' || !paintMode) return;
    const want = paintValue();
    if (board.cells[i] === want) return;
    N.setCell(board, i, want);
    if (view) view.touch(i, want);
  }

  function paintEnd() {
    if (!paintMode) return;
    paintMode = null;
    render();                 // 收尾整块重画：线索灰化之类要跟着更新
    scheduleSave();
    if (N.isComplete(board)) finish();
  }

  /** 单击一格——测试和键盘调用走这条 */
  function onTap(i, e) {
    paintStart(i, e && e.button === 2);
    paintEnd();
  }

  function check() {
    if (!board) return;
    const wrong = N.wrongCells(board);
    if (!wrong.length) toast('目前填的实心格都是对的', 'ok');
    else toast('有 ' + wrong.length + ' 格填错了（不告诉你位置，自己找）', 'err');
  }

  /* ---------------- 提示 ---------------- */
  function showHint() {
    if (!board || board.state === 'won') { toast('这局已经结束了'); return; }
    const step = N.hints.findStep(board);
    if (!step) { toast('行列推理暂时推不动了，试试假设某一格再往下走'); return; }
    if (step.dead) {
      modal({
        title: '⚠️ 这一步走不通',
        body: [el('p', { text: '第 ' + (step.index + 1) + ' ' + (step.axis === 'row' ? '行' : '列')
          + '已经排不出任何合法摆法了，说明前面有格子填错了。' })],
        footer: [{ label: '知道了', primary: true, onClick: () => {} }],
      });
      return;
    }
    const e = N.hints.explain(step, board);
    const idx = step.filled.concat(step.marked).map((k) => N.hints.toBoard(board, step, k));
    for (const i of idx) {
      const c = view.root.querySelectorAll('.ng-cell')[i];
      if (c) c.classList.add('is-ref');
    }
    const clearRef = () => {
      const all = view.root.querySelectorAll('.ng-cell.is-ref');
      for (const c of all) c.classList.remove('is-ref');
    };
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
        { label: '只看看', onClick: clearRef },
        { label: '照做', primary: true, onClick: () => { clearRef(); applyStep(step); } },
      ],
      onClose: clearRef,
    });
  }

  function applyStep(step) {
    if (!board) return;
    pushUndo();
    for (const k of step.filled) {
      const i = N.hints.toBoard(board, step, k);
      if (board.cells[i] === UNKNOWN) N.setCell(board, i, FILLED);
    }
    for (const k of step.marked) {
      const i = N.hints.toBoard(board, step, k);
      if (board.cells[i] === UNKNOWN) N.setCell(board, i, MARKED);
    }
    render();
    scheduleSave();
    if (N.isComplete(board)) finish();
  }

  /* ---------------- 结算 ---------------- */
  function finish() {
    stopTimer();
    board.elapsed = elapsedMs;
    board.state = 'won';
    const better = Store.recordWin(board.level, elapsedMs);
    Store.addPlay();
    if (board.id) Store.markRevealed(board.id, board.name);
    Store.saveGame(null);
    const pts = SD.Points.awardWin('nonogram', { levelId: board.level, size: board.w, name: board.name });
    const lv = N.byId(board.level);
    const best = Store.best(board.level);
    render();
    renderHome();

    // 通关后把整幅图亮出来——这就是数织的回报
    const art = el('div.ng-art');
    const mini = Math.max(4, Math.floor(180 / board.w));
    art.style.gridTemplateColumns = 'repeat(' + board.w + ', ' + mini + 'px)';
    for (let i = 0; i < board.w * board.h; i++) {
      const c = el('i');
      c.style.width = mini + 'px';
      c.style.height = mini + 'px';
      c.style.background = board.solution[i] ? 'var(--accent)' : 'transparent';
      art.appendChild(c);
    }

    modal({
      title: '🎉 解出来了：' + board.name,
      body: [
        el('div.ng-art-wrap', null, art),
        better ? el('div.notice.notice-ok', { text: '新纪录！' }) : null,
        el('div.card', null, [
          el('div.kv', null, [el('span', { text: '用时' }), el('b', { text: Util.formatDuration(elapsedMs) })]),
          el('div.kv', null, [el('span', { text: '尺寸' }), el('b', { text: board.w + '×' + board.h })]),
          el('div.kv', null, [el('span', { text: '难度' }), el('b', { text: lv ? lv.name : '—' })]),
          best ? el('div.kv', null, [el('span', { text: '该档最快' }), el('b', { text: Util.formatDuration(best.ms) })]) : null,
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
    session++;
    undoStack.length = 0;       // 换了一局，旧的撤回记录没意义了
    if (view) view.render(board, {});
    renderStatus();
    startTimer();
    SD.Shell.showView('game');
    scheduleSave();
  }

  function startLevel(levelId, seed) {
    const lv = N.byId(levelId);
    if (!lv) return;
    const b = N.generate(levelId, seed);
    if (!b) { toast('这一档暂时没有可用图'); return; }
    begin(b, { levelId: levelId, name: b.name, seed: seed === undefined ? null : seed });
  }

  function restart() {
    if (!board) return;
    // 画廊里点进来的自由局没有关卡，重开就重开同一张图
    if (meta && meta.free) {
      const pic = N.picById(board.id);
      if (pic) { const nb = N.create(pic); nb.level = board.level; begin(nb, meta); return; }
    }
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
    const pic = N.picById(s.picId);
    if (!pic) { Store.clearSaved(); return false; }
    const b = N.create(pic);
    b.cells = Uint8Array.from(s.cells);
    b.moves = s.moves || 0;
    b.level = s.level;
    board = b;
    meta = { levelId: b.level, name: pic.name, seed: s.seed };
    elapsedMs = s.elapsed || 0;
    if (view) view.render(board, {});
    renderStatus();
    startTimer();
    return true;
  }

  /* ---------------- 绑定 ---------------- */
  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (document.querySelector('#dialog-root .modal')) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleMode(); }
    else if (e.key === 'h' || e.key === 'H') { e.preventDefault(); showHint(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); restart(); }
  }

  function toggleMode() {
    markMode = !markMode;
    Store.set('markMode', markMode);
    renderStatus();
  }

  function bindPlay() {
    const bind = (id, fn) => { const n = $('#' + id); if (n) n.addEventListener('click', fn); };
    bind('btn-n-hint', showHint);
    bind('btn-n-mode', toggleMode);
    bind('btn-n-check', check);
    bind('btn-n-undo', undo);
    bind('btn-n-restart', restart);
    bind('btn-n-restart2', restart);
    bind('btn-n-learn', () => SD.Shell.openPage('数织 · 怎么玩', (r) => renderLearn(r)));
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => { if (view && board) { view.resize(board); view.render(board, {}); } }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '画是从哪来的',
      p: [
        '数织和别的品类反过来：**先有画，线索是从画里读出来的**。所以"画从哪来"是这个品类的核心问题，'
        + '不是随便生成一张网格就能当题。',
        '这里的每张图都离线验过两件事：解唯一，以及光靠行列推理能不能推完。'
        + '有些图形（五角星、斜叉）解是唯一的，但纯推理推不完，必须假设——那些被归到「大师」档。',
        '几何图形用公式画（爱心、星星、圆环…），任意尺寸都能生成且不走样；'
        + '具体物件手绘成字符画——公式画不出"像猫"这种东西。',
      ],
    },
    {
      h: '为什么有的图需要假设',
      p: [
        '数织的推理只有一件事：把一行（或一列）线索的所有合法摆法列出来，逐格看结论是否一致。',
        '多数图光靠这个就能推完。但线索稀疏的大图，推到最后会剩下几格怎么都定不下来——'
        + '这时候只能假设一格、往下推、看会不会矛盾。',
        '这不是题目坏了，是它本来就难。',
      ],
    },
    {
      h: '打叉有什么用',
      p: [
        '打叉只是给自己做记号，标错了不影响判定——真正决定输赢的只有实心格填得对不对。',
        '但记号能大幅减少心算量：确定是空的格子标掉，再看线索时就不用反复排除了。',
      ],
    },
  ];

  const def = {
    id: 'nonogram',
    name: '数织',
    tagline: '按线索推理出隐藏的图案',
    icon: '🖼️',
    accent: '#7c3aed',
    brandSub: 'NONOGRAM',
    ready: true,
    mount: function (nodes) {
      session++;
      markMode = !!Store.settings().markMode;
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
      if (board && board.state !== 'won') { board.elapsed = elapsedMs; Store.saveGame(board); }
      Store.flush();
    },
    onShow: function () { renderHome(); render(); },
    statusLine: function () {
      const st = Store.stats();
      if (!st.wins) return null;
      const rev = Store.revealed();
      return rev.length ? ('画册 ' + rev.length + ' 张') : ('解出 ' + st.wins + ' 幅');
    },
    settings: function (root, ctx) {
      root.appendChild(el('h4.sub-title', { text: '操作' }));
      root.appendChild(el('label.switch.setting', null, [
        el('input', {
          type: 'checkbox',
          checked: !!Store.settings().markMode,
          onchange: (e) => { Store.set('markMode', e.target.checked); markMode = e.target.checked; renderStatus(); },
        }),
        el('span', null, [
          el('b', { text: '默认用标记模式' }),
          el('small', { text: '打开后点格子是打叉。关着的时候：点格子填实心，桌面右键打叉' }),
        ]),
      ]));
      root.appendChild(el('button.btn', { text: '打开画册', onclick: () => openGallery() }));
    },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  N.app = {
    getBoard: () => board,
    startLevel: startLevel,
    restart: restart,
    tap: onTap,
    hint: () => (board ? N.hints.findStep(board) : null),
    check: check,
    gallery: openGallery,
    setMarkMode: (v) => { markMode = !!v; renderStatus(); },
    render: render,
  };
})(window);
