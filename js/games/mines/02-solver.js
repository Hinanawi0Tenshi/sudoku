/* 扫雷 · 推理求解器
 *
 * 只用玩家看得见的信息推导：已翻开格上的数字、插的旗、剩余雷数。
 * 结论必须可证明——「看起来像」的猜测单独归到 L5 并明确标成猜，
 * 不混进「必然安全」里，否则玩家按提示点下去就炸了。
 *
 * 技巧分级和数独一个路子：
 *   L1 单格规则  一个数字周围的未知格已经够数 / 正好全是雷
 *   L2 全局雷数  剩余雷数把整片未知区域定死
 *   L3 子集规则  两个数字的未知格互相包含，差集能直接判定
 *               （1-2-1、1-2-2-1 这些口口相传的形状都是它的特例）
 *   L4 枚举求解  把边界格穷举一遍，逐格算「必然安全 / 必然是雷」
 *   L5 概率猜测  没有必然解时的最优猜法
 *
 * 求解器只读 b.open / b.flag / b.num（已翻开格）和 b.mines，
 * 绝不读 b.mine——那是答案。tests/mines-test.js 里有专门的断言盯着这条。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const M = (SD.Mines = SD.Mines || {});
  const U = SD.Util;

  // 单个连通分量的规模上限。只是个防呆值，真正卡住时间的是下面两个上限。
  const ENUM_CELL_LIMIT = 200;
  // 解数与搜索节点双上限。光卡解数不够——一棵只长不结果的分支照样能把页面冻住。
  const ENUM_SOL_LIMIT = 100000;
  const ENUM_NODE_LIMIT = 400000;

  const LEVEL_NAME = { 1: '基础', 2: '排除', 3: '进阶', 4: '高级', 5: '专家' };

  const TECHNIQUES = [
    { id: 'single-safe', level: 1, name: '单格规则 · 已够数' },
    { id: 'single-mine', level: 1, name: '单格规则 · 全是雷' },
    { id: 'global-safe', level: 2, name: '全局雷数 · 其余安全' },
    { id: 'global-mine', level: 2, name: '全局雷数 · 其余是雷' },
    { id: 'subset-mine', level: 3, name: '子集规则 · 差集是雷' },
    { id: 'subset-safe', level: 3, name: '子集规则 · 差集安全' },
    { id: 'enumerate-safe', level: 4, name: '枚举求解 · 必然安全' },
    { id: 'enumerate-mine', level: 4, name: '枚举求解 · 必然是雷' },
    { id: 'guess', level: 5, name: '概率猜测' },
  ];

  const popcount = (m) => {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  };

  /* ---------------- 约束 ---------------- */

  /**
   * 把当前盘面翻译成一组「某几格里有 need 颗雷」的约束。
   * 全局雷数也写成一个约束（cells = 所有未知格），这样子集规则会自动
   * 拿它和每个数字比一遍，不用再单独写一套组合逻辑。
   */
  function buildConstraints(b) {
    const n = b.w * b.h;
    const cons = [];
    const conflict = [];
    for (let i = 0; i < n; i++) {
      if (!b.open[i] || b.num[i] <= 0) continue;
      const cells = [];
      let flags = 0;
      for (const j of b.nbr[i]) {
        if (b.open[j]) continue;
        if (b.flag[j]) flags++;
        else cells.push(j);
      }
      if (!cells.length) continue;
      const need = b.num[i] - flags;
      // need 越界 = 玩家插的旗和这个数字对不上。此时下面所有推导都建立在错前提上，
      // 得先把这件事说出来，而不是继续给「必然安全」。
      if (need < 0 || need > cells.length) { conflict.push(i); continue; }
      cons.push({ from: i, cells: cells, need: need, global: false });
    }
    const unknown = [];
    for (let i = 0; i < n; i++) if (!b.open[i] && !b.flag[i]) unknown.push(i);
    const left = b.mines - b.flags;
    if (left < 0) conflict.push(-1);
    else if (unknown.length && left <= unknown.length) {
      cons.push({ from: -1, cells: unknown, need: left, global: true });
    }
    return { cons: cons, conflict: conflict, unknown: unknown, remaining: left };
  }

  /* ---------------- L1 / L2 ---------------- */

  function directRules(b, ctx) {
    const out = [];
    for (const c of ctx.cons) {
      if (c.global) continue;
      if (c.need === 0) {
        out.push({
          id: 'single-safe', level: 1, from: [c.from], mines: [], safe: c.cells.slice(),
          certain: true, detail: { kind: 'single-safe', num: b.num[c.from], need: c.need, count: c.cells.length },
        });
      } else if (c.need === c.cells.length) {
        out.push({
          id: 'single-mine', level: 1, from: [c.from], mines: c.cells.slice(), safe: [],
          certain: true, detail: { kind: 'single-mine', num: b.num[c.from], need: c.need, count: c.cells.length },
        });
      }
    }
    const g = ctx.cons.find((c) => c.global);
    if (g) {
      if (g.need === 0) {
        out.push({
          id: 'global-safe', level: 2, from: [], mines: [], safe: g.cells.slice(),
          certain: true, detail: { kind: 'global', remaining: g.need, count: g.cells.length },
        });
      } else if (g.need === g.cells.length) {
        out.push({
          id: 'global-mine', level: 2, from: [], mines: g.cells.slice(), safe: [],
          certain: true, detail: { kind: 'global', remaining: g.need, count: g.cells.length },
        });
      }
    }
    return out;
  }

  /* ---------------- L3 子集规则 ---------------- */

  /**
   * 对每一对约束 (A, B)：若 A 的未知格全部落在 B 里，
   * 那么 B 比 A 多出来的那几格，放雷数就是 need(B) - need(A)。
   *   - 等于差集格数 → 差集全是雷
   *   - 等于 0        → 差集全安全
   * 1-2-1 的中间那格、1-2-2-1 的两端，都是这条规则在特定形状上的样子。
   */
  function subsetRules(ctx, cellCount) {
    const out = [];
    const cons = ctx.cons;
    // mark 标的是「B 里的格子」。判断 A ⊆ B 必须拿 A 的格子去查这张表——
    // 查 A 自己那张表是恒真的，会把任意一对约束都当成包含关系，推出满盘错误结论。
    const mark = new Uint8Array(cellCount);
    for (let i = 0; i < cons.length; i++) {
      const A = cons[i];
      const inA = new Set(A.cells);
      for (let j = 0; j < cons.length; j++) {
        if (i === j) continue;
        const B = cons[j];
        if (B.cells.length <= A.cells.length) continue;
        for (let k = 0; k < B.cells.length; k++) mark[B.cells[k]] = 1;
        let inside = true;
        for (let k = 0; k < A.cells.length; k++) {
          if (!mark[A.cells[k]]) { inside = false; break; }
        }
        if (inside) {
          const diff = [];
          for (let k = 0; k < B.cells.length; k++) {
            if (!inA.has(B.cells[k])) diff.push(B.cells[k]);
          }
          const d = B.need - A.need;
          if (d === diff.length) {
            out.push({
              id: 'subset-mine', level: 3,
              from: [A.from, B.from].filter((x) => x >= 0),
              mines: diff, safe: [], certain: true,
              detail: { kind: 'subset', aFrom: A.from, bFrom: B.from, aNeed: A.need, bNeed: B.need, diff: diff.length },
            });
          } else if (d === 0) {
            out.push({
              id: 'subset-safe', level: 3,
              from: [A.from, B.from].filter((x) => x >= 0),
              mines: [], safe: diff, certain: true,
              detail: { kind: 'subset', aFrom: A.from, bFrom: B.from, aNeed: A.need, bNeed: B.need, diff: diff.length },
            });
          }
        }
        for (let k = 0; k < B.cells.length; k++) mark[B.cells[k]] = 0;
      }
    }
    return out;
  }

  /* ---------------- L4 枚举 ---------------- */

  /**
   * 一个连通分量内所有满足局部约束的布雷方案。
   *
   * 用「逐格计数」而不是位掩码：位掩码卡在 32 位，而扫雷的边界分量动辄四五十格，
   * 一超限就整块放弃，L4/L5 会几乎永远用不上。
   *
   * 格子按「被多少条约束盯着」降序排：先定最受限的格子，剪枝早得多。
   * 返回的 cells 是新顺序，dist / cellByMine 都按这个顺序组织。
   */
  function enumComponent(cells, cons, solLimit, nodeLimit) {
    const degree = new Map();
    for (const c of cons) for (const x of c.cells) degree.set(x, (degree.get(x) || 0) + 1);
    const ordered = cells.slice().sort((a, b) => (degree.get(b) || 0) - (degree.get(a) || 0));
    const k = ordered.length;
    const pos = new Map();
    for (let i = 0; i < k; i++) pos.set(ordered[i], i);

    const items = cons.map((c) => ({
      idx: c.cells.map((x) => pos.get(x)),
      need: c.need,
      got: 0,      // 已放了几颗雷
      done: 0,     // 已分配了几格
      total: c.cells.length,
    }));
    const at = new Array(k);
    const closed = new Array(k);
    for (let q = 0; q < k; q++) { at[q] = []; closed[q] = []; }
    for (const it of items) {
      let mx = -1;
      for (const q of it.idx) {
        at[q].push(it);
        if (q > mx) mx = q;
      }
      closed[mx].push(it);
    }

    // dist[m] = 放 m 颗雷的方案数；cellByMine[q][m] = 第 q 格是雷且总共 m 颗的方案数
    const dist = new Float64Array(k + 1);
    const cellByMine = new Array(k);
    for (let q = 0; q < k; q++) cellByMine[q] = new Float64Array(k + 1);
    const assign = new Uint8Array(k);
    let sols = 0;
    let nodes = 0;
    let overflow = false;

    (function dfs(p, mines) {
      if (overflow) return;
      if (++nodes > nodeLimit) { overflow = true; return; }
      if (p === k) {
        dist[mines]++;
        for (let q = 0; q < k; q++) if (assign[q]) cellByMine[q][mines]++;
        if (++sols > solLimit) overflow = true;
        return;
      }
      for (let v = 0; v <= 1; v++) {
        assign[p] = v;
        let ok = true;
        const touched = at[p];
        for (const it of touched) {
          if (v) it.got++;
          it.done++;
          // 放超了，或者剩下的格子就算全放也不够数，两条都能直接砍
          if (it.got > it.need || it.got + (it.total - it.done) < it.need) ok = false;
        }
        if (ok) {
          // 这条约束的格子全部分配完了，这时必须正好等于 need
          for (const it of closed[p]) {
            if (it.got !== it.need) { ok = false; break; }
          }
        }
        if (ok) dfs(p + 1, mines + v);
        for (const it of touched) {
          if (v) it.got--;
          it.done--;
        }
        if (overflow) return;
      }
      assign[p] = 0;
    })(0, 0);

    return overflow ? null : { cells: ordered, dist: dist, cellByMine: cellByMine, sols: sols };
  }

  function conv(a, b) {
    const out = new Float64Array(a.length + b.length - 1);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      for (let j = 0; j < b.length; j++) {
        if (b[j]) out[i + j] += a[i] * b[j];
      }
    }
    return out;
  }

  /**
   * 全盘枚举。
   *
   * 边界格按共享约束拆成互不相干的连通分量，各自枚举；再用前缀/后缀卷积把
   * 各分量组合起来，只保留「总雷数正好等于剩余雷数」的组合。
   * 剩下那些不挨着任何数字的「深海格」彼此完全对称，用组合数一次算掉，
   * 不需要也不应该一个个枚举（480 格穷举是 10^144 量级）。
   */
  function enumerateAll(b, ctx) {
    const n = b.w * b.h;
    const frontier = [];
    const isFrontier = new Uint8Array(n);
    // 只用「数字格」的约束来划边界。全局约束覆盖了所有未知格，
    // 一旦把它算进连通性，整片边界会被串成一个巨型分量、次次超限，
    // L4/L5 就永远用不上——而全局雷数本来就由后面那步卷积管着，不归分量管。
    const local = ctx.cons.filter((c) => !c.global);
    for (const c of local) {
      for (const i of c.cells) {
        if (!isFrontier[i]) { isFrontier[i] = 1; frontier.push(i); }
      }
    }
    const nonFrontier = ctx.unknown.filter((i) => !isFrontier[i]);
    const nf = nonFrontier.length;

    if (!frontier.length) {
      const total = U.binomial(nf, ctx.remaining);
      const p = nf ? ctx.remaining / nf : 0;
      const probs = new Map();
      for (const i of nonFrontier) probs.set(i, p);
      return { ok: true, frontier: frontier, nonFrontier: nonFrontier, probs: probs, total: total };
    }

    // 并查集：同一条约束里的边界格算一个分量
    const parent = new Map();
    const find = (x) => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; }
      return r;
    };
    for (const i of frontier) parent.set(i, i);
    for (const c of local) {
      for (let k = 1; k < c.cells.length; k++) {
        const a = find(c.cells[0]);
        const bb = find(c.cells[k]);
        if (a !== bb) parent.set(a, bb);
      }
    }
    const groups = new Map();
    for (const i of frontier) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }

    const comps = [];
    for (const cells of groups.values()) {
      if (cells.length > ENUM_CELL_LIMIT) return { ok: false, reason: 'too-big', probs: new Map() };
      const cellSet = new Set(cells);
      const cons = local.filter((c) => cellSet.has(c.cells[0]));
      const got = enumComponent(cells, cons, ENUM_SOL_LIMIT, ENUM_NODE_LIMIT);
      if (!got) return { ok: false, reason: 'too-many', probs: new Map() };
      comps.push(got);
    }

    const dists = comps.map((c) => c.dist);
    const prefix = [Float64Array.from([1])];
    for (let i = 0; i < comps.length; i++) prefix.push(conv(prefix[i], dists[i]));
    const suffix = new Array(comps.length + 1);
    suffix[comps.length] = Float64Array.from([1]);
    for (let i = comps.length - 1; i >= 0; i--) suffix[i] = conv(dists[i], suffix[i + 1]);

    // 深海格的组合数只取决于「还要放几颗」，先查表免得在内层循环里反复算
    const maxK = comps.reduce((m, c) => m + c.cells.length, 0) + 1;
    const binom = new Float64Array(maxK + 1);
    for (let k = 0; k <= maxK; k++) binom[k] = U.binomial(nf, ctx.remaining - k);

    const full = prefix[comps.length];
    let total = 0;
    for (let m = 0; m < full.length; m++) if (full[m]) total += full[m] * binom[m];
    if (!total) return { ok: true, frontier: frontier, nonFrontier: nonFrontier, probs: new Map(), total: 0 };

    const count = new Float64Array(n);
    for (let i = 0; i < comps.length; i++) {
      const others = conv(prefix[i], suffix[i + 1]);
      const comp = comps[i];
      const k = comp.cells.length;
      // 同一雷数下的所有方案共享一个权重。先按雷数把权重算好，
      // 再乘「该格在该雷数下有几种方案」，就不必逐个方案重算了。
      const weight = new Float64Array(k + 1);
      for (let m = 0; m <= k; m++) {
        let w = 0;
        for (let t = 0; t < others.length; t++) {
          if (!others[t]) continue;
          const c = binom[m + t];
          if (c) w += others[t] * c;
        }
        weight[m] = w;
      }
      for (let q = 0; q < k; q++) {
        const col = comp.cellByMine[q];
        let acc = 0;
        for (let m = 0; m <= k; m++) if (col[m]) acc += col[m] * weight[m];
        count[comp.cells[q]] += acc;
      }
    }

    const probs = new Map();
    for (let i = 0; i < frontier.length; i++) probs.set(frontier[i], count[frontier[i]] / total);

    // 深海格：期望雷数 = 总雷数 - 边界上的期望雷数，再平摊到每一格
    let expFrontier = 0;
    for (let m = 0; m < full.length; m++) if (full[m]) expFrontier += full[m] * m * binom[m];
    const nfProb = nf ? (ctx.remaining * total - expFrontier) / (nf * total) : 0;
    for (const i of nonFrontier) probs.set(i, nfProb);

    return { ok: true, frontier: frontier, nonFrontier: nonFrontier, probs: probs, total: total };
  }

  /* ---------------- 汇总 ---------------- */

  /**
   * @param {object} b 棋盘
   * @param {object} [opts] { enumerate: false } 跳过 L4/L5（只想要 L1–L3 时用）
   */
  function analyze(b, opts) {
    const o = opts || {};
    const ctx = buildConstraints(b);
    const steps = [];
    const seen = Object.create(null);
    const result = {
      remaining: ctx.remaining,
      unknown: ctx.unknown,
      conflict: ctx.conflict.slice(),
      inconsistent: false,
      frontier: [],
      nonFrontier: ctx.unknown,
      probs: new Map(),
      enumerated: false,
      enumReason: null,
      total: 0,
      steps: steps,
    };

    if (ctx.conflict.length) return result;

    let en = null;
    if (o.enumerate !== false && ctx.unknown.length) {
      en = enumerateAll(b, ctx);
      result.enumerated = !!en.ok;
      result.enumReason = en.reason || null;
      result.frontier = en.frontier || [];
      result.nonFrontier = en.nonFrontier || ctx.unknown;
      result.probs = en.probs || new Map();
      result.total = en.total || 0;
      // 一个可行方案都没有 = 玩家插的旗自相矛盾。这时任何「必然」结论都是空话，
      // 说出来就好，别拿它当提示——那比不给提示更糟。
      if (en.ok && en.total === 0) { result.inconsistent = true; return result; }
    }

    function push(step) {
      const key = step.id + '|' + step.mines.join(',') + '|' + step.safe.join(',');
      if (seen[key]) return;
      seen[key] = 1;
      steps.push(step);
    }

    for (const s of directRules(b, ctx)) push(s);
    for (const s of subsetRules(ctx, b.w * b.h)) push(s);

    if (en && en.ok && en.total) {
      const certainSafe = [];
      const certainMine = [];
      for (const i of result.frontier) {
        const p = result.probs.get(i);
        if (p === 0) certainSafe.push(i);
        else if (p === 1) certainMine.push(i);
      }
      // 深海格要么全是雷、要么全安全，只有一种可能时也算必然结论
      const nfP = result.nonFrontier.length ? result.probs.get(result.nonFrontier[0]) : null;
      if (nfP === 0) for (const i of result.nonFrontier) certainSafe.push(i);
      else if (nfP === 1) for (const i of result.nonFrontier) certainMine.push(i);

      const hit = new Set(certainSafe.concat(certainMine));
      const from = ctx.cons.filter((c) => c.from >= 0 && c.cells.some((x) => hit.has(x))).map((c) => c.from);
      if (certainSafe.length) {
        push({ id: 'enumerate-safe', level: 4, from: from, mines: [], safe: certainSafe, certain: true, detail: { kind: 'enum', total: en.total } });
      }
      if (certainMine.length) {
        push({ id: 'enumerate-mine', level: 4, from: from, mines: certainMine, safe: [], certain: true, detail: { kind: 'enum', total: en.total } });
      }
    }

    steps.sort(byLevel);

    // 没有任何必然结论时才给猜测建议。有必然解还让人猜，等于把提示做废了。
    if (!steps.length && result.enumerated && result.probs.size) {
      let best = null;
      for (const p of result.probs.values()) if (best === null || p < best) best = p;
      if (best !== null) {
        const cells = [];
        for (const [cell, p] of result.probs) if (p <= best + 1e-12) cells.push(cell);
        steps.push({
          id: 'guess', level: 5, from: [], mines: [], safe: [], suggest: cells,
          certain: false, detail: { kind: 'guess', prob: best, total: result.total },
        });
      }
    }

    return result;
  }

  const byLevel = (a, b) => a.level - b.level || a.id.localeCompare(b.id);

  /** 拿一条能直接执行的推理：最优先「必然安全」的格子，其次是「必然是雷」 */
  function bestStep(analysis) {
    for (const s of analysis.steps) if (s.certain && s.safe.length) return s;
    for (const s of analysis.steps) if (s.certain && s.mines.length) return s;
    return analysis.steps[0] || null;
  }

  M.solver = {
    LEVEL_NAME: LEVEL_NAME,
    TECHNIQUES: TECHNIQUES,
    buildConstraints: buildConstraints,
    analyze: analyze,
    bestStep: bestStep,
  };
})(window);
