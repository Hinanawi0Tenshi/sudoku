'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','06-hints','07-rater','04-generator','08b-bank-big']) {
  vm.runInThisContext(fs.readFileSync('js/core/' + f + '.js', 'utf8'), { filename: f });
}
const BB = SD.BankBig, B = SD.Base, S = SD.Solver, R = SD.Rater;
let allBad = 0, allSeen = new Set(), allDup = 0;
for (const diff of BB.ORDER) {
  const n = BB.countOf(diff);
  const list = BB.of(diff);
  const step = Math.max(1, Math.floor(n / 100));
  const probe = [];
  for (let i = 0; i < n; i += step) probe.push(list[i]);
  let bad = 0, uniq = 0, solved = 0;
  for (const p of probe) {
    const g = B.stringToGrid(p.grid);
    if (S.solve(g, 3).count !== 1) { bad++; continue; }
    uniq++;
    if (R.rate(g, { maxLevel: 5 }).solved) solved++;
    if (allSeen.has(p.grid)) allDup++;
    allSeen.add(p.grid);
  }
  allBad += bad;
  console.log(diff.padEnd(7) + String(n).padStart(5) + ' 道  抽样 ' + String(probe.length).padStart(3)
    + '  非唯一解 ' + bad + '  唯一 ' + uniq + '  可纯逻辑解 ' + solved);
}
console.log();
console.log('跨档重复: ' + allDup + '   唯一题面总数: ' + allSeen.size + '   非唯一解合计: ' + allBad);