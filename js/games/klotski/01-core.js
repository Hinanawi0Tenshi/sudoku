/* 华容道 · 棋盘模型
 *
 * 4 宽 5 高的盘，放 1 个 2×2（曹操）、4 个 1×2、1 个 2×1、4 个 1×1，剩两格空。
 * 把曹操挪到底部中间就赢。
 *
 * 状态用「每格属于哪一块」表示。但**判重不能按块的身份**——四个卒互换位置、
 * 两个竖块互换位置，对玩家来说是同一个局面。所以算键的时候要把块身份映射成
 * 「形状类型」，否则同一局面会被当成好几个，状态空间白翻好几倍。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const K = (SD.Klotski = SD.Klotski || {});

  const W = 4, H = 5;
  const EMPTY = 255;

  // 形状类型：判重时用它，不用块身份
  const TYPE_CAO = 0;   // 2×2
  const TYPE_V = 1;     // 1×2 竖
  const TYPE_H = 2;     // 2×1 横
  const TYPE_S = 3;     // 1×1 卒
  const TYPE_CH = ['C', 'V', 'H', 'S'];

  /** 经典开局「横刀立马」 */
  function classicPieces() {
    return [
      { type: TYPE_CAO, name: '曹操', w: 2, h: 2, r: 0, c: 1 },
      { type: TYPE_V, name: '张飞', w: 1, h: 2, r: 0, c: 0 },
      { type: TYPE_V, name: '赵云', w: 1, h: 2, r: 0, c: 3 },
      { type: TYPE_V, name: '马超', w: 1, h: 2, r: 2, c: 0 },
      { type: TYPE_V, name: '黄忠', w: 1, h: 2, r: 2, c: 3 },
      { type: TYPE_H, name: '关羽', w: 2, h: 1, r: 2, c: 1 },
      { type: TYPE_S, name: '卒', w: 1, h: 1, r: 3, c: 1 },
      { type: TYPE_S, name: '卒', w: 1, h: 1, r: 3, c: 2 },
      { type: TYPE_S, name: '卒', w: 1, h: 1, r: 4, c: 0 },
      { type: TYPE_S, name: '卒', w: 1, h: 1, r: 4, c: 3 },
    ];
  }

  function create(pieces) {
    const b = {
      w: W, h: H,
      pieces: (pieces || classicPieces()).map((p) => ({ type: p.type, name: p.name, w: p.w, h: p.h, r: p.r, c: p.c })),
      grid: new Uint8Array(W * H).fill(EMPTY),
      moves: 0,
      state: 'playing',      // playing | won
      elapsed: 0,
    };
    rebuild(b);
    return b;
  }

  function rebuild(b) {
    b.grid.fill(EMPTY);
    for (let i = 0; i < b.pieces.length; i++) {
      const p = b.pieces[i];
      for (let dr = 0; dr < p.h; dr++) {
        for (let dc = 0; dc < p.w; dc++) b.grid[(p.r + dr) * W + (p.c + dc)] = i;
      }
    }
  }

  const cao = (b) => b.pieces[0];
  /** 曹操左上角在 (3,1) 就是赢 */
  const isSolved = (b) => b.pieces[0].r === 3 && b.pieces[0].c === 1;

  const DIRS = [[-1, 0, 'up'], [1, 0, 'down'], [0, -1, 'left'], [0, 1, 'right']];

  /** 这块往某个方向挪一格行不行 */
  function canShift(b, i, dr, dc) {
    const p = b.pieces[i];
    const nr = p.r + dr, nc = p.c + dc;
    if (nr < 0 || nc < 0 || nr + p.h > H || nc + p.w > W) return false;
    for (let r = 0; r < p.h; r++) {
      for (let c = 0; c < p.w; c++) {
        const t = b.grid[(nr + r) * W + (nc + c)];
        if (t !== EMPTY && t !== i) return false;
      }
    }
    return true;
  }

  function shift(b, i, dr, dc) {
    if (!canShift(b, i, dr, dc)) return false;
    const p = b.pieces[i];
    p.r += dr;
    p.c += dc;
    rebuild(b);
    b.moves++;
    if (isSolved(b)) b.state = 'won';
    return true;
  }

  /**
   * 局面键。按**形状类型**编码，不按块身份——
   * 四个卒互换、两个竖块互换，对玩家是同一个局面，不合并的话状态数会白翻好几倍。
   *
   * 编码必须和 02-solver.js 里的完全一致（同样是「每格一个字符，值是类型码，
   * 空格 255」）。两边各写一套的话查表永远查不到——这里踩过一次。
   */
  const KEY_BUF = new Uint8Array(W * H);
  const KEY_EMPTY = 4;      // 类型只占 0~3，空格用 4
  function keyOf(pieces) {
    KEY_BUF.fill(KEY_EMPTY);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      for (let dr = 0; dr < p.h; dr++) {
        const base = (p.r + dr) * W + p.c;
        for (let dc = 0; dc < p.w; dc++) KEY_BUF[base + dc] = p.type;
      }
    }
    return String.fromCharCode.apply(null, KEY_BUF);
  }

  K.W = W;
  K.H = H;
  K.EMPTY = EMPTY;
  K.TYPES = { CAO: TYPE_CAO, V: TYPE_V, H: TYPE_H, S: TYPE_S };
  K.TYPE_CH = TYPE_CH;
  K.DIRS = DIRS;
  K.create = create;
  K.classicPieces = classicPieces;
  K.rebuild = rebuild;
  K.cao = cao;
  K.isSolved = isSolved;
  K.canShift = canShift;
  K.shift = shift;
  K.keyOf = keyOf;
})(window);
