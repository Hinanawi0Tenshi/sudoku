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

/** 这一步的结论必须和真解一致：填的数不能填错，删的候选不能删掉真解数字 */
function stepOk(step, sol) {
  for (const p of step.placements || []) if (sol[p.cell] !== p.digit) return false;
  for (const e of step.eliminations || []) if (sol[e.cell] === e.digit) return false;
  return true;
}

/**
 * 一局里扫出尽可能多的技巧演示局面。
 *
 * 不能只跟着正常解题顺序走——那是「当前最该走的一步」，稀有技巧往往排在后面，
 * 一局下来根本轮不到它，结果就是找不到演示。所以每到一个局面，主动问一遍
 * 「这条技巧现在能不能用」，能就截下来。这样演示只要求「真的能用」，
 * 不要求「非用不可」，反而更适合讲解。
 */
function scan(gen, wanted) {
  const puz = gen.puzzle;
  const sol = gen.solution;
  const found = {};
  const g = new Uint8Array(81);
  const state = KT.makeState(puz, g);
  const cand = state.cand;

  const probe = (id) => {
    if (found[id]) return;
    const t = KT.byId[id];
    if (!t || t.expensive) return;
    const step = t.find(state);
    if (!step) return;
    if (!stepOk(step, sol)) {
      console.error('✗ ' + id + ' 在 ' + gen.difficultyName + ' 局面上给出了和真解冲突的结论');
      process.exit(1);
    }
    found[id] = {
      puz: puz, sol: sol, grid: g.slice(), cand: Array.from(cand),
      step: SD.Techniques.decorate(t, step), difficulty: gen.difficultyName,
    };
  };

  let guard = 0;
  while (!SD.Validation.isComplete(g) && guard++ < 300) {
    for (const id of wanted) probe(id);
    const step = KT.findStepFrom(state, { maxLevel: 4 });
    if (!step) break;
    SD.Techniques.commit(g, cand, step);
  }

  // 笼内试数只在「别的都推不动」时才出场，推到底之后再单独问它一次
  if (!found['cage-trial']) {
    const t = KT.byId['cage-trial'];
    const trial = t.find(state);
    if (trial && stepOk(trial, sol)) {
      found['cage-trial'] = {
        puz: puz, sol: sol, grid: g.slice(), cand: Array.from(cand),
        step: SD.Techniques.decorate(t, trial), difficulty: gen.difficultyName,
      };
    }
  }
  return found;
}

const WANT = KT.LIST.map((t) => t.id);
const demos = {};
const DIFFS = ['medium', 'hard', 'expert', 'expert', 'hard'];
for (let s = 0; s < 200 && Object.keys(demos).length < WANT.length; s++) {
  const gen = KG.generateSync(DIFFS[s % DIFFS.length], 'demo-' + s);
  const wanted = WANT.filter((id) => !demos[id]);
  const found = scan(gen, wanted);
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
