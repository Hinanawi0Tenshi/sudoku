/* 益智游戏合集 · 游戏注册表
 *
 * 平台只认这一张表：标题界面列哪几款、能不能点进去、进去之后谁负责渲染，
 * 全部从注册信息里读。加一款新游戏时，平台层一行都不用改。
 *
 * ready 为 false 的条目照样注册：卡片会置灰显示「开发中」，
 * 这样玩家一眼看得到这个合集要往哪长，也不用等实装完才改标题界面。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});

  const list = [];
  const index = {};

  /**
   * @param {object} def
   *   id            唯一标识，同时用作存储命名空间的名字
   *   name          标题界面上的名字
   *   tagline       一句话说明
   *   icon          卡片上的字符
   *   accent        卡片主色，标题界面拿它做渐变
   *   brandSub      游戏页左上角品牌下方的英文小字，可省
   *   ready         是否已实装
   *   mount(nodes)  渲染该游戏自己的首页与对局页骨架
   *   unmount()     离开该游戏时收尾（停计时器、flush 存档）
   *   statusLine()  标题卡上的状态行，返回字符串或 null
   *   settings(root, ctx)      可选，设置页里该游戏自己的分区
   *   resetSettings()          可选，恢复默认设置时调用
   *   about         [{h, p}]   可选，关于页里该游戏的段落
   *   points(meta)             可选，一局通关给多少点数
   */
  function register(def) {
    if (!def || !def.id) throw new Error('游戏注册缺少 id');
    if (index[def.id]) throw new Error('游戏 id 重复：' + def.id);
    index[def.id] = def;
    list.push(def);
    return def;
  }

  const all = () => list.slice();
  const byId = (id) => index[id] || null;
  const ready = () => list.filter((d) => d.ready);

  SD.Registry = { register: register, all: all, byId: byId, ready: ready };
})(window);
