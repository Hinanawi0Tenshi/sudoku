/* 杀手数独 · 本地持久化
 *
 * 命名空间是 SD.Storage.create('killer', ...)，和数独、扫雷各存各的。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const K = (SD.Killer = SD.Killer || {});
  const U = SD.Util;

  const DEFAULT_SETTINGS = {
    autoNotes: true,
    highlight: true,
    highlightSame: true,
    highlightPeer: true,
    highlightCage: true,      // 选中一格时把整个笼子一起点亮
    mistakeCheck: true,
    confirmSolve: true,
    defaultHintLevel: 5,      // 杀手起步就得用笼内组合，默认放开到全部
    lastDifficulty: 'medium',
  };

  const emptyStats = () => ({
    games: 0,
    wins: 0,
    bestTimes: {},
    byDifficulty: {},
    techniqueUse: {},
    daily: {},
    totalHints: 0,
    totalMistakes: 0,
    playTime: 0,
  });

  const NS = SD.Storage.create('killer', {
    key: 'puzzle-hub:killer:v1',
    defaults: () => ({
      settings: Object.assign({}, DEFAULT_SETTINGS),
      stats: emptyStats(),
      game: null,
    }),
  });

  let state = NS.data();
  const save = () => NS.save();

  const settings = () => state.settings;
  const stats = () => state.stats;

  function set(key, value) {
    state.settings[key] = value;
    save();
  }

  function recordGame(r) {
    const s = state.stats;
    s.games++;
    if (r.won) {
      s.wins++;
      s.playTime += r.timeMs || 0;
      const d = r.difficulty || 'custom';
      const bucket = s.byDifficulty[d] || (s.byDifficulty[d] = { games: 0, wins: 0, bestTime: 0, totalHints: 0 });
      bucket.games++;
      bucket.wins++;
      bucket.totalHints += r.hints || 0;
      if (!bucket.bestTime || r.timeMs < bucket.bestTime) bucket.bestTime = r.timeMs;
      if (!s.bestTimes[d] || r.timeMs < s.bestTimes[d]) s.bestTimes[d] = r.timeMs;
      if (r.dailyKey) {
        const rec = s.daily[r.dailyKey] || (s.daily[r.dailyKey] = { timeMs: null, won: false, tries: 0 });
        rec.won = true;
        rec.tries = (rec.tries || 0) + 1;
        if (rec.timeMs === null || r.timeMs < rec.timeMs) rec.timeMs = r.timeMs;
      }
    }
    s.totalHints += r.hints || 0;
    s.totalMistakes += r.mistakes || 0;
    for (const id of r.techniques || []) s.techniqueUse[id] = (s.techniqueUse[id] || 0) + 1;
    save();
  }

  function recordTechnique(id) {
    state.stats.techniqueUse[id] = (state.stats.techniqueUse[id] || 0) + 1;
    save();
  }

  function recordDailyProgress(dailyKey, filled, total) {
    if (!dailyKey || !total) return;
    const rec = state.stats.daily[dailyKey] || (state.stats.daily[dailyKey] = { timeMs: null, won: false, tries: 0 });
    if (rec.won) return;
    rec.filled = filled;
    rec.total = total;
    save();
  }

  /** 每日挑战战绩。日期键用 SD.Util.dayKey，三款游戏格式统一。 */
  function dailyStats() {
    const d = state.stats.daily || {};
    const today = U.dayKey();
    const cursor = new Date();
    if (!(d[today] && d[today].won)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const k = U.dayKey(cursor);
      if (d[k] && d[k].won) { streak++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    const times = Object.keys(d).filter((k) => d[k].won && d[k].timeMs > 0).map((k) => d[k].timeMs);
    return {
      today: today,
      date: today.slice(5),
      record: d[today] || null,
      done: !!(d[today] && d[today].won),
      streak: streak,
      bestTimeMs: times.length ? Math.min.apply(null, times) : null,
      total: Object.keys(d).filter((k) => d[k].won).length,
    };
  }

  const saveGame = (g) => { state.game = g; save(); };
  const loadGame = () => state.game || null;
  const clearGame = () => { state.game = null; save(); };

  function resetStats() {
    state.stats = emptyStats();
    save();
  }

  function resetSettings() {
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    save();
  }

  K.store = {
    settings: settings,
    set: set,
    stats: stats,
    recordGame: recordGame,
    recordTechnique: recordTechnique,
    recordDailyProgress: recordDailyProgress,
    dailyStats: dailyStats,
    saveGame: saveGame,
    loadGame: loadGame,
    clearGame: clearGame,
    resetStats: resetStats,
    resetSettings: resetSettings,
    flush: () => NS.flush(),
  };
})(window);
