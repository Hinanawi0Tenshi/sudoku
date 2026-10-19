/* 杀手数独 · 难度分布审计（node tests/difficulty-audit.js [每档道数] [--assert]）
 *
 * 为什么要有这个脚本：档位的 minLevel / minStar 曾经全是 1，
 * 等于「切出唯一解就收」，五档产出同一个分布——实测「简单」10 道里 6 道必须试数，
 * 比「大师」还难。这种退化**不会让任何功能测试变红**，只有统计才看得见。
 *
 * --assert 模式把它变成回归测试：每档抽到的题至少八成落在自己的星级区间里。
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
]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

const G = SD.Killer.generator;
const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a)) || 8);
const assertMode = args.includes('--assert');

const hist = (xs) => {
  const h = {};
  for (const v of xs) h[v] = (h[v] || 0) + 1;
  return Object.keys(h).sort().map((k) => k + ':' + h[k]).join(' ') || '-';
};
const avg = (xs) => (xs.length ? (xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(1) : '-');

let bad = 0;
const means = [];
for (const id of G.DIFFICULTY_ORDER) {
  const cfg = G.DIFFICULTY[id];
  const stars = [];
  const levels = [];
  const times = [];
  let fail = 0;
  let hit = 0;
  let trial = 0;
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    let r;
    try {
      r = G.generateSync(id, 'audit|' + id + '|' + i);
    } catch (e) {
      fail++;
      continue;
    }
    times.push(Date.now() - t0);
    stars.push(r.rating.star);
    levels.push(r.rating.level);
    if (r.hitTarget) hit++;
    if (r.rating.needsTrial) trial++;
  }
  // 上界用「放宽后的」上限：困难档预算过半后会接受次一档（relaxMaxStar），
  // 那是有意的设计，不算不合格。
  const hi = cfg.relaxMaxStar || cfg.maxStar;
  const inRange = stars.filter((s) => s >= cfg.minStar && (!hi || s <= hi)).length;
  const rate = stars.length ? inRange / stars.length : 0;
  console.log(
    id.padEnd(7),
    'n=' + stars.length,
    'fail=' + fail,
    '| 星级', hist(stars), '均', avg(stars),
    '| 等级', hist(levels), '均', avg(levels),
    '| 需试数', trial,
    '| 达标', hit + '/' + stars.length,
    '| 区间内', inRange + '/' + stars.length,
    '| 耗时', avg(times) + 'ms'
  );
  means.push({ name: cfg.name, mean: Number(avg(stars)) });
  if (assertMode && rate < 0.8) {
    console.log('  ✗ ' + cfg.name + '：只有 ' + inRange + '/' + stars.length + ' 落在 ' +
      cfg.minStar + '–' + (hi || '∞') + ' 星区间');
    bad++;
  }
}

// 档位之间必须单调。曾经五档全是同一分布，最刺眼的表现就是「简单」比「大师」还难，
// 只看单档区间是发现不了的。
for (let i = 1; i < means.length; i++) {
  if (means[i].mean < means[i - 1].mean - 0.2) {
    console.log('  ✗ 档位顺序反了：' + means[i - 1].name + ' ' + means[i - 1].mean +
      ' 星 → ' + means[i].name + ' ' + means[i].mean + ' 星');
    bad++;
  }
}

if (assertMode) {
  if (bad) {
    console.log('\n难度分档不合格：' + bad + ' 档');
    process.exit(1);
  }
  console.log('\n难度分档合格');
}
