/* 9×9 数独族 · 通用对局控制器
 *
 * 数独和杀手数独共用这一份：棋盘状态、撤销栈、计时、提示记录、选中格、笔记模式。
 * 两边的差别只有六处，全部通过 deps 注入：
 *   settings / recordTechnique / conflicts / isComplete / hints / solve
 * 杀手那边 conflicts 要把「笼内重复、笼和超了」也算进去，hints 和 solve 也要换成带笼子约束的版本。
 *
 * 通过 handlers 把变化抛给上层渲染，上层不反过来改状态。
 */
(function (global) {
  'use strict';

  const SD = (global.SD = global.SD || {});
  const B = SD.Base;

  const HISTORY_LIMIT = 400;
  /** 容错次数。超过后不再替玩家抹掉数字，改为给一次继续的机会。 */
  const MISTAKE_LIMIT = 3;

  function create(handlers, deps) {
    const h = handlers || {};
    const D = deps || {};
    const st = {
      board: new SD.Board(),
      givens: null,
      meta: null,
      solution: null,
      history: [],
      future: [],
      selected: -1,
      noteMode: false,
      running: false,
      startedAt: 0,
      elapsed: 0,
      hints: 0,
      mistakes: 0,
      techniques: [],
      hint: null,
      wrongCells: new Set(),
      solveError: null,
      won: false,
    };

    let tickTimer = null;

    /* ---------------- 通知 ---------------- */
    function emit(kind) {
      if (h.onChange) h.onChange(kind, st);
    }

    /* ---------------- 计时 ---------------- */
    function startTimer() {
      if (st.won || st.running) return;
      st.running = true;
      st.startedAt = Date.now();
      tickTimer = setInterval(() => {
        if (h.onTick) h.onTick(st.elapsed + (Date.now() - st.startedAt));
      }, 250);
      emit('timer');
    }

    function pauseTimer() {
      if (!st.running) return;
      st.elapsed += Date.now() - st.startedAt;
      st.running = false;
      clearInterval(tickTimer);
      tickTimer = null;
      emit('timer');
    }

    const elapsedMs = () => st.elapsed + (st.running ? Date.now() - st.startedAt : 0);

    /* ---------------- 撤销 ---------------- */
    /** 拍下当前状态。必须在改动盘面之前调用，否则撤销会「还原」成当前状态。 */
    function snapshot() {
      return {
        grid: st.board.grid.slice(),
        notes: st.board.notes.slice(),
        filled: st.board.filled.slice(),
        locked: st.board.locked.slice(),
        hints: st.hints,
        mistakes: st.mistakes,
        // 红标要跟着存档走：漏了它，刷新一次错过的格子就恢复正常色，
        // 玩家会以为系统没标出来
        wrong: Array.from(st.wrongCells),
        techniques: st.techniques.slice(),
        elapsed: elapsedMs(),
      };
    }

    const sameBoard = (a, b) => {
      for (let i = 0; i < B.CELL_COUNT; i++) {
        if (a.grid[i] !== b.grid[i] || a.notes[i] !== b.notes[i]) return false;
      }
      return true;
    };

    /** 把「改动前」的快照压栈。盘面没有实质变化时不入栈，免得撤销栈被无效记录塞满。 */
    function commitHistory(before) {
      if (sameBoard(before, st.board)) return;
      st.history.push(before);
      if (st.history.length > HISTORY_LIMIT) st.history.shift();
      st.future.length = 0;
    }

    function applySnapshot(s) {
      st.board.grid.set(s.grid);
      st.board.notes.set(s.notes);
      st.board.filled.set(s.filled);
      st.board.locked.set(s.locked);
      st.hints = s.hints;
      st.mistakes = s.mistakes;
      st.wrongCells = new Set(s.wrong || []);
      st.techniques = s.techniques.slice();
      if (!st.running) st.elapsed = s.elapsed;
    }

    function undo() {
      if (!st.history.length) return false;
      st.future.push(snapshot());
      applySnapshot(st.history.pop());
      st.hint = null;
      startTimer();
      emit('undo');
      return true;
    }

    function redo() {
      if (!st.future.length) return false;
      st.history.push(snapshot());
      applySnapshot(st.future.pop());
      emit('redo');
      return true;
    }

    /* ---------------- 冲突与完成 ---------------- */
    const conflicts = () => D.conflicts(st.board.grid);
    const isComplete = (g) => D.isComplete(g);

    /**
     * 胜利判定。播报放在这里而不是各个调用点：
     * 盘面可能被手动落子、提示执行、自动求解三条路填满，少一条就等于白填。
     */
    function checkWin() {
      if (st.won) return false;
      if (!isComplete(st.board.grid)) return false;
      if (conflicts().size) return false;
      st.won = true;
      pauseTimer();
      st.board.locked.fill(1);
      emit('win');
      return true;
    }

    /**
     * 落子后统一做：冲突检查 → 自动笔记 → 胜利判定 → 广播。
     * 冲突必须只判定「刚下的这一格」，否则盘上别处遗留的错误会让每次落子都被回滚。
     */
    function afterMove(i) {
      const conf = conflicts();
      if (conf.has(i) && D.settings().mistakeCheck && !st.board.isGiven(i)) {
        // 不阻断：数字留在盘上，只把这一格记为填错。
        // 抹掉数字等于替玩家擦答案，反而让人不知道自己错在哪。
        if (!st.wrongCells.has(i)) {
          st.wrongCells.add(i);
          st.mistakes++;
          if (st.mistakes >= MISTAKE_LIMIT) emit('mistakeLimit');
        }
      }

      if (D.settings().autoNotes) {
        const d = st.board.grid[i];
        if (d) st.board.propagateNotes(i);
        else st.board.rebuildNotes();
      }

      checkWin();
      emit('move');
      return false;
    }

    /* ---------------- 输入 ---------------- */
    function select(i) {
      st.selected = i;
      emit('select');
    }

    function inputDigit(d) {
      const i = st.selected;
      if (i < 0 || st.won) return false;
      if (st.board.isGiven(i)) return false;

      if (st.noteMode) {
        const before = snapshot();
        if (!st.board.toggleNote(i, d)) return false;
        commitHistory(before);
        emit('note');
        return true;
      }

      const before = snapshot();
      if (!st.board.setValue(i, d)) return false;
      startTimer();
      afterMove(i);
      commitHistory(before);
      return true;
    }

    function erase() {
      const i = st.selected;
      if (i < 0 || st.won) return false;
      const before = snapshot();
      if (!st.board.clearCell(i)) return false;
      commitHistory(before);
      st.wrongCells.delete(i);
      emit('erase');
      return true;
    }

    function setNoteMode(on) {
      st.noteMode = on === undefined ? !st.noteMode : !!on;
      emit('mode');
      return st.noteMode;
    }

    /* ---------------- 提示 ---------------- */
    /** 把选中的这一步落到盘面上；apply 为 false 时只讲解不落子 */
    function applyStep(entry, apply) {
      if (!entry || !entry.step) return null;
      st.hint = entry.explain;
      st.hint.step = entry.step;
      st.hint.placedCells = new Set();
      if (!apply) {
        emit('hint');
        return entry;
      }
      const before = snapshot();
      for (const p of entry.step.placements) {
        st.board.setValue(p.cell, p.digit, { force: true });
        st.board.locked[p.cell] = 1;
        st.hint.placedCells.add(p.cell);
        D.recordTechnique(entry.step.id);
      }
      if (!entry.step.placements.length) {
        // 纯消除型提示：把结论落到铅笔标记上，看得见摸得着
        for (const e of entry.step.eliminations) {
          if (st.board.notes[e.cell] & B.bit(e.digit)) st.board.notes[e.cell] &= ~B.bit(e.digit);
        }
      }
      if (entry.step.placements.length && D.settings().autoNotes) {
        for (const p of entry.step.placements) st.board.propagateNotes(p.cell);
      }
      st.hints++;
      st.techniques.push(entry.step.id);
      commitHistory(before);
      checkWin();
      emit('hint-apply');
      return entry;
    }

    /**
     * 当前盘面所有可用解法，按技巧等级从低到高。
     * 提示面板要一次列出全部，让用户自己挑下一步走哪条路。
     */
    function hintList(level) {
      return D.hints.available(st.board.grid, { maxLevel: level || 5 });
    }

    function hint(level, apply) {
      const first = hintList(level)[0] || null;
      if (!first) {
        st.hint = null;
        emit('hint');
        return null;
      }
      return applyStep(first, apply);
    }

    function clearHint() {
      st.hint = null;
      emit('hint');
    }

    /**
     * 自动求解：逐步应用人类技巧，做不动时如实报告卡住。
     * 若当前盘面已经无解（关闭即时纠错后可能发生），直接返回 0 并置 solveError，
     * 由上层提示「先撤销错误」，而不是让按钮看起来按了没反应。
     */
    function autoSolve() {
      if (D.solve(st.board.grid, 2).count === 0) {
        st.solveError = '当前盘面已经无解 —— 说明之前填错了数字。请用撤销退回那一步。';
        emit('solve');
        return 0;
      }
      st.solveError = null;
      const before = snapshot();
      const steps = D.hints.walkthrough(st.board.grid, 5);
      let applied = 0;
      const cand = D.baseCandidates ? D.baseCandidates(st.board.grid) : SD.Validation.computeCandidates(st.board.grid);
      for (const entry of steps) {
        // 技巧记录要按「这一步用到了什么」记，而不是只在出数时记。
        // 只在 placements 里 push 的话，XY 链、带鳍鱼这些纯删数的技巧会被整个漏掉。
        let acted = false;
        for (const p of entry.step.placements) {
          st.board.grid[p.cell] = p.digit;
          st.board.locked[p.cell] = 1;
          cand[p.cell] = 0;
          for (const q of B.PEERS[p.cell]) cand[q] &= ~B.bit(p.digit);
          acted = true;
          applied++;
        }
        for (const e of entry.step.eliminations) {
          cand[e.cell] &= ~B.bit(e.digit);
          acted = true;
        }
        if (acted) st.techniques.push(entry.step.id);
        if (applied > 400) break;
      }
      if (!isComplete(st.board.grid)) {
        // 人类技巧没能推完。原先这里会直接调求解器把剩下的填满，
        // 而技巧统计只记录 walkthrough 那部分——结果弹窗会显示
        // 「已用人类技巧推完 N 步」，让人以为高难题其实余数法就能秒杀。
        // 宁可明说推不完，也不冒充人类解法。
        st.solveError = '人类技巧推到最后一步卡住了（剩下 ' +
          (B.CELL_COUNT - st.board.grid.filter(Boolean).length) + ' 格需要更高级的技巧）。可撤销后改用提示逐步走。';
        emit('solve');
        return applied;
      }
      commitHistory(before);
      st.hint = null;
      checkWin();
      emit('solve');
      return applied;
    }

    /* ---------------- 对局生命周期 ---------------- */
    function start(givens, meta, solution) {
      st.board.reset(givens);
      st.meta = meta || {};
      st.givens = givens.slice();
      st.solution = solution || null;
      st.history.length = 0;
      st.future.length = 0;
      st.selected = -1;
      st.elapsed = 0;
      st.hints = 0;
      st.mistakes = 0;
      st.techniques = [];
      st.hint = null;
      st.wrongCells = new Set();
      st.won = false;
      clearInterval(tickTimer);
      tickTimer = null;
      st.running = false;
      startTimer();
      emit('start');
    }

    function restart() {
      if (!st.givens) return false;
      start(st.givens, st.meta, st.solution);
      return true;
    }

    return {
      state: st,
      start: start,
      restart: restart,
      select: select,
      inputDigit: inputDigit,
      erase: erase,
      setNoteMode: setNoteMode,
      undo: undo,
      redo: redo,
      conflicts: conflicts,
      wrongCells: () => st.wrongCells,
      mistakeLimit: MISTAKE_LIMIT,
      checkWin: checkWin,
      hint: hint,
      hintList: hintList,
      applyStep: applyStep,
      clearHint: clearHint,
      autoSolve: autoSolve,
      pauseTimer: pauseTimer,
      startTimer: startTimer,
      elapsedMs: elapsedMs,
    };
  }

  SD.GameBase = { create: create, MISTAKE_LIMIT: MISTAKE_LIMIT };
})(window);
