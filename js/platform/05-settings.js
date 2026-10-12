/* 益智游戏合集 · 设置页
 *
 * 分三段：外观（全局）、各游戏自己的设置、维护。
 *
 * 主题放在全局而不是每款游戏各记一份——它是显示偏好，不是游戏进度；
 * 换一款游戏就得重新挑一次外观，那不叫「各存各的」，那叫难用。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const { el, clear, toast } = SD.UI;

  /* 主题清单：设置面板的色板和别处共用这一份，避免两处顺序对不上 */
  const THEMES = [
    { id: 'auto', name: '跟随系统', swatch: ['#f4f5f7', '#2f6fed', '#1b2027'] },
    { id: 'light', name: '纸白', swatch: ['#ffffff', '#2f6fed', '#1b2027'] },
    { id: 'mint', name: '薄荷', swatch: ['#ffffff', '#14876a', '#12241c'] },
    { id: 'dusk', name: '黄昏', swatch: ['#fffdfa', '#c2601f', '#2b2018'] },
    { id: 'dark', name: '夜航', swatch: ['#1e232b', '#5b8cff', '#e8ecf2'] },
    { id: 'ink', name: '墨黑', swatch: ['#0d0d0d', '#ffd400', '#ffffff'] },
    { id: 'forest', name: '深林', swatch: ['#18231e', '#6ee7a8', '#e2ece6'] },
  ];

  function themeById(id) {
    for (const t of THEMES) if (t.id === id) return t;
    return THEMES[0];
  }

  function renderSettings(root) {
    clear(root);

    /* 外观 */
    const themeCard = el('div.card', null, el('h3', { text: '外观' }));
    const grid = el('div.theme-grid');
    for (const t of THEMES) {
      const on = SD.Shell.theme() === t.id;
      grid.appendChild(el('button.theme-swatch' + (on ? '.is-on' : ''), {
        title: t.name,
        'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          SD.Shell.applyTheme(t.id);
          renderSettings(root);
        },
      }, [
        el('span.sw-row', null, t.swatch.map((c) => el('i', { style: { background: c } }))),
        el('span.sw-name', { text: t.name }),
      ]));
    }
    themeCard.appendChild(grid);
    themeCard.appendChild(el('p', { text: '主题对整个合集生效，三款游戏共用。' }));
    root.appendChild(themeCard);

    /* 各游戏自己的设置。没实装的游戏不显示，免得点开一片空。 */
    const games = SD.Registry.ready().filter((d) => d.settings);
    if (games.length) {
      root.appendChild(el('h3.sec-title', { text: '游戏设置' }));
      for (const def of games) {
        const card = el('div.card', null, el('h3', { text: def.name }));
        root.appendChild(card);
        def.settings(card, { rerender: () => renderSettings(root) });
      }
    }

    /* 维护 */
    const danger = el('div.card', null, el('h3', { text: '维护' }));
    danger.appendChild(
      el('div.btn-row', null, [
        el('button.btn', {
          text: '恢复默认设置',
          onclick: () => {
            SD.Shell.applyTheme('light');
            for (const def of SD.Registry.ready()) if (def.resetSettings) def.resetSettings();
            renderSettings(root);
            toast('设置已恢复默认');
          },
        }),
      ])
    );
    danger.appendChild(el('p', { text: '只重置偏好，不动战绩和当前对局。' }));
    danger.appendChild(
      el('div.btn-row', null, [
        el('button.btn.btn-warn', {
          text: '清除本机全部数据',
          onclick: () => {
            // 二次确认：这一下会把三款游戏的战绩、存档、题库、点数和图鉴全清掉，不可撤销
            if (!confirm('会清掉三款游戏的全部战绩、存档、题库、点数和图鉴，且无法恢复。确定吗？')) return;
            if (!confirm('真的确定？建议先去「我的」页导出备份。')) return;
            SD.Storage.wipe();
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

  SD.Settings = { renderSettings: renderSettings, THEMES: THEMES, themeById: themeById };
})(window);
