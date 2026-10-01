'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','07-rater','04-generator'])
  vm.runInThisContext(fs.readFileSync('js/core/'+f+'.js','utf8'), { filename: f });
const B = SD.Base, V = SD.Validation, T = SD.Techniques;
const rc = (i) => 'R'+(B.ROW_OF[i]+1)+'C'+(B.COL_OF[i]+1);

function fuzz(label, holesMin, holesMax, n) {
  let fired = 0, bad = null, cells = 0;
  const t0 = Date.now();
  for (let s = 0; s < n && !bad; s++) {
    const sol = SD.Solver.randomFullGrid(B.makeRng(label+'s'+s));
    const g = sol.slice();
    const rng = B.makeRng(label+'f'+s);
    const order = B.shuffle(Array.from({length:81},(_,i)=>i), rng);
    const holes = holesMin + ((rng()*(holesMax-holesMin))|0);
    for (let h=0;h<holes;h++) g[order[h]]=0;
    const cand = V.computeCandidates(g);
    for (const id of ['trial','multiple-forcing-chain']) {
      const step = T.byId[id].find({grid:g, cand:cand});
      if (!step) continue;
      fired++;
      for (const e of step.eliminations)
        if (sol[e.cell] === e.digit) { bad = id+' 误删 '+rc(e.cell)+' 的 '+e.digit; break; }
      if (bad) break;
    }
  }
  const ms = Date.now()-t0;
  console.log(label+': '+n+' 个局面, 触发 '+fired+' 次, 耗时 '+ms+'ms  ' + (bad?('✗ '+bad):'✓ 全部与真实答案一致'));
  return fired;
}

fuzz('稀疏', 50, 66, 120);
fuzz('中密', 38, 50, 120);
fuzz('密集', 24, 38, 120);