/* 数独 · 设置面板 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const { el, clear, toast } = SD.UI;

  const TOGGLES = [
    { key: 'autoNotes', label: '落子后自动更新候选', hint: '每填一个数字，自动把同行 / 列 / 宫的铅笔标记同步一次（工具栏的「一键笔记」则是手动铺一遍全部）' },
    { key: 'highlight', label: '高亮联动', hint: '选中格子时高亮同行、同列、同宫' },
    { key: 'highlightSame', label: '同数字高亮', hint: '选中后高亮盘上所有相同数字' },
    { key: 'highlightPeer', label: '同行列宫高亮', hint: '选中后高亮所在的三条线' },
    { key: 'mistakeCheck', label: '即时纠错', hint: '填入的数字与已填冲突时立刻撤回' },
    { key: 'confirmSolve', label: '求解前确认', hint: '自动求解前弹窗二次确认' },
  ];

  /* 主题清单：设置面板的色板和顶栏的循环按钮共用这一份，避免两处顺序对不上 */
  const THEMES = [
    { id: 'auto', name: '跟随系统', swatch: ['#f4f5f7', '#2f6fed', '#1b2027'] },
    { id: 'light', name: '纸白', swatch: ['#ffffff', '#2f6fed', '#1b2027'] },
    { id: 'mint', name: '薄荷', swatch: ['#ffffff', '#14876a', '#12241c'] },
    { id: 'dusk', name: '黄昏', swatch: ['#fffdfa', '#c2601f', '#2b2018'] },
    { id: 'dark', name: '夜航', swatch: ['#1e232b', '#5b8cff', '#e8ecf2'] },
    { id: 'ink', name: '墨黑', swatch: ['#0d0d0d', '#ffd400', '#ffffff'] },
    { id: 'forest', name: '深林', swatch: ['#18231e', '#6ee7a8', '#e2ece6'] },
  ];

  const HINT_LEVELS = [
    { value: 1, label: '仅基础（唯一余数 / 隐性唯一）' },
    { value: 2, label: '≤ 排除（加区块摒除、数对）' },
    { value: 3, label: '≤ 进阶（加三数组、X-Wing）' },
    { value: 4, label: '≤ 高级（加三链列、唯一矩形）' },
    { value: 5, label: '全部（含试错链）' },
  ];

  function themeById(id) {
    for (const t of THEMES) if (t.id === id) return t;
    return THEMES[0];
  }

  function renderSettings(root, ctx) {
    clear(root);
    const s = SD.Store.settings();

    /* 外观 */
    const themeCard = el('div.card', null, el('h3', { text: '外观' }));
    const grid = el('div.theme-grid');
    for (const t of THEMES) {
      const on = (s.theme || 'light') === t.id;
      const btn = el('button.theme-swatch' + (on ? '.is-on' : ''), {
        title: t.name,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          ctx.applyTheme(t.id);
          renderSettings(root, ctx);
        },
      }, [
        el('span.sw-row', null, t.swatch.map((c) => el('i', { style: { background: c } }))),
        el('span.sw-name', { text: t.name }),
      ]);
      grid.appendChild(btn);
    }
    themeCard.appendChild(grid);
    root.appendChild(themeCard);

    /* 行为 */
    const behavior = el('div.card', null, el('h3', { text: '行为' }));
    for (const t of TOGGLES) {
      behavior.appendChild(
        el('label.switch.setting', null, [
          el('input', {
            type: 'checkbox',
            checked: !!s[t.key],
            onchange: (e) => {
              SD.Store.set(t.key, e.target.checked);
              ctx.rerender();
            },
          }),
          el('span', null, [el('b', { text: t.label }), el('small', { text: t.hint })]),
        ])
      );
    }
    root.appendChild(behavior);

    /* 提示 */
    const hintCard = el('div.card', null, el('h3', { text: '提示' }));
    hintCard.appendChild(
      el('div.field', null, [
        el('span', { text: '默认等级上限' }),
        el('select', {
          onchange: (e) => {
            SD.Store.set('defaultHintLevel', Number(e.target.value));
          },
        }, HINT_LEVELS.map((h) => el('option', {
          value: String(h.value),
          text: h.label,
          selected: Number(s.defaultHintLevel) === h.value,
        }))),
      ])
    );
    hintCard.appendChild(el('p', { text: '锁得越低，提示越朴素——适合练基础；调到最高则会动用链式推理。' }));
    root.appendChild(hintCard);

    /* 维护 */
    const danger = el('div.card', null, el('h3', { text: '维护' }));
    danger.appendChild(
      el('div.btn-row', null, [
        el('button.btn', {
          text: '恢复默认设置',
          onclick: () => {
            SD.Store.resetSettings();
            ctx.applyTheme(SD.Store.settings().theme);
            ctx.fillHintLevels(SD.Store.settings().defaultHintLevel);
            renderSettings(root, ctx);
            toast('设置已恢复默认');
          },
        }),
      ])
    );
    danger.appendChild(el('p', { text: '只重置偏好，不动统计和当前这局。' }));
    danger.appendChild(
      el('div.btn-row', null, [
        el('button.btn.btn-warn', {
          text: '清除本机全部数据',
          onclick: () => {
            // 二次确认：这一下会把统计、每日挑战连胜、图鉴进度全清掉，不可撤销
            if (!confirm('会清掉统计、每日挑战连胜、我的题库和卡牌进度，且无法恢复。确定吗？')) return;
            if (!confirm('真的确定？建议先去「数据」页导出备份。')) return;
            SD.Store.resetAll();
            location.reload();
          },
        }),
      ])
    );
    danger.appendChild(
      el('p', { text: '换过出题算法后若发现题目还是老的，用这个清一次即可。也可以直接用浏览器清除本站点数据。' })
    );
    root.appendChild(danger);
  }

  SD.Settings = { renderSettings: renderSettings, THEMES: THEMES, HINT_LEVELS: HINT_LEVELS, themeById: themeById };
})(window);
