/* 数字华容道 · 模型与求解器单元测试（node tests/slide-test.js）
 *
 * 最重要的一条是性质测试：**提示给出的那一块必须真的能滑**。
 * 提示里点「走这一步」走不动的话，比不给提示更糟。
 * 另一条是「打乱后必然有解」——这是倒着走的做法唯一要守住的性质。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
for (const f of [
  'js/platform/07-util.js',
  'js/games/slide/01-core.js',
  'js/games/slide/02-solver.js',
  'js/games/slide/03-hints.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const S = SD.Slide;
const U = SD.Util;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------------- 1. 关卡定义 ---------------- */

section('1. 关卡定义');

{
  ok('三档难度都在', S.LEVELS.length === 3, S.LEVELS.map((l) => l.id).join(','));
  ok('尺寸递增', S.LEVELS[0].n < S.LEVELS[1].n && S.LEVELS[1].n < S.LEVELS[2].n);
  ok('打乱步数递增', S.LEVELS[0].scramble < S.LEVELS[1].scramble && S.LEVELS[1].scramble < S.LEVELS[2].scramble);
  ok('点数递增', S.LEVELS[0].points < S.LEVELS[1].points && S.LEVELS[1].points < S.LEVELS[2].points);
  ok('byId 找得到', S.byId('n4') && S.byId('n4').n === 4);
  ok('byId 找不到返回 null', S.byId('nope') === null);
}

/* ---------------- 2. 棋盘规则 ---------------- */

section('2. 棋盘规则');

{
  const b = S.create(3);
  ok('新建就是终局', S.solved(b));
  ok('空格在右下角', b.empty === 8, 'empty=' + b.empty);
  ok('数字是 1..8', Array.from(b.cells).join(',') === '1,2,3,4,5,6,7,8,0');

  // 空格在 8，只有 5（下标7）和 7（下标5）能滑进来
  ok('相邻的能滑', S.canMove(b, 7) && S.canMove(b, 5));
  ok('不相邻的不能滑', !S.canMove(b, 0) && !S.canMove(b, 4) && !S.canMove(b, 3));

  S.move(b, 7);
  ok('滑完空格跟着走', b.empty === 7, 'empty=' + b.empty);
  ok('滑完不再是终局', !S.solved(b));
  ok('步数记上了', b.moves === 1, 'moves=' + b.moves);
  ok('状态从 ready 变 playing', b.state === 'playing', b.state);
  ok('滑完那块换到空格原处', b.cells[8] === 8, 'cells[8]=' + b.cells[8]);

  ok('滑不动的返回 false', S.move(b, 0) === false);
  ok('滑不动时步数不变', b.moves === 1);

  S.reset(b);
  ok('reset 回到终局', S.solved(b) && b.moves === 0);
}

/* ---------------- 3. 打乱：必然有解 ---------------- */

section('3. 打乱');

{
  // 倒着走的做法唯一要守住的性质：打乱出来的局面一定解得开。
  // 随机排列有一半无解，这里用 3×3 全量验一遍（求解器对 3×3 是精确的）。
  let unsolvable = 0, solvedAfterShuffle = 0, emptyWrong = 0;
  for (let s = 0; s < 60; s++) {
    const b = S.start('n3', 'shuffle-' + s);
    if (S.solved(b)) solvedAfterShuffle++;
    // 数字必须还是 1..8 各一个加一个 0
    const seen = new Array(9).fill(0);
    for (const v of b.cells) seen[v]++;
    if (seen[0] !== 1) emptyWrong++;
    for (let v = 1; v <= 8; v++) if (seen[v] !== 1) emptyWrong++;
    if (!S.solver.solve(b, 200000)) unsolvable++;
  }
  ok('打乱后一定有解（3×3 全量验）', unsolvable === 0, unsolvable + ' 局解不开');
  ok('不会打乱完还是终局', solvedAfterShuffle === 0, solvedAfterShuffle + ' 局');
  ok('数字构成没被破坏', emptyWrong === 0, emptyWrong + ' 局');

  // 大板也抽查一下：只要每一步都是合法移动，就一定走回头
  let bigBad = 0;
  for (let s = 0; s < 20; s++) {
    const b = S.start('n5', 'big-' + s);
    const seen = new Array(26).fill(0);
    for (const v of b.cells) seen[v]++;
    if (seen[0] !== 1) bigBad++;
    for (let v = 1; v <= 24; v++) if (seen[v] !== 1) bigBad++;
  }
  ok('5×5 数字构成没被破坏', bigBad === 0, bigBad + ' 局');
}

/* ---------------- 4. 求解器 ---------------- */

section('4. 求解器');

{
  // 3×3 的求解器是精确的：把解出来的一串走法真的走一遍，必须到终局
  let wrong = 0, checked = 0;
  for (let s = 0; s < 25; s++) {
    const b = S.start('n3', 'solve-' + s);
    const r = S.solver.solve(b, 200000);
    if (!r) continue;
    checked++;
    // 沿着最优解走 r.moves 步
    const c = S.create(3);
    c.cells = Int16Array.from(b.cells);
    c.empty = b.empty;
    const first = r.first;
    if (!S.canMove(c, first)) { wrong++; continue; }
    S.move(c, first);
    let guard = 0;
    while (!S.solved(c) && guard++ < 400) {
      const rr = S.solver.solve(c, 200000);
      if (!rr || rr.first < 0) break;
      S.move(c, rr.first);
    }
    if (!S.solved(c)) wrong++;
  }
  ok('最优解走一遍真能到终局', wrong === 0, wrong + '/' + checked + ' 局走不到');
  ok('3×3 求解器确实算得出来', checked === 25, checked + '/25');

  // 曼哈顿距离：终局是 0，动一步之后 > 0
  const z = S.create(3);
  ok('终局的曼哈顿距离是 0', S.solver.manhattan(z.cells, 3) === 0);
  S.move(z, 7);
  ok('动一步后曼哈顿距离 > 0', S.solver.manhattan(z.cells, 3) > 0);
}

/* ---------------- 5. 提示 ---------------- */

section('5. 提示');

{
  // 核心性质：提示给的那一块，一定真的滑得动。
  // 界面上「走这一步」就是点它，滑不动等于点了没反应。
  let notMovable = 0, noStep = 0, badShape = 0, checked = 0;
  for (const lv of ['n3', 'n4', 'n5']) {
    for (let s = 0; s < 12; s++) {
      const b = S.start(lv, 'hint-' + s);
      const h = S.hints.best(b);
      if (!h) { noStep++; continue; }
      checked++;
      let idx = -1;
      for (let i = 0; i < b.cells.length; i++) if (b.cells[i] === h.tile) { idx = i; break; }
      if (idx < 0 || !S.canMove(b, idx)) notMovable++;
      if (!h.explain || !h.explain.name || !h.explain.conclusion || !h.explain.principle) badShape++;
      if (typeof h.optimal !== 'boolean') badShape++;
    }
  }
  ok('提示给的那块一定滑得动', notMovable === 0, notMovable + ' 次滑不动');
  ok('提示的讲解字段齐全', badShape === 0, badShape + ' 条缺字段');
  ok('每个局面都给得出提示', noStep === 0, noStep + ' 次没提示');
  console.log('  验了 ' + checked + ' 个局面');

  // 3×3 必须是「最优」档；5×5 大概率算不动，必须如实降级成「就近」档
  const b3 = S.start('n3', 'opt-3');
  ok('3×3 给的是最优解', S.hints.best(b3).optimal === true);
  let near = 0;
  for (let s = 0; s < 12; s++) {
    const b5 = S.start('n5', 'near-' + s);
    if (S.hints.best(b5).optimal === false) near++;
  }
  ok('5×5 算不动时降级为就近档', near > 0, near + '/12 降级');
  ok('降级的那条必须写明不保证最优', (() => {
    for (let s = 0; s < 12; s++) {
      const h = S.hints.best(S.start('n5', 'near-' + s));
      if (!h.optimal && !h.explain.pitfalls) return false;
    }
    return true;
  })());

  // 终局不该再给提示
  ok('终局不给提示', S.hints.best(S.create(3)) === null);
}

/* ---------------- 6. 提示质量 ---------------- */

section('6. 提示质量');

{
  // 核心回归：**提示不能来回打转**。
  // 用户报过这个：提示先说「把 10 往上滑」，照做之后立刻改口「把 10 往下滑」——
  // 两个方向互相抵消，实测能无限循环下去。
  let backForth = 0, solved = 0, boards = 0, hintMs = 0, hints = 0;
  for (const [lv, cnt, limit] of [['n3', 10, 600], ['n4', 5, 1500]]) {
    for (let s = 0; s < cnt; s++) {
      const b = S.start(lv, 'hq-' + lv + '-' + s);
      S.hints.reset();
      const hist = [];
      let guard = 0;
      while (!S.solved(b) && guard++ < limit) {
        const t0 = Date.now();
        const h = S.hints.best(b);
        hintMs += Date.now() - t0;
        hints++;
        if (!h) break;
        hist.push(h.cells[0]);
        S.move(b, h.cells[0]);
      }
      if (S.solved(b)) solved++;
      boards++;
      // 周期 2 的往复 = 用户报的那个症状
      for (let i = 2; i < hist.length; i++) {
        if (hist[i] === hist[i - 2] && hist[i] !== hist[i - 1]) { backForth++; break; }
      }
    }
  }
  ok('提示不会来回往复（周期 2）', backForth === 0, backForth + '/' + boards + ' 局出现');
  ok('3×3 与 4×4 沿提示都能解出', solved === boards, solved + '/' + boards);
  ok('单次提示在 100ms 以内', hintMs / Math.max(1, hints) < 100, (hintMs / Math.max(1, hints)).toFixed(0) + 'ms');
  console.log('  ' + boards + ' 局全部沿提示走到底，平均每次提示 ' + (hintMs / Math.max(1, hints)).toFixed(0) + 'ms');
}

{
  // 5×5：不保证解出，但必须持续往前推进、且不打转
  const b = S.start('n5', 'hq-n5-0');
  S.hints.reset();
  const d0 = S.solver.totalDistance(b.cells, 5);
  const hist = [];
  let guard = 0;
  while (!S.solved(b) && guard++ < 600) {
    const h = S.hints.best(b);
    if (!h) break;
    hist.push(h.cells[0]);
    S.move(b, h.cells[0]);
  }
  const d1 = S.solver.totalDistance(b.cells, 5);
  let backForth = 0;
  for (let i = 2; i < hist.length; i++) if (hist[i] === hist[i - 2] && hist[i] !== hist[i - 1]) { backForth++; break; }
  ok('5×5 不打转', backForth === 0);
  ok('5×5 确实在往前推进', S.solved(b) || d1 < d0 * 0.8, '总距离 ' + d0 + ' → ' + d1);
  console.log('  5×5：总距离 ' + d0 + ' → ' + d1 + '，解出=' + S.solved(b));
}

/* ---------------- 汇总 ---------------- */

console.log('\n================================');
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
