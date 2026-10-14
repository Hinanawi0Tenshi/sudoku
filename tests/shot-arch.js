/* 益智游戏合集 · 关键页面截图
 * 用 CDP 直接驱动真实页面抓图，看的是实际渲染结果而不是代码推断。
 * 用法：先起本地服务，再 node tests/shot-arch.js
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8731/index.html';
const PORT = 9413;
const profile = path.join(os.tmpdir(), 'sudoku-shot-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
  }
  if (!target) throw new Error('连不上调试端口');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expr) => {
    const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (!m || m.error) throw new Error('CDP: ' + JSON.stringify(m && m.error));
    if (m.result && m.result.exceptionDetails) {
      const d = m.result.exceptionDetails;
      throw new Error('页面异常: ' + (d.exception ? d.exception.description : d.text));
    }
    return m.result.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 200; i++) {
    await sleep(250);
    if (await ev('!!(window.SD && SD.Shell && SD.Sudoku.app)')) break;
  }
  await sleep(600);

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
    console.log('  ' + name);
  };

  await shot('shot-title.png');

  await ev('document.querySelector(".game-card:not(.is-soon)").click()');
  await sleep(1200);
  await shot('shot-sudoku-home.png');

  await ev('document.getElementById("btn-home").click()');
  await sleep(300);
  await ev('document.getElementById("title-settings").click()');
  await sleep(500);
  await shot('shot-settings.png');

  await ev('document.getElementById("page-back").click()');
  await sleep(300);
  await ev('document.getElementById("title-about").click()');
  await sleep(400);
  await shot('shot-about.png');

  // 回到数独并进对局页，看 JS 搭出来的对局骨架
  await ev('document.getElementById("page-back").click()');
  await sleep(300);
  await ev('document.querySelector(".game-card:not(.is-soon)").click()');
  await sleep(1500);
  await ev('SD.Sudoku.app.showView("game")');
  await sleep(600);
  await shot('shot-sudoku-play.png');

  // 扫雷
  await ev('document.getElementById("btn-home").click()');
  await sleep(300);
  await ev('Array.from(document.querySelectorAll(".game-card")).find((c) => c.querySelector(".gc-name").textContent === "扫雷").click()');
  await sleep(500);
  await shot('shot-mines-home.png');

  await ev('document.querySelector(".home-item[data-go=play]").click()');
  await sleep(300);
  await ev('document.querySelector("#dialog-root .mine-level").click()');
  await sleep(400);
  await ev('document.querySelectorAll("#game-play .mine-grid .mcell")[40].click()');
  await sleep(300);
  await ev('document.getElementById("btn-mine-hint").click()');
  await sleep(600);
  await shot('shot-mines-play.png');

  await ev('SD.Shell.openPage("扫雷教程", function (root) { SD.Mines.learn.render(root); })');
  await sleep(400);
  await ev('document.querySelectorAll(".mine-learn-head")[2].click()');
  await sleep(700);
  await shot('shot-mines-learn.png');

  // 杀手数独
  await ev('document.getElementById("btn-home").click()');
  await sleep(300);
  await ev('Array.from(document.querySelectorAll(".game-card")).find((c) => c.querySelector(".gc-name").textContent === "杀手数独").click()');
  await sleep(500);
  await shot('shot-killer-home.png');

  await ev('document.querySelector(".home-item[data-go=play]").click()');
  await sleep(300);
  await ev('document.querySelectorAll("#dialog-root .diff-btn")[2].click()');
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    if (await ev('!!(SD.Killer.app.getPuzzle() && document.querySelectorAll("#board .cell-cage").length)')) break;
  }
  await ev('document.querySelectorAll("#board .cell")[40].click()');
  await sleep(300);
  await ev('document.getElementById("btn-k-hint").click()');
  await sleep(700);
  await shot('shot-killer-play.png');

  await ev('SD.Shell.openPage("杀手数独教程", function (root) { SD.Killer.learn.render(root); })');
  await sleep(400);
  await ev('document.querySelectorAll(".mine-learn-head")[3].click()');
  await sleep(1200);
  // 演示盘面在页面下方，先滚到它再截，否则只截到半截
  await ev('(function () { const d = document.querySelector(".killer-demo"); if (d) d.scrollIntoView({ block: "center" }); return true; })()');
  await sleep(300);
  await shot('shot-killer-learn.png');
  console.log('  演示盘面字号: ' + await ev('(function () { const v = document.querySelector(".killer-demo .cell-value");'
    + ' const c = document.querySelector(".killer-demo .cell"); const s = document.querySelector(".killer-demo .cell-cage");'
    + ' return v ? getComputedStyle(v).fontSize + " / 格宽 " + Math.round(c.getBoundingClientRect().width) + "px / 笼和 " + getComputedStyle(s).fontSize : "无"; })()'));

  // 后四款：都是「平台层一行没改」加进来的，截图也走同一套流程
  for (const g of [
    { name: '数字华容道', level: 'n4', file: 'shot-slide-play.png', wait: 400 },
    { name: '2048', level: 'classic', file: 'shot-g2048-play.png', wait: 400 },
    { name: '华容道', level: 'hard', file: 'shot-klotski-play.png', wait: 1400 },
    { name: '数织', level: 'medium', file: 'shot-nonogram-play.png', wait: 400 },
  ]) {
    await ev('document.getElementById("btn-home").click()');
    await sleep(300);
    await ev('Array.from(document.querySelectorAll(".game-card")).find((c) => c.querySelector(".gc-name").textContent === "'
      + g.name + '").click()');
    await sleep(400);
    await shot(g.file.replace('-play', '-home'));
    await ev('document.querySelector(".home-item[data-go=' + g.level + ']").click()');
    await sleep(g.wait);
    await shot(g.file);
  }

  ws.close(); b.kill();
  process.exit(0);
})().catch((e) => { console.error('失败: ' + (e && e.message) + '\n' + (e && e.stack)); process.exit(1); });
