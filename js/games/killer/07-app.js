/* 杀手数独 · 游戏装配
 *
 * 和数独共用 js/core 那一套（棋盘、求解器原语、技巧引擎、对局控制器、棋盘渲染），
 * 差别在于：候选数多了一层笼子约束、冲突判定要把笼和算进去、提示引擎换成带笼子的版本。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const B = SD.Base;
  const U = SD.UI;
  const { $, $$, el, clear, toast, modal, confirm } = U;
  const K = SD.Killer;
  const Store = K.store;
  const KS = K.solver;
  const KG = K.generator;
  const KT = K.techniques;
  const KH = K.hints;
  const Util = SD.Util;

  let puz = null;
  let meta = null;
  let game = null;
  let view = null;
  let hintList = [];
  let hintIndex = 0;
  let mistakeAsked = false;
  let calMonth = null;
  let session = 0;
  let homeRefs = {};

  /**
   * 一局通关值多少点数。杀手比数独费脑子得多（一道题平均要走一百步），
   * 所以分档整体比数独高。
   */
  const WIN_POINTS = { easy: 8, medium: 18, hard: 35, expert: 60, master: 100 };
  function pointsFor(m) {
    const base = WIN_POINTS[m.difficulty] || 18;
    return m.dailyKey ? Math.round(base * 1.5) : base;
  }

  /* ---------------- 冲突判定 ---------------- */
  /**
   * 杀手的冲突比数独多两样：笼内数字重复、以及笼子的和已经超了。
   * 这三样要一起报，否则玩家会看到「没有冲突」却在笼子上卡死。
   */
  function cageConflicts(grid) {
    const map = new Map();
    const add = (i, j) => {
      if (!map.has(i)) map.set(i, []);
      map.get(i).push(j);
    };
    for (const [k, v] of SD.Validation.findConflicts(grid)) map.set(k, v.slice());
    if (!puz) return map;
    for (const cg of puz.list) {
      const byDigit = new Map();
      let sum = 0;
      let filled = 0;
      let first = -1;
      for (const i of cg.cells) {
        const d = grid[i];
        if (!d) continue;
        sum += d;
        filled++;
        if (first < 0) first = i;
        if (!byDigit.has(d)) byDigit.set(d, []);
        byDigit.get(d).push(i);
      }
      for (const cells of byDigit.values()) {
        if (cells.length < 2) continue;
        for (let a = 0; a < cells.length; a++) {
          for (let b = a + 1; b < cells.length; b++) { add(cells[a], cells[b]); add(cells[b], cells[a]); }
        }
      }
      if (filled && sum > cg.sum) {
        for (const i of cg.cells) if (grid[i] && i !== first) { add(i, first); add(first, i); }
      }
    }
    return map;
  }

  /* ---------------- 首页 ---------------- */
  const HOME_MENU = [
    { id: 'play', label: '开始杀手', desc: '没有已知数，只有每块笼子里的和', primary: true },
    { id: 'daily', label: '每日挑战', desc: '同一天全世界同一道题' },
    { id: 'learn', label: '教程', desc: '笼内组合、45 法则，每种配一个演示盘面' },
    { id: 'mine', label: '我的', desc: '战绩纪录与技巧使用分布' },
  ];

  function buildHome(root) {
    root.appendChild(el('div.home-logo.killer-logo', { text: '∑' }));
    root.appendChild(el('h1.home-title', { text: '杀手数独' }));
    root.appendChild(el('p.home-sub', { text: '没有已知数，全靠笼子里的和推出来' }));
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
    if (go === 'play') { openNewGameDialog(); return; }
    if (go === 'daily') { dailyChallenge(); return; }
    if (go === 'learn') { SD.Shell.openPage('杀手数独教程', (root) => K.learn.render(root)); return; }
    if (go === 'mine') { openMinePage(); return; }
  }

  function renderHome() {
    if (!homeRefs.stats) return;
    const st = Store.stats();
    const d = Store.dailyStats();
    const parts = [];
    if (st.wins) parts.push('累计完成 ' + st.wins + ' 局');
    parts.push(d.done ? '今日已完成' : '今日挑战待完成');
    if (d.streak) parts.push('连续 ' + d.streak + ' 天');
    homeRefs.stats.textContent = parts.join(' · ');
    if (homeRefs.daily) {
      homeRefs.daily.textContent = d.done
        ? '今天做完了（' + Util.formatDuration(d.record.timeMs) + '），可以再来一局'
        : '同一天全世界同一道题 · 连续 ' + d.streak + ' 天';
    }
  }

  /* ---------------- 对局页骨架 ---------------- */
  function buildPlay(root) {
    const status = el('div.status-strip', null, [
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
        el('button.btn', { id: 'btn-k-undo', title: '撤销 (Ctrl+Z)', text: '撤销' }),
        el('button.btn', { id: 'btn-k-redo', title: '重做 (Ctrl+Y)', text: '重做' }),
      ],
    }));

    const pad = el('div.number-pad', { id: 'number-pad' });
    for (let d = 1; d <= 9; d++) {
      pad.appendChild(el('button.np-digit', { dataset: { digit: String(d) } }, el('span', { text: String(d) })));
    }
    pad.appendChild(el('button.np-erase', { dataset: { digit: '0' }, title: '擦除 (Delete / 空格)' }, '⌫'));

    const tools = el('div.board-tools', null, [
      el('button.btn', { id: 'btn-k-notes', title: '铅笔标记 (N)' }, [el('span.tool-ico', { text: '✎' }), ' 笔记']),
      el('button.btn', { id: 'btn-k-hint', title: '提示 (H)' }, [el('span.tool-ico', { text: '💡' }), ' 提示']),
      el('button.btn', { id: 'btn-k-check', title: '检查 (C)' }, [el('span.tool-ico', { text: '✓' }), ' 检查']),
      el('button.btn', { id: 'btn-k-auto-notes', title: '按当前盘面重算所有铅笔标记', text: '一键笔记' }),
      el('button.btn.btn-warn', { id: 'btn-k-solve' }, [el('span.tool-ico', { text: '⚡' }), ' 自动求解']),
      el('button.btn', { id: 'btn-k-learn', title: '教程' }, [el('span.tool-ico', { text: '📖' }), ' 教程']),
    ]);

    const hintArea = el('aside.hint-area', { id: 'hint-area', hidden: true }, [
      el('header.hint-head', null, [
        el('b', { text: '提示' }),
        el('div.hint-head-actions', null, [
          el('label.field.field-inline', null, [
            el('span', { text: '等级上限' }),
            el('select', { id: 'hint-level' }),
          ]),
          el('button.btn.btn-icon', { id: 'btn-k-hint-close', title: '收起提示', text: '✕' }),
        ]),
      ]),
      el('div.hint-output', { id: 'hint-output' }),
      el('div.hint-actions', null, [
        el('button.btn', { id: 'btn-k-hint-show', text: '只讲解' }),
        el('button.btn.btn-primary', { id: 'btn-k-hint-apply', text: '讲解并执行' }),
        el('button.btn', { id: 'btn-k-hint-auto', text: '自动做完' }),
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

    view = SD.BoardView.create($('#board-mount'), {
      onSelect: (i) => { game.select(i); render(); },
    });
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
      highlightCage: s.highlightCage,
      cages: puz,
      conflicts: game.conflicts(),
      wrong: game.wrongCells(),
      hint: st.hint && st.hint.step ? st.hint.step : null,
      hintPlaced: st.hint ? st.hint.placedCells : null,
    });
    const noteMask = st.noteMode && st.selected >= 0 ? st.board.notes[st.selected] : 0;
    view.renderPad(st.board, noteMask);
    renderStatus();
    $('#btn-k-undo').disabled = !st.history.length;
    $('#btn-k-redo').disabled = !st.future.length;
    $('#btn-k-notes').classList.toggle('is-on', st.noteMode);
    const area = $('#hint-area');
    if (area && !area.hidden) renderHintPanel();
  }

  function renderStatus() {
    if (!game) return;
    const st = game.state;
    const m = st.meta || {};
    const isDaily = !!m.dailyKey;
    $('#stat-difficulty-label').textContent = isDaily ? '今日' : '难度';
    $('#stat-difficulty').textContent = isDaily ? m.dailyKey.slice(5) : (m.difficultyName || '自定义');
    $('#stat-timer').textContent = B.formatDuration(game.elapsedMs());
    $('#stat-hints').textContent = String(st.hints);
    $('#stat-mistakes').textContent = String(st.mistakes);
    let empty = 0;
    for (let i = 0; i < 81; i++) if (!st.board.grid[i]) empty++;
    $('#stat-empty').textContent = String(empty);
  }

  /* ---------------- 提示 ---------------- */
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
    sel.value = String(current || 5);
  }

  function refreshHints() {
    const level = Number($('#hint-level').value) || 5;
    hintList = game.hintList(level);
    if (hintIndex >= hintList.length) hintIndex = Math.max(0, hintList.length - 1);
  }

  /**
   * 没有可用解法时说什么。
   * 上限已经是最高档的时候不能再说"调高上限"——那是在让人去做一件做不到的事
   * （实测大师档空盘 + 一键笔记就是这个局面，提示还叫人调高，下拉框却已经到顶了）。
   */
  function noHintText(level) {
    const max = Math.max.apply(null, SD.Sudoku.settings.HINT_LEVELS.map((h) => h.value));
    if (level >= max) {
      return '当前局面已经没有可用的推理了（等级上限已是最高档）。'
        + '剩下的只能靠试错，或者点「自动求解」让它一次做完。';
    }
    return '当前局面没有可用解法了。试试把「等级上限」调高。';
  }

  function renderHintPanel() {
    refreshHints();
    const out = clear($('#hint-output'));
    if (!hintList.length) {
      out.appendChild(el('p', { text: noHintText(Number($('#hint-level').value) || 5) }));
      return;
    }
    const strip = el('div.mine-steps');
    hintList.forEach((entry, k) => {
      strip.appendChild(el('button.mine-chip' + (k === hintIndex ? '.is-on' : ''), {
        text: 'L' + entry.step.level + ' ' + entry.step.name,
        onclick: () => selectHint(k),
      }));
    });
    out.appendChild(strip);

    const e = hintList[hintIndex].explain;
    out.appendChild(el('h4.mine-hint-title', { text: e.name }));
    for (const line of e.derivation || []) out.appendChild(el('p', { text: line }));
    out.appendChild(el('div.mine-concl', { text: e.conclusion }));
    if (e.pitfalls) out.appendChild(el('p.mine-pitfall', { text: '注意：' + e.pitfalls }));
    if (e.principle) {
      out.appendChild(el('h4.mine-learn-sub', { text: '技巧原理' }));
      out.appendChild(el('p', { text: e.principle }));
    }
  }

  function selectHint(i) {
    if (i < 0 || i >= hintList.length) return;
    hintIndex = i;
    game.applyStep(hintList[i], false);
    render();
  }

  function renderAllPanels() {
    const area = $('#hint-area');
    if (area && !area.hidden) renderHintPanel();
  }

  function setHintOpen(open) {
    const area = $('#hint-area');
    if (!area) return;
    document.documentElement.style.setProperty('--sheet-top', measureSheetTop());
    area.hidden = !open;
    const layout = document.querySelector('.layout');
    if (layout) layout.classList.toggle('is-split', open);
    if (open) renderHintPanel();
  }

  function measureSheetTop() {
    const board = document.querySelector('.board-wrap');
    if (!board) return '50vh';
    const bottom = board.getBoundingClientRect().bottom + 8;
    return Math.round(Math.min(bottom, window.innerHeight * 0.7)) + 'px';
  }

  function doHint(apply) {
    refreshHints();
    setHintOpen(true);
    if (!hintList.length) {
      renderHintPanel();
      toast(noHintText(Number($('#hint-level').value) || 5), 'err');
      return;
    }
    const entry = hintList[hintIndex];
    const r = game.applyStep(entry, apply);
    if (r && r.explain.step && r.explain.step.cells && r.explain.step.cells.length) {
      game.select(r.explain.step.cells[0]);
    }
    render();
    if (apply) { hintIndex = 0; refreshHints(); renderHintPanel(); }
    else renderHintPanel();
    render();
    scheduleSave();
  }

  /* ---------------- 开局 ---------------- */
  const DAILY_LEVELS = ['medium', 'hard'];

  function newGame(difficultyId, seed) {
    const my = session;
    const cfg = KG.DIFFICULTY[difficultyId] || KG.DIFFICULTY.medium;
    SD.Shell.overlay('正在出题…', '切笼子并校验唯一解，通常一两秒。');
    // 出题是同步的、会阻塞主线程，先让遮罩画出来再算，否则看着像卡死
    setTimeout(() => {
      if (my !== session) return;
      let gen = null;
      try {
        gen = KG.generateSync(difficultyId, seed);
      } catch (e) {
        SD.Shell.hideOverlay();
        toast('出题失败：' + e.message, 'err');
        return;
      }
      if (my !== session) return;
      SD.Shell.hideOverlay();
      startWith(gen, { difficulty: cfg.id, difficultyName: cfg.name, seed: seed, title: cfg.name + ' · ' + gen.cageCount + ' 个笼子' });
    }, 30);
  }

  function startWith(gen, m, keepView) {
    session++;
    puz = gen.puzzle;
    meta = Object.assign({}, m, {
      cageCount: gen.cageCount,
      rating: gen.rating,
      level: gen.rating.level,
      star: gen.rating.star,
    });
    game.start(new Uint8Array(81), meta, gen.solution);
    game.clearHint();
    if (!keepView) SD.Shell.showView('game');
    render();
    renderAllPanels();
    scheduleSave();
  }

  function dailyChallenge() {
    const key = Util.dayKey();
    const idx = Util.makeRng('killer-daily-level|' + key)() < 0.5 ? 0 : 1;
    const id = DAILY_LEVELS[idx];
    const cfg = KG.DIFFICULTY[id];
    const my = session;
    SD.Shell.overlay('正在生成每日挑战…', '同一天全球拿到的是同一道题。');
    setTimeout(() => {
      if (my !== session) return;
      let gen = null;
      try {
        gen = KG.generateSync(id, 'killer-daily-' + key);
      } catch (e) {
        SD.Shell.hideOverlay();
        toast('每日挑战出题失败：' + e.message, 'err');
        return;
      }
      if (my !== session) return;
      SD.Shell.hideOverlay();
      startWith(gen, {
        difficulty: id,
        difficultyName: '每日挑战',
        dailyKey: key,
        seed: key,
        title: '每日挑战 · ' + key.slice(5),
      });
    }, 30);
  }

  /* ---------------- 新局对话框 ---------------- */
  const DIFF_DESC = {
    easy: '小笼子为主，几乎全靠笼内定数',
    medium: '开始需要笼内组合',
    hard: '会用到 45 法则',
    expert: '笼子更大，组合与 45 法则交织',
    master: '常规技巧不够，必须试数',
  };

  function openNewGameDialog() {
    const grid = el('div.difficulty-grid');
    for (const id of KG.DIFFICULTY_ORDER) {
      const d = KG.DIFFICULTY[id];
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
        el('p', { text: '杀手数独一个已知数都不给，全靠笼子里的和推出来。系统切好笼子后会验算唯一解，再按「人类最少需要用到哪一级技巧」评级。' }),
        grid,
      ],
      footer: [{ label: '取消' }],
    });
  }

  /* ---------------- 胜利结算 ---------------- */
  function onWin() {
    const st = game.state;
    const timeMs = game.elapsedMs();
    Store.recordGame({
      won: true, timeMs: timeMs, hints: st.hints, mistakes: st.mistakes,
      difficulty: st.meta.difficulty || 'medium',
      difficultyName: st.meta.difficultyName,
      dailyKey: st.meta.dailyKey,
      techniques: st.techniques,
    });
    scheduleSave();
    render();
    renderAllPanels();
    renderHome();

    const pts = SD.Points.awardWin('killer', {
      difficulty: st.meta.difficulty || 'medium',
      dailyKey: st.meta.dailyKey,
    });

    const used = {};
    for (const id of st.techniques) used[id] = (used[id] || 0) + 1;
    const rows = Object.keys(used).sort((a, b) => used[b] - used[a]).map((id) => {
      const t = KT.byId[id];
      return el('div.kv', null, [el('span', { text: t ? t.name : id }), el('b', { text: used[id] + ' 次' })]);
    });

    modal({
      title: '🎉 完成！',
      body: [
        el('div.result-grid', null, [
          el('div.result-tile', null, [el('div.rt-val', { text: B.formatDuration(timeMs) }), el('div.rt-label', { text: '用时' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(st.hints) }), el('div.rt-label', { text: '提示' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(st.mistakes) }), el('div.rt-label', { text: '错误' })]),
          el('div.result-tile', null, [el('div.rt-val', { text: String(meta.cageCount || 0) }), el('div.rt-label', { text: '笼子' })]),
        ]),
        pts ? el('p.points-gain', { text: '+' + pts + ' 通关点数，累计 ' + SD.Points.total() }) : null,
        el('div.card', { style: { marginTop: '14px' } }, [
          el('h3', { text: '你用到的技巧' }),
          rows.length ? rows : el('p', { text: '全程自己推，没有用提示——这局是纯实力。' }),
        ]),
      ],
      footer: [
        { label: '再来一局', primary: true, onClick: () => newGame(Store.settings().lastDifficulty) },
      ],
    });
  }

  /**
   * 填错超过上限后的选择。和数独一样不惩罚——卡死不如重来。
   */
  function askAfterMistakes() {
    if (mistakeAsked || game.state.won) return;
    mistakeAsked = true;
    const diff = game.state.meta.difficulty || 'medium';
    const body = el('p.lead', { text: '已经填错 ' + game.state.mistakes + ' 次（上限 ' + game.mistakeLimit + '）。' });
    body.appendChild(el('p.lead', { text: '错过的格子已经标红，笼和超了也会标出来。可以点「检查」逐个改，也可以换一局。' }));
    modal({
      title: '错得有点多了',
      body: body,
      footer: [
        { label: '同难度换一局', primary: true, onClick: () => { mistakeAsked = false; newGame(diff); } },
        { label: '再给一次机会', onClick: () => { mistakeAsked = false; toast('继续加油，错了的格子标红'); } },
      ],
    });
  }

  /* ---------------- 我的 ---------------- */
  function openMinePage() {
    SD.Shell.openPage('我的', (root) => {
      const st = Store.stats();
      const d = Store.dailyStats();
      root.appendChild(el('p.lead', {
        text: '通关点数 ' + SD.Points.total() + '（全部游戏通用）。杀手数独这部分的成绩只存在本机。',
      }));

      const card = el('div.card', null, el('h3', { text: '各档成绩' }));
      for (const id of KG.DIFFICULTY_ORDER) {
        const cfg = KG.DIFFICULTY[id];
        const b = st.byDifficulty[id];
        card.appendChild(el('div.kv', null, [
          el('span', { text: cfg.name }),
          el('b', { text: b && b.wins ? Util.formatDuration(b.bestTime) + ' · ' + b.wins + '/' + b.games : (b ? '未通关 · ' + b.games + ' 局' : '—') }),
        ]));
      }
      root.appendChild(card);

      const daily = el('div.card', null, el('h3', { text: '每日挑战' }));
      daily.appendChild(el('div.kv', null, [el('span', { text: '今日' }), el('b', { text: d.done ? '已完成 ' + Util.formatDuration(d.record.timeMs) : '未完成' })]));
      daily.appendChild(el('div.kv', null, [el('span', { text: '连续' }), el('b', { text: d.streak + ' 天' })]));
      daily.appendChild(el('div.kv', null, [el('span', { text: '累计完成' }), el('b', { text: d.total + ' 天' })]));
      root.appendChild(daily);

      const tech = el('div.card', null, el('h3', { text: '技巧使用分布' }));
      const use = st.techniqueUse || {};
      const ids = Object.keys(use).sort((a, b) => use[b] - use[a]).slice(0, 12);
      if (!ids.length) {
        tech.appendChild(el('p', { text: '还没有记录。用提示推完一局就会记下来。' }));
      } else {
        for (const id of ids) {
          const t = KT.byId[id];
          tech.appendChild(el('div.kv', null, [el('span', { text: t ? t.name : id }), el('b', { text: use[id] + ' 次' })]));
        }
      }
      root.appendChild(tech);

      const danger = el('div.card', null, el('h3', { text: '维护' }));
      danger.appendChild(el('div.btn-row', null, [
        el('button.btn.btn-warn', {
          text: '清空杀手数独成绩',
          onclick: () => {
            if (!confirm('只会清掉杀手数独的战绩和每日记录，数独与扫雷的数据不受影响。确定吗？')) return;
            Store.resetStats();
            openMinePage();
            toast('杀手数独成绩已清空');
          },
        }),
      ]));
      danger.appendChild(el('p', { text: '所有游戏的数据各存各的，这里清不掉别的游戏。' }));
      root.appendChild(danger);
    });
  }

  /* ---------------- 存档 ---------------- */
  const scheduleSave = U.debounce(() => {
    if (!puz || !game || game.state.won) return;
    const st = game.state;
    Store.saveGame({
      cages: puz.list,
      meta: st.meta,
      grid: B.gridToString(st.board.grid),
      notes: Array.from(st.board.notes),
      hints: st.hints,
      mistakes: st.mistakes,
      elapsed: game.elapsedMs(),
      techniques: st.techniques,
    });
  }, 400);

  function restore() {
    const saved = Store.loadGame();
    if (!saved || !saved.cages) return false;
    puz = K.cages.create(saved.cages);
    meta = saved.meta || {};
    game.start(new Uint8Array(81), meta, null);
    game.state.board.grid.set(B.stringToGrid(saved.grid));
    game.state.board.notes.set(Int32Array.from(saved.notes || []));
    game.state.hints = saved.hints || 0;
    game.state.mistakes = saved.mistakes || 0;
    game.state.elapsed = saved.elapsed || 0;
    game.pauseTimer();
    // 存档里没带真解，从笼子反推一个，红字标记才有依据
    const r = KS.solve(puz, 1);
    if (r.count === 1) game.state.solution = r.solution;
    render();
    toast('已恢复上次的对局');
    return true;
  }

  /* ---------------- 事件 ---------------- */
  function checkBoard() {
    const st = game.state;
    const conf = game.conflicts();
    if (conf.size) {
      toast('发现 ' + conf.size + ' 处冲突（含笼内重复与笼和超限），已标红', 'err');
      game.select(conf.keys().next().value);
      render();
      return;
    }
    const wrong = [];
    for (let i = 0; i < 81; i++) {
      const d = st.board.grid[i];
      if (d && !st.board.isGiven(i) && st.solution && st.solution[i] !== d) wrong.push(i);
    }
    if (wrong.length) {
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
      confirm('自动求解', '会用人类技巧一步步把棋盘推完。推不动时如实告诉你，不会偷偷用机器解填满。会记为一次提示。确定继续？', '求解')
        .then((ok) => { if (ok) run(); });
    } else {
      run();
    }
  }

  function bindPlay() {
    $('#btn-k-undo').addEventListener('click', () => { game.undo(); render(); scheduleSave(); });
    $('#btn-k-redo').addEventListener('click', () => { game.redo(); render(); scheduleSave(); });
    $('#btn-k-notes').addEventListener('click', () => { game.setNoteMode(); render(); });
    $('#btn-k-hint').addEventListener('click', () => { setHintOpen(true); doHint(false); });
    $('#btn-k-hint-close').addEventListener('click', () => setHintOpen(false));
    $('#btn-k-hint-show').addEventListener('click', () => doHint(false));
    $('#btn-k-hint-apply').addEventListener('click', () => doHint(true));
    $('#btn-k-hint-auto').addEventListener('click', autoSolve);
    $('#btn-k-check').addEventListener('click', checkBoard);
    $('#btn-k-solve').addEventListener('click', autoSolve);
    $('#btn-k-learn').addEventListener('click', () => {
      SD.Shell.openPage('杀手数独教程', (root) => K.learn.render(root));
    });
    $('#btn-k-auto-notes').addEventListener('click', () => {
      // 必须走 game.rebuildNotes：它用的是带笼子约束的候选来源。
      // 直接调 board.rebuildNotes() 会退回通用版（只扣行列宫），
      // 笼子和是 5 的两格笼里就会挂着 7、8、9。
      const n = game.rebuildNotes();
      render();
      scheduleSave();
      toast(n ? '已按当前盘面标记 ' + n + ' 格的候选数' : '当前盘面没有可标记的候选');
    });
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
    bindCellRefs();
  }

  /** 讲解里的【R6C6】指到哪一格，棋盘就点亮哪一格 */
  function bindCellRefs() {
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
    const end = () => { if (press) clearTimeout(press); press = null; view.setRefs([]); };
    out.addEventListener('touchend', end, { passive: true });
    out.addEventListener('touchcancel', end, { passive: true });
  }

  let docBound = false;
  function onKeyDown(e) {
    if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const st = game.state;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) game.redo(); else game.undo();
      render(); scheduleSave(); return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); game.redo(); render(); scheduleSave(); return; }
    if (e.key >= '1' && e.key <= '9') { e.preventDefault(); game.inputDigit(Number(e.key)); render(); scheduleSave(); return; }
    switch (e.key) {
      case 'Backspace': case 'Delete': case ' ':
        e.preventDefault(); game.erase(); render(); scheduleSave(); break;
      case 'm': case 'M':
        e.preventDefault(); game.setNoteMode(); render(); break;
      case 'h': case 'H':
        e.preventDefault(); doHint(false); break;
      case 'c': case 'C':
        e.preventDefault(); checkBoard(); break;
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
      default: break;
    }
  }

  function bindDocument() {
    if (docBound) return;
    docBound = true;
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', U.debounce(() => {
      if (SD.Shell.game() !== def || SD.Shell.viewName() !== 'game') return;
      const area = $('#hint-area');
      if (area && !area.hidden) setHintOpen(true);
    }, 200));
  }

  /* ---------------- 游戏定义 ---------------- */
  const ABOUT = [
    {
      h: '什么是杀手数独',
      p: [
        '一个已知数都不给。整个盘面被切成若干块「笼子」，每块笼子标着一个和：'
        + '笼子里的数字加起来必须等于它，而且笼内数字不能重复。'
        + '行列宫的老规矩照旧。',
        '看起来信息更少了，其实笼子提供的是另一种信息——它不给具体数字，只给一个和，'
        + '但和一样能把候选逼到很窄。',
      ],
    },
    {
      h: '出题：先出终盘，再切笼子',
      p: [
        '先随机出一道完整终盘，再把它切成笼子，和就自动定了。剩下只有一个问题：这样切出来的题唯一解吗？'
        + '不唯一就换一种切法重来。',
        '笼子越小越容易唯一（实测 2 格笼 83%，5 格笼只有 20%，6 格笼几乎永远不唯一），'
        + '所以难度阶梯靠「笼子切多大」加「切完实测需要哪一级技巧」两条一起定。',
      ],
    },
    {
      h: '提示：笼子族的技巧',
      p: [
        '数独那 27 种技巧在杀手盘面上照样成立（行列宫候选永远包含真解数字），所以原样复用。'
        + '但真正的主角是笼子族的十二条：笼内定数、笼内组合、笼内必含、组合互斥、少解笼子组合、'
        + '笼子分割、宫线笼减、笼子比较、45 法则（内格 / 外格）、奇偶规则、笼内试数。',
        '45 法则是最有杀手特色的一条：一行九个数字加起来必然是 45，'
        + '拿它减去这一行里「完全落在行内」的笼子和，剩下的格子就承担了差额。',
      ],
    },
    {
      h: '有一族技巧被主动排除了',
      p: [
        '唯一矩形靠「致命模式」论证：某个形状一旦出现，交换两格就能得到第二个解，'
        + '所以它不能出现。但杀手多了一层笼子和——交换很可能破坏笼和，「第二个解」根本不存在。',
        '也就是说这个形状可以合法地待在唯一解盘面上，照搬会删掉真解数字。'
        + '这一条是性质测试逼出来的：测试跑出「唯一矩形删掉了真解」，于是整族被排除。',
      ],
    },
  ];

  const deps = {
    settings: () => Store.settings(),
    recordTechnique: (id) => Store.recordTechnique(id),
    conflicts: (grid) => cageConflicts(grid),
    isComplete: (grid) => SD.Validation.isComplete(grid),
    hints: {
      available: (grid, opts) => KH.available(puz, grid, opts),
      walkthrough: (grid, level) => KH.walkthrough(puz, grid, level),
    },
    solve: (grid, limit) => KS.solve(puz, limit, null, grid),
    // 必须用笼子版的：通用的只扣行列宫，笼子和是 5 的两格笼里还会挂着 7、8、9。
    // 「一键笔记」和提示的「执行」都走这里，用错了整盘候选就是错的。
    baseCandidates: (grid) => K.cages.computeCandidates(puz, grid),
  };

  const def = {
    id: 'killer',
    name: '杀手数独',
    tagline: '不给数字，只给每块笼子里的和',
    icon: '∑',
    accent: '#a855f7',
    ready: true,
    mount: function (nodes) {
      session++;
      buildHome(nodes.home);
      buildPlay(nodes.play);
      bindPlay();
      bindDocument();
      fillHintLevels(Store.settings().defaultHintLevel);
      game = SD.GameBase.create({
        onChange: (kind) => {
          if (kind === 'win') onWin();
          else if (kind === 'mistakeLimit') askAfterMistakes();
          else if (kind === 'tick') renderStatus();
          else render();
        },
        onTick: () => renderStatus(),
      }, deps);
      renderHome();
      render();
      if (!puz) restore();
    },
    unmount: function () {
      session++;
      if (game) game.pauseTimer();
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
      return st.wins ? '累计 ' + st.wins + ' 局' : null;
    },
    settings: function (root, ctx) {
      const s = Store.settings();
      root.appendChild(el('h4.sub-title', { text: '行为' }));
      const toggles = [
        { key: 'autoNotes', label: '落子后自动更新候选', hint: '每填一个数字，自动把同行 / 列 / 宫 / 同笼的铅笔标记同步一次' },
        { key: 'highlight', label: '高亮联动', hint: '选中格子时高亮同行、同列、同宫' },
        { key: 'highlightSame', label: '同数字高亮', hint: '选中后高亮盘上所有相同数字' },
        { key: 'highlightPeer', label: '同行列宫高亮', hint: '选中后高亮所在的三条线' },
        { key: 'highlightCage', label: '同笼高亮', hint: '选中后把整个笼子一起点亮。杀手盘面上这一格属于哪个笼子是每一步都要看的信息' },
        { key: 'mistakeCheck', label: '即时纠错', hint: '填入的数字与已填冲突、或笼和超了时立刻标红' },
        { key: 'confirmSolve', label: '求解前确认', hint: '自动求解前弹窗二次确认' },
      ];
      for (const t of toggles) {
        root.appendChild(el('label.switch.setting', null, [
          el('input', {
            type: 'checkbox',
            checked: !!s[t.key],
            onchange: (e) => { Store.set(t.key, e.target.checked); ctx.rerender(); render(); },
          }),
          el('span', null, [el('b', { text: t.label }), el('small', { text: t.hint })]),
        ]));
      }
      root.appendChild(el('h4.sub-title', { text: '提示' }));
      root.appendChild(el('div.field', null, [
        el('span', { text: '默认等级上限' }),
        el('select', {
          onchange: (e) => Store.set('defaultHintLevel', Number(e.target.value)),
        }, SD.Sudoku.settings.HINT_LEVELS.map((h) => el('option', {
          value: String(h.value), text: h.label, selected: Number(s.defaultHintLevel) === h.value,
        }))),
      ]));
      root.appendChild(el('p', { text: '杀手数独起步就要用笼内组合，默认放开到全部。锁在低等级会很快找不到可用解法。' }));
    },
    resetSettings: function () { Store.resetSettings(); },
    about: ABOUT,
    points: pointsFor,
  };
  SD.Registry.register(def);

  K.app = {
    getGame: () => game,
    getPuzzle: () => puz,
    getMeta: () => meta,
    newGame: newGame,
    dailyChallenge: dailyChallenge,
    render: render,
    showView: SD.Shell.showView,
  };
})(window);
