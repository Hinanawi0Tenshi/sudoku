/* 2048 · 核心与求解器单元测试（node tests/g2048-test.js）
 *
 * 最重要的两条性质：
 *   1. 滑动**不改变牌的总和**——合并只是把两块合成一块、值相加。
 *      这条能一把抓住绝大多数滑动逻辑的错。
 *   2. 得分等于所有合并出的值之和（不是盘面总和的增量，那个恒为 0）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

globalThis.window = globalThis;

const ROOT = path.join(__dirname, '..');
for (const f of [
  'js/platform/07-util.js',
  'js/games/g2048/01-core.js',
  'js/games/g2048/02-solver.js',
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const G = SD.G2048;
const U = SD.Util;

let pass = 0;
const fails = [];
const ok = (name, cond, info) => {
  if (cond) pass++;
  else fails.push(name + (info ? '  — ' + info : ''));
};
const section = (t) => console.log('\n=== ' + t + ' ===');
const row = (cells, r, n) => Array.from(cells.slice(r * n, r * n + n)).join(',');

/* ---------------- 1. 关卡定义 ---------------- */

section('1. 关卡定义');

{
  ok('三档都在', G.LEVELS.length === 3, G.LEVELS.map((l) => l.id).join(','));
  ok('目标递增', G.LEVELS[0].target < G.LEVELS[1].target && G.LEVELS[1].target < G.LEVELS[2].target);
  ok('点数递增', G.LEVELS[0].points < G.LEVELS[1].points && G.LEVELS[1].points < G.LEVELS[2].points);
  ok('四个方向', G.DIRS.join(',') === 'left,right,up,down');
}

/* ---------------- 2. 滑动规则 ---------------- */

section('2. 滑动规则');

{
  const b = G.create(4);
  b.cells = Int16Array.from([2, 2, 4, 4, 0, 0, 0, 0, 2, 0, 2, 0, 4, 4, 4, 4]);
  const d = G.move(b, 'left');
  ok('第一行 [2,2,4,4] → 4,8,0,0', row(b.cells, 0, 4) === '4,8,0,0', row(b.cells, 0, 4));
  ok('第三行 [2,0,2,0] → 4,0,0,0', row(b.cells, 2, 4) === '4,0,0,0', row(b.cells, 2, 4));
  ok('第四行 [4,4,4,4] → 8,8,0,0（不能连锁）', row(b.cells, 3, 4) === '8,8,0,0', row(b.cells, 3, 4));
  ok('得分是合并出的值之和', d.gained === (4 + 8 + 4 + 8 + 8), 'gained=' + d.gained);
  ok('合并点都报出来了', d.merges.length === 5, 'merges=' + d.merges.length);
}

{
  // [2,2,2,2] 只能合成两次，不能一路连锁成 8
  const b = G.create(4);
  b.cells = Int16Array.from([2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  G.move(b, 'left');
  ok('[2,2,2,2] 左推 → 4,4,0,0', row(b.cells, 0, 4) === '4,4,0,0', row(b.cells, 0, 4));
}

{
  // 推不动时必须返回 null，而且不能算一步、不能落新牌
  const b = G.create(4);
  b.cells = Int16Array.from([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 128]);
  const before = Array.from(b.cells).join(',');
  const m = b.moves;
  const d = G.move(b, 'left');
  ok('推不动返回 null', d === null);
  ok('推不动不算步数', b.moves === m, b.moves + ' vs ' + m);
  ok('推不动不改盘面', Array.from(b.cells).join(',') === before);
}

/* ---------------- 3. 性质：总和不变 / 得分正确 ---------------- */

section('3. 性质测试');

{
  let sumBroken = 0, scoreBroken = 0, checked = 0;
  for (let s = 0; s < 400; s++) {
    const rng = U.makeRng('prop-' + s);
    const b = G.create(4);
    for (let i = 0; i < 16; i++) b.cells[i] = rng() < 0.4 ? (1 << (1 + Math.floor(rng() * 7))) : 0;
    const sum = Array.from(b.cells).reduce((x, y) => x + y, 0);
    const dir = G.DIRS[s % 4];
    const d = G.move(b, dir);
    const sum2 = Array.from(b.cells).reduce((x, y) => x + y, 0);
    checked++;
    if (sum2 !== sum) sumBroken++;
    if (d) {
      const merged = d.merges.reduce((a, m) => a + m.value, 0);
      if (d.gained !== merged) scoreBroken++;
    }
  }
  ok('滑动不改变牌的总和', sumBroken === 0, sumBroken + '/' + checked + ' 次被破坏');
  ok('得分等于合并出的值之和', scoreBroken === 0, scoreBroken + ' 次对不上');
  console.log('  验了 ' + checked + ' 个随机盘面');
}

{
  // 左右对称：把盘面镜像之后往右推，结果应该正好是往左推的镜像
  let mismatch = 0;
  for (let s = 0; s < 300; s++) {
    const rng = U.makeRng('mirror-' + s);
    const raw = new Int16Array(16);
    for (let i = 0; i < 16; i++) raw[i] = rng() < 0.35 ? (1 << (1 + Math.floor(rng() * 6))) : 0;

    const a = G.create(4); a.cells = Int16Array.from(raw); G.move(a, 'left');
    const mirror = new Int16Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mirror[r * 4 + c] = raw[r * 4 + (3 - c)];
    const b2 = G.create(4); b2.cells = mirror; G.move(b2, 'right');

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) if (a.cells[r * 4 + c] !== b2.cells[r * 4 + (3 - c)]) mismatch++;
    }
  }
  ok('左右推互为镜像', mismatch === 0, mismatch + ' 格对不上');

  // 上下同理
  let mismatch2 = 0;
  for (let s = 0; s < 300; s++) {
    const rng = U.makeRng('mirrorV-' + s);
    const raw = new Int16Array(16);
    for (let i = 0; i < 16; i++) raw[i] = rng() < 0.35 ? (1 << (1 + Math.floor(rng() * 6))) : 0;

    const a = G.create(4); a.cells = Int16Array.from(raw); G.move(a, 'up');
    const mirror = new Int16Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) mirror[r * 4 + c] = raw[(3 - r) * 4 + c];
    const b2 = G.create(4); b2.cells = mirror; G.move(b2, 'down');

    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) if (a.cells[r * 4 + c] !== b2.cells[(3 - r) * 4 + c]) mismatch2++;
    }
  }
  ok('上下推互为镜像', mismatch2 === 0, mismatch2 + ' 格对不上');
}

{
  // 滑动报出来的每条 slides，目标位置最终确实有牌；合并点的值等于两块之和
  let bad = 0;
  for (let s = 0; s < 200; s++) {
    const rng = U.makeRng('slide-' + s);
    const b = G.create(4);
    for (let i = 0; i < 16; i++) b.cells[i] = rng() < 0.4 ? (1 << (1 + Math.floor(rng() * 6))) : 0;
    const before = Int16Array.from(b.cells);
    const dir = G.DIRS[s % 4];
    const d = G.move(b, dir);
    if (!d) continue;
    for (const sl of d.slides) {
      if (!b.cells[sl.to]) bad++;
      if (!before[sl.from]) bad++;
    }
    for (const m of d.merges) {
      if (b.cells[m.to] !== m.value) bad++;
      // 合并的两块里，**本来就在目标位置**的那块不会出现在 slides 里——
      // 没动就不报，这是有意的（省掉视图里一次无意义的位移）。
      // 所以这里最多只会有 1 条位移，另一块要按"原地的就是目标位"补回来。
      const sources = d.slides.filter((x) => x.to === m.to);
      if (sources.length < 1 || sources.length > 2) { bad++; continue; }
      let sum = 0;
      for (const s of sources) sum += before[s.from];
      if (sources.length === 1) sum += before[m.to];
      if (sum !== m.value) bad++;
    }
  }
  ok('slides / merges 报的信息和盘面对得上', bad === 0, bad + ' 处对不上');
}

/* ---------------- 4. 死局与落牌 ---------------- */

section('4. 死局与落牌');

{
  const dead = G.create(4);
  dead.cells = Int16Array.from([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
  ok('棋盘交错无空格时推不动', !G.canMove(dead));
  G.settle(dead);
  ok('settle 判死局', dead.state === 'over', dead.state);

  const alive = G.create(4);
  alive.cells = Int16Array.from([2, 2, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  ok('有空格就能走', G.canMove(alive));

  const pair = G.create(4);
  pair.cells = Int16Array.from([2, 4, 8, 16, 4, 8, 16, 32, 8, 16, 32, 64, 16, 32, 64, 64]);
  ok('满盘但有相邻相同也能走', G.canMove(pair));

  const win = G.create(4);
  win.target = 2048;
  win.cells = Int16Array.from([2048, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  G.settle(win);
  ok('达到目标判胜', win.state === 'won', win.state);
}

{
  const rng = U.makeRng('spawn');
  let fours = 0;
  const N = 20000;
  for (let k = 0; k < N; k++) {
    const b = G.create(4);
    const s = G.spawn(b, rng);
    if (s.value === 4) fours++;
    if (b.cells[s.index] !== s.value) { ok('spawn 把牌落到了报出来的位置', false); break; }
  }
  ok('出 4 的比例约 10%', Math.abs(fours / N - 0.1) < 0.02, (fours / N * 100).toFixed(1) + '%');

  const full = G.create(4);
  full.cells.fill(2);
  ok('满盘落不下新牌', G.spawn(full, rng) === null);
}

{
  // 开局正好两块牌，而且是 2 或 4
  let bad = 0;
  for (let s = 0; s < 100; s++) {
    const b = G.start('classic', 'start-' + s);
    const n = Array.from(b.cells).filter(Boolean).length;
    if (n !== 2) bad++;
    for (const v of b.cells) if (v && v !== 2 && v !== 4) bad++;
  }
  ok('开局正好两块牌且都是 2/4', bad === 0, bad + ' 局');
}

/* ---------------- 5. 求解器 ---------------- */

section('5. 求解器');

{
  const b = G.create(4);
  b.cells = Int16Array.from([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const r = G.solver.rank(b, 3);
  ok('候选按期望分从高到低', r.every((x, i) => i === 0 || r[i - 1].expect >= x.expect), r.map((x) => x.dir).join(','));
  ok('推不动的方向不在候选里', r.length < 4, r.length + ' 个方向');

  const dead = G.create(4);
  dead.cells = Int16Array.from([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 2]);
  ok('死局没有候选', G.solver.rank(dead, 3).length === 0);

  // 求解器速度：提示是交互触发的，超过一两百毫秒玩家就会觉得卡
  const t = Date.now();
  for (let s = 0; s < 20; s++) G.solver.rank(G.start('classic', 'speed-' + s), 3);
  const ms = (Date.now() - t) / 20;
  ok('深度 3 平均耗时 < 150ms', ms < 150, ms.toFixed(0) + 'ms');
  console.log('  深度 3 平均 ' + ms.toFixed(0) + 'ms/次');
}

{
  // 让求解器自己打一局：打不到 1024 说明估值函数坏了
  const b = G.start('classic', 'selfplay');
  const rng = U.makeRng('selfplay|spawn');
  let guard = 0;
  while (b.state !== 'over' && guard++ < 20000) {
    const r = G.solver.rank(b, 3);
    if (!r.length) break;
    G.move(b, r[0].dir);
    G.spawn(b, rng);
    G.settle(b);
  }
  ok('求解器自己打能得到 1024 以上', G.maxTile(b) >= 1024, '最大牌 ' + G.maxTile(b) + '，得分 ' + b.score);
  console.log('  自对弈：' + b.moves + ' 步，' + b.score + ' 分，最大牌 ' + G.maxTile(b));
}

/* ---------------- 汇总 ---------------- */

console.log('\n================================');
console.log('通过 ' + pass + ' / 失败 ' + fails.length);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('全部通过 ✓');
