/* 益智游戏合集 · 通用工具
 *
 * 随机数、文本、时间这几样跟具体哪款游戏没关系，所以放在平台层。
 * 原先它们长在数独的 js/core/01-core.js 里，扫雷要用就得反过来依赖数独族的 core——
 * 一款雷盘游戏去 import 9×9 的模块，边界就糊了。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});

  /* ---------- 可复现随机数（mulberry32 + xmur3 种子哈希） ---------- */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 种子可以是字符串或数字；字符串种子保证「每日挑战」可复现 */
  function makeRng(seed) {
    const norm = typeof seed === 'string' ? seed : String(seed);
    return mulberry32(xmur3(norm)());
  }

  /** Fisher-Yates，原地洗牌 */
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ---------- 文本 / 时间 ---------- */
  const pad2 = (n) => (n < 10 ? '0' + n : String(n));

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = (total / 3600) | 0;
    const m = ((total % 3600) / 60) | 0;
    const s = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  }

  /** 日期键 YYYY-MM-DD。每日挑战按它播种，跨游戏格式统一 */
  const dayKey = (d) => {
    const x = d || new Date();
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  };

  /* ---------- 数值 ---------- */
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /**
   * 二项式系数。扫雷算概率要用它数「深海格」有多少种放雷方式，
   * 直接乘会溢出（C(480,99) 有 110 位），所以这里一边乘一边除。
   */
  function binomial(n, k) {
    if (k < 0 || k > n) return 0;
    const kk = Math.min(k, n - k);
    let out = 1;
    for (let i = 1; i <= kk; i++) out = (out * (n - kk + i)) / i;
    return out;
  }

  /**
   * 给运行时拼出来的资源地址补上版本戳。
   * index.html 里的 script/link 由那段内联脚本统一加版本戳，但 OCR 的
   * worker / wasm / 语言包是运行时用字符串拼路径的，走不到那里——
   * 而这几个文件占了整包 20M 的大头，恰恰最需要绕开缓存。
   */
  const versioned = (path) => {
    const v = (global.SD && global.SD_BUILD) || '';
    if (!v || path.indexOf('?v=') >= 0) return path;
    return path + '?v=' + v;
  };

  SD.Util = {
    makeRng: makeRng,
    shuffle: shuffle,
    pad2: pad2,
    formatDuration: formatDuration,
    clamp: clamp,
    binomial: binomial,
    dayKey: dayKey,
    versioned: versioned,
  };
})(window);
