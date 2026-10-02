'use strict';
const fs = require('fs'), vm = require('vm');
globalThis.window = globalThis;
for (const f of ['01-core','02-board','03-solver','05-techniques','06-hints','07-rater','04-generator']) {
  vm.runInThisContext(fs.readFileSync('js/core/' + f + '.js', 'utf8'), { filename: f });
}
const G = SD.Generator, B = SD.Base, S = SD.Solver, R = SD.Rater;

const WANT = 1000;
const DIFF = process.argv[2] || 'master';
const SRC = process.argv[3] || ('D:/Downloads/数独/tests/.bank-' + DIFF + '.json');

const seen = new Set();
const rows = [];
if (fs.existsSync(SRC)) {
  for (const r of JSON.parse(fs.readFileSync(SRC, 'utf8'))) {
    seen.add(r.g);
    rows.push(r);
  }
  console.log('沿用已有 ' + rows.length + ' 道');
}
const t0 = Date.now();
let tries = 0;
while (rows.length < WANT && tries < WANT * 4) {
  tries++;
  const g = G.generateSync(DIFF, null);
  const key = B.gridToString(g.givens);
  if (seen.has(key)) continue;
  if (S.solve(g.givens, 3).count !== 1) continue;
  const rt = R.rate(g.givens, { maxLevel: G.DIFFICULTY[DIFF].maxLevel });
  if (!rt.solved) continue;
  seen.add(key);
  rows.push({ d: DIFF, g: key, c: g.clueCount, l: rt.level });
  if (rows.length % 100 === 0) console.log('  ' + DIFF + ' ' + rows.length + '/' + WANT + '  ' + ((Date.now()-t0)/1000).toFixed(0) + 's');
}
fs.writeFileSync(SRC, JSON.stringify(rows));
console.log(DIFF + ' 完成 ' + rows.length + ' 道  用时 ' + ((Date.now()-t0)/1000).toFixed(1) + 's  → ' + SRC);