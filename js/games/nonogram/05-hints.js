/* 数织 · 提示与讲解
 *
 * 数织的推理只有一件事：**看一行（或一列），把它的线索所有合法摆法列出来，
 * 逐格看结论是否一致**。所以提示不是"猜下一步"，而是"哪一行的哪几格被逼死了"。
 *
 * 技巧分四档，按"玩家需要想多深"排：
 *   L1 唯一摆法  这一行只剩一种摆法了，直接读出来
 *   L2 重叠法    这一段无论从哪开始，都会盖住某几格 → 那几格一定实心
 *   L2 排除法    这一段无论怎么放都盖不到某几格 → 那几格一定为空
 *   L4 假设矛盾  某格填实心会导致整行/整列无解
 *
 * 重叠法是数织最值得教的一条，也是新手最容易卡住的地方。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  const UNKNOWN = 0, FILLED = 1, MARKED = 2;

  const TECH = {
    only:    { id: 'only',    level: 1, name: '唯一摆法' },
    overlap: { id: 'overlap', level: 2, name: '重叠法' },
    exclude: { id: 'exclude', level: 2, name: '排除法' },
    contra:  { id: 'contra',  level: 4, name: '假设矛盾' },
  };
  const LIST = [TECH.only, TECH.overlap, TECH.exclude, TECH.contra];

  /** 分析一行/一列，能定出东西就返回一步 */
  function lineStep(line, clue, axis, index) {
    const r = N.lineSolve(line, clue);
    if (r.count === 0) {
      // 这一行已经无解了——不是提示，是当前盘面有错
      return {
        id: 'contra', level: 4, name: '这一步走不通',
        axis: axis, index: index, clue: clue, count: 0,
        filled: [], marked: [], sample: [], len: line.length, dead: true,
      };
    }
    const filled = [], marked = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== UNKNOWN) continue;
      if (r.fill[i] === r.count) filled.push(i);
      else if (r.fill[i] === 0) marked.push(i);
    }
    if (!filled.length && !marked.length) return null;
    const only = r.count === 1;
    const t = only ? TECH.only : (filled.length ? TECH.overlap : TECH.exclude);
    return {
      id: t.id, level: t.level, name: t.name,
      axis: axis, index: index, clue: clue, count: r.count,
      filled: filled, marked: marked, sample: r.sample, len: line.length,
    };
  }

  /** 按行列顺序找第一个能推进的地方 */
  function findStep(b) {
    for (let r = 0; r < b.h; r++) {
      const s = lineStep(N.rowOf(b, r), b.clues.rows[r], 'row', r);
      if (s) return s;
    }
    for (let c = 0; c < b.w; c++) {
      const s = lineStep(N.colOf(b, c), b.clues.cols[c], 'col', c);
      if (s) return s;
    }
    return null;
  }

  /** 这一行/列当前还剩多少种摆法——用来判断"能不能直接读出来" */
  function optionsOf(b, step) {
    const line = step.axis === 'row' ? N.rowOf(b, step.index) : N.colOf(b, step.index);
    return N.lineSolve(line, step.clue);
  }

  /** 把这一步涉及的下标换算成棋盘下标 */
  function toBoard(b, step, i) {
    return step.axis === 'row' ? step.index * b.w + i : i * b.w + step.index;
  }

  const AXIS_NAME = { row: '行', col: '列' };

  function explain(step, b) {
    const ax = AXIS_NAME[step.axis];
    const label = (step.axis === 'row' ? 'R' : 'C') + (step.index + 1);
    const clueText = step.clue.length === 1 && step.clue[0] === 0 ? '全空' : step.clue.join('、');
    const cellsText = (arr) => arr.map((i) => (step.axis === 'row' ? 'R' + (step.index + 1) + 'C' + (i + 1) : 'R' + (i + 1) + 'C' + (step.index + 1))).join('、');

    if (step.dead) {
      return {
        name: '这一步走不通',
        derivation: [
          '第 ' + (step.index + 1) + ' ' + ax + '的线索是 ' + clueText + '，长度 ' + step.len + ' 格。',
          '按现在盘面上已经确定的格子，这一段**一种摆法都排不出来**。',
        ],
        conclusion: '说明前面有格子填错了，先撤销回去。',
        principle: '行列推理是数织唯一可靠的判据：一行排不出任何合法摆法，就说明这一行里已经确定的某格和线索矛盾。',
        pitfalls: '这时候不要继续猜——猜只会让错误越滚越大。先撤销。',
      };
    }

    if (step.id === 'only') {
      return {
        name: '唯一摆法',
        derivation: [
          '第 ' + (step.index + 1) + ' ' + ax + '的线索是 ' + clueText + '，长度 ' + step.len + ' 格。',
          '按现在盘面上已经确定的格子，这一段只剩**一种**摆法了。',
          '所以整行的结论可以直接读出来。',
        ],
        conclusion: (step.filled.length ? '把 ' + cellsText(step.filled) + ' 填实。' : '')
          + (step.marked.length ? '把 ' + cellsText(step.marked) + ' 标为空。' : ''),
        principle: '把线索里每一段在整行上"挪一遍"，挪的过程中不能和已知格子冲突。挪到最后只剩一种可能时，剩下的格子就被这一种摆法全部定死了。',
        pitfalls: '注意段与段之间**至少要空一格**，否则两段会连成一段，长度就不对了。',
      };
    }

    if (step.id === 'overlap') {
      return {
        name: '重叠法',
        derivation: [
          '第 ' + (step.index + 1) + ' ' + ax + '的线索是 ' + clueText + '，长度 ' + step.len + ' 格。',
          '现在这一段还有 ' + step.count + ' 种合法摆法，说明还不能直接读出来。',
          '但把这 ' + step.count + ' 种摆法**叠在一起看**，' + cellsText(step.filled) + ' 这几格在每一种里都被盖住了。',
        ],
        conclusion: '所以 ' + cellsText(step.filled) + ' 一定是实心。',
        principle: '这就是数织最经典的一条：**一段连续块，无论怎么放都会被盖住的那些格子，一定是实心**。'
          + '心算办法是「长度 × 2 − 行长度」——正数是多少，中间就有多少格是铁的。'
          + '比如 6 连块放在 10 格里，6×2−10=2，中间必有 2 格。',
        pitfalls: '这条只对**单独一段**好心算。多段的时候还是老老实实把摆法列出来叠一叠，'
          + '凭感觉估很容易漏。',
      };
    }

    if (step.id === 'exclude') {
      return {
        name: '排除法',
        derivation: [
          '第 ' + (step.index + 1) + ' ' + ax + '的线索是 ' + clueText + '，长度 ' + step.len + ' 格。',
          '把 ' + step.count + ' 种摆法叠在一起看，' + cellsText(step.marked) + ' 这几格**任何一种摆法都没盖到**。',
        ],
        conclusion: '所以 ' + cellsText(step.marked) + ' 一定是空的。',
        principle: '和重叠法是同一件事的两面：重叠法看"总被盖住的"，排除法看"总盖不到的"。'
          + '两者都是把所有合法摆法叠起来逐格数。',
        pitfalls: '标成空只是给自己做记号，标错了不影响判定——真正决定输赢的只有实心格填得对不对。',
      };
    }

    return {
      name: step.name,
      derivation: ['第 ' + (step.index + 1) + ' ' + ax + '的线索是 ' + clueText + '。'],
      conclusion: (step.filled.length ? '填实 ' + cellsText(step.filled) + '。' : '')
        + (step.marked.length ? '标空 ' + cellsText(step.marked) + '。' : ''),
      principle: '一切推理都归结成一句话：把这一行所有合法摆法列出来，看哪些格子的结论是一致的。',
      pitfalls: null,
    };
  }

  N.hints = { TECH: TECH, LIST: LIST, findStep: findStep, lineStep: lineStep, explain: explain, optionsOf: optionsOf, toBoard: toBoard };
})(window);
