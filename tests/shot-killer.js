/* 杀手数独 · 视觉检查（node tests/shot-killer.js）
 *
 * 专门盯一件事：笼和和候选数不能叠在一起。
 * 两者都在格子左上角——笼和"11"叠上候选"1"就是"111"，玩家分不出哪个是笼和。
 */
'use strict';
const { spawn } = require('child_process');
const os = require('os'), path = require('path'), fs = require('fs');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9595;
const profile = path.join(os.tmpdir(), 'kshot-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=' + (process.env.MOBILE ? '390,844' : '900,1000'), 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60 && !t; i++) {
    await sleep(400);
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl); } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id: id, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'EXC ' + ((r.result.exceptionDetails.exception || {}).description || '').split('\n')[0];
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name, clip) => {
    const p = clip ? { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: clip.scale || 2 } } : { format: 'png' };
    const r = await send('Page.captureScreenshot', p);
    if (r.result && r.result.data) fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.result.data, 'base64'));
  };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8731/index.html' });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('!!(window.SD && SD.Killer)')) break; }
  await ev('Array.from(document.querySelectorAll(".game-card")).find(function(c){return c.querySelector(".gc-name").textContent==="杀手数独";}).click()');
  await sleep(400);
  await ev('document.querySelector(".home-item[data-go=play]").click()');
  await sleep(400);
  await ev('document.querySelectorAll("#dialog-root .diff-btn")[1].click()');
  for (let i = 0; i < 90; i++) { await sleep(200); if (await ev('document.documentElement.getAttribute("data-view")==="game" && !!SD.Killer.app.getPuzzle()')) break; }
  await sleep(500);
  await ev('(function(){var b=document.getElementById("btn-k-auto-notes"); if(b)b.click();})()');
  await sleep(600);

  console.log('有候选数的格子: ' + await ev('Array.from(document.querySelectorAll(".cell-notes")).filter(function(n){return n.children.length;}).length'));
  console.log(await ev(`(function(){
    var cells=document.querySelectorAll('.cell'), bad=0, ex='';
    for(var i=0;i<cells.length;i++){
      var sum=cells[i].querySelector('.cell-cage');
      var notes=cells[i].querySelector('.cell-notes');
      if(!sum.textContent || !notes.children.length) continue;
      var sr=sum.getBoundingClientRect();
      for(var k=0;k<notes.children.length;k++){
        var nr=notes.children[k].getBoundingClientRect();
        var hit=!(nr.right<sr.left||nr.left>sr.right||nr.bottom<sr.top||nr.top>sr.bottom);
        if(hit){ bad++; if(!ex) ex='第'+i+'格 笼和"'+sum.textContent+'" 与候选"'+notes.children[k].textContent+'" 重叠'; break; }
      }
    }
    return '笼和与候选数重叠的格子: '+bad+' 处'+(ex?('  ← '+ex):'');
  })()`));

  const box = JSON.parse(await ev('(function(){var r=document.querySelector(".board").getBoundingClientRect();return JSON.stringify({x:Math.round(r.x)-4,y:Math.round(r.y)-4,width:Math.round(r.width)+8,height:Math.round(r.height)+8});})()'));
  const tag = process.env.MOBILE ? '-mobile' : '';
  await shot('shot-killer-notes' + tag + '.png', box);
  await shot('shot-killer-corner' + tag + '.png', { x: box.x, y: box.y, width: 170, height: 110, scale: 5 });
  console.log('格子边长: ' + await ev('(function(){var c=document.querySelector(".cell"); return c?Math.round(c.getBoundingClientRect().width)+"px":"?";})()'));
  ws.close(); b.kill(); process.exit(0);
})().catch((e) => { console.error('崩溃', e.message); process.exit(1); });
