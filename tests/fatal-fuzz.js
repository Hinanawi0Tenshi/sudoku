'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','07-rater','04-generator']) {
  vm.runInThisContext(fs.readFileSync('js/core/' + f + '.js', 'utf8'), { filename: f });
}
const B = SD.Base, V = SD.Validation, T = SD.Techniques, S = SD.Solver, G = SD.Generator;
const rc = (i) => 'R' + (B.ROW_OF[i]+1) + 'C' + (B.COL_OF[i]+1);

// 唯一解盘面上的致命模式族验证（唯一矩形、隐性矩形）
const usage = {};
let bad = null, states = 0, fired = 0;
for (let s = 0; s < 400 && !bad; s++) {
  const diff = G.DIFFICULTY_ORDER[s % 5];
  const gen = G.generateSync(diff, 'dq-' + s);
  const rng = B.makeRng('dqf-' + s);
  const g = gen.givens.slice();
  const empties = [];
  for (let i = 0; i < 81; i++) if (!g[i]) empties.push(i);
  const take = Math.min(empties.length, 18 + ((rng() * 28) | 0));
  for (const i of B.shuffle(empties.slice(), rng).slice(0, take)) g[i] = gen.solution[i];
  if (S.solve(g, 2).count !== 1) continue;
  states++;
  for (const step of T.findAll(g, 5)) {
    if (step.id !== 'hidden-rectangle' && step.id !== 'unique-rectangle') continue;
    fired++;
    usage[step.id] = (usage[step.id]||0) + 1;
    for (const e of step.eliminations) {
      if (gen.solution[e.cell] === e.digit) {
        bad = step.id + ' 误删 ' + rc(e.cell) + ' 的 ' + e.digit + '（真实解就是它）';
        break;
      }
    }
    if (bad) break;
  }
}
console.log('唯一解局面 ' + states + ' 个，致命模式族触发 ' + fired + ' 次');
console.log('分布: ' + JSON.stringify(usage));
console.log(bad ? ('✗ ' + bad) : '✓ 结论全部与真实答案一致');