---
name: sudoku-deploy
description: 把 D:/Downloads/数独 这个数独项目发布上线（或重新发布）。当用户说"上线/发布/部署/同步到线上/更新线上"，或写完代码需要让线上生效时使用。包含发布参数、发布后校验、以及一条硬性红线：项目里的 .workbuddy/ 和 tests/ 会被上传到公网。
agent_created: true
---

# 数独项目 · 发布上线

线上地址（固定不变）：**https://sudoku-studio.app.workbuddy.host/**
应用名：数独工作台 · locator `wbapp_9pOdBz9ViJMUuK9ouIQ50G`（记录在 `.workbuddy/applications.yaml`）

---

## 一、先过同意这一关（这一步过不了，后面都白说）

发布平台有一条**人为设置的**安全闸：往一个**已经有线上链接**的目录发布时，
必须由用户在**本轮消息里**明确说要发布，才能覆盖线上内容。

- 用户本轮说了 上线 / 发布 / 部署 / 同步到线上 → 传 `userAskedToPublish: true`，正常发
- 用户只是让你改代码、改样式、修 bug → **不要发**。发布会把用户可能已经分享出去的页面
  换掉，这必须是他的决定。改完告诉他在本地预览看看，然后**结束回合等他回话**

这条闸是产品设计，不是可以绕过的障碍。**不要把 `userAskedToPublish` 当成"重试开关"去凑。**
目录还没有线上链接时（首次发布）不受此限制。

所以：**做不到完全无人值守。** 用户想少说话，正确做法是让他在下达任务时就把意图带上，
比如「继续改提示面板，改完上线」—— 这样"上线"就在最新消息里，一次到位。
如果用户只说「改完提示面板」，那就改完停下问一句要不要上线。

## 二、发布

### 发之前：先确认没有另一个 agent 正在写代码

**这是最隐蔽的一个坑，实测踩到过。** 发布 = 把整个目录打包上传，打包只要一两秒；
而另一个 agent 写单个文件只要几十毫秒。两边一旦撞上，线上就是"一半新一半旧"的中间状态，
**而工具照样返回"发布成功"，页面上看不出任何异常。**

实测：03:17:26 发起发布，`js/core/05-techniques.js` 在 03:17:44 被改写（差 15 秒），
结果线上少了刚加进去的 5 行守卫代码。"发布成功"是真的，内容不全也是真的。

发布前确认源码稳定——连着查几次，值不变才算稳定：

```bash
find js index.html css -type f -printf '%T@ %s %p\n' | sort | md5sum
```

或者直接跑 `node tests/verify-live.js`，它会在最近 30 秒内有站点文件被改动时先给出警告。

撞上了怎么办：等源码**连续 15 秒以上**没有改动，再发布一次，再校验。
**不要在有并发写入的情况下反复重发**——那是在追一个还在移动的目标，
而且每次都在覆盖用户可能已经分享出去的线上页面。

工具是延迟加载的，先取 schema 再调用：

1. `ToolSearch` → `tool_names: ["workbuddy_sites_deploy"]`
2. `DeferExecuteTool` → `toolName: "workbuddy_sites_deploy"`，参数：

```json
{
  "directory": "D:/Downloads/数独",
  "language": "static",
  "appName": "数独工作台",
  "domainPrefix": "sudoku-studio",
  "userAskedToPublish": true
}
```

要点：

- `directory` 决定发到哪个应用——同一个目录重发就是**原地覆盖**，链接和 sandbox 都不变，
  之前分享出去的地址依然有效。**不要传 `appId`**。
- `appName` / `domainPrefix` 只在**首次创建**时生效；重发时应用名保持原样，传了也不会变。
- `entryHtml` **不要传**：这是单应用目录，`index.html` 会自动识别。
- `language: "static"` —— 纯静态站，平台自带 HTTP 服务，不需要 `serve.py`。

## 三、发布后必须校验

**别拿"发布成功"四个字当结论**，要确认线上真的拿到了新文件：

```bash
node tests/verify-live.js
```

它会把 index.html / css / js（含 20M 的 OCR 资源）逐个下载回来比对 md5，
输出「一致 27/27」和退出码 0 才算发布生效。详细程度可参考脚本头注释。

**如果 md5 对不上，先别慌着重发**：多半是边缘缓存。脚本已经给每个请求加了时间戳绕开缓存，
所以脚本报不一致才是真的不一致。手工 curl 核对时也必须带时间戳：

```bash
curl -L "https://sudoku-studio.app.workbuddy.host/js/ui/14-panels.js?t=$(date +%s)"
```

不带的后果就是：刚发完立刻 curl，拿回来的是旧文件，看着像发布失败，白折腾一轮。

## 四、红线：项目里哪些东西会公开

发布是把**整个目录**传上去，只排除 `node_modules/`、`.git/`、构建产物。实测以下全部
可以在公网直接访问（`curl` 返回 200）：

| 路径 | 状态 |
|---|---|
| `.workbuddy/memory/*.md` | **公开** —— 你的工作笔记、踩坑记录都会被人读到 |
| `.workbuddy/skills/*/SKILL.md` | **公开** —— 就包括本文件 |
| `tests/`（含测试脚本、截图） | **公开** |
| `README.md`、`serve.py` | **公开** |
| `.git/`、`启动数独.cmd` | 403，取不到 |

结论：**永远不要把密钥、token、私有素材、未公开的内容写进这个项目目录**，
包括 `.workbuddy/` 里的记忆和技能文件。要记敏感信息就写到项目外面去。

## 五、其他别踩的坑

- **`VENDOR` 必须保持相对路径，站点必须部署在根路径。** `js/ui/18-ocr.js` 里
  `const VENDOR = 'js/vendor/'`，挪到子目录会 404，图片识别直接废掉。
- **别删 `js/vendor/tesseract/` 里的 4 个 core 文件。** Tesseract 运行时按浏览器的 SIMD
  支持情况自己挑一个，看着"只用到一个"也不能删。整站 32M 里这 4 个占了 17M，是上传大头。
- **`js/vendor/` 是自包含的**：worker、wasm、`eng.traineddata.gz` 全在本地，**没有任何 CDN
  外链**。别"优化"成用 CDN 引 Tesseract —— 那会破坏离线可用性，也不符合这个项目的取舍。
- **没有裸 `.wasm` 文件**：4 个 core 都是内嵌 wasm 的 `.wasm.js`，绕开了服务器 MIME 类型
  不对导致 `WebAssembly` 编译失败的经典问题。别把它们换成裸 `.wasm`。
- **沙箱里跑不了真实浏览器测试**：`node tests/browser-test.js <URL>` 一 spawn headless Edge
  就会被 SIGTERM 杀掉，连日志都落不下。别用这条路验证线上页面，用 `verify-live.js`。
  因此**图片识别**是唯一没法自动验证的环节，改到 OCR 相关代码后要提醒用户亲手上传一张
  数独截图试一下。

## 六、常见需求怎么走

| 用户说 | 你要做的 |
|---|---|
| "上线" / "发布一下" | 直接发，然后跑 `node tests/verify-live.js` |
| "改完 XX 上线" | 改 → 发 → 校验，一次做完 |
| "改一下 XX" | **只改，不发**，告诉他本地看，问一句要不要上线 |
| "下架" / "取消发布" | `action: "unpublish"`，同 `directory`。这是破坏性操作，用户没明说就先确认 |
