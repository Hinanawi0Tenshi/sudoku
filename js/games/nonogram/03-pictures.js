/* 数织 · 图库
 *
 * 数织和别的品类有个根本区别：**题目不是生成出来的，是先有画、再读线索**。
 * 所以"画从哪来"是这个品类最核心的问题。这里用的是三条来源里最稳的一条：
 * 内置图库——每张图都离线验过（唯一解 + 纯逻辑可解），不会出现"画了半天发现推不出来"。
 *
 * 图分两类：
 *   · 几何图形用公式画（爱心/星星/圆环…），任意尺寸都能生成，形状不会走样
 *   · 具体物件手绘成字符画（房子/树/猫…），公式画不出"像"的东西
 *
 * 字符画里 '#' 是实心，其余都算空。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  /* ---------------- 公式图形 ---------------- */

  /** 逐格调用 fn(x, y)，x/y 归一化到 [-1,1]（y 向上为正），返回 true 就是实心 */
  function mask(w, h, fn) {
    const rows = [];
    for (let r = 0; r < h; r++) {
      let s = '';
      for (let c = 0; c < w; c++) {
        const x = ((c + 0.5) / w) * 2 - 1;
        const y = 1 - ((r + 0.5) / h) * 2;
        s += fn(x, y) ? '#' : '.';
      }
      rows.push(s);
    }
    return rows;
  }

  /**
   * 爱心用「两个圆 + 一个三角」拼，不用那条心形曲线。
   * 曲线在低分辨率下顶部的凹口几乎看不出来，10×10 画出来是个圆疙瘩；
   * 几何拼法在 5×5 都不会走样。
   */
  const heart = (w, h) => mask(w, h, (x, y) => {
    const px = (x + 1) / 2 * w, py = (1 - y) / 2 * h;
    const cx = w / 2, lobeY = h * 0.27, r = Math.min(w * 0.22, h * 0.24);
    // 两个圆要"刚好不相交"：半径小一点、间距大一点，顶部中间的凹口才够深。
    // 第一版两个圆挨得太近，凹口只有一行，看着像个圆疙瘩。
    const dx0 = w * 0.29;
    for (const sx of [-1, 1]) {
      const dx = px - (cx + sx * dx0), dy = py - lobeY;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    const ty = py - lobeY;
    const span = h - lobeY;
    if (ty >= 0 && ty <= span) {
      const halfW = (1 - ty / span) * (cx - 0.5);
      if (Math.abs(px - cx) <= halfW) return true;
    }
    return false;
  });

  /** 多边形内点判定（射线法） */
  function inPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 五角星 */
  function star(w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - 0.2;
    const poly = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 === 0 ? R : R * 0.42;
      poly.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return mask(w, h, (x, y) => inPoly((x + 1) / 2 * w, (y + 1) / 2 * h, poly));
  }

  // 环要够粗。细环在 15×15 上会产生两个解（内外两条线索分不开），实测踩过。
  const ring = (w, h) => mask(w, h, (x, y) => {
    const d = Math.sqrt(x * x + y * y);
    return d <= 0.95 && d >= 0.42;
  });

  const diamond = (w, h) => mask(w, h, (x, y) => Math.abs(x) * 1.15 + Math.abs(y) <= 1);

  // 上尖下宽的等腰三角：半宽随高度线性收窄。第一版把条件写反了，画出来是个窄条。
  const triangle = (w, h) => mask(w, h, (x, y) => y <= 0.92 && Math.abs(x) <= ((1 - y) / 2) * 1.02);

  const cross = (w, h) => mask(w, h, (x, y) => Math.abs(x) <= 0.32 || Math.abs(y) <= 0.32);

  const arrow = (w, h) => mask(w, h, (x, y) => {
    if (y >= 0.1) return Math.abs(x) <= (1 - y) / 0.9 * 0.85;
    return Math.abs(x) <= 0.28;
  });

  // 正六边形：上下各一条斜边，中间是直边。原来的公式画出来是个圆角矩形。
  const hexagon = (w, h) => mask(w, h, (x, y) => {
    const ay = Math.abs(y);
    if (ay > 0.88) return false;
    const limit = ay <= 0.42 ? 1 : 1 - (ay - 0.42) / 0.46;
    return Math.abs(x) <= limit * 0.98;
  });

  /** 斜叉：两条对角线 */
  const diag = (w, h) => mask(w, h, (x, y) => Math.abs(Math.abs(x) - Math.abs(y)) <= 0.20);

  /* ---------------- 手绘字符画 ---------------- */

  const ART = {
    house: ['....##....', '...####...', '..######..', '.########.', '##########', '##########',
            '.##....##.', '.##.##.##.', '.##.##.##.', '.##....##.'],
    tree:  ['....##....', '...####...', '..######..', '.########.', '##########', '..######..',
            '...####...', '....##....', '....##....', '....##....'],
    cat:   ['.##....##.', '.##....##.', '##########', '##########', '#.#....#.#', '##########',
            '##.####.##', '##########', '.########.', '..######..'],
    mush:  ['..######..', '.########.', '##########', '##########', '##########', '...####...',
            '...####...', '...####...', '...####...', '...####...'],
    boat:  ['....##....', '...###....', '..####....', '.#####....', '.#####....', '##########',
            '##########', '.########.', '..######..', '...####...'],
    apple: ['.....#....', '....##....', '..#####...', '.#######..', '#########.', '#########.',
            '#########.', '.#######..', '..#####...', '...###....'],
    crown: ['#..#..#..#', '##.##.##.#', '##########', '##########', '##########', '.########.',
            '..######..', '...####...', '..........', '..........'],
    smile: ['..######..', '.########.', '##########', '##.####.##', '##.####.##', '##########',
            '##......##', '###....###', '.########.', '..######..'],
    // 钥匙试过两版：细杆 + 稀疏的齿、空心圆头，都因为线索太弱出现两个解。
    // 改成实心头 + 粗杆 + 一个明显的齿才过验。
    key:   ['..####....', '.######...', '########..', '########..', '.######...', '..####....',
            '...###....', '...###....', '...#####..', '...###....'],
    mug:   ['..........', '########..', '########.#', '#......#.#', '#......#.#', '#......#.#',
            '#......#.#', '#......#..', '########..', '.######...'],
  };

  const SMALL = {
    smallCross: ['..#..', '..#..', '#####', '..#..', '..#..'],
    smallHeart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
    smallTree:  ['..#..', '.###.', '#####', '..#..', '..#..'],
    smallHouse: ['..#..', '.###.', '#####', '#.#.#', '#.#.#'],
    smallArrow: ['..#..', '.###.', '#####', '..#..', '..#..'],
  };

  /* ---------------- 组装图库 ---------------- */

  const list = [];
  function add(id, name, rows, tag) {
    list.push({ id: id, name: name, w: rows[0].length, h: rows.length, rows: rows, tag: tag || '' });
  }

  // 5×5 入门
  for (const k of Object.keys(SMALL)) add(k, k.replace('small', '小'), SMALL[k], '5');

  // 10×10 手绘物件
  const ART_NAME = {
    house: '小房子', tree: '树', cat: '猫脸', mush: '蘑菇', boat: '帆船',
    apple: '苹果', crown: '皇冠', smile: '笑脸', key: '钥匙', mug: '杯子',
  };
  for (const k of Object.keys(ART)) add(k, ART_NAME[k], ART[k], '10');

  // 10×10 公式图形
  add('heart10', '爱心', heart(10, 10), '10');
  add('star10', '五角星', star(10, 10), '10');
  add('ring10', '圆环', ring(10, 10), '10');
  add('diamond10', '菱形', diamond(10, 10), '10');
  add('triangle10', '三角', triangle(10, 10), '10');
  add('cross10', '十字', cross(10, 10), '10');
  add('arrow10', '箭头', arrow(10, 10), '10');
  add('hexagon10', '六边形', hexagon(10, 10), '10');

  // 15×15 大图
  add('heart15', '大爱心', heart(15, 15), '15');
  add('star15', '大五角星', star(15, 15), '15');
  add('ring15', '大圆环', ring(15, 15), '15');
  add('hexagon15', '大六边形', hexagon(15, 15), '15');
  add('arrow15', '大箭头', arrow(15, 15), '15');
  add('triangle15', '大三角', triangle(15, 15), '15');
  add('diamond15', '大菱形', diamond(15, 15), '15');
  add('cross15', '大十字', cross(15, 15), '15');

  // 20×20 更大、更稀疏的图形。稀疏的大图线索弱，往往纯行列推理推不完，
  // 正好当最高档——「必须靠假设」那档需要有货。
  add('star20', '巨型五角星', star(20, 20), '20');
  add('arrow20', '巨型箭头', arrow(20, 20), '20');
  add('diamond20', '巨型菱形', diamond(20, 20), '20');
  add('ring20', '巨型圆环', ring(20, 20), '20');
  add('triangle20', '巨型三角', triangle(20, 20), '20');
  add('hexagon20', '巨型六边形', hexagon(20, 20), '20');
  add('cross20', '巨型十字', cross(20, 20), '20');
  add('heart20', '巨型爱心', heart(20, 20), '20');
  add('diag15', '斜叉', diag(15, 15), '15');
  add('diag20', '大斜叉', diag(20, 20), '20');

  const byId = (id) => list.find((p) => p.id === id) || null;
  const bySize = (n) => list.filter((p) => p.w === n && p.h === n);

  N.pictures = list;
  N.picById = byId;
  N.picBySize = bySize;
  N.generators = { mask: mask, heart: heart, star: star, ring: ring, diamond: diamond,
    triangle: triangle, cross: cross, arrow: arrow, hexagon: hexagon, inPoly: inPoly };
})(window);
