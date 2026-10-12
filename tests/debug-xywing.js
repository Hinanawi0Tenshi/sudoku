globalThis.window = globalThis;
const fs=require('fs'),path=require('path'),vm=require('vm');
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..','js','platform','07-util.js'),'utf8'),{filename:'util'});
for (const f of ['01-core','02-board','03-solver','04-generator','05-techniques','06-hints','07-rater'])
  vm.runInThisContext(fs.readFileSync(path.join(__dirname,'..','js/core',f+'.js'),'utf8'),{filename:f});
const { Base:B, Validation, Techniques } = globalThis.SD;

// 手工构造的 XY-Wing（不是随机局面，随机局面几乎碰不到这种 2 候选结构）：
//   枢纽 P=(0,4)={2,3}   翼1 (0,2)={2,5}   翼2 (3,4)={3,5}
//   P 与两翼各自同区域；W=(3,2) 同时看得到两翼，候选含 5 → 应删 5
const spec = [
  [[0,1],[1,4],[3,6],[5,7],[6,8],[7,9],[8,4]],   // 第 0 行
  [[1,3],[2,7],[4,7],[5,5]],                      // 第 1 行（在第 2 宫放 5，用于挤掉枢纽的 5）
  [[0,9],[1,8],[3,1],[4,8]],                      // 第 2 行
  [[0,1],[1,4],[3,6],[5,7],[6,8],[7,9],[8,6]],   // 第 3 行（W 在 (3,2)）
  [[2,9],[3,2],[4,9]],                            // 第 4 行
  [[2,1],[3,7],[4,1],[5,2]],                      // 第 5 行
  [[2,3],[4,4],[5,5]],                            // 第 6 行
  [[2,4],[4,6],[5,6]],                            // 第 7 行
  [[2,6],[4,9],[5,7]],                            // 第 8 行
];
const g = new Uint8Array(81);
for (let r=0;r<9;r++) for (const [c,v] of spec[r]) g[r*9+c] = v;

const cand = Validation.computeCandidates(g);
const show = (r,c) => { const i=r*9+c; return g[i] ? String(g[i]) : B.maskToDigits(cand[i]).join(''); };
console.log('候选网格（行列号 0 起）:');
console.log('      c0    c1    c2    c3    c4    c5    c6    c7    c8');
for (let r=0;r<9;r++) console.log('  r' + r + ' ' + Array.from({length:9},(_,c)=>String(show(r,c)).padStart(5)).join(' '));

const xy = Techniques.byId['xy-wing'].find({ grid: g, cand });
if (!xy) { console.log('\nxy-wing: null —— 构造的格局没有命中'); process.exit(1); }
console.log('\nxy-wing 命中: pivot=R' + (Math.floor(xy.detail.pivot/9)+1) + 'C' + (xy.detail.pivot%9+1) +
  ' b1=R' + (Math.floor(xy.detail.biff1/9)+1) + 'C' + (xy.detail.biff1%9+1) +
  ' b2=R' + (Math.floor(xy.detail.biff2/9)+1) + 'C' + (xy.detail.biff2%9+1) +
  ' x=' + xy.detail.x + ' y=' + xy.detail.y + ' z=' + xy.detail.z);
console.log('删除: ' + xy.eliminations.map(e => 'R' + (Math.floor(e.cell/9)+1) + 'C' + (e.cell%9+1) + ' 的 ' + e.digit).join('、'));