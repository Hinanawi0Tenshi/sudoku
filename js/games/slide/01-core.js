/* 数字华容道 · 棋盘模型
 *
 * 一块 n×n 的板，格子放 1..n²-1，剩一格空着。点空格旁边的数字它就滑过来。
 * 目标：数字按顺序排好、空格落回右下角。
 *
 * 打乱用的是「从终局倒着走」，不是随机排列。随机排列有一半概率无解
 * （逆序数的奇偶性决定），还得额外判一次；倒着走出来**必然有解**，
 * 而且走的步数直接当难度旋钮，不用另外设计。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const S = (SD.Slide = SD.Slide || {});

  /**
   * scramble 是从终局倒着走的步数，不是最优解长度——随机游走会反复走回头路，
   * 实际最优解通常只有它的三分之一左右。这里只把它当难度旋钮用。
   */
  const LEVELS = [
    { id: 'n3', name: '3 × 3', n: 3, star: 1, scramble: 60,  points: 6 },
    { id: 'n4', name: '4 × 4', n: 4, star: 2, scramble: 140, points: 18 },
    { id: 'n5', name: '5 × 5', n: 5, star: 3, scramble: 260, points: 40 },
  ];
  const byId = (id) => LEVELS.find((l) => l.id === id) || null;

  /** 与 i 相邻的格子下标（上下左右，出界的不算） */
  function neighborsOf(n, i) {
    const r = (i / n) | 0;
    const c = i % n;
    const out = [];
    if (r > 0) out.push(i - n);
    if (r < n - 1) out.push(i + n);
    if (c > 0) out.push(i - 1);
    if (c < n - 1) out.push(i + 1);
    return out;
  }

  function create(n, seed) {
    const b = {
      n: n,
      cells: new Int16Array(n * n),
      empty: n * n - 1,
      moves: 0,
      state: 'ready',        // ready | playing | won
      seed: seed === undefined || seed === null ? null : String(seed),
      elapsed: 0,
    };
    reset(b);
    return b;
  }

  function reset(b) {
    const N = b.n * b.n;
    for (let i = 0; i < N - 1; i++) b.cells[i] = i + 1;
    b.cells[N - 1] = 0;
    b.empty = N - 1;
    b.moves = 0;
    b.state = 'ready';
  }

  function solved(b) {
    const N = b.n * b.n;
    for (let i = 0; i < N - 1; i++) if (b.cells[i] !== i + 1) return false;
    return b.cells[N - 1] === 0;
  }

  /** 下标 i 上的数字能不能滑进空格 */
  const canMove = (b, i) => b.state !== 'won' && neighborsOf(b.n, b.empty).indexOf(i) >= 0;

  function move(b, i) {
    if (!canMove(b, i)) return false;
    b.cells[b.empty] = b.cells[i];
    b.cells[i] = 0;
    b.empty = i;
    b.moves++;
    if (b.state === 'ready') b.state = 'playing';
    if (solved(b)) b.state = 'won';
    return true;
  }

  /**
   * 从终局倒着走 steps 步。
   * 不走回头路（不把刚挪过来的那块又挪回去），否则步数会白白浪费在原地打转上。
   */
  function shuffle(b, steps, rng) {
    const n = b.n;
    for (let k = 0; k < steps; k++) {
      const opts = neighborsOf(n, b.empty).filter((j) => j !== b._prev);
      const j = opts[Math.floor(rng() * opts.length)];
      b._prev = b.empty;
      b.cells[b.empty] = b.cells[j];
      b.cells[j] = 0;
      b.empty = j;
    }
    b._prev = -1;
    b.moves = 0;
    b.state = 'playing';
  }

  /** 开一局：按难度建板并打乱 */
  function start(levelId, seed) {
    const lv = byId(levelId) || LEVELS[0];
    const rng = SD.Util.makeRng(seed === undefined || seed === null
      ? String(Date.now()) + '-' + Math.random()
      : 'slide|' + seed);
    const b = create(lv.n, seed);
    shuffle(b, lv.scramble, rng);
    b.level = lv.id;
    return b;
  }

  S.LEVELS = LEVELS;
  S.byId = byId;
  S.create = create;
  S.reset = reset;
  S.solved = solved;
  S.canMove = canMove;
  S.move = move;
  S.shuffle = shuffle;
  S.start = start;
  S.neighborsOf = neighborsOf;
})(window);
