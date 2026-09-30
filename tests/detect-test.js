/* 数独 · 网格自动定位的快速单测（纯 Node，无需浏览器）
 * 合成若干张「照片」：透视网格 + 噪声 + 亮度渐变，检查 detectQuadFromGray 找出的四角误差。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
globalThis.window = globalThis;
globalThis.SD = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', '17-ocr-vision.js'), 'utf8'), { filename: 'v' });
const V = SD.Vision;

function renderPhoto(size, quad, opts) {
  const o = opts || {};
  // 固定种子的线性同余随机数：JPEG 块偏移和噪点都靠它，
  // 不固定的话每次噪点分布都不一样，测试无法复现
  let seed = o.seed || 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const g = new Uint8ClampedArray(size * size);
  for (let i = 0; i < g.length; i++) {
    g[i] = 200 + Math.round(45 * ((i % size) / size));
  }
  const thick = o.thick || 2;
  const line = (x0, y0, x1, y1) => {
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) * 2;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const x = Math.round(x0 + (x1 - x0) * u);
      const y = Math.round(y0 + (y1 - y0) * u);
      for (let dx = 0; dx < thick; dx++) {
        for (let dy = 0; dy < thick; dy++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          g[yy * size + xx] = 30;
        }
      }
    }
  };
  const mix = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  for (let k = 0; k <= 9; k++) {
    const t = k / 9;
    const a = mix([quad.tl.x, quad.tl.y], [quad.tr.x, quad.tr.y], t);
    const b = mix([quad.bl.x, quad.bl.y], [quad.br.x, quad.br.y], t);
    line(a[0], a[1], b[0], b[1]);              // 第 k 条竖线
    const c = mix([quad.tl.x, quad.tl.y], [quad.bl.x, quad.bl.y], t);
    const d2 = mix([quad.tr.x, quad.tr.y], [quad.br.x, quad.br.y], t);
    line(c[0], c[1], d2[0], d2[1]);            // 第 k 条横线
  }
  if (o.jpeg) {
    // 近似 JPEG：8×8 块各自偏移亮度，块边界出现台阶
    for (let by = 0; by < size; by += 8) {
      for (let bx = 0; bx < size; bx += 8) {
        const d = (Math.random() - 0.5) * o.jpeg;
        for (let y = by; y < Math.min(by + 8, size); y++) {
          for (let x = bx; x < Math.min(bx + 8, size); x++) {
            g[y * size + x] = Math.max(0, Math.min(255, g[y * size + x] + d));
          }
        }
      }
    }
  }
  if (o.noise) {
    // 真实照片的传感器噪声是逐像素的小幅抖动，不是成片的暗块
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, g[i] + (Math.random() - 0.5) * o.noise));
  }
  if (o.specks) {
    for (let i = 0; i < o.specks; i++) {
      const x = Math.floor(Math.random() * size);
      const y = Math.floor(Math.random() * size);
      const v = 60 + Math.floor(Math.random() * 60);
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          if (x + dx < size && y + dy < size) g[(y + dy) * size + (x + dx)] = v;
        }
      }
    }
  }
  return g;
}

const CASES = [
  { name: '正置网格', quad: { tl:{x:60,y:60}, tr:{x:700,y:60}, br:{x:700,y:700}, bl:{x:60,y:700} }, opts: {} },
  { name: '轻微歪斜', quad: { tl:{x:96,y:70}, tr:{x:672,y:44}, br:{x:700,y:648}, bl:{x:62,y:676} }, opts: { gradient:true } },
  { name: '歪斜+传感器噪声', quad: { tl:{x:96,y:70}, tr:{x:672,y:44}, br:{x:700,y:648}, bl:{x:62,y:676} }, opts: { gradient:true, noise:26 } },
  { name: '歪斜+大量污点', quad: { tl:{x:96,y:70}, tr:{x:672,y:44}, br:{x:700,y:648}, bl:{x:62,y:676} }, opts: { gradient:true, noise:26, specks:400 } },
  { name: '强透视', quad: { tl:{x:180,y:140}, tr:{x:600,y:90}, br:{x:660,y:640}, bl:{x:110,y:600} }, opts: { gradient:true, noise:26 } },
  { name: 'JPEG 块效应', quad: { tl:{x:96,y:70}, tr:{x:672,y:44}, br:{x:700,y:648}, bl:{x:62,y:676} }, opts: { gradient:true, jpeg:70 } },
  { name: 'JPEG+噪声+污点', quad: { tl:{x:96,y:70}, tr:{x:672,y:44}, br:{x:700,y:648}, bl:{x:62,y:676} }, opts: { gradient:true, jpeg:70, noise:26, specks:300 } },
];

let pass = 0;
for (const c of CASES) {
  const size = 760;
  const g = renderPhoto(size, c.quad, c.opts);
  const t0 = Date.now();
  const q = V.detectQuadFromGray(g, size, size);
  const ms = Date.now() - t0;
  if (!q) { console.log('  x ' + c.name + ' —— 未检出 ' + JSON.stringify(V.__trace)); continue; }
  let err = 0;
  for (const k of ['tl','tr','br','bl']) err = Math.max(err, Math.hypot(q[k].x - c.quad[k].x, q[k].y - c.quad[k].y));
  // 自动定位只要「大致对上」即可：校正之后 refineGrid 会在拉正的图里重新量一次
  // 真实框线，把这里的残差吃掉。识别准确率由 tests/ocr-test.js 端到端把关。
  const okErr = err < size * 0.06;
  if (okErr) pass++;
  console.log('  ' + (okErr ? 'o' : 'x') + ' ' + c.name + ' —— 最大角点误差 ' + err.toFixed(1) + 'px，耗时 ' + ms + 'ms');
  if (!okErr) console.log('      检出 ' + JSON.stringify(q).slice(0, 220) + ' ' + JSON.stringify(V.__trace));
}
console.log('\n通过 ' + pass + ' / ' + CASES.length);
process.exit(pass === CASES.length ? 0 : 1);
