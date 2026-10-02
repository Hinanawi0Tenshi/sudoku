/* 数独 · 我的（战绩 + 卡牌图鉴）
 *
 * 方案见 docs/奖励机制方案.md。图鉴与战绩合成一页，用标签切换——
 * 两边都是「我积累的东西」，拆成两个首页入口反而占地方。
 *
 * 抽取、保底、碎片兑换、点数结算都还是空实现，等确认后再接。
 *
 * 三条硬边界（实现时不要破坏）：
 *   纯本地——不引服务器、不做账号；不碰钱——没有付费与限时池；
 *   奖励不改解题——卡池不产出提示次数、跳过、自动解。
 */
(function (global) {
  'use strict';

  const SD = global.SD;
  const el = SD.UI.el;

  const RARITY = {
    ssr: { name: 'SSR', color: '#f59e0b', shards: 20, exchange: 200 },
    sr:  { name: 'SR',  color: '#a855f7', shards: 8,  exchange: 80 },
    r:   { name: 'R',   color: '#3b82f6', shards: 3,  exchange: 30 },
    n:   { name: 'N',   color: '#64748b', shards: 1,  exchange: 10 },
  };

  // 十二张立绘 + 五款皮肤。art 留空时自动回落到程序化卡面，
  // 图出好了往 assets/cards/ 一丢、填上 art 即可，逻辑一行都不用改。
  const LIST = [
    { id: '01', name: '晨露', rarity: 'n' },
    { id: '02', name: '青竹', rarity: 'n' },
    { id: '03', name: '远山', rarity: 'n' },
    { id: '04', name: '归鸿', rarity: 'n' },
    { id: '05', name: '折枝', rarity: 'r' },
    { id: '06', name: '拾阶', rarity: 'r' },
    { id: '07', name: '听雨', rarity: 'r' },
    { id: '08', name: '照夜', rarity: 'sr' },
    { id: '09', name: '衔星', rarity: 'sr' },
    { id: '10', name: '拂晓', rarity: 'sr' },
    { id: '11', name: '长明', rarity: 'ssr' },
    { id: '12', name: '无垢', rarity: 'ssr' },
    { id: 's1', name: '和纸', rarity: 'r', kind: 'skin', skin: 'washi' },
    { id: 's2', name: '木质', rarity: 'r', kind: 'skin', skin: 'wood' },
    { id: 's3', name: '蓝图', rarity: 'sr', kind: 'skin', skin: 'blueprint' },
    { id: 's4', name: '霓虹', rarity: 'sr', kind: 'skin', skin: 'neon' },
    { id: 's5', name: '星空', rarity: 'sr', kind: 'skin', skin: 'starlit' },
  ];

  const byId = {};
  for (const c of LIST) byId[c.id] = c;

  /**
   * 程序化卡面：纯色块 + 网格纹理 + 大字号名字 + 稀有度描边。
   * 不依赖任何素材，出图前就能看到完整效果。
   */
  function face(card, owned) {
    const r = RARITY[card.rarity] || RARITY.n;
    const hue = (parseInt(card.id, 10) * 47) % 360;
    return el('div.card-face' + (owned ? '' : '.locked'), {
      style: { '--hue': hue, '--rc': r.color },
    }, [
      el('div.card-grid'),
      el('div.card-name', { text: card.name }),
      el('div.card-rarity', { text: r.name }),
    ]);
  }

  function renderLibrary(root) {
    const wallet = SD.Store.state().wallet || {};
    const owned = wallet.owned || {};
    root.appendChild(el('p.lead', { text: '通关累计点数，在图鉴里抽卡。抽取与兑换还在做，先看看卡面。' }));
    const lib = el('div.gacha-lib');
    for (const card of LIST) {
      const n = owned[card.id] || 0;
      lib.appendChild(el('div.gacha-cell' + (n ? '.has' : ''), null, [
        face(card, n > 0),
        el('span.gacha-count', { text: n > 0 ? '×' + n : '未获得' }),
      ]));
    }
    root.appendChild(lib);
  }

  // 抽取 / 保底 / 碎片兑换 / 点数结算都还没接，先留桩避免调用方找不到
  function draw() { return null; }
  function exchange() { return null; }

  SD.Gacha = { LIST: LIST, byId: byId, RARITY: RARITY, renderLibrary: renderLibrary, draw: draw, exchange: exchange };
})(window);