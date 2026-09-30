/* 数独 · 基础层：常量、坐标映射、位掩码工具、可复现随机数
 *
 * 位掩码约定：数字 d(1..9) 对应第 (d-1) 位，即 1<<(d-1)；空位用 0 之外的候选集合表示。
 * 这样单个 Int32/Uint16 就能装下 9 个候选，判定与消除都是 O(1) 位运算。
 */
(function (global) {
  'use strict';

  const SD = (global.SD = global.SD || {});

  const N = 9;
  const CELL_COUNT = 81;
  const ALL = 0x1ff; // 1..9 全部候选

  /* ---------- 坐标映射（预先展开成查表，避免运行时反复除法） ---------- */
  const ROW_OF = new Uint8Array(CELL_COUNT);
  const COL_OF = new Uint8Array(CELL_COUNT);
  const BOX_OF = new Uint8Array(CELL_COUNT);
  const RC_OF = new Uint8Array(CELL_COUNT);

  for (let i = 0; i < CELL_COUNT; i++) {
    const r = (i / N) | 0;
    const c = i % N;
    ROW_OF[i] = r;
    COL_OF[i] = c;
    BOX_OF[i] = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    RC_OF[i] = r * N + c;
  }

  /** 每个格子的 20 个关联格：同行 8 + 同列 8 + 同宫 4（互不重复） */
  const PEERS = (function buildPeers() {
    const out = new Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) {
      const seen = new Set();
      for (let j = 0; j < CELL_COUNT; j++) {
        if (j !== i && (ROW_OF[j] === ROW_OF[i] || COL_OF[j] === COL_OF[i] || BOX_OF[j] === BOX_OF[i])) {
          seen.add(j);
        }
      }
      out[i] = Int8Array.from(seen);
    }
    return out;
  })();

  /** 27 个基本单元：0-8 行、9-17 列、18-26 宫 */
  const UNITS = (function buildUnits() {
    const out = [];
    for (let r = 0; r < N; r++) {
      const u = new Int8Array(N);
      for (let c = 0; c < N; c++) u[c] = r * N + c;
      out.push(u);
    }
    for (let c = 0; c < N; c++) {
      const u = new Int8Array(N);
      for (let r = 0; r < N; r++) u[r] = r * N + c;
      out.push(u);
    }
    for (let b = 0; b < N; b++) {
      const u = new Int8Array(N);
      const br = ((b / 3) | 0) * 3;
      const bc = (b % 3) * 3;
      for (let k = 0; k < N; k++) u[k] = (br + ((k / 3) | 0)) * N + bc + (k % 3);
      out.push(u);
    }
    return out;
  })();

  const UNIT_KIND = ['row', 'col', 'box'];

  /** 每个格子所属的 3 个单元下标 */
  const UNITS_OF = (function buildUnitsOf() {
    const out = new Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) out[i] = Int8Array.from([ROW_OF[i], N + COL_OF[i], 2 * N + BOX_OF[i]]);
    return out;
  })();

  /* ---------- 位掩码工具 ---------- */
  const bit = (d) => 1 << (d - 1);
  const popcount = (m) => {
    let n = 0;
    while (m) {
      m &= m - 1;
      n++;
    }
    return n;
  };
  /** 掩码 → 升序数字数组 */
  function maskToDigits(m) {
    const out = [];
    for (let d = 1; d <= N; d++) if (m & bit(d)) out.push(d);
    return out;
  }
  /** 升序数字数组 → 掩码 */
  function digitsToMask(list) {
    let m = 0;
    for (const d of list) m |= bit(d);
    return m;
  }
  const firstDigit = (m) => (m & -m ? Math.round(Math.log2(m & -m)) + 1 : 0);

  /* ---------- 可复现随机数（mulberry32 + xmur3 种子哈希） ---------- */
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 种子可以是字符串或数字；字符串种子保证「每日挑战」可复现 */
  function makeRng(seed) {
    const norm = typeof seed === 'string' ? seed : String(seed);
    return mulberry32(xmur3(norm)());
  }

  /** Fisher-Yates，原地洗牌 */
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ---------- 文本 / 时间 ---------- */
  const pad2 = (n) => (n < 10 ? '0' + n : String(n));

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = (total / 3600) | 0;
    const m = ((total % 3600) / 60) | 0;
    const s = total % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
  }

  /** 棋盘 ↔ 可读字符串（. 和 0 表示空） */
  function gridToString(grid) {
    let s = '';
    for (let i = 0; i < CELL_COUNT; i++) s += grid[i] ? String(grid[i]) : '.';
    return s;
  }

  function stringToGrid(text) {
    const chars = String(text).replace(/[^0-9.]/g, '').slice(0, CELL_COUNT).split('');
    if (chars.length < CELL_COUNT) chars.push(...new Array(CELL_COUNT - chars.length).fill('.'));
    const g = new Uint8Array(CELL_COUNT);
    for (let i = 0; i < CELL_COUNT; i++) g[i] = chars[i] === '.' || chars[i] === '0' ? 0 : +chars[i];
    return g;
  }

  /** 生成带分行的 81 字符纯文本（含空格/换行的用户粘贴也能解析） */
  function gridToPretty(grid) {
    const lines = [];
    for (let r = 0; r < N; r++) {
      let line = '';
      for (let c = 0; c < N; c++) {
        line += grid[r * N + c] ? String(grid[r * N + c]) : '.';
        if (c % 3 === 2 && c !== 8) line += ' | ';
      }
      lines.push('  ' + line);
      if (r % 3 === 2 && r !== 8) lines.push('  ' + '-'.repeat(21));
    }
    return lines.join('\n');
  }

  SD.Base = {
    N,
    CELL_COUNT,
    ALL,
    ROW_OF,
    COL_OF,
    BOX_OF,
    RC_OF,
    PEERS,
    UNITS,
    UNIT_KIND,
    UNITS_OF,
    bit,
    popcount,
    maskToDigits,
    digitsToMask,
    firstDigit,
    makeRng,
    shuffle,
    pad2,
    formatDuration,
    gridToString,
    stringToGrid,
    gridToPretty,
  };
})(window);
