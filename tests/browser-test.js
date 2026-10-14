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
    '--window-size=1400,1000', 'about:blank',
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

  /**
   * 求值带超时。页面里一旦有死循环或者渲染进程崩了，Runtime.evaluate 永远不会返回，
   * 整个测试就无声无息地挂住——看不到任何输出，也分不清是卡在哪一步。
   * 宁可报一条「求值超时」，也不要让人对着空日志猜。
   */
  const evaluate = async (expr, timeoutMs) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error('求值超时 ' + (timeoutMs || 60000) + 'ms：' + String(expr).slice(0, 90))),
        timeoutMs || 60000)),
    ]);
    if (r.exceptionDetails) throw new Error('求值失败: ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  // 启用了空白页，等 CDP 接稳再导航。原先靠启动参数直接开目标页，
  // 页面在监听挂上之前就开始加载，前几个脚本的异常抓不到，
  // 还会因为时序问题看到半加载状态，误报成「一堆模块缺失」。
  await send('Page.navigate', { url: URL });
  // 轮询到应用真的就绪，而不是死等固定秒数：页面里 tesseract.min.js 有 20MB，
  // 会把后面几个 UI 脚本整体拖后，睡 3 秒就开跑会看到半加载状态。
  const NEED = ['SD.UI', 'SD.Registry', 'SD.Storage', 'SD.Points', 'SD.Shell', 'SD.Sudoku.app', 'SD.Sudoku.ocr', 'SD.Sudoku.data'];
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    await sleep(250);
    try {
      ready = await evaluate('typeof SD !== "undefined" && ' + NEED.map((k) => '!!' + k).join(' && '));
    } catch (e) { /* 页面还没到能求值的程度 */ }
  }
  if (!ready) {
    // 报清楚缺哪个，而不是只说「没就绪」——否则又得重头猜一遍
    let missing = '页面完全没起来';
    try {
      missing = await evaluate('typeof SD === "undefined" ? "SD 未定义" : '
        + JSON.stringify(NEED) + '.filter(function (k) {'
        + ' return !k.split(".").reduce(function (o, p) { return o && o[p]; }, window); }).join(",") || "全部就绪"');
    } catch (e) { /* 求值不了就算了 */ }
    throw new Error('应用在 50 秒内没有就绪，缺：' + missing);
  }
  await sleep(300);

  // 应用现在落在标题页，先进入数独，后面所有用例都在数独里跑。
  // 这一步顺带验证了「注册表 → 壳 → 游戏挂载」这条链路真的通。
  const enterSudoku = async () => {
    const cur = await evaluate('SD.Shell.game() && SD.Shell.game().id');
    if (cur !== 'sudoku') {
      await evaluate('(function () { const c = document.querySelector(".game-card:not(.is-soon)");'
        + ' if (c) c.click(); return !!c; })()');
    }
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      if (await evaluate('!!document.querySelector("#board .cell")')) break;
    }
    await sleep(150);
  };
  await enterSudoku();

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  };

  const step = async (name, expr, timeoutMs) => {
    const t0 = Date.now();
    try {
      const v = await evaluate(expr, timeoutMs);
      check(name, v && v.ok !== false, v && v.info !== undefined ? v.info : JSON.stringify(v));
    } catch (e) {
      check(name, false, '抛异常: ' + e.message);
    }
    // 边跑边打一行进度：万一后面某一步把进程挂住，日志里至少看得到卡在哪一步、卡了多久
    const last = results[results.length - 1];
    const ms = Date.now() - t0;
    console.log((last.ok ? '  ✓ ' : '  ✗ ') + last.name + (ms > 1500 ? '  [' + ms + 'ms]' : ''));
  };

  await step('棋盘渲染出 81 格', `(function(){
    const cells = document.querySelectorAll('#board .cell');
    const g = window.SD && SD.Sudoku.app && SD.Sudoku.app.getGame();
    // 全新环境第一局还在生成，givens 可能还没就绪，不能直接 Array.from
    const given = g && g.state.givens ? Array.from(g.state.givens).filter(Boolean).length : 0;
    return { ok: cells.length === 81, info: cells.length + ' 格 / 题面 ' + given + ' 线索' };
  })()`);

  await step('核心命名空间齐备', `(function(){
    const need = ['Base','Solver','Generator','Techniques','Rater','Validation','UI','Registry','Storage','Points','Shell','Settings','About','BoardView','Demo'];
    const sudoku = ['store','game','panels','data','gacha','learn','ocr','vision','app','settings'];
    const miss = need.filter(k => !window.SD || !SD[k]);
    const missSudoku = sudoku.filter(k => !SD.Sudoku || !SD.Sudoku[k]);
    const total = need.length + sudoku.length;
    return { ok: miss.length === 0 && missSudoku.length === 0,
             info: (miss.length || missSudoku.length)
               ? '缺少 ' + miss.concat(missSudoku.map(k => 'Sudoku.' + k)).join(',')
               : '平台 ' + need.length + ' 个 + 数独 ' + sudoku.length + ' 个，共 ' + total + ' 个模块就位' };
  })()`);

  await step('技巧清单已注册', `(function(){
    const ids = SD.Techniques.LIST.map(t => t.id);
    return { ok: ids.length >= 12, info: ids.length + ' 种: ' + ids.join(',') };
  })()`);

  await step('点击格子可选中', `(async function(){
    const cells = document.querySelectorAll('#board .cell');
    cells[40].click();
    await new Promise(r => setTimeout(r, 60));
    const g = SD.Sudoku.app.getGame();
    return { ok: g.state.selected === 40, info: 'selected=' + g.state.selected };
  })()`);

  await step('键盘输入数字', `(async function(){
    // 自带局面：原先沿用上一条用例留下的盘面，新鲜环境下会找不到能制造冲突的数字
    var fresh = SD.Generator.generateSync('easy', 'keyboard-test');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    await new Promise(r => setTimeout(r, 120));
    const g = SD.Sudoku.app.getGame();
    function withAt(grid, i, d) { const c = Uint8Array.from(grid); c[i] = d; return c; }
    const i = Array.from(g.state.board.grid).findIndex((v, k) => v === 0 && !g.state.board.isGiven(k));
    if (i < 0) return { ok: false, info: '没有空格可测' };
    g.select(i);
    const wrongDigit = [1,2,3,4,5,6,7,8,9].find(d => g.state.board.grid[i] !== d && SD.Validation.findConflicts(withAt(g.state.board.grid, i, d)).size > 0);
    if (!wrongDigit) return { ok: false, info: '找不到能制造冲突的数字' };
    g.inputDigit(wrongDigit);
    await new Promise(r => setTimeout(r, 60));
    // 不阻断：数字留在盘上，只把这一格记成填错并标红
    const kept = g.state.board.grid[i] === wrongDigit;
    const marked = g.wrongCells().has(i);
    const counted = g.state.mistakes > 0;
    const red = !!document.querySelector('#board .cell.is-wrong');
    SD.Sudoku.app.showView('home');
    return { ok: kept && marked && counted && red,
             info: '格=' + i + ' 填冲突数字 ' + wrongDigit + '：保留=' + kept
               + '，标红=' + marked + '，有红字样式=' + red + '，计入错误=' + counted };
  })()`);
  await step('撤销栈顺序正确（撤销回到上一步）', `(async function(){
    const g = SD.Sudoku.app.getGame();
    g.select(2); g.state.board.clearCell(2, { force: true });
    const snap = Array.from(g.state.board.grid);
    g.select(5); g.inputDigit(4);
    await new Promise(r => setTimeout(r, 30));
    g.undo();
    await new Promise(r => setTimeout(r, 30));
    const same = Array.from(g.state.board.grid).every((v, k) => v === snap[k]);
    return { ok: same, info: same ? '撤销后回到上一步' : '撤销后与上一步不一致' };
  })()`);
  await step('重做可用', `(async function(){
    const g = SD.Sudoku.app.getGame();
    const okRedo = g.redo();
    await new Promise(r => setTimeout(r, 30));
    return { ok: okRedo === true, info: 'redo 返回 ' + okRedo };
  })()`);

  await step('笔记模式可切换', `(async function(){
    const g = SD.Sudoku.app.getGame();
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
    // 自备局面：原先沿用上一条用例留下的盘面，那边若刚重开过局，
    // 计数基线就不是这道题的了
    var fresh = SD.Generator.generateSync('easy', 'onekey-hint');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    await new Promise(res => setTimeout(res, 150));
    const g = SD.Sudoku.app.getGame();
    const before = g.state.board.grid.filter(Boolean).length;
    document.getElementById('btn-hint-apply').click();
    await new Promise(res => setTimeout(res, 200));
    const after = g.state.board.grid.filter(Boolean).length;
    const card = document.querySelector('#hint-output .hint-card');
    const liCount = document.querySelectorAll('#hint-output .hint-section ol li').length;
    const concl = document.querySelector('#hint-output .hint-conclusion');
    SD.Sudoku.app.showView('home');
    return { ok: !!card && liCount > 0 && !!concl && after > before,
             info: '卡片=' + !!card + ' 推导行=' + liCount + ' 结论=' + !!concl + ' 填入 ' + before + '→' + after };
  })()`);

  await step('自动求解能填满棋盘', `(async function(){
    const g = SD.Sudoku.app.getGame();
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
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('expert', 'hint-list');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    SD.Sudoku.app.setHintOpen(true);
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
    const g = SD.Sudoku.app.getGame();
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
    const g = SD.Sudoku.app.getGame();
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
    const g = SD.Sudoku.app.getGame();
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
    const g = SD.Sudoku.app.getGame();
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
    SD.Sudoku.app.render();
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
    const g = SD.Sudoku.app.getGame();
    g.state.board.locked.fill(0);
    g.state.board.notes.fill(0);
    g.setNoteMode(true);
    g.select(0);
    g.inputDigit(3);
    g.inputDigit(7);
    g.inputDigit(3);
    SD.Sudoku.app.render();
    const on = Array.from(document.querySelectorAll('.np-digit.is-note')).map(e => e.dataset.digit).sort();
    g.setNoteMode(false);
    return { ok: on.join(',') === '7', info: '点亮的数字=' + (on.join(',') || '无') + '，选中格笔记=0b' + g.state.board.notes[0].toString(2) };
  })()`);

  await step('数独首页的五个入口都在', `(async function(){
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 80));
    const view = document.documentElement.getAttribute('data-view');
    const items = Array.from(document.querySelectorAll('.home-item')).map((b) => b.dataset.go);
    // 设置与关于搬到了标题页：三款游戏共用一份，不该每款各放一个入口
    const want = ['play', 'bank', 'daily', 'mine', 'learn'];
    return { ok: view === 'home' && items.join(',') === want.join(','),
             info: '视图=' + view + '，入口 ' + items.join(' / ') };
  })()`);

  await step('技巧教学页能展开且有演示棋盘', `(async function(){
    var err = null;
    window.onerror = function (m) { err = m; };
    document.querySelector('.home-item[data-go=learn]').click();
    var heads = document.querySelectorAll('.tech-head');
    if (!heads.length) return { ok: false, info: '没有渲染出技巧卡片' };
    heads[0].click();
    var board = document.querySelector('.demo-board');
    var opened = document.querySelectorAll('.tech-card.is-open').length;
    var info = '卡片 ' + heads.length + ' 个，展开 ' + opened + ' 个，演示棋盘 ' + (board ? board.children.length + ' 格' : '无');
    if (err) info += '，异常: ' + err;
    return { ok: opened === 1 && !!board && !err, info: info };
  })()`);

  await step('正在做的局：每档只留一局，且只列真正开过的档', `(async function(){
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 200));
    var rows = document.querySelectorAll('#page-root .bank-item.is-queue');
    // 一档都没开过就不该摆出空行——这正是「这里直接不要」的意思
    var emptyAtStart = rows.length === 0;
    var q = SD.Generator.generateSync('medium', 'queue-one');
    var gid = SD.Base.gridToString(q.givens);
    SD.Sudoku.store.pushQueue('medium', gid, q.clueCount, q.level);
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 100));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 250));
    var after = document.querySelectorAll('#page-root .bank-item.is-queue');
    var oneOnly = after.length === 1;
    var rep = SD.Generator.inspect(SD.Base.stringToGrid(gid));
    var btn = !!document.querySelector('#page-root .bank-item.is-queue .btn-primary');
    SD.Sudoku.store.removeQueueItem(SD.Sudoku.store.queueOf('medium')[0].id);
    SD.Sudoku.app.showView('home');
    return { ok: emptyAtStart && oneOnly && rep.valid && btn,
             info: '没开局时行数=' + rows.length + '，开一局后=' + after.length
               + '（每档只一局=' + oneOnly + '），题目合法=' + rep.valid + '，有继续按钮=' + btn };
  })()`);

  await step('换一代生成器后旧存档会被丢弃', `(function(){
    // 模拟「修复前存下的那局」：没有 genVersion 的旧存档
    var probe = SD.Generator.generateSync('easy', 'old-save-probe');
    var probeGrid = SD.Base.gridToString(probe.givens);
    SD.Sudoku.store.saveGame({ givens: probeGrid, grid: probeGrid, notes: [], meta: { difficultyName: '旧存档' }, hints: 0, mistakes: 0, elapsed: 0 });
    var raw = JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(function (k) { return /sudoku/i.test(k); })[0] || '{}'));
    var key = Object.keys(localStorage).filter(function (k) { return /sudoku/i.test(k); })[0];
    if (key) {
      var obj = JSON.parse(localStorage.getItem(key));
      delete obj.game.genVersion;
      localStorage.setItem(key, JSON.stringify(obj));
    }
    var got = SD.Sudoku.store.loadGame();
    return { ok: got === null, info: got === null ? '旧存档已被丢弃' : '旧存档仍被恢复（不符合预期）' };
  })()`);

  await step('自动求解不会用求解器偷偷填完剩下的', `(async function(){
    // 用一道「余数法推不完」的盘面：跑 autoSolve 后若被求解器兜底填满，
    // 就会出现「全盘是自动求解填的却声称人类推完」的假象
    var gen = SD.Generator.generateSync('master', 'autosolve-honesty');
    SD.Sudoku.app.startWith(gen.givens, { difficultyName: '测试' }, gen.solution);
    await new Promise(function (r) { setTimeout(r, 120); });
    var g = SD.Sudoku.app.getGame();
    var before = g.state.board.grid.filter(Boolean).length;
    var n = g.autoSolve();
    var after = g.state.board.grid.filter(Boolean).length;
    var complete = after === 81;
    var err = g.state.solveError || '';
    // 填满了就必须真的是 walkthrough 推完的（技巧记录非空），
    // 没填满则必须说明原因，不许静默
    var ok = complete ? (n > 0 && g.state.techniques.length > 0) : err.length > 0;
    return { ok: ok,
             info: '推了 ' + n + ' 步，填到 ' + before + '→' + after + ' 格，记录 ' + g.state.techniques.length
               + ' 条技巧' + (complete ? '，已推完' : '，未推完并说明：' + err.slice(0, 20)) };
  })()`);

  await step('通关统计包含纯删数的技巧', `(async function(){
    var gen = SD.Generator.generateSync('master', 'tech-record-elim-only');
    SD.Sudoku.app.startWith(gen.givens, { difficultyName: '测试' }, gen.solution);
    await new Promise(function (r) { setTimeout(r, 120); });
    var g = SD.Sudoku.app.getGame();
    g.autoSolve();
    var kinds = {};
    for (const id of g.state.techniques) kinds[id] = 1;
    var ids = Object.keys(kinds);
    var singles = (kinds['naked-single'] || 0) + (kinds['hidden-single'] || 0);
    var others = ids.filter(function (k) { return k !== 'naked-single' && k !== 'hidden-single'; });
    SD.Sudoku.app.showView('home');
    return { ok: others.length > 0,
             info: '记录 ' + ids.length + ' 种技巧，其中余数法 ' + singles + ' 次、其他 ' + others.length + ' 种：' + others.join(',') };
  })()`);


  await step('提示面板跟着盘面实时刷新', `(async function(){
    var fresh = SD.Generator.generateSync('master', 'hint-live');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    await new Promise(function (r) { setTimeout(r, 150); });
    var g = SD.Sudoku.app.getGame();
    document.getElementById('btn-hint').click();
    await new Promise(function (r) { setTimeout(r, 250); });
    var out = document.querySelector('#hint-output');
    var before = out.querySelectorAll('.hint-chip').length;
    if (!before) return { ok: false, info: '面板里没有解法，测不了' };
    var beforeText = out.textContent;
    var empty = -1;
    for (var i = 0; i < 81; i++) if (!g.state.board.grid[i] && !g.state.board.locked[i]) { empty = i; break; }
    if (empty < 0) return { ok: true, info: '盘面已满' };
    // 必须走真实 UI：直接调 inputDigit 不会触发 render，测不到面板刷新
    document.querySelector('#board .cell[data-index="' + empty + '"]').click();
    document.querySelector('.np-digit[data-digit="' + fresh.solution[empty] + '"]').click();
    await new Promise(function (r) { setTimeout(r, 400); });
    var afterText = out.textContent;
    var after = out.querySelectorAll('.hint-chip').length;
    var filled = g.state.board.grid[empty];
    // 关键不是「文本变了」——填一格未必改变最优解法的措辞。
    // 要验的是面板与盘面同步：强制重算一次，两者必须一致。
    var lv = document.getElementById('hint-level');
    lv.dispatchEvent(new Event('change'));
    await new Promise(function (r) { setTimeout(r, 300); });
    var recomputed = out.textContent;
    SD.Sudoku.app.showView('home');
    return { ok: !!filled && recomputed === afterText,
             info: '填了 ' + filled + '，解法 ' + before + '→' + after + ' 条，面板与重算结果'
               + (recomputed === afterText ? '一致' : '不一致') };
  })()`);
  await step('设置页可切换全部主题', `(async function(){
    // 品牌按钮 = 回标题页换游戏。设置是合集级的，挂在标题页上，三款游戏共用一份
    document.getElementById('btn-home').click();
    await new Promise(res => setTimeout(res, 100));
    document.getElementById('title-settings').click();
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
    // 主题存在全局命名空间：换一款游戏不该让人重新挑一次外观
    const saved = SD.Storage.global().data().theme;
    return { ok: allKnown && seen.length === swatches.length && saved === seen[seen.length - 1],
             info: '依次切到 ' + seen.join(' → ') + '，已存入设置' };
  })()`);

  await step('设置页按游戏分区，数独那组开关都管用', `(function(){
    // 设置页现在把每款游戏的设置各放一张卡片，所以要按分区取，不能整页扫——
    // 整页扫会把扫雷的开关也算进来
    const cards = Array.from(document.querySelectorAll('#page-root .card'));
    const sudoku = cards.find((c) => {
      const h = c.querySelector('h3');
      return h && h.textContent === '数独';
    });
    if (!sudoku) return { ok: false, info: '设置页没有数独分区' };
    const boxes = Array.from(sudoku.querySelectorAll('.switch.setting input'));
    const box = boxes.find((i) => i.closest('label').textContent.indexOf('高亮联动') === 0);
    if (!box) return { ok: false, info: '数独分区里没有高亮开关' };
    const before = SD.Sudoku.store.settings().highlight;
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change'));
    const after = SD.Sudoku.store.settings().highlight;
    box.checked = before;
    box.dispatchEvent(new Event('change'));
    return { ok: boxes.length === 6 && after === !before,
             info: '数独分区 ' + boxes.length + ' 个开关，改动已写回设置' };
  })()`);

  await step('关于页写清了游戏的做法', `(async function(){
    document.getElementById('page-back').click();
    await new Promise(res => setTimeout(res, 100));
    document.getElementById('title-about').click();
    await new Promise(res => setTimeout(res, 120));
    const cards = document.querySelectorAll('.about-card');
    const paras = document.querySelectorAll('.about-card p');
    const titles = Array.from(cards).map((c) => c.querySelector('h3').textContent);
    let chars = 0;
    for (const p of paras) chars += p.textContent.length;
    return { ok: cards.length >= 5 && chars > 400,
             info: cards.length + ' 节 / ' + paras.length + ' 段 / ' + chars + ' 字：' + titles.join('、') };
  })()`);

  // 上一条停在标题页上的关于页，此时数独已经卸载。重新进来要走整块挂载，
  // 正好验证「离开再进入」这条路：盘面要重建，手上那局要还在。
  await enterSudoku();
  await step('离开游戏再进来，首页与对局页都能切', `(async function(){
    SD.Sudoku.app.showView('game');
    await new Promise(res => setTimeout(res, 80));
    const toGame = document.documentElement.getAttribute('data-view');
    const cells = document.querySelectorAll('#board .cell').length;
    SD.Sudoku.app.showView('home');
    await new Promise(res => setTimeout(res, 80));
    const toHome = document.documentElement.getAttribute('data-view');
    return { ok: toGame === 'game' && toHome === 'home' && cells === 81,
             info: '切游戏页=' + toGame + '（' + cells + ' 格），切首页=' + toHome };
  })()`);

  await step('每日挑战页显示日期与战绩', `(async function(){
    const g = SD.Sudoku.app.getGame();
    SD.Sudoku.app.showView('home');
    await new Promise(res => setTimeout(res, 60));
    document.querySelector('.home-item[data-go=daily]').click();
    await new Promise(res => setTimeout(res, 200));
    const stats = document.querySelectorAll('#page-root .daily-stat').length;
    const title = document.getElementById('page-title').textContent;
    document.getElementById('page-back').click();
    g.start(SD.Base.stringToGrid('530070000600195000098000060800060003400803001700020006060000280000419005000080079'),
      { difficultyName: '每日挑战', dailyKey: SD.Generator.dailySeed(), title: '每日挑战 · 测试' }, null);
    SD.Sudoku.app.render();
    await new Promise(res => setTimeout(res, 120));
    const label = document.getElementById('stat-difficulty-label').textContent;
    const value = document.getElementById('stat-difficulty').textContent;
    const dateOk = value.length === 10 && value.charAt(4) === '-' && value.charAt(7) === '-';
    return { ok: stats === 3 && title === '每日挑战' && label === '今日' && dateOk,
             info: title + '页 ' + stats + ' 项战绩；状态栏 ' + label + ' ' + value };
  })()`);
  await step('从首页发起每日挑战会真的进到对局', `(async function(){
    SD.Sudoku.app.showView('home');
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
    const st = SD.Sudoku.app.getGame().state;
    const overlayGone = document.getElementById('shell-overlay').hidden;
    const isDaily = !!st.meta.dailyKey;
    const title = (SD.Sudoku.app.getGame().state.meta.title || '');
    return { ok: view === 'game' && overlayGone && isDaily && title.indexOf('每日挑战') === 0,
             info: '视图=' + view + '，遮罩已收起=' + overlayGone + '，标题=' + title };
  })()`);

  await step('提示执行把盘填满会弹出庆祝', `(async function(){
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('easy', 'win-by-hint');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
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
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('easy', 'win-by-solve');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
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
    const s = SD.Sudoku.store.stats();
    const t = new Date();
    const keyOf = (n) => {
      const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
      return SD.Generator.dailySeed(d);
    };
    s.daily[keyOf(3)] = { timeMs: 62000, won: true, tries: 1, filled: 81, total: 81 };
    s.daily[keyOf(1)] = { timeMs: null, won: false, tries: 0, filled: 40, total: 81 };
    SD.Sudoku.app.showView('home');
    await new Promise(res => setTimeout(res, 80));
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
    SD.Sudoku.app.showView('game');
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
    // 遮罩只有一个、铺满整屏。出题在首页发起、生成完切到游戏页，
    // 如果遮罩跟着视图走，收起时就会找错节点，灰幕留在屏幕上点不掉。
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.home-item[data-go=play]').click();
    await new Promise(r => setTimeout(r, 150));
    // 得真的选一个难度才算出题——不点的话这一步什么都没验证到
    const diff = document.querySelector('#dialog-root .diff-btn');
    if (diff) diff.click();
    await new Promise(r => setTimeout(r, 120));
    const shownNow = !document.getElementById('shell-overlay').hidden;
    // 立刻回首页
    document.getElementById('btn-home-back').click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 250));
      if (document.getElementById('shell-overlay').hidden) break;
    }
    const clear = document.getElementById('shell-overlay').hidden;
    return { ok: clear,
             info: '出题时遮罩已显示=' + shownNow + '，回首页后遮罩收起=' + clear };
  })()`);

  // 这条验的是手机上的底部面板，桌面宽度下它是左右分栏，所以先把视口切成手机
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  await step('提示面板贴在棋盘下方且不遮住整块盘面', `(async function(){
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('medium', 'sheet');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
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
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('expert', 'scroll-reset');
    SD.Sudoku.app.startWith(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    SD.Sudoku.app.setHintOpen(true);
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
             info: '读到底=' + scrolledBefore + '，换解法后回到顶=' + backToTop
               + '，选中项在可视范围=' + visible
               + '（选中第 ' + chips.length + ' 条中的 ' + Array.from(strip.children).indexOf(on)
               + '，chip宽 ' + on.offsetWidth + '，strip可视宽 ' + strip.clientWidth
               + '，scrollLeft=' + strip.scrollLeft + '，offsetLeft=' + on.offsetLeft
               + '，内容宽 ' + strip.scrollWidth + '）' };
  })()`);
  await step('备局时不会把人拽出首页', `(async function(){
    const fresh = SD.Generator.generateSync('easy', 'keep-view');
    const meta = { difficultyName: '测试' };
    // keepView 为真：冷启动在后台备好一局，玩家还站在别的页面上，不该被拽走
    SD.Sudoku.app.showView('page');
    SD.Sudoku.app.startWith(fresh.givens, meta, fresh.solution, true);
    await new Promise(res => setTimeout(res, 60));
    const kept = document.documentElement.getAttribute('data-view');
    // 不带 keepView：从首页发起的开局必须切到游戏页，否则等于点了没反应
    SD.Sudoku.app.showView('home');
    SD.Sudoku.app.startWith(fresh.givens, meta, fresh.solution);
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
    document.documentElement.setAttribute('data-theme', SD.Storage.global().data().theme);
    return { ok: bad.length === 0, info: bad.length ? bad.join('; ') : SD.Settings.THEMES.length + ' 套主题变量齐全' };
  })()`);

  await step('每日挑战能出题且日期即种子', `(async function(){
    const a = SD.Generator.dailySeed(new Date(2026, 0, 5));
    const b = SD.Generator.dailySeed(new Date(2026, 0, 5));
    const c = SD.Generator.dailySeed(new Date(2026, 0, 6));
    const g1 = SD.Generator.generateSync('medium', a);
    const g2 = SD.Generator.generateSync('medium', a);
    const same = Array.from(g1.givens).join('') === Array.from(g2.givens).join('');
    const st = SD.Sudoku.store.dailyStats();
    const uniq = SD.Solver.solve(g1.givens, 2).count === 1;
    return { ok: a === b && a !== c && same && uniq && st.today === SD.Generator.dailySeed(),
             info: a + ' 同种子同题=' + same + '，唯一解=' + uniq + '，今日连续 ' + st.streak + ' 天' };
  })()`);

  await step('讲解里的【R6C6】能点亮对应格子', `(async function(){
    const g = SD.Sudoku.app.getGame();
    const fresh = SD.Generator.generateSync('expert', 'cell-ref');
    g.start(fresh.givens, { difficultyName: '测试' }, fresh.solution);
    g.state.board.locked.fill(0);
    SD.Sudoku.app.setHintOpen(true);
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
  await step('技巧教学点哪条就在哪条下面展开', `(async function(){
    SD.Sudoku.app.showView('game');
    await new Promise(r => setTimeout(r, 80));
    document.getElementById('btn-learn').click();
    await new Promise(r => setTimeout(r, 250));
    const cards = document.querySelectorAll('.modal .tech-card');
    const usable = document.querySelectorAll('.modal .tech-card.is-usable').length;
    const heads = document.querySelectorAll('.modal .tech-head');
    if (heads.length < 5) return { ok: false, info: '技巧条目太少: ' + heads.length };
    // 点第 5 条，正文必须紧跟在它下面，而不是跑到页面最底下
    heads[4].click();
    await new Promise(r => setTimeout(r, 250));
    const openCard = document.querySelector('.modal .tech-card.is-open');
    const body = openCard ? openCard.querySelector('.tech-body') : null;
    const inline = !!(body && body.parentElement === openCard);
    // 重渲染后所有节点都是新的，只能比索引，不能比引用
    const isFifth = Array.prototype.indexOf.call(
      document.querySelectorAll('.modal .tech-card'), openCard) === 4;
    const demo = openCard ? openCard.querySelector('.demo-board') : null;
    const close = document.querySelector('.modal-foot .btn');
    if (close) close.click();
    return { ok: cards.length >= 12 && inline && isFifth,
             info: cards.length + ' 张卡片，可用 ' + usable + ' 种；展开的是第 5 条=' + isFifth
               + '，正文就地=' + inline + '，带演示盘面=' + !!demo };
  })()`);
  await step('题库页挂着图片识别与我的题库', `(async function(){
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 300));
    const drop = document.querySelector('#page-root .ocr-drop');
    const saved = document.querySelectorAll('#page-root .bank-item.is-mine').length;
    // 存一道再退回首页重进，验证它真的落到了存储里并且页面会重画
    var own = SD.Generator.generateSync('easy', 'user-bank-fixture');
    SD.Sudoku.store.addUserPuzzle(SD.Base.gridToString(own.givens), '我的题目 1', '简单');
    const stored = SD.Sudoku.store.userBank().length;
    document.getElementById('page-back').click();
    await new Promise(r => setTimeout(r, 120));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 300));
    const mine = document.querySelectorAll('#page-root .bank-item.is-mine').length;
    const playable = !!document.querySelector('#page-root .bank-item.is-mine .btn-primary');
    SD.Sudoku.app.showView('home');
    return { ok: !!drop && stored === saved + 1 && mine === stored && playable,
             info: 'OCR 入口=' + !!drop + '，存入 ' + stored + ' 道，重进页面显示 ' + mine + ' 道，可开始=' + playable };
  })()`);

  await step('透视校正数学正确（合成测试）', `(function(){
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200);
    ctx.fillStyle = '#000';
    // 在四角附近画黑点，检验映射后是否落在输出四角
    const quad = [{x:0,y:0},{x:200,y:0},{x:200,y:200},{x:0,y:200}];
    const H = SD.Sudoku.vision.homography(quad, [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
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
    const g = SD.Sudoku.app.getGame();
    const canvas = SD.Sudoku.data.exportBoardPNG(g.state.board, '测试');
    return { ok: canvas.width > 400 && canvas.height > 400, info: canvas.width + '×' + canvas.height };
  })()`);

  await send('Page.captureScreenshot', { format: 'png' }).then((r) => {
    if (r && r.data) fs.writeFileSync(path.join(__dirname, 'shot-app.png'), Buffer.from(r.data, 'base64'));
  }).catch(() => {});

  await step('手动填题能录入并进入棋盘', `(async function(){
    SD.Sudoku.app.showView('home');
    await new Promise(r => setTimeout(r, 80));
    document.querySelector('.home-item[data-go=bank]').click();
    await new Promise(r => setTimeout(r, 300));
    const btn = Array.prototype.find.call(
      document.querySelectorAll('#page-root button'), (b) => b.textContent === '手动填题');
    if (!btn) return { ok: false, info: '题库页没有「手动填题」按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const cells = document.querySelectorAll('.modal .ocr-preview .ocr-cell');
    const keys = document.querySelectorAll('.modal .manual-key');
    if (cells.length !== 81) return { ok: false, info: '棋盘格数不对: ' + cells.length };
    // 点第一格，再点数字 5
    cells[0].click();
    await new Promise(r => setTimeout(r, 60));
    const five = Array.prototype.find.call(keys, (k) => k.textContent === '5');
    if (!five) return { ok: false, info: '数字键盘里没有 5' };
    five.click();
    await new Promise(r => setTimeout(r, 60));
    const typed = cells[0].textContent;
    // 确认填入
    const ok = Array.prototype.find.call(
      document.querySelectorAll('.modal-foot button'), (b) => b.textContent === '填入棋盘');
    if (!ok) return { ok: false, info: '没有「填入棋盘」按钮' };
    ok.click();
    await new Promise(r => setTimeout(r, 250));
    const d0 = SD.Sudoku.ocr.state.digits[0];
    const shown = document.querySelectorAll('#page-root .ocr-preview .ocr-cell.has').length;
    SD.Sudoku.app.showView('home');
    return { ok: typed === '5' && d0 === 5 && shown >= 1,
             info: '格数=' + cells.length + '，键盘键=' + keys.length
               + '，敲入显示=' + typed + '，写入 state=' + d0 + '，结果区标出 ' + shown + ' 格' };
  })()`);

  /* ================= 扫雷 ================= */

  // 前面几条数独用例开过弹窗没关。留着会挡住选择器，也会让「最后一个弹窗」认错人。
  await evaluate('(function () { for (let i = 0; i < 20; i++) {'
    + ' const b = document.querySelector("#dialog-root .modal-head .btn"); if (!b) break; b.click(); }'
    + ' return document.querySelectorAll("#dialog-root .modal").length; })()');

  await step('标题页把扫雷列为可进入的游戏', `(async function(){
    document.getElementById('btn-home').click();
    await new Promise(r => setTimeout(r, 200));
    const cards = Array.from(document.querySelectorAll('.game-card'));
    const card = cards.find((c) => c.querySelector('.gc-name').textContent === '扫雷');
    const soon = card ? card.classList.contains('is-soon') : true;
    return { ok: !!card && !soon, info: cards.length + ' 张卡片，扫雷可进入=' + (!!card && !soon) };
  })()`);

  await step('进入扫雷：首页四个入口', `(async function(){
    Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '扫雷').click();
    await new Promise(r => setTimeout(r, 300));
    const view = document.documentElement.getAttribute('data-view');
    const items = Array.from(document.querySelectorAll('.home-item')).map((b) => b.dataset.go);
    return { ok: view === 'home' && items.join(',') === 'play,daily,learn,mine',
             info: '视图=' + view + '，入口 ' + items.join(' / ') };
  })()`);

  await step('初级盘面 81 格，开局还没布雷', `(async function(){
    document.querySelector('.home-item[data-go=play]').click();
    await new Promise(r => setTimeout(r, 200));
    const lv = document.querySelector('#dialog-root .mine-level');
    if (!lv) return { ok: false, info: '没有难度对话框' };
    lv.click();
    await new Promise(r => setTimeout(r, 300));
    const cells = document.querySelectorAll('#game-play .mine-grid .mcell');
    const b = SD.Mines.app.getBoard();
    const view = document.documentElement.getAttribute('data-view');
    return { ok: cells.length === 81 && view === 'game' && !!b && !b.placed,
             info: cells.length + ' 格，视图=' + view + '，布雷推迟到首点=' + (!!b && !b.placed) };
  })()`);

  await step('首点必安全：首点连同八邻居都不是雷', `(async function(){
    document.querySelectorAll('#game-play .mine-grid .mcell')[40].click();
    await new Promise(r => setTimeout(r, 200));
    const b = SD.Mines.app.getBoard();
    let safe = !b.mine[40];
    for (const j of b.nbr[40]) if (b.mine[j]) safe = false;
    return { ok: safe && b.placed && b.opened > 0,
             info: '已翻开 ' + b.opened + ' 格，首点及八邻居无雷=' + safe };
  })()`);

  await step('提示面板给出的每一条「必然」结论都成立', `(async function(){
    document.getElementById('btn-mine-hint').click();
    await new Promise(r => setTimeout(r, 400));
    const chips = document.querySelectorAll('.mine-chip');
    const concl = document.querySelector('.mine-concl');
    const an = SD.Mines.app.analyze();
    const b = SD.Mines.app.getBoard();
    let bad = '';
    for (const st of an.steps) {
      if (!st.certain) continue;
      for (const i of st.mines) if (!b.mine[i]) bad = st.id + ' 误判第 ' + i + ' 格为雷';
      for (const i of st.safe) if (b.mine[i]) bad = st.id + ' 误判第 ' + i + ' 格为安全';
    }
    return { ok: chips.length > 0 && !!concl && !bad,
             info: chips.length + ' 条推理' + (bad ? '，' + bad : '，全部与真实雷分布一致') };
  })()`);

  await step('执行提示会真的动盘面', `(async function(){
    const b = SD.Mines.app.getBoard();
    const before = b.opened + b.flags;
    document.getElementById('btn-mine-hint-apply').click();
    await new Promise(r => setTimeout(r, 300));
    const after = b.opened + b.flags;
    return { ok: after > before || b.state !== 'playing',
             info: '已翻开+旗 ' + before + ' → ' + after + '，状态=' + b.state };
  })()`);

  await step('插旗模式可切换', `(async function(){
    const btn = document.getElementById('btn-mine-flag');
    btn.click();
    await new Promise(r => setTimeout(r, 100));
    const on = SD.Mines.store.settings().flagMode;
    const lit = btn.classList.contains('is-on');
    btn.click();
    await new Promise(r => setTimeout(r, 100));
    return { ok: on === true && lit && SD.Mines.store.settings().flagMode === false,
             info: '打开=' + on + '，按钮高亮=' + lit + '，再点已关=' + (SD.Mines.store.settings().flagMode === false) };
  })()`);

  await step('每日挑战：同一天同一张图，开局已翻开一格', `(async function(){
    SD.Mines.app.startDaily();
    await new Promise(r => setTimeout(r, 250));
    const a = SD.Mines.app.getBoard();
    const seed = a.seed;
    const opened = a.open.reduce((s, v) => s + v, 0);
    SD.Mines.app.startDaily();
    await new Promise(r => setTimeout(r, 250));
    const c = SD.Mines.app.getBoard();
    const same = a.mine.join('') === c.mine.join('') && a.open.join('') === c.open.join('');
    return { ok: same && opened > 0 && seed.indexOf('mines-daily-') === 0,
             info: '种子=' + seed + '，两次同图=' + same + '，开局已翻开 ' + opened + ' 格' };
  })()`);

  await step('教程：九种技巧都能展开出演示盘面', `(async function(){
    const t0 = Date.now();
    SD.Shell.openPage('扫雷教程', (root) => SD.Mines.learn.render(root));
    await new Promise(r => setTimeout(r, 300));
    const heads = Array.from(document.querySelectorAll('.mine-learn-head'));
    if (heads.length !== 9) return { ok: false, info: '技巧卡片 ' + heads.length + ' 张，应为 9' };
    const missing = [];
    for (const h of heads) {
      h.click();
      await new Promise(r => setTimeout(r, 60));
      const card = h.closest('.mine-learn-card');
      if (!card.querySelector('.mine-grid')) missing.push(card.querySelector('.mine-learn-name').textContent);
    }
    const boards = document.querySelectorAll('.mine-learn-card .mine-grid').length;
    return { ok: missing.length === 0,
             info: boards + '/9 种有演示盘面，全部展开耗时 ' + (Date.now() - t0) + 'ms'
               + (missing.length ? '，缺：' + missing.join('、') : '') };
  })()`);

  await step('自定义盘面能定宽高雷数', `(async function(){
    document.getElementById('page-back').click();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('.home-item[data-go=play]').click();
    await new Promise(r => setTimeout(r, 200));
    const btns = document.querySelectorAll('#dialog-root .mine-level');
    btns[btns.length - 1].click();
    await new Promise(r => setTimeout(r, 200));
    const inputs = document.querySelectorAll('#dialog-root .mine-custom input');
    if (inputs.length !== 3) return { ok: false, info: '自定义对话框没有三个输入框' };
    inputs[0].value = '12'; inputs[1].value = '10'; inputs[2].value = '20';
    inputs[2].dispatchEvent(new Event('input'));
    const start = Array.from(document.querySelectorAll('#dialog-root .btn')).find((b) => b.textContent === '开始');
    if (!start) return { ok: false, info: '没有开始按钮' };
    start.click();
    await new Promise(r => setTimeout(r, 300));
    const b = SD.Mines.app.getBoard();
    const cells = document.querySelectorAll('#game-play .mine-grid .mcell').length;
    return { ok: b.w === 12 && b.h === 10 && b.mines === 20 && cells === 120,
             info: b.w + '×' + b.h + ' · ' + b.mines + ' 雷，渲染 ' + cells + ' 格' };
  })()`);

  await step('通关结算：记成绩、给点数、弹窗', `(async function(){
    const before = SD.Points.total();
    const b = SD.Mines.app.getBoard();
    const cells = document.querySelectorAll('#game-play .mine-grid .mcell');
    cells[0].click();                    // 首点布雷
    await new Promise(r => setTimeout(r, 120));
    // 只点非雷格，走真实点击路径，胜负结算才会被触发
    for (let i = 0; i < cells.length; i++) if (!b.mine[i]) cells[i].click();
    await new Promise(r => setTimeout(r, 500));
    const box = Array.from(document.querySelectorAll('#dialog-root .modal')).pop();
    const title = box ? box.querySelector('h2').textContent : '';
    const after = SD.Points.total();
    const bucket = SD.Mines.store.bucket('custom');
    const close = box ? box.querySelector('.modal-head .btn') : null;
    if (close) close.click();
    return { ok: /排完了/.test(title) && after > before && bucket.wins > 0,
             info: '弹窗「' + title + '」，点数 ' + before + ' → ' + after + '，自定义档通关 ' + bucket.wins + ' 次' };
  })()`);

  await step('踩雷结算：摊出全部雷并标出错旗', `(async function(){
    SD.Mines.app.startLevel('beginner');
    await new Promise(r => setTimeout(r, 250));
    const b = SD.Mines.app.getBoard();
    const cells = document.querySelectorAll('#game-play .mine-grid .mcell');
    cells[0].click();
    await new Promise(r => setTimeout(r, 120));
    let wrongFlag = -1;
    for (let i = 1; i < cells.length; i++) if (!b.mine[i] && !b.open[i]) { wrongFlag = i; break; }
    if (wrongFlag >= 0) {
      cells[wrongFlag].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    }
    await new Promise(r => setTimeout(r, 120));
    let hit = -1;
    for (let i = 0; i < cells.length; i++) if (b.mine[i] && !b.open[i]) { hit = i; break; }
    cells[hit].click();
    await new Promise(r => setTimeout(r, 500));
    const box = Array.from(document.querySelectorAll('#dialog-root .modal')).pop();
    const title = box ? box.querySelector('h2').textContent : '';
    const wrongMarked = document.querySelectorAll('.mine-grid .mcell.is-wrong-flag').length;
    const boom = document.querySelectorAll('.mine-grid .mcell.is-boom').length;
    // 这条用例原来只数爆炸点和错旗，名字却写着「摊出全部雷」——雷压根没摊开也照样通过。
    // 现在逐颗数：没插旗的雷必须全部摊出来，插对的旗保持原样。
    const shown = document.querySelectorAll('.mine-grid .mcell.is-mine').length;
    let total = 0, flagged = 0;
    for (let i = 0; i < b.mine.length; i++) {
      if (!b.mine[i]) continue;
      total++;
      if (b.flag[i]) flagged++;
    }
    const close = box ? box.querySelector('.modal-head .btn') : null;
    if (close) close.click();
    return { ok: /踩雷/.test(title) && boom === 1 && (wrongFlag < 0 || wrongMarked === 1) && shown === total - flagged,
             info: '弹窗「' + title + '」，爆炸点 ' + boom + ' 个，标出的错旗 ' + wrongMarked + ' 面，'
               + '摊出的雷 ' + shown + '/' + (total - flagged) + ' 颗（共 ' + total + ' 颗，插对 ' + flagged + ' 面旗）' };
  })()`);

  await step('扫雷与数独的数据各存各的', `(function(){
    const mines = localStorage.getItem('puzzle-hub:mines:v1');
    const sudoku = localStorage.getItem('sudoku-studio:v1');
    if (!mines || !sudoku) return { ok: false, info: 'mines=' + !!mines + '，sudoku=' + !!sudoku };
    const m = JSON.parse(mines);
    const s = JSON.parse(sudoku);
    return { ok: !!m.stats && !!s.stats && !!s.userBank && !m.userBank,
             info: '扫雷键有 stats 没有 userBank；数独键两者都有——两份数据互不干扰' };
  })()`);

  /* ================= 杀手数独 ================= */

  await evaluate('(function () { for (let i = 0; i < 20; i++) {'
    + ' const b = document.querySelector("#dialog-root .modal-head .btn"); if (!b) break; b.click(); }'
    + ' return true; })()');

  await step('标题页把杀手数独列为可进入', `(async function(){
    document.getElementById('btn-home').click();
    await new Promise(r => setTimeout(r, 250));
    const cards = Array.from(document.querySelectorAll('.game-card'));
    const card = cards.find((c) => c.querySelector('.gc-name').textContent === '杀手数独');
    const soon = card ? card.classList.contains('is-soon') : true;
    const all = cards.map((c) => c.querySelector('.gc-name').textContent + (c.classList.contains('is-soon') ? '(开发中)' : ''));
    return { ok: !!card && !soon, info: all.join(' / ') };
  })()`);

  await step('进入杀手数独：首页四个入口', `(async function(){
    Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '杀手数独').click();
    await new Promise(r => setTimeout(r, 300));
    const view = document.documentElement.getAttribute('data-view');
    const items = Array.from(document.querySelectorAll('.home-item')).map((b) => b.dataset.go);
    return { ok: view === 'home' && items.join(',') === 'play,daily,learn,mine',
             info: '视图=' + view + '，入口 ' + items.join(' / ') };
  })()`);

  await step('出题：笼子切满全盘、唯一解、笼和与真解一致', `(async function(){
    document.querySelector('.home-item[data-go=play]').click();
    await new Promise(r => setTimeout(r, 250));
    const btns = document.querySelectorAll('#dialog-root .diff-btn');
    if (!btns.length) return { ok: false, info: '没有难度对话框' };
    btns[0].click();
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (document.documentElement.getAttribute('data-view') === 'game' && SD.Killer.app.getPuzzle()) break;
    }
    const puz = SD.Killer.app.getPuzzle();
    const g = SD.Killer.app.getGame();
    const sol = g.state.solution;
    if (!puz || !sol) return { ok: false, info: '没有拿到题目' };
    const covered = new Set();
    let sumOk = true, uniq = true;
    for (const cg of puz.list) {
      let s = 0;
      const seen = new Set();
      for (const i of cg.cells) {
        if (covered.has(i)) uniq = false;
        covered.add(i);
        s += sol[i];
        if (seen.has(sol[i])) sumOk = false;
        seen.add(sol[i]);
      }
      if (s !== cg.sum) sumOk = false;
    }
    return { ok: covered.size === 81 && uniq && sumOk,
             info: puz.list.length + ' 个笼子，覆盖 ' + covered.size + ' 格，笼和与真解一致=' + sumOk };
  })()`, 120000);

  await step('盘面把笼子画出来了（虚线边框 + 笼和）', `(function(){
    const cells = document.querySelectorAll('#board .cell');
    const sums = Array.from(document.querySelectorAll('#board .cell-cage')).filter((n) => n.textContent).length;
    const edges = document.querySelectorAll('#board .cell.cage-t, #board .cell.cage-r, #board .cell.cage-b, #board .cell.cage-l').length;
    const puz = SD.Killer.app.getPuzzle();
    return { ok: cells.length === 81 && sums === puz.list.length && edges > 0,
             info: cells.length + ' 格，笼和标签 ' + sums + ' 个（应 ' + puz.list.length + '），带笼边的格子 ' + edges + ' 个' };
  })()`);

  await step('提示面板：每一条结论都与真解一致', `(async function(){
    document.getElementById('btn-k-hint').click();
    await new Promise(r => setTimeout(r, 500));
    const g = SD.Killer.app.getGame();
    const sol = g.state.solution;
    const list = g.hintList(5);
    const chips = document.querySelectorAll('#hint-output .mine-chip');
    const concl = document.querySelector('#hint-output .mine-concl');
    let bad = '';
    for (const e of list) {
      for (const p of e.step.placements) if (sol[p.cell] !== p.digit) bad = e.step.id + ' 把 ' + p.cell + ' 填成 ' + p.digit;
      for (const el2 of e.step.eliminations) if (sol[el2.cell] === el2.digit) bad = e.step.id + ' 删掉真解 ' + el2.cell + '=' + el2.digit;
      if (bad) break;
    }
    return { ok: list.length > 0 && chips.length > 0 && !!concl && !bad,
             info: list.length + ' 条推理（' + chips.length + ' 个 chip）' + (bad ? '，' + bad : '，全部与真解一致') };
  })()`);

  await step('执行提示会真的动盘面', `(async function(){
    const g = SD.Killer.app.getGame();
    const before = Array.from(g.state.board.grid).filter(Boolean).length;
    document.getElementById('btn-k-hint-apply').click();
    await new Promise(r => setTimeout(r, 400));
    const after = Array.from(g.state.board.grid).filter(Boolean).length;
    return { ok: after > before || g.state.won, info: '已填格 ' + before + ' → ' + after };
  })()`);

  // 提示列表是按盘面算的，而「删除候选」这类解法不改盘面——曾因此同一条永远排在第一，
  // 玩家点完「执行」面板一个字都不变，看着像卡死。这条盯着它必须往前走。
  await step('纯消除型提示执行后，面板不会卡在同一条', `(async function(){
    const g = SD.Killer.app.getGame();
    const area = document.getElementById('hint-area');
    if (area && area.hidden) document.getElementById('btn-k-hint').click();
    await new Promise(r => setTimeout(r, 700));
    const sig = () => {
      const o = document.getElementById('hint-output');
      if (!o) return '';
      const t = o.querySelector('.mine-hint-title');
      const c = o.querySelector('.mine-concl');
      return (t ? t.textContent : '') + '|' + (c ? c.textContent : '');
    };
    const filled = () => Array.from(g.state.board.grid).filter(Boolean).length;
    let tried = 0, stuck = 0;
    for (let k = 0; k < 3; k++) {
      const before = sig();
      if (!before) break;
      const gb = filled();
      document.getElementById('btn-k-hint-apply').click();
      await new Promise(r => setTimeout(r, 500));
      tried++;
      // 落子型本来就会改变盘面；只看纯消除型（盘面没动）有没有卡住
      if (filled() === gb && sig() === before) stuck++;
    }
    return { ok: tried > 0 && stuck === 0, info: '试了 ' + tried + ' 次，卡在同一条 ' + stuck + ' 次' };
  })()`);

  await step('笼内定数：一格笼子直接给出数字', `(async function(){
    // 一路用提示推，直到出现一格笼子，验证它填的就是笼和
    const g = SD.Killer.app.getGame();
    const puz = SD.Killer.app.getPuzzle();
    const single = puz.list.find((c) => c.cells.length === 1);
    if (!single) return { ok: false, info: '这道题没有一格笼子' };
    const i = single.cells[0];
    // 提示执行若干步，直到这一格被填上（上限兜底，避免题目本身不推进时空转）
    for (let k = 0; k < 30 && !g.state.board.grid[i]; k++) {
      const list = g.hintList(5);
      if (!list.length) break;
      g.applyStep(list[0], true);
    }
    return { ok: g.state.board.grid[i] === single.sum,
             info: '一格笼子 R' + (Math.floor(i/9)+1) + 'C' + (i%9+1) + ' 和=' + single.sum + '，盘面填了 ' + g.state.board.grid[i] };
  })()`);

  await step('教程：六条笼子技巧都能展开出演示盘面', `(async function(){
    const t0 = Date.now();
    SD.Shell.openPage('杀手数独教程', (root) => SD.Killer.learn.render(root));
    await new Promise(r => setTimeout(r, 400));
    const heads = Array.from(document.querySelectorAll('.mine-learn-head'));
    if (heads.length !== 6) return { ok: false, info: '技巧卡片 ' + heads.length + ' 张，应为 6' };
    const missing = [];
    for (const h of heads) {
      h.click();
      await new Promise(r => setTimeout(r, 100));
      const card = h.closest('.mine-learn-card');
      if (!card.querySelector('#board .cell') && !card.querySelector('.board .cell')) {
        missing.push(card.querySelector('.mine-learn-name').textContent);
      }
    }
    const boards = document.querySelectorAll('.killer-demo .board').length;
    return { ok: missing.length === 0,
             info: boards + '/6 种有演示盘面，全部展开耗时 ' + (Date.now() - t0) + 'ms'
               + (missing.length ? '，缺：' + missing.join('、') : '') };
  })()`, 120000);

  await step('冲突判定把笼内重复和笼和超限也算进去', `(async function(){
    document.getElementById('page-back').click();
    await new Promise(r => setTimeout(r, 250));
    // 用现成的盘面。原先为了造一个「同笼但不同行列宫」的格子对，这里会重新出一道
    // 困难题——那一步实测要跑两分钟，还把后面两条用例一起拖垮。测试要的是
    // 「笼子那两条规则有没有生效」，不值得为它重开一局。
    const g = SD.Killer.app.getGame();
    const puz = SD.Killer.app.getPuzzle();
    if (!g || !puz) return { ok: false, info: '当前没有对局' };
    const cg = puz.list.find((c) => c.cells.length >= 2);
    if (!cg) return { ok: false, info: '这道题没有 2 格以上的笼子' };
    const pair = [cg.cells[0], cg.cells[1]];

    // 先确认干净的盘面不报冲突
    const before = g.conflicts().size;
    g.state.board.grid[pair[0]] = 5;
    g.state.board.grid[pair[1]] = 5;
    const conf = g.conflicts();
    const caught = conf.has(pair[0]) && conf.has(pair[1]);
    g.state.board.grid[pair[0]] = 0;
    g.state.board.grid[pair[1]] = 0;

    // 再把某个笼子整个填成 9：笼和必然超（9n 一定大于 n 个不同数字能凑出的最大和），
    // 而且这些格子未必互为行列宫关联格，所以只有笼和规则能把它们全标出来
    const cg2 = puz.list.find((c) => c.cells.length >= 2);
    for (const i of cg2.cells) g.state.board.grid[i] = 9;
    const over = g.conflicts();
    const overCaught = cg2.cells.every((i) => over.has(i));
    for (const i of cg2.cells) g.state.board.grid[i] = 0;
    return { ok: caught && overCaught && before === 0,
             info: '同笼不同区的重复被抓=' + caught + '，笼和超限被抓=' + overCaught };
  })()`, 120000);

  await step('存档写进杀手数独自己的命名空间', `(function(){
    const raw = localStorage.getItem('puzzle-hub:killer:v1');
    if (!raw) return { ok: false, info: '没有存档' };
    const d = JSON.parse(raw);
    return { ok: !!d.settings && !!d.stats, info: 'settings ' + Object.keys(d.settings).length + ' 项, stats ' + Object.keys(d.stats).length + ' 项' };
  })()`);

  /* ================= 数字华容道 ================= */

  await step('标题页把数字华容道列为可进入', `(async function(){
    const card = Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '数字华容道');
    if (!card) return { ok: false, info: '没有卡片' };
    const soon = card.classList.contains('is-soon');
    card.click();
    await new Promise(r => setTimeout(r, 300));
    const view = document.documentElement.getAttribute('data-view');
    const title = document.querySelector('.home-title');
    return { ok: !soon && view === 'home' && !!title && title.textContent === '数字华容道',
             info: '置灰=' + soon + '，视图=' + view + '，首页标题=' + (title ? title.textContent : '无') };
  })()`);

  await step('数字华容道：相邻能滑、不相邻不动', `(async function(){
    document.querySelector('.home-item[data-go=n3]').click();
    await new Promise(r => setTimeout(r, 500));
    const S = SD.Slide;
    const b = S.app.getBoard();
    const tiles = document.querySelectorAll('.slide-tile').length;
    const near = S.neighborsOf(b.n, b.empty)[0];
    const m0 = b.moves;
    S.app.tap(b.cells[near]);
    const moved = b.moves === m0 + 1;
    // 找一块不相邻的：点了必须纹丝不动
    let far = null;
    for (let i = 0; i < b.cells.length; i++) {
      if (b.cells[i] && S.neighborsOf(b.n, b.empty).indexOf(i) < 0) { far = b.cells[i]; break; }
    }
    const m1 = b.moves;
    if (far !== null) S.app.tap(far);
    const still = b.moves === m1;
    return { ok: tiles === 8 && moved && still,
             info: tiles + ' 块，相邻滑动了=' + moved + '，不相邻没动=' + still };
  })()`);

  await step('数字华容道：提示给的那块一定滑得动', `(function(){
    const S = SD.Slide;
    let bad = 0, checked = 0;
    for (let k = 0; k < 4; k++) {
      const b = S.app.getBoard();
      const h = S.app.hint();
      if (!h) continue;
      checked++;
      let idx = -1;
      for (let i = 0; i < b.cells.length; i++) if (b.cells[i] === h.tile) { idx = i; break; }
      if (idx < 0 || !S.canMove(b, idx)) bad++;
    }
    return { ok: bad === 0 && checked > 0, info: '验了 ' + checked + ' 次，滑不动 ' + bad + ' 次' };
  })()`);

  await step('数字华容道：自动解 3×3 能通关并结算', `(async function(){
    const S = SD.Slide;
    document.getElementById('btn-s-restart').click();
    await new Promise(r => setTimeout(r, 400));
    let guard = 0;
    while (S.app.getBoard().state !== 'won' && guard++ < 220) {
      const h = S.app.hint();
      if (!h) break;
      S.app.tap(h.tile);
    }
    await new Promise(r => setTimeout(r, 400));
    const box = document.querySelector('#dialog-root .modal');
    const title = box ? box.querySelector('h2').textContent : '';
    const best = SD.Slide.store.best('n3');
    const close = box ? box.querySelector('.modal-head .btn') : null;
    if (close) close.click();
    return { ok: /排好了/.test(title) && !!best,
             info: '弹窗「' + title + '」，步数 ' + S.app.getBoard().moves + '，最佳记录 ' + (best ? best.moves + ' 步' : '无') };
  })()`, 120000);

  /* ================= 2048 ================= */

  await step('标题页把 2048 列为可进入', `(async function(){
    document.getElementById('btn-home').click();
    await new Promise(r => setTimeout(r, 300));
    const card = Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '2048');
    if (!card) return { ok: false, info: '没有卡片' };
    const soon = card.classList.contains('is-soon');
    card.click();
    await new Promise(r => setTimeout(r, 300));
    const title = document.querySelector('.home-title');
    return { ok: !soon && !!title && title.textContent === '2048',
             info: '置灰=' + soon + '，首页标题=' + (title ? title.textContent : '无') };
  })()`);

  await step('2048：推牌会合并、加分、落新牌', `(async function(){
    document.querySelector('.home-item[data-go=classic]').click();
    await new Promise(r => setTimeout(r, 500));
    const G = SD.G2048;
    const b = G.app.getBoard();
    const tiles0 = Array.from(b.cells).filter(Boolean).length;
    const cells = document.querySelectorAll('.g-cell').length;
    const tiles = document.querySelectorAll('.g-tile').length;

    // 摆一个一定能合并的盘面，推左必得分
    b.cells = Int16Array.from([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    b.score = 0; b.moves = 0; b.state = 'playing';
    G.app.render();
    const moved = G.app.move('left');
    // 只看第一格是不是合并出来的 4。不能顺带断言第二格为空——
    // 落新牌的位置是随机的，它完全可能正好落在第二格，那样断言就会偶发失败。
    const merged = b.cells[0] === 4;
    const gained = b.score === 4;

    // 推不动时不该算步数
    b.cells = Int16Array.from([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128]);
    G.app.render();
    const m = b.moves;
    const stuck = G.app.move('left') === false && b.moves === m;

    return { ok: tiles0 === 2 && cells === 16 && tiles === 2 && moved && merged && gained && stuck,
             info: '背景 ' + cells + ' 格，开局 ' + tiles0 + ' 块；合并=' + merged + '，加分=' + gained + '，推不动不计步=' + stuck };
  })()`);

  await step('2048：提示给出四个方向的期望分', `(function(){
    const G = SD.G2048;
    const b = G.app.getBoard();
    b.cells = Int16Array.from([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    b.state = 'playing';
    const rank = G.app.rank();
    const sorted = rank.every((x, i) => i === 0 || rank[i - 1].expect >= x.expect);
    const hasDir = rank.length > 0 && !!rank[0].dir;
    const shapes = rank.every((x) => typeof x.expect === 'number' && G.DIRS.indexOf(x.dir) >= 0);
    // 死局必须没有候选
    b.cells = Int16Array.from([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
    const dead = G.app.rank().length;
    return { ok: sorted && hasDir && shapes && dead === 0,
             info: rank.map((x) => x.dir + '=' + Math.round(x.expect)).join(' ') + '；死局候选 ' + dead + ' 个' };
  })()`);

  await step('2048：求解器能自己打到结束并结算', `(async function(){
    const G = SD.G2048;
    G.app.startLevel('classic');
    await new Promise(r => setTimeout(r, 300));
    // 打到"这局结束"为止。注意结束有两种：先凑出目标牌（won，还能接着打）和推不动了（over）。
    // 只认 over 的话，求解器水平一好这条就会假失败——它常常先到 2048 再一路打下去。
    let guard = 0;
    while (guard++ < 2500) {
      if (G.app.getBoard().state === 'over') break;
      const r = G.app.rank();
      if (!r.length) break;
      G.app.move(r[0].dir);
    }
    await new Promise(r => setTimeout(r, 600));
    const b = G.app.getBoard();
    const all = document.querySelectorAll('#dialog-root .modal');
    const box = all[all.length - 1];
    const title = box ? box.querySelector('h2').textContent : '';
    for (const m of all) { const x = m.querySelector('.modal-head .btn'); if (x) x.click(); }
    const rec = SD.G2048.store.best('classic');
    const settled = b.state === 'over' || b.state === 'won';
    return { ok: settled && /2048|可推的方向/.test(title) && b.score > 500 && G.maxTile(b) >= 256 && rec >= b.score,
             info: guard + ' 步，状态 ' + b.state + '，得分 ' + b.score + '，最大牌 ' + G.maxTile(b) + '，弹窗「' + title + '」，记录 ' + rec };
  })()`, 200000);

  /* ================= 华容道 ================= */

  await step('标题页把华容道列为可进入', `(async function(){
    document.getElementById('btn-home').click();
    await new Promise(r => setTimeout(r, 200));
    const card = Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '华容道');
    if (!card) return { ok: false, info: '没有卡片' };
    const soon = card.classList.contains('is-soon');
    card.click();
    await new Promise(r => setTimeout(r, 200));
    const title = document.querySelector('.home-title');
    return { ok: !soon && !!title && title.textContent === '华容道',
             info: '置灰=' + soon + '，首页标题=' + (title ? title.textContent : '无') };
  })()`);

  await step('华容道：开局十块，曹操是 2×2', `(async function(){
    document.querySelector('.home-item[data-go=hard]').click();
    // 第一次进要先把全状态表算出来，会弹遮罩并异步开局，这里等它落地
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (SD.Klotski.app.getBoard()) break;
    }
    await new Promise(r => setTimeout(r, 200));
    const K = SD.Klotski;
    const b = K.app.getBoard();
    const pieces = document.querySelectorAll('.k-piece').length;
    const cao = b.pieces[0];
    const d = K.app.distance();
    return { ok: !!b && pieces === 10 && cao.w === 2 && cao.h === 2 && d > 0 && b.moves === 0,
             info: pieces + ' 块，曹操 ' + cao.w + '×' + cao.h + '，离出口 ' + d + ' 步' };
  })()`, 120000);

  // 出口 = 底墙上的缺口，开在**棋盘外面**，所以永远不会被棋子挡住。
  // （早先画成 2×2 的虚线框，压在棋子上既别扭，标的又是"曹操要占的位置"而不是出口。）
  // 空格和棋子是同层元素，DOM 里靠后的画在上面。空格一旦加到棋子后面，
  // 20 个深色空格会把棋子整个盖住——但点击照样能用（空格是 pointer-events:none），
  // 所以光靠"能不能操作"发现不了，得直接盯 DOM 顺序。
  await step('华容道：空格画在棋子下面，且和棋盘底色分得开', `(function(){
    const board = document.querySelector('.k-board');
    const kids = Array.from(board.children);
    const slotIdx = kids.map((n, i) => (n.classList.contains('k-slot') ? i : -1)).filter((i) => i >= 0);
    const pieceIdx = kids.map((n, i) => (n.classList.contains('k-piece') ? i : -1)).filter((i) => i >= 0);
    const orderOk = slotIdx.length > 0 && pieceIdx.length > 0
      && Math.max.apply(null, slotIdx) < Math.min.apply(null, pieceIdx);
    // 空格底色必须和棋盘底色明显不同，否则分不出"这一格是空的"和"这只是两块之间的缝"
    const slotBg = getComputedStyle(kids[slotIdx[0]]).backgroundColor;
    const boardBg = getComputedStyle(board).backgroundColor;
    const parse = (s) => (s.match(/\\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const a = parse(slotBg), b = parse(boardBg);
    const diff = Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
    return { ok: orderOk && diff > 60,
             info: '空格 ' + slotIdx.length + ' 个在棋子 ' + pieceIdx.length + ' 个之前=' + orderOk
               + '，底色差 ' + diff + '（空格 ' + slotBg + ' / 棋盘 ' + boardBg + '）' };
  })()`);

  await step('华容道：出口是底墙上的缺口，且在棋盘外面', `(function(){
    const K = SD.Klotski;
    const b = K.app.getBoard();
    const wall = document.querySelector('.k-wall');
    const gap = document.querySelector('.k-gap');
    if (!wall || !gap) return { ok: false, info: '没有底墙或缺口' };
    const board = document.querySelector('.k-board');
    const br = board.getBoundingClientRect();
    const gr = gap.getBoundingClientRect();
    const cell = br.width / 4;
    // 缺口应该在第 2、3 列（1-based），也就是从 1 格宽处开始、宽约 2 格
    const dx = Math.abs((gr.left - br.left) - cell);
    const sizeOk = Math.abs(gr.width - 2 * cell) < 10;
    // 缺口顶边必须在棋盘"五格高"的位置上——也就是在棋盘外面，不会被棋子压住
    const outside = gr.top - br.top >= 5 * cell - 2;
    const inBoard = gr.bottom <= br.bottom + 1;
    // 曹操落位后缺口变绿
    const p = b.pieces[0];
    const saved = { r: p.r, c: p.c };
    p.r = 3; p.c = 1; K.rebuild(b); K.app.render();
    const opened = document.querySelector('.k-gap').classList.contains('is-open');
    p.r = saved.r; p.c = saved.c; K.rebuild(b); K.app.render();
    const closed = document.querySelector('.k-gap').classList.contains('is-open');
    return { ok: dx < 4 && sizeOk && outside && inBoard && opened && !closed,
             info: '偏移 ' + Math.round(dx) + 'px，宽 ' + Math.round(gr.width) + '（两格 ' + Math.round(2*cell) + '）'
               + '，在棋盘外=' + outside + '，落位变绿=' + opened + '，复位后恢复=' + !closed };
  })()`);

  await step('华容道：提示走完剩余距离正好减一', `(function(){
    const K = SD.Klotski;
    let bad = 0, checked = 0;
    for (let i = 0; i < 6; i++) {
      const b = K.app.getBoard();
      const d = K.app.distance();
      if (d <= 0) break;
      const m = K.app.hint();
      if (!m) { bad++; break; }
      checked++;
      K.app.shift(m.index, m.dr, m.dc);
      if (K.app.distance() !== d - 1) bad++;
    }
    return { ok: checked > 0 && bad === 0, info: '验了 ' + checked + ' 次，剩余距离不对 ' + bad + ' 次' };
  })()`);

  await step('华容道：沿最优解走到底，步数等于标注的最少步数', `(async function(){
    const K = SD.Klotski;
    document.getElementById('btn-k-restart').click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (K.app.getBoard() && K.app.getBoard().moves === 0) break;
    }
    const target = K.app.getBoard().distance;
    let guard = 0;
    while (K.app.getBoard().state !== 'won' && guard++ < 300) {
      const m = K.app.hint();
      if (!m) break;
      K.app.shift(m.index, m.dr, m.dc);
    }
    await new Promise(r => setTimeout(r, 400));
    const b = K.app.getBoard();
    // 弹窗各自独立（close 只移除自己那层），所以取**最后一个**——取第一个会拿到
    // 上一条用例残留的那个，标题就对不上了
    const all = document.querySelectorAll('#dialog-root .modal');
    const box = all[all.length - 1];
    const title = box ? box.querySelector('h2').textContent : '';
    const count = all.length;
    for (const m of all) { const x = m.querySelector('.modal-head .btn'); if (x) x.click(); }
    const best = SD.Klotski.store.best(b.level);
    return { ok: b.state === 'won' && b.moves === target && !!best && /曹操/.test(title),
             info: '走了 ' + b.moves + ' 步（标注最少 ' + target + '），弹窗「' + title + '」（当时共 ' + count + ' 个），记录 ' + (best ? best.moves : '无') };
  })()`, 120000);

  /* ================= 数织 ================= */

  await step('标题页把数织列为可进入', `(async function(){
    document.getElementById('btn-home').click();
    await new Promise(r => setTimeout(r, 200));
    const card = Array.from(document.querySelectorAll('.game-card'))
      .find((c) => c.querySelector('.gc-name').textContent === '数织');
    if (!card) return { ok: false, info: '没有卡片' };
    const soon = card.classList.contains('is-soon');
    card.click();
    await new Promise(r => setTimeout(r, 200));
    const title = document.querySelector('.home-title');
    return { ok: !soon && !!title && title.textContent === '数织',
             info: '置灰=' + soon + '，首页标题=' + (title ? title.textContent : '无') };
  })()`);

  await step('数织：开局画出网格和行列线索，且不泄露图名', `(async function(){
    document.querySelector('.home-item[data-go=medium]').click();
    await new Promise(r => setTimeout(r, 400));
    const N = SD.Nonogram;
    const b = N.app.getBoard();
    const cells = document.querySelectorAll('.ng-cell').length;
    const clues = document.querySelectorAll('.ng-clue').length;
    // 图名就是谜底，对局中不能出现在界面上
    const leaked = document.body.innerText.indexOf(b.name) >= 0;
    return { ok: cells === b.w * b.h && clues > 0 && !leaked,
             info: b.w + '×' + b.h + '，' + cells + ' 格，' + clues + ' 个线索位，图名泄露=' + leaked };
  })()`);

  // 回归：线索区曾经整体转置（grid 自动填充是行优先，而我是按列顺序 append 的），
  // 玩家看到的是"8 2"这种 10 行里根本装不下的线索，提示和标示也就对不上了。
  await step('数织：线索区和实际线索逐列逐格对齐', `(function(){
    const N = SD.Nonogram;
    const b = N.app.getBoard();
    const cols = document.querySelector('.ng-cols');
    const kids = cols.children;
    const ch = Math.max.apply(null, b.clues.cols.map((c) => c.length).concat([1]));
    let bad = 0, posBad = 0, detail = '';
    for (let c = 0; c < b.w; c++) {
      const list = b.clues.cols[c];
      for (let k = 0; k < ch; k++) {
        const idx = k - (ch - list.length);
        // 空行/空列的线索是 [0]，界面照常显示 0（留空会让人以为线索丢了）
        const want = idx >= 0 ? String(list[idx]) : '';
        const node = kids[c * ch + k];
        if (!node) { bad++; continue; }
        if (node.textContent !== want) { bad++; if (!detail) detail = '列' + (c+1) + ' 第' + (k+1) + '格 期望"' + want + '" 实际"' + node.textContent + '"'; }
        if (node.style.gridColumn !== String(c + 1) || node.style.gridRow !== String(k + 1)) posBad++;
      }
    }
    // 顺带验：没有任何一条线索"装不下"（段长之和 + 段间空格 > 行/列长度）
    let impossible = 0;
    for (const c of b.clues.cols) if (c.reduce((a, x) => a + x, 0) + (c.length - 1) > b.h) impossible++;
    for (const c of b.clues.rows) if (c.reduce((a, x) => a + x, 0) + (c.length - 1) > b.w) impossible++;
    return { ok: bad === 0 && posBad === 0 && impossible === 0,
             info: '线索格不对 ' + bad + ' 处、位置不对 ' + posBad + ' 处、装不下的线索 ' + impossible + ' 条' + (detail ? '（' + detail + '）' : '') };
  })()`);

  // 回归：线索灰化原先比的是"实心段长度和线索对不对得上"。
  // 一行里 2 个格子位置放错了长度仍然是 2，于是行线索变淡、列线索不变淡——
  // 玩家看到"左边完成了上面没有"，像坏了。现在按真解逐格判，两个方向必然一致。
  await step('数织：线索灰化按真解判定，行列不会互相矛盾', `(function(){
    const N = SD.Nonogram;
    N.app.startLevel('medium', 'gray-1');
    const b = N.app.getBoard();
    const rowsEl = document.querySelector('.ng-rows');
    const colsEl = document.querySelector('.ng-cols');
    const clueDone = (el, r) => {
      const nodes = Array.from(el.children).filter((n) => n.style.gridRow === String(r + 1) && n.textContent);
      return nodes.length ? nodes.every((n) => n.classList.contains('is-done')) : true;
    };
    const colDone = (c) => {
      const nodes = Array.from(colsEl.children).filter((n) => n.style.gridColumn === String(c + 1) && n.textContent);
      return nodes.length ? nodes.every((n) => n.classList.contains('is-done')) : true;
    };
    // 1) 填满真解 → 行列全灰
    for (let i = 0; i < b.cells.length; i++) N.setCell(b, i, b.solution[i] ? 1 : 0);
    N.app.render();
    let allGray = true;
    for (let r = 0; r < b.h; r++) if (!clueDone(rowsEl, r)) allGray = false;
    for (let c = 0; c < b.w; c++) if (!colDone(c)) allGray = false;

    // 2) 找一段长度≥2 的实心段，把它整体右移一格（长度不变、位置变了）
    let target = null;
    for (let r = 0; r < b.h && !target; r++) {
      const cells = N.rowOf(b, r);
      for (let c = 0; c + 2 < b.w; c++) {
        if (cells[c] === 1 && cells[c + 1] === 1 && cells[c + 2] === 0) { target = { r: r, c: c }; break; }
      }
    }
    if (!target) return { ok: false, info: '没找到可移动的实心段' };
    N.setCell(b, target.r * b.w + target.c, 0);
    N.setCell(b, target.r * b.w + target.c + 2, 1);
    N.app.render();
    const rowGray = clueDone(rowsEl, target.r);
    // 这一步把盘面改成了错的，后面的用例还要用，所以换一张新的
    N.app.startLevel('medium', 'gray-2');
    // 旧逻辑下这一行长度仍是 2，会被判成"做完"；新逻辑必须判成没做完
    return { ok: allGray && !rowGray,
             info: '填满真解时行列全灰=' + allGray
               + '；把第 ' + (target.r + 1) + ' 行的 2 连块整体右移一格后，该行仍被判为完成=' + rowGray + '（应为 false）' };
  })()`);

  await step('数织：拖拽可以批量填格', `(function(){
    const N = SD.Nonogram;
    const b = N.app.getBoard();
    const grid = document.querySelector('.ng-grid');
    const r = grid.getBoundingClientRect();
    const size = r.width / b.w;
    const at = (c, row) => ({ x: r.left + (c + 0.5) * size, y: r.top + (row + 0.5) * size });
    // 先把第 4 行清空
    for (let c = 0; c < b.w; c++) N.setCell(b, 3 * b.w + c, 0);
    N.app.render();
    const p0 = at(0, 3);
    const first = document.querySelectorAll('.ng-cell')[3 * b.w];
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p0.x, clientY: p0.y, button: 0 }));
    for (let c = 1; c < b.w; c++) {
      const p = at(c, 3);
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y }));
    }
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    let filled = 0;
    for (let c = 0; c < b.w; c++) if (b.cells[3 * b.w + c] === 1) filled++;
    // 再拖一次应该整行擦掉（第一格已经是实心，操作类型变成"清"）
    first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: p0.x, clientY: p0.y, button: 0 }));
    for (let c = 1; c < b.w; c++) {
      const p = at(c, 3);
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y }));
    }
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    let left = 0;
    for (let c = 0; c < b.w; c++) if (b.cells[3 * b.w + c] === 1) left++;
    return { ok: filled === b.w && left === 0, info: '划一次填了 ' + filled + '/' + b.w + ' 格，再划一次剩 ' + left + ' 格' };
  })()`);

  await step('数织：提示的结论必须和真解一致', `(function(){
    const N = SD.Nonogram;
    let wrong = 0, steps = 0;
    for (let k = 0; k < 40; k++) {
      const b = N.app.getBoard();
      if (b.state === 'won') break;
      const s = N.app.hint();
      if (!s || s.dead) break;
      steps++;
      for (const idx of s.filled) {
        const i = N.hints.toBoard(b, s, idx);
        if (!b.solution[i]) wrong++;                 // 说实心却是空 → 严重错误
        if (b.cells[i] === 0) N.setCell(b, i, 1);
      }
      for (const idx of s.marked) {
        const i = N.hints.toBoard(b, s, idx);
        if (b.solution[i]) wrong++;
        if (b.cells[i] === 0) N.setCell(b, i, 2);
      }
      N.app.render();
    }
    return { ok: wrong === 0 && steps > 0, info: '推了 ' + steps + ' 步，和真解冲突 ' + wrong + ' 格' };
  })()`);

  await step('数织：沿提示推完会结算并记进画册', `(async function(){
    const N = SD.Nonogram;
    N.app.startLevel('easy', 'browser-auto');
    await new Promise(r => setTimeout(r, 200));
    let guard = 0;
    while (guard++ < 200) {
      const b = N.app.getBoard();
      if (b.state === 'won') break;
      const s = N.app.hint();
      if (!s || s.dead) break;
      for (const idx of s.filled) {
        const i = N.hints.toBoard(b, s, idx);
        if (b.cells[i] !== 1) N.app.tap(i, { button: 0 });   // 走 app 的入口，结算才会触发
      }
      if (N.app.getBoard().state === 'won') break;
      for (const idx of s.marked) {
        const i = N.hints.toBoard(b, s, idx);
        if (b.cells[i] !== 2) N.setCell(b, i, 2);
      }
    }
    await new Promise(r => setTimeout(r, 300));
    const all = document.querySelectorAll('#dialog-root .modal');
    const box = all[all.length - 1];
    const title = box ? box.querySelector('h2').textContent : '';
    const art = document.querySelectorAll('.ng-art i').length;
    for (const m of all) { const x = m.querySelector('.modal-head .btn'); if (x) x.click(); }
    const rev = SD.Nonogram.store.revealed();
    return { ok: N.app.getBoard().state === 'won' && /解出来了/.test(title) && art > 0 && rev.length > 0,
             info: '弹窗「' + title + '」，揭晓图 ' + art + ' 格，画册 ' + rev.length + ' 张（' + rev.map((x) => x.name).join('、') + '）' };
  })()`, 120000);

  /* ================= 导航 ================= */

  await step('从对局页能一路退回标题页换游戏', `(async function(){
    SD.Shell.showView('game');
    await new Promise(r => setTimeout(r, 120));
    document.getElementById('btn-home-back').click();
    await new Promise(r => setTimeout(r, 180));
    const atHome = document.documentElement.getAttribute('data-view');
    const exit = document.getElementById('btn-game-exit');
    if (!exit) return { ok: false, info: '游戏首页没有「换个游戏」按钮' };
    exit.click();
    await new Promise(r => setTimeout(r, 250));
    const atTitle = document.documentElement.getAttribute('data-view');
    const cards = document.querySelectorAll('.game-card').length;
    const clickable = Array.from(document.querySelectorAll('.game-card')).filter((c) => !c.classList.contains('is-soon')).length;
    return { ok: atHome === 'home' && atTitle === 'title' && cards === 7 && clickable === 7,
             info: '对局页 → ' + atHome + ' → ' + atTitle + '，标题页 ' + cards + ' 张卡片（' + clickable + ' 张可进入）' };
  })()`);

  // 全程同步：enter() / leave() 本来就是同步改视图的，不需要等定时器。
  // 原先这里每款游戏都 await 两次 setTimeout，在无头浏览器里被节流拉到几十秒一次，
  // 五次就是几分钟——超时被中断，而打点显示其实早就走完了。
  await step('七款游戏都能进能出', `(function(){
    const out = [];
    for (const name of ['数独', '杀手数独', '扫雷', '数字华容道', '2048', '华容道', '数织']) {
      const card = Array.from(document.querySelectorAll('.game-card'))
        .find((c) => c.querySelector('.gc-name').textContent === name);
      if (!card) { out.push(name + ':没有卡片'); continue; }
      card.click();
      const inGame = document.documentElement.getAttribute('data-view');
      const items = document.querySelectorAll('.home-item').length;
      const exit = document.getElementById('btn-game-exit');
      if (!exit) { out.push(name + ':首页没有返回键'); continue; }
      exit.click();
      const back = document.documentElement.getAttribute('data-view');
      out.push(name + ':' + inGame + '/' + items + '入口/退回' + back);
    }
    // 不用正则：这段是嵌在模板字符串里的，反斜杠转义过几层容易丢
    const bad = out.filter((s) => s.indexOf('home/') < 0 || s.indexOf('入口/退回title') < 0);
    return { ok: bad.length === 0, info: out.join('  |  ') };
  })()`);

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
