'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9416;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.join(os.tmpdir(), 'sd-ocr2-' + Date.now());

const MAKE = (mode) => `(function () {
  const SIZE = 760, CS = 66, INNER = CS * 9;
  // 夹具题面写死，不从生成器取。
  // 曾经挂在 generateSync 上：所有题共用同一个终盘时夹具永远是顺子图、
  // 恰好避开 6/8/9 这些易混字形；生成器修好后换成另一道题，就误识了一个。
  // OCR 测试要验的是识别能力，不该被出题逻辑带着走。
  const FIXTURES = {
    clean: '.374865..|8..95..4.|5.6......|.......1.|.84.....3|2....7...|69.8..1.2|.......76|17..95438',
    photo: '.9...5...|285.36..4|...82.73.|.792....1|.13.8..2.|8....1...|....1.2.7|.2165....|..84.2...',
  };
  const givens = SD.Base.stringToGrid(FIXTURES['${mode}']);
  // 先画正着的标准盘面
  const flat = document.createElement('canvas');
  flat.width = INNER; flat.height = INNER;
  const f = flat.getContext('2d');
  f.fillStyle = '#fdfdfb'; f.fillRect(0, 0, INNER, INNER);
  f.fillStyle = '#111'; f.textAlign = 'center'; f.textBaseline = 'middle';
  f.font = '600 ' + Math.round(CS * 0.6) + 'px Arial';
  for (let i = 0; i < 81; i++) { const d = givens[i]; if (!d) continue; const r = Math.floor(i/9), c = i%9; f.fillText(String(d), (c+0.5)*CS, (r+0.5)*CS); }
  f.strokeStyle = '#222';
  for (let k = 0; k <= 9; k++) {
    f.lineWidth = k % 3 === 0 ? 3 : 1;
    f.beginPath(); f.moveTo(k*CS, 0); f.lineTo(k*CS, INNER); f.stroke();
    f.beginPath(); f.moveTo(0, k*CS); f.lineTo(INNER, k*CS); f.stroke();
  }
  if ('${mode}' === 'clean') {
    window.__fx = { givens: Array.from(givens), quad: { tl:{x:0,y:0}, tr:{x:INNER,y:0}, br:{x:INNER,y:INNER}, bl:{x:0,y:INNER} } };
    return flat.toDataURL('image/png');
  }
  // 模拟照片：把正盘面投到一个歪斜四边形上，再加噪点与轻微模糊
  const target = [ {x:96,y:70}, {x:672,y:44}, {x:700,y:648}, {x:62,y:676} ];
  // homography(src, dst) 是 src→dst；这里要的是「输出像素 → 源像素」，
  // 所以要把 target 放在 src 位置，否则会双重扭曲，网格根本不在 target 上
  const Hm = SD.Vision.homography(target, [{x:0,y:0},{x:INNER,y:0},{x:INNER,y:INNER},{x:0,y:INNER}]);
  const photo = document.createElement('canvas');
  photo.width = SIZE; photo.height = SIZE;
  const p = photo.getContext('2d');
  p.fillStyle = '#e9e6df'; p.fillRect(0, 0, SIZE, SIZE);
  const src2 = flat.getContext('2d', { willReadFrequently: true });
  const img = src2.getImageData(0, 0, INNER, INNER);
  const tmp = document.createElement('canvas'); tmp.width = INNER; tmp.height = INNER;
  tmp.getContext('2d').putImageData(img, 0, 0);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const w = Hm[6]*x + Hm[7]*y + Hm[8];
      const u = (Hm[0]*x + Hm[1]*y + Hm[2]) / w;
      const v = (Hm[3]*x + Hm[4]*y + Hm[5]) / w;
      if (u < 0 || v < 0 || u >= INNER || v >= INNER) continue;
      const si = ((v|0) * INNER + (u|0)) * 4;
      const di = (y * SIZE + x) * 4;
      const d = img.data;
      p.fillStyle = 'rgb(' + d[si] + ',' + d[si+1] + ',' + d[si+2] + ')';
      p.fillRect(x, y, 1, 1);
    }
  }
  // 真实照片的噪声是逐像素小幅抖动，不是成片的暗块。
  // 用固定种子的伪随机：原先用 Math.random 导致每次跑出的识别率都不一样
  // （实测在 22%~28% 之间浮动），根本没法当回归门禁。
  let seed = 0x2f6e2b1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const id = p.getImageData(0, 0, SIZE, SIZE);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (rnd() - 0.5) * 24;
    id.data[i] += n; id.data[i+1] += n; id.data[i+2] += n;
  }
  p.putImageData(id, 0, 0);
  for (let i = 0; i < 80; i++) {
    const nx = rnd()*SIZE, ny = rnd()*SIZE;
    const v = 60 + rnd()*60;
    p.fillStyle = 'rgb(' + (v|0) + ',' + (v|0) + ',' + (v|0) + ')';
    p.fillRect(nx, ny, 3, 3);
  }
  window.__fx = { givens: Array.from(givens), quad: { tl: target[0], tr: target[1], br: target[2], bl: target[3] } };
  return photo.toDataURL('image/jpeg', 0.85);
})()`;

const SCORE = `(async function () {
  await SD.OCR.recognize();
  const s = SD.OCR.state, f = window.__fx;
  let right = 0, wrong = 0, missing = 0, extra = 0, low = 0;
  for (let i = 0; i < 81; i++) {
    const truth = f.givens[i], got = s.digits[i], conf = s.confidences[i];
    if (conf >= 0 && conf < SD.OCR.LOW_CONF) low++;
    if (got === truth && truth) right++;
    else if (got && truth) wrong++;
    else if (!got && truth) missing++;
    else if (got) extra++;
  }
  return { total: f.givens.filter(Boolean).length, right, wrong, missing, extra, low,
    log: (document.querySelector('.ocr-log')||{}).textContent || '',
    status: (document.querySelector('.ocr-status')||{}).textContent || '' };
})()`;

(async () => {
  const b = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=' + PORT,'--user-data-dir=' + profile,'--window-size=1200,900','about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(400); try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); } catch (e) {} }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p(m); } };
  const send = (method, params) => new Promise((res) => { pend.set(++id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (expr, ms) => {
    const r = await Promise.race([send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }), sleep(ms || 180000).then(() => ({ timeout: true }))]);
    if (r.timeout) return 'TIMEOUT';
    const res = r.result || {};
    if (res.exceptionDetails) return 'EXC ' + (res.exceptionDetails.exception ? res.exceptionDetails.exception.description : res.exceptionDetails.text);
    return res.result ? res.result.value : null;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  // 接上 CDP 再导航。靠启动参数直接开目标页的话，页面在监听挂上之前
  // 就开始加载，tesseract 那 20MB 常常还没到位就被判定为「未就绪」。
  await send('Page.navigate', { url: 'http://127.0.0.1:8731/index.html' });
  // 浏览器把页面标签开出来，脚本未必跑完。必须等应用真正就绪，
  // 否则第一个场景会撞上 SD.Generator 还不存在的时刻。
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    await sleep(300);
    try {
      ready = await ev('String(!!(window.SD && SD.Generator && SD.OCR && document.querySelector(".cell"))) === "true"');
    } catch (e) { /* 页面还没到能求值的程度 */ }
  }
  if (!ready) { console.log('  ✗ 页面未就绪，放弃'); ws.close(); b.kill(); process.exit(2); }
  console.log('\n============ 图片识别：两种真实场景 ============');
  const results = {};
  for (const mode of ['clean', 'photo']) {
    const url = await ev(MAKE(mode), 30000);
    // ev() 失败时返回的是 'EXC ...' 或 'TIMEOUT'，同样是字符串，
    // 光判断 typeof 拦不住，夹具失败会被静默吞掉变成后面一句莫名其妙的读 undefined
    if (typeof url !== 'string' || !url.startsWith('data:image/')) {
      console.log('  ✗ 合成失败:' + String(url).slice(0, 300));
      results[mode] = null;
      continue;
    }
    await ev('(async function(){ await SD.OCR.loadSource(' + JSON.stringify(url) + '); })()', 30000);
    // 两种场景都用手动对齐的四边形：自动定位的质量由 tests/detect-test.js 单独把关，
    // 这里量的是「四边形对齐之后」的识别准确率，也就是用户拖完角之后的效果
    await ev('SD.OCR.state.quad = JSON.parse(JSON.stringify(window.__fx.quad)); SD.OCR.drawStage();', 10000);
    if (mode === 'photo') console.log('  [照片] 透视 + JPEG 压缩 + 传感器噪声 + 污点，四边形为手动对齐');
    const r = await ev(SCORE, 180000);
    if (typeof r !== 'object' || !r) { console.log('  x ' + mode + ' 识别失败:', r); continue; }
    const pct = Math.round(r.right / r.total * 100);
    console.log('  ' + (mode === 'clean' ? '[干净图]' : '[照片  ]') + ' 题面 ' + r.total + ' 个数字 → 正确 ' + r.right + '（' + pct + '%）、误识 ' + r.wrong + '、漏识 ' + r.missing + '、多出 ' + r.extra + '，待人工确认 ' + r.low + ' 格');
    console.log('           ' + String(r.log).trim().split('\n').filter(Boolean).join(' / '));
    results[mode] = r;
  }
  // 干净合成图是识别准确率的红线：透视校正、切格、二值化、逐格 OCR 全在里面。
  // 照片场景只做观察——JPEG 重压缩与透视重采样叠加后网格复检仍有残差，
  // 准确率取决于印刷质量，不适合作为必须达标的断言。
  const c = results.clean;
  const pass = !!c && c.right === c.total && c.wrong === 0 && c.extra === 0;
  console.log('\n  ' + (pass ? '✓ 干净图识别 100% 正确、0 误识' : '✗ 干净图识别未达标'));
  ws.close(); b.kill();
  try { require('fs').rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
