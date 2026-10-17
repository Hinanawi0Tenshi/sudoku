/* 数独 · 设置项
 *
 * 只负责数独自己的偏好，渲染进平台设置页给的那张卡片里。
 * 主题和维护不在这里——那两样是所有游戏共用的，归平台层。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  SD.Sudoku = SD.Sudoku || {};   // 被单测单独加载时也要能自建命名空间
  const { el } = SD.UI;
  const Store = SD.Sudoku.store;

  const TOGGLES = [
    { key: 'autoNotes', label: '落子后自动更新候选', hint: '每填一个数字，自动把同行 / 列 / 宫的铅笔标记同步一次（工具栏的「一键笔记」则是手动铺一遍全部）' },
    { key: 'highlight', label: '高亮联动', hint: '选中格子时高亮同行、同列、同宫' },
    { key: 'highlightSame', label: '同数字高亮', hint: '选中后高亮盘上所有相同数字' },
    { key: 'highlightPeer', label: '同行列宫高亮', hint: '选中后高亮所在的三条线' },
    { key: 'mistakeCheck', label: '即时纠错', hint: '填入的数字与已填冲突时立刻标红' },
    { key: 'confirmSolve', label: '求解前确认', hint: '自动求解前弹窗二次确认' },
  ];

  const HINT_LEVELS = [
    { value: 1, label: '仅基础（唯一余数 / 隐性唯一）' },
    { value: 2, label: '≤ 排除（加区块摒除、数对）' },
    { value: 3, label: '≤ 进阶（加三数组、X-Wing）' },
    { value: 4, label: '≤ 高级（加三链列、唯一矩形）' },
    { value: 5, label: '全部（含试错链）' },
  ];

  function render(root, ctx) {
    const s = Store.settings();

    root.appendChild(el('h4.sub-title', { text: '行为' }));
    for (const t of TOGGLES) {
      root.appendChild(
        el('label.switch.setting', null, [
          el('input', {
            type: 'checkbox',
            checked: !!s[t.key],
            onchange: (e) => {
              Store.set(t.key, e.target.checked);
              ctx.rerender();
            },
          }),
          el('span', null, [el('b', { text: t.label }), el('small', { text: t.hint })]),
        ])
      );
    }

    root.appendChild(el('h4.sub-title', { text: '提示' }));
    root.appendChild(
      el('div.field', null, [
        el('span', { text: '默认等级上限' }),
        el('select', {
          onchange: (e) => Store.set('defaultHintLevel', Number(e.target.value)),
        }, HINT_LEVELS.map((h) => el('option', {
          value: String(h.value),
          text: h.label,
          selected: Number(s.defaultHintLevel) === h.value,
        }))),
      ])
    );
    root.appendChild(el('p', { text: '锁得越低，提示越朴素——适合练基础；调到最高则会动用链式推理。' }));
  }

  SD.Sudoku.settings = { render: render, HINT_LEVELS: HINT_LEVELS, TOGGLES: TOGGLES };
})(window);
