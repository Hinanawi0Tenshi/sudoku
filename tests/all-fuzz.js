'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','07-rater','04-generator']) {
  vm.runInThisContext(fs.readFileSync('js/core/' + f + '.js', 'utf8'), { filename: f });
}
const B = SD.Base, V = SD.Validation, T = SD.Techniques, S = SD.Solver;
const rc = (i) => 'R' + (B.ROW_OF[i]+1) + 'C' + (B.COL_OF[i]+1);

// 技能正确性的性质测试：每条推理都必须与机器解一致
const usage = {};
const bands = [[22,32],[32,42],[42,58],[50,66]];
let bad = null, states = 0;
for (const band of bands) {
  for (let s = 0; s < 150 && !bad; s++) {
    const sol = S.randomFullGrid(B.makeRng('ft'+band[0]+'-'+s));
    const g = sol.slice();
    const rng = B.makeRng('ftf'+band[0]+'-'+s);
    const order = B.shuffle(Array.from({length:81},(_,i)=>i), rng);
    const holes = band[0] + ((rng()*(band[1]-band[0]))|0);
    for (let h=0;h<holes;h++) g[order[h]] = 0;
    states++;
    for (const step of T.findAll(g, 5)) {
      if (step.id === 'unique-rectangle') continue;   // 已在核心测试里单独隔离
      usage[step.id] = (usage[step.id]||0) + 1;
      for (const e of step.eliminations) {
        if (sol[e.cell] === e.digit) { bad = step.id+' 误删 '+rc(e.cell)+' 的 '+e.digit; break; }
      }
      if (bad) break;
      for (const p of step.placements) {
        if (sol[p.cell] !== p.digit) { bad = step.id+' 推出 '+rc(p.cell)+'='+p.digit+' 但真实解是 '+sol[p.cell]; break; }
      }
      if (bad) break;
    }
  }
}
console.log('局面 '+states+' 个');
console.log(bad ? ('✗ '+bad) : '✓ 所有技巧的结论都与机器解一致');
console.log('分布: ' + JSON.stringify(usage));
const ids = Object.keys(T.byId);
const miss = ids.filter(id => !(usage[id] > 0));
console.log(miss.length ? ('未触发: ' + miss.join(', ')) : '✓ '+ids.length+' 种技巧全部被实际触发');