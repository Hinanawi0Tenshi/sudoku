/* 2048 · 存档
 *
 * 2048 没有"关卡"，一局可以无限打下去，所以存的是：各档最高分、总局数、以及未完成的对局。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const G = (SD.G2048 = SD.G2048 || {});

  const st = SD.Storage.create('g2048', {
    key: 'puzzle-hub:g2048:v1',
    defaults: () => ({ best: {}, plays: 0, wins: 0, maxTile: 0, saved: null }),
  });

  /** 记一局结束。返回是不是新高分 */
  function record(levelId, score, tile) {
    const d = st.data();
    const b = d.best[levelId] || 0;
    const better = score > b;
    if (better) d.best[levelId] = score;
    if (tile > d.maxTile) d.maxTile = tile;
    st.save();
    return better;
  }
  const best = (levelId) => st.data().best[levelId] || 0;
  const stats = () => st.data();
  const addPlay = () => { st.data().plays++; st.save(); };

  function saveGame(b) {
    const d = st.data();
    if (!b || b.state === 'over') { d.saved = null; st.save(); return; }
    d.saved = {
      level: b.level, size: b.size, cells: Array.from(b.cells),
      score: b.score, moves: b.moves, elapsed: b.elapsed, target: b.target, seed: b.seed,
    };
    st.save();
  }
  const savedGame = () => st.data().saved || null;
  const clearSaved = () => { st.data().saved = null; st.save(); };

  G.store = {
    data: st.data, save: st.save, flush: st.flush,
    record: record, best: best, stats: stats, addPlay: addPlay,
    saveGame: saveGame, savedGame: savedGame, clearSaved: clearSaved,
  };
})(window);
