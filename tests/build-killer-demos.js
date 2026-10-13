/* 杀手数独 · 演示盘面生成器（node tests/build-killer-demos.js）
 *
 * 教程里每种技巧都要一个「当场能触发」的演示盘面。原先是在浏览器里现算的：
 * 出题 + 一局局推下去，实测点开教程要等好几秒。其实这些局面跟玩家、跟时间都没关系，
 * 完全可以离线算好、当成静态数据发出去。
 *
 * 这个脚本就是那把「离线」的锤子：跑一遍，把结果写进 js/games/killer/08-demos.js。
 * 出题逻辑改了、或加了新技巧，重跑一次即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;
const ROOT = path.resolve(__dirname, '..');
for (const f of [
  'js/platform/07-util.js',
  'js/core/01-core.js',
  'js/core/02-board.js',
  'js/core/03-solver.js',
  'js/core/05-techniques.js',
  'js/games/killer/01-cages.js',
  'js/games/killer/02-solver.js',
  'js/games/killer/03-techniques.js',
  'js/games/killer/04-generator.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

const SD = globalThis.SD;
const K = SD.Killer;
const KT = K.techniques;
const KG = K.generator;

/** 一局里依次经过的技巧：一局的解法本来就会用好几种技巧 */
function scan(gen) {
  const puz = gen.puzzle;
  const found = {};
  const g = new Uint8Array(81);
  const state = KT.makeState(puz, g);
  const cand = state.cand;
  let guard = 0;
  while (!SD.Validation.isComplete(g) && guard++ < 300) {
    const step = KT.findStepFrom(state, { maxLevel: 4 });
    if (!step) break;
    if (!found[step.id]) found[step.id] = { puz: puz, sol: gen.solution, grid: g.slice(), cand: Array.from(cand), step: step, difficulty: gen.difficultyName };
    SD.Techniques.commit(g, cand, step);
  }
  // 笼内试数只在「别的都推不动」时才出场，推到底之后再单独问它一次
  if (!found['cage-trial']) {
    const t = KT.byId['cage-trial'];
    const trial = t.find(state);
    if (trial) {
      found['cage-trial'] = {
        puz: puz, sol: gen.solution, grid: g.slice(), cand: Array.from(cand),
        step: SD.Techniques.decorate(t, trial),
        difficulty: gen.difficultyName,
      };
    }
  }
  return found;
}

const WANT = KT.LIST.map((t) => t.id);
const demos = {};
for (let s = 0; s < 40 && Object.keys(demos).length < WANT.length; s++) {
  const id = ['medium', 'hard', 'expert'][s % 3];
  const gen = KG.generateSync(id, 'demo-' + s);
  const found = scan(gen);
  for (const k of Object.keys(found)) if (!demos[k]) demos[k] = found[k];
}

const missing = WANT.filter((id) => !demos[id]);
if (missing.length) {
  console.error('✗ 没找到这些技巧的演示局面：' + missing.join(', '));
  process.exit(1);
}

/** 只留渲染和讲解真正用得到的字段——decorate 会把 name / level / tagline 补回来 */
function pack(d) {
  const s = d.step;
  return {
    d: d.difficulty,
    g: Array.prototype.join.call(d.grid, ''),
    sol: Array.prototype.join.call(d.sol, ''),
    // 候选数状态也要存。演示局面是「一路推到某一步」的中间态，光有盘面复现不出来——
    // 笼内试数就依赖前面所有消除累积下来的候选，缺了它这条演示在测试里触发不了。
    k: d.cand,
    c: d.puz.list.map((cg) => [cg.cells.slice(), cg.sum]),
    s: {
      id: s.id,
      focusCell: s.focusCell,
      focusDigit: s.focusDigit,
      cells: s.cells,
      placements: s.placements,
      eliminations: s.eliminations,
      detail: s.detail,
    },
  };
}

const out = {};
for (const id of WANT) out[id] = pack(demos[id]);

const src = '/* 杀手数独 · 教程演示局面（由 tests/build-killer-demos.js 生成，不要手改）\n' +
  ' *\n' +
  ' * 这些局面跟玩家、跟时间都没关系，所以离线算好当静态数据发出去——\n' +
  ' * 原先在浏览器里现算，点开教程要等好几秒。出题逻辑改了或加了新技巧，重跑一次生成脚本。\n' +
  ' */\n' +
  '(function (global) {\n' +
  "  'use strict';\n" +
  '  const SD = (global.SD = global.SD || {});\n' +
  '  const K = (SD.Killer = SD.Killer || {});\n' +
  '  K.demos = ' + JSON.stringify(out) + ';\n' +
  '})(window);\n';

const dest = path.join(ROOT, 'js/games/killer/08-demos.js');
fs.writeFileSync(dest, src, 'utf8');
console.log('已生成 ' + path.relative(ROOT, dest).replace(/\\/g, '/') + '（' + Math.round(src.length / 1024) + 'KB）');
for (const id of WANT) console.log('  ' + id.padEnd(16) + demos[id].difficulty + '  ' + demos[id].puz.list.length + ' 个笼子');
