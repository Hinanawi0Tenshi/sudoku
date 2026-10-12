/* 数独 · 对局控制器
 *
 * 控制器本体已经提到 js/core/11-game.js，两边共用；这里只把数独这一侧的依赖接上去：
 * 设置、技巧记录、行列宫冲突、以及数独自己的提示引擎与求解器。
 * 杀手数独走同一份控制器，换的是这六个依赖。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间

  const deps = {
    settings: () => SD.Sudoku.store.settings(),
    recordTechnique: (id) => SD.Sudoku.store.recordTechnique(id),
    conflicts: (grid) => SD.Validation.findConflicts(grid),
    isComplete: (grid) => SD.Validation.isComplete(grid),
    hints: {
      available: (grid, opts) => SD.Hints.available(grid, opts),
      walkthrough: (grid, maxLevel) => SD.Hints.walkthrough(grid, maxLevel),
    },
    solve: (grid, limit) => SD.Solver.solve(grid, limit),
    baseCandidates: (grid) => SD.Validation.computeCandidates(grid),
  };

  SD.Sudoku.game = { create: (handlers) => SD.GameBase.create(handlers, deps) };
})(window);
