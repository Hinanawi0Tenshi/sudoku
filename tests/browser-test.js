/* 数独 · 浏览器端冒烟测试
 * 用 Chrome DevTools Protocol 直接驱动真实页面：点击、键盘、提示、切页，
 * 同时收集页面抛出的异常。无需任何 npm 依赖（Node 18+ 自带 WebSocket）。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8731/index.html';
const PORT = 9411;
const profile = path.join(os.tmpdir(), 'sudoku-smoke-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1400,1000', URL,
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) throw new Error('无法连接到浏览器调试端口');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  const problems = [];
  const logs = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push('异常: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value !== undefined ? a.value : a.description).join(' ');
      logs.push(msg.params.type + ': ' + text);
      if (msg.params.type === 'error') problems.push('console.error: ' + text);
    }
  };

  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('求值失败: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(3000);

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  };

  const step = async (name, expr) => {
    try {
      const v = await evaluate(expr);
      check(name, v && v.ok !== false, v && v.info !== undefined ? v.info : JSON.stringify(v));
    } catch (e) {
      check(name, false, '抛异常: ' + e.message);
    }
  };

  await step('棋盘渲染出 81 格', `(function(){
    const cells = document.querySelectorAll('#board .cell');
    const g = window.SD && SD.App && SD.App.getGame();
    return { ok: cells.length === 81, info: cells.length + ' 格 / 题面 ' + (g ? Array.from(g.state.givens).filter(Boolean).length : '?') + ' 线索' };
  })()`);

  await step('核心命名空间齐备', `(function(){
    const need = ['Base','Board','Solver','Generator','Techniques','Hints','Rater','Validation','UI','Store','BoardView','Game','Panels','Data','Settings','Vision','OCR','App'];
    const miss = need.filter(k => !window.SD || !SD[k]);
    return { ok: miss.length === 0, info: miss.length ? '缺少 ' + miss.join(',') : need.length + ' 个模块全部就位' };
  })()`);

  await step('技巧清单已注册', `(function(){
    const ids = SD.Techniques.LIST.map(t => t.id);
    return { ok: ids.length >= 12, info: ids.length + ' 种: ' + ids.join(',') };
  })()`);

  await step('点击格子可选中', `(async function(){
    const cells = document.querySelectorAll('#board .cell');
    cells[40].click();
    await new Promise(r => setTimeout(r, 60));
    const g = SD.App.getGame();
    return { ok: g.state.selected === 40, info: 'selected=' + g.state.selected };
  })()`);

  await step('键盘输入数字', `(async function(){
    const g = SD.App.getGame();
    function withAt(grid, i, d) { const c = Uint8Array.from(grid); c[i] = d; return c; }
    const i = Array.from(g.state.board.grid).findIndex((v, k) => v === 0 && !g.state.board.isGiven(k));
    g.select(i);
    const before = g.state.board.grid[i];
    const wrongDigit = [1,2,3,4,5,6,7,8,9].find(d => g.state.board.grid[i] !== d && SD.Validation.findConflicts(withAt(g.state.board.grid, i, d)).size > 0);
    const before_conf = wrongDigit ? withAt(g.state.board.grid, i, wrongDigit) : null;
    g.inputDigit(wrongDigit);
    await new Promise(r => setTimeout(r, 40));
    const rejected = g.state.board.grid[i] === before;
    g.inputDigit(wrongDigit);
    await new Promise(r => setTimeout(r, 40));
    g.undo();
    await new Promise(r => setTimeout(r, 40));
    return { ok: i >= 0 && rejected,
             info: '格=' + i + ' 故意填冲突数字 ' + wrongDigit + ' 被即时纠错拒绝=' + rejected };
  })()`);

  await step('撤销栈顺序正确（撤销回到上一步）', `(async function(){
    const g = SD.App.getGame();
    g.select(2); g.state.board.clearCell(2, { force: true });
    const snap = Array.from(g.state.board.grid);
    g.select(5); g.inputDigit(4);
    await new Promise(r => setTimeout(r, 30));
    g.undo();
    await new Promise(r => setTimeout(r, 30));
    const same = JSON.stringify(Array.from(g.state.board.grid)) === JSON.stringify(snap);
    return { ok: same, info: same ? '撤销准确回到上一步' : '撤销后盘面与上一步不一致' };
  })()`);

  await step('重做可用', `(async function(){
    const g = SD.App.getGame();
    const okRedo = g.redo();
    await new Promise(r => setTimeout(r, 30));
    return { ok: okRedo === true, info: 'redo 返回 ' + okRedo };
  })()`);

  await step('笔记模式可切换', `(async function(){
    const g = SD.App.getGame();
    // 这一步必须与前面的用例隔离：前面的键盘输入会往同一格写笔记，
    // 共用一格的话断言会被前一步的残留影响
    const fresh = SD.Generator.generateSync('easy', 'note-check');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    const empty = Array.from(g.state.board.grid).findIndex(v => v === 0);
    g.select(empty);
    g.setNoteMode(true);
    const mode = g.state.noteMode;
    const moved = g.inputDigit(7);
    await new Promise(r => setTimeout(r, 40));
    const mask = g.state.board.notes[empty];
    g.setNoteMode(false);
    return { ok: mode && moved && (mask & (1 << 6)) !== 0,
             info: 'noteMode=' + mode + ' 返回=' + moved + ' 格=' + empty + ' notes=0b' + mask.toString(2) };
  })()`);

  await step('一键提示能给出推理并执行', `(async function(){
    const g = SD.App.getGame();
    const before = g.state.board.grid.filter(Boolean).length;
    const r = SD.Hints.next(g.state.board.grid, { maxLevel: 5 });
    if (!r) return { ok: false, info: '没有可用提示' };
    document.getElementById('btn-hint-apply').click();
    await new Promise(res => setTimeout(res, 150));
    const after = g.state.board.grid.filter(Boolean).length;
    const card = document.querySelector('#hint-output .hint-card');
    const liCount = document.querySelectorAll('#hint-output .hint-section ol li').length;
    const concl = document.querySelector('#hint-output .hint-conclusion');
    return { ok: !!card && liCount > 0 && !!concl && after >= before,
             info: '卡片=' + !!card + ' 推导行=' + liCount + ' 填入 ' + before + '→' + after };
  })()`);

  await step('自动求解能填满棋盘', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('medium', 'autosolve-check');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.autoSolve();
    await new Promise(res => setTimeout(res, 80));
    const full = g.state.board.grid.every(v => v > 0);
    const valid = SD.Validation.isConsistent(g.state.board.grid);
    return { ok: full && valid, info: '已填满=' + full + ' 自洽=' + valid };
  })()`);

  await step('五个难度都能出题且唯一解', `(async function(){
    const out = [];
    for (const d of SD.Generator.DIFFICULTY_ORDER) {
      const gen = await SD.Generator.generate(d, 'smoke-' + d, () => {});
      const uniq = SD.Solver.solve(gen.givens, 2).count === 1;
      const solvable = gen.rating.solved;
      out.push(d + ':L' + gen.level + '/' + gen.clueCount + '格' + (uniq ? '' : '!多解') + (solvable ? '' : '!不可解'));
      if (!uniq || !solvable) return { ok: false, info: out.join(' | ') };
    }
    return { ok: true, info: out.join(' | ') };
  })()`);

  await step('题面体检能识别非法题面', `(function(){
    const bad = new Uint8Array(81);
    bad[0] = 5; bad[1] = 5;
    const r1 = SD.Generator.inspect(bad);
    const empty = new Uint8Array(81);
    const r2 = SD.Generator.inspect(empty);
    const good = SD.Base.stringToGrid('530070000600195000098000060800060003400803001700020006060000280000419005000080079');
    const r3 = SD.Generator.inspect(good);
    return { ok: !r1.valid && r3.valid && !!r3.classification,
             info: '冲突题=' + r1.reason + ' | 空盘=' + r2.reason + ' | 正常题=' + r3.reason + '/' + r3.classification.name };
  })()`);

  await step('提示面板列出全部解法且按等级排序', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('expert', 'hint-list');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    SD.App.setHintOpen(true);
    document.getElementById('btn-hint-show').click();
    await new Promise(res => setTimeout(res, 120));
    const chips = Array.from(document.querySelectorAll('#hint-output .hint-chip')).map(e => e.textContent);
    const num = (document.querySelector('#hint-output .pg-num') || {}).textContent || '';
    const levels = g.hintList(5).map(e => e.explain.level);
    const sorted = levels.every((v, i) => i === 0 || v >= levels[i - 1]);
    return { ok: chips.length >= 2 && sorted && num.indexOf('/') > 0,
             info: chips.length + ' 条 ' + num + '，等级序 ' + levels.join(',') };
  })()`);

  await step('可自由切换到别的解法并执行', `(async function(){
    const g = SD.App.getGame();
    const chips = document.querySelectorAll('#hint-output .hint-chip');
    if (chips.length < 2) return { ok: false, info: '只有一条解法，跳过' };
    const before = Array.from(g.state.board.grid).join('');
    chips[1].click();
    await new Promise(res => setTimeout(res, 100));
    const picked = (document.querySelector('#hint-output .pg-num') || {}).textContent || '';
    const stillSame = Array.from(g.state.board.grid).join('') === before;
    document.getElementById('btn-hint-apply').click();
    await new Promise(res => setTimeout(res, 120));
    const changed = Array.from(g.state.board.grid).join('') !== before;
    return { ok: stillSame && changed, info: '选中后 ' + picked + '，点选未落子=' + stillSame + '，执行后落子=' + changed };
  })()`);

  await step('讲解并执行可以连续进行', `(async function(){
    const g = SD.App.getGame();
    const empty0 = g.state.board.grid.filter(v => !v).length;
    for (let k = 0; k < 3; k++) {
      document.getElementById('btn-hint-apply').click();
      await new Promise(res => setTimeout(res, 90));
    }
    const empty1 = g.state.board.grid.filter(v => !v).length;
    const hasCard = !!document.querySelector('#hint-output .hint-card');
    return { ok: empty1 < empty0 && hasCard, info: '空格 ' + empty0 + ' → ' + empty1 + '，面板仍有卡片=' + hasCard };
  })()`);

  await step('一键笔记铺满候选', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('easy', 'one-key-notes');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    for (let i = 0; i < 81; i++) g.state.board.notes[i] = 0;
    document.getElementById('btn-auto-notes').click();
    await new Promise(res => setTimeout(res, 80));
    const marked = Array.from(g.state.board.notes).filter(v => v !== 0).length;
    const cand = SD.Validation.computeCandidates(g.state.board.grid);
    let mismatch = 0;
    for (let i = 0; i < 81; i++) {
      const want = g.state.board.grid[i] ? 0 : cand[i];
      if (g.state.board.notes[i] !== want) mismatch++;
    }
    return { ok: marked > 0 && mismatch === 0, info: '标记 ' + marked + ' 格，不一致 ' + mismatch + ' 格' };
  })()`);

  await step('数字填满 9 个后从键盘隐藏', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('easy', 'pad-hide');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) { const d = g.state.board.grid[i]; if (d) counts[d]++; }
    // 硬造一个填满的数字：把某个数字摆进九个空格
    const target = 1;
    let placed = 0;
    for (let i = 0; i < 81 && placed < 9; i++) {
      if (!g.state.board.grid[i] && SD.Validation.computeCandidates(g.state.board.grid)[i] & SD.Base.bit(target)) {
        g.state.board.grid[i] = target; placed++;
      }
    }
    counts[target] = placed;
    SD.App.render();
    const hidden = [];
    const shown = [];
    for (const btn of document.querySelectorAll('.np-digit')) {
      const d = Number(btn.dataset.digit);
      (counts[d] >= 9 ? hidden : shown).push(d);
    }
    const reallyHidden = document.querySelectorAll('.np-digit.is-full').length;
    const fullDigits = Array.from(document.querySelectorAll('.np-digit.is-full')).map(e => e.dataset.digit);
    return { ok: reallyHidden > 0 && shown.length > 0,
             info: '隐藏的数字 ' + (fullDigits.join(',') || '无') + '，其余 ' + shown.length + ' 个保留' };
  })()`);

  await step('笔记态下键盘点亮该格已有的笔记', `(async function(){
    const g = SD.App.getGame();
    g.state.board.locked.fill(0);
    g.state.board.notes.fill(0);
    g.setNoteMode(true);
    g.select(0);
    g.inputDigit(3);
    g.inputDigit(7);
    g.inputDigit(3);
    SD.App.render();
    const on = Array.from(document.querySelectorAll('.np-digit.is-note')).map(e => e.dataset.digit).sort();
    g.setNoteMode(false);
    return { ok: on.join(',') === '7', info: '点亮的数字=' + (on.join(',') || '无') + '，选中格笔记=0b' + g.state.board.notes[0].toString(2) };
  })()`);

  await step('启动落在首页且六个入口都在', `(async function(){
    const view = document.documentElement.getAttribute('data-view');
    const items = Array.from(document.querySelectorAll('.home-item')).map((b) => b.dataset.go);
    const want = ['play', 'bank', 'daily', 'stats', 'settings', 'about'];
    return { ok: view === 'home' && items.join(',') === want.join(','),
             info: '视图=' + view + '，入口 ' + items.join(' / ') };
  })()`);

  await step('题库每道题都合法且唯一解', `(function(){
    const bad = [];
    for (const p of SD.Bank.LIST) {
      const r = SD.Generator.inspect(SD.Base.stringToGrid(p.grid));
      if (!r.valid) bad.push(p.name + '：' + r.reason);
    }
    return { ok: bad.length === 0,
             info: bad.length ? bad.join('; ') : SD.Bank.LIST.length + ' 道全部合法唯一解' };
  })()`);

  await step('从题库能直接开一局', `(async function(){
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(res => setTimeout(res, 150));
    const items = document.querySelectorAll('.bank-item');
    if (!items.length) return { ok: false, info: '题库页没有题目' };
    items[items.length - 1].click();
    await new Promise(res => setTimeout(res, 700));
    const st = SD.App.getGame().state;
    const view = document.documentElement.getAttribute('data-view');
    let locked = 0;
    for (let i = 0; i < 81; i++) if (st.board.grid[i] && st.board.isGiven(i)) locked++;
    return { ok: view === 'game' && locked > 0,
             info: '标题=' + st.meta.title + '，线索 ' + locked + ' 个，视图=' + view };
  })()`);

  await step('设置页可切换全部主题', `(async function(){
    document.getElementById('btn-home').click();
    document.querySelector('.home-item[data-go=settings]').click();
    await new Promise(res => setTimeout(res, 150));
    const swatches = document.querySelectorAll('.theme-swatch');
    if (!swatches.length) return { ok: false, info: '设置页没有主题色板' };
    const seen = [];
    for (const b of swatches) {
      b.click();
      await new Promise(res => setTimeout(res, 40));
      seen.push(document.documentElement.getAttribute('data-theme'));
    }
    const allKnown = seen.every((t) => SD.Settings.THEMES.some((x) => x.id === t));
    const saved = SD.Store.settings().theme;
    return { ok: allKnown && seen.length === swatches.length && saved === seen[seen.length - 1],
             info: '依次切到 ' + seen.join(' → ') + '，已存入设置' };
  })()`);

  await step('设置页管着高亮与纠错开关', `(function(){
    const boxes = Array.from(document.querySelectorAll('#page-root .switch.setting input'));
    const box = boxes.find((i) => i.closest('label').textContent.indexOf('高亮联动') === 0);
    if (!box) return { ok: false, info: '设置页没有高亮开关' };
    const before = SD.Store.settings().highlight;
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
    const after = SD.Store.settings().highlight;
    box.checked = before;
    box.dispatchEvent(new Event('change'));
    return { ok: boxes.length === 6 && after === !before,
             info: boxes.length + ' 个开关，改动已写回设置' };
  })()`);

  await step('关于页写清了游戏的做法', `(function(){
    document.getElementById('page-back').click();
    document.querySelector('.home-item[data-go=about]').click();
    const cards = document.querySelectorAll('.about-card');
    const paras = document.querySelectorAll('.about-card p');
    const titles = Array.from(cards).map((c) => c.querySelector('h3').textContent);
    let chars = 0;
    for (const p of paras) chars += p.textContent.length;
    return { ok: cards.length >= 5 && chars > 400,
             info: cards.length + ' 节 / ' + paras.length + ' 段 / ' + chars + ' 字：' + titles.join('、') };
  })()`);

  await step('首页与游戏页可来回切换', `(async function(){
    document.getElementById('page-back').click();
    await new Promise(res => setTimeout(res, 80));
    const backHome = document.documentElement.getAttribute('data-view');
    SD.App.showView('game');
    await new Promise(res => setTimeout(res, 80));
    const toGame = document.documentElement.getAttribute('data-view');
    SD.App.showView('home');
    return { ok: backHome === 'home' && toGame === 'game',
             info: '返回=' + backHome + '，切游戏页=' + toGame };
  })()`);

  await step('每日挑战页显示日期与战绩', `(async function(){
    const g = SD.App.getGame();
    SD.App.showView('home');
    await new Promise(res => setTimeout(res, 60));
    document.querySelector('.home-item[data-go=daily]').click();
    await new Promise(res => setTimeout(res, 200));
    const stats = document.querySelectorAll('#page-root .daily-stat').length;
    const title = document.getElementById('page-title').textContent;
    document.getElementById('page-back').click();
    g.start(SD.Base.stringToGrid('530070000600195000098000060800060003400803001700020006060000280000419005000080079'),
      { difficultyName: '每日挑战', dailyKey: SD.Generator.dailySeed(), title: '每日挑战 · 测试' }, null);
    SD.App.render();
    await new Promise(res => setTimeout(res, 120));
    const label = document.getElementById('stat-difficulty-label').textContent;
    const value = document.getElementById('stat-difficulty').textContent;
    const dateOk = value.length === 10 && value.charAt(4) === '-' && value.charAt(7) === '-';
    return { ok: stats === 3 && title === '每日挑战' && label === '今日' && dateOk,
             info: title + '页 ' + stats + ' 项战绩；状态栏 ' + label + ' ' + value };
  })()`);
  await step('从首页发起每日挑战会真的进到对局', `(async function(){
    SD.App.showView('home');
    await new Promise(res => setTimeout(res, 60));
    document.querySelector('.home-item[data-go=daily]').click();
    await new Promise(res => setTimeout(res, 200));
    document.querySelector('#page-root .btn-primary').click();
    // 出题要一两秒，轮询等它落地
    for (let i = 0; i < 40; i++) {
      await new Promise(res => setTimeout(res, 250));
      if (document.documentElement.getAttribute('data-view') === 'game') break;
    }
    const view = document.documentElement.getAttribute('data-view');
    const st = SD.App.getGame().state;
    const overlayGone = document.getElementById('home-overlay').hidden;
    const isDaily = !!st.meta.dailyKey;
    const title = (SD.App.getGame().state.meta.title || '');
    return { ok: view === 'game' && overlayGone && isDaily && title.indexOf('每日挑战') === 0,
             info: '视图=' + view + '，遮罩已收起=' + overlayGone + '，标题=' + title };
  })()`);

  await step('提示执行把盘填满会弹出庆祝', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('easy', 'win-by-hint');
    SD.App.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    for (let i = 0; i < 81; i++) g.state.board.grid[i] = fresh.solution[i];
    // 走提示执行这条路：checkWin() 内部负责播报，这里确认它真的播了
    const before = document.querySelectorAll('.modal').length;
    const empty = { step: { id: 'naked-single', level: 1, placements: [], eliminations: [], cells: [], marks: [] }, explain: { kind: 'elim' } };
    g.applyStep(empty, true);
    await new Promise(res => setTimeout(res, 200));
    const after = document.querySelectorAll('.modal').length;
    const head = document.querySelector('.modal-head');
    const title = head ? head.textContent : '';
    if (head && head.parentElement.querySelector('.modal-foot .btn')) head.parentElement.querySelector('.modal-foot .btn').click();
    return { ok: after > before && title.indexOf('完成') >= 0,
             info: '弹窗 ' + before + ' → ' + after + '，标题「' + title.trim() + '」' };
  })()`);

  await step('自动求解把盘填满也会弹庆祝', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('easy', 'win-by-solve');
    SD.App.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    const before = document.querySelectorAll('.modal').length;
    g.autoSolve();
    await new Promise(res => setTimeout(res, 400));
    const after = document.querySelectorAll('.modal').length;
    const won = g.state.won;
    const close = document.querySelector('.modal-foot .btn');
    if (close) close.click();
    return { ok: after > before && won,
             info: '弹窗 ' + before + ' → ' + after + '，won=' + won };
  })()`);

  await step('每日挑战日历按进度分三种状态', `(async function(){
    const s = SD.Store.stats();
    const t = new Date();
    const keyOf = (n) => {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
      return SD.Generator.dailySeed(d);
    };
    s.daily[keyOf(3)] = { timeMs: 62000, won: true, tries: 1, filled: 81, total: 81 };
    s.daily[keyOf(1)] = { timeMs: null, won: false, tries: 0, filled: 40, total: 81 };
    document.querySelector('.home-item[data-go=daily]').click();
    await new Promise(res => setTimeout(res, 250));
    const cells = Array.from(document.querySelectorAll('.cal-day'));
    const trophies = document.querySelectorAll('.cal-trophy').length;
    const rings = cells.filter((c) => c.style.getPropertyValue('--p'));
    const done = cells.filter((c) => c.classList.contains('is-won'));
    const untouched = cells.filter((c) => !c.style.getPropertyValue('--p'));
    const today = document.querySelector('.cal-day.is-today');
    return { ok: cells.length >= 28 && trophies === 1 && done.length === 1 && rings.length >= 1 && untouched.length > 10,
             info: cells.length + ' 格，奖杯 ' + trophies + ' 顶，带进度 ' + rings.length + ' 格，空白 ' + untouched.length + ' 格，今天=' + (today ? today.querySelector('.cal-num').textContent : '无') };
  })()`);

  await step('游戏页有回首页的入口且不再有换一题', `(async function(){
    SD.App.showView('game');
    await new Promise(r => setTimeout(r, 80));
    const back = document.getElementById('btn-home-back');
    const gone = !document.getElementById('btn-new');
    const brand = document.getElementById('btn-home');
    if (!back) return { ok: false, info: '顶栏没有返回按钮' };
    back.click();
    await new Promise(r => setTimeout(r, 120));
    const view = document.documentElement.getAttribute('data-view');
    return { ok: view === 'home' && gone && !!brand,
             info: '返回按钮点击后视图=' + view + '，换一题已移除=' + gone + '，logo 可点=' + !!brand };
  })()`);

  await step('出题途中回首页不会卡在加载遮罩', `(async function(){
    // 遮罩跟视图走会出岔子：出题在首页发起，生成完切到游戏页，
    // 收起时按新视图去找就找错节点，灰幕留在首页点不掉
    SD.App.showView('home');
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.home-item[data-go=play]').click();
    await new Promise(r => setTimeout(r, 150));
    const btn = document.querySelectorAll('#dialog-root .btn');
    const diff = Array.from(btn).find((b) => b.dataset && b.dataset.difficulty);
    if (diff) diff.click();
    await new Promise(r => setTimeout(r, 120));
    const shownNow = !document.getElementById('home-overlay').hidden;
    // 立刻回首页
    document.getElementById('btn-home-back').click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (document.getElementById('home-overlay').hidden && document.getElementById('board-overlay').hidden) break;
    }
    const homeClear = document.getElementById('home-overlay').hidden;
    const boardClear = document.getElementById('board-overlay').hidden;
    return { ok: homeClear && boardClear,
             info: '出题时遮罩已显示=' + shownNow + '，回首页后 首页遮罩收起=' + homeClear + ' 棋盘遮罩收起=' + boardClear };
  })()`);

  // 这条验的是手机上的底部面板，桌面宽度下它是左右分栏，所以先把视口切成手机
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  await step('提示面板贴在棋盘下方且不遮住整块盘面', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('medium', 'sheet');
    SD.App.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    document.getElementById('btn-hint').click();
    await new Promise(res => setTimeout(res, 400));
    const area = document.querySelector('#hint-area');
    const board = document.querySelector('.board-wrap').getBoundingClientRect();
    const sheet = area.getBoundingClientRect();
    // 面板必须是 fixed 的：它压在盘面上、只盖住底部一小段，
    // 否则讲解里的【R2C8】抬头找不到对应格子，等于白讲
    const isFixed = getComputedStyle(area).position === 'fixed';
    // 顶边贴在盘面下沿（留几像素缝），不能低到把键盘功能栏的位置也空出来
    const onTop = sheet.top - board.bottom <= 24;
    const covered = board.bottom - sheet.top;
    const ratio = covered / board.height;
    const actions = document.querySelector('.hint-actions').getBoundingClientRect();
    const inView = actions.bottom <= window.innerHeight + 1;
    const padGone = getComputedStyle(document.querySelector('.number-pad')).display === 'none';
    const toolsGone = getComputedStyle(document.querySelector('.board-tools')).display === 'none';
    // 棋盘越窄面板越贴不到盘面上，covered 会是负数——那是好事，全盘都看得见
    const sheetTall = sheet.height > window.innerHeight * 0.25;
    return { ok: isFixed && onTop && ratio < 0.3 && inView && padGone && toolsGone && sheetTall,
             info: 'fixed=' + isFixed + '，盘面被遮 ' + Math.max(0, Math.round(ratio * 100)) + '%（' + Math.max(0, Math.round(covered)) + 'px），面板高 ' + Math.round(sheet.height) + 'px，按钮在屏内=' + inView + '，键盘收起=' + padGone + '，功能栏收起=' + toolsGone };
  })()`);
  await send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await step('换一条解法，正文回到开头且技巧条露出当前那条', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('expert', 'scroll-reset');
    SD.App.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    SD.App.setHintOpen(true);
    await new Promise(res => setTimeout(res, 200));
    const out = document.querySelector('#hint-output');
    const chips = out.querySelectorAll('.hint-chip');
    if (chips.length < 2) return { ok: false, info: '解法太少，测不了' };
    // 先把正文压到能滚动、滚到底，模拟「读到一半」。
    // 只设 height 不够：面板里它是 flex: 1，flex-basis 会盖掉 height。
    const natural = out.style.cssText;
    out.style.flex = 'none';
    out.style.height = '120px';
    out.scrollTop = out.scrollHeight;
    await new Promise(res => setTimeout(res, 60));
    const scrolledBefore = out.scrollTop > 10;
    chips[chips.length - 1].click();
    await new Promise(res => setTimeout(res, 150));
    const backToTop = out.scrollTop === 0;
    out.style.cssText = natural;
    const strip = out.querySelector('.hint-strip');
    const on = strip.querySelector('.hint-chip.is-on');
    const visible = on.offsetLeft >= strip.scrollLeft - 1 && on.offsetLeft + on.offsetWidth <= strip.scrollLeft + strip.clientWidth + 1;
    return { ok: scrolledBefore && backToTop && visible,
             info: '读到底=' + scrolledBefore + '，换解法后回到顶=' + backToTop + '，选中的技巧在可视范围=' + visible };
  })()`);
  await step('备局时不会把人拽出首页', `(async function(){
    const fresh = SD.Generator.generateSync('easy', 'keep-view');
    const meta = { difficultyName: '测试' };
    // keepView 为真：冷启动在后台备好一局，玩家还站在别的页面上，不该被拽走
    SD.App.showView('page');
    SD.App.startWith(fresh.givens, meta, fresh.solution, true);
    await new Promise(res => setTimeout(res, 60));
    const kept = document.documentElement.getAttribute('data-view');
    // 不带 keepView：从首页发起的开局必须切到游戏页，否则等于点了没反应
    SD.App.showView('home');
    SD.App.startWith(fresh.givens, meta, fresh.solution);
    await new Promise(res => setTimeout(res, 60));
    const jumped = document.documentElement.getAttribute('data-view');
    return { ok: kept === 'page' && jumped === 'game',
             info: 'keepView 时停在 ' + kept + '，正常开局切到 ' + jumped };
  })()`);
  await step('每套主题的关键变量都定义齐全', `(function(){
    const need = ['--bg', '--surface', '--text', '--accent', '--box-line', '--box-tint'];
    const bad = [];
    for (const t of SD.Settings.THEMES) {
      if (t.id === 'auto') continue;
      document.documentElement.setAttribute('data-theme', t.id);
      const cs = getComputedStyle(document.documentElement);
      for (const v of need) {
        if (!cs.getPropertyValue(v).trim()) bad.push(t.id + ' 缺 ' + v);
      }
    }
    document.documentElement.setAttribute('data-theme', SD.Store.settings().theme);
    return { ok: bad.length === 0, info: bad.length ? bad.join('; ') : SD.Settings.THEMES.length + ' 套主题变量齐全' };
  })()`);

  await step('每日挑战能出题且日期即种子', `(async function(){
    const a = SD.Generator.dailySeed(new Date(2026, 0, 5));
    const b = SD.Generator.dailySeed(new Date(2026, 0, 5));
    const c = SD.Generator.dailySeed(new Date(2026, 0, 6));
    const g1 = SD.Generator.generateSync('medium', a);
    const g2 = SD.Generator.generateSync('medium', a);
    const same = Array.from(g1.givens).join('') === Array.from(g2.givens).join('');
    const st = SD.Store.dailyStats();
    const uniq = SD.Solver.solve(g1.givens, 2).count === 1;
    return { ok: a === b && a !== c && same && uniq && st.today === SD.Generator.dailySeed(),
             info: a + ' 同种子同题=' + same + '，唯一解=' + uniq + '，今日连续 ' + st.streak + ' 天' };
  })()`);

  await step('讲解里的【R6C6】能点亮对应格子', `(async function(){
    const g = SD.App.getGame();
    const fresh = SD.Generator.generateSync('expert', 'cell-ref');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    SD.App.setHintOpen(true);
    document.getElementById('btn-hint-show').click();
    await new Promise(res => setTimeout(res, 150));
    const refs = document.querySelectorAll('#hint-output .ref');
    if (!refs.length) return { ok: false, info: '讲解里没有格子引用' };
    const first = refs[0];
    const cell = Number(first.dataset.cell);
    const row = Math.floor(cell / 9) + 1;
    const col = (cell % 9) + 1;
    const label = '【R' + row + 'C' + col + '】';
    first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const lit = document.querySelectorAll('.cell.is-ref');
    const right = lit.length === 1 && Number(lit[0].dataset.index) === cell;
    document.getElementById('hint-output').dispatchEvent(new MouseEvent('mouseleave'));
    const cleared = document.querySelectorAll('.cell.is-ref').length === 0;
    return { ok: right && cleared && first.textContent === label,
             info: refs.length + ' 处引用，' + first.textContent + ' → 第 ' + cell + ' 格，点亮=' + right + '，移出后清空=' + cleared };
  })()`);
  await step('技巧教学弹窗渲染出全部技巧', `(async function(){
    SD.App.showView('game');
    await new Promise(r => setTimeout(r, 80));
    document.getElementById('btn-learn').click();
    await new Promise(r => setTimeout(r, 200));
    const cards = document.querySelectorAll('.modal .tech-card');
    const chips = document.querySelectorAll('.modal .tech-chip');
    // 弹窗里点开一条，卡片要能原地展开成完整讲解
    const head = document.querySelector('.modal .tech-head');
    if (head) head.click();
    await new Promise(r => setTimeout(r, 150));
    const opened = document.querySelectorAll('.modal .tech-card.is-open').length;
    const close = document.querySelector('.modal-foot .btn');
    if (close) close.click();
    return { ok: cards.length >= 12 && opened === 1,
             info: cards.length + ' 张技巧卡片，本局面可用 ' + chips.length + ' 种，展开 ' + opened + ' 条' };
  })()`);
  await step('题库页挂着图片识别与我的题库', `(async function(){
    SD.App.showView('home');
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 300));
    const drop = document.querySelector('#page-root .ocr-drop');
    const builtIn = document.querySelectorAll('#page-root .bank-item:not(.is-mine)').length;
    const saved = document.querySelectorAll('#page-root .bank-item.is-mine').length;
    // 存一道再退回首页重进，验证它真的落到了存储里并且页面会重画
    SD.Store.addUserPuzzle(SD.Bank.LIST[2].grid, '我的题目 1', '简单');
    const stored = SD.Store.userBank().length;
    document.getElementById('page-back').click();
    await new Promise(r => setTimeout(r, 120));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 300));
    const mine = document.querySelectorAll('#page-root .bank-item.is-mine').length;
    const playable = !!document.querySelector('#page-root .bank-item.is-mine .btn-primary');
    return { ok: !!drop && builtIn === SD.Bank.LIST.length && stored === saved + 1 && mine === stored && playable,
             info: 'OCR 入口=' + !!drop + '，精选 ' + builtIn + ' 道，存入 ' + stored + ' 道，重进页面显示 ' + mine + ' 道，可开始=' + playable };
  })()`);

  await step('透视校正数学正确（合成测试）', `(function(){
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200);
    ctx.fillStyle = '#000';
    // 在四角附近画黑点，检验映射后是否落在输出四角
    const quad = [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200}];
    const H = SD.Vision.homography(quad, [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
    const map = (x,y) => { const w = H[6]*x+H[7]*y+H[8]; return [(H[0]*x+H[1]*y+H[2])/w, (H[3]*x+H[4]*y+H[5])/w]; };
    const p = map(200,200);
    return { ok: Math.abs(p[0]-100)<1e-6 && Math.abs(p[1]-100)<1e-6, info: '(200,200) → (' + p.map(v=>v.toFixed(2)).join(',') + ')' };
  })()`);

  await step('存档写入 localStorage', `(function(){
    const raw = localStorage.getItem('sudoku-studio:v1');
    if (!raw) return { ok: false, info: '没有存档' };
    const data = JSON.parse(raw);
    return { ok: !!data.settings && !!data.stats, info: 'settings ' + Object.keys(data.settings).length + ' 项, stats ' + Object.keys(data.stats).length + ' 项' };
  })()`);

  await step('导出棋盘 PNG 可生成', `(function(){
    const g = SD.App.getGame();
    const canvas = SD.Data.exportBoardPNG(g.state.board, '测试');
    return { ok: canvas.width > 400 && canvas.height > 400, info: canvas.width + '×' + canvas.height };
  })()`);

  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r && r.data) fs.writeFileSync(path.join(__dirname, 'shot-app.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => {});

  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  console.log('\n================ 浏览器冒烟测试 ================');
  let bad = 0;
  for (const r of results) {
    console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.detail ? '  — ' + r.detail : ''));
    if (!r.ok) bad++;
  }
  if (problems.length) {
    console.log('\n--- 页面异常 / console.error ---');
    for (const p of Array.from(new Set(problems)).slice(0, 20)) console.log('  ! ' + p);
  } else {
    console.log('\n页面无异常、无 console.error');
  }
  console.log('\n通过 ' + (results.length - bad) + ' / ' + results.length);
  process.exit(bad || problems.length ? 1 : 0);
}

main().catch((e) => { console.error('测试崩溃:', e); process.exit(2); });
