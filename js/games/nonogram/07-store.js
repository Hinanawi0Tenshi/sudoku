/* 数织 · 存档 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const N = (SD.Nonogram = SD.Nonogram || {});

  const st = SD.Storage.create('nonogram', {
    key: 'puzzle-hub:nonogram:v1',
    defaults: () => ({ best: {}, plays: 0, wins: 0, revealed: [], settings: { markMode: false }, saved: null }),
  });

  function recordWin(levelId, ms) {
    const d = st.data();
    const b = d.best[levelId] || null;
    const better = !b || ms < b.ms;
    if (better) d.best[levelId] = { ms: ms, at: Date.now() };
    d.wins++;
    st.save();
    return better;
  }
  const addPlay = () => { st.data().plays++; st.save(); };
  const best = (levelId) => st.data().best[levelId] || null;
  const stats = () => st.data();
  const settings = () => st.data().settings;
  const set = (k, v) => { st.data().settings[k] = v; st.save(); };

  /** 通关过的图记下来，首页上可以显示"已解出 N 张画" */
  function markRevealed(id, name) {
    const d = st.data();
    if (!d.revealed.some((x) => x.id === id)) d.revealed.push({ id: id, name: name, at: Date.now() });
    st.save();
  }
  const revealed = () => st.data().revealed;

  function saveGame(b) {
    const d = st.data();
    if (!b || b.state === 'won') { d.saved = null; st.save(); return; }
    d.saved = {
      level: b.level, picId: b.id, name: b.name, w: b.w, h: b.h,
      cells: Array.from(b.cells), moves: b.moves, elapsed: b.elapsed, seed: b.seed,
    };
    st.save();
  }
  const savedGame = () => st.data().saved || null;
  const clearSaved = () => { st.data().saved = null; st.save(); };

  N.store = {
    data: st.data, save: st.save, flush: st.flush,
    recordWin: recordWin, addPlay: addPlay, best: best, stats: stats,
    settings: settings, set: set, markRevealed: markRevealed, revealed: revealed,
    saveGame: saveGame, savedGame: savedGame, clearSaved: clearSaved,
  };
})(window);
