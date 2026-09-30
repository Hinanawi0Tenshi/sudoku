globalThis.window = globalThis;
const fs = require('fs'), path = require('path'), vm = require('vm');
for (const f of ['01-core','02-board','03-solver','04-generator','05-techniques','06-hints','07-rater']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js/core', f + '.js'), 'utf8'), { filename: f });
}
const { Base: B, Solver, Validation, Techniques } = globalThis.SD;

// 不同稀疏度下各技巧的出现频次；state 始终是某个解的子局面，
// 因此除了唯一矩形（依赖唯一解前提）外，其它技巧的结论都必然正确。
const bands = [
  { name: 'holes 20-30 (密)', lo: 20, hi: 30 },
  { name: 'holes 30-40',      lo: 30, hi: 40 },
  { name: 'holes 40-50',      lo: 40, hi: 50 },
  { name: 'holes 50-70 (疏)', lo: 50, hi: 70 },
];
const grand = {};
for (const band of bands) {
  const usage = {};
  for (let t = 0; t < 200; t++) {
    const rng = B.makeRng(band.lo + '-' + t);
    const sol = Solver.randomFullGrid(rng);
    const g = sol.slice();
    const order = B.shuffle(Array.from({length:81},(_,i)=>i), rng);
    const holes = band.lo + ((rng()*(band.hi-band.lo))|0);
    for (let h=0; h<holes; h++) g[order[h]] = 0;
    for (const s of Techniques.findAll(g, 5)) {
      if (s.id === 'unique-rectangle') continue;
      usage[s.id] = (usage[s.id]||0)+1;
      grand[s.id] = (grand[s.id]||0)+1;
    }
  }
  console.log(band.name + ': ' + JSON.stringify(usage));
}
console.log('\n合计: ' + JSON.stringify(grand));
const missing = Object.keys(Techniques.byId).filter(id => id !== 'forcing-chain' && id !== 'unique-rectangle' && !grand[id]);
console.log('未触发: ' + (missing.length ? missing.join(', ') : '（无）'));
