/* 数独 · 图像几何：单应变换、阈值化、Hough 网格定位
 * 照片里的数独几乎一定是斜的，所以透视校正不是可选项。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间
  const Vision = {};

  /* ---------------- 单应矩阵 ---------------- */

  /** 高斯消元解 n 元线性方程组（列主元），奇异时返回 null */
  function solveLinear(A, b, n) {
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      if (Math.abs(A[piv][col]) < 1e-9) return null;
      if (piv !== col) {
        const ta = A[col]; A[col] = A[piv]; A[piv] = ta;
        const tb = b[col]; b[col] = b[piv]; b[piv] = tb;
      }
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = A[r][col] / A[col][col];
        if (f === 0) continue;
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = b[i] / A[i][i];
    return out;
  }

  /**
   * 求把四边形 src 四点映射到 dst 四点（单位正方形）的单应矩阵。
   * 返回 [h0..h8]，映射 (x,y) → ((h0x+h1y+h2)/(h6x+h7y+h8), (h3x+h4y+h5)/(h6x+h7y+h8))
   */
  function homography(src, dst) {
    const A = [];
    const b = [];
    for (let i = 0; i < 4; i++) {
      const { x: X, y: Y } = src[i];
      const { x: U, y: V } = dst[i];
      const row1 = [X, Y, 1, 0, 0, 0, -U * X, -U * Y];
      const row2 = [0, 0, 0, X, Y, 1, -V * X, -V * Y];
      A.push(row1);
      b.push(U);
      A.push(row2);
      b.push(V);
    }
    const h = solveLinear(A, b, 8);
    if (!h) return null;
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  /** 把整张图按四边形做透视校正，输出边长 out 的方形画布数据 */
  function warpQuad(srcCanvas, quad, out) {
    const size = out || 900;
    const dst = [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ];
    // 方向不能反：循环里拿 H 去映射的是**输出坐标**，要的是 dst→quad。
    // 写成 homography(quad, dst) 会得到逆向缩放——源 594、quad 594、输出 720 时，
    // 棋盘在输出里只占 488（缩小了而不是放大）。
    // extractCells 里的 refineGrid 会重新找网格线，所以逐格路径一直没暴露；
    // 但任何按 9 等分切格的代码都会整体错位。
    const H = homography(dst, quad);
    if (!H) return null;

    const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = size;
    outCanvas.height = size;
    const octx = outCanvas.getContext('2d');
    const outData = octx.createImageData(size, size);
    const sw = srcCanvas.width;
    const sh = srcCanvas.height;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const w = H[6] * x + H[7] * y + H[8];
        const u = (H[0] * x + H[1] * y + H[2]) / w;
        const v = (H[3] * x + H[4] * y + H[5]) / w;
        const sx = Math.round(u);
        const sy = Math.round(v);
        const di = (y * size + x) * 4;
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) {
          outData.data[di] = 255;
          outData.data[di + 1] = 255;
          outData.data[di + 2] = 255;
          outData.data[di + 3] = 255;
          continue;
        }
        const si = (sy * sw + sx) * 4;
        outData.data[di] = src.data[si];
        outData.data[di + 1] = src.data[si + 1];
        outData.data[di + 2] = src.data[si + 2];
        outData.data[di + 3] = 255;
      }
    }
    octx.putImageData(outData, 0, 0);
    return outCanvas;
  }

  /* ---------------- 阈值与增强 ---------------- */

  /** Otsu 全局阈值，返回 0..255 的灰度数组 */
  function otsu(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let bestT = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        bestT = t;
      }
    }
    return bestT;
  }

  /** 把画布转成灰度数组 */
  function toGray(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0, p = 0; p < gray.length; p++, i += 4) {
      gray[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    }
    return gray;
  }

  SD.Sudoku.vision = { homography: homography, warpQuad: warpQuad, otsu: otsu, toGray: toGray, solveLinear: solveLinear };

  /* ---------------- Hough 网格定位 ---------------- */

  /**
   * 在图像里找数独网格的四个角。
  /** 3×3 均值模糊压噪 */
  function denoise(raw, W, H) {
    const out = new Uint8ClampedArray(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
            s += raw[yy * W + xx];
            n++;
          }
        }
        out[y * W + x] = s / n;
      }
    }
    return out;
  }

  /**
   * 在图像里找数独网格的四个角。
   *
   * 思路：对所有边缘点做一次最小二乘直线拟合（x 关于 y、y 关于 x 各一次），
   * 这一步同时给出网格的倾斜角；再对残差做直方图，取最外侧的两个显著峰，
   * 就是左右（上下的）边框线。相比 Hough，这种做法不需要把角度离散化，
   * 对噪声和轻微歪斜都稳健得多。
   */
  function detectQuad(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    return detectQuadFromGray(SD.Sudoku.vision.toGray(canvas), canvas.width, canvas.height);
  }

  /** 纯灰度数组版本，便于在 Node 里单测（无需 canvas） */
  /** Otsu 阈值 */
  /** 可分离盒式模糊，O(n) */
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    const n = 2 * r + 1;
    for (let y = 0; y < H; y++) {
      const base = y * W;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[base + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        tmp[base + x] = sum / n;
        sum -= src[base + Math.min(W - 1, Math.max(0, x - r))];
        sum += src[base + Math.min(W - 1, Math.max(0, x + r + 1))];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = sum / n;
        sum -= tmp[Math.min(H - 1, Math.max(0, y - r)) * W + x];
        sum += tmp[Math.min(H - 1, Math.max(0, y + r + 1)) * W + x];
      }
    }
    return out;
  }
  function otsuOf(hist, total) {
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0;
    let wB = 0;
    let best = 0;
    let thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        thr = t;
      }
    }
    return thr;
  }

  /** 8 连通标记，返回像素最多的那个连通域 */
  /**
   * 只保留面积不小于 minSize 的连通域，其余（噪点、灰尘、污渍）直接丢弃。
   * 这比先膨胀再取最大域更稳：膨胀会把噪点也一起撑大，反而混进来。
   */
  function keepLargeComponents(ink, W, H, minSize) {
    const label = new Int32Array(W * H).fill(-1);
    const stack = new Int32Array(W * H);
    const out = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!ink[i] || label[i] >= 0) continue;
      let sp = 0;
      stack[sp++] = i;
      label[i] = i;
      const group = [];
      while (sp > 0) {
        const p = stack[--sp];
        group.push(p);
        const x = p % W;
        const y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const q = yy * W + xx;
            if (!ink[q] || label[q] >= 0) continue;
            label[q] = i;
            stack[sp++] = q;
          }
        }
      }
      if (group.length < minSize) continue;
      for (const p of group) out[p] = 1;
    }
    return out;
  }
  function largestBlob(ink, W, H) {
    const label = new Int32Array(W * H).fill(-1);
    const stack = new Int32Array(W * H);
    let best = -1;
    let bestSize = 0;
    for (let i = 0; i < W * H; i++) {
      if (!ink[i] || label[i] >= 0) continue;
      let sp = 0;
      stack[sp++] = i;
      label[i] = i;
      const members = [];
      while (sp > 0) {
        const p = stack[--sp];
        members.push(p);
        const x = p % W;
        const y = (p / W) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const q = yy * W + xx;
            if (!ink[q] || label[q] >= 0) continue;
            label[q] = i;
            stack[sp++] = q;
          }
        }
      }
      if (members.length > bestSize) {
        bestSize = members.length;
        best = members;
      }
    }
    return best;
  }

  /** Andrew 单调链求凸包 */
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function segDist(p, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (!len2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  }

  /** 四边形外凸出的代价：所有在四边形外的凸包点到边界的最小距离之和 */
  function quadCost(hull, q) {
    let cost = 0;
    for (const p of hull) {
      let inside = true;
      for (let i = 0; i < 4; i++) {
        const a = q[i];
        const b = q[(i + 1) % 4];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) { inside = false; break; }
      }
      if (inside) continue;
      let d = Infinity;
      for (let i = 0; i < 4; i++) d = Math.min(d, segDist(p, q[i], q[(i + 1) % 4]));
      cost += d;
    }
    return cost;
  }

  /**
   * 从凸包里挑出最贴合的四个点。
   * 穷举比递归简化稳：污渍噪点会在凸包上多出几个点，
   * 递归 Douglas-Peucker 会把它们当成真正的角保留下来（数量不等于 4 就直接失败），
   * 而穷举会自然地为了总代价最小而放弃它们。
   */
  function bestQuad(hull) {
    const n = hull.length;
    if (n <= 4) return hull.slice();
    // 凸包点太多时先均匀抽稀，把穷举规模控制在可接受范围
    const CAP = 24;
    let pts = hull;
    if (n > CAP) {
      const stride = n / CAP;
      pts = [];
      for (let k = 0; k < CAP; k++) pts.push(hull[Math.min(n - 1, Math.floor(k * stride))]);
    }
    const m = pts.length;
    let best = null;
    let bestCost = Infinity;
    for (let a = 0; a < m - 3; a++) {
      for (let b = a + 1; b < m - 2; b++) {
        for (let c = b + 1; c < m - 1; c++) {
          for (let d = c + 1; d < m; d++) {
            const q = [pts[a], pts[b], pts[c], pts[d]];
            const cost = quadCost(pts, q);
            if (cost < bestCost) { bestCost = cost; best = q; }
          }
        }
      }
    }
    return best;
  }
  /**
   * 在图像里找数独网格的四个角。
   *
   * 数独网格在照片里通常是透视的，左右两条边并不平行，
   * 所以「拟合一组平行线再取残差峰值」的做法不成立。
   * 这里改用与透视无关的思路：二值化后取最大的连通域（网格线彼此相交，
   * 一定连成一片，而噪点是孤立的小块），求凸包再简化成四边形，得到四角。
   */
  function detectQuadFromGray(input, W, H) {
    if (!W || !H) return null;
    const gray = denoise(input, W, H);
    // 用「局部对比度」二值化：先减去大半径均值得到局部背景，
  // 再看每个像素比周围暗多少。
  // 这样 JPEG 块级亮度偏移会被整体减掉（它对像素和背景的影响一样），
  // 而网格线比它周围暗得多；小噪点被模糊抹平，天然被排除。
    const bg = boxBlur(gray, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.014)));
    const raw = new Uint8Array(W * H);
    for (let i = 0; i < gray.length; i++) raw[i] = gray[i] - bg[i] < -24 ? 1 : 0;

    // 两轮 3×3 膨胀：照片上一点污渍或反光就会在网格线上打断几个像素，
    // 不接上的话整张网格会被切成互不相连的碎片，取到的连通域只剩一角。
    let ink = raw;
    for (let pass = 0; pass < 3; pass++) {
      const out = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let on = 0;
          for (let dy = -1; dy <= 1 && !on; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= H) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= W) continue;
              if (ink[yy * W + xx]) { on = 1; break; }
            }
          }
          out[y * W + x] = on;
        }
      }
      ink = out;
    }

    const blob = largestBlob(ink, W, H);
    if (!blob || blob.length < 400) return null;
    // 面积下限：网格线加上 3 轮膨胀后通常只占画面百分之几，
    // 这里只用来挡掉「一小块污渍恰好连成一片」的情况
    if (blob.length < W * H * 0.012) return null;

    const pts = [];
    for (const p of blob) pts.push([p % W, (p / W) | 0]);
    const hull = convexHull(pts);
    if (hull.length < 4) return null;
    const quad = bestQuad(hull);
    if (!quad) return null;

    // 按角度排序成 tl → tr → br → bl
    const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
    const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
    quad.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    const order = [0, 1, 2, 3].sort((i, j) => quad[i][0] + quad[i][1] - (quad[j][0] + quad[j][1]))[0];
    const rot = quad.slice(order).concat(quad.slice(0, order));
    const area = Math.abs(
      (rot[1][0] - rot[0][0]) * (rot[3][1] - rot[0][1]) - (rot[3][0] - rot[0][0]) * (rot[1][1] - rot[0][1])
    ) / 2;
    if (area < W * H * 0.04) return null;   // 四边形太小，说明挑错了连通域
    return { tl: { x: rot[0][0], y: rot[0][1] }, tr: { x: rot[1][0], y: rot[1][1] }, br: { x: rot[2][0], y: rot[2][1] }, bl: { x: rot[3][0], y: rot[3][1] } };
  }
  /**
   * 在校正图里重新量出网格的真实边界。
   * 手动拖四个角不可能像素级贴合，照片里也会有透视残留；
   * 而四条外框线是图中最长的暗线，直接量出来比假设四边形精确更可靠。
   */
  function refineGrid(canvas) {
    const gray = SD.Sudoku.vision.toGray(canvas);
    const W = canvas.width;
    const H = canvas.height;
    // 同样用局部对比度找线：纸纹和 JPEG 噪点在全局阈值下会糊成一片，
    // 而宫线比格子线粗得多，用全局阈值定线会把外框线整条漏掉。
    const bg = boxBlur(gray, W, H, Math.max(4, Math.round(Math.min(W, H) * 0.014)));
    const colSum = new Float64Array(W);
    const rowSum = new Float64Array(H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // -28 这个门槛是留给真网格线的：JPEG 块边沿的整行伪影对比度只有 ±20 左右，
        // 用 -18 会把它们当成一条横贯全图的线，网格边界就会整体偏移一行/一列。
        if (gray[y * W + x] - bg[y * W + x] < -28) {
          colSum[x]++;
          rowSum[y]++;
        }
      }
    }
    const edges = (sum, n) => {
      let max = 0;
      for (let i = 0; i < n; i++) if (sum[i] > max) max = sum[i];
      const cut = Math.max(2, max * 0.08);
      let first = -1;
      let last = -1;
      for (let i = 0; i < n; i++) {
        if (sum[i] < cut) continue;
        if (first < 0) first = i;
        last = i;
      }
      return first < 0 ? null : [first, last];
    };
    const ex = edges(colSum, W);
    const ey = edges(rowSum, H);
    if (!ex || !ey) return null;
    const cw = (ex[1] - ex[0]) / 9;
    const ch = (ey[1] - ey[0]) / 9;
    if (cw < 8 || ch < 8) return null;
    return { x0: ex[0], x1: ex[1], y0: ey[0], y1: ey[1], cellW: cw, cellH: ch };
  }

  /** 按四边形切出 81 个格子；二值阈值用整图 Otsu，格子边界由 refineGrid 量出 */
  function extractCells(canvas, quad, cellPx) {
    const size = cellPx || 80;
    const warped = SD.Sudoku.vision.warpQuad(canvas, [quad.tl, quad.tr, quad.br, quad.bl], size * 9);
    if (!warped) return null;
    const grid = refineGrid(warped);
    if (!grid) return null;
    const gray = SD.Sudoku.vision.toGray(warped);

    const cells = [];
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const x0 = Math.round(grid.x0 + c * grid.cellW + grid.cellW * 0.16);
      const y0 = Math.round(grid.y0 + r * grid.cellH + grid.cellH * 0.16);
      const x1 = Math.round(grid.x0 + (c + 1) * grid.cellW - grid.cellW * 0.16);
      const y1 = Math.round(grid.y0 + (r + 1) * grid.cellH - grid.cellH * 0.16);
      // 每格单独定阈值。校正后的图九成是留白，全图 Otsu 会把阈值压得很低，
      // 连抗锯齿的网格线都算成墨水，导致空格子被误判为有字。
      // 用格子自己的最暗/最亮来定，空白格自然没有墨。
      let lo = 255;
      let hi = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = gray[y * warped.width + x];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      const range = hi - lo;
      const cellThr = range < 40 ? 0 : lo + range * 0.4;
      let ink = 0;
      if (range >= 40) {
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            if (gray[y * warped.width + x] < cellThr) ink++;
          }
        }
      }
      const area = (x1 - x0) * (y1 - y0);
      cells.push({ index: i, ink: area ? ink / area : 0, thr: cellThr, x0: x0, y0: y0, x1: x1, y1: y1 });
    }
    return { warped: warped, cells: cells, grid: grid };
  }

  SD.Sudoku.vision.detectQuad = detectQuad;
  SD.Sudoku.vision.detectQuadFromGray = detectQuadFromGray;   // 供 Node 单测直接喂灰度数组
  SD.Sudoku.vision.extractCells = extractCells;
})(window);
