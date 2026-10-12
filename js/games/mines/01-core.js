/* 扫雷 · 棋盘与规则
 *
 * 纯逻辑：不碰 DOM、不读全局状态，Node 里能直接单测。
 * 三档尺寸照搬 XP 扫雷：初级 9×9/10 雷、中级 16×16/40 雷、高级 30×16/99 雷。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const M = (SD.Mines = SD.Mines || {});
  const U = SD.Util;

  const LEVELS = [
    { id: 'beginner', name: '初级', w: 9, h: 9, mines: 10, star: 1 },
    { id: 'intermediate', name: '中级', w: 16, h: 16, mines: 40, star: 2 },
    { id: 'expert', name: '高级', w: 30, h: 16, mines: 99, star: 4 },
  ];
  const LEVEL_ORDER = LEVELS.map((l) => l.id);

  /** 自定义盘面的边界。上限跟着 XP 走：30 列 24 行。 */
  const CUSTOM = { minW: 5, maxW: 30, minH: 5, maxH: 24 };

  function levelById(id) {
    for (const l of LEVELS) if (l.id === id) return l;
    return null;
  }

  /** 至少留一格不布雷，否则首点必安全就没地方放了 */
  const maxMines = (w, h) => Math.max(1, w * h - 1);

  const normalizeMines = (w, h, mines) =>
    U.clamp(Math.round(Number(mines) || 1), 1, maxMines(w, h));

  const randomSeed = () =>
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  /** 每个格子的邻居表。棋盘建一次就固定，之后所有遍历都查它。 */
  function buildNeighbors(w, h) {
    const out = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const list = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            list.push(ny * w + nx);
          }
        }
        out[y * w + x] = Int16Array.from(list);
      }
    }
    return out;
  }

  function create(w, h, mines, seed) {
    const n = w * h;
    return {
      w: w,
      h: h,
      mines: normalizeMines(w, h, mines),
      // 种子决定布雷。存下来是为了存档能原样复原，也为了每日挑战可复现。
      seed: seed === undefined || seed === null ? randomSeed() : String(seed),
      mine: new Uint8Array(n),
      open: new Uint8Array(n),
      flag: new Uint8Array(n),
      num: new Int8Array(n),
      nbr: buildNeighbors(w, h),
      placed: false,
      state: 'ready',        // ready | playing | won | lost
      opened: 0,
      flags: 0,
      boom: -1,
      elapsed: 0,
      dailyKey: null,
    };
  }

  /**
   * 布雷。首点必安全是 XP 的规则：第一次点到哪，那一格连同周围 8 格都不放雷，
   * 保证开局不会一点就炸。
   *
   * 首点位置参与播种——安全区跟着首点走，不这样的话同一颗种子换一格点会得到
   * 同一张图，而那张图的首点未必安全。
   */
  function placeMines(b, safeIndex) {
    const n = b.w * b.h;
    const rng = U.makeRng(b.seed + '|' + safeIndex);
    const blocked = new Uint8Array(n);
    blocked[safeIndex] = 1;
    // 雷太密时 9 格安全区装不下，退到只保证首点本身
    if (b.mines <= n - 9) for (const j of b.nbr[safeIndex]) blocked[j] = 1;
    const pool = [];
    for (let i = 0; i < n; i++) if (!blocked[i]) pool.push(i);
    U.shuffle(pool, rng);
    for (let k = 0; k < b.mines && k < pool.length; k++) b.mine[pool[k]] = 1;
    computeNumbers(b);
    b.placed = true;
  }

  /** 每格的周围雷数。雷没布之前是 0，布完再调一次。 */
  function computeNumbers(b) {
    for (let i = 0; i < b.w * b.h; i++) {
      let c = 0;
      for (const j of b.nbr[i]) if (b.mine[j]) c++;
      b.num[i] = c;
    }
  }

  const isOver = (b) => b.state === 'won' || b.state === 'lost';
  const remaining = (b) => b.mines - b.flags;
  const at = (b, x, y) => y * b.w + x;

  /** 一片空白自动摊开。旗子会挡住扩散，这是 XP 的行为。 */
  function flood(b, start) {
    const out = [];
    const stack = [start];
    while (stack.length) {
      const i = stack.pop();
      if (b.open[i] || b.flag[i]) continue;
      b.open[i] = 1;
      b.opened++;
      out.push(i);
      if (b.num[i] === 0) {
        for (const j of b.nbr[i]) if (!b.open[j] && !b.flag[j]) stack.push(j);
      }
    }
    return out;
  }

  function checkWin(b) {
    if (b.state !== 'playing') return false;
    if (b.opened !== b.w * b.h - b.mines) return false;
    b.state = 'won';
    // 赢了把剩下的雷自动插旗，省得玩家再点一遍
    for (let i = 0; i < b.w * b.h; i++) {
      if (b.mine[i] && !b.flag[i]) { b.flag[i] = 1; b.flags++; }
    }
    return true;
  }

  /**
   * 翻开一格。首点会先布雷。
   * 返回值里 changed 是这次真正翻开的格子，UI 只需要重画这些。
   */
  function open(b, i) {
    const n = b.w * b.h;
    if (isOver(b) || i < 0 || i >= n) return { changed: [], ok: false };
    if (b.open[i] || b.flag[i]) return { changed: [], ok: false };
    if (!b.placed) placeMines(b, i);
    if (b.state === 'ready') b.state = 'playing';
    if (b.mine[i]) {
      b.state = 'lost';
      b.boom = i;
      b.open[i] = 1;
      b.opened++;
      return { changed: [i], boom: i, ok: true };
    }
    const changed = flood(b, i);
    return { changed: changed, won: checkWin(b), ok: true };
  }

  function toggleFlag(b, i) {
    const n = b.w * b.h;
    if (isOver(b) || i < 0 || i >= n || b.open[i]) return false;
    b.flag[i] = b.flag[i] ? 0 : 1;
    b.flags += b.flag[i] ? 1 : -1;
    return true;
  }

  /**
   * 双击（或左右键同按）：已翻开的数字格，周围旗数正好等于数字时，
   * 把其余未开格一起翻开。
   *
   * 旗插错了照样会炸——这是 XP 的行为，不额外拦。拦下来等于替玩家兜底，
   * 而「双击前先确认旗插对了」本身就是扫雷的一部分。
   */
  function chord(b, i) {
    const n = b.w * b.h;
    if (b.state !== 'playing' || i < 0 || i >= n) return { changed: [], ok: false };
    if (!b.open[i] || b.num[i] <= 0) return { changed: [], ok: false };
    let flags = 0;
    const targets = [];
    for (const j of b.nbr[i]) {
      if (b.flag[j]) flags++;
      else if (!b.open[j]) targets.push(j);
    }
    if (flags !== b.num[i] || !targets.length) return { changed: [], ok: false };

    const changed = [];
    let boom = -1;
    for (const j of targets) {
      if (b.mine[j]) {
        b.open[j] = 1;
        b.opened++;
        b.boom = j;
        b.state = 'lost';
        boom = j;
        changed.push(j);
        break;
      }
      for (const k of flood(b, j)) changed.push(k);
    }
    if (boom < 0) checkWin(b);
    return { changed: changed, boom: boom, ok: true, chord: true };
  }

  /** 输掉之后把所有雷摊出来给玩家看 */
  function revealMines(b) {
    const out = [];
    for (let i = 0; i < b.w * b.h; i++) if (b.mine[i]) out.push(i);
    return out;
  }

  /**
   * 每日挑战的首点：由种子决定，玩家点不点都是它。
   * 这样整张图完全由种子决定，「同一天全世界同一道题」才成立——
   * 普通对局的首点是玩家自己选的，同一颗种子换个首点就是另一张图。
   */
  function seedFirstClick(b) {
    return Math.floor(U.makeRng(b.seed + '|first')() * b.w * b.h);
  }

  /* ---------------- 演示夹具 ----------------
   * 有几条规则在随机对局里极少出现（单格「已够数」、全局雷数），
   * 光靠随机搜索凑不出教程示例，所以把局面手工摆出来。
   * 放在 core 而不是教程里：单元测试也要用同一份，免得两处各画一遍、慢慢画岔。
   */
  function fixtureBoard(w, h, mines, seed) {
    const b = create(w, h, mines, seed);
    b.placed = true;
    b.state = 'playing';
    return b;
  }

  /** 数字周围该放的雷已经全插上旗了 → 剩下的未知格安全 */
  function fixtureSingleSafe() {
    const W = 5;
    const b = fixtureBoard(W, 5, 2, 'fixture-single-safe');
    b.mine[0] = 1;
    b.mine[W] = 1;
    computeNumbers(b);
    for (let i = 0; i < W * 5; i++) b.open[i] = 1;
    b.open[0] = 0;
    b.open[W] = 0;
    b.open[2 * W] = 0;
    b.opened = W * 5 - 3;
    toggleFlag(b, 0);
    toggleFlag(b, W);
    return b;
  }

  /** 剩余雷数正好等于未开格数 → 剩下的全是雷 */
  function fixtureGlobalMine() {
    const W = 5;
    const b = fixtureBoard(W, 5, 4, 'fixture-global-mine');
    const corner = [0, 1, W, W + 1];
    for (const i of corner) b.mine[i] = 1;
    computeNumbers(b);
    for (let i = 0; i < W * 5; i++) b.open[i] = 1;
    for (const i of corner) b.open[i] = 0;
    b.opened = W * 5 - 4;
    return b;
  }

  /** 雷全插上旗了 → 剩下的未知格全安全 */
  function fixtureGlobalSafe() {
    const W = 5;
    const b = fixtureBoard(W, 5, 1, 'fixture-global-safe');
    b.mine[0] = 1;
    computeNumbers(b);
    for (let i = 0; i < W * 5; i++) b.open[i] = 1;
    b.open[0] = 0;
    b.open[W * 5 - 2] = 0;
    b.open[W * 5 - 1] = 0;
    b.num[0] = 1;
    b.opened = W * 5 - 3;
    toggleFlag(b, 0);
    return b;
  }

  /**
   * 1-2-1：横排三个未知格 A B C，上面三格数字是 1、2、1。
   *   A+B=1、A+B+C=2、B+C=1  →  A、C 是雷，B 安全。
   * 这是子集规则最经典的形状。
   */
  function fixtureSubset121() {
    const W = 7;
    const b = fixtureBoard(W, 7, 2, 'fixture-subset-121');
    const A = 3 * W + 2;
    const B = 3 * W + 3;
    const C = 3 * W + 4;
    b.mine[A] = 1;
    b.mine[C] = 1;
    computeNumbers(b);
    // 除了三个关键数字格，其余已翻开格一律写 0，免得掺进别的约束、把结论来源搞混
    for (let i = 0; i < W * 7; i++) { b.open[i] = 1; b.num[i] = 0; }
    b.open[A] = 0;
    b.open[B] = 0;
    b.open[C] = 0;
    b.num[2 * W + 2] = 1;   // 只看得到 A、B
    b.num[2 * W + 3] = 2;   // 看得到 A、B、C
    b.num[2 * W + 4] = 1;   // 只看得到 B、C
    b.opened = W * 7 - 3;
    return b;
  }

  const bitsToString = (arr) => {
    let s = '';
    for (let i = 0; i < arr.length; i++) s += arr[i] ? '1' : '0';
    return s;
  };
  const stringToBits = (s, n, Type) => {
    const out = new Type(n);
    for (let i = 0; i < n; i++) out[i] = s && s.charCodeAt(i) === 49 ? 1 : 0;
    return out;
  };

  /** 存档用。数组拼成字符串，读回来一模一样，不靠重放操作。 */
  function serialize(b) {
    return {
      w: b.w, h: b.h, mines: b.mines, seed: b.seed,
      mine: bitsToString(b.mine), open: bitsToString(b.open), flag: bitsToString(b.flag),
      placed: b.placed, state: b.state, opened: b.opened, flags: b.flags,
      boom: b.boom, elapsed: b.elapsed, dailyKey: b.dailyKey || null,
    };
  }

  function deserialize(o) {
    if (!o || !o.w || !o.h) return null;
    const n = o.w * o.h;
    const b = create(o.w, o.h, o.mines, o.seed);
    b.mine = stringToBits(o.mine, n, Uint8Array);
    b.open = stringToBits(o.open, n, Uint8Array);
    b.flag = stringToBits(o.flag, n, Uint8Array);
    b.placed = !!o.placed;
    b.state = o.state || 'ready';
    b.opened = o.opened || 0;
    b.flags = o.flags || 0;
    b.boom = typeof o.boom === 'number' ? o.boom : -1;
    b.elapsed = o.elapsed || 0;
    b.dailyKey = o.dailyKey || null;
    computeNumbers(b);
    return b;
  }

  M.LEVELS = LEVELS;
  M.LEVEL_ORDER = LEVEL_ORDER;
  M.CUSTOM = CUSTOM;
  M.levelById = levelById;
  M.maxMines = maxMines;
  M.normalizeMines = normalizeMines;
  M.randomSeed = randomSeed;
  M.create = create;
  M.placeMines = placeMines;
  M.computeNumbers = computeNumbers;
  M.open = open;
  M.chord = chord;
  M.toggleFlag = toggleFlag;
  M.flood = flood;
  M.revealMines = revealMines;
  M.seedFirstClick = seedFirstClick;
  M.isOver = isOver;
  M.remaining = remaining;
  M.at = at;
  M.serialize = serialize;
  M.deserialize = deserialize;
  M.fixtures = {
    singleSafe: fixtureSingleSafe,
    globalSafe: fixtureGlobalSafe,
    globalMine: fixtureGlobalMine,
    subset121: fixtureSubset121,
  };
})(window);
