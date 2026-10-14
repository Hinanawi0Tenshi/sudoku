/* 华容道 · 模型、求解器与出题单元测试（node tests/klotski-test.js）
 *
 * 这个游戏最值得盯的两条：
 *   1. **局面键必须按形状而不是块身份**——四个卒互换、两个竖块互换，对玩家是同一个
 *      局面。不合并的话状态数会白翻好几倍，而且"提示最优"的验证也会失准。
 *   2. **提示必须真的最优**——全状态表在手，这里不存在"算不动"，说最优就得是最优。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
for (const f of [
  'js/platform/07-util.js',
  'js/games/klotski/01-core.js',
  'js/games/klotski/02-solver.js',
  'js/games/klotski/03-generator.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const K = SD.Klotski;
const U = SD.Util;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------------- 1. 棋盘模型 ---------------- */

section('1. 棋盘模型');

{
  const b = K.create();
  ok('10 块（曹操 + 4 竖 + 1 横 + 4 卒）', b.pieces.length === 10, b.pieces.length + ' 块');
  ok('经典开局曹操在 (0,1)', b.pieces[0].r === 0 && b.pieces[0].c === 1);
  ok('经典开局不是终局', !K.isSolved(b));
  ok('盘面 20 格', b.grid.length === 20);

  // 格子图要和块的位置一致
  let mismatch = 0;
  for (let i = 0; i < b.pieces.length; i++) {
    const p = b.pieces[i];
    for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) {
      if (b.grid[(p.r + dr) * 4 + p.c + dc] !== i) mismatch++;
    }
  }
  ok('格子图和块位置一致', mismatch === 0, mismatch + ' 格对不上');

  // 空格正好两格
  ok('空格正好两格', Array.from(b.grid).filter((v) => v === K.EMPTY).length === 2);
}

{
  // 边界与碰撞
  const b = K.create();
  ok('曹操开局不能往上（出界）', !K.canShift(b, 0, -1, 0));
  ok('曹操开局不能往右（被赵云挡）', !K.canShift(b, 0, 0, 1));
  ok('曹操开局不能往下（被关羽挡）', !K.canShift(b, 0, 1, 0));
  const before = b.moves;
  ok('走不动时 shift 返回 false', K.shift(b, 0, 0, 1) === false);
  ok('走不动不算步数', b.moves === before);
}

{
  // 曹操到 (3,1) 就是赢
  const b = K.create();
  b.pieces[0].r = 3; b.pieces[0].c = 1;
  K.rebuild(b);
  ok('曹操到 (3,1) 判胜', K.isSolved(b));
  b.pieces[0].c = 0;
  ok('曹操在 (3,0) 不算胜', !K.isSolved(b));
}

/* ---------------- 2. 局面键 ---------------- */

section('2. 局面键');

{
  const b = K.create();
  const key0 = K.keyOf(b.pieces);

  // 互换两个卒：位置合法，对玩家是同一个局面，键必须一样
  const soldiers = [];
  for (let i = 0; i < b.pieces.length; i++) if (b.pieces[i].type === K.TYPES.S) soldiers.push(i);
  ok('有四个卒', soldiers.length === 4, soldiers.length + ' 个');
  const a = b.pieces[soldiers[0]], c = b.pieces[soldiers[1]];
  const ar = a.r, ac = a.c;
  a.r = c.r; a.c = c.c; c.r = ar; c.c = ac;
  ok('互换两个卒后局面键不变', K.keyOf(b.pieces) === key0);

  // 互换两个竖块同理
  const vs = [];
  for (let i = 0; i < b.pieces.length; i++) if (b.pieces[i].type === K.TYPES.V) vs.push(i);
  ok('有四个竖块', vs.length === 4, vs.length + ' 个');
  const d = b.pieces[vs[0]], e = b.pieces[vs[1]];
  const dr = d.r, dc2 = d.c;
  d.r = e.r; d.c = e.c; e.r = dr; e.c = dc2;
  ok('互换两个竖块后局面键不变', K.keyOf(b.pieces) === key0);

  // 把曹操挪一格，键必须变
  const f = K.create();
  f.pieces[0].c = 2; K.rebuild(f);
  ok('曹操挪一格后局面键变了', K.keyOf(f.pieces) !== key0);
}

/* ---------------- 3. 求解器 ---------------- */

section('3. 求解器');

{
  const t0 = Date.now();
  const t = K.solver.buildTable();
  const ms = Date.now() - t0;
  ok('建表在 1 秒内', ms < 1000, ms + 'ms');
  ok('可达状态上万', t.dist.size > 10000, t.dist.size + ' 个');
  ok('目标态有多个', t.goalCount > 100, t.goalCount + ' 个');
  console.log('  可达 ' + t.reachable + '，目标态 ' + t.goalCount + '，最远 ' + t.maxDist + ' 步，建表 ' + ms + 'ms');
}

{
  // 经典「横刀立马」公认是 116 步（按走一格算一步）
  const d = K.solver.distanceOf(K.create().pieces);
  ok('经典「横刀立马」= 116 步', d === 116, d + ' 步');
}

{
  // 核心性质：提示给的那一步走完，剩余距离必须正好减一
  const t = K.solver.buildTable();
  const rng = U.makeRng('hint-prop');
  let bad = 0, checked = 0, noMove = 0;
  for (let s = 0; s < 400; s++) {
    const pos = t.states[Math.floor(rng() * t.states.length)];
    const b = K.create(K.solver.piecesOf(pos, t.shapes));
    const d = K.solver.distanceOf(b.pieces);
    if (d <= 0) continue;
    const m = K.solver.bestMove(b);
    checked++;
    if (!m) { noMove++; continue; }
    K.shift(b, m.index, m.dr, m.dc);
    if (K.solver.distanceOf(b.pieces) !== d - 1) bad++;
  }
  ok('提示走完剩余距离正好减一', bad === 0, bad + '/' + checked + ' 次不对');
  ok('每个非终局都有提示', noMove === 0, noMove + ' 次没有');
  console.log('  验了 ' + checked + ' 个局面');
}

{
  // 沿提示一路走，步数必须正好等于初始距离
  let bad = 0;
  for (let s = 0; s < 30; s++) {
    const b = K.generate(['easy', 'medium', 'hard', 'expert', 'master'][s % 5], 'walk-' + s);
    const d = b.distance;
    let n = 0;
    const g = K.create(b.pieces.map((p) => ({ type: p.type, name: p.name, w: p.w, h: p.h, r: p.r, c: p.c })));
    while (!K.isSolved(g) && n < 400) {
      const m = K.solver.bestMove(g);
      if (!m) break;
      K.shift(g, m.index, m.dr, m.dc);
      n++;
    }
    if (!K.isSolved(g) || n !== d) bad++;
  }
  ok('沿提示走到底的步数 = 标注的最少步数', bad === 0, bad + '/30 局不对');
}

/* ---------------- 4. 出题 ---------------- */

section('4. 出题');

{
  ok('五个档位', K.LEVELS.length === 5, K.LEVELS.map((l) => l.id).join(','));
  ok('区间递增', K.LEVELS.every((l, i) => i === 0 || l.min > K.LEVELS[i - 1].min));
  const sizes = K.poolSizes();
  let empty = 0;
  for (const lv of K.LEVELS) if (!sizes[lv.id]) empty++;
  ok('每个档位都有出题池', empty === 0, JSON.stringify(sizes));
  console.log('  出题池: ' + JSON.stringify(sizes));

  let outOfRange = 0, dup = 0;
  const seen = new Set();
  for (const lv of K.LEVELS) {
    for (let s = 0; s < 10; s++) {
      const b = K.generate(lv.id, 'gen-' + lv.id + '-' + s);
      if (!b) { outOfRange++; continue; }
      if (b.distance < lv.min || b.distance > lv.max) outOfRange++;
      const key = K.keyOf(b.pieces);
      if (seen.has(key)) dup++;
      seen.add(key);
      if (b.state !== 'playing' || b.moves !== 0) outOfRange++;
    }
  }
  ok('出的题距离都落在档位区间内', outOfRange === 0, outOfRange + ' 局越界');
  ok('同档不同种子出的题不重复', dup === 0, dup + ' 次重复');

  // 同一种子必须出同一道题
  const a1 = K.generate('hard', 'same-seed');
  const a2 = K.generate('hard', 'same-seed');
  ok('同种子出同一道题', K.keyOf(a1.pieces) === K.keyOf(a2.pieces));
}

/* ---------------- 汇总 ---------------- */

console.log('\n================================');
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
