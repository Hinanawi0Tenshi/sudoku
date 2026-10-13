/* 数字华容道 · 存档
 *
 * 和其它游戏一样，独立命名空间。数据只有两块：各难度最好成绩、当前未完成的对局。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const S = (SD.Slide = SD.Slide || {});

  // defaults 必须是函数：每次调用都要给一份全新对象，否则多个命名空间会共享同一个引用
  const st = SD.Storage.create('slide', {
    key: 'puzzle-hub:slide:v1',
    defaults: () => ({ best: {}, plays: 0, wins: 0, saved: null }),
  });

  /** 一个难度的最好成绩。步数优先，步数相同再看用时 */
  function recordWin(levelId, moves, ms) {
    const d = st.data();
    const b = d.best[levelId] || null;
    const better = !b || moves < b.moves || (moves === b.moves && ms < b.ms);
    if (better) d.best[levelId] = { moves: moves, ms: ms, at: Date.now() };
    d.wins++;
    st.save();
    return better;
  }

  function addPlay() { st.data().plays++; st.save(); }
  const best = (levelId) => st.data().best[levelId] || null;
  const stats = () => st.data();

  function saveGame(b) {
    const d = st.data();
    if (!b || b.state === 'won') { d.saved = null; } else {
      d.saved = {
        level: b.level, n: b.n, cells: Array.from(b.cells), empty: b.empty,
        moves: b.moves, elapsed: b.elapsed, seed: b.seed,
      };
    }
    st.save();
  }
  function savedGame() { return st.data().saved || null; }
  function clearSaved() { st.data().saved = null; st.save(); }

  S.store = {
    data: st.data, save: st.save,
    recordWin: recordWin, addPlay: addPlay, best: best, stats: stats,
    saveGame: saveGame, savedGame: savedGame, clearSaved: clearSaved,
  };
})(window);
