'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','06-hints','07-rater','04-generator']) {
  vm.runInThisContext(fs.readFileSync('js/core/' + f + '.js', 'utf8'), { filename: f });
}
const G = SD.Generator, B = SD.Base, S = SD.Solver, R = SD.Rater;

console.log('=== 1. 终盘是否重复（曾经的严重 bug：所有题共用同一终盘）===');
for (const diff of G.DIFFICULTY_ORDER) {
  const sols = new Set(), grids = new Set();
  let dupSol = 0, dupGrid = 0;
  for (let i = 0; i < 12; i++) {
    const gen = G.generateSync(diff, null);
    const sol = S.solve(gen.givens, 1).solution;
    const solKey = B.gridToString(sol);
    const gridKey = B.gridToString(gen.givens);
    if (sols.has(solKey)) dupSol++; else sols.add(solKey);
    if (grids.has(gridKey)) dupGrid++; else grids.add(gridKey);
  }
  console.log('  ' + diff.padEnd(7) + '12 道题里：终盘重复 ' + dupSol + ' 个，题面重复 ' + dupGrid + ' 个'
    + (dupSol || dupGrid ? '  ✗ 有问题' : '  ✓'));
}

console.log();
console.log('=== 2. 难度下限（不能被更低等级解完）===');
for (const diff of G.DIFFICULTY_ORDER) {
  const cfg = G.DIFFICULTY[diff];
  if (!cfg.harderThan) { console.log('  ' + diff.padEnd(7) + '不设下限，跳过'); continue; }
  let bad = 0;
  for (let i = 0; i < 8; i++) {
    const gen = G.generateSync(diff, null);
    if (R.rate(gen.givens, { maxLevel: cfg.harderThan }).solved) bad++;
  }
  console.log('  ' + diff.padEnd(7) + '8 道里 ' + bad + ' 道能被更低等级解完' + (bad ? '  ✗' : '  ✓'));
}

console.log();
console.log('=== 3. 种子确定性（同种子必须同题）===');
let det = true;
for (const diff of ['easy','medium','hard']) {
  const a = B.gridToString(G.generateSync(diff, 'fixed-seed').givens);
  const b = B.gridToString(G.generateSync(diff, 'fixed-seed').givens);
  if (a !== b) { det = false; console.log('  ' + diff + ' 两次结果不同 ✗'); }
}
console.log('  ' + (det ? '✓ 三种难度都稳定复现' : '✗ 存在不确定性'));

console.log();
console.log('=== 4. 每日挑战确定性 + 算法变更影响 ===');
const d1 = B.gridToString(G.generateDailySync('daily-2026-10-20').givens);
const d2 = B.gridToString(G.generateDailySync('daily-2026-10-20').givens);
console.log('  同一天两次生成：' + (d1 === d2 ? '一致 ✓' : '不一致 ✗'));
const g1 = G.generateDailySync('daily-2026-10-20');
console.log('  该日目标 L' + g1.target + '，实际 L' + g1.level + '，非余数法 ' + g1.techSteps + ' 步');