/* 扫雷 · 注册
 *
 * 现在只注册一条记录，标题界面上显示「开发中」。
 *
 * 这一款和数独族没有共用逻辑：盘面、雷数、翻开规则、无猜生成全要新写。
 * 能复用的只有平台层那几样——主题、弹窗、存储、点数。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  SD.Registry.register({
    id: 'mines',
    name: '扫雷',
    tagline: '经典三档，也能自己定宽高和雷数',
    icon: '💣',
    accent: '#d97706',
    ready: false,
  });
})(window);
