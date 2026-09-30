/* 数独 · 题库
 * 预先验证过、可以直接开做的固定题目。存在这里是为了「秒开」——
 * 随机出题要花一两秒，题库里的题点一下就上盘，不用等。
 * 每一道都由 tests/run-core-tests.js 校验过：合法、唯一解。
 */
(function (global) {
  'use strict';

  const SD = global.SD;

  const LIST = [
    {
      id: 'dawn',
      name: '晨光',
      note: '线索最多的一道，当热身正好',
      grid: '1.3..67.9.5..8...3.891...5.23.6.48...7.9.2.6...45.8.17.1...594.5...9..3.9.83..5.2',
    },
    {
      id: 'rain',
      name: '细雨',
      note: '教科书级别的密度',
      grid: '.23.5......67.9..378....4.623.67.8....591...469....2...1..6.9..5.2...6.......1.72',
    },
    {
      id: 'classic30',
      name: '经典三十',
      note: '流传最广的那道入门题',
      grid: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
    },
    {
      id: 'bedrock',
      name: '磐石',
      note: '开始需要区块摒除与数对',
      grid: '.23....8.4..7....37......56....748..8...1..64....3.2...1...5.....2.97.31.6.34....',
    },
    {
      id: 'eagle',
      name: '苍鹰',
      note: '线索不多，得靠逻辑推进',
      grid: '..3456..........2.7....34.62.1.7..9...5.......94538...3.....9...4...76.........72',
    },
    {
      id: 'abyss',
      name: '深壑',
      note: '要动到三数组与链',
      grid: '.2....7.9..6.8....7..1.......1..48.....9..3.4.......17...2.59..5.....6..9683...72',
    },
    {
      id: 'seventeen',
      name: '十七线索',
      note: '接近数学上可能的最少线索',
      grid: '000000010400000000020000000000050407008000300001090000300400200050100000000806000',
    },
    {
      id: 'escargot',
      name: 'AI Escargot',
      note: '英文数独论坛出名的难题：本作 13 种技巧在 L5 以内推不完它，得用反证法硬啃',
      grid: '100007090030020008009600500005300900010080002600004000300000010040000007007000300',
    },
  ];

  function byId(id) {
    for (const p of LIST) if (p.id === id) return p;
    return null;
  }

  /** 线索数 → 难度档。阈值取自纸质数独的惯例，不是拍脑袋 */
  function bandOf(clues) {
    if (clues >= 36) return '入门';
    if (clues >= 30) return '简单';
    if (clues >= 26) return '中等';
    if (clues >= 22) return '困难';
    return '大师';
  }
  /** 惰性算出线索数与评级，展示时才跑一次——评级要遍历所有技巧，不便宜 */
  function describe(p) {
    const g = SD.Base.stringToGrid(p.grid);
    const rating = SD.Rater.rate(g, { maxLevel: 5 });
    const clueCount = SD.Generator.countClues(g);
    return {
      id: p.id,
      name: p.name,
      note: p.note,
      grid: p.grid,
      clueCount: clueCount,
      // 难度按线索数分档，这是纸质数独的通行做法。
      // 不用评级器给的 level：那个值是「最省解法里出现过的最高一级技巧」，
      // 而求解器永远优先挑简单的一招，于是它几乎恒为 1，拿来当难度会误导人。
      band: bandOf(clueCount),
      needsGuess: !rating.solved,
    };
  }

  SD.Bank = { LIST: LIST, byId: byId, describe: describe };
})(window);