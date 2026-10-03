# 数独项目 · 长期约定

## 部署
- 线上地址固定：https://sudoku-studio.app.workbuddy.host/ （应用名「数独工作台」，
  locator `wbapp_9pOdBz9ViJMUuK9ouIQ50G`，记录在 `.workbuddy/applications.yaml`）
- 发布方式：静态托管，同目录重发＝原地覆盖，链接不变。`appName`/`domainPrefix` 仅首次生效，
  `entryHtml` 不要传。工具 `workbuddy_sites_deploy` 是延迟加载的，先 ToolSearch 再 DeferExecuteTool。
- 发布后必须跑 `node tests/verify-live.js` 校验，别拿"发布成功"当结论。
- **有另一个 agent 在写代码时不要发布**：打包只要一两秒，会拍到中间状态，而工具照样返回"发布成功"。
  先确认源码连续 15 秒无改动再发；撞上了就等静止后重发，不要反复重发追移动靶。
- 完整手册：`.workbuddy/skills/sudoku-deploy/SKILL.md`

## 红线：这个项目目录会整个上传到公网
`.workbuddy/memory/`、`.workbuddy/skills/`、`tests/`、`docs/`、`README.md`、`serve.py` 实测公网可访问，
只有 `.git/` 是 403。**不要把密钥、token、私有素材、未公开内容写进本目录**，包括记忆文件。

**发布是「覆盖式增量」，不是整体替换**：本地删掉的文件线上依然存在（实测 `08b-bank-big.js`
删了仍返回完整 432KB）。发布也没有排除参数。两者合起来 —— 任何被写进过本目录的东西，
只要发过一次版，就默认**公开且难以撤回**。真要撤：内容改空再发一次，或应用下架重建（链接会变）。

## 不能破坏的技术约束
- `js/ui/18-ocr.js` 的 `VENDOR = 'js/vendor/'` 是相对路径 → 必须部署在根路径，挪子目录会 404。
- `js/vendor/` 必须自包含（worker + 4 个 core + eng.traineddata.gz），**零 CDN 外链**，别改成 CDN。
- `js/vendor/tesseract/` 的 4 个 core 都要留，Tesseract 按 SIMD 支持自己挑一个。
- 全是 `*.wasm.js`（内嵌 wasm），没有裸 `.wasm`，别换。
- UI 用 `10-`~`19-` 数字前缀保证加载顺序，普通 `<script>` 而非 ES modules（为了 file:// 可用）。
- 测试风格：纯 Node 内置模块，零 npm 依赖。

## 沙箱环境限制
- 跑不了真实浏览器：`tests/browser-test.js` 一 spawn headless Edge 就被 SIGTERM 杀掉。
  所以线上页面的真实渲染、以及 OCR 全链路，只能让用户人工确认。
