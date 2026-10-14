/* 数织 · 出题与评级
 *
 * 出题和别的品类**反过来**：不是"生成一道题"，而是"挑一张图 + 验它能不能当题"。
 * 图库里每张图都离线验过唯一解，但"唯一解"不等于"推得出来"——
 * 五角星就是唯一解却必须靠假设。所以评级看的是**推演过程**，不是图本身。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  /** 缓存：一张图的评级只算一次 */
  const rated = new Map();

  /**
   * 给一张图评级。
   *   line   纯靠行列推理能不能推完——能的话就是"数织的简单/中等"
   *   rounds 传播了多少轮；轮数越多，越绕
   *   guess  推不完时还剩几格要假设
   */
  function rate(pic) {
    if (rated.has(pic.id)) return rated.get(pic.id);
    const b = N.create(pic);
    const pr = N.propagate(b.clues, b.w, b.h);
    const uniq = N.countSolutions(b.clues, b.w, b.h, 2);
    const line = !pr.contradiction && !pr.stuck;
    // 星级按**尺寸**定，不按传播轮数——轮数在不同尺寸之间没有可比性
    // （实测 10×10 最多 5 轮、20×20 也就 6 轮，用它分档会出现空档）。
    let star;
    if (!line) star = 5;                        // 必须靠假设才推得出来
    else if (pic.w <= 5) star = 1;
    else if (pic.w <= 10) star = 2;
    else if (pic.w <= 15) star = 3;
    else star = 4;
    const r = {
      id: pic.id, name: pic.name, size: pic.w, line: line,
      rounds: pr.steps, unknown: pr.unknown || 0, unique: uniq === 1, star: star,
    };
    rated.set(pic.id, r);
    return r;
  }

  const LEVELS = [
    { id: 'easy',   name: '入门', desc: '5×5，一眼能看出画的什么', want: (r) => r.size <= 5,                 points: 6 },
    { id: 'medium', name: '简单', desc: '10×10，纯推理',          want: (r) => r.size === 10 && r.line,     points: 18 },
    { id: 'hard',   name: '中等', desc: '15×15',                 want: (r) => r.size === 15 && r.line,     points: 35 },
    { id: 'expert', name: '困难', desc: '20×20，耐心活',          want: (r) => r.size >= 20 && r.line,      points: 60 },
    { id: 'master', name: '大师', desc: '光靠行列推不完，得假设',  want: (r) => !r.line,                     points: 100 },
  ];
  const byId = (id) => LEVELS.find((l) => l.id === id) || null;

  /** 某一档有哪些图——建一次缓存住 */
  const pools = {};
  function poolOf(lv) {
    if (pools[lv.id]) return pools[lv.id];
    pools[lv.id] = N.pictures.filter((p) => lv.want(rate(p)));
    return pools[lv.id];
  }

  function generate(levelId, seed) {
    const lv = byId(levelId) || LEVELS[0];
    const pool = poolOf(lv);
    if (!pool.length) return null;
    const rng = SD.Util.makeRng(seed === undefined || seed === null
      ? String(Date.now()) + '-' + Math.random()
      : 'nonogram|' + seed);
    const pic = pool[Math.floor(rng() * pool.length)];
    const b = N.create(pic);
    b.level = lv.id;
    b.rating = rate(pic);
    b.seed = seed === undefined || seed === null ? null : String(seed);
    return b;
  }

  const poolSizes = () => {
    const out = {};
    for (const lv of LEVELS) out[lv.id] = poolOf(lv).length;
    return out;
  };

  N.LEVELS = LEVELS;
  N.byId = byId;
  N.rate = rate;
  N.generate = generate;
  N.poolSizes = poolSizes;
})(window);
