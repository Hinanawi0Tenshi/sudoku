/* 益智游戏合集 · 分命名空间存储
 *
 * 所有游戏各存各的。一款游戏的进度、战绩、题库不该被另一款的「清空数据」顺手带走——
 * 那是玩家最容易受伤的操作，也是最难解释的一种数据丢失。
 * 所以每款游戏独占一个 localStorage key，平台只留一个全局命名空间装主题和通关点数，
 * 这是所有游戏之间唯一互通的东西。
 *
 * 写盘按命名空间各自防抖：数独连续落子时不该反复序列化另外两款的数据。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});

  const PREFIX = 'puzzle-hub:';
  const GLOBAL_ID = 'global';
  // 数独的 key 故意保持原样。它装着玩家已经做了几十局的存档、题库和战绩，
  // 为了「目录看起来整齐」去改 key，等于拿这些数据赌一次迁移。
  const GLOBAL_KEY = PREFIX + 'global:v1';

  const spaces = {};

  const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

  /**
   * 一层深合并。settings / stats / wallet 这类结构只需要补上新版本新增的字段，
   * 整块替换会把玩家已有的数据抹掉。
   */
  function mergeDefaults(base, saved) {
    const out = {};
    for (const k of Object.keys(base)) {
      const b = base[k];
      const s = saved ? saved[k] : undefined;
      out[k] = isPlain(b) && isPlain(s) ? Object.assign({}, b, s) : (s === undefined ? b : s);
    }
    // 存档里有、默认值里没有的键照样留着：老版本写进去的字段不该因为新版本不再声明就消失
    if (saved) for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
    return out;
  }

  function readKey(key, defaults) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return defaults();
      return mergeDefaults(defaults(), JSON.parse(raw));
    } catch (e) {
      // 存储里是坏 JSON（手工改过、或写到一半断电）：退回默认值，
      // 而不是让整个合集起不来。原始内容不删，留在那里还有救回来的可能。
      console.warn('本地数据损坏，已按默认值启动：' + key, e && e.message);
      return defaults();
    }
  }

  /**
   * @param {string} id      命名空间名，通常就是游戏 id
   * @param {object} opts    { key, defaults }
   *   key        localStorage 的键
   *   defaults   返回一份全新默认数据的函数（每次调用都要给新对象）
   */
  function create(id, opts) {
    if (spaces[id]) return spaces[id];
    const key = opts.key;
    const defaults = opts.defaults;
    let state = readKey(key, defaults);
    let timer = null;
    let dirty = false;

    function flush() {
      clearTimeout(timer);
      timer = null;
      if (!dirty) return;
      dirty = false;
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (e) {
        // 存储写满或被禁用时静默降级：游戏本身不该因此崩掉
        console.warn('本地存储写入失败（' + id + '）：', e && e.message);
      }
    }

    spaces[id] = {
      id: id,
      key: key,
      data: () => state,
      save: () => {
        dirty = true;
        clearTimeout(timer);
        timer = setTimeout(flush, 220);
      },
      flush: flush,
      reload: () => { state = readKey(key, defaults); },
      reset: () => { state = defaults(); dirty = true; flush(); },
      exists: () => localStorage.getItem(key) !== null,
      defaults: defaults,
    };
    return spaces[id];
  }

  const space = (id) => spaces[id] || null;
  const globalSpace = () => create(GLOBAL_ID, {
    key: GLOBAL_KEY,
    defaults: () => ({ theme: 'light', points: 0, earned: {}, migrations: {} }),
  });

  /* ---------------- 一次性迁移 ----------------
   * 每个迁移跑成功过一次就记在全局命名空间里，不会重复执行。
   * 失败不记账，下次启动还会再试——迁移失败被静默跳过，
   * 表现就是「点数不见了」，那比报错难查得多。
   */
  const MIGRATIONS = [
    {
      id: 'points-to-global',
      note: '通关点数原本存在数独的 wallet 里，现在提到全局，所有游戏共用一个账本',
      run: function () {
        const sudoku = spaces.sudoku;
        const wallet = sudoku && sudoku.data().wallet;
        if (!wallet || !wallet.points) return;
        const g = globalSpace();
        g.data().points += wallet.points;
        g.data().earned.sudoku = (g.data().earned.sudoku || 0) + wallet.points;
        // 搬完就删掉旧字段。留着会让「点数以哪一份为准」变成需要猜的事，
        // 以后改点数逻辑时很容易只改了一份。
        delete wallet.points;
        sudoku.save();
        g.save();
      },
    },
  ];

  function runMigrations() {
    const g = globalSpace();
    for (const m of MIGRATIONS) {
      if (g.data().migrations[m.id]) continue;
      try {
        m.run();
        g.data().migrations[m.id] = Date.now();
      } catch (e) {
        console.warn('数据迁移失败，下次启动重试：' + m.id, e && e.message);
      }
    }
    g.flush();
  }

  function flushAll() {
    for (const id of Object.keys(spaces)) spaces[id].flush();
  }

  /** 清除本机全部数据：连同键一起删掉，不只是写回默认值 */
  function wipe() {
    for (const id of Object.keys(spaces)) {
      try {
        localStorage.removeItem(spaces[id].key);
      } catch (e) {
        console.warn('清除失败：' + spaces[id].key, e && e.message);
      }
      // 内存里的状态也要归零，否则不刷新页面的话读到的还是旧数据
      spaces[id].reload();
    }
  }

  SD.Storage = {
    create: create,
    space: space,
    global: globalSpace,
    ids: () => Object.keys(spaces),
    runMigrations: runMigrations,
    flushAll: flushAll,
    wipe: wipe,
  };
})(window);
