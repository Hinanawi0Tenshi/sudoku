/* 数独 · 数字模板匹配（js/games/sudoku/07b-digit-match.js）
 *
 * 为什么不用通用 OCR：Tesseract 是给「成行的文字段落」设计的，而数独是一堆孤立数字。
 * 它得靠上下文，单字识别反而不稳；而且整个 wasm 包 17MB，占了这个项目 42% 的体积。
 *
 * 这里的做法是「按字形比」：运行时用几种常见字体现画 1~9 的模板，把格子里的字形
 * 归一化后逐个比。零资源、零依赖、几毫秒一格。
 *
 * 归一化方式很关键：**按高度缩放、水平居中，保持宽高比**。
 * 不能按包围盒拉满——那样细长的"1"会被拉成和"8"一样宽，两者就分不开了。
 */
(function (global) {
  'use strict';
  const SD = global.SD = global.SD || {};
  SD.Sudoku = SD.Sudoku || {};

  const SIZE = 24;        // 归一化后的画布边长
  const INNER = 18;       // 字形在画布里的最大边长（四周留白，和训练/渲染一致）

  /** 从画布抽出墨迹掩码，按高度缩放、水平居中 */
  function maskOf(canvas) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const v = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000;
        if (v >= 140) continue;              // 浅的不算墨迹
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    const gw = x1 - x0 + 1, gh = y1 - y0 + 1;
    // 按高度等比缩放
    const scale = INNER / gh;
    const tw = Math.max(1, Math.round(gw * scale));
    const th = INNER;
    const out = new Uint8Array(SIZE * SIZE);
    const ox = ((SIZE - tw) / 2) | 0;
    const oy = ((SIZE - th) / 2) | 0;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const sx = x0 + Math.min(gw - 1, Math.floor(x / scale));
        const sy = y0 + Math.min(gh - 1, Math.floor(y / scale));
        const o = (sy * w + sx) * 4;
        const v = (d[o] * 299 + d[o + 1] * 587 + d[o + 2] * 114) / 1000;
        if (v < 140) out[(oy + y) * SIZE + (ox + x)] = 1;
      }
    }
    return out;
  }

  let templates = null;

  function build() {
    // 数独题面多是印刷体，字体五花八门。多备几套比只留 Arial 稳得多，
    // 尤其是"1"带不带底座、"7"带不带横杠、"4"封不封口这几种常见差异。
    const fonts = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Georgia',
      'Times New Roman', 'Courier New', 'Trebuchet MS'];
    const weights = ['400', '700'];
    const list = [];
    for (const font of fonts) {
      for (const weight of weights) {
        for (let d = 1; d <= 9; d++) {
          const cv = document.createElement('canvas');
          cv.width = 64; cv.height = 64;
          const c = cv.getContext('2d');
          c.fillStyle = '#fff';
          c.fillRect(0, 0, 64, 64);
          c.fillStyle = '#000';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = weight + ' 48px "' + font + '"';
          c.fillText(String(d), 32, 32);
          const m = maskOf(cv);
          if (m) list.push({ digit: d, mask: m });
        }
      }
    }
    templates = list;
    return list.length;
  }

  /** 两个掩码的重合度（交并比） */
  function score(a, b) {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x & y) inter++;
      if (x | y) uni++;
    }
    return uni ? inter / uni : 0;
  }

  /**
   * 认一个字形。
   * @returns {{digit:number, score:number}|null} score 是 0~1 的匹配度
   */
  function match(canvas) {
    if (!templates) build();
    const m = maskOf(canvas);
    if (!m) return null;
    const byDigit = new Array(10).fill(0);
    for (const t of templates) {
      const s = score(m, t.mask);
      if (s > byDigit[t.digit]) byDigit[t.digit] = s;
    }
    let best = 0, bestScore = -1, second = 0;
    for (let d = 1; d <= 9; d++) {
      if (byDigit[d] > bestScore) { second = bestScore; bestScore = byDigit[d]; best = d; }
      else if (byDigit[d] > second) second = byDigit[d];
    }
    return best ? { digit: best, score: bestScore, margin: bestScore - second } : null;
  }

  SD.Sudoku.digit = { match: match, build: build, SIZE: SIZE };
})(window);
