/* 数独 · 棋盘识别器（js/games/sudoku/07c-recognizer.js）
 *
 * 从一份成熟的单文件实现移植而来，五个环节一条链：
 *   ① 积分图 Bradley-Roth 自适应二值化——按局部窗口算阈值，抗光照阴影。
 *   ② 最大连通域四角定位 + 单应变换拉平。
 *   ③ 中心连通域提取：**自动剥离贴边的网格线**。网格线又黑又长，
 *      混进统计量会把包围盒、连通块、平均墨色全带偏。
 *   ④ 28x28 归一化 + 拓扑孔洞数 + 长宽比 + 余弦相似度。
 *      孔洞数是"字形有几个封闭圈"：8 有两个、6/9/4 有一个、1/2/3/5/7 没有。
 *      纯拓扑特征，和字体、粗细、清晰度都无关。
 *   ⑤ 用数独同行/列/宫互斥约束纠错：低置信度格撞上高置信度格时自动回退次优候选。
 *
 * 模板在运行时用 Canvas 现画（12 种字体 x 3 种横向缩放），零外部模型文件。
 *
 * 注意：`recognizeWarpedBoard` 按 9 等分切格，喂进来的校正图必须**正好是棋盘**。
 * 曾经因为 warpQuad 缩放方向反了（校正图里棋盘只占 68%），整体错位、结果全是垃圾。
 */
(function (global) {
  'use strict';
  const SD = global.SD = global.SD || {};
  SD.Sudoku = SD.Sudoku || {};

class SudokuImageRecognizer {
  constructor() {
    this.PATCH_SIZE = 28;
    this.templates = [];
    this.initSyntheticFontBank();
  }

  /**
   * 启动时利用离屏 Canvas 动态渲染常见印刷体/无辜衬线/衬线字体的 1-9 特征库
   * 耗时 < 15ms，彻底免除外部 .onnx / .tflite 模型文件加载！
   */
  initSyntheticFontBank() {
    const fonts = [
      'normal 40px sans-serif',
      'bold 40px sans-serif',
      'normal 40px Arial, Helvetica, sans-serif',
      'bold 40px Arial, Helvetica, sans-serif',
      'normal 40px "Segoe UI", Roboto, sans-serif',
      'bold 40px "Segoe UI", Roboto, sans-serif',
      'normal 40px Verdana, Geneva, sans-serif',
      'bold 40px Verdana, Geneva, sans-serif',
      'normal 40px Georgia, "Times New Roman", serif',
      'bold 40px Georgia, "Times New Roman", serif',
      'normal 40px "Courier New", monospace',
      'bold 40px "Courier New", monospace'
    ];
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    this.templates = [];
    for (let d = 1; d <= 9; d++) {
      for (const font of fonts) {
        for (const scaleX of [0.9, 1.0, 1.1]) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, 64, 64);
          ctx.save();
          ctx.translate(32, 32);
          ctx.scale(scaleX, 1.0);
          ctx.font = font;
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(d), 0, 2);
          ctx.restore();

          const imgData = ctx.getImageData(0, 0, 64, 64);
          const bin = new Uint8Array(64 * 64);
          for (let i = 0; i < bin.length; i++) {
            bin[i] = imgData.data[i * 4] > 128 ? 1 : 0;
          }
          const feat = this.extractNormalizedFeatureFromBinary(bin, 64, 64, false);
          if (feat) {
            this.templates.push({ digit: d, ...feat });
          }
        }
      }
    }
  }

  /**
   * 步骤 1：积分图自适应阈值二值化 (Bradley-Roth 算法)
   * 返回前景为 1（深色线条/数字）、背景为 0（浅色纸面）的 Uint8Array
   */
  adaptiveThreshold(imageData, windowRatio = 0.12, sensitivity = 0.85) {
    const { width: w, height: h, data } = imageData;
    const gray = new Uint8Array(w * h);
    const integral = new Float64Array((w + 1) * (h + 1));

    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const g = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
        gray[y * w + x] = g;
        rowSum += g;
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    const bin = new Uint8Array(w * h);
    const s2 = Math.max(4, Math.floor(Math.min(w, h) * windowRatio / 2));
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(h - 1, y + s2);
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - s2);
        const x2 = Math.min(w - 1, x + s2);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
          integral[y1 * (w + 1) + (x2 + 1)] -
          integral[(y2 + 1) * (w + 1) + x1] +
          integral[y1 * (w + 1) + x1];
        bin[y * w + x] = gray[y * w + x] * count < sum * sensitivity ? 1 : 0;
      }
    }
    return bin;
  }

  /**
   * 步骤 2：在二值图中寻找面积最大的连通域（数独大外框）并定位四个顶点 (TL, TR, BR, BL)
   */
  detectBoardCorners(imageData) {
    const { width: w, height: h } = imageData;
    const bin = this.adaptiveThreshold(imageData, 0.12, 0.86);
    const visited = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);

    let bestComp = null;
    let maxArea = 0;

    for (let i = 0; i < w * h; i++) {
      if (bin[i] === 1 && !visited[i]) {
        let head = 0, tail = 0;
        queue[tail++] = i;
        visited[i] = 1;

        let minX = w, maxX = 0, minY = h, maxY = 0;
        // 极值准则找四个角点：
        // TL: min(x+y), TR: max(x-y), BR: max(x+y), BL: min(x-y)
        let tl = null, tr = null, br = null, bl = null;
        let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;

        while (head < tail) {
          const curr = queue[head++];
          const cx = curr % w;
          const cy = (curr / w) | 0;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const sum = cx + cy;
          const diff = cx - cy;
          if (sum < minSum) { minSum = sum; tl = { x: cx, y: cy }; }
          if (sum > maxSum) { maxSum = sum; br = { x: cx, y: cy }; }
          if (diff > maxDiff) { maxDiff = diff; tr = { x: cx, y: cy }; }
          if (diff < minDiff) { minDiff = diff; bl = { x: cx, y: cy }; }

          // 4-邻域扩展
          const neighbors = [curr - 1, curr + 1, curr - w, curr + w];
          for (let k = 0; k < 4; k++) {
            const nb = neighbors[k];
            if (nb >= 0 && nb < w * h && bin[nb] === 1 && !visited[nb]) {
              const nx = nb % w;
              if (Math.abs(nx - cx) <= 1) {
                visited[nb] = 1;
                queue[tail++] = nb;
              }
            }
          }
        }

        const bboxArea = (maxX - minX) * (maxY - minY);
        // 过滤过小的连通域，要求外接矩形至少占画面 18%
        if (bboxArea > maxArea && bboxArea > w * h * 0.18 && tail > (w + h) * 1.5) {
          maxArea = bboxArea;
          bestComp = [tl, tr, br, bl];
        }
      }
    }

    // 如果截图没有封闭外框，回退到保留 2% 边距的全图四角
    if (!bestComp) {
      const padX = Math.round(w * 0.02);
      const padY = Math.round(h * 0.02);
      return [
        { x: padX, y: padY },
        { x: w - padX, y: padY },
        { x: w - padX, y: h - padY },
        { x: padX, y: h - padY }
      ];
    }
    return bestComp;
  }

  /**
   * 求解从目标正方形 [0,0 -> dstSize,dstSize] 映射回原图四边形 corners 的 3x3 透视变换矩阵
   */
  computeHomography(dstSize, corners) {
    const src = [
      [0, 0],
      [dstSize, 0],
      [dstSize, dstSize],
      [0, dstSize]
    ];
    const dst = corners.map(p => [p.x, p.y]);
    const A = [];
    const B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i];
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
      B.push(u);
      A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
      B.push(v);
    }
    const h = this.solveLinearSystem8x8(A, B);
    return [...h, 1];
  }

  solveLinearSystem8x8(A, B) {
    const n = 8;
    const M = A.map((row, i) => [...row, B[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const div = M[col][col] || 1e-10;
      for (let j = col; j <= n; j++) M[col][j] /= div;
      for (let row = 0; row < n; row++) {
        if (row !== col) {
          const factor = M[row][col];
          for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
        }
      }
    }
    return M.map(row => row[n]);
  }

  /**
   * 对原图执行双线性插值透视变换，输出 450x450 标准正方形棋盘 ImageData
   */
  warpPerspective(srcImageData, corners, dstSize = 450) {
    const H = this.computeHomography(dstSize, corners);
    const { width: sw, height: sh, data: sdata } = srcImageData;
    const dstImg = new ImageData(dstSize, dstSize);
    const ddata = dstImg.data;

    for (let y = 0; y < dstSize; y++) {
      for (let x = 0; x < dstSize; x++) {
        const denom = H[6] * x + H[7] * y + 1;
        const u = (H[0] * x + H[1] * y + H[2]) / denom;
        const v = (H[3] * x + H[4] * y + H[5]) / denom;

        const x0 = Math.floor(u), y0 = Math.floor(v);
        const dx = u - x0, dy = v - y0;
        const dstIdx = (y * dstSize + x) * 4;

        if (x0 >= 0 && x0 < sw - 1 && y0 >= 0 && y0 < sh - 1) {
          const i00 = (y0 * sw + x0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + sw * 4;
          const i11 = i01 + 4;
          for (let c = 0; c < 3; c++) {
            const val =
              sdata[i00 + c] * (1 - dx) * (1 - dy) +
              sdata[i10 + c] * dx * (1 - dy) +
              sdata[i01 + c] * (1 - dx) * dy +
              sdata[i11 + c] * dx * dy;
            ddata[dstIdx + c] = val;
          }
          ddata[dstIdx + 3] = 255;
        } else {
          ddata[dstIdx] = 255;
          ddata[dstIdx + 1] = 255;
          ddata[dstIdx + 2] = 255;
          ddata[dstIdx + 3] = 255;
        }
      }
    }
    return dstImg;
  }

  /**
   * 步骤 3：从单格二值图中剥离四周网格线，提取中心连通域并归一化到 28x28 特征图
   */
  extractNormalizedFeatureFromBinary(cellBin, cw, ch, stripBorders = true) {
    const visited = new Uint8Array(cw * ch);
    const queue = new Int32Array(cw * ch);
    const validPixels = [];

    const centerX = cw / 2;
    const centerY = ch / 2;

    // 寻找所有连通域，剔除贴边网格线与微小噪点
    const components = [];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const idx = y * cw + x;
        if (cellBin[idx] === 1 && !visited[idx]) {
          let head = 0, tail = 0;
          queue[tail++] = idx;
          visited[idx] = 1;

          let minX = cw, maxX = 0, minY = ch, maxY = 0;
          let sumX = 0, sumY = 0;
          const pts = [];

          while (head < tail) {
            const curr = queue[head++];
            const cx = curr % cw;
            const cy = (curr / cw) | 0;
            pts.push([cx, cy]);
            sumX += cx;
            sumY += cy;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            // 8-邻域确保斜笔画不断裂
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx >= 0 && nx < cw && ny >= 0 && ny < ch) {
                  const nIdx = ny * cw + nx;
                  if (cellBin[nIdx] === 1 && !visited[nIdx]) {
                    visited[nIdx] = 1;
                    queue[tail++] = nIdx;
                  }
                }
              }
            }
          }

          const bw = maxX - minX + 1;
          const bh = maxY - minY + 1;
          const meanX = sumX / pts.length;
          const meanY = sumY / pts.length;

          if (stripBorders) {
            const margin = Math.max(4, Math.round(cw * 0.11));
            const touchesLeft = minX <= margin;
            const touchesRight = maxX >= cw - 1 - margin;
            const touchesTop = minY <= margin;
            const touchesBottom = maxY >= ch - 1 - margin;

            // 剔除横跨贴边的网格线或完全处于边缘的伪影
            if ((touchesLeft && touchesRight) || (touchesTop && touchesBottom)) continue;
            if (bw > cw * 0.84 || bh > ch * 0.88) continue;
            if (meanX < margin * 1.3 || meanX > cw - margin * 1.3 || meanY < margin * 1.3 || meanY > ch - margin * 1.3) continue;
            if (pts.length < 10 || bh < ch * 0.24) continue;
          }

          const distToCenter = Math.hypot(meanX - centerX, meanY - centerY);
          components.push({ pts, minX, maxX, minY, maxY, bw, bh, distToCenter });
        }
      }
    }

    if (components.length === 0) return null;

    // 选取最靠近格子中心的连通域作为主数字（同时合并同一数字可能断开的相邻笔画）
    components.sort((a, b) => a.distToCenter - b.distToCenter);
    const main = components[0];
    if (stripBorders && main.distToCenter > cw * 0.30) return null;

    let minX = main.minX, maxX = main.maxX, minY = main.minY, maxY = main.maxY;
    for (const pt of main.pts) validPixels.push(pt);

    for (let i = 1; i < components.length; i++) {
      const c = components[i];
      if (
        c.minX >= main.minX - 4 &&
        c.maxX <= main.maxX + 4 &&
        c.minY >= main.minY - 6 &&
        c.maxY <= main.maxY + 6
      ) {
        for (const pt of c.pts) validPixels.push(pt);
        minX = Math.min(minX, c.minX);
        maxX = Math.max(maxX, c.maxX);
        minY = Math.min(minY, c.minY);
        maxY = Math.max(maxY, c.maxY);
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (stripBorders && (bh < ch * 0.26 || validPixels.length < 14)) return null;

    // 构建紧致局部掩码
    const tightMask = new Uint8Array(bw * bh);
    for (const [px, py] of validPixels) {
      tightMask[(py - minY) * bw + (px - minX)] = 1;
    }

    // 归一化缩放到 28x28（内部留白 4px，即有效区域 20x20；对窄体数字 '1' 保持宽度比例）
    const S = this.PATCH_SIZE;
    const patch = new Float32Array(S * S);
    const targetH = 20;
    const aspect = bw / bh;
    const targetW = aspect < 0.42 ? Math.max(6, Math.round(20 * aspect)) : 20;
    const offsetX = Math.floor((S - targetW) / 2);
    const offsetY = Math.floor((S - targetH) / 2);

    let normSum = 0;
    for (let py = 0; py < targetH; py++) {
      for (let px = 0; px < targetW; px++) {
        const sx = Math.min(bw - 1, Math.floor((px + 0.5) * bw / targetW));
        const sy = Math.min(bh - 1, Math.floor((py + 0.5) * bh / targetH));
        const val = tightMask[sy * bw + sx];
        patch[(offsetY + py) * S + (offsetX + px)] = val;
        normSum += val * val;
      }
    }

    // 提取拓扑孔洞特征 (Euler Holes)：从 28x28 边缘 Flood-Fill 背景 0，剩余未访问的 0 即为封闭孔洞
    const holeInfo = this.analyzeTopologicalHoles(patch, S);

    return {
      patch,
      norm: Math.sqrt(normSum) || 1,
      aspect,
      holes: holeInfo.count,
      holeMeanY: holeInfo.meanY
    };
  }

  /**
   * 统计归一化数字的封闭孔洞数量及孔洞重心高度
   * 如：8 有上下 2 个孔洞；6 有下方 1 个孔洞；9/4 有中上方 1 个孔洞；1/2/3/5/7 一般无孔洞
   */
  analyzeTopologicalHoles(patch, S) {
    const visited = new Uint8Array(S * S);
    const q = new Int32Array(S * S);
    let head = 0, tail = 0;

    for (let i = 0; i < S; i++) {
      const edges = [i, (S - 1) * S + i, i * S, i * S + (S - 1)];
      for (const idx of edges) {
        if (patch[idx] === 0 && !visited[idx]) {
          visited[idx] = 1;
          q[tail++] = idx;
        }
      }
    }

    while (head < tail) {
      const curr = q[head++];
      const cx = curr % S, cy = (curr / S) | 0;
      const nbs = [
        [cx - 1, cy],
        [cx + 1, cy],
        [cx, cy - 1],
        [cx, cy + 1]
      ];
      for (const [nx, ny] of nbs) {
        if (nx >= 0 && nx < S && ny >= 0 && ny < S) {
          const nIdx = ny * S + nx;
          if (patch[nIdx] === 0 && !visited[nIdx]) {
            visited[nIdx] = 1;
            q[tail++] = nIdx;
          }
        }
      }
    }

    let holeCount = 0;
    let totalHoleY = 0;
    let totalHolePixels = 0;

    for (let y = 1; y < S - 1; y++) {
      for (let x = 1; x < S - 1; x++) {
        const idx = y * S + x;
        if (patch[idx] === 0 && !visited[idx]) {
          let hHead = 0, hTail = 0;
          q[hTail++] = idx;
          visited[idx] = 1;
          let sumY = 0;

          while (hHead < hTail) {
            const curr = q[hHead++];
            const cx = curr % S, cy = (curr / S) | 0;
            sumY += cy;
            const nbs = [
              [cx - 1, cy],
              [cx + 1, cy],
              [cx, cy - 1],
              [cx, cy + 1]
            ];
            for (const [nx, ny] of nbs) {
              const nIdx = ny * S + nx;
              if (patch[nIdx] === 0 && !visited[nIdx]) {
                visited[nIdx] = 1;
                q[hTail++] = nIdx;
              }
            }
          }
          // 面积 >= 5 个像素才算真实孔洞
          if (hTail >= 5) {
            holeCount++;
            totalHoleY += sumY;
            totalHolePixels += hTail;
          }
        }
      }
    }

    return {
      count: Math.min(2, holeCount),
      meanY: totalHolePixels > 0 ? (totalHoleY / totalHolePixels) / S : 0.5
    };
  }

  /**
   * 步骤 4：单格分类器 —— 结合多字体模板余弦相似度 + 拓扑孔洞与长宽比奖励
   */
  classifyCellFeature(feat) {
    if (!feat) return { digit: 0, confidence: 1, candidates: [] };

    const bestByDigit = new Float32Array(10).fill(-1);
    const S2 = this.PATCH_SIZE * this.PATCH_SIZE;

    for (const tpl of this.templates) {
      let dot = 0;
      for (let i = 0; i < S2; i++) {
        dot += feat.patch[i] * tpl.patch[i];
      }
      let score = dot / (feat.norm * tpl.norm);

      // 长宽比匹配微调（区分窄体 1 与宽体数字）
      const aspectDiff = Math.abs(feat.aspect - tpl.aspect);
      score -= aspectDiff * 0.14;

      // 拓扑孔洞数一致奖励
      if (feat.holes === tpl.holes) {
        score += 0.08;
        if (feat.holes === 1) {
          score -= Math.abs(feat.holeMeanY - tpl.holeMeanY) * 0.18;
        }
      } else {
        score -= 0.07 * Math.abs(feat.holes - tpl.holes);
      }

      if (score > bestByDigit[tpl.digit]) {
        bestByDigit[tpl.digit] = score;
      }
    }

    const candidates = [];
    for (let d = 1; d <= 9; d++) {
      candidates.push({
        digit: d,
        score: Math.max(0, Math.min(0.99, bestByDigit[d]))
      });
    }
    candidates.sort((a, b) => b.score - a.score);

    const top1 = candidates[0];
    const top2 = candidates[1];
    // 结合绝对得分与 Top1-Top2 区分度计算综合置信度
    const margin = Math.max(0, top1.score - top2.score);
    const confidence = Math.min(0.99, Math.max(0.35, top1.score * 0.78 + margin * 1.1));

    return {
      digit: top1.digit,
      confidence,
      candidates
    };
  }

  /**
   * 步骤 5：整盘识别 + 数独同行/列/九宫格互斥规则自动纠错
   */
  recognizeWarpedBoard(warpedImageData) {
    const size = warpedImageData.width; // 450
    const cellSize = Math.floor(size / 9); // 50
    const bin = this.adaptiveThreshold(warpedImageData, 0.11, 0.84);

    const cells = [];
    const grid = Array.from({ length: 9 }, () => Array(9).fill(0));

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const cellBin = new Uint8Array(cellSize * cellSize);
        const startX = c * cellSize;
        const startY = r * cellSize;
        for (let y = 0; y < cellSize; y++) {
          for (let x = 0; x < cellSize; x++) {
            cellBin[y * cellSize + x] = bin[(startY + y) * size + (startX + x)];
          }
        }

        const feat = this.extractNormalizedFeatureFromBinary(cellBin, cellSize, cellSize, true);
        const res = this.classifyCellFeature(feat);
        grid[r][c] = res.digit;
        cells.push({
          r,
          c,
          digit: res.digit,
          confidence: res.confidence,
          candidates: res.candidates,
          feat
        });
      }
    }

    // 利用数独规则解决同行/同列/同宫冲突：若低置信度格与高置信度格重复，自动回退次优候选
    this.resolveSudokuConflicts(grid, cells);

    return { grid, cells };
  }

  resolveSudokuConflicts(grid, cells) {
    const hasConflictWithHighConf = (r, c, val, myConf) => {
      for (let i = 0; i < 9; i++) {
        if (i !== c && grid[r][i] === val && cells[r * 9 + i].confidence > myConf + 0.04) return true;
        if (i !== r && grid[i][c] === val && cells[i * 9 + c].confidence > myConf + 0.04) return true;
      }
      const br = Math.floor(r / 3) * 3;
      const bc = Math.floor(c / 3) * 3;
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const nr = br + dr, nc = bc + dc;
          if ((nr !== r || nc !== c) && grid[nr][nc] === val && cells[nr * 9 + nc].confidence > myConf + 0.04) {
            return true;
          }
        }
      }
      return false;
    };

    for (const cell of cells) {
      if (cell.digit === 0 || cell.candidates.length < 2) continue;
      if (hasConflictWithHighConf(cell.r, cell.c, cell.digit, cell.confidence)) {
        const alt = cell.candidates[1];
        if (alt.score > 0.45 && !hasConflictWithHighConf(cell.r, cell.c, alt.digit, 0)) {
          cell.digit = alt.digit;
          cell.confidence = Math.min(0.80, alt.score);
          grid[cell.r][cell.c] = alt.digit;
        }
      }
    }
  }
}

  SD.Sudoku.Recognizer = SudokuImageRecognizer;
})(window);
