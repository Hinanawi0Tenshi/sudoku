/* 数独 · 图片识别界面：载入图片 → 校正透视 → 识别数字 → 人工复核 → 体检入库
 * 识别走两条路再取信度更高者：
 *   A 整幅校正图直接 OCR（适合印刷体、扫描件）
 *   B 把 81 格拼成带间隔的长条再 OCR（适合拍照、小字号）
 * 两条都不可靠的格子会标黄，交给人点一下改。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
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
      const found = SD.Vision.detectQuad(c);
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
    const move = (e) => {
      const rect = ev.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      state.quad[key] = {
        x: Math.max(0, Math.min(state.image.width, x)),
        y: Math.max(0, Math.min(state.image.height, y)),
      };
      const h = document.querySelector('.ocr-handle[data-label="' + labelOf(key) + '"]');
      if (h) {
        h.style.left = state.quad[key].x * scale + 'px';
        h.style.top = state.quad[key].y * scale + 'px';
      }
      drawStage();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  const labelOf = (k) => ({ tl: '左上', tr: '右上', br: '右下', bl: '左下' })[k];

  SD.OCR = { state: state, loadSource: loadSource, autoDetect: autoDetect, drawStage: drawStage, LOW_CONF: LOW_CONF, log: log, setStatus: setStatus };

  /* ---------------- Tesseract ---------------- */

  const VENDOR = 'js/vendor/';
  // worker 是运行时拼出来的完整文件路径，可以加版本戳绕开缓存。
  // corePath 和 langPath 是「目录」——Tesseract 会在其后自己拼 core 文件名
  // 和 eng.traineddata.gz，给目录加 ?v= 会让拼出来的地址整个错位，
  // 实测识别率直接掉到 0。这两个目录只能指望 Tesseract 自己那层缓存策略。

  function ensureWorker() {
    if (state.worker) return Promise.resolve(state.worker);
    if (typeof Tesseract === 'undefined') {
      return Promise.reject(new Error('OCR 引擎未加载，请检查 js/vendor/tesseract 是否存在'));
    }
    setStatus('正在加载 OCR 引擎（首次约需几秒）…');
    state.worker = Tesseract.createWorker('eng', 1, {
      workerPath: SD.Base.versioned(VENDOR + 'tesseract/worker.min.js'),
      corePath: VENDOR + 'tesseract',
      langPath: VENDOR + 'tessdata',
      workerBlobURL: false,
      logger: (m) => {
        if (m.status && m.progress !== undefined && /load|initial/i.test(m.status)) {
          setStatus('OCR 引擎：' + m.status + ' ' + Math.round(m.progress * 100) + '%');
        }
      },
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '10',   // 单字符：逐格识别时最稳
        preserve_interword_spaces: '0',
      });
      setStatus('OCR 引擎就绪');
      return worker;
    }).catch((e) => {
      state.worker = null;
      throw e;
    });
    return state.worker;
  }

  /** 从 TSV 里取词级条目（level 5） */
  function wordsFromTsv(tsv) {
    const out = [];
    const rows = String(tsv).trim().split(/\r?\n/);
    for (let i = 1; i < rows.length; i++) {
      const c = rows[i].split('\t');
      if (c.length < 12) continue;
      if (Number(c[0]) !== 5) continue;
      const text = (c[11] || '').trim();
      if (!text) continue;
      out.push({ text: text, x: +c[6], y: +c[7], w: +c[8], h: +c[9], conf: +c[10] });
    }
    return out;
  }

  /** 字符级条目：整幅识别时相邻数字会被并成一个 word，必须按字符拆开才定位得准 */
  function charsFromBlocks(data) {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.symbols) {
          for (const s of n.symbols) {
            if (!s.text || !s.text.trim() || !s.bbox) continue;
            out.push({ text: s.text.trim(), x: s.bbox.x0, y: s.bbox.y0, w: s.bbox.x1 - s.bbox.x0, h: s.bbox.y1 - s.bbox.y0, conf: s.confidence });
          }
        }
        if (n.lines) walk(n.lines);
        if (n.paragraphs) walk(n.paragraphs);
        if (n.blocks) walk(n.blocks);
      }
    };
    walk(data && data.blocks);
    return out;
  }

  const onlyDigit = (s) => {
    const m = String(s).match(/[0-9]/);
    return m ? Number(m[0]) : 0;
  };

  /* ---------------- 策略 A：逐格单字符识别（主力） ---------------- */
  /** 把一格裁出来，按该格自己的阈值二值化后放大成 64×64 的单字符图 */
  /**
   * 切出一格的图像送给 OCR。
   *
   * 关键在先按墨迹裁剪：整格直接缩过去的话，数字只占中间三分之一，
   * 四边全是空白，而单字符模式最怕顶到边。再补一圈白边——Tesseract 训练时
   * 看到的就是留了边的字形。缩放用面积平均而不是最近邻，最近邻按 floor(x*w/S)
   * 取样会把细笔画整段丢掉，1 和 7 尤其容易认不出来。
   */
  function cropCell(ctx, cell, S) {
    const w = cell.x1 - cell.x0;
    const h = cell.y1 - cell.y0;
    const data = ctx.getImageData(cell.x0, cell.y0, w, h);
    const px = data.data;

    // 墨迹包围盒
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[(y * w + x) * 4] >= cell.thr) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;   // 没墨迹

    // 尺寸闸门：印刷体线索的笔画占格子约一半，玩家写的小字笔记只占四分之一上下。
    // 按墨迹裁剪之后两者都会被放大成整格大小——不卡尺寸，笔记就会被当成线索读进去，
    // 表现出来就是一格凭空多出一个数字，满盘冲突。
    const big = Math.max(x1 - x0, y1 - y0) + 1;
    const cellSize = Math.min(w, h);
    // 阈值不写死：照片经透视校正和 JPEG 压缩后，印刷体的墨迹同样会缩水，
    // 固定比例会把真线索一起挡掉（实测照片场景从 28% 掉到 9%）。
    // 改用「本图里较大的那一簇」当线索：线索字明显大于笔记小字，
    // 按当图的分布取分界，才扛得住不同清晰度的照片。
    const isGiven = big >= cellSize * (state.givenRatio || 0.34);

    // 四周留白：字形大小要接近训练时的比例，太贴边会掉识别率
    const pad = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) * 0.28));
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    // 等比放进正方形，保持笔画粗细比例
    const scale = Math.min(S / cw, S / ch);
    const dw = Math.max(1, Math.round(cw * scale));
    const dh = Math.max(1, Math.round(ch * scale));
    const ox = ((S - dw) / 2) | 0;
    const oy = ((S - dh) / 2) | 0;

    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const o = c.getContext('2d');
    const img = o.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = 255;
    }
    // 面积平均：每个目标像素对应源图上一小块，取平均
    for (let y = 0; y < dh; y++) {
      const sy0 = y0 + Math.floor((y * ch) / dh);
      const sy1 = Math.max(sy0 + 1, y0 + Math.ceil(((y + 1) * ch) / dh));
      for (let x = 0; x < dw; x++) {
        const sx0 = x0 + Math.floor((x * cw) / dw);
        const sx1 = Math.max(sx0 + 1, x0 + Math.ceil(((x + 1) * cw) / dw));
        let ink = 0, n = 0;
        for (let sy = sy0; sy < sy1 && sy < h; sy++) {
          for (let sx = sx0; sx < sx1 && sx < w; sx++) {
            if (px[(sy * w + sx) * 4] < cell.thr) ink++;
            n++;
          }
        }
        if (n && ink * 2 >= n) {
          const di = ((y + oy) * S + (x + ox)) * 4;
          img.data[di] = 0;
          img.data[di + 1] = 0;
          img.data[di + 2] = 0;
        }
      }
    }
    o.putImageData(img, 0, 0);
    c.isGiven = isGiven;   // true=印刷体线索，false=小字笔记
    c.inkSize = big / cellSize;
    return c;
  }

  async function recognizePerCell(worker) {
    const ctx = state.extracted.warped.getContext('2d', { willReadFrequently: true });
    // 先量一遍全图：线索字和笔记小字是两个明显不同的尺寸簇，取中间的分界。
    // 只看有墨迹的格——空格子没有尺寸可言。
    {
      const sizes = [];
      for (const cell of state.extracted.cells) {
        const probe = cropCell(ctx, cell, 16);
        if (probe && probe.inkSize) sizes.push(probe.inkSize);
      }
      sizes.sort((a, b) => a - b);
      if (sizes.length >= 4) {
        // 取上四分位与中位数的均值：线索字一定落在这之上
        const q = sizes[Math.floor(sizes.length * 0.75)];
        const med = sizes[Math.floor(sizes.length * 0.5)];
        state.givenRatio = Math.max(0.20, Math.min(0.60, (q + med) / 2));
      }
    }
    const hits = new Array(81).fill(null);
    const retry = [];
    const pencils = [];   // 判为用户小字笔记的格子
    let tried = 0;

    for (const cell of state.extracted.cells) {
      if (cell.ink < 0.008) continue;
      tried++;
      const tile = cropCell(ctx, cell, 64);
      if (!tile) continue;   // 这格没墨迹，交给整幅识别兜底
      // 小字笔记不是题面的一部分，不送进 OCR 当线索
      if (!tile.isGiven) { pencils.push(cell); continue; }
      const r = await worker.recognize(tile, {}, { blocks: false, tsv: false, text: true });
      const d = onlyDigit((r.data && r.data.text) || '');
      if (d) hits[cell.index] = { digit: d, conf: (r.data && r.data.confidence) || 0 };
      else retry.push(cell);
    }

    // 白名单 + LSTM 偶尔会把 1、7 读成字母或标点。这些格子去掉白名单、
    // 换成单词模式再试一次，只要结果是单个数字就采信（置信度打个折）。
    if (retry.length) {
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '8' });
      for (const cell of retry) {
        const tile = cropCell(ctx, cell, 64);
        if (!tile || !tile.isGiven) continue;   // 同样只认印刷体
        const r = await worker.recognize(tile, {}, { blocks: false, tsv: false, text: true });
        const raw = String((r.data && r.data.text) || '').trim();
        if (/^[0-9]$/.test(raw)) {
          hits[cell.index] = { digit: Number(raw), conf: ((r.data && r.data.confidence) || 0) * 0.9 };
        }
      }
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '10' });
    }

    log('策略A 逐格识别：尝试 ' + tried + ' 格，命中 ' + hits.filter(Boolean).length + '（需重试 ' + retry.length + '）');
    return hits;
  }

  /* ---------------- 策略 B：整幅识别（兜底） ---------------- */
  async function recognizeWhole(worker) {
    const canvas = state.extracted.warped;
    await worker.setParameters({ tessedit_pageseg_mode: '11' });   // 稀疏文本
    const r = await worker.recognize(canvas, {}, { blocks: true, tsv: true });
    let chars = charsFromBlocks(r.data);
    if (!chars.length) chars = wordsFromTsv(r.data && r.data.tsv);
    await worker.setParameters({ tessedit_pageseg_mode: '10' });

    const hits = new Array(81).fill(null);
    for (const ch of chars) {
      const d = onlyDigit(ch.text);
      if (!d) continue;
      const g = state.extracted.grid;
      const cx = ch.x + ch.w / 2;
      const cy = ch.y + ch.h / 2;
      const col = Math.floor((cx - g.x0) / g.cellW);
      const row = Math.floor((cy - g.y0) / g.cellH);
      if (col < 0 || col > 8 || row < 0 || row > 8) continue;
      const idx = row * 9 + col;
      if (state.extracted.cells[idx].ink < 0.008) continue;
      if (!hits[idx] || ch.conf > hits[idx].conf) hits[idx] = { digit: d, conf: ch.conf };
    }
    log('策略B 整幅识别：命中 ' + hits.filter(Boolean).length + ' / 81 格');
    return hits;
  }
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
      const extracted = SD.Vision.extractCells(src, state.quad, state.cellSize);
      if (!extracted) throw new Error('透视校正失败，请调整四个角后重试');
      state.extracted = extracted;

      const worker = await ensureWorker();
      let perCell = null;
      let whole = null;
      try {
        perCell = await recognizePerCell(worker);
      } catch (e) {
        log('逐格识别失败：' + e.message);
        perCell = new Array(81).fill(null);
      }
      // 逐格没读出来 / 读得可疑的格，再用整幅结果补位
      try {
        whole = await recognizeWhole(worker);
      } catch (e) {
        log('整幅识别失败：' + e.message);
        whole = new Array(81).fill(null);
      }

      let hits = 0;
      for (let i = 0; i < 81; i++) {
        const hp = perCell[i];
        const hw = whole[i];
        // 逐格结果只要置信度不是极低就直接采信，否则用整幅结果兜底
        let pick = hp;
        if (!hp || hp.conf < 40) pick = hw || hp;
        state.digits[i] = pick ? pick.digit : 0;
        state.confidences[i] = pick ? pick.conf : -1;
        if (pick) hits++;
      }

      renderResult();
      const low = state.confidences.filter((c) => c >= 0 && c < LOW_CONF).length;
      const clash = checkConflicts();
      renderResult();
      // 冲突格优先报：置信度低的格子顶多是「不确定」，冲突格是「几乎肯定错」
      setStatus('识别完成：' + hits + ' 格有数字'
        + (clash ? '，其中 ' + clash + ' 格与同行/同列/同宫重复（标红），多半认错了，必须先改' : '')
        + (low && !clash ? '，其中 ' + low + ' 格置信度偏低（标黄），建议逐格确认' : (low ? '' : '，置信度良好')),
        clash || low ? 'warn' : 'ok');
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

  function editCell(i) {
    const wrap = el('div.ocr-preview');
    const grid = new Array(81).fill(0);
    grid[i] = state.digits[i];
    for (let k = 0; k < 81; k++) {
      const cell = el('div.ocr-cell' + (grid[k] ? '.has' : ''), {
        text: grid[k] ? String(grid[k]) : '',
        onclick: () => (grid[k] = (grid[k] + 1) % 10),
      });
      cell._refresh = () => {
        cell.textContent = grid[k] ? String(grid[k]) : '';
        cell.className = 'ocr-cell' + (grid[k] ? ' has' : '');
      };
      wrap.appendChild(cell);
    }
    modal({
      title: 'R' + (Math.floor(i / 9) + 1) + 'C' + ((i % 9) + 1) + ' — 点格子循环 0→1→…→9',
      body: wrap,
      footer: [
        { label: '取消' },
        {
          label: '确定',
          primary: true,
          onClick: () => {
            state.digits[i] = grid[i];
            state.confidences[i] = 100; // 人工确认过的直接标为可信
            // 改完重算冲突：原先红着的格子可能因为这一改而不成立了
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

  SD.OCR.mount = mount;
  SD.OCR.recognize = recognize;
  SD.OCR.renderResult = renderResult;
})(window);
