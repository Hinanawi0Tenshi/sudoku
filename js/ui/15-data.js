/* 数独 · 数据面板（统计 / 导入导出 / 每日挑战） */
(function (global) {
  'use strict';

  const SD = global.SD;
  const B = SD.Base;
  const { el, clear, toast, modal, download, pickFile, loadImage } = SD.UI;

  const mmss = (ms) => B.formatDuration(ms || 0);
  const stars = (n) => '★'.repeat(Math.max(1, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - Math.max(1, Math.min(5, n))));

  /* ---------------- 棋盘导出为 PNG ---------------- */
  function exportBoardPNG(board, title) {
    const cell = 64;
    const pad = 26;
    const size = cell * 9 + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size + 52;
    const ctx = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const bg = css.getPropertyValue('--surface').trim() || '#fff';
    const line = css.getPropertyValue('--border-strong').trim() || '#ccc';
    const text = css.getPropertyValue('--given').trim() || '#111';
    const user = css.getPropertyValue('--user').trim() || '#2f6fed';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = text;
    ctx.font = '600 18px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title || '数独', pad, 32);

    ctx.translate(pad, 52);
    ctx.lineWidth = 2;
    ctx.strokeStyle = line;
    for (let i = 0; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, cell * 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(cell * 9, i * cell);
      ctx.stroke();
    }
    ctx.lineWidth = 3;
    for (let i = 0; i <= 9; i += 3) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, cell * 9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(cell * 9, i * cell);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 32px sans-serif';
    for (let i = 0; i < 81; i++) {
      const d = board.grid[i];
      if (!d) continue;
      ctx.fillStyle = board.isGiven(i) ? text : user;
      ctx.fillText(String(d), (B.COL_OF[i] + 0.5) * cell, (B.ROW_OF[i] + 0.5) * cell);
    }

    return canvas;
  }

  function serializeGame(game) {
    const st = game.state;
    return {
      version: 1,
      givens: B.gridToString(st.givens || st.board.givens),
      grid: B.gridToString(st.board.grid),
      notes: Array.from(st.board.notes),
      meta: st.meta,
      hints: st.hints,
      mistakes: st.mistakes,
      elapsed: game.elapsedMs(),
    };
  }

  function renderData(root, ctx) {
    clear(root);
    const s = SD.Store.stats();

    /* 概览 */
    const winRate = s.games ? Math.round((s.wins / s.games) * 100) : 0;
    root.appendChild(
      el('div.result-grid', null, [
        tile(String(s.games), '总对局'),
        tile(String(s.wins), '已解出'),
        tile(winRate + '%', '胜率'),
        tile(mmss(s.playTime), '累计用时'),
      ])
    );

    /* 分难度 */
    const diffs = SD.Generator.DIFFICULTY_ORDER.filter((d) => s.byDifficulty[d]);
    if (diffs.length) {
      const max = Math.max.apply(null, diffs.map((d) => s.byDifficulty[d].games));
      const body = el('div.card', null, el('h3', { text: '各难度战绩' }));
      const bars = el('div.bars');
      for (const d of diffs) {
        const b = s.byDifficulty[d];
        const h = Math.round((b.games / max) * 100);
        const hw = b.games ? Math.round((b.wins / b.games) * 100) : 0;
        bars.appendChild(
          el('div.bar-col', null, [
            el('div.bar-val', { text: b.games + '局' }),
            el('div.bar', { title: '胜率 ' + hw + '%', style: { height: Math.max(6, h * 0.62) + 'px' } }, el('i', { style: { height: hw + '%' } })),
            el('div.bar-label', { text: SD.Generator.DIFFICULTY[d].name }),
          ])
        );
      }
      body.appendChild(bars);
      body.appendChild(
        el('p', { text: '蓝色部分为成功解出的局数。最快纪录：' + diffs.map((d) => SD.Generator.DIFFICULTY[d].name + ' ' + mmss(s.bestTimes[d])).join('　') })
      );
      root.appendChild(body);
    }

    /* 技巧使用 */
    const used = Object.keys(s.techniqueUse).sort((a, b) => s.techniqueUse[b] - s.techniqueUse[a]);
    if (used.length) {
      const body = el('div.card', null, el('h3', { text: '技巧使用统计' }));
      for (const id of used.slice(0, 8)) {
        const t = SD.Techniques.byId[id];
        body.appendChild(el('div.kv', null, [el('span', { text: t ? t.name : id }), el('b', { text: s.techniqueUse[id] + ' 次' })]));
      }
      body.appendChild(el('p', { text: '这些数字来自你主动索取的提示 —— 越集中在高级技巧上，说明你越偏好自己硬推。' }));
      root.appendChild(body);
    }

    /* 每日挑战 */
    const daily = Object.keys(s.daily).sort().reverse().slice(0, 8);
    if (daily.length) {
      const body = el('div.card', null, el('h3', { text: '每日挑战' }));
      for (const d of daily) {
        const r = s.daily[d];
        body.appendChild(el('div.kv', null, [el('span', { text: d }), el('b', { text: r.won ? mmss(r.timeMs) : '未完成' })]));
      }
      root.appendChild(body);
    }

    /* 导入导出 */
    const io = el('div.card', null, [el('h3', { text: '导入 / 导出' })]);
    io.appendChild(
      el('p', { text: '导出为纯文本可以直接贴到任何地方；JSON 格式能完整保留进度、笔记和用时。' })
    );
    io.appendChild(
      el('div.btn-row', null, [
        el('button.btn', { text: '导出题面文本', onclick: () => download('sudoku-' + Date.now() + '.txt', B.gridToPretty(ctx.game.state.givens || ctx.game.state.board.givens)) }),
        el('button.btn', { text: '导出对局 JSON', onclick: () => download('sudoku-' + Date.now() + '.json', JSON.stringify(serializeGame(ctx.game), null, 2), 'application/json') }),
        el('button.btn', { text: '导出棋盘图片', onclick: () => exportBoardPNG(ctx.game.state.board, '数独 · ' + (ctx.game.state.meta.difficultyName || '自定义')) }),
      ])
    );
    io.appendChild(
      el('div.btn-row', null, [
        el('button.btn', {
          text: '导入题面文本',
          onclick: () => importText(ctx),
        }),
        el('button.btn', {
          text: '导入对局 JSON',
          onclick: () => importJSON(ctx),
        }),
      ])
    );
    root.appendChild(io);

    root.appendChild(
      el('div.btn-row', null, [
        el('button.btn', {
          text: '清空统计',
          onclick: () => {
            SD.UI.confirm('清空统计', '所有对局记录、技巧统计都会被删除，设置不受影响。确定吗？', '清空').then((ok) => {
              if (!ok) return;
              SD.Store.resetStats();
              renderData(root, ctx);
              toast('统计已清空', 'ok');
            });
          },
        }),
      ])
    );
  }

  const tile = (val, label) => el('div.result-tile', null, [el('div.rt-val', { text: val }), el('div.rt-label', { text: label })]);

  function importText(ctx) {
    const ta = el('textarea', { rows: 9, placeholder: '粘贴题面，支持 81 个字符（0 或 . 表示空格），也支持带空格和换行的格式' });
    modal({
      title: '导入题面',
      body: el('div', null, [
        el('p', { text: '导入后会立刻做规则体检：检查重复数字、是否有解、解是否唯一，并按人类技巧自动分级。' }),
        ta,
      ]),
      footer: [
        { label: '取消' },
        { label: '体检并载入', primary: true, onClick: () => ctx.applyImported(ta.value) },
      ],
    });
  }

  function importJSON(ctx) {
    pickFile('.json,application/json').then((file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          if (!data.givens) throw new Error('缺少 givens 字段');
          ctx.applyImported(data.givens, data);
        } catch (e) {
          toast('导入失败：' + e.message, 'err');
        }
      };
      reader.onerror = () => toast('文件读取失败', 'err');
      reader.readAsText(file);
    });
  }

  SD.Data = { renderData: renderData, exportBoardPNG: exportBoardPNG, serializeGame: serializeGame, stars: stars };
})(window);
