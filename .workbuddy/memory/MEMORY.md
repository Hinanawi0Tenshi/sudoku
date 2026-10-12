# 数独项目 · 长期约定

## 部署
- 线上地址固定：https://sudoku-studio.app.workbuddy.host/ （应用名「数独工作台」，
  locator `wbapp_9pOdBz9ViJMUuK9ouIQ50G`，记录在 `.workbuddy/applications.yaml`）
- **产品名 2026-10-13 起改为「益智游戏合集」**（三款游戏），但平台侧应用名仍是「数独工作台」：
  `appName` 只在首次创建时生效，改不了。`applications.yaml` 里的 name 保持不动，
  否则下次发布可能被当成新应用、链接会变。要改名得在平台上手动操作。
- 发布方式：静态托管，同目录重发＝原地覆盖，链接不变。`appName`/`domainPrefix` 仅首次生效，
  `entryHtml` 不要传。工具 `workbuddy_sites_deploy` 是延迟加载的，先 ToolSearch 再 DeferExecuteTool。
- 发布后必须跑 `node tests/verify-live.js` 校验，别拿"发布成功"当结论。
- **有另一个 agent 在写代码时不要发布**：打包只要一两秒，会拍到中间状态，而工具照样返回"发布成功"。
  先确认源码连续 15 秒无改动再发；撞上了就等静止后重发，不要反复重发追移动靶。
- 完整手册：`.workbuddy/skills/sudoku-deploy/SKILL.md`
- **跑测试别硬编码 node 版本号**，会变（曾用 `22.22.2-3`，现 `22.22.2-6`）。用 `versions/current` 或先 ls。
- **判断部署是否生效只看 md5，不要看 `Last-Modified`**：那个头是源文件 mtime，
  文件内容没变就不动，会误判成"没发上去"（2026-10-12 踩过）。
- 站点可用性：10-04 发布后连续 8 天无人维护，10-12 复测全绿，**没有短期自动下线**。
  文档站无有效期说明，因此也不能承诺永久。用户报"打不开"时先跑 `verify-live.js` 定性，
  多半是客户端侧（DNS/缓存/网络）问题。

## 红线：这个项目目录会整个上传到公网
`.workbuddy/memory/`、`.workbuddy/skills/`、`tests/`、`docs/`、`README.md`、`serve.py` 实测公网可访问，
只有 `.git/` 是 403。**不要把密钥、token、私有素材、未公开内容写进本目录**，包括记忆文件。

**发布是「覆盖式增量」，不是整体替换**：本地删掉的文件线上依然存在（实测 `08b-bank-big.js`
删了仍返回完整 432KB）。发布也没有排除参数。两者合起来 —— 任何被写进过本目录的东西，
只要发过一次版，就默认**公开且难以撤回**。真要撤：内容改空再发一次，或应用下架重建（链接会变）。

## 不能破坏的技术约束
- `js/games/sudoku/07-ocr.js` 的 `VENDOR = 'js/vendor/'` 是相对路径 → 必须部署在根路径，挪子目录会 404。
- `js/vendor/` 必须自包含（worker + 4 个 core + eng.traineddata.gz），**零 CDN 外链**，别改成 CDN。
- `js/vendor/tesseract/` 的 4 个 core 都要留，Tesseract 按 SIMD 支持自己挑一个。
- 全是 `*.wasm.js`（内嵌 wasm），没有裸 `.wasm`，别换。
- 脚本用数字前缀保证加载顺序，普通 `<script>` 而非 ES modules（为了 file:// 可用）。
- 测试风格：纯 Node 内置模块，零 npm 依赖。

## 架构（2026-10-13 重构）
- 三款游戏：数独（已实装）、杀手数独、扫雷（后两款只注册占位，标题页显示「开发中」）。
- 分层：`js/platform/`（游戏无关）→ `js/core/`（9×9 数独族共用算法与渲染原语）→ `js/games/<游戏>/`。
- **加一款新游戏** = 写一个文件调 `SD.Registry.register({...})` + index.html 加一行 `<script>`，
  平台层一行都不用改。契约字段见 `js/platform/01-registry.js` 的注释。
- 对局页骨架由游戏自己用 `SD.Shell.topbar()` 搭，壳不预设任何控件（扫雷的盘面和 9×9 不是一回事）。
- 数据分命名空间：数独仍是 `sudoku-studio:v1`（**一个字节都没动**），全局是
  `puzzle-hub:global:v1`（主题 + 通关点数）。主题放全局是有意的——它是显示偏好，不是游戏进度；
  但严格说这是除点数外第二项共享的东西，改动前想清楚。
- 遮罩只有一个 `#shell-overlay`（fixed 铺满整屏）。原先每个视图各一个，
  出题途中切视图会收错节点、灰幕留在屏幕上点不掉。
- 出题是异步的，两处令牌：`session`（离开游戏作废）和 `preparing`（玩家明确开局后作废后台备局）。
  少任何一个都会出现「晚一步落地的结果把玩家刚选的题顶掉」。

## 沙箱环境限制
- **看沙箱模式**：`danger-full-access` 下 headless Edge 跑得动，`browser-test.js` / `ocr-test.js` /
  `shot-arch.js` 都能跑（2026-10-13 实测）；受限沙箱里 spawn 会被 SIGTERM 杀掉，
  那种情况下才只能让用户人工确认。先试一次再下结论。
