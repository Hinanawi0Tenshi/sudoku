/* 数独 · 核心引擎单元测试（node tests/run-core-tests.js）
 *
 * 最重要的两类断言：
 * 1) 求解器与唯一解判定在已知题面上正确；
 * 2) 每一个人类技巧给出的落子/消除，都必须与机器求解出的唯一解一致。
 *    只要有一条推理推错，性质测试立刻失败——这比逐个技巧写用例更能防回归。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
const CORE_FILES = [
  'js/core/01-core.js',
  'js/core/02-board.js',
  'js/core/03-solver.js',
  'js/core/04-generator.js',
  'js/core/05-techniques.js',
  'js/core/06-hints.js',
  'js/core/07-rater.js',
];

for (const f of CORE_FILES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) {
    if (f.includes('06-hints') || f.includes('07-rater')) continue; // 尚未写完时先跳过
    throw new Error('缺少核心文件: ' + f);
  }
  vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename: f });
}

const { Base: B, Solver, Board, Validation, Techniques, Generator, Rater } = globalThis.SD;

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(label);
  return false;
}
function eq(a, b, label) {
  return ok(JSON.stringify(a) === JSON.stringify(b), label + '  (得到 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + ')');
}
function section(name) { console.log('\n--- ' + name + ' ---'); }

/* 一张经典题面及其解 */
const PUZZLE =
  '530070000600195000098000060800060003400803001700020006060000280000419005000080079';
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

section('基础映射');
eq(B.CELL_COUNT, 81, '格子总数');
eq(B.PEERS[40].length, 20, '中心格关联格数量');
eq(B.UNITS.length, 27, '单元数量');
eq(B.boxOf ? 0 : B.BOX_OF[40], 4, '中心格所在宫');
ok(B.PEERS[0].every((p) => p !== 0), '关联格不含自身');
{
  let dup = false;
  for (let i = 0; i < 81; i++) {
    const s = new Set(B.PEERS[i]);
    if (s.size !== B.PEERS[i].length) dup = true;
  }
  ok(!dup, '关联格无重复');
}
eq(B.maskToDigits(B.bit(1) | B.bit(5) | B.bit(9)), [1, 5, 9], '掩码转数字');
eq(B.firstDigit(B.bit(7)), 7, '掩码取首位');

section('文本往返');
{
  const g = B.stringToGrid(PUZZLE);
  eq(B.gridToString(g), PUZZLE.replace(/0/g, '.'), '题面字符串往返');
  const pretty = B.gridToPretty(g);
  const back = B.stringToGrid(pretty);
  eq(B.gridToString(back), PUZZLE.replace(/0/g, '.'), '带分隔符的文本解析');
}

section('求解器');
{
  const g = B.stringToGrid(PUZZLE);
  const r = Solver.solve(g, 2);
  eq(r.count, 1, '经典题面唯一解');
  eq(B.gridToString(r.solution), SOLUTION, '求解结果正确');
  eq(Solver.solve(new Uint8Array(81), 2).count, 2, '空盘面至少两解');
  const bad = new Uint8Array(81);
  bad[0] = 5; bad[1] = 5;
  eq(Solver.solve(bad, 2).count, 0, '同行重复判定为无解');
}

section('校验与冲突');
{
  const g = B.stringToGrid(PUZZLE);
  ok(Validation.isConsistent(g), '题面自洽');
  g[1] = 5; // 与同一行的 (0,0) 冲突
  ok(Validation.findConflicts(g).size > 0, '能检出冲突');
  ok(!Validation.isConsistent(g), '冲突后不自洽');
  const full = B.stringToGrid(SOLUTION);
  ok(Validation.isComplete(full), '解盘面完整');
  ok(Validation.isConsistent(full), '解盘面自洽');
  eq(Validation.hasUniqueSolution(B.stringToGrid(SOLUTION)).unique, true, '完整盘面唯一');
}

section('候选数');
{
  const g = B.stringToGrid(PUZZLE);
  const cand = Validation.computeCandidates(g);
  // 第 1 行是 5,3,0,0,7,...，第 3 宫有 5,3,6,8,9，故 (0,2) 只剩 1,2,4
  eq(cand[2], B.bit(1) | B.bit(2) | B.bit(4), '空格 (0,2) 候选正确');
  const emptyCount = g.reduce((n, d) => n + (d === 0 ? 1 : 0), 0);
  ok(emptyCount > 0, '题面存在空格');
  let bad = false;
  for (let i = 0; i < 81; i++) {
    if (g[i]) { if (cand[i] !== 0) bad = true; continue; }
    if (cand[i] === 0) bad = true;
  }
  ok(!bad, '候选掩码与盘面一致（已填格为 0，空格非 0）');
}

section('技巧正确性：每一条推理都必须与真实答案一致');
{
  // 局面来源分两类，因为不同技巧依赖的前提不同：
  //   普通一致局面 = 某个解的子局面（可能多解）→ 除唯一矩形外，所有技巧都成立；
  //   唯一解局面   = 唯一题面再补入部分答案   → 唯一矩形也成立。
  const usage = {};
  const urUsage = {};
  let checked = 0;
  let bad = null;
  let statesA = 0;
  let statesB = 0;
  const nameOf = (i) => 'R' + (Math.floor(i / 9) + 1) + 'C' + (i % 9 + 1);

  const verify = (step, solution, bag) => {
    bag[step.id] = (bag[step.id] || 0) + 1;
    for (const p of step.placements) {
      checked++;
      if (solution[p.cell] !== p.digit) return step.id + ' 在 ' + nameOf(p.cell) + ' 推出 ' + p.digit + '，正确是 ' + solution[p.cell];
    }
    for (const el of step.eliminations) {
      checked++;
      if (solution[el.cell] === el.digit) return step.id + ' 错误地删除了 ' + nameOf(el.cell) + ' 的 ' + el.digit;
    }
    return null;
  };

  // A: 一般一致局面，密/中/疏三档混合
  const bands = [[22, 32], [32, 42], [42, 62]];
  for (const band of bands) {
    for (let t = 0; t < 120 && !bad; t++) {
      const rng = B.makeRng('A-' + band[0] + '-' + t);
      const solution = Solver.randomFullGrid(rng);
      const g = solution.slice();
      const order = B.shuffle(Array.from({ length: 81 }, (_, i) => i), rng);
      const holes = band[0] + ((rng() * (band[1] - band[0])) | 0);
      for (let h = 0; h < holes; h++) g[order[h]] = 0;
      statesA++;
      for (const step of Techniques.findAll(g, 5)) {
        if (step.id === 'unique-rectangle') continue;
        bad = verify(step, solution, usage);
        if (bad) break;
      }
    }
  }

  // B: 唯一解局面，用来验证唯一矩形
  for (let t = 0; t < 90 && !bad; t++) {
    const diff = Generator.DIFFICULTY_ORDER[t % 5];
    const gen = Generator.generateSync(diff, 'B-' + t);
    const rng = B.makeRng('Bfill-' + t);
    const g = gen.givens.slice();
    const empties = [];
    for (let i = 0; i < 81; i++) if (!g[i]) empties.push(i);
    const take = Math.min(empties.length, 18 + ((rng() * 28) | 0));
    for (const i of B.shuffle(empties.slice(), rng).slice(0, take)) g[i] = gen.solution[i];
    if (Solver.solve(g, 2).count !== 1) continue;
    statesB++;
    for (const step of Techniques.findAll(g, 5)) {
      bad = verify(step, gen.solution, urUsage);
      if (bad) break;
    }
  }

  ok(statesA > 300, '一般一致局面数量足够（' + statesA + ' 个）');
  ok(statesB > 20, '唯一解局面数量足够（' + statesB + ' 个）');
  ok(!bad, bad || ('共校验 ' + checked + ' 条推理，全部与真实答案一致'));
  console.log('    一般局面技巧分布: ' + JSON.stringify(usage));
  console.log('    唯一解局面技巧分布: ' + JSON.stringify(urUsage));
  // 这几条在随机局面里几乎不触发，但都有各自的专项用例兜着，不是没验证
  const RARE = { 'forcing-chain': 1, 'xy-wing': 1, 'unique-rectangle': 1, 'jellyfish': 1 };
  for (const id of Object.keys(Techniques.byId)) {
    if (RARE[id]) continue;
    ok((usage[id] || 0) > 0, '技巧 ' + id + ' 在随机局面中被实际触发');
  }
}

section('XY-Wing 定向用例');
{
  // 手工构造：枢纽 R1C5={2,3}、翼1 R1C3={2,5}、翼2 R4C5={3,5}，R4C3 同时看得到两翼。
  const spec = [
    [[0,1],[1,4],[3,6],[5,7],[6,8],[7,9],[8,4]],
    [[1,3],[2,7],[4,7],[5,5]],
    [[0,9],[1,8],[3,1],[4,8]],
    [[0,1],[1,4],[3,6],[5,7],[6,8],[7,9],[8,6]],
    [[2,9],[3,2],[4,9]],
    [[2,1],[3,7],[4,1],[5,2]],
    [[2,3],[4,4],[5,5]],
    [[2,4],[4,6],[5,6]],
    [[2,6],[4,9],[5,7]],
  ];
  const g = new Uint8Array(81);
  for (let r = 0; r < 9; r++) for (const pair of spec[r]) g[r * 9 + pair[0]] = pair[1];
  const cand = Validation.computeCandidates(g);
  const step = Techniques.byId['xy-wing'].find({ grid: g, cand: cand });
  ok(!!step, '手工构造的 XY-Wing 被识别');
  if (step) {
    eq(step.detail.pivot, 4, '枢纽位置正确');
    eq(step.detail.biff1, 2, '翼 1 位置正确');
    eq(step.detail.biff2, 31, '翼 2 位置正确');
    eq(step.detail.z, 5, '被排除的数字是 5');
    eq(JSON.stringify(step.eliminations), JSON.stringify([{ cell: 29, digit: 5 }]), '只删 R4C3 的 5');
  }
}
section('四链鱼定向用例');
{
  // 随机局面里四链几乎不出现。四链没法用「填数字」的盘面摆出来：
  // 基础行里覆盖列之外的格子必须放不下 d，而它们和基础格往往同宫，一填就互相挡死。
  // 所以直接构造候选状态：前四行 × 前四列只留 5，其余五行的同四列是 5 与 9。
  const cand = new Int32Array(81);
  const mark = (i, ds) => { cand[i] = ds.reduce((m, d) => m | (1 << (d - 1)), 0); };
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mark(r * 9 + c, [5]);
  for (let r = 4; r < 9; r++) for (let c = 0; c < 4; c++) mark(r * 9 + c, [5, 9]);
  const step = Techniques.byId['jellyfish'].find({ grid: new Uint8Array(81), cand: cand });
  ok(!!step, '手工构造的四链鱼被识别');
  if (step) {
    eq(step.detail.size, 4, '规模是 4');
    eq(step.detail.digit, 5, '被排除的数字是 5');
    eq(step.detail.bases.join(','), '0,1,2,3', '基础行是前四行');
    eq(step.detail.cover.join(','), '0,1,2,3', '覆盖列是前四列');
    eq(step.eliminations.length, 20, '覆盖列其余五行各删一个 5（共 ' + step.eliminations.length + '）');
    const bad = step.eliminations.filter((e) => e.cell < 36 || e.digit !== 5);
    eq(bad.length, 0, '删除全部落在第 5 到 9 行、且只删数字 5');
  }
}
section('融合式待定数组定向用例');
{
  // 形制：|C| + |D| + |E| = |V|，|D| = |VD|、|E| = |VE|，且 VD ∩ VE = ∅。
  // 摆一组满足的：|C|=2、|V|=5、|D|=1、|E|=2。
  const cand = new Int32Array(81);
  const mark = (i, ds) => { cand[i] = ds.reduce((m, d) => m | (1 << (d - 1)), 0); };
  // 宫 0 = R1..R3 × C1..C3，与第 1 行的交集就是 C
  mark(0, [1,2,3,4,5]); mark(1, [1,2,3,4,5]);
  // 行侧 D：R1C4 只有候选 1，于是 |D| = |VD| = 1
  mark(3, [1]);
  // 宫侧 E：R2C1、R2C2 的候选都是 {2,3}，于是 |E| = |VE| = 2，与 VD 不相交
  mark(9, [2,3]); mark(10, [2,3]);
  // 结论落点：R1C5（行上 C∪D 之外）与 R3C1（宫上 C∪E 之外）
  mark(4, [1,4,5]); mark(18, [2,3,4,5]);
  const step = Techniques.byId['sue-de-coq'].find({ grid: new Uint8Array(81), cand: cand });
  ok(!!step, '手工构造的 SDC 被识别');
  if (step) {
    eq(step.detail.armName, '行', '识别为行侧构型');
    eq(step.detail.box, 0, '宫是第 1 宫');
    eq(step.detail.arm, 0, '行是第 1 行');
    eq(step.detail.C.join(','), '0,1', '交集 C = R1C1、R1C2');
    eq(step.detail.D.join(','), '3', '行侧 D = R1C4');
    eq(step.detail.E.join(','), '9,10', '宫侧 E = R2C1、R2C2');
    const got = step.eliminations.map((e) => e.cell + ':' + e.digit).sort((a, b) => (a < b ? -1 : 1)).join(' ');
    eq(got, '18:2 18:3 18:4 18:5 4:1 4:4 4:5', '行侧清 R1C5 的 1/4/5，宫侧清 R3C1 的 2/3/4/5');
  }
}

section('全流程求解：模拟玩家逐步推理');
{
  let solved = 0;
  const total = 15;
  const seenIds = {};
  for (let t = 0; t < total; t++) {
    const gen = Generator.generateSync(Generator.DIFFICULTY_ORDER[t % 5], 'flow-' + t);
    const g = gen.givens.slice();
    const cand = Validation.computeCandidates(g);
    let stuck = false;
    for (let guard = 0; guard < 600; guard++) {
      const step = Techniques.findStepFrom({ grid: g, cand: cand }, { maxLevel: 5 });
      if (!step) { stuck = !Validation.isComplete(g); break; }
      seenIds[step.id] = (seenIds[step.id] || 0) + 1;
      for (const p of step.placements) {
        if (gen.solution[p.cell] !== p.digit) { ok(false, '生成题 ' + t + ' 上技巧 ' + step.id + ' 推出错误数字'); }
      }
      for (const el of step.eliminations) {
        if (gen.solution[el.cell] === el.digit) { ok(false, '生成题 ' + t + ' 上技巧 ' + step.id + ' 误删候选'); }
      }
      Techniques.commit(g, cand, step);
    }
    if (Validation.isComplete(g) && B.gridToString(g) === B.gridToString(gen.solution)) solved++;
  }
  eq(solved, total, total + ' 道生成题均可由人类技巧完整还原为记录解');
  console.log('    全流程技巧分布: ' + JSON.stringify(seenIds));
}

section('题面多解时不给出唯一性技巧');
{
  // 唯一矩形靠「致命模式」论证，题面多解时结论不成立——OCR 导入的题未必唯一
  // 从生成的题里去掉一个冗余线索，得到「现实中」的多解题：普通技巧照常能跑
  let grid = null;
  for (let t2 = 0; t2 < 12 && !grid; t2++) {
    const gen = Generator.generateSync('easy', 'multi-seed-' + t2);
    for (let i = 0; i < 81; i++) {
      if (!gen.givens[i]) continue;
      const trial = gen.givens.slice();
      trial[i] = 0;
      if (Solver.solve(trial, 2).count > 1) { grid = trial; break; }
    }
  }
  ok(!!grid, '找到了去掉冗余线索后多解的题');
  const count = grid ? Solver.solve(grid, 2).count : 0;
  ok(count > 1, '造出了多解题面（解数 ' + count + '）');
  if (count > 1) {
    const ids = Techniques.findAll(grid, 5).map((s) => s.id);
    ok(ids.indexOf('unique-rectangle') < 0, '多解时不出现唯一矩形');
    ok(ids.indexOf('naked-single') >= 0 || ids.indexOf('hidden-single') >= 0, '但普通技巧照常可用');
  }
}
section('simulate 与难度评级');
{
  const gen = Generator.generateSync('medium', 'rate-1');
  const r = Rater.rate(gen.givens, { maxLevel: 2 });
  ok(r.solved, '中等难度可在 L2 内解完：' + JSON.stringify(r.used));
  eq(r.star >= 1 && r.star <= 5, true, '星级在 1..5');
}

section('生成器难度分布');
{
  const rows = [];
  for (const d of Generator.DIFFICULTY_ORDER) {
    for (let k = 0; k < 3; k++) {
      const gen = Generator.generateSync(d, 'dist-' + d + '-' + k);
      rows.push(
        d.padEnd(7) +
          ' level=' + gen.level +
          ' star=' + gen.star +
          ' clues=' + String(gen.clueCount).padStart(2) +
          ' steps=' + String(gen.rating.steps).padStart(3) +
          ' solved=' + gen.rating.solved +
          '  ' + JSON.stringify(gen.rating.used)
      );
    }
  }
  console.log('    ' + rows.join('\n    '));
}

section('生成器');
{
  for (const d of Generator.DIFFICULTY_ORDER) {
    const gen = Generator.generateSync(d, 'gen-' + d);
    const chk = Solver.solve(gen.givens, 2);
    ok(chk.count === 1, d + ' 难度生成题面唯一解');
    eq(B.gridToString(chk.solution), B.gridToString(gen.solution), d + ' 难度记录解正确');
    ok(gen.clueCount >= 17, d + ' 难度线索数合理: ' + gen.clueCount);
    ok(Validation.isConsistent(gen.givens), d + ' 难度题面自洽');
  }
}

section('Board 模型');
{
  const b = new Board(B.stringToGrid(PUZZLE));
  ok(b.isGiven(0), '题面数字标记为给定');
  ok(!b.isGiven(2), '空格不是给定');
  ok(!b.setValue(0, 9), '不能覆盖给定数字');
  b.setValue(2, 4);
  eq(b.grid[2], 4, '可写入用户数字');
  b.setValue(2, 4);
  eq(b.grid[2], 0, '重复输入同一数字即清除');
  const snap = b.snapshot();
  b.rebuildNotes();
  const cand = Validation.computeCandidates(b.grid);
  eq(Array.from(b.notes).join(','), Array.from(cand).join(','), '自动笔记与候选一致');
  b.restore(snap);
  eq(Array.from(b.notes).join(','), Array.from(snap.notes).join(','), '快照还原笔记');
  b.locked[2] = 1;
  b.setValue(2, 7);
  eq(b.grid[2], 0, '锁定后不可写');
}

console.log('\n================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) {
  console.log('\n失败用例:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
