/* 数织 · 核心、求解器、图库与提示单元测试（node tests/nonogram-test.js）
 *
 * 最要紧的一条：**提示说"这格一定是实心"，它就绝不能错**。
 * 数织的提示是必然结论，不是建议——推错一格，玩家后面全盘跟着错。
 * 所以这里逐格验：从正确局面出发，提示的每一条结论都必须和真解一致。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
for (const f of [
  'js/platform/07-util.js',
  'js/games/nonogram/01-core.js',
  'js/games/nonogram/02-solver.js',
  'js/games/nonogram/03-pictures.js',
  'js/games/nonogram/04-generator.js',
  'js/games/nonogram/05-hints.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const N = SD.Nonogram;
const U = SD.Util;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------------- 1. 棋盘与线索 ---------------- */

section('1. 棋盘与线索');

{
  const sol = N.parseRows(['.#..', '###.', '.#..', '....'], 4, 4);
  const cl = N.cluesOf(sol, 4, 4);
  ok('行线索正确', JSON.stringify(cl.rows) === '[[1],[3],[1],[0]]', JSON.stringify(cl.rows));
  ok('列线索正确', JSON.stringify(cl.cols) === '[[1],[3],[1],[0]]', JSON.stringify(cl.cols));

  const b = N.fromSolution(sol, 4, 4, '测试');
  ok('新建盘面全未知', Array.from(b.cells).every((v) => v === 0));
  ok('未填不算完成', !N.isComplete(b));
  N.toggle(b, 1);
  ok('填对一格后仍不算完成', !N.isComplete(b));
  for (let i = 0; i < 16; i++) if (b.solution[i]) N.setCell(b, i, N.FILLED);
  ok('实心格全填对就算完成（空位不用标）', N.isComplete(b));
  ok('没有填错的', N.wrongCells(b).length === 0);

  N.setCell(b, 0, N.FILLED);
  ok('多填一格就不算完成', !N.isComplete(b));
  ok('多填的那格被报为错误', N.wrongCells(b).length === 1, N.wrongCells(b).join(','));
}

/* ---------------- 2. 行求解器 ---------------- */

section('2. 行求解器');

{
  const blank = new Uint8Array(10);
  const forced = (r) => { const o = []; for (let i = 0; i < 10; i++) if (r.fill[i] === r.count) o.push(i); return o; };
  const empty = (r) => { const o = []; for (let i = 0; i < 10; i++) if (r.fill[i] === 0) o.push(i); return o; };

  let r = N.lineSolve(blank, [6]);
  ok('[6] 在 10 格里：5 种摆法', r.count === 5, r.count + ' 种');
  ok('[6] 的重叠格是 4、5（长度×2−行长度 = 2）', forced(r).join(',') === '4,5', forced(r).join(','));

  r = N.lineSolve(blank, [3]);
  ok('[3] 在 10 格里没有重叠格', forced(r).length === 0, forced(r).join(','));

  r = N.lineSolve(blank, [0]);
  ok('[0] 只有一种摆法', r.count === 1);
  ok('[0] 全部判空', empty(r).length === 10);

  r = N.lineSolve(blank, [10]);
  ok('[10] 全部填实', forced(r).length === 10);

  const line = new Uint8Array(10); line[0] = 1;
  r = N.lineSolve(line, [6]);
  ok('已知第 1 格实心 + [6]：段只能从 0 开始', r.count === 1 && forced(r).length === 6, r.count + ' 种');

  const bad = new Uint8Array(10); bad[0] = 1; bad[5] = 2;
  ok('第 1 格实心 + 第 6 格空 + [6] → 无解', N.lineSolve(bad, [6]).count === 0);

  r = N.lineSolve(blank, [3, 3]);
  ok('[3,3] 在 10 格里有多解（10 种）', r.count === 10, r.count + ' 种');
}

/* ---------------- 3. 整盘求解 ---------------- */

section('3. 整盘求解');

{
  let notUnique = 0, notLine = 0;
  for (const p of N.pictures) {
    const b = N.create(p);
    if (N.countSolutions(b.clues, b.w, b.h, 2) !== 1) notUnique++;
    if (!N.solvableByLine(b.clues, b.w, b.h)) notLine++;
  }
  ok('图库里每张图都是唯一解', notUnique === 0, notUnique + ' 张多解');
  console.log('  41 张图里纯逻辑可解 ' + (N.pictures.length - notLine) + ' 张，需假设 ' + notLine + ' 张');

  // 纯逻辑可解的那些，传播出来的结果必须正好等于真解
  let wrong = 0;
  for (const p of N.pictures) {
    const b = N.create(p);
    const pr = N.propagate(b.clues, b.w, b.h);
    if (pr.contradiction || pr.stuck) continue;
    for (let i = 0; i < pr.cells.length; i++) {
      if ((pr.cells[i] === N.FILLED) !== !!b.solution[i]) wrong++;
    }
  }
  ok('纯逻辑推出来的盘面和真解完全一致', wrong === 0, wrong + ' 格不一致');
}

/* ---------------- 4. 图库 ---------------- */

section('4. 图库');

{
  ok('图库有 41 张', N.pictures.length === 41, N.pictures.length + ' 张');
  ok('每张图都有名字和尺寸', N.pictures.every((p) => p.name && p.w === p.h && p.rows.length === p.h));
  ok('尺寸只有 5/10/15/20 四种',
    N.pictures.every((p) => [5, 10, 15, 20].indexOf(p.w) >= 0),
    Array.from(new Set(N.pictures.map((p) => p.w))).join(','));

  // 每张图都要"有内容"：不能全空、也不能全满
  let degenerate = 0;
  for (const p of N.pictures) {
    const b = N.create(p);
    let n = 0;
    for (const v of b.solution) if (v) n++;
    if (n === 0 || n === b.solution.length) degenerate++;
  }
  ok('没有全空或全满的退化图', degenerate === 0, degenerate + ' 张');

  // 公式图形：抽查几个已知形状的特征
  const heart = N.picById('heart10');
  const hs = N.parseRows(heart.rows, 10, 10);
  ok('爱心顶部中间是凹的（心形特征）', !hs[1 * 10 + 4] && !hs[1 * 10 + 5], '第 2 行中间应为空');
  ok('爱心底部收窄', (() => {
    const cnt = (r) => { let n = 0; for (let c = 0; c < 10; c++) if (hs[r * 10 + c]) n++; return n; };
    return cnt(2) > cnt(6) && cnt(6) > cnt(8);
  })());

  const tri = N.picById('triangle10');
  const ts = N.parseRows(tri.rows, 10, 10);
  ok('三角上尖下宽', (() => {
    const cnt = (r) => { let n = 0; for (let c = 0; c < 10; c++) if (ts[r * 10 + c]) n++; return n; };
    return cnt(0) < cnt(4) && cnt(4) < cnt(9);
  })());

  const cross = N.picById('cross10');
  const cs = N.parseRows(cross.rows, 10, 10);
  ok('十字横竖都有（第 5 行全实、第 5 列全实）', (() => {
    for (let c = 0; c < 10; c++) if (!cs[4 * 10 + c]) return false;
    for (let r = 0; r < 10; r++) if (!cs[r * 10 + 4]) return false;
    return true;
  })());
}

/* ---------------- 5. 出题 ---------------- */

section('5. 出题');

{
  const sizes = N.poolSizes();
  let empty = 0;
  for (const lv of N.LEVELS) if (!sizes[lv.id]) empty++;
  ok('五个档位都有图', empty === 0, JSON.stringify(sizes));
  console.log('  出题池: ' + JSON.stringify(sizes));

  let bad = 0;
  for (const lv of N.LEVELS) {
    for (let s = 0; s < 4; s++) {
      const b = N.generate(lv.id, 'gen-' + lv.id + '-' + s);
      if (!b) { bad++; continue; }
      if (N.countSolutions(b.clues, b.w, b.h, 2) !== 1) bad++;
      if (b.state !== 'playing' || b.moves !== 0) bad++;
    }
  }
  ok('每档出的题都是唯一解', bad === 0, bad + ' 局有问题');

  const a = N.generate('medium', 'same');
  const c = N.generate('medium', 'same');
  ok('同种子出同一张图', a.name === c.name && a.id === c.id, a.name + ' vs ' + c.name);
}

/* ---------------- 6. 提示 ---------------- */

section('6. 提示');

{
  // 核心性质：从正确局面出发，提示的每一条结论都必须和真解一致。
  // 提示说"这格一定实心"——错了就是把人带沟里。
  let wrong = 0, dead = 0, checked = 0;
  for (const p of N.pictures) {
    const b = N.create(p);
    if (!N.solvableByLine(b.clues, b.w, b.h)) continue;
    let guard = 0;
    while (!N.isComplete(b) && guard++ < 600) {
      const step = N.hints.findStep(b);
      if (!step) break;
      if (step.dead) { dead++; break; }
      checked++;
      for (const k of step.filled) {
        const i = N.hints.toBoard(b, step, k);
        if (!b.solution[i]) wrong++;                 // 说实心但真解是空 → 严重错误
        if (b.cells[i] === N.UNKNOWN) N.setCell(b, i, N.FILLED);
      }
      for (const k of step.marked) {
        const i = N.hints.toBoard(b, step, k);
        if (b.solution[i]) wrong++;                  // 说空但真解是实心 → 同样是错
        if (b.cells[i] === N.UNKNOWN) N.setCell(b, i, N.MARKED);
      }
    }
  }
  ok('提示的结论和真解零冲突', wrong === 0, wrong + ' 格推错');
  ok('纯逻辑可解的图不会推到死路', dead === 0, dead + ' 次');
  ok('提示确实推得动（步数够多）', checked > 200, checked + ' 步');
  console.log('  沿提示推了 ' + checked + ' 步');

  // 讲解字段齐全
  let badShape = 0;
  for (const p of N.pictures.slice(0, 8)) {
    const b = N.create(p);
    const step = N.hints.findStep(b);
    if (!step) continue;
    const e = N.hints.explain(step, b);
    if (!e.name || !e.derivation || !e.derivation.length || !e.conclusion || !e.principle) badShape++;
  }
  ok('讲解字段齐全', badShape === 0, badShape + ' 条缺字段');

  // 重叠法的讲解要点出「长度 × 2 − 行长度」这条心算法则
  {
    const line = new Uint8Array(10);
    const step = N.hints.lineStep(line, [6], 'row', 0);
    const e = N.hints.explain(step, N.create(N.picById('heart10')));
    ok('重叠法被正确识别', step.id === 'overlap', step.id);
    ok('重叠法的讲解给出心算口诀', e.principle.indexOf('长度 × 2') >= 0 || e.principle.indexOf('× 2') >= 0);
  }

  // 唯一摆法要被识别成 L1
  {
    const line = new Uint8Array(10); line[0] = N.FILLED;
    const step = N.hints.lineStep(line, [6], 'row', 0);
    ok('只剩一种摆法时判为「唯一摆法」', step.id === 'only' && step.level === 1, step.id);
  }

  // 矛盾行要被识别出来
  {
    const line = new Uint8Array(10); line[0] = N.FILLED; line[5] = N.MARKED;
    const step = N.hints.lineStep(line, [6], 'row', 0);
    ok('排不出摆法时判为走不通', step && step.dead === true);
  }
}

/* ---------------- 汇总 ---------------- */

console.log('\n================================');
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
