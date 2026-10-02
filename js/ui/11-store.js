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

  /** 图鉴与抽卡的账本。重复卡转碎片、指定兑换靠 owned 里的张数。 */
  function emptyWallet() {
    return {
      points: 0,
      shards: 0,
      owned: {},
      skins: [],
      tickets: 0,
      pity: 0,
      drawCount: 0,
      seenGrids: {},
    };
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), game: null, userBank: [], wallet: emptyWallet(), queue: [], usedGrids: {} };
      const parsed = JSON.parse(raw);
      return {
        settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}),
        stats: Object.assign(emptyStats(), parsed.stats || {}),
        game: parsed.game || null,
        userBank: parsed.userBank || [],
        queue: parsed.queue || [],
        usedGrids: parsed.usedGrids || {},
        wallet: Object.assign(emptyWallet(), parsed.wallet || {}),
      };
    } catch (e) {
      return { settings: Object.assign({}, DEFAULT_SETTINGS), stats: emptyStats(), game: null, userBank: [], wallet: emptyWallet(), queue: [], usedGrids: {} };
    }
  }

  let state = read();
  let saveTimer = null;

  /**
   * 题面来源标记。换生成器时它必须跟着变，旧存档才会被判过期而丢弃。
   * 与 SD_BUILD 分开：发一次包不等于换了生成逻辑。
   */
  const GEN_VERSION = 2;

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

  /**
   * 取出待恢复的对局，但只在题面来自当前这一代生成器时才给。
   *
   * 生成器修过之后（曾经所有题共用同一个终盘、难度下限形同虚设），
   * 修复前存下的题面是旧产物——直接恢复的话，刷新多少次都会撞回那道
   * 又简单又重复的旧题，看着就像「修复没生效」。
   * 每日挑战是按日期播种的，重新生成即可；普通对局丢掉一局存档，
   * 代价远小于让人一直看着过时的题目。
   */
  function loadGame() {
    const g = state.game;
    if (!g || !g.givens) return null;
    if (g.genVersion !== GEN_VERSION) {
      state.game = null;
      save();
      return null;
    }
    return g;
  }

  /* ---------------- 我的题库 ---------------- */
  /**
   * 用户从照片存进来的题目。单独一个顶层键，不混进 stats：
   * stats 的形状会在数据面板里整块导出，掺进题目数组会撑破它的表格。
   */
  function userBank() {
    return state.userBank || [];
  }

  function addUserPuzzle(grid, name, band) {
    const list = userBank().slice();
    const id = 'u' + Date.now().toString(36);
    list.unshift({ id: id, name: name, grid: grid, band: band, addedAt: Date.now() });
    state.userBank = list.slice(0, 60);
    save();
    return id;
  }

  /**
   * 自动生成的待做题。每档固定攒 3 道，做完一道补一道。
   * 与 userBank 分开：那些是用户自己从照片存的，不该被自动逻辑删改，
   * 补位时也不会去动它们。
   */
  function queue() {
    return state.queue || [];
  }

  /** 题面指纹。已生成过的题面集合，防止反复撞同一道。 */
  function usedGrids() {
    return state.usedGrids || {};
  }

  /** 指纹表只保留最近两千条，再多这个键会长到几十万字符拖慢每一次读档 */
  function trimUsed(u) {
    const keys = Object.keys(u);
    if (keys.length > 2000) {
      for (let i = 0; i < keys.length - 2000; i++) delete u[keys[i]];
    }
    return u;
  }

  function markUsed(grid) {
    const u = usedGrids();
    u[grid] = 1;
    state.usedGrids = trimUsed(u);
  }

  function queueOf(diff) {
    return queue().filter((q) => q.diff === diff && !q.done);
  }

  function pushQueue(diff, grid, clues, level) {
    const list = queue().slice();
    list.push({
      id: 'q' + diff + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
      diff: diff, grid: grid, clues: clues, level: level, done: false, addedAt: Date.now(),
    });
    state.queue = list;
    markUsed(grid);
  }

  /** 把题面记进已用指纹。每日挑战的题面也走这里，免得明天又在队列里遇到今天做过的那道。 */
  function noteGridUsed(grid) {
    if (!grid) return;
    const u = usedGrids();
    u[grid] = 1;
    trimUsed(u);
    state.usedGrids = u;
    save();
  }
  function finishQueueItem(id) {
    const list = queue().slice();
    for (const q of list) if (q.id === id) { q.done = true; q.finishedAt = Date.now(); }
    state.queue = list.slice(-60);
    save();
  }

  function removeQueueItem(id) {
    state.queue = queue().filter((q) => q.id !== id);
    save();
  }

  /**
   * 把某档的待做数补到 keep 道。已出现过的题面一律不重复。
   * 出题是同步的，keep 又很小，最多也就是几秒。
   */
  function refillQueue(diff, keep, gen) {
    const have = queueOf(diff).length;
    const need = keep - have;
    if (need <= 0) return 0;
    const used = usedGrids();
    let added = 0;
    for (let i = 0; i < need * 6 && added < need; i++) {
      const g = gen();
      if (!g || !g.grid) continue;
      const key = g.grid;
      if (used[key]) continue;
      pushQueue(diff, key, g.clues, g.level);
      added++;
    }
    if (added) save();
    return added;
  }
  function removeUserPuzzle(id) {
    state.userBank = userBank().filter((p) => p.id !== id);
    save();
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

  /**
   * 记下每日挑战的当前进度，让日历能画出进度环。
   * 落子时随手写一条，所以按天攒下来比只存当前这一局有用得多。
   */
  function recordDailyProgress(dailyKey, filled, total) {
    if (!dailyKey || !total) return;
    const rec = state.stats.daily[dailyKey] || (state.stats.daily[dailyKey] = { timeMs: null, won: false, tries: 0 });
    if (rec.won) return;
    rec.filled = filled;
    rec.total = total;
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
    state: read,
    emptyWallet: emptyWallet,
    set: set,
    stats: stats,
    saveGame: saveGame,
    loadGame: loadGame,
    recordGame: recordGame,
    recordTechnique: recordTechnique,
    dailyStats: dailyStats,
    recordDailyProgress: recordDailyProgress,
    userBank: userBank,
    addUserPuzzle: addUserPuzzle,
    removeUserPuzzle: removeUserPuzzle,
    queue: queue,
    queueOf: queueOf,
    refillQueue: refillQueue,
    finishQueueItem: finishQueueItem,
    removeQueueItem: removeQueueItem,
    usedGrids: usedGrids,
    noteGridUsed: noteGridUsed,
    resetStats: resetStats,
    resetSettings: resetSettings,
    resetAll: resetAll,
    flush: flush,
  };
})(window);
