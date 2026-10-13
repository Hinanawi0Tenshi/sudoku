/* 2048 · 渲染
 *
 * 动画分两拍，这是 2048 手感的关键：
 *   第一拍：把源格子的牌平移到目标位置（CSS transition 负责"滑过去"）
 *   第二拍：过渡结束后按新盘面重建，给合并出来的牌和新落的牌弹一下
 *
 * 之所以第二拍敢整块重建：第一拍结束时那些牌**已经在目标位置**了，
 * 重建出来的节点落在同一个地方，看不出跳变。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const G = (SD.G2048 = SD.G2048 || {});
  const U = SD.UI;
  const { el, clear } = U;

  const MAX_BOARD = 460;
  const SLIDE_MS = 110;

  function create(root) {
    const box = el('div.g-board');
    root.appendChild(box);
    let n = 0;
    let cell = 80;
    let gap = 10;
    let els = [];          // els[下标] = 牌节点
    let pending = null;    // 第二拍还没落地时的定时器

    function fit() {
      // 不量父元素：盘面的宽高就是父元素撑开的，量到的是循环依赖。
      // 直接按视口算，三档尺寸稳定可预期。
      const avail = Math.min(MAX_BOARD, Math.max(240, window.innerWidth - 48));
      gap = Math.max(6, Math.round(avail * 0.022));
      cell = Math.floor((avail - gap * (n + 1)) / n);
      box.style.width = (cell * n + gap * (n + 1)) + 'px';
      box.style.height = (cell * n + gap * (n + 1)) + 'px';
      box.style.setProperty('--cell', cell + 'px');
      box.style.setProperty('--gap', gap + 'px');
    }

    const posOf = (i) => 'translate(' + (gap + (i % n) * (cell + gap)) + 'px,'
      + (gap + ((i / n) | 0) * (cell + gap)) + 'px)';

    function makeTile(v, i) {
      // 缩放动画必须挂在里面那层：外层 transform 被平移到目标位置的 translate 占着，
      // 直接在它身上做 scale 的 keyframes 会把位移覆盖掉，牌会飞回左上角
      const t = el('div.g-tile', { dataset: { v: String(v) } }, [
        el('div.g-face', null, [el('span.g-num', { text: String(v) })]),
      ]);
      t.style.width = cell + 'px';
      t.style.height = cell + 'px';
      t.style.transform = posOf(i);
      return t;
    }

    /** 背景格：空位的底色，纯装饰，不参与动画 */
    function paintGrid() {
      const old = box.querySelectorAll('.g-cell');
      for (const o of old) o.remove();
      for (let i = 0; i < n * n; i++) {
        const c = el('div.g-cell');
        c.style.width = cell + 'px';
        c.style.height = cell + 'px';
        c.style.transform = posOf(i);
        box.appendChild(c);
      }
    }

    /** 按当前盘面整块重建 */
    function render(b) {
      if (n !== b.size) { n = b.size; fit(); }
      clear(box);
      paintGrid();
      els = new Array(n * n).fill(null);
      for (let i = 0; i < b.cells.length; i++) {
        if (!b.cells[i]) continue;
        const t = makeTile(b.cells[i], i);
        els[i] = t;
        box.appendChild(t);
      }
    }

    function pop(i) {
      const t = els[i];
      if (!t) return;
      t.classList.add('is-pop');
      setTimeout(() => t.classList.remove('is-pop'), 200);
    }

    /**
     * 走一步并播动画。
     * @param {object} b      已经更新过的盘面
     * @param {object} delta  core.move() 的返回值
     * @param {number} spawn  新牌落下的下标，-1 表示没落
     */
    function animate(b, delta, spawn) {
      // 上一拍的收尾还没跑，就先把它落定，否则新动画会叠在旧节点上
      if (pending) { clearTimeout(pending); pending = null; }

      for (const s of delta.slides) {
        const t = els[s.from];
        if (!t) continue;
        t.style.transform = posOf(s.to);
        t.style.zIndex = '2';
      }

      pending = setTimeout(() => {
        pending = null;
        render(b);
        for (const m of delta.merges) pop(m.to);
        if (spawn >= 0) pop(spawn);
      }, SLIDE_MS);
    }

    /** 不等动画，立刻落到最终状态（存档恢复、窗口尺寸变化时用） */
    function settle(b) {
      if (pending) { clearTimeout(pending); pending = null; }
      render(b);
    }

    return {
      render: render,
      animate: animate,
      settle: settle,
      root: box,
      resize: (b) => { if (b) { fit(); render(b); } },
      cellSize: () => cell,
    };
  }

  G.view = { create: create };
})(window);
