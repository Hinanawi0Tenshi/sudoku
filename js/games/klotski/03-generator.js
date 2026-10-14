/* 华容道 · 出题
 *
 * 别处出题都要「切、验、评级」三步，这里一步都不用：全状态表已经算好了每个局面
 * 离目标几步，所以**出题就是按距离筛一个局面出来**。难度是精确值，不是估的。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const K = (SD.Klotski = SD.Klotski || {});

  /** 距离区间按单步计数。经典「横刀立马」是 116 步，属于最高档。 */
  const LEVELS = [
    { id: 'easy',   name: '入门', min: 8,   max: 24,  star: 1, points: 8 },
    { id: 'medium', name: '简单', min: 25,  max: 45,  star: 2, points: 18 },
    { id: 'hard',   name: '中等', min: 46,  max: 70,  star: 3, points: 35 },
    { id: 'expert', name: '困难', min: 71,  max: 95,  star: 4, points: 60 },
    { id: 'master', name: '大师', min: 96,  max: 999, star: 5, points: 100 },
  ];
  const byId = (id) => LEVELS.find((l) => l.id === id) || null;

  // 每个档位的候选下标只算一次——建表后表就不变了
  const pools = {};
  function poolOf(lv) {
    if (pools[lv.id]) return pools[lv.id];
    const t = K.solver.buildTable();
    const out = [];
    for (let i = 0; i < t.states.length; i++) {
      if (t.dq[i] >= lv.min && t.dq[i] <= lv.max) out.push(i);
    }
    pools[lv.id] = out;
    return out;
  }

  /**
   * 出一局。
   * @returns {object|null} 棋盘；该档位一个局面都没有时返回 null
   */
  function generate(levelId, seed) {
    const lv = byId(levelId) || LEVELS[0];
    const pool = poolOf(lv);
    if (!pool.length) return null;
    const t = K.solver.buildTable();
    const rng = SD.Util.makeRng(seed === undefined || seed === null
      ? String(Date.now()) + '-' + Math.random()
      : 'klotski|' + seed);
    const idx = pool[Math.floor(rng() * pool.length)];
    const b = K.create(K.solver.piecesOf(t.states[idx], t.shapes));
    b.level = lv.id;
    b.distance = t.dq[idx];
    b.seed = seed === undefined || seed === null ? null : String(seed);
    b.state = 'playing';
    return b;
  }

  /** 各档位各有多少局面——出题池子够不够大，一眼能看出来 */
  function poolSizes() {
    const out = {};
    for (const lv of LEVELS) out[lv.id] = poolOf(lv).length;
    return out;
  }

  K.LEVELS = LEVELS;
  K.byId = byId;
  K.generate = generate;
  K.poolSizes = poolSizes;
})(window);
