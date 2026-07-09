# Octo 增强插件

一个浏览器扩展（WXT + React），增强 Octo（`im.deepminer.com.cn`）网页版聊天：

- **显示已撤回消息的原文** —— 把「XX撤回了一条消息」还原成正常消息气泡，标注「已撤回」。
- **消息美化 + 换肤** —— 三档气泡配色（AI / 自己 / 他人）、折叠会话自动展开、长消息限高「展开全文」、暗色适配，以及可切换的消息主题（赛博紫·亮 / 赛博紫·暗 / 美加墨世界杯）。

两个功能都是纯 CSS/DOM 覆盖，不改动 Octo 源码。

## 原理

- **撤回还原**：Octo 撤回消息时并不删除原文——后端同步时 `revoke=1` 与原始 payload 一起下发，原文保留在页面 React 内存的 `message.content` 上，前端只是把整行渲染成系统提示。插件注入页面 **MAIN world**，从撤回行的 React Fiber 反查出 `message`，克隆一条正常消息行、填入原文并标注「已撤回」。全程只读 props，不改 React 状态、不 patch 原型，可逆。
- **换肤**：主题模型 `base`→`body[theme-mode]`（亮/暗，联动 app 原生暗色）、`skin`→`body[data-octo-skin]`（消息皮肤）。样式由注入的大段 CSS 按这两个属性切换；popup 选中的主题存 `browser.storage.local`，经内容脚本转发到 MAIN world 应用。有 `MutationObserver` 在 app 启动强制亮色时「重申」所选主题（带自写抑制 + 去抖，避免与 app 抢属性打死循环）。

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
