/* 数独 · 本地持久化：设置、统计、当前对局
 * 全部落在 localStorage，换设备不会同步，这是刻意的取舍——数独数据不值得上云。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const KEY = 'sudoku-studio:v1';

  const DEFAULT_SETTINGS = {
    theme: 'light',
    autoNotes: true,
    highlight: true,
    highlightSame: true,
    highlightPeer: true,
    mistakeCheck: true,
    sound: false,
    defaultHintLevel: 3,
    showCandidateWhenEmpty: false,
    confirmSolve: true,
    lastDifficulty: 'medium',
  };

  const emptyStats = () => ({
    games: 0,
    wins: 0,
    bestTimes: {},
    totalHints: 0,
    totalMistakes: 0,
    playTime: 0,
    byDifficulty: {},
    techniqueUse: {},
    daily: {},
  });

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), game: null };
      const parsed = JSON.parse(raw);
      return {
        settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
        stats: Object.assign(emptyStats(), parsed.stats || {}),
        game: parsed.game || null,
      };
    } catch (e) {
      return { settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), game: null };
    }
  }

  let state = read();
  let saveTimer = null;

  function flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // 存储写满或被禁用时静默降级：游戏本身不该因此崩掉
      console.warn('本地存储写入失败：', e && e.message);
    }
  }

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 220);
  };

  const settings = () => state.settings;
  const stats = () => state.stats;

  function set(key, value) {
    state.settings[key] = value;
    save();
  }

  function saveGame(game) {
    state.game = game;
    save();
  }

  function loadGame() {
    return state.game;
  }

  /* ---------------- 统计写入 ---------------- */

  function recordGame(result) {
    const s = state.stats;
    s.games++;
    if (result.won) {
      s.wins++;
      s.playTime += result.timeMs || 0;
      const d = result.difficulty || 'custom';
      const bucket = s.byDifficulty[d] || (s.byDifficulty[d] = { games: 0, wins: 0, bestTime: 0, totalHints: 0 });
      bucket.games++;
      if (result.won) {
        bucket.wins++;
        bucket.totalHints += result.hints || 0;
        if (!bucket.bestTime || result.timeMs < bucket.bestTime) bucket.bestTime = result.timeMs;
      }
      if (!s.bestTimes[d] || result.timeMs < s.bestTimes[d]) s.bestTimes[d] = result.timeMs;
      if (result.dailyKey) {
        const rec = s.daily[result.dailyKey] || (s.daily[result.dailyKey] = { timeMs: null, won: false, tries: 0 });
        rec.won = true;
        rec.tries = (rec.tries || 0) + 1;
        if (rec.timeMs === null || result.timeMs < rec.timeMs) rec.timeMs = result.timeMs;
      }
    }
    s.totalHints += result.hints || 0;
    s.totalMistakes += result.mistakes || 0;
    for (const id of result.techniques || []) {
      s.techniqueUse[id] = (s.techniqueUse[id] || 0) + 1;
    }
    save();
  }

  function recordTechnique(id) {
    state.stats.techniqueUse[id] = (state.stats.techniqueUse[id] || 0) + 1;
    save();
  }

  /**
   * 每日挑战战绩：今天做没做、当前连续天数、历史最好成绩。
   * 键的格式统一走 SD.Generator.dailySeed，这里不再自己拼一份日期串。
   */
  function dailyStats() {
    const d = stats().daily || {};
    const today = SD.Generator.dailySeed();
    const cursor = new Date();
    if (!(d[today] && d[today].won)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 400; i++) {
      const k = SD.Generator.dailySeed(cursor);
      if (d[k] && d[k].won) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    const times = [];
    for (const k of Object.keys(d)) if (d[k].won && d[k].timeMs > 0) times.push(d[k].timeMs);
    const won = Object.keys(d).filter((k) => d[k].won).length;
    return {
      today: today,
      date: today.slice(6),
      record: d[today] || null,
      done: !!(d[today] && d[today].won),
      streak: streak,
      bestTimeMs: times.length ? Math.min.apply(null, times) : null,
      total: won,
    };
  }
  function resetStats() {
    state.stats = emptyStats();
    save();
  }

  /** 只重置设置，保留统计与当前对局 */
  function resetSettings() {
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    save();
  }

  function resetAll() {
    state = { settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), game: null };
    flush();
  }

  SD.Store = {
    settings: settings,
    set: set,
    stats: stats,
    saveGame: saveGame,
    loadGame: loadGame,
    recordGame: recordGame,
    recordTechnique: recordTechnique,
    dailyStats: dailyStats,
    resetStats: resetStats,
    resetSettings: resetSettings,
    resetAll: resetAll,
    flush: flush,
  };
})(window);
