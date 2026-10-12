/* 扫雷 · 核心与求解器单元测试（node tests/mines-test.js）
 *
 * 最重要的一条是性质测试：求解器给出的每一个「必然安全 / 必然是雷」，
 * 都必须和真实雷分布一致。只要有一条推错，玩家按提示点下去就炸了。
 * 这比逐个技巧写用例更能防回归。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
for (const f of ['js/platform/07-util.js', 'js/games/mines/01-core.js', 'js/games/mines/02-solver.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const M = SD.Mines;
const S = M.solver;
const U = SD.Util;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');

/* ---------------- 1. 棋盘规则 ---------------- */

section('1. 棋盘规则');

{
  // 首点必安全：换 200 组种子和首点，首点连同 8 邻居都不该有雷
  let bad = null;
  for (let s = 0; s < 200 && !bad; s++) {
    const b = M.create(9, 9, 10, 'safe-' + s);
    const rng = U.makeRng('pick-' + s);
    const first = Math.floor(rng() * 81);
    M.open(b, first);
    if (b.mine[first]) bad = '首点 ' + first + ' 就是雷';
    for (const j of b.nbr[first]) if (b.mine[j]) bad = '首点邻居 ' + j + ' 是雷';
  }
  ok('首点及其 8 邻居必安全', !bad, bad);
}

{
  // 雷太密时装不下 9 格安全区，退到只保证首点本身，但仍不能一点就炸。
  // 用 73 颗：81-9=72，73 已经装不下安全区；同时留了 8 个非雷格，
  // 不会像 80 颗那样一翻开就直接通关、测不到「还在进行中」。
  const b = M.create(9, 9, 73, 'dense');
  M.open(b, 40);
  ok('雷极密时首点仍安全', !b.mine[40] && b.state === 'playing');
  ok('雷极密时不再保证 8 邻居安全', b.nbr[40].some((j) => b.mine[j]));
}

{
  let bad = null;
  for (let s = 0; s < 50 && !bad; s++) {
    const b = M.create(16, 16, 40, 'num-' + s);
    M.open(b, 128);
    for (let i = 0; i < 256 && !bad; i++) {
      let c = 0;
      for (const j of b.nbr[i]) if (b.mine[j]) c++;
      if (c !== b.num[i]) bad = '格 ' + i + ' 数字应为 ' + c + ' 实为 ' + b.num[i];
    }
  }
  ok('每格数字等于周围雷数', !bad, bad);
}

{
  // 翻开 0 格必须把整片连通 0 区域摊开，且摊开的格子一个都不能是雷
  let bad = null;
  let openedZero = 0;
  for (let s = 0; s < 60 && !bad; s++) {
    const b = M.create(16, 16, 40, 'flood-' + s);
    const r = M.open(b, 100);
    for (const i of r.changed) if (b.mine[i]) bad = '洪水展开翻出了雷 ' + i;
    // 展开区域闭合：任何被翻开的 0 格，其邻居也都该被翻开
    for (const i of r.changed) {
      if (b.num[i] === 0) {
        openedZero++;
        for (const j of b.nbr[i]) if (!b.open[j]) { bad = '0 格 ' + i + ' 的邻居 ' + j + ' 没被摊开'; break; }
      }
      if (bad) break;
    }
  }
  ok('一片空白会摊开且不翻出雷', !bad && openedZero > 0, bad);
}

{
  // 把所有非雷格翻开就该赢，并且剩下的雷自动插上旗
  const b = M.create(9, 9, 10, 'win');
  M.open(b, 40);
  for (let i = 0; i < 81; i++) if (!b.mine[i]) M.open(b, i);
  ok('翻开全部非雷格即获胜', b.state === 'won');
  ok('获胜后自动补旗', b.flags === 10);
  ok('获胜后剩余雷数为 0', M.remaining(b) === 0);
}

{
  const b = M.create(9, 9, 10, 'lose');
  M.open(b, 40);
  let hit = -1;
  for (let i = 0; i < 81; i++) if (b.mine[i]) { hit = i; break; }
  const r = M.open(b, hit);
  ok('踩到雷判负', b.state === 'lost' && r.boom === hit);
  ok('判负后不再接受落子', M.open(b, 0).ok === false);
  ok('摊出全部雷', M.revealMines(b).length === 10);
}

{
  const b = M.create(9, 9, 10, 'flag');
  M.toggleFlag(b, 0);
  const flagged = b.flag[0] === 1 && b.flags === 1;
  const blocked = M.open(b, 0).ok === false;
  M.toggleFlag(b, 0);
  ok('插旗/取消旗正确', flagged && b.flags === 0);
  ok('插了旗的格子翻不开', blocked);
}

{
  // 双击：旗数正好等于数字时把其余邻居一起翻开
  let checked = 0;
  let bad = null;
  for (let s = 0; s < 200 && !bad && checked < 30; s++) {
    const b = M.create(16, 16, 40, 'chord-' + s);
    M.open(b, 100);
    for (let i = 0; i < 256; i++) {
      if (!b.open[i] || b.num[i] <= 0) continue;
      let unknown = 0;
      for (const j of b.nbr[i]) if (!b.open[j]) unknown++;
      if (unknown === 0) continue;
      // 把周围真实的雷全插上旗，此时 chord 必然成立且不会炸
      for (const j of b.nbr[i]) if (b.mine[j] && !b.open[j]) M.toggleFlag(b, j);
      if (b.state !== 'playing') break;
      const r = M.chord(b, i);
      if (!r.ok) continue;
      checked++;
      if (r.boom >= 0) { bad = '旗插对了还炸：格 ' + i; break; }
      for (const j of r.changed) if (b.mine[j]) { bad = 'chord 翻出了雷 ' + j; break; }
      break;
    }
  }
  ok('双击展开只在旗数对得上时生效且不炸', !bad && checked >= 20, bad || ('只验证到 ' + checked + ' 次'));
}

{
  const b = M.create(9, 9, 10, 'det');
  const b2 = M.create(9, 9, 10, 'det');
  M.open(b, 40);
  M.open(b2, 40);
  ok('同种子同首点得到同一张图', b.mine.join('') === b2.mine.join(''));
  const b3 = M.create(9, 9, 10, 'det');
  M.open(b3, 41);
  ok('换个首点就是另一张图（首点参与播种）', b3.mine.join('') !== b.mine.join(''));
}

{
  const b = M.create(16, 16, 40, 'ser');
  M.open(b, 100);
  M.toggleFlag(b, 0);
  const round = M.deserialize(M.serialize(b));
  ok('存档往返后盘面完全一致',
    round.mine.join('') === b.mine.join('') && round.open.join('') === b.open.join('') &&
    round.flag.join('') === b.flag.join('') && round.state === b.state);
}

{
  ok('自定义雷数会被夹到合法范围', M.normalizeMines(9, 9, 999) === 80 && M.normalizeMines(9, 9, 0) === 1);
  ok('二项式系数正确', U.binomial(5, 2) === 10 && U.binomial(10, 0) === 1 && U.binomial(4, 9) === 0);
}

/* ---------------- 2. 求解器正确性（性质测试） ---------------- */

section('2. 求解器：所有「必然」结论必须与真实雷分布一致');

const usage = {};
let boards = 0;
let solvedPure = 0;
let guesses = 0;
let bad = null;
let maxAnalyzeMs = 0;
let enumFail = 0;
let analyses = 0;
const enumReason = {};
const proven = new Set();   // 手工夹具专门覆盖的技巧，也算「验证过能触发」

const LEVELS = M.LEVELS;

for (const lv of LEVELS) {
  for (let s = 0; s < 60 && !bad; s++) {
    const b = M.create(lv.w, lv.h, lv.mines, lv.id + '-' + s);
    const rng = U.makeRng('play-' + lv.id + '-' + s);
    M.open(b, Math.floor(rng() * lv.w * lv.h));
    boards++;

    let guard = 0;
    while (!M.isOver(b) && guard++ < 400) {
      const t0 = Date.now();
      const an = S.analyze(b, { enumerate: true });
      maxAnalyzeMs = Math.max(maxAnalyzeMs, Date.now() - t0);
      analyses++;
      if (!an.enumerated && an.unknown.length) {
        enumFail++;
        const r = an.enumReason || 'unknown';
        enumReason[r] = (enumReason[r] || 0) + 1;
      }

      // 每一条「必然」结论都要对着真实雷分布验一遍
      for (const st of an.steps) {
        usage[st.id] = (usage[st.id] || 0) + 1;
        if (!st.certain) continue;
        for (const i of st.mines) {
          if (!b.mine[i]) { bad = lv.id + '#' + s + '：' + st.id + ' 说格 ' + i + ' 是雷，实际不是'; break; }
        }
        if (bad) break;
        for (const i of st.safe) {
          if (b.mine[i]) { bad = lv.id + '#' + s + '：' + st.id + ' 说格 ' + i + ' 安全，实际是雷'; break; }
        }
        if (bad) break;
      }
      if (bad) break;

      // 概率也得对：算出 0 的必然不是雷，算出 1 的必然是雷
      for (const [i, p] of an.probs) {
        if (p === 0 && b.mine[i]) { bad = lv.id + '#' + s + '：枚举说格 ' + i + ' 概率 0，实际是雷'; break; }
        if (p === 1 && !b.mine[i]) { bad = lv.id + '#' + s + '：枚举说格 ' + i + ' 概率 1，实际不是雷'; break; }
      }
      if (bad) break;

      const best = S.bestStep(an);
      if (!best) break;
      if (!best.certain) { guesses++; break; }   // 只能猜了，纯逻辑到此为止
      if (best.safe.length) {
        for (const i of best.safe) if (!M.isOver(b)) M.open(b, i);
      } else if (best.mines.length) {
        for (const i of best.mines) M.toggleFlag(b, i);
      } else break;
    }
    if (b.state === 'won') solvedPure++;
  }
}

ok('没有任何「必然」结论与真实雷分布矛盾', !bad, bad);
ok('纯逻辑通关率不是 0（说明求解器真的在推进）', solvedPure > boards * 0.2,
  solvedPure + '/' + boards + ' 局可纯逻辑推完');

console.log('  盘面 ' + boards + ' 局：纯逻辑通关 ' + solvedPure + ' 局（' +
  Math.round(solvedPure / boards * 100) + '%），需要猜 ' + guesses + ' 次');
console.log('  分析 ' + analyses + ' 次，单次最长 ' + maxAnalyzeMs + 'ms；枚举跑不动 ' + enumFail +
  ' 次（' + Math.round(enumFail / analyses * 100) + '%）' +
  (enumFail ? '：' + Object.keys(enumReason).map((k) => k + '=' + enumReason[k]).join(', ') : ''));
console.log('  各技巧触发次数：' + Object.keys(usage).sort().map((k) => k + '=' + usage[k]).join(', '));

/* ---------------- 3. 求解器不得偷看答案 ---------------- */

section('3. 求解器只看玩家看得见的信息');

{
  // 把 mine 抹掉、只留 open/flag/num，结论必须一模一样。
  // 求解器一旦偷偷读了 b.mine，这里立刻会露馅。
  const b = M.create(16, 16, 40, 'blind');
  M.open(b, 100);
  const blind = M.deserialize(M.serialize(b));
  blind.mine.fill(0);                    // 答案擦掉
  const a1 = S.analyze(b, { enumerate: true });
  const a2 = S.analyze(blind, { enumerate: true });
  const key = (a) => a.steps.map((s) => s.id + ':' + s.mines.join(',') + ':' + s.safe.join(',')).join('|');
  ok('抹掉 b.mine 后结论不变', key(a1) === key(a2), '有结论依赖了答案字段');
  ok('抹掉 b.mine 后概率不变',
    a1.probs.size === a2.probs.size &&
    Array.from(a1.probs.keys()).every((k) => Math.abs(a1.probs.get(k) - a2.probs.get(k)) < 1e-12));
}

/* ---------------- 4. 具体技巧能触发 ---------------- */

section('4. 各级技巧都能被触发');

{
  // 手工造一个 1-2-1。这是子集规则最经典的样子，专门盯着它别退化。
  //   A B C 三个未知格横排，上面三格数字分别是 1、2、1：
  //     A+B=1、A+B+C=2、B+C=1  →  A=雷、C=雷、B=安全
  // 其余格子全部翻开且数字写 0，免得掺进别的约束、把结论来源搞混。
  const W = 7;
  const b = M.fixtures.subset121();
  const A = 3 * W + 2;
  const B = 3 * W + 3;
  const C = 3 * W + 4;
  const an = S.analyze(b, { enumerate: true });
  const safe = new Set();
  const mine = new Set();
  for (const st of an.steps) {
    if (!st.certain) continue;
    for (const i of st.safe) safe.add(i);
    for (const i of st.mines) mine.add(i);
  }
  ok('1-2-1：两端判为雷', mine.has(A) && mine.has(C));
  ok('1-2-1：中间判为安全', safe.has(B));
  ok('1-2-1：子集规则确实被用上',
    an.steps.some((st) => st.id === 'subset-mine'));
}

{
  // L1 单格规则里最基础的那条：某个数字周围的雷已经全插上旗了，剩下的未知格必然安全。
  // 自动对局里这条常被更高级的规则抢先得出结论，所以用手工夹具把它钉住。
  // 夹具由 core 提供，教程用的是同一份——免得两处各画一遍、慢慢画岔。
  const W = 5;
  const b = M.fixtures.singleSafe();
  const an0 = S.analyze(b, { enumerate: true });
  const s0 = an0.steps.find((st) => st.id === 'single-safe');
  if (s0) proven.add('single-safe');
  ok('单格规则：数字已够数时其余未知格安全', !!s0 && s0.safe.indexOf(2 * W) >= 0);
}

{
  // L2 全局规则：剩余雷数正好等于未开格数 → 剩下的全是雷
  const b = M.fixtures.globalMine();
  const an1 = S.analyze(b, { enumerate: true });
  const g1 = an1.steps.find((st) => st.id === 'global-mine');
  if (g1) proven.add('global-mine');
  ok('全局规则：剩余雷数等于未开格数时判全雷', !!g1 && g1.mines.length === 4);
}

{
  // L2 全局规则的另一半：雷全插上旗了，剩下的未知格必然安全
  const b = M.fixtures.globalSafe();
  const an2 = S.analyze(b, { enumerate: true });
  const g2 = an2.steps.find((st) => st.id === 'global-safe');
  if (g2) proven.add('global-safe');
  ok('全局规则：雷已插满旗时其余全安全', !!g2 && g2.safe.length === 2);
}

{
  const seen = Object.keys(usage).concat(Array.from(proven));
  const missing = S.TECHNIQUES.map((t) => t.id).filter((id) => !seen.includes(id) && id !== 'guess');
  console.log('  未在随机盘面上触发：' + (missing.length ? missing.join(', ') : '无'));
  ok('L1–L4 技巧都至少触发过一次', missing.length === 0, missing.join(', '));
}

/* ---------------- 汇总 ---------------- */

console.log('\n' + '='.repeat(32));
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
