# Octo 聊天增强

一个增强 Octo（`im.deepminer.com.cn`）网页版聊天体验的浏览器扩展（WXT + React）：

- **显示已撤回消息的原文** —— 把「XX撤回了一条消息」还原成正常消息气泡，标注「已撤回」。
- **消息美化 + 换肤** —— 三档气泡配色（AI / 自己 / 他人）、折叠会话自动展开、长消息限高「展开全文」、暗色适配，以及可切换的消息主题。
- **Bot 资料卡开卡抽卡** —— 每次打开 Bot 资料卡随机抽一个稀有度（宝可梦式档位 N/R/SR/SSR/UR，越稀越少），据此渲染金箔全息卡框、稀有度角标与高档辉光脉动；SR 及以上还会播放全屏揭晓特效。
- **全站主题 + 世界杯特效** —— 可切换导航、会话和输入区配色，提供足球射门动画与梅西、姆巴佩水印。

这些功能都是纯 CSS/DOM 覆盖，不改动 Octo 源码。

## 原理

- **撤回还原**：Octo 撤回消息时并不删除原文——后端同步时 `revoke=1` 与原始 payload 一起下发，原文保留在页面 React 内存的 `message.content` 上，前端只是把整行渲染成系统提示。插件注入页面 **MAIN world**，从撤回行的 React Fiber 反查出 `message`，克隆一条正常消息行、填入原文并标注「已撤回」。全程只读 props，不改 React 状态、不 patch 原型，可逆。
- **换肤**：主题模型 `base`→`body[theme-mode]`（亮/暗，联动 app 原生暗色）、`skin`→`body[data-octo-skin]`（消息皮肤）。样式由注入的大段 CSS 按这两个属性切换；popup 选中的主题存 `browser.storage.local`，经内容脚本转发到 MAIN world 应用。有 `MutationObserver` 在 app 启动强制亮色时「重申」所选主题（带自写抑制 + 去抖，避免与 app 抢属性打死循环）。
- **开卡抽卡**：Bot 资料卡弹窗挂载时，美化引擎的 `sync()` 按加权概率 `Math.random()` 抽一个稀有度，写到 `.wk-modal-shell` / `.wk-bot-detail-content` 的 `data-octo-rarity` 上——卡框配色、角标文字（`content: attr(...)`）、辉光强度全部由 CSS 据此渲染。抽卡是「每个卡片实例一次」：同一弹窗重渲染沿用已抽结果，关闭重开则是新实例、重新抽。揭晓特效节点注入 `<body>`（在弹窗 React 树之外，避免被 reconcile 清掉），播完自移除。只读随机 + 自身属性写入，不改源码、不改 React 状态。

美化/换肤逻辑移植自油猴脚本 [an9xyz/octo-script](https://github.com/an9xyz/octo-script)（MIT），改为由扩展 popup + `browser.storage` 驱动，去掉了原脚本页面内的 NavRail 菜单。

## 结构

- `entrypoints/octo.content.ts` — 内容脚本（ISOLATED）：读 `storage`、注入 MAIN-world 脚本、转发「撤回开关」与「主题」状态。
- `entrypoints/octo-main-world.ts` — MAIN-world 脚本：撤回还原（Fiber 反查 + 克隆气泡 + `MutationObserver`），并启动美化引擎。
- `utils/octoBeautify.ts` — 美化 + 换肤引擎（内嵌 CSS + 主题模型 + 折叠展开 / AI 连续标记 / 限高展开 / 去抖 sync）。
- `utils/octoRecall.ts` — 共享常量（storage key、postMessage 协议）。
- `entrypoints/popup/` — 弹窗设置：主题选择 + 「显示已撤回的消息」开关（存 `browser.storage.local`，撤回开关默认关闭）。

## 开发

```bash
pnpm install
pnpm dev        # 加载到 Chrome
pnpm compile    # 类型检查
pnpm build      # 生产构建
```

安装扩展后打开 Octo，点扩展图标：选择消息主题、按需打开「显示已撤回的消息」。仅在 `im.deepminer.com.cn` 生效（改域名见 `wxt.config.ts` 的 `OCTO_MATCHES`）；所有处理在本地完成，插件不向任何服务器发送数据。

## 安装 Release 包

从仓库的 [Releases](https://github.com/botshen/octo-help/releases) 下载 Chrome ZIP，解压后在 `chrome://extensions` 中打开「开发者模式」，选择「加载已解压的扩展程序」。

## 发布

版本更新记录统一维护在 [`CHANGELOG.md`](./CHANGELOG.md)，Release 页面不会使用提交记录代替用户可读的更新说明。

发布前，先把本次变化整理为目标版本的二级标题，例如 `## [0.2.0] - 2026-08-01`，并提交 `CHANGELOG.md`。可以在本地预览最终 Release 正文：

```bash
pnpm release:notes v0.2.0
```

发布命令会检查工作区、分支和对应版本的更新说明，运行类型检查、构建 ZIP、更新版本号、创建提交和 tag，并推送到 GitHub。GitHub Actions 随后会从 `CHANGELOG.md` 提取正文，自动创建 Release，并上传 Chrome ZIP 和 SHA-256 校验文件。

```bash
pnpm release patch   # 0.1.0 -> 0.1.1
pnpm release minor   # 0.1.0 -> 0.2.0
pnpm release major   # 0.1.0 -> 1.0.0
pnpm release 1.2.3   # 发布指定版本
```
