/* 2048 · 棋盘模型
 *
 * 和数字华容道不一样：那边一次只动一格，这边一次整行整列地推。
 * 所以 move() 不只要改盘面，还得把「哪块牌从哪滑到哪」「哪两块并成了什么」一并交出来，
 * 否则渲染层做不了滑动和合并动画——2048 没有动画就没有手感。
 *
 * 这里只算，不生成新牌：新牌由 app 在滑完、动画开始之后单独调用 spawn()，
 * 这样视觉上才是「先滑过去，再冒出来」，而不是两块同时出现。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const G = (SD.G2048 = SD.G2048 || {});

  const LEVELS = [
    { id: 'tiny',    name: '3 × 3', size: 3, target: 256,  star: 1, points: 8 },
    { id: 'classic', name: '4 × 4', size: 4, target: 2048, star: 2, points: 30 },
    { id: 'large',   name: '5 × 5', size: 5, target: 4096, star: 3, points: 60 },
  ];
  const byId = (id) => LEVELS.find((l) => l.id === id) || null;
  const DIRS = ['left', 'right', 'up', 'down'];

  /**
   * 一个方向上四条线的下标，按「牌行进的方向」排好序。
   * 比如 left 时每行是从左到右，right 时是从右到左——这样滑动逻辑只需要写一遍。
   */
  function lineIndices(n, dir) {
    const lines = [];
    for (let k = 0; k < n; k++) {
      const line = [];
      for (let j = 0; j < n; j++) {
        let r, c;
        if (dir === 'left') { r = k; c = j; }
        else if (dir === 'right') { r = k; c = n - 1 - j; }
        else if (dir === 'up') { r = j; c = k; }
        else { r = n - 1 - j; c = k; }
        line.push(r * n + c);
      }
      lines.push(line);
    }
    return lines;
  }

  function create(size, seed) {
    return {
      size: size,
      cells: new Int16Array(size * size),
      score: 0,
      moves: 0,
      state: 'ready',            // ready | playing | over | won
      seed: seed === undefined || seed === null ? null : String(seed),
      elapsed: 0,
      target: 2048,
      level: 'classic',
    };
  }

  function emptyCells(b) {
    const out = [];
    for (let i = 0; i < b.cells.length; i++) if (!b.cells[i]) out.push(i);
    return out;
  }

  /**
   * 落一块新牌。90% 是 2、10% 是 4——这是 2048 的原始概率，改了就完全不是这个游戏了。
   * @returns {{index:number, value:number}|null} 没空格可落返回 null
   */
  function spawn(b, rng) {
    const free = emptyCells(b);
    if (!free.length) return null;
    const i = free[Math.floor(rng() * free.length)];
    const v = rng() < 0.9 ? 2 : 4;
    b.cells[i] = v;
    return { index: i, value: v };
  }

  /**
   * 往某个方向推。
   * @returns {null|{gained:number, slides:Array<{from:number,to:number}>, merges:Array<{to:number,value:number}>}}
   *          没推动返回 null（不消耗步数，也不该落新牌）
   */
  function move(b, dir) {
    if (b.state === 'over' || DIRS.indexOf(dir) < 0) return null;
    const n = b.size;
    const slides = [];
    const merges = [];
    let gained = 0;
    let moved = false;

    for (const line of lineIndices(n, dir)) {
      // 先把这一行非空的牌按行进顺序取出来，连同它们的原下标
      const items = [];
      for (const i of line) if (b.cells[i]) items.push({ v: b.cells[i], i: i });

      const out = [];
      let p = 0;
      while (p < items.length) {
        if (p + 1 < items.length && items[p].v === items[p + 1].v) {
          out.push({ v: items[p].v * 2, src: [items[p].i, items[p + 1].i], merge: true });
          gained += items[p].v * 2;
          p += 2;
        } else {
          out.push({ v: items[p].v, src: [items[p].i], merge: false });
          p += 1;
        }
      }

      for (let k = 0; k < line.length; k++) {
        const to = line[k];
        const o = out[k];
        const before = b.cells[to];
        if (!o) { b.cells[to] = 0; if (before) moved = true; continue; }
        b.cells[to] = o.v;
        if (before !== o.v) moved = true;
        for (const from of o.src) {
          if (from !== to) { slides.push({ from: from, to: to }); moved = true; }
        }
        if (o.merge) merges.push({ to: to, value: o.v });
      }
    }

    if (!moved) return null;
    b.score += gained;
    b.moves++;
    if (b.state === 'ready') b.state = 'playing';
    return { gained: gained, slides: slides, merges: merges };
  }

  /** 还有空位、或者有相邻相同的牌，就还能走 */
  function canMove(b) {
    const n = b.size;
    for (let i = 0; i < b.cells.length; i++) if (!b.cells[i]) return true;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = b.cells[r * n + c];
        if (c + 1 < n && b.cells[r * n + c + 1] === v) return true;
        if (r + 1 < n && b.cells[(r + 1) * n + c] === v) return true;
      }
    }
    return false;
  }

  const maxTile = (b) => {
    let m = 0;
    for (const v of b.cells) if (v > m) m = v;
    return m;
  };

  /** 推完并落子之后的收尾：判死、判达标 */
  function settle(b) {
    if (maxTile(b) >= b.target) b.state = 'won';
    if (!canMove(b)) b.state = 'over';
    return b.state;
  }

  function start(levelId, seed) {
    const lv = byId(levelId) || LEVELS[1];
    const rng = SD.Util.makeRng(seed === undefined || seed === null
      ? String(Date.now()) + '-' + Math.random()
      : 'g2048|' + seed);
    const b = create(lv.size, seed);
    b.target = lv.target;
    b.level = lv.id;
    b.state = 'playing';
    spawn(b, rng);
    spawn(b, rng);
    return b;
  }

  /** 把一个只读的快照推一步——求解器要用，不能动原盘 */
  function preview(cells, n, dir) {
    const fake = { size: n, cells: Int16Array.from(cells), score: 0, moves: 0, state: 'playing' };
    const d = move(fake, dir);
    return d ? { cells: fake.cells, gained: d.gained } : null;
  }

  G.LEVELS = LEVELS;
  G.DIRS = DIRS;
  G.byId = byId;
  G.create = create;
  G.spawn = spawn;
  G.move = move;
  G.canMove = canMove;
  G.maxTile = maxTile;
  G.settle = settle;
  G.start = start;
  G.preview = preview;
  G.lineIndices = lineIndices;
  G.emptyCells = emptyCells;
})(window);
