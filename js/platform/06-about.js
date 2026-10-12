/* 益智游戏合集 · 关于页
 *
 * 合集本身的说明 + 每款游戏自己的段落。
 * 各游戏的技术细节放在各自的 about 里，平台层不替它们写——
 * 数独的 OCR 和扫雷的无猜生成完全不是一回事，混在一段里没人看得下去。
 */
(function (global) {
  'use strict';
  const SD = (global.SD = global.SD || {});
  const { el } = SD.UI;

  const HUB = {
    h: '这个合集是什么',
    p: [
      '一个纯前端的益智游戏合集。没有账号、没有服务器、没有埋点，所有数据只存在你自己的浏览器里。',
      '三款游戏的数据各存各的：一款游戏的进度、战绩、题库不会被另一款的「清除数据」带走。',
      '唯一的互通项是通关点数——在任何一款游戏里通关都会累加，账本是一个。',
      '双击 index.html 就能玩；图片识别要用 Web Worker 读本地文件，受浏览器同源策略限制，需要用启动脚本起一个本地服务。',
    ],
  };

  function card(title, lines) {
    const node = el('div.card.about-card', null, el('h3', { text: title }));
    for (const line of lines) node.appendChild(el('p', { text: line }));
    return node;
  }

  function renderAbout(root) {
    root.appendChild(card(HUB.h, HUB.p));
    for (const def of SD.Registry.ready()) {
      if (!def.about || !def.about.length) continue;
      root.appendChild(el('h3.sec-title', { text: def.name }));
      for (const sec of def.about) root.appendChild(card(sec.h, sec.p));
    }
    // 把版本号摆出来：发布出问题时要能一眼分清
    // 「发上去了但用户还在看旧缓存」和「压根没发上去」。
    root.appendChild(el('p.foot-note', { text: '版本 ' + (window.SD_BUILD || '本地开发版') }));
  }

  SD.About = { renderAbout: renderAbout };
})(window);
