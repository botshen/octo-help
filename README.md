# Octo 聊天增强

一个增强 Octo（`im.deepminer.com.cn`）网页版聊天体验的浏览器扩展（WXT + React）：

- **显示已撤回消息的原文** —— 把「XX撤回了一条消息」还原成正常消息气泡，标注「已撤回」。
- **消息美化 + 换肤** —— 三档气泡配色（AI / 自己 / 他人）、折叠会话自动展开、长消息限高「展开全文」、暗色适配，以及可切换的消息主题。
- **Bot 资料卡「全息卡牌」+ 开卡抽卡** —— 把 Bot 资料卡改成 synthwave 落日 banner + 悬浮圆头像 + 信息合并大框 + 创建者置底署名，随鼠标 3D 倾斜；每次打开还会随机抽一个稀有度（宝可梦式档位 N/R/SR/SSR/UR，越稀越少），据此渲染金箔全息卡框、稀有度角标与高档辉光脉动，SR 及以上播放全屏揭晓特效。
- **全站主题 + 世界杯特效** —— 可切换导航、会话和输入区配色，提供足球射门动画与梅西、姆巴佩水印。
- **本地桌面宠物** —— 导入 `.zip` / `.codex-pet.zip` 宠物包，在 Octo 页面按静止、悬浮、左右拖动切换 spritesheet 动作，并记忆位置。
- **新消息气泡** —— 桌宠启用时，当前页面收到他人的新消息会显示 5 秒短气泡；内容只在本地内存中处理，不持久化。

所有功能都在浏览器本地处理，不改动 Octo 源码，也不会上传宠物包。

## 原理

- **撤回还原**：Octo 撤回消息时并不删除原文——后端同步时 `revoke=1` 与原始 payload 一起下发，原文保留在页面 React 内存的 `message.content` 上，前端只是把整行渲染成系统提示。插件注入页面 **MAIN world**，从撤回行的 React Fiber 反查出 `message`，克隆一条正常消息行、填入原文并标注「已撤回」。全程只读 props，不改 React 状态、不 patch 原型，可逆。
- **换肤**：主题模型 `base`→`body[theme-mode]`（亮/暗，联动 app 原生暗色）、`skin`→`body[data-octo-skin]`（消息皮肤）。样式由注入的大段 CSS 按这两个属性切换；popup 选中的主题存 `browser.storage.local`，经内容脚本转发到 MAIN world 应用。有 `MutationObserver` 在 app 启动强制亮色时「重申」所选主题（带自写抑制 + 去抖，避免与 app 抢属性打死循环）。
- **开卡抽卡**：Bot 资料卡弹窗挂载时，美化引擎的 `sync()` 按加权概率 `Math.random()` 抽一个稀有度，写到 `.wk-modal-shell` / `.wk-bot-detail-content` 的 `data-octo-rarity` 上——卡框配色、角标文字（`content: attr(...)`）、辉光强度全部由 CSS 据此渲染。抽卡是「每个卡片实例一次」：同一弹窗重渲染沿用已抽结果，关闭重开则是新实例、重新抽。揭晓特效节点注入 `<body>`（在弹窗 React 树之外，避免被 reconcile 清掉），播完自移除。只读随机 + 自身属性写入，不改源码、不改 React 状态。
- **桌面宠物**：popup 使用 JSZip 本地校验并解压宠物包，把 manifest 与 spritesheet data URL 存入 `browser.storage.local`；内容脚本把状态转发到 MAIN world，页面脚本按 manifest 播放动作状态机，并把拖拽位置回写 storage。Codex v1 `8 × 9` 与 v2 `8 × 11` atlas 使用官方动作行和逐帧时长；无动画配置的旧 Octo 包仍按 `12 × 13` 第一行播放。

美化/换肤逻辑移植自油猴脚本 [an9xyz/octo-script](https://github.com/an9xyz/octo-script)（MIT），改为由扩展 popup + `browser.storage` 驱动，去掉了原脚本页面内的 NavRail 菜单。

## 结构

- `entrypoints/octo.content.ts` — 内容脚本（ISOLATED）：读 `storage`、注入 MAIN-world 脚本、转发「撤回开关」与「主题」状态。
- `entrypoints/octo-main-world.ts` — MAIN-world 脚本：撤回还原（Fiber 反查 + 克隆气泡 + `MutationObserver`），并启动美化引擎。
- `utils/octoBeautify.ts` — 美化 + 换肤引擎（内嵌 CSS + 主题模型 + 折叠展开 / AI 连续标记 / 限高展开 / 去抖 sync）。
- `utils/octoRecall.ts` — 共享常量（storage key、postMessage 协议）。
- `utils/octoPet.ts` — 宠物包大小、路径、manifest 与图片校验及本地解析。
- `utils/octoPetRenderer.ts` — 桌面宠物 overlay、spritesheet 动画与拖拽交互。
- `utils/octoPetSpeech.ts` — 监听当前会话新增消息、提取短摘要、过滤自己/系统/撤回/重复消息。
- `entrypoints/popup/` — 弹窗设置：主题选择 + 「显示已撤回的消息」开关（存 `browser.storage.local`，撤回开关默认关闭）。

## 开发

```bash
pnpm install
pnpm dev        # 加载到 Chrome
pnpm compile    # 类型检查
pnpm build      # 生产构建
```

安装扩展后打开 Octo，点扩展图标：选择消息主题、按需打开「显示已撤回的消息」，或在「桌面宠物」区导入 `.zip` / `.codex-pet.zip`。导入后宠物默认启用，可在网页中拖拽定位，也可回到 popup 停用、更换或删除。仅在 `im.deepminer.com.cn` 生效（改域名见 `wxt.config.ts` 的 `OCTO_MATCHES`）；所有处理在本地完成，插件不向任何服务器发送数据。

## 宠物包动作格式

Codex 宠物包可直接导入：`1536 × 1872` 的 v1 atlas 会自动识别，v2 包按官方格式在 `pet.json` 声明 `"spriteVersionNumber": 2`。静止播放 `idle`，悬浮播放 `waving`，拖动时按方向播放 `running-left` / `running-right`；松开后按鼠标是否仍在宠物上恢复悬浮或静止动作。标准 atlas 的其余 `jumping`、`failed`、`waiting`、`running`、`review` 动作也会完成解析。

自定义 atlas 推荐使用顶层 `columns` / `rows` / `frameDurationMs` / `animations` / `stateAnimations`。以下是一个完整、最小可用的 `pet.json`：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "spritesheetPath": "spritesheet.webp",
  "columns": 4,
  "rows": 1,
  "frameDurationMs": 125,
  "animations": {
    "idle": { "row": 0, "frames": 4 }
  },
  "stateAnimations": {
    "idle": "idle"
  }
}
```

`animations` 也兼容同义顶层字段 `actions`。`frames` 可以是从第 0 列开始的帧数，也可以是明确的列索引数组。动作可用 `fps`、`frameDurationMs` 或可选的 `frameDurationsMs` 逐帧时长；`stateAnimations.dragLeft` / `dragRight` 可覆盖左右拖动动作。导入时会校验网格、行列范围、时长、状态引用与图片尺寸，错误包不会进入页面脚本。

为兼容早期对外示例，也接受以下别名，导入后会规范化为上面的顶层格式：

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "spritesheetPath": "spritesheet.webp",
  "sprite": { "columns": 6, "rows": 3, "defaultFps": 8 },
  "actions": {
    "calm": { "row": 0, "frames": 6 },
    "happy": { "row": 1, "frames": 4 },
    "grabbed": { "row": 2, "frames": 6 }
  },
  "states": {
    "default": "calm",
    "hover": "happy",
    "dragging": "grabbed",
    "dragLeft": "grabbed",
    "dragRight": "grabbed"
  }
}
```

对应关系为 `sprite.columns/rows` → `columns/rows`、`sprite.defaultFps` → `frameDurationMs = 1000 / defaultFps`，以及 `states.default/hover/dragging/dragLeft/dragRight` → `stateAnimations.idle/hover/drag/dragLeft/dragRight`。同一包可同时写推荐的顶层字段和兼容别名，但两者必须一致；冲突会在导入时明确报错。

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
