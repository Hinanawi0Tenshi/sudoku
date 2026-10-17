/* 益智游戏合集 · 视图壳
 *
 * 壳只做四件事：记住现在在哪个视图、现在进的是哪款游戏、切主题、画标题界面。
 * 某款游戏首页长什么样、对局页有哪些控件，壳一概不知道——
 * 它只调用游戏注册时交出来的 mount()，把渲染权整个让出去。
 * 加一款新游戏时，这个文件不需要改任何一行。
 *
 * 视图一共四个：
 *   title  选游戏
 *   home   当前游戏的首页（入口由游戏自己渲染）
 *   game   当前游戏的对局页
 *   page   通用整页（设置 / 关于 / 题库 / 每日挑战…），带返回
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const U = SD.UI;
  const { $, el, clear, toast } = U;

  const VIEWS = ['title', 'home', 'game', 'page'];

  let view = 'title';
  let current = null;
  // 返回栈。整页可能是从标题页点开的（设置），也可能是从游戏首页点开的（题库），
  // 记下来源，返回键才知道该退到哪一层，而不是一律弹回标题页。
  const stack = [];

  /* ---------------- 主题 ----------------
   * 主题是全局的，不跟着游戏走。所有游戏各记一份主题的话，
   * 玩家换一款游戏就得重新选一次外观，那不叫「各存各的」，那叫难用。
   */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const g = SD.Storage.global();
    g.data().theme = theme;
    g.save();
  }
  const theme = () => SD.Storage.global().data().theme || 'light';

  /* ---------------- 视图切换 ---------------- */
  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'title';
    for (const v of VIEWS) {
      const node = $('#view-' + v);
      if (node) node.classList.toggle('is-active', v === name);
    }
    view = name;
    document.documentElement.setAttribute('data-view', name);
    if (name === 'title') renderTitle();
    // 回到对局页时让游戏自己重画一次：在设置里改过高亮开关，盘面得跟着变
    if (name === 'game' && current && current.onShow) current.onShow();
    // 遮罩是出题期间的临时状态，切视图时必须收干净，否则会留在屏幕上点不掉
    hideOverlay();
    window.scrollTo(0, 0);
  }

  const viewName = () => view;

  /* ---------------- 进入 / 离开游戏 ---------------- */
  function enter(id) {
    const def = SD.Registry.byId(id);
    if (!def) return;
    if (!def.ready) {
      toast(def.name + '还在做，先玩别的吧');
      return;
    }
    if (current && current !== def && current.unmount) current.unmount();
    current = def;
    stack.length = 0;
    document.documentElement.setAttribute('data-game', def.id);
    const home = clear($('#game-home'));
    const play = clear($('#game-play'));
    // 先让游戏把自己的骨架建出来，再往里面填品牌名——
    // 反过来的话那两个节点还不存在，写进去就是往 null 上写
    def.mount({ home: home, play: play });
    setBrand(def);
    showView('home');
  }

  function setBrand(def) {
    const logo = $('#brand-logo');
    const name = $('#brand-name');
    const sub = $('#brand-sub');
    if (logo) logo.textContent = def.icon || '?';
    if (name) name.textContent = def.name;
    if (sub) sub.textContent = def.brandSub || '';
  }

  function leave() {
    if (current && current.unmount) current.unmount();
    current = null;
    stack.length = 0;
    document.documentElement.removeAttribute('data-game');
    clear($('#game-home'));
    clear($('#game-play'));
    showView('title');
  }

  const game = () => current;

  /* ---------------- 通用整页 ---------------- */
  function openPage(title, render) {
    // 整页里再开一页（例如每日挑战翻月份）算同层替换，不该往返回栈里越堆越深
    if (view !== 'page') stack.push(view);
    $('#page-title').textContent = title;
    const root = clear($('#page-root'));
    render(root);
    showView('page');
  }

  function goBack() {
    const to = stack.pop() || 'title';
    // 从整页退回去时可能已经不在游戏里了，退回空首页不如直接回标题
    showView(to === 'home' && !current ? 'title' : to);
  }

  /* ---------------- 对局页顶栏 ----------------
   * 顶栏里「换游戏」和「回首页」这两个按钮由壳负责，所以走 data-shell 委托，
   * 不在启动时逐个 addEventListener——那时游戏还没把骨架建出来，绑不到。
   * 游戏只管往里塞自己的状态格和按钮。
   */
  function topbar(parts) {
    const o = parts || {};
    const actions = [el('button.btn', { id: 'btn-home-back', dataset: { shell: 'home' }, title: '回到本游戏首页 (Esc)', text: '‹ 首页' })];
    for (const a of o.actions || []) actions.push(a);
    return el('header.topbar', null, [
      // id 保留下来是给自动化测试用的：data-shell 负责行为，id 负责定位
      el('button.brand', { id: 'btn-home', dataset: { shell: 'leave' }, title: '换一款游戏' }, [
        el('span.logo', { id: 'brand-logo', text: '?' }),
        el('span.brand-text', null, [
          el('span', { id: 'brand-name' }),
          el('small', { id: 'brand-sub' }),
        ]),
      ]),
      o.status || null,
      el('div.topbar-actions', null, actions),
    ]);
  }

  /* ---------------- 遮罩 ----------------
   * 只有一个遮罩，挂在 body 上、铺满整屏。
   * 原先每个视图各有一个遮罩，出题途中切视图就会收错节点、灰幕留在屏幕上点不掉；
   * 换成全局唯一之后这类问题从根上不存在。
   */
  function overlay(title, sub) {
    const ov = $('#shell-overlay');
    if (!ov) return;
    clear(ov);
    ov.hidden = false;
    ov.appendChild(el('div.ov-card', null, [
      el('div.ov-title', { text: title }),
      el('div.ov-sub', { text: sub || '' }),
      el('div.progress', null, el('i')),
    ]));
  }

  function overlayProgress(p) {
    const bar = $('#shell-overlay .progress i');
    if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%';
  }

  function hideOverlay() {
    const ov = $('#shell-overlay');
    if (!ov) return;
    ov.hidden = true;
    clear(ov);
  }

  /* ---------------- 标题界面 ---------------- */
  function renderTitle() {
    const grid = clear($('#game-grid'));
    for (const def of SD.Registry.all()) grid.appendChild(gameCard(def));
    const total = SD.Points.total();
    $('#title-points').textContent = total ? '通关点数 ' + total : '';
    // 副标题从注册表生成。原先写死在 index.html 里，加到第七款游戏时它还写着三款。
    const sub = $('#title-sub');
    if (sub) sub.textContent = SD.Registry.ready().map((d) => d.name).join(' · ');
  }

  function gameCard(def) {
    const soon = !def.ready;
    const status = !soon && def.statusLine ? def.statusLine() : null;
    return el('button.game-card' + (soon ? '.is-soon' : ''), {
      style: { '--gc': def.accent || 'var(--accent)' },
      onclick: soon ? null : () => enter(def.id),
      'aria-disabled': soon ? 'true' : null,
    }, [
      el('span.gc-icon', { text: def.icon || '?' }),
      el('span.gc-main', null, [
        el('b.gc-name', { text: def.name }),
        el('span.gc-tag', { text: def.tagline || '' }),
      ]),
      soon ? el('span.gc-badge', { text: '开发中' })
           : (status ? el('span.gc-badge.is-info', { text: status }) : el('span.gc-arrow', { text: '›' })),
    ]);
  }

  /* ---------------- 全局按键与委托 ---------------- */
  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    // 弹窗开着时 Esc 归弹窗管，否则关掉弹窗的同时还会把视图切走
    if (document.querySelector('#dialog-root .modal')) return;
    if (view === 'page') { e.preventDefault(); goBack(); }
    else if (view === 'game') { e.preventDefault(); showView('home'); }
    else if (view === 'home') { e.preventDefault(); leave(); }
  }

  function onClick(e) {
    const node = e.target && e.target.closest ? e.target.closest('[data-shell]') : null;
    if (!node) return;
    const act = node.dataset.shell;
    if (act === 'leave') leave();
    else if (act === 'home') showView('home');
    else if (act === 'back') goBack();
  }

  function bindChrome() {
    $('#title-settings').addEventListener('click', () => openPage('设置', (r) => SD.Settings.renderSettings(r)));
    $('#title-about').addEventListener('click', () => openPage('关于', (r) => SD.About.renderAbout(r)));
    $('#page-back').addEventListener('click', goBack);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKeyDown);
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    SD.Storage.runMigrations();
    applyTheme(theme());
    bindChrome();
    showView('title');
    window.addEventListener('beforeunload', () => SD.Storage.flushAll());
  }

  SD.Shell = {
    enter: enter,
    leave: leave,
    game: game,
    showView: showView,
    viewName: viewName,
    openPage: openPage,
    goBack: goBack,
    applyTheme: applyTheme,
    theme: theme,
    renderTitle: renderTitle,
    topbar: topbar,
    overlay: overlay,
    overlayProgress: overlayProgress,
    hideOverlay: hideOverlay,
  };

  // 等所有游戏脚本都注册完再启动。defer/动态插入的极端情况下
  // DOMContentLoaded 可能已经过了，退一格用 setTimeout 兜住。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 0);
})(window);
