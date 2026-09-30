/* 数独 · 棋盘模型：题面、当前盘面、铅笔标记，以及实时规则校验
 *
 * 设计要点：
 * - grid 保存「当前盘面」，givens 保存「题面原始数字」，二者分离才能区分提示/误填。
 * - notes 用位掩码存储铅笔标记，读写都是 O(1)，也便于整体快照做撤销。
 * - 所有校验都是纯函数，输入棋盘输出结论，方便单测与在图片识别后复用。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;

  const bit = B.bit;

  class SudokuBoard {
    constructor(givens) {
      this.givens = new Uint8Array(B.CELL_COUNT);
      this.grid = new Uint8Array(B.CELL_COUNT);
      this.notes = new Int32Array(B.CELL_COUNT);
      this.filled = new Uint8Array(B.CELL_COUNT); // 用户实际写入过的位置（0/1）
      this.locked = new Uint8Array(B.CELL_COUNT); // 被提示或「已确认」后锁住，防止误删
      if (givens) this.reset(givens);
    }

    reset(givens) {
      this.givens.set(givens || new Uint8Array(B.CELL_COUNT));
      this.grid.set(this.givens);
      this.notes.fill(0);
      this.filled.fill(0);
      this.locked.fill(0);
      return this;
    }

    clone() {
      const next = new SudokuBoard();
      next.givens.set(this.givens);
      next.grid.set(this.grid);
      next.notes.set(this.notes);
      next.filled.set(this.filled);
      next.locked.set(this.locked);
      return next;
    }

    isGiven(i) {
      return this.givens[i] !== 0;
    }

    isLocked(i) {
      return this.givens[i] !== 0 || this.locked[i] === 1;
    }

    /** 写入数字；返回值表示是否真的改变了盘面 */
    setValue(i, d, opts = {}) {
      const v = d | 0;
      if (this.isLocked(i) && !opts.force) return false;
      if (this.grid[i] === v) {
        // 重复输入同一数字视为清除，方便单手操作
        this.grid[i] = 0;
        this.filled[i] = 0;
        return true;
      }
      this.grid[i] = v;
      this.filled[i] = v ? 1 : 0;
      if (v) this.notes[i] = 0;
      if (opts.lock) this.locked[i] = 1;
      return true;
    }

    setNote(i, d, on) {
      if (this.isLocked(i)) return false;
      if (on === undefined) on = !(this.notes[i] & bit(d));
      if (on) this.notes[i] |= bit(d);
      else this.notes[i] &= ~bit(d);
      return true;
    }

    toggleNote(i, d) {
      return this.setNote(i, d, undefined);
    }

    clearCell(i, opts = {}) {
      if (this.isLocked(i) && !opts.force) return false;
      this.grid[i] = 0;
      this.filled[i] = 0;
      this.notes[i] = 0;
      return true;
    }

    /** 用当前盘面里的数字重算全部铅笔标记（自动笔记） */
    rebuildNotes() {
      const cand = computeCandidates(this.grid);
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (this.grid[i] || this.isLocked(i)) {
          this.notes[i] = 0;
        } else {
          this.notes[i] = cand[i];
        }
      }
      return this;
    }

    /** 写入一个数字后，同步更新同行/列/宫的铅笔标记 */
    propagateNotes(i) {
      const d = this.grid[i];
      if (!d) return;
      const b = bit(d);
      for (const p of B.PEERS[i]) {
        if (!this.grid[p]) this.notes[p] &= ~b;
      }
    }

    /** 按候选位掩码替换某格铅笔标记 */
    setNoteMask(i, mask) {
      this.notes[i] = this.grid[i] ? 0 : mask & B.ALL;
    }

    toString() {
      return B.gridToString(this.grid);
    }

    /** 用于撤销栈的紧凑快照 */
    snapshot() {
      return {
        grid: this.grid.slice(),
        notes: this.notes.slice(),
        filled: this.filled.slice(),
        locked: this.locked.slice(),
      };
    }

    restore(snap) {
      this.grid.set(snap.grid);
      this.notes.set(snap.notes);
      this.filled.set(snap.filled);
      this.locked.set(snap.locked);
    }
  }

  /* ---------- 纯函数校验 ---------- */

  /** 基础剥离求候选：只扣除同区已填数字，不做任何高级推理 */
  function computeCandidates(grid) {
    const rowUsed = new Uint16Array(9);
    const colUsed = new Uint16Array(9);
    const boxUsed = new Uint16Array(9);
    for (let i = 0; i < B.CELL_COUNT; i++) {
      const d = grid[i];
      if (!d) continue;
      const b = bit(d);
      rowUsed[B.ROW_OF[i]] |= b;
      colUsed[B.COL_OF[i]] |= b;
      boxUsed[B.BOX_OF[i]] |= b;
    }
    const cand = new Int32Array(B.CELL_COUNT);
    for (let i = 0; i < B.CELL_COUNT; i++) {
      if (grid[i]) continue;
      const r = B.ROW_OF[i];
      const c = B.COL_OF[i];
      const bx = B.BOX_OF[i];
      cand[i] = B.ALL & ~(rowUsed[r] | colUsed[c] | boxUsed[bx]);
    }
    return cand;
  }

  /**
   * 找出所有「已填数字互相冲突」的格子。
   * 返回 Map<cellIndex, cellIndex[]>，每个键指向与它冲突的其他格子。
   */
  function findConflicts(grid) {
    const map = new Map();
    const add = (i, j) => {
      if (!map.has(i)) map.set(i, []);
      map.get(i).push(j);
    };
    for (let u = 0; u < B.UNITS.length; u++) {
      const unit = B.UNITS[u];
      const byDigit = new Map();
      for (const i of unit) {
        const d = grid[i];
        if (!d) continue;
        if (!byDigit.has(d)) byDigit.set(d, []);
        byDigit.get(d).push(i);
      }
      for (const [, cells] of byDigit) {
        if (cells.length < 2) continue;
        for (let k = 0; k < cells.length; k++) {
          for (let m = k + 1; m < cells.length; m++) {
            add(cells[k], cells[m]);
            add(cells[m], cells[k]);
          }
        }
      }
    }
    return map;
  }

  const isComplete = (grid) => grid.every((d) => d > 0);

  /** 盘面本身是否自洽（无冲突） */
  function isConsistent(grid) {
    return findConflicts(grid).size === 0;
  }

  /** 题面是否满足「唯一解」——所有导入/识别棋局都要过这一关 */
  function hasUniqueSolution(grid) {
    const result = SD.Solver.solve(grid, 2);
    return result.count === 1 ? { unique: true, solution: result.solution } : { unique: false, count: result.count };
  }

  SD.Board = SudokuBoard;
  SD.Validation = { computeCandidates, findConflicts, isComplete, isConsistent, hasUniqueSolution };
})(window);
