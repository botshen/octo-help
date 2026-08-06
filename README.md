# Octo 聊天增强

一个增强 Octo（`im.deepminer.com.cn`）网页版聊天体验的浏览器扩展（WXT + React）：

- **显示已撤回消息的原文** —— 把「XX撤回了一条消息」还原成正常消息气泡，标注「已撤回」。
- **消息美化 + 换肤** —— 三档气泡配色（AI / 自己 / 他人）、折叠会话自动展开、长消息限高「展开全文」、暗色适配，以及可切换的消息主题。
- **Bot 资料卡「全息卡牌」+ 开卡抽卡** —— 把 Bot 资料卡改成 synthwave 落日 banner + 悬浮圆头像 + 信息合并大框 + 创建者置底署名，随鼠标 3D 倾斜；每次打开还会随机抽一个稀有度（宝可梦式档位 N/R/SR/SSR/UR，越稀越少），据此渲染金箔全息卡框、稀有度角标与高档辉光脉动，SR 及以上播放全屏揭晓特效。
- **全站主题 + 世界杯特效** —— 可切换导航、会话和输入区配色，提供足球射门动画与梅西、姆巴佩水印。
- **输入框宠物** —— 内置蚂蚁、蜗牛、巫师和僵尸四种巡游宠物，输入或收到新消息时在输入框上沿活动；也可导入 `.zip` / `.codex-pet.zip` 自定义宠物。
- **舒适输入框** —— 默认提供三行编辑空间，将工具栏移到右下角，同时保留 Octo 原生的附件、快捷键和全屏展开能力。
- **GitHub 快捷入口** —— 自动识别消息中的仓库、Issue、PR、Commit、Action、Release 和文件链接，在消息旁提供准确跳转；PR/Issue 编号后即使直接粘着文字也不会把文字带进 URL。
- **新消息气泡** —— 桌宠启用时，当前页面收到他人的新消息会显示 5 秒短气泡；内容只在本地内存中处理，不持久化。

所有功能都在浏览器本地处理，不改动 Octo 源码，也不会上传宠物包。

## 原理

- **撤回还原**：Octo 撤回消息时并不删除原文——后端同步时 `revoke=1` 与原始 payload 一起下发，原文保留在页面 React 内存的 `message.content` 上，前端只是把整行渲染成系统提示。插件注入页面 **MAIN world**，从撤回行的 React Fiber 反查出 `message`，克隆一条正常消息行、填入原文并标注「已撤回」。全程只读 props，不改 React 状态、不 patch 原型，可逆。
- **换肤**：主题模型 `base`→`body[theme-mode]`（亮/暗，联动 app 原生暗色）、`skin`→`body[data-octo-skin]`（消息皮肤）。样式由注入的大段 CSS 按这两个属性切换；Side Panel 选中的主题存 `browser.storage.local`，经内容脚本转发到 MAIN world 应用。有 `MutationObserver` 在 app 启动强制亮色时「重申」所选主题（带自写抑制 + 去抖，避免与 app 抢属性打死循环）。
- **开卡抽卡**：Bot 资料卡弹窗挂载时，美化引擎的 `sync()` 按加权概率 `Math.random()` 抽一个稀有度，写到 `.wk-modal-shell` / `.wk-bot-detail-content` 的 `data-octo-rarity` 上——卡框配色、角标文字（`content: attr(...)`）、辉光强度全部由 CSS 据此渲染。抽卡是「每个卡片实例一次」：同一弹窗重渲染沿用已抽结果，关闭重开则是新实例、重新抽。揭晓特效节点注入 `<body>`（在弹窗 React 树之外，避免被 reconcile 清掉），播完自移除。只读随机 + 自身属性写入，不改源码、不改 React 状态。
- **桌面宠物**：Side Panel 使用 JSZip 本地校验并解压宠物包，把 manifest 与 spritesheet data URL 存入 `browser.storage.local`；内容脚本把状态转发到 MAIN world，页面脚本按 manifest 播放动作状态机，并把拖拽位置回写 storage。Codex v1 `8 × 9` 与 v2 `8 × 11` atlas 使用官方动作行和逐帧时长；无动画配置的旧 Octo 包仍按 `12 × 13` 第一行播放。
- **输入区增强**：舒适模式只通过 scoped CSS 调整 Octo 的 `.wk-messageinput-*` 布局，不接管 Tiptap 编辑器事件；宠物输入框模式用 `ResizeObserver`、滚动监听和批量定位跟随当前会话输入框。

美化/换肤逻辑移植自油猴脚本 [an9xyz/octo-script](https://github.com/an9xyz/octo-script)（MIT），改为由扩展 Side Panel + `browser.storage` 驱动，去掉了原脚本页面内的 NavRail 菜单。

## 结构

- `entrypoints/octo.content.ts` — 内容脚本（ISOLATED）：读 `storage`、注入 MAIN-world 脚本、转发设置状态，并持久化页面回传的宠物位置与兼容性报告。体积严格控制在 15 KB：不得 import 美化引擎。
- `entrypoints/octo-main-world.ts` — MAIN-world 脚本：撤回还原（Fiber 反查 + 克隆气泡 + `MutationObserver`）、启动美化引擎、运行 DOM 兼容性自检。
- `entrypoints/octo-kick-world.ts` — 按需注入的 MAIN-world 脚本，封装 pixi.js 射门特效（见下方「体积与性能约束」）。
- `utils/octoBeautify.ts` — 美化 + 换肤引擎（主题模型 / 折叠展开 / AI 连续标记 / 限高展开 / 作用域化 sync）。
- `utils/octoBeautify.css` — 美化样式表，由 `?raw` 原文字导入（**不要**改成 `?inline`，原因见文件顶部注释）。
- `utils/octoThemeCatalog.ts` — 主题/皮肤/射门样式的纯数据目录，**零 import**。Side Panel 和内容脚本只靠它拿默认值，不用拖入引擎。
- `utils/octoSelectors.ts` — **所有 JS 侧 Octo DOM 选择器的单一来源**，兼 DOM 兼容性自检。新增选择器请加在这里。
- `utils/octoPageFeatures.ts` — 页面侧功能登记表（总开关控制的启/停）。`stop` 必填。
- `utils/octoSettingsParsers.ts` — storage 原始值 → 设置值的纯函数解析器（含默认值与迁移规则）。
- `utils/octoSettingsRelay.ts` — `postToPage` 与变更集工具。
- `utils/octoSyncScope.ts` — mutation 分类：判定一批 DOM 变动需要哪些 pass、可限定在哪些子树。
- `utils/octoFullscreenKickLazy.ts` — pixi 射门特效的惰加载门面（签名与同步版一致）。
- `utils/octoFullscreenKickPixi.ts` — pixi.js 实现，只能由 `octo-kick-world.ts` 引入。
- `utils/octoRecall.ts` — 共享常量（目标域名、storage key、postMessage 协议）。
- `utils/octoPet.ts` — 宠物包大小、路径、manifest 与图片校验及本地解析。
- `utils/octoPetState.ts` — 宠物状态校验器。兼任安全边界：页面可以伪造 postMessage，这里的校验决定伪造消息能否造成危害。
- `utils/octoPetRenderer.ts` — 桌面宠物 overlay、spritesheet 动画与拖拽交互。
- `utils/octoBuiltInCompanion.ts` — 四只内置输入框宠物的巡游、定位和消息唤醒。
- `utils/octoGithubLink.ts` — GitHub URL 边界识别、分类和消息快捷入口。
- `utils/octoComposerEnhancer.ts` — 三行舒适输入框样式和完整还原。
- `utils/octoPetSpeech.ts` — 监听当前会话新增消息、提取短摘要、过滤自己/系统/撤回/重复消息。
- `entrypoints/sidepanel/` — 侧边栏完整设置：全局开关、主题、特效、球星、桌宠和撤回消息设置，并展示兼容性告警。
- `assets/player-source/` — 球星水印源图，仅供 `scripts/split-player-animation-assets.py` 使用，**不打包进扩展**。

## 体积与性能约束

这些不是建议，而是会被回归的约束：

- **pixi.js 不得进入常驻脚本**。pixi + pixi-filters 约 540 KB，只有选了球星水印的用户需要。它住在独立的 `octo-kick-world.js`，由 `octoFullscreenKickLazy` 在首次启用时请求内容脚本 `injectScript` 注入（WXT 推荐的 main-world 模式）。
- **内容脚本不得 import 美化引擎**。它只需转发设置；曾因为 import 三个默认主题常量而把整个 pixi 拖进去（231 KB 死代码）。默认值请从 `octoThemeCatalog` 取。
- **sync 的代价不得随会话长度增长**。消息相关的 pass 靠 `octoSyncScope` 限定在变动子树内；clamp 的测高读写分离并用 `WeakSet` 记忆结果。实测：3000 条消息下单条新消息的处理从 9.1 ms 降到 1.0 ms。
- **不要用 `ResizeObserver` 观察消息元素**。它对目标持强引用，会把被回收的上千条消息钉在内存里。clamp 的失效信号用的是 document 级 `load` 捕获 + window `resize`。

## 安全模型

MAIN world 与页面共享同一个 realm，`window.postMessage` **不是可信通道** —— `event.source !== window` 加一个 `source` 字段不构成认证，Octo 页面上的任何脚本都能伪造完全一样的消息。

因此原则是「使伪造消息无害」，而不是「防止伪造消息到达」：

- 每个 MAIN-world 入口都要重新校验收到的字段，不能依赖内容脚本已经校验过。
- 任何来自消息的 URL 必须收敛到安全集合：宠物图只接受 `data:image/*;base64,`，水印图由 `extensionAssetUrl()` 钉住协议与路径。否则页面可以借插件之手向外部发请求（装机探测 + 内网外发通道）。
- 主题类参数统一过 `*ById()` 白名单，未知值回退默认而不是直接 `setAttribute`。
- 页面上不用 `innerHTML` 拼接（MAIN world 的 innerHTML 以页面权限执行）。

## 兼容性自检

Octo 是我们不控制的移动目标。改版重命名类名时，受影响的功能会静默失效，用户只会觉得「插件坏了」。MAIN world 在启动后的 1.5 / 5 / 15 秒探测关键选择器，并把结论写入 storage，Side Panel 据此提示具体哪项能力失效。

避免误报是设计重点：应用外壳未渲染前结论为「不确定」且不报告；每项检查声明前置条件，前置缺失时不连带报告其下游检查；仅在结论变化时写入。


## 新增一个功能要改哪里

目标是每项只改一处，且漏改会被编译器或测试拦下：

1. `octoRecall.ts`：加 storage key + 消息类型与接口（并加入 `OctoMessage` 联合）。
2. `octoSettingsParsers.ts`：加解析器，并把 key 加入 `RELAYED_STORAGE_KEYS` 和 `SIMPLE_RELAY_KEYS`。
   → 内容脚本的 relay 表是以这个联合为键的 `Record`，**忘了接线会直接编译失败**。
3. `octo-main-world.ts`：在 `SETTING_HANDLERS` 表里加一行。
4. 如果它在页面上留下任何痕迹（样式、属性、节点、监听器、定时器）：在 `PAGE_FEATURES`
   里加一项，`stop` 是必填的。这是「关掉总开关 = 等于没装插件」的结构保证。
5. `sidepanel/App.tsx`：加 UI。

关于解析器：大多数设置只需一个解析函数，因为初始快照和 `onChanged` 变更集形状相同。
但注意：删除宠物会 **remove** `octoDesktopPetEnabled` 键，变更集里它是 `undefined` ——
此时套用「初始默认值」会把用户刚删的宠物重新启用。所以三个设置刻意保留了
`...Initial` / `...FromChange` 两个版本，并有测试断言二者结果不同，防止后人「清理」掉。

## 开发

```bash
pnpm install
pnpm dev        # 启动 17321 端口，不自动打开浏览器
pnpm compile    # 类型检查
pnpm build      # 生产构建
```

安装扩展后打开 Octo，点击扩展图标打开 Side Panel：选择消息主题、切换「舒适输入框」，或在「桌面宠物」区导入 `.zip` / `.codex-pet.zip`。导入后宠物默认启用，可选择自由拖拽或输入框陪伴，也可停用、更换或删除。仅在 `im.deepminer.com.cn` 生效（改域名见 `wxt.config.ts` 的 `OCTO_MATCHES`）；所有处理在本地完成，插件不向任何服务器发送数据。

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
