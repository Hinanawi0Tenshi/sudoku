/* 华容道 · 存档 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const K = (SD.Klotski = SD.Klotski || {});

  const st = SD.Storage.create('klotski', {
    key: 'puzzle-hub:klotski:v1',
    defaults: () => ({ best: {}, plays: 0, wins: 0, solved: [], saved: null }),
  });

  /** 记一局通关。步数优先，步数相同再看用时。返回是不是新纪录 */
  function recordWin(levelId, moves, ms, distance) {
    const d = st.data();
    const b = d.best[levelId] || null;
    const better = !b || moves < b.moves || (moves === b.moves && ms < b.ms);
    if (better) d.best[levelId] = { moves: moves, ms: ms, distance: distance, at: Date.now() };
    d.wins++;
    st.save();
    return better;
  }
  const addPlay = () => { st.data().plays++; st.save(); };
  const best = (levelId) => st.data().best[levelId] || null;
  const stats = () => st.data();

  function saveGame(b) {
    const d = st.data();
    if (!b || b.state === 'won') { d.saved = null; st.save(); return; }
    d.saved = {
      level: b.level, distance: b.distance, seed: b.seed, moves: b.moves, elapsed: b.elapsed,
      pieces: b.pieces.map((p) => ({ type: p.type, name: p.name, w: p.w, h: p.h, r: p.r, c: p.c })),
    };
    st.save();
  }
  const savedGame = () => st.data().saved || null;
  const clearSaved = () => { st.data().saved = null; st.save(); };

  K.store = {
    data: st.data, save: st.save, flush: st.flush,
    recordWin: recordWin, addPlay: addPlay, best: best, stats: stats,
    saveGame: saveGame, savedGame: savedGame, clearSaved: clearSaved,
  };
})(window);
