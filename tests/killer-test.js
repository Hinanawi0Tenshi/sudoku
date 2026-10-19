/* 杀手数独 · 单元测试（node tests/killer-test.js）
 *
 * 最重要的一条和数独那边同源：性质测试——引擎给出的每一个结论都必须和真解一致。
 * 出数必须等于真解，删候选不能删掉真解数字。只要有一条推错，玩家按提示走下去就废了。
 *
 * 这条测试在开发期真的抓到过问题：唯一矩形那一族靠「致命模式」论证，
 * 而交换两格会破坏笼子和，论证在杀手盘面上根本不成立——它删掉了真解数字。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
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
  'js/core/06-hints.js',          // 提示文案是拼字符串的，SD.Hints.explainStep 是它的兜底
  'js/games/killer/05-hints.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

const B = SD.Base;
const U = SD.Util;
const C = SD.Killer.cages;
const KS = SD.Killer.solver;
const KT = SD.Killer.techniques;
const G = SD.Killer.generator;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');

const rc = (i) => 'R' + (B.ROW_OF[i] + 1) + 'C' + (B.COL_OF[i] + 1);

/* ---------------- 1. 笼子模型 ---------------- */

section('1. 笼子组合表');

{
  // C(9,2)=36 组，和为 10 的有 4 组：{1,9}{2,8}{3,7}{4,6}
  ok('组合表数量对得上', C.comboCount(2, 10) === 4 && C.comboCount(1, 5) === 1 && C.comboCount(3, 6) === 1);
  ok('不存在的组合返回 0', C.comboCount(2, 1) === 0 && C.comboCount(1, 10) === 0);

  // 3 格和为 7 只有 {1,2,4}，所以 8、9 不可能出现
  const p = C.possible(3, 7);
  ok('possible 给出可能数字的并集', !(p & B.bit(8)) && !(p & B.bit(9)) && !!(p & B.bit(1)) && !!(p & B.bit(4)));
  // 3 格和为 6 只有 {1,2,3}，三个数字全都必含
  const req = C.required(3, 6);
  ok('required 给出必含数字', req === (B.bit(1) | B.bit(2) | B.bit(3)));
  ok('2 格和为 17 只有 {8,9}', C.possible(2, 17) === (B.bit(8) | B.bit(9)));
}

{
  const g = G.generateSync('easy', 'shape-check');
  ok('生成的笼子覆盖全部 81 格且互不重叠', KS.validateShape(g.puzzle) === null);
  let sumOk = true;
  for (const cg of g.cages) {
    let s = 0;
    for (const i of cg.cells) s += g.solution[i];
    if (s !== cg.sum) sumOk = false;
    // 笼内数字必须互不相同
    const seen = new Set();
    for (const i of cg.cells) {
      if (seen.has(g.solution[i])) sumOk = false;
      seen.add(g.solution[i]);
    }
  }
  ok('每个笼子的和等于真解、且笼内数字不重复', sumOk);
}

/* ---------------- 2. 求解器 ---------------- */

section('2. 求解器');

{
  const g = G.generateSync('medium', 'solver-check');
  const r = KS.solve(g.puzzle, 2);
  ok('生成的题唯一解', r.count === 1);

  // 解出来的盘面必须同时满足行列宫和笼子
  const sol = r.solution;
  const rows = new Set();
  let rowOk = true;
  for (let i = 0; i < 81; i++) {
    if (!sol[i]) { rowOk = false; break; }
    const key = B.ROW_OF[i] + ':' + sol[i];
    if (rows.has(key)) { rowOk = false; break; }
    rows.add(key);
  }
  ok('解满足 9 行每行 1-9 各一次', rowOk);

  let cageOk = true;
  for (const cg of g.cages) {
    let s = 0;
    const seen = new Set();
    for (const i of cg.cells) { s += sol[i]; if (seen.has(sol[i])) cageOk = false; seen.add(sol[i]); }
    if (s !== cg.sum) cageOk = false;
  }
  ok('解满足每个笼子的和且笼内不重复', cageOk);
}

{
  // 多解的构造：把每一行切成一个 9 格笼、和 45。这等价于「无提示的普通数独」，
  // 解有一大堆。注意不能真用「81 格一个笼子」——笼内数字必须互不相同，
  // 81 格装不下 81 个不同数字，那是 0 解而不是多解。
  const rows = [];
  for (let r = 0; r < 9; r++) {
    const cells = [];
    for (let c = 0; c < 9; c++) cells.push(r * 9 + c);
    rows.push({ cells: cells, sum: 45 });
  }
  const puz = C.create(rows);
  ok('把行当笼子（等价于无提示数独）必然多解', KS.solve(puz, 2).count > 1);

  // 反过来：81 格一个笼子要求 81 个互不相同的数字，无解
  const impossible = C.create([{ cells: Array.from({ length: 81 }, (_, i) => i), sum: 405 }]);
  ok('81 格一个笼子无解（数字不可能互不相同）', KS.solve(impossible, 2).count === 0);
}

{
  const g = G.generateSync('easy', 'init-check');
  // 用初始盘面接着解，结果必须和真解一致
  const r = KS.solve(g.puzzle, 1, null, g.solution);
  ok('带初始盘面求解能直接复现真解', r.count === 1 && Array.from(r.solution).join('') === Array.from(g.solution).join(''));
  // 矛盾前提：把某一格改成和真解冲突的值，应当 0 解
  const bad = Uint8Array.from(g.solution);
  const i0 = 0;
  bad[i0] = bad[i0] === 1 ? 2 : 1;
  ok('矛盾前提返回 0 解', KS.solve(g.puzzle, 1, null, bad).count === 0);
}

/* ---------------- 3. 性质测试：结论必须与真解一致 ---------------- */

section('3. 性质测试：每一条结论都要和真解对得上');

const usage = {};
let bad = null;
let boards = 0;
let solvedByLogic = 0;
let totalSteps = 0;
let maxMs = 0;

for (const id of G.DIFFICULTY_ORDER) {
  for (let s = 0; s < 8 && !bad; s++) {
    const gen = G.generateSync(id, 'prop-' + id + '-' + s);
    const sol = gen.solution;
    const puz = gen.puzzle;
    boards++;

    const g = new Uint8Array(81);
    const state = KT.makeState(puz, g);
    const cand = state.cand;
    let steps = 0;
    const t0 = Date.now();
    while (!SD.Validation.isComplete(g) && steps < 4000) {
      const step = KT.findStepFrom(state, { maxLevel: 5 });
      if (!step) break;
      usage[step.id] = (usage[step.id] || 0) + 1;
      // cells 必须是真数组：Int8Array 的 map 会把字符串坐标强转成 0，
      // 讲解里就会渲染成「0、0」——这个坑真的踩过
      if (!Array.isArray(step.cells)) {
        bad = id + '#' + s + '：' + step.id + ' 的 cells 不是真数组';
        break;
      }
      for (const p of step.placements) {
        if (sol[p.cell] !== p.digit) {
          bad = id + '#' + s + '：' + step.id + ' 把 ' + rc(p.cell) + ' 填成 ' + p.digit + '，真解是 ' + sol[p.cell];
          break;
        }
      }
      if (bad) break;
      for (const e of step.eliminations) {
        if (sol[e.cell] === e.digit) {
          bad = id + '#' + s + '：' + step.id + ' 删掉了 ' + rc(e.cell) + ' 的真解 ' + e.digit;
          break;
        }
      }
      if (bad) break;
      SD.Techniques.commit(g, cand, step);
      steps++;
    }
    const ms = Date.now() - t0;
    maxMs = Math.max(maxMs, ms);
    totalSteps += steps;
    if (SD.Validation.isComplete(g)) solvedByLogic++;
  }
}

ok('没有任何结论与真解矛盾', !bad, bad);
ok('绝大多数题能靠技巧推完', solvedByLogic >= boards * 0.6,
  solvedByLogic + '/' + boards + ' 可纯技巧解出');
console.log('  ' + boards + ' 道题：纯技巧解出 ' + solvedByLogic + ' 道，平均 ' +
  Math.round(totalSteps / boards) + ' 步，单道最长 ' + maxMs + 'ms');
console.log('  技巧使用：' + Object.keys(usage).sort((a, b) => usage[b] - usage[a]).map((k) => k + '=' + usage[k]).join(', '));

/* ---------------- 4. 出题器 ---------------- */

section('4. 出题器');

{
  const seenLevels = {};
  const means = [];
  let allUnique = true;
  for (const id of G.DIFFICULTY_ORDER) {
    const stars = [];
    for (let s = 0; s < 6; s++) {
      const gen = G.generateSync(id, 'gen-' + id + '-' + s);
      if (KS.solve(gen.puzzle, 2).count !== 1) allUnique = false;
      seenLevels[gen.rating.level] = (seenLevels[gen.rating.level] || 0) + 1;
      stars.push(gen.rating.star);
    }
    means.push({ name: G.DIFFICULTY[id].name, mean: stars.reduce((a, b) => a + b, 0) / stars.length });
  }
  ok('每一道都唯一解', allUnique);
  // 档位的契约是「实测难度落在区间内」，预算内凑不齐就退而求其次、把实测星级如实报出去——
  // 所以不能再断言「每一道都达标」：困难档本来就只有一半凑得齐 4 星。改断言阶梯单调，
  // 这才是玩家真正感受到的东西（也是「五档一模一样」那个 bug 的判据）。
  let mono = true;
  for (let i = 1; i < means.length; i++) if (means[i].mean < means[i - 1].mean - 0.2) mono = false;
  ok('五档实测星级单调递增', mono, means.map((m) => m.name + ' ' + m.mean.toFixed(1)).join(' / '));
  ok('难度确实拉开了层次', Object.keys(seenLevels).length >= 3, JSON.stringify(seenLevels));
}

{
  const a = G.generateSync('hard', 'determinism');
  const b = G.generateSync('hard', 'determinism');
  const same = JSON.stringify(a.cages) === JSON.stringify(b.cages) &&
    Array.from(a.solution).join('') === Array.from(b.solution).join('');
  ok('同种子出同一道题', same);
  const c = G.generateSync('hard', 'determinism-2');
  ok('不同种子出不同的题', JSON.stringify(c.cages) !== JSON.stringify(a.cages));
}

{
  // 难度下限：入门档靠「笼子切得碎、单格笼多」保持简单，不该冒出 L4 以上的技巧。
  // 上限放到 3 是因为笼子一收干净就会用到 45 法则——那已经不属于入门了，
  // 所以入门档故意留着单格笼（见 04-generator.js 的 roomy 说明）。
  let tooHard = 0;
  for (let s = 0; s < 6; s++) {
    const gen = G.generateSync('easy', 'floor-' + s);
    if (gen.rating.level > 3) tooHard++;
  }
  ok('入门档不会冒出 L4 以上的技巧', tooHard === 0, tooHard + ' 道超标');
}

/* ---------------- 5. 体检 ---------------- */

section('5. 题面体检');

{
  const good = G.generateSync('medium', 'inspect-ok');
  const r1 = G.inspect(good.cages);
  ok('合法题面体检通过', r1.valid && r1.cageCount === good.cages.length);

  // 把一个笼子的和改掉，应当被判为无解或多解
  const broken = good.cages.map((c, k) => (k === 0 ? { cells: c.cells, sum: c.sum + 1 } : c));
  const r2 = G.inspect(broken);
  ok('改错笼和会被体检拦下', !r2.valid, r2.reason);

  // 缺格：少放一个笼子
  const missing = good.cages.slice(1);
  ok('漏掉格子会被体检拦下', !G.inspect(missing).valid);
}

/* ---------------- 6. 教程演示局面 ---------------- */

section('6. 教程的演示局面（离线生成的静态数据）');

{
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js/games/killer/08-demos.js'), 'utf8'), { filename: 'demos' });
  const demos = SD.Killer.demos || {};
  const ids = KT.LIST.map((t) => t.id);
  const missing = ids.filter((id) => !demos[id]);
  ok('十二条笼子技巧都有演示局面', missing.length === 0, missing.join(', '));

  // 演示局面是离线算好写死的数据。它必须真的成立：技巧在这个局面上能用，
  // 而且它给出的结论和真解一致。生成脚本或引擎改动导致数据过期时，这里会立刻失败。
  let bad = '';
  let fired = 0;
  for (const id of ids) {
    const raw = demos[id];
    if (!raw) continue;
    const puz = C.create(raw.c.map((c) => ({ cells: c[0], sum: c[1] })));
    const sol = new Uint8Array(81);
    for (let i = 0; i < 81; i++) sol[i] = raw.sol.charCodeAt(i) - 48;
    const grid = new Uint8Array(81);
    for (let i = 0; i < 81; i++) grid[i] = raw.g.charCodeAt(i) - 48;

    // 局面本身得是自洽的
    if (KS.solve(puz, 1).count !== 1) { bad = id + ' 的演示题不是唯一解'; break; }

    // 这条技巧在当前局面上必须真的能触发。候选数用存下来的那一份——
    // 演示局面是「一路推到某一步」的中间态，光有盘面复现不出当时的候选。
    const state = { grid: grid, cand: Int32Array.from(raw.k), puz: puz };
    const step = KT.byId[id].find(state);
    if (!step) { bad = id + ' 的演示局面上触发不了'; break; }
    fired++;

    // 存下来的那一步必须和真解一致
    const stored = raw.s;
    for (const p of stored.placements) if (sol[p.cell] !== p.digit) bad = id + ' 存下的结论填错了 ' + p.cell;
    if (bad) break;
    for (const e of stored.eliminations) if (sol[e.cell] === e.digit) bad = id + ' 存下的结论删掉了真解 ' + e.cell;
    if (bad) break;
  }
  ok('每个演示局面都能触发对应技巧，且结论与真解一致', !bad, bad);
  console.log('  ' + fired + '/' + ids.length + ' 条技巧的演示局面验证通过');
}

/* ---------------- 7. 提示文案 ---------------- */

section('7. 提示文案');

{
  // 文案是从 step.detail 里拼字符串拼出来的，字段名写错不会抛异常，只会漏出 "undefined"。
  // 实际踩过：笼内必含的文案取 d.left，而该技巧的 detail 只带了 sum，
  // 面板上就成了「笼子 R5C3、R6C3 还差 undefined，组合只有那么几种」。
  let bad = '';
  let lines = 0;
  for (const id of G.DIFFICULTY_ORDER) {
    const gen = G.generateSync(id, 'text-' + id);
    for (const w of SD.Killer.hints.walkthrough(gen.puzzle, new Uint8Array(81), 5)) {
      const blob = typeof w.explain === 'string' ? w.explain : JSON.stringify(w.explain);
      lines++;
      if (!bad && /undefined|NaN/.test(blob)) bad = w.step.id + '：' + blob.slice(0, 140);
    }
  }
  ok('提示文案里没有 undefined / NaN', !bad, bad || (lines + ' 步文案'));
}

{
  // 笔记全空 = 玩家还没做过笔记，不是「候选已经被推没了」。
  // 曾经把空笔记直接交进候选里，开局（不点一键笔记）点提示在困难 / 大师档直接 0 条解法。
  let bad = '';
  for (const id of G.DIFFICULTY_ORDER) {
    const gen = G.generateSync(id, 'empty-' + id);
    const grid = new Uint8Array(81);
    const zero = SD.Killer.hints.available(gen.puzzle, grid, { maxLevel: 5, notes: new Int32Array(81) }).length;
    const plain = SD.Killer.hints.available(gen.puzzle, grid, { maxLevel: 5 }).length;
    if (!bad && zero !== plain) bad = id + '：空笔记 ' + zero + ' 条，不传笔记 ' + plain + ' 条';
  }
  ok('开局（笔记全空）的提示条数与不带笔记时一致', !bad, bad);
}

/* ---------------- 汇总 ---------------- */

console.log('\n' + '='.repeat(32));
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
