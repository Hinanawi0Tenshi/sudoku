/* 杀手数独 · 注册
 *
 * 现在只注册一条记录，标题界面上显示「开发中」。
 *
 * 实装时要新写的只有「笼子」这一层：笼子怎么划分、带笼子约束的唯一解校验、
 * 笼子框在盘面上的画法、提示时怎么算笼和。棋盘渲染、输入、笔记、撤销、存档
 * 都是 9×9 那一套，直接从 js/core 复用，不用重写。
 */
(function (global) {
  'use strict';
  const SD = global.SD;
  SD.Registry.register({
    id: 'killer',
    name: '杀手数独',
    tagline: '不给数字，只给每块笼子里的和',
    icon: '∑',
    accent: '#a855f7',
    ready: false,
  });
})(window);
