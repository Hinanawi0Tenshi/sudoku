/* 数独 · 视觉回归：启动页 / 题库 / 关于 / 设置 / 游戏 / 手机端各截一张
 * 用法：node tests/screenshot.js [url]
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9412;
const URL = process.argv[2] || 'http://127.0.0.1:8731/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shotFor(name, width, height, setup) {
  const profile = path.join(os.tmpdir(), 'sudoku-shot-' + Date.now());
  const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=' + width + ',' + height, URL], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p(m.result); }
  };
  const send = (method, params) => new Promise((res) => { pending.set(++id, res); ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
  await send('Runtime.enable');
  await sleep(3500);
  if (setup) {
    const r = await send('Runtime.evaluate', { expression: setup, awaitPromise: true, returnByValue: true });
    if (r && r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(name + ' 的 setup 报错了: ' + (d.exception ? d.exception.description : d.text));
    }
    await sleep(3200);
  }
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.data, 'base64'));
  ws.close();
  browser.kill();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  console.log('已保存 ' + name);
}
// 等出题跑完再截图：生成是异步的，截早了只会拍到遮罩
const WAIT_READY = [
  'var tries = 0;',
  'var timer = setInterval(function() {',
  '  tries++;',
  '  var g = SD.Sudoku.app.getGame();',
  '  if (!g) return;',
  '  var empty = 0;',
  '  for (var k = 0; k < 81; k++) if (!g.state.board.grid[k]) empty++;',
  '  if (tries < 8 || empty < 30) return;',
  '  clearInterval(timer);',
  '}, 200);',
].join('');

// 造几条历史，好让日历同时有奖杯、进度环和空白三种状态
const DAILY_SEED = [
  '(function(){',
  '  var s = SD.Sudoku.store.stats(), t = new Date();',
  '  function k(n){ var d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - n); return SD.Generator.dailySeed(d); }',
  '  s.daily[k(5)] = { timeMs: 54000, won: true, tries: 1, filled: 81, total: 81 };',
  '  s.daily[k(4)] = { timeMs: 88000, won: true, tries: 2, filled: 81, total: 81 };',
  '  s.daily[k(3)] = { timeMs: null, won: false, tries: 0, filled: 62, total: 81 };',
  '  s.daily[k(2)] = { timeMs: 71000, won: true, tries: 1, filled: 81, total: 81 };',
  '  s.daily[k(1)] = { timeMs: null, won: false, tries: 0, filled: 28, total: 81 };',
  '  s.daily[k(0)] = { timeMs: null, won: false, tries: 0, filled: 9, total: 81 };',
  '  SD.Sudoku.store.saveGame(SD.Sudoku.store.loadGame() || {});',
  "  document.querySelector('.home-item[data-go=daily]').click();",
  '})()',
].join('');
const SCENES = [
  { name: 'shot-home.png', w: 1400, h: 940, setup: '' },
  { name: 'shot-bank.png', w: 1400, h: 940, setup: "document.querySelector('.home-item[data-go=bank]').click();" },
  { name: 'shot-calendar.png', w: 1400, h: 940, setup: DAILY_SEED },
  { name: 'shot-about.png', w: 1400, h: 940, setup: "document.querySelector('.home-item[data-go=about]').click();" },
  { name: 'shot-settings.png', w: 1400, h: 940, setup: "document.documentElement.setAttribute('data-theme','forest'); document.querySelector('.home-item[data-go=settings]').click();" },
  { name: 'shot-game.png', w: 1400, h: 940, setup: WAIT_READY + "SD.Sudoku.app.showView('game');" },
  { name: 'shot-learn.png', w: 1400, h: 940, setup: WAIT_READY + "SD.Sudoku.app.showView('game'); document.getElementById('btn-learn').click();" },
  { name: 'shot-stats.png', w: 1400, h: 940, setup: "document.querySelector('.home-item[data-go=stats]').click();" },
  { name: 'shot-hint.png', w: 1400, h: 940, setup: WAIT_READY + "SD.Sudoku.app.showView('game'); document.getElementById('btn-hint').click(); setTimeout(function(){ var r = document.querySelector('#hint-output .ref'); if (r) r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); }, 250);" },
  { name: 'shot-note.png', w: 1400, h: 940, setup: WAIT_READY + "SD.Sudoku.app.showView('game'); var g = SD.Sudoku.app.getGame(); g.state.board.locked.fill(0); g.state.board.rebuildNotes(); g.setNoteMode(true); for (var k=0;k<81;k++){ if(g.state.board.notes[k]){ g.select(k); break; } } SD.Sudoku.app.render();" },
  { name: 'shot-gacha.png', w: 1400, h: 940, setup: "document.querySelector('.home-item[data-go=gacha]').click();" },
  { name: 'shot-learn-page.png', w: 1400, h: 1000, setup: "document.querySelector('.home-item[data-go=learn]').click(); var h = document.querySelector('.tech-head'); if (h) h.click();" },
  { name: 'shot-learn-xwing.png', w: 1400, h: 1000, setup: "document.querySelector('.home-item[data-go=learn]').click(); var all = Array.from(document.querySelectorAll('.tech-head')); var h = all.filter(function(x){ return x.textContent.indexOf('四链列') >= 0; })[0] || all[0]; if (h) h.click(); setTimeout(function(){ document.querySelector('.demo-board').scrollIntoView({block:'center'}); }, 120);" },
  { name: 'shot-mine.png', w: 1400, h: 940, setup: "document.querySelector('.home-item[data-go=mine]').click();" },
  { name: 'shot-mobile.png', w: 390, h: 844, setup: '' },
  { name: 'shot-mobile-hint.png', w: 390, h: 844, setup: WAIT_READY + "SD.Sudoku.app.showView('game'); document.getElementById('btn-hint').click();" },
  { name: 'shot-mobile-game.png', w: 390, h: 844, setup: WAIT_READY + "SD.Sudoku.app.showView('game');" },
];

(async () => {
  // 可传第二个参数只截某几张：node tests/screenshot.js http://... calendar
  const only = process.argv[3];
  for (const s of SCENES) {
    if (only && !s.name.includes(only)) continue;
    await shotFor(s.name, s.w, s.h, s.setup || null);
  }
})().catch((e) => { console.error(e); process.exit(1); });