/* 扫雷 · 本地持久化
 *
 * 扫雷自己的一份数据：设置、各档战绩、每日挑战记录、当前存档。
 * 命名空间是 SD.Storage.create('mines', ...)，跟数独那份完全分开——
 * 一边清数据不该把另一边的记录带走。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  const M = (SD.Mines = SD.Mines || {});
  const U = SD.Util;

  const DEFAULT_SETTINGS = {
    flagMode: false,       // 触屏上默认点击即翻开，长按插旗
  };

  /** 每档一份战绩。自定义盘面也占一格，但不比最佳时间——尺寸不一样，比了没意义。 */
  const emptyBucket = () => ({ games: 0, wins: 0, bestTimeMs: 0, bestMines: 0 });
  const emptyStats = () => ({
    beginner: emptyBucket(),
    intermediate: emptyBucket(),
    expert: emptyBucket(),
    custom: emptyBucket(),
  });

  const NS = SD.Storage.create('mines', {
    key: 'puzzle-hub:mines:v1',
    defaults: () => ({
      settings: Object.assign({}, DEFAULT_SETTINGS),
      stats: emptyStats(),
      daily: {},
      game: null,
    }),
  });

  let state = NS.data();
  const save = () => NS.save();

  const settings = () => state.settings;
  const stats = () => state.stats;
  const bucket = (key) => state.stats[key] || (state.stats[key] = emptyBucket());

  function set(key, value) {
    state.settings[key] = value;
    save();
  }

  /**
   * 一局结束。赢了才记时间和最佳成绩，输了只记一局——
   * 扫雷的输是常事，把失败也算进「用时」会让数字失去意义。
   */
  function recordGame(r) {
    const b = bucket(r.levelId || 'custom');
    b.games++;
    if (!r.won) { save(); return b; }
    b.wins++;
    if (r.timeMs > 0 && (!b.bestTimeMs || r.timeMs < b.bestTimeMs)) b.bestTimeMs = r.timeMs;
    if (r.mines > (b.bestMines || 0)) b.bestMines = r.mines;
    if (r.dailyKey) {
      const rec = state.daily[r.dailyKey] || (state.daily[r.dailyKey] = { won: false, timeMs: 0 });
      rec.won = true;
      if (r.timeMs > 0 && (!rec.timeMs || r.timeMs < rec.timeMs)) rec.timeMs = r.timeMs;
    }
    save();
    return b;
  }

  const today = () => state.daily[U.dayKey()] || null;

  /** 连续天数：今天没做就从昨天往前数，和数独那边同一套算法 */
  function dailyStats() {
    const d = state.daily || {};
    const cursor = new Date();
    if (!(d[U.dayKey(cursor)] && d[U.dayKey(cursor)].won)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const k = U.dayKey(cursor);
      if (d[k] && d[k].won) { streak++; cursor.setDate(cursor.getDate() - 1); } else break;
    }
    const done = !!(d[U.dayKey()] && d[U.dayKey()].won);
    const times = Object.keys(d).filter((k) => d[k].won && d[k].timeMs > 0).map((k) => d[k].timeMs);
    return {
      key: U.dayKey(),
      done: done,
      streak: streak,
      record: d[U.dayKey()] || null,
      bestTimeMs: times.length ? Math.min.apply(null, times) : 0,
      total: Object.keys(d).filter((k) => d[k].won).length,
    };
  }

  const saveGame = (g) => { state.game = g; save(); };
  const loadGame = () => state.game || null;
  const clearGame = () => { state.game = null; save(); };

  function resetStats() {
    state.stats = emptyStats();
    state.daily = {};
    save();
  }

  function resetSettings() {
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    save();
  }

  M.store = {
    settings: settings,
    set: set,
    stats: stats,
    bucket: bucket,
    recordGame: recordGame,
    dailyStats: dailyStats,
    saveGame: saveGame,
    loadGame: loadGame,
    clearGame: clearGame,
    resetStats: resetStats,
    resetSettings: resetSettings,
    flush: () => NS.flush(),
  };
})(window);
