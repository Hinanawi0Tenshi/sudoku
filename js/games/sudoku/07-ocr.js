/* 数独 · 图片识别界面：载入图片 → 校正透视 → 识别数字 → 人工复核 → 体检入库
 * 识别走两条路再取信度更高者：
 *   A 整幅校正图直接 OCR（适合印刷体、扫描件）
 *   B 把 81 格拼成带间隔的长条再 OCR（适合拍照、小字号）
 * 两条都不可靠的格子会标黄，交给人点一下改。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间
  const B = SD.Base;
  const { el, clear, toast, fileToImage, loadImage, onPasteImage, modal } = SD.UI;

  const LOW_CONF = 68;

  const state = {
    image: null,
    quad: null,
    cellSize: 80,
    extracted: null,
    digits: new Array(81).fill(0),
    confidences: new Array(81).fill(-1),
    conflicts: new Array(81).fill(0),
    worker: null,
    busy: false,
  };

  let ui = {};

  function setStatus(text, kind) {
    if (!ui.status) return;
    clear(ui.status);
    ui.status.appendChild(el('span' + (kind ? '.' + kind : ''), { text: text }));
  }

  function log(line) {
    if (!ui.log) return;
    ui.log.textContent += line + '\n';
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  /* ---------------- 载入 ---------------- */
  async function loadSource(src, label) {
    try {
      setStatus('正在载入图片…');
      const img = src instanceof Blob ? await fileToImage(src) : await loadImage(src);
      state.image = img;
      resetQuadToImage();
      drawStage();
      setStatus('图片已载入：' + (label || (img.width + '×' + img.height)) + '，拖动四个角对齐网格，然后点「自动定位」或直接识别');
    } catch (e) {
      setStatus('图片载入失败：' + e.message, 'err');
      toast('图片载入失败', 'err');
    }
  }

  function resetQuadToImage() {
    const img = state.image;
    if (!img) return;
    const padX = img.width * 0.12;
    const padY = img.height * 0.12;
    state.quad = {
      tl: { x: padX, y: padY },
      tr: { x: img.width - padX, y: padY },
      br: { x: img.width - padX, y: img.height - padY },
      bl: { x: padX, y: img.height - padY },
    };
  }

  function autoDetect() {
    if (!state.image) return;
    // 900 是折中：再小细网格线会被插值糊掉，再大连通域计算明显变慢
    const MAX = 900;
    const scale = Math.min(1, MAX / Math.max(state.image.width, state.image.height));
    const c = document.createElement('canvas');
    c.width = Math.round(state.image.width * scale);
    c.height = Math.round(state.image.height * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(state.image, 0, 0, c.width, c.height);

    setStatus('正在寻找网格边缘…');
    setTimeout(() => {
      const found = SD.Sudoku.vision.detectQuad(c);
      if (!found) {
        setStatus('自动定位失败：请手动拖动四个角对齐网格的外框', 'warn');
        toast('没找到网格，请手动对齐四个角', 'err');
        return;
      }
      const k = 1 / scale;
      state.quad = {
        tl: { x: found.tl.x * k, y: found.tl.y * k },
        tr: { x: found.tr.x * k, y: found.tr.y * k },
        br: { x: found.br.x * k, y: found.br.y * k },
        bl: { x: found.bl.x * k, y: found.bl.y * k },
      };
      drawStage();
      setStatus('已自动定位（最低线投票 ' + found.votes + '）。如果对不准，直接拖动四个角微调。', 'ok');
    }, 30);
  }

  /* ---------------- 画布与拖拽手柄 ---------------- */
  function drawStage() {
    const wrap = ui.stage;
    clear(wrap);
    if (!state.image) return;

    const img = state.image;
    const maxW = Math.min(wrap.clientWidth || 320, 520);
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.drawImage(state.image, 0, 0, w, h);

    const stage = el('div.ocr-stage', { style: { width: w + 'px', height: h + 'px' } }, canvas);

    const corners = ['tl', 'tr', 'br', 'bl'];
    const labels = { tl: '左上', tr: '右上', br: '右下', bl: '左下' };
    for (const key of corners) {
      const handle = el('div.ocr-handle', {
        dataset: { label: labels[key] },
        style: { left: state.quad[key].x * scale + 'px', top: state.quad[key].y * scale + 'px' },
      });
      handle.addEventListener('pointerdown', (ev) => startDrag(ev, key, scale));
      stage.appendChild(handle);
    }

    // 网格预览线，方便肉眼确认四角是否贴合
    ctx.save();
    ctx.strokeStyle = 'rgba(47,111,237,.85)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 9; k++) {
      const t = k / 9;
      const a = lerp(state.quad.tl, state.quad.tr, t);
      const b = lerp(state.quad.bl, state.quad.br, t);
      ctx.beginPath();
      ctx.moveTo(a.x * scale, a.y * scale);
      ctx.lineTo(b.x * scale, b.y * scale);
      ctx.stroke();
      const c = lerp(state.quad.tl, state.quad.bl, t);
      const d = lerp(state.quad.tr, state.quad.br, t);
      ctx.beginPath();
      ctx.moveTo(c.x * scale, c.y * scale);
      ctx.lineTo(d.x * scale, d.y * scale);
      ctx.stroke();
    }
    ctx.restore();

    wrap.appendChild(stage);
  }

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  function startDrag(ev, key, scale) {
    ev.preventDefault();
    // 基准矩形必须在**按下这一刻**量好。
    // ev.currentTarget 只在事件派发期间有效，等 pointermove 异步触发时它已经是 null，
    // 在那里调 getBoundingClientRect() 直接抛异常——表现就是四个角拖不动。
    const stage = ev.currentTarget.parentElement;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();

    const move = (e) => {
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      state.quad[key] = {
        x: Math.max(0, Math.min(state.image.width, x)),
        y: Math.max(0, Math.min(state.image.height, y)),
      };
      drawStage();   // 重画会重建四个角，位置跟着 state.quad 走
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }

  SD.Sudoku.ocr = { state: state, loadSource: loadSource, autoDetect: autoDetect, drawStage: drawStage, LOW_CONF: LOW_CONF, log: log, setStatus: setStatus };

  /* ---------------- 主流程 ---------------- */
  async function recognize() {
    if (!state.image) {
      toast('请先载入一张图片', 'err');
      return;
    }
    if (state.busy) return;
    state.busy = true;
    // 禁用按钮只是给人看的状态；recognize 也可能被脚本直接调用，那时还没 mount 过
    if (ui && ui.btnRecognize) ui.btnRecognize.disabled = true;
    try {
      const src = document.createElement('canvas');
      src.width = state.image.width;
      src.height = state.image.height;
      src.getContext('2d', { willReadFrequently: true }).drawImage(state.image, 0, 0);

      setStatus('正在做透视校正…');
      const extracted = SD.Sudoku.vision.extractCells(src, state.quad, state.cellSize);
      if (!extracted) throw new Error('透视校正失败，请调整四个角后重试');
      state.extracted = extracted;

      // 主路径：移植来的识别器一次跑完整盘。
      // 它自带自适应二值化、剥离贴边网格线、模板+孔洞分类、数独约束纠错，
      // 全都比"逐格喂通用 OCR"对路，而且不需要那 17MB 的 wasm 包。
      let solvedByRecognizer = false;
      try {
        const R = new SD.Sudoku.Recognizer();
        // 防御性裁紧：校正图正常应该正好是棋盘，但 refineGrid 报的范围更可靠
        const gr = state.extracted.grid;
        const side = Math.round(gr.cellW * 9);
        const wc = document.createElement('canvas');
        wc.width = side;
        wc.height = side;
        wc.getContext('2d').drawImage(state.extracted.warped, gr.x0, gr.y0, side, side, 0, 0, side, side);
        const wctx = wc.getContext('2d', { willReadFrequently: true });
        const res = R.recognizeWarpedBoard(wctx.getImageData(0, 0, side, side));
        let n = 0;
        for (let i = 0; i < 81; i++) {
          const cell = res.cells[i];
          state.digits[i] = cell.digit || 0;
          state.confidences[i] = cell.digit ? Math.round(cell.confidence * 100) : -1;
          if (cell.digit) n++;
        }
        state.engine = 'recognizer';
        // 先把结果定下来，再做界面更新：界面更新要写 ui.result，
        // 而 recognize() 也可能被脚本直接调用（那时面板根本没挂），
        // 写不进去不能算识别失败、更不能因此退回 OCR。
        solvedByRecognizer = true;
        try {
          const clash0 = checkConflicts();
          renderResult();
          const low0 = state.confidences.filter((c) => c >= 0 && c < LOW_CONF).length;
          setStatus('识别完成：' + n + ' 格有数字'
            + (clash0 ? '，其中 ' + clash0 + ' 格与同行/同列/同宫重复（标红），多半认错了，必须先改' : '')
            + (low0 && !clash0 ? '，其中 ' + low0 + ' 格置信度偏低（标黄），建议逐格确认'
              : (low0 ? '' : '，置信度良好')),
            clash0 || low0 ? 'warn' : 'ok');
          log('识别器：命中 ' + n + ' / 81 格（自适应二值化 + 剥离网格线 + 孔洞特征 + 约束纠错）');
        } catch (uiErr) { /* 面板没挂，界面更新跳过即可 */ }
      } catch (e) {
        state.engine = 'failed';
        state.recognizerError = e.message;
        log('识别器失败，退回逐格 OCR：' + e.message);
      }
      if (!solvedByRecognizer) {
        throw new Error('识别器未能完成识别' + (state.recognizerError ? '：' + state.recognizerError : ''));
      }
    } catch (e) {
      setStatus('识别失败：' + e.message, 'err');
      log('错误：' + e.message);
    } finally {
      state.busy = false;
      if (ui && ui.btnRecognize) ui.btnRecognize.disabled = false;
    }
  }

  /**
   * 用数独约束交叉校验识别结果。
   *
   * 光看 OCR 置信度不够：8 和 3 字形接近，认错时置信度照样能到 79，
   * 稳稳地越过阈值，于是错数字就静默进了题面——比明显的坏图更危险，
   * 因为它看起来完全正常。但错数字几乎必然和同行/同列/同宫的某个数字撞上，
   * 约束查得到，而置信度查不到。所以判据用约束，不用阈值。
   */
  function checkConflicts() {
    const map = SD.Validation.findConflicts(state.digits);
    for (let i = 0; i < 81; i++) {
      const peers = map.get(i);
      state.conflicts[i] = peers && peers.length ? peers : null;
    }
    return state.conflicts.filter(Boolean).length;
  }

  /* ---------------- 结果复核网格 ---------------- */
  function renderResult() {
    const box = ui.result;
    clear(box);
    const grid = el('div.ocr-preview');
    for (let i = 0; i < 81; i++) {
      const d = state.digits[i];
      const conf = state.confidences[i];
      const cls = 'ocr-cell' + (d ? ' has' : '')
        + (d && conf >= 0 && conf < LOW_CONF ? ' low' : '')
        + (state.conflicts[i] ? ' clash' : '');
      const cell = el('div.' + cls.split(' ').join('.'), {
        text: d ? String(d) : '',
        title: state.conflicts[i]
          ? '与 R' + state.conflicts[i].map((j) => (B.ROW_OF[j] + 1) + 'C' + (B.COL_OF[j] + 1)).join('、R') + ' 重复，多半是认错了'
          : (conf >= 0 ? '置信度 ' + Math.round(conf) : '未识别到数字，点击可手动填写'),
        onclick: () => editCell(i),
      });
      cell._index = i;
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  }

  /**
   * 人工修正。
   *
   * 弹窗里放的是**整盘识别结果**，不是空白盘——玩家点某一格，往往是因为看到它红了，
   * 但改的时候还得参照旁边那些格子。早先这里从全 0 起步、只填被点的那一格，
   * 看着就像"识别结果全丢了"；而且点格子只改数组不重绘（_refresh 定义了从没调用），
   * 点了没任何反应。
   */
  function editCell(i) {
    const grid = Array.from(state.digits);
    const cells = [];
    const paint = (k) => {
      const c = cells[k];
      c.textContent = grid[k] ? String(grid[k]) : '';
      c.className = 'ocr-cell' + (grid[k] ? ' has' : '') + (k === i ? ' is-sel' : '');
    };
    for (let k = 0; k < 81; k++) {
      const cell = el('div.ocr-cell', {
        onclick: () => { grid[k] = (grid[k] + 1) % 10; paint(k); },
      });
      cells.push(cell);
    }
    for (let k = 0; k < 81; k++) paint(k);
    const wrap = el('div', null, [
      el('p.ocr-hint', {
        text: '点格子循环 0→1→…→9（0 表示空格）。整盘都能改，改完点确定。'
          + '蓝框是刚点的 R' + (Math.floor(i / 9) + 1) + 'C' + ((i % 9) + 1) + '。',
      }),
      el('div.ocr-preview', null, cells),
    ]);
    modal({
      title: '修正识别结果',
      body: wrap,
      footer: [
        { label: '取消' },
        {
          label: '确定',
          primary: true,
          onClick: () => {
            // 整盘一次性写回：改动的格标成"人工确认"，没动的保持原置信度
            for (let k = 0; k < 81; k++) {
              if (grid[k] !== state.digits[k]) state.confidences[k] = 100;
              state.digits[k] = grid[k];
            }
            checkConflicts();
            renderResult();
          },
        },
      ],
    });
  }

  /* ---------------- 面板挂载 ---------------- */
  /**
   * 手动填题。
   *
   * OCR 对不平整的照片本来就不稳；与其让玩家跟识别错误较劲，
   * 不如给一块空白棋盘自己敲进去。拍得平整就用识别，拍不了就手填，
   * 两条路最后都汇到同一个体检流程，不用各自维护一套校验。
   */
  function openManualEntry() {
    const grid = new Array(81).fill(0);
    let sel = 0;
    const board = el('div.ocr-preview');
    const cells = [];
    const paint = () => {
      for (let i = 0; i < 81; i++) {
        const d = grid[i];
        cells[i].textContent = d ? String(d) : '';
        cells[i].className = 'ocr-cell' + (d ? ' has' : '') + (i === sel ? ' is-sel' : '');
      }
    };
    for (let i = 0; i < 81; i++) {
      const cell = el('div.ocr-cell', { onclick: () => { sel = i; paint(); } });
      cells.push(cell);
      board.appendChild(cell);
    }
    const put = (d) => { grid[sel] = d; paint(); };

    const pad = el('div.manual-pad');
    for (let d = 1; d <= 9; d++) {
      pad.appendChild(el('button.btn.manual-key', { text: String(d), onclick: () => put(d) }));
    }
    pad.appendChild(el('button.btn.manual-key', { text: '⌫', title: '清空这一格', onclick: () => put(0) }));

    const body = el('div.manual-wrap', null, [
      el('p.lead', { text: '点格子选中，再点下面的数字填入。也可以直接用键盘：数字键填写、退格清空、方向键移动。' }),
      board,
      pad,
    ]);

    // 键盘输入：敲一整盘时手不离键盘比来回点快得多
    body.tabIndex = 0;
    body.addEventListener('keydown', (e) => {
      if (e.key >= '1' && e.key <= '9') { put(Number(e.key)); e.preventDefault(); }
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { put(0); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { sel = Math.min(80, sel + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 9); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { sel = Math.min(80, sel + 9); paint(); e.preventDefault(); }
    });

    paint();
    modal({
      title: '手动填题',
      body: body,
      footer: [
        { label: '取消' },
        {
          label: '填入棋盘',
          primary: true,
          onClick: () => {
            let filled = 0;
            for (let i = 0; i < 81; i++) {
              state.digits[i] = grid[i];
              // 人工敲进去的当作可信，不该再被标黄要求逐格确认
              state.confidences[i] = grid[i] ? 100 : -1;
              if (grid[i]) filled++;
            }
            if (!filled) { toast('一格都还没填', 'err'); return; }
            const clash = checkConflicts();
            renderResult();
            setStatus('已手动填入 ' + filled + ' 格'
              + (clash ? '，其中 ' + clash + ' 格互相重复（标红），请先改' : '')
              + '。确认无误后点「体检并载入棋局」。', clash ? 'warn' : 'ok');
          },
        },
      ],
    });
    setTimeout(() => body.focus(), 30);
  }
  function mount(root, ctx) {
    clear(root);

    const drop = el('div.ocr-drop', { text: '把数独图片拖到这里，或点击选择文件\n也可以直接 Ctrl/⌘ + V 粘贴截图' });
    const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files[0]) loadSource(fileInput.files[0], fileInput.files[0].name);
      fileInput.value = '';
    });
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadSource(f, f.name);
    });
    onPasteImage((f) => loadSource(f, '剪贴板图片'));

    const stage = el('div');
    const status = el('div.ocr-status');
    const result = el('div');
    const logBox = el('div.ocr-log');

    const btnDetect = el('button.btn', { text: '自动定位网格', onclick: () => autoDetect() });
    const btnRecognize = el('button.btn.btn-primary', { text: '识别数字', onclick: () => recognize() });
    const btnResetQuad = el('button.btn', { text: '重置四角', onclick: () => { resetQuadToImage(); drawStage(); } });
    const btnApply = el('button.btn.btn-primary', { text: '体检并载入棋局', onclick: () => applyResult(ctx) });
    // 只有挂载在题库页时才给「存起来」——识别结果不一定要变成当前这一局
    const btnSave = ctx.onSave ? el('button.btn', { text: '存进我的题库', onclick: () => applyResult(ctx, true) }) : null;

    ui = { drop: drop, stage: stage, status: status, result: result, log: logBox, btnRecognize: btnRecognize };

    root.appendChild(drop);
    // 手填和识别是两条并行的入口：照片拍不平整时不该只能跟识别错误较劲
    root.appendChild(
      el('div.manual-entry-row', null, [
        el('span', { text: '拍不了平整的照片？' }),
        el('button.btn.btn-primary', { text: '手动填题', onclick: () => openManualEntry() }),
      ])
    );
    root.appendChild(fileInput);
    root.appendChild(stage);
    root.appendChild(el('div.btn-row', null, [btnDetect, btnRecognize, btnResetQuad]));
    root.appendChild(status);
    root.appendChild(result);
    root.appendChild(el('div.btn-row', null, [btnApply, btnSave]));
    root.appendChild(logBox);

    setStatus('先载入图片。识别全程在本机完成，不上传任何服务器。');
  }

  /** 识别结果 → 规则体检 → 交给上层载入 */
  /**
   * 识别结果 → 规则体检 → 交给上层处理。
   * @param {boolean} save 存进用户题库而不是直接开这一局
   */
  function applyResult(ctx, save) {
    const g = new Uint8Array(81);
    let filled = 0;
    for (let i = 0; i < 81; i++) {
      g[i] = state.digits[i] || 0;
      if (g[i]) filled++;
    }
    if (!filled) {
      toast('还没有任何数字，先点「识别数字」或手动填写', 'err');
      return;
    }
    setStatus('正在体检：检查重复数字、解的存在性与唯一性…');
    setTimeout(() => {
      // 先拦冲突格。inspect 也会发现重复数字，但它报的是整体结论，
      // 玩家不知道该去改哪一格；这里直接把格子号点出来。
      const clash = checkConflicts();
      if (clash) {
        const where = [];
        for (let i = 0; i < 81; i++) {
          if (state.conflicts[i]) where.push('R' + (B.ROW_OF[i] + 1) + 'C' + (B.COL_OF[i] + 1));
        }
        setStatus('这 ' + clash + ' 格互相重复，多半是认错了：' + where.join('、') + '。请先改掉再导入。', 'err');
        toast('有 ' + clash + ' 格重复数字，请先修改', 'err');
        renderResult();
        return;
      }
      const report = SD.Generator.inspect(g);
      if (!report.valid) {
        setStatus('体检未通过：' + report.reason + '。请回到上一步修改标黄的格子。', 'err');
        toast('体检未通过：' + report.reason, 'err');
        return;
      }
      const cls = report.classification;
      setStatus('体检通过：' + report.reason + '，实测难度 ' + cls.name + '（' + cls.star + ' 星）。正在载入…', 'ok');
      if (save) {
        setStatus('体检通过：' + report.reason + '，已存进我的题库。', 'ok');
        ctx.onSave(B.gridToString(g), report);
        return;
      }
      ctx.applyImported(B.gridToString(g), null, { source: '图片识别' });
    }, 20);
  }

  SD.Sudoku.ocr.mount = mount;
  SD.Sudoku.ocr.recognize = recognize;
  SD.Sudoku.ocr.renderResult = renderResult;
})(window);
