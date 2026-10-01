/* 数独 · 线上部署校验
 * 用法：node tests/verify-live.js [线上地址]
 * 默认地址 https://sudoku-studio.app.workbuddy.host
 *
 * 发布完别只看"发布成功"这四个字——把站点资源逐个下载回来比对 md5，
 * 一致才算真的同步上去了。
 *
 * 两个必须记住的点：
 *  1. 每个请求都带 ?t=<时间戳>。边缘节点会缓存，刚发完立刻请求拿到的是旧文件，
 *     md5 对不上，看着像部署失败。加时间戳才是线上真实内容。
 *  2. 只校验游戏本体（index.html / css / js）。tests/ 和 .workbuddy/ 虽然也会被上传，
 *     但它们不是站点资源，而且每次内容都在变，比对没有意义。
 *
 * 纯 Node 22 内置模块，无 npm 依赖，和其余测试保持一致。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = (process.argv[2] || 'https://sudoku-studio.app.workbuddy.host').replace(/\/+$/, '');
const ROOT = path.resolve(__dirname, '..');
const STAMP = Date.now();
const TIMEOUT = 60000;
const CONCURRENCY = 6;

// 不是站点资源，不参与比对
const SKIP_DIRS = new Set(['.git', 'node_modules', '.workbuddy', 'tests']);
const KEEP_EXT = /\.(html|css|js|gz|json|svg|png|ico|woff2?)$/i;

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const kb = (n) => (n / 1024).toFixed(n > 1024 * 1024 ? 0 : 1) + 'KB';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;           // .gitignore / .genie 之类不上传
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (KEEP_EXT.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

(async () => {
  const files = walk(ROOT)
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();

  console.log('数独 · 线上校验  →  ' + BASE);
  console.log('本地 ' + files.length + ' 个站点文件，逐个比对 md5（请求均加了时间戳，绕开边缘缓存）\n');

  // 有人（或另一个 agent）正在写代码时发布，会拍到一个写了一半的快照。
  // 单个文件写入只要几十毫秒，很容易刚好卡在打包和写盘之间，事后只能靠这条比对发现。
  const newest = Math.max(...files.map((rel) => fs.statSync(path.join(ROOT, rel)).mtimeMs));
  const ageS = (Date.now() - newest) / 1000;
  if (ageS < 30) {
    console.log('注意：最近 ' + ageS.toFixed(0) + ' 秒内还有站点文件被改动。');
    console.log('      如果此刻有另一个 agent 正在写代码，这次发布很可能只拍到了中间状态——');
    console.log('      等它停下来，再发布一次、再校验。\n');
  }

  const rows = [];
  await pool(files, CONCURRENCY, async (rel) => {
    const local = fs.readFileSync(path.join(ROOT, rel));
    const lh = md5(local);
    try {
      const res = await fetch(BASE + '/' + rel + '?t=' + STAMP, { signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) {
        rows.push({ rel, state: 'HTTP ' + res.status, lh, rh: '—', size: 0 });
        return;
      }
      const remote = Buffer.from(await res.arrayBuffer());
      const rh = md5(remote);
      rows.push({
        rel,
        state: lh === rh ? 'ok' : 'diff',
        lh,
        rh,
        size: remote.length,
        localSize: local.length,
      });
    } catch (e) {
      rows.push({ rel, state: 'fail:' + e.message, lh, rh: '—', size: 0 });
    }
  });

  rows.sort((a, b) => (a.rel < b.rel ? -1 : 1));

  let ok = 0;
  let bytes = 0;
  const bad = [];
  for (const r of rows) {
    if (r.state === 'ok') {
      ok++;
      bytes += r.size;
    } else {
      bad.push(r);
    }
  }

  for (const r of bad) {
    if (r.state === 'diff') {
      console.log('  ✗ ' + r.rel + '  本地 ' + r.lh.slice(0, 8) + ' ≠ 线上 ' + r.rh.slice(0, 8) +
        '（本地 ' + r.localSize + 'B / 线上 ' + r.size + 'B）');
    } else {
      console.log('  ✗ ' + r.rel + '  ' + r.state);
    }
  }

  console.log('\n一致 ' + ok + '/' + rows.length + '，共校验 ' + kb(bytes));

  // 单独点名 OCR 那套：它是整站最重、也最容易在部署时出问题的部分
  const ocr = ['js/vendor/tesseract/worker.min.js',
    'js/vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
    'js/vendor/tessdata/eng.traineddata.gz'];
  console.log('\nOCR 资源（图片识别全靠它）：');
  for (const rel of ocr) {
    const r = rows.find((x) => x.rel === rel);
    if (!r) console.log('  ? ' + rel + '  本地缺失');
    else if (r.state === 'ok') console.log('  ✓ ' + rel + '  ' + kb(r.size));
    else console.log('  ✗ ' + rel + '  ' + r.state);
  }

  if (bad.length === 0) {
    console.log('\n结论：线上与本地完全一致，发布生效。');
    process.exit(0);
  }
  console.log('\n结论：有 ' + bad.length + ' 处不一致。等几秒重跑一次；仍不一致说明这次发布没把最新文件带上去。');
  process.exit(1);
})().catch((e) => {
  console.error('校验失败：' + e.message);
  process.exit(1);
});
