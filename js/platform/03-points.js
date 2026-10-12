/* 益智游戏合集 · 通关点数
 *
 * 三款游戏之间唯一互通的东西。每款游戏自己决定一局通关值多少分，
 * 平台只负责记账——点数规则是游戏设计的一部分，不该塞在平台层里。
 *
 * points 是当前余额，earned 是各款游戏累计贡献了多少（只增不减）。
 * 两个数分开记：玩家在「我的」里看到「数独贡献 320、扫雷贡献 90」，
 * 才说得清这个余额是怎么来的。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});

  const g = () => SD.Storage.global();

  const total = () => g().data().points || 0;
  const earned = () => g().data().earned || {};

  function award(gameId, amount) {
    const n = Math.max(0, Math.round(amount || 0));
    if (!n) return 0;
    const d = g().data();
    d.points = (d.points || 0) + n;
    d.earned[gameId] = (d.earned[gameId] || 0) + n;
    g().save();
    return n;
  }

  function spend(amount) {
    const n = Math.max(0, Math.round(amount || 0));
    const d = g().data();
    if ((d.points || 0) < n) return false;
    d.points -= n;
    g().save();
    return true;
  }

  /** 一局通关：金额由游戏自己的 points(meta) 决定 */
  function awardWin(gameId, meta) {
    const def = SD.Registry.byId(gameId);
    if (!def || !def.points) return 0;
    return award(gameId, def.points(meta || {}));
  }

  SD.Points = { total: total, earned: earned, award: award, spend: spend, awardWin: awardWin };
})(window);
