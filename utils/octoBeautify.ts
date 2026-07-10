// Message beautify + theme (skin) engine, ported from an9xyz/octo-script
// (Tampermonkey userscript) into our extension. Pure CSS/DOM overrides in the
// page MAIN world — no app source changes.
//
// Adapted from the original:
//   - theme selection is driven by the extension popup via browser.storage,
//     relayed here through postMessage, instead of localStorage + an in-page
//     NavRail menu (that button/menu UI is removed).
//   - everything else (three-tier bubbles, fold-session auto-expand, AI
//     continue marking, long-message clamp/expand, dark tokens, worldcup skin)
//     is kept verbatim from the source.
//
// Theme model: base -> body[theme-mode] (light/dark), skin -> body[data-octo-skin].

export interface ThemeDef {
  id: string;
  label: string;
  icon: string;
  base: "light" | "dark";
  skin: string;
}

export interface GlobalThemeDef {
  id: string;
  label: string;
  icon: string;
}

export const THEMES: ThemeDef[] = [
  { id: "cyber-light", label: "赛博紫 · 亮", icon: "☀️", base: "light", skin: "" },
  { id: "cyber-dark", label: "赛博紫 · 暗", icon: "\u{1F319}", base: "dark", skin: "" },
  { id: "worldcup", label: "美加墨世界杯", icon: "\u{1F3C6}", base: "light", skin: "worldcup" },
];
export const DEFAULT_THEME = "cyber-light";

export const GLOBAL_THEMES: GlobalThemeDef[] = [
  { id: "none", label: "跟随原站", icon: "▫️" },
  { id: "cyber-light", label: "赛博紫 · 亮", icon: "☀️" },
  { id: "cyber-dark", label: "赛博紫 · 暗", icon: "\u{1F319}" },
  { id: "mist", label: "雾青工作台", icon: "◈" },
  { id: "worldcup", label: "美加墨世界杯", icon: "\u{1F3C6}" },
];
export const DEFAULT_GLOBAL_THEME = "none";

const CLAMP_HEIGHT = 240;
const STYLE_ID = "octo-ai-flatten-css";

const BEAUTIFY_CSS = `            :root {
                --octo-bubble-max: min(80%, 820px);
                --octo-clamp-h: 240px;
                /* 赛博切角：右上 + 左下各切 13px */
                --octo-cut: polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 13px 100%, 0 calc(100% - 13px));
            }

            /* ========== 隐藏折叠容器外壳 ========== */
            .wk-message-item-fold-session {
                background: transparent !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            .wk-message-item-fold-session-shell > .wk-message-item-fold-session-avatar,
            .wk-fold-session-title-row {
                display: none !important;
            }
            /* 折叠外壳原生 margin-left:15px → 清零，使折叠块左基准与普通消息一致 */
            .wk-message-item-fold-session-shell {
                margin-left: 0 !important;
            }
            .wk-fold-session-card {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                margin: 0 !important;
                padding: 0 !important;
                max-width: none !important;
                width: 100% !important;
            }
            .wk-fold-session-card-head,
            .wk-fold-session-card-summary {
                display: none !important;
            }
            .wk-fold-session-card-expanded {
                display: block !important;
                max-width: none !important;
                width: 100% !important;
            }
            .wk-fold-session-card-expanded-inner {
                display: block !important;
                background: transparent !important;
                padding: 0 !important;
                margin: 0 !important;
                max-width: none !important;
                width: 100% !important;
            }

            /* ========================================================
             * AI 消息卡片 —— 冷紫 Geek 风 + gamer 元素
             * ====================================================== */
            /* 整行不加框，仅作布局容器：头像 + 头部留在框外 */
            .wk-msg-row:has(.ai-badge),
            .wk-msg-row--continue[data-ai-continue="true"] {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                margin: 4px 12px !important;
                padding: 0 !important;
            }

            /* 连续消息：占位但隐藏头像，保持对齐 */
            .wk-msg-row--continue[data-ai-continue="true"] .wk-msg-row-avatar {
                display: flex !important;
                visibility: hidden !important;
            }

            /* 头像 - 简洁无边框 */
            .wk-msg-row:has(.ai-badge) .wk-msg-avatar {
                border-radius: 50% !important;
                padding: 0 !important;
                background: #fff !important;          /* 纯白底兜底：透明头像不透出页面底色 */
                box-shadow: none !important;
            }
            .wk-msg-row:has(.ai-badge) .wk-msg-avatar-img {
                border: none !important;
                border-radius: 50% !important;
            }

            /* @property 注册可动色相，驱动渐变 hue 循环（只重算文字渐变，不用 filter → 不染色徽章） */
            @property --octo-hue {
                syntax: "<angle>";
                inherits: false;
                initial-value: 0deg;
            }
            /* 名字 - 霓虹流光（键盘 RGB 风）：--octo-hue 循环使 hsl 色标每帧重算 → 背景值变化强制重绘，
             * 文字色彩流动；全程不用 filter，旁边/内部的 AI 徽章一律不受影响。 */
            .wk-msg-row:has(.ai-badge) .wk-msg-row-sender {
                font-weight: 600 !important;
                font-size: 14px !important;
                background: linear-gradient(90deg,
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%),
                    hsl(calc(190deg + var(--octo-hue)), 92%, 52%),
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%)) !important;
                background-size: 200% auto !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-fill-color: transparent !important;
                color: transparent !important;
                animation: octo-name-wave 4s linear infinite !important;
            }
            @keyframes octo-name-wave {
                0%   { --octo-hue: 0deg;   background-position: 0% center; }
                100% { --octo-hue: 360deg; background-position: -200% center; }
            }
            @media (prefers-reduced-motion: reduce) {
                .wk-msg-row:has(.ai-badge) .wk-msg-row-sender,
                .wk-fold-msg-name,
                .wk-bot-detail-name { animation: none !important; }
            }

            /* AI 徽章 - 干净紫色标牌（赛博感交给卡片 HUD 角标，徽章不发光） */
            .wk-msg-row:has(.ai-badge) .ai-badge {
                background: linear-gradient(135deg, #7c6bf0, #5b58e8) !important;
                color: #fff !important;
                font-weight: 700 !important;
                font-size: 10px !important;
                padding: 3px 10px !important;
                height: auto !important;          /* 清除 ai-badge-default(16px)/small(14px) 的固定高差异 */
                line-height: 1 !important;         /* 统一行高，两种 size 渲染一致 */
                box-sizing: content-box !important;
                border-radius: 10px !important;
                box-shadow: 0 1px 2px rgba(91, 88, 232, 0.25) !important;
                border: none !important;
                letter-spacing: 0.5px !important;
                text-shadow: none !important;
                animation: none !important;
            }

            /* 时间戳 - faint */
            .wk-msg-row:has(.ai-badge) .wk-msg-row-timestamp,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-msg-row-timestamp {
                color: #9da0b2 !important;
                font-size: 11px !important;
            }

            /* 内容气泡 —— 赛博切角卡片 */
            .wk-msg-row:has(.ai-badge) .wk-markdown,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown {
                --octo-bg: #ffffff;
                --octo-accent: #7c6bf0;
                position: relative !important;
                background: #ffffff !important;
                border: 1px solid #e7e9f2 !important;
                border-left: 3px solid #5b58e8 !important;
                border-radius: 9px !important;
                filter: drop-shadow(0 1px 2px rgba(40, 40, 90, 0.10)) !important;
                padding: 12px 16px !important;
                margin-top: 8px !important;
                box-sizing: border-box !important;
                width: fit-content !important;
                max-width: var(--octo-bubble-max) !important;
                overflow-wrap: anywhere !important;
                color: #5a5a72 !important;
                line-height: 1.65 !important;
                font-size: 14px !important;
                transition: background .15s ease, filter .15s ease, transform .15s ease !important;
            }
            /* === HUD 取景角标（赛博朋克卡片造型，非辉光，青紫双色）===
             * 单伪元素 ::before + 8 段渐变画四角 L 形线，不占用 clamp 的 ::after。
             * 配色：左上/右下 青(#00e5ff)，右上/左下 紫(#7c6bf0)。 */
            .wk-msg-row:has(.ai-badge) .wk-markdown::before,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown::before,
            .wk-fold-msg-text::before {
                content: "" !important;
                position: absolute !important;
                inset: 0 !important;
                pointer-events: none !important;
                z-index: 3 !important;           /* 盖过 clamp「展开全文」渐变蒙层(::after)，保证四角完整 */
                background-repeat: no-repeat !important;
                background-image:
                    linear-gradient(#00e5ff, #00e5ff), linear-gradient(#00e5ff, #00e5ff),
                    linear-gradient(#7c6bf0, #7c6bf0), linear-gradient(#7c6bf0, #7c6bf0),
                    linear-gradient(#7c6bf0, #7c6bf0), linear-gradient(#7c6bf0, #7c6bf0),
                    linear-gradient(#00e5ff, #00e5ff), linear-gradient(#00e5ff, #00e5ff) !important;
                background-size:
                    11px 2px, 2px 11px, 11px 2px, 2px 11px,
                    11px 2px, 2px 11px, 11px 2px, 2px 11px !important;
                background-position:
                    left top, left top, right top, right top,
                    left bottom, left bottom, right bottom, right bottom !important;
            }

            /* hover：去霓虹辉光，仅保留右移 + 背景微亮（赛博感靠角标，不靠发光） */
            .wk-msg-row:has(.ai-badge) .wk-markdown:hover,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover {
                background: #fbfbff !important;
                transform: translateY(-2px) !important;
                filter: drop-shadow(0 5px 14px rgba(40, 40, 90, 0.16)) !important;
            }

            .wk-msg-row:has(.ai-badge) .wk-markdown p,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown p {
                color: #5a5a72 !important;
                margin: 0.4em 0 !important;
            }
            .wk-msg-row:has(.ai-badge) .wk-markdown a,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown a {
                color: #5b58e8 !important;
                text-decoration: none !important;
            }
            .wk-msg-row:has(.ai-badge) .wk-markdown a:hover,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown a:hover {
                text-decoration: underline !important;
            }
            /* inline code - 淡紫 chip */
            .wk-msg-row:has(.ai-badge) .wk-markdown code,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown code {
                background: #f1efff !important;
                color: #5b50d6 !important;
                border: 1px solid #e3def8 !important;
                padding: 1px 6px !important;
                border-radius: 4px !important;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace !important;
                font-size: 13px !important;
            }
            .wk-msg-row:has(.ai-badge) .wk-markdown strong,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown strong {
                color: #1c1c2b !important;
                font-weight: 600 !important;
            }
            .wk-msg-row:has(.ai-badge) .wk-markdown ul,
            .wk-msg-row:has(.ai-badge) .wk-markdown ol,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown ul,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown ol {
                color: #5a5a72 !important;
            }

            /* ========================================================
             * 自己发送的消息（非 AI）—— 协调绿
             * ====================================================== */
            .wk-msg-row--send:not(:has(.ai-badge)) {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                margin: 4px 12px !important;
                padding: 0 !important;
            }
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown {
                --octo-bg: #fafdfb;
                --octo-accent: #46a877;
                position: relative !important;
                background: #fafdfb !important;
                border: 1px solid #e3ece7 !important;
                border-left: 3px solid #46a877 !important;
                border-radius: 9px !important;
                filter: drop-shadow(0 1px 2px rgba(40, 90, 60, 0.10)) !important;
                padding: 12px 16px !important;
                margin-top: 8px !important;
                box-sizing: border-box !important;
                width: fit-content !important;
                max-width: var(--octo-bubble-max) !important;
                overflow-wrap: anywhere !important;
                transition: background .15s ease, filter .15s ease, transform .15s ease !important;
            }
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover {
                background: #f3faf6 !important;
                transform: translateY(-2px) !important;
                filter: drop-shadow(0 5px 14px rgba(40, 90, 60, 0.16)) !important;
            }
            /* send 绿色卡片同样上 HUD 取景角标（绿 #46a877 + 薄荷 #19c39a 双色，
             * 与 AI 紫青呼应，统一 gamer 造型）。左上/右下薄荷，右上/左下绿。 */
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown::before {
                content: "" !important;
                position: absolute !important;
                inset: 0 !important;
                pointer-events: none !important;
                z-index: 3 !important;
                background-repeat: no-repeat !important;
                background-image:
                    linear-gradient(#19c39a, #19c39a), linear-gradient(#19c39a, #19c39a),
                    linear-gradient(#46a877, #46a877), linear-gradient(#46a877, #46a877),
                    linear-gradient(#46a877, #46a877), linear-gradient(#46a877, #46a877),
                    linear-gradient(#19c39a, #19c39a), linear-gradient(#19c39a, #19c39a) !important;
                background-size:
                    11px 2px, 2px 11px, 11px 2px, 2px 11px,
                    11px 2px, 2px 11px, 11px 2px, 2px 11px !important;
                background-position:
                    left top, left top, right top, right top,
                    left bottom, left bottom, right bottom, right bottom !important;
            }
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-msg-row-sender {
                font-weight: 600 !important;
                color: #2f9163 !important;
            }

            /* ========================================================
             * 接收的普通用户消息（非 AI、非自己）—— 中性 slate 卡片
             * 排除：自己(--send) / AI(.ai-badge) / AI 连续(data-ai-continue)
             * 三档配色统一：AI 紫(+HUD 角标) / 自己 绿 / 他人 中性灰蓝(无 HUD，AI 专属)
             * ====================================================== */
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                margin: 4px 12px !important;
                padding: 0 !important;
            }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown {
                --octo-bg: #ffffff;
                --octo-accent: #8b90a5;
                position: relative !important;
                background: #ffffff !important;
                border: 1px solid #e7e9f2 !important;
                border-left: 3px solid #aab0c2 !important;
                border-radius: 9px !important;
                filter: drop-shadow(0 1px 2px rgba(40, 40, 60, 0.10)) !important;
                padding: 12px 16px !important;
                margin-top: 8px !important;
                box-sizing: border-box !important;
                width: fit-content !important;
                max-width: var(--octo-bubble-max) !important;
                overflow-wrap: anywhere !important;
                color: #4a4a58 !important;
                line-height: 1.65 !important;
                font-size: 14px !important;
                transition: background .15s ease, filter .15s ease, transform .15s ease !important;
            }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown:hover {
                background: #fbfbfd !important;
                transform: translateY(-2px) !important;
                filter: drop-shadow(0 5px 14px rgba(40, 40, 60, 0.16)) !important;
            }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown p { color: #4a4a58 !important; margin: 0.4em 0 !important; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown a { color: #5b58e8 !important; text-decoration: none !important; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown a:hover { text-decoration: underline !important; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown code {
                background: #f2f3f7 !important;
                color: #555a6b !important;
                border: 1px solid #e4e6ee !important;
                padding: 1px 6px !important;
                border-radius: 4px !important;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace !important;
                font-size: 13px !important;
            }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown strong { color: #1c1c2b !important; font-weight: 600 !important; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown > :first-child { margin-top: 0 !important; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown > :last-child { margin-bottom: 0 !important; }

            /* ========================================================
             * 引用/回复消息块（新 .wk-reply-block + 旧 .wk-message-text-reply）统一精修
             * reply 块是 .wk-msg-row 后代但在 .wk-markdown 之外 → 在「行」上设 --octo-accent，
             * 引用块左条即可跟随各类型色：AI 紫 / 自己 绿 / 他人 灰蓝
             * ====================================================== */
            .wk-msg-row:has(.ai-badge),
            .wk-msg-row--continue[data-ai-continue="true"] { --octo-accent: #7c6bf0; }
            .wk-msg-row--send:not(:has(.ai-badge)) { --octo-accent: #46a877; }
            .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) { --octo-accent: #9aa0c2; }

            .wk-msg-row .wk-reply-block,
            .wk-msg-row .wk-message-text-reply {
                background: transparent !important;        /* markdown blockquote 风：去填充底色 */
                border-left: 3px solid var(--octo-accent, #9aa0c2) !important;
                border-radius: 0 !important;
                padding: 1px 0 1px 12px !important;        /* 仅左缩进，紧凑 */
                margin-bottom: 4px !important;
                box-sizing: border-box !important;   /* 防 padding/border 叠到 max-width 之外 → 横向溢出 */
                width: fit-content !important;        /* 缩到内容宽度，不再全宽灰条(与下方气泡观感一致，消除割裂) */
                max-width: var(--octo-bubble-max) !important;
                overflow: hidden !important;
                transition: background .15s ease !important;
            }
            /* 内部可伸缩项允许收缩 + 长摘要/名字单行省略，杜绝横向滚动条 */
            .wk-msg-row .wk-reply-block__content,
            .wk-msg-row .wk-reply-block__name-row {
                min-width: 0 !important;
            }
            .wk-msg-row .wk-reply-block__name,
            .wk-msg-row .wk-reply-block__digest,
            .wk-msg-row .wk-message-text-reply-content {
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                max-width: 100% !important;
                min-width: 0 !important;
            }
            .wk-msg-row .wk-reply-block:hover,
            .wk-msg-row .wk-message-text-reply:hover {
                background: rgba(28, 28, 35, 0.04) !important;
            }
            /* 原内置 2px bar 与新 border-left 重复 → 隐藏 */
            .wk-msg-row .wk-reply-block__bar { display: none !important; }
            .wk-msg-row .wk-reply-block__name,
            .wk-msg-row .wk-message-text-reply-authorname {
                font-weight: 600 !important;
                color: #6b6f86 !important;
            }
            .wk-msg-row .wk-reply-block__digest,
            .wk-msg-row .wk-message-text-reply-content {
                color: #888c9c !important;
            }

            /* ===== 折叠 AI 消息 ===== */
            .wk-fold-msg {
                display: flex !important;
                flex-direction: row !important;
                align-items: flex-start !important;
                gap: 12px !important;            /* 头像↔内容，对齐普通消息 .wk-msg-row */
                padding: 0 16px !important;      /* 左基准 16px，与 .wk-msg-row 一致 */
                margin: 12px 0 0 !important;     /* 去掉原左右 12px margin，避免右偏 */
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
                width: 100% !important;
                max-width: none !important;
                box-sizing: border-box !important;
            }
            .wk-fold-msg-ava {
                display: block !important;
                flex-shrink: 0 !important;
                width: 36px !important;
                height: 36px !important;
                min-width: 36px !important;
                min-height: 36px !important;
                margin-right: 0 !important;      /* 间距交给容器 gap，避免与 gap 叠加成 24px */
                cursor: pointer !important;
                border-radius: 50% !important;
                padding: 0 !important;
                background: #fff !important;          /* 纯白底兜底：透明头像不透出页面底色 */
                box-shadow: none !important;
            }
            .wk-fold-msg-ava img {
                display: block !important;
                width: 36px !important;
                height: 36px !important;
                border-radius: 50% !important;
                object-fit: cover !important;
                border: none !important;
            }
            /* body / head：对齐普通消息 .wk-msg-row-content / -header 的布局 */
            .wk-fold-msg-body {
                flex: 1 !important;
                min-width: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 4px !important;              /* = .wk-msg-row-content gap */
            }
            .wk-fold-msg-head {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;              /* = .wk-msg-row-header gap，统一 名字/时间 间隔 */
                height: 22px !important;          /* = .wk-msg-row-header height */
                line-height: 22px !important;     /* = .wk-msg-row-header line-height，竖直基线对齐 */
                margin-bottom: 0 !important;      /* 间距交给 body 的 gap:4px */
            }
            .wk-fold-msg-name {
                font-weight: 600 !important;
                font-size: 14px !important;       /* 对齐普通消息 .wk-msg-row-sender 的 14px */
                cursor: pointer !important;
                background: linear-gradient(90deg,
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%),
                    hsl(calc(190deg + var(--octo-hue)), 92%, 52%),
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%)) !important;
                background-size: 200% auto !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-fill-color: transparent !important;
                color: transparent !important;
                animation: octo-name-wave 4s linear infinite !important;
                padding: 0 !important;            /* 清除原生 Tag 的 2px 8px padding */
                height: auto !important;          /* 清除原生固定 20px 高 */
                border-radius: 0 !important;
            }
            .wk-fold-msg-name::after {
                content: "AI" !important;
                display: inline-flex !important;
                align-items: center !important;
                margin-left: 8px !important;      /* 对齐普通 header gap:8px（sender↔badge 间距） */
                padding: 3px 10px !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                line-height: 1 !important;         /* 与普通 .ai-badge 一致 */
                box-sizing: content-box !important;
                letter-spacing: 0.5px !important;
                color: #fff !important;
                -webkit-text-fill-color: #fff !important;   /* 父级 text-fill 透明会继承到 ::after，这里强制恢复白字 */
                background: linear-gradient(135deg, #7c6bf0, #5b58e8) !important;
                border-radius: 10px !important;
                border: none !important;
                text-shadow: none !important;
                box-shadow: 0 1px 2px rgba(91, 88, 232, 0.25) !important;
                animation: none !important;
            }
            .wk-fold-msg-time {
                font-size: 11px !important;
                color: #9da0b2 !important;
                margin-left: 0 !important;         /* 间距交给 head 的 gap:8px */
            }
            .wk-fold-msg-text {
                --octo-bg: #ffffff;
                --octo-accent: #7c6bf0;
                position: relative !important;
                background: #ffffff !important;
                border: 1px solid #e7e9f2 !important;
                border-left: 3px solid #5b58e8 !important;
                border-radius: 9px !important;
                filter: drop-shadow(0 1px 2px rgba(40, 40, 90, 0.10)) !important;
                padding: 12px 16px !important;
                margin-top: 8px !important;
                box-sizing: border-box !important;
                width: fit-content !important;
                max-width: var(--octo-bubble-max) !important;
                overflow-wrap: anywhere !important;
                font-size: 14px !important;
                line-height: 1.65 !important;
                color: #5a5a72 !important;
                transition: background .15s ease, filter .15s ease, transform .15s ease !important;
            }
            .wk-fold-msg-text:hover {
                background: #fbfbff !important;
                transform: translateY(-2px) !important;
                filter: drop-shadow(0 5px 14px rgba(40, 40, 90, 0.16)) !important;
            }

            /* ===== HUD 取景角标「锁定」动效：hover 时四角准星「咔」一下内缩锁定 + 极淡青紫霓虹辉光 =====
             * 内缩靠 background-position 向中心偏移(带回弹 cubic-bezier 做出「咔」的过冲)，辉光靠 filter drop-shadow。
             * （基础 ::before 各属性均 !important，keyframe 会被压制，故用 hover 规则 + snappy transition 实现。）*/
            .wk-msg-row:has(.ai-badge) .wk-markdown::before,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown::before,
            .wk-fold-msg-text::before,
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown::before {
                transition: background-position .15s cubic-bezier(.5, -0.4, .3, 1.35), background-size .15s ease, filter .2s ease !important;
            }
            /* 内缩锁定 + 辉光仅用于赛博皮肤：加 body:not([data-octo-skin]) 作用域, 避免 !important 渗进世界杯足球(位移/染青紫光) */
            body:not([data-octo-skin="worldcup"]) .wk-msg-row:has(.ai-badge) .wk-markdown:hover::before,
            body:not([data-octo-skin="worldcup"]) .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover::before,
            body:not([data-octo-skin="worldcup"]) .wk-fold-msg-text:hover::before,
            body:not([data-octo-skin="worldcup"]) .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover::before {
                background-position:
                    left 5px top 5px, left 5px top 5px, right 5px top 5px, right 5px top 5px,
                    left 5px bottom 5px, left 5px bottom 5px, right 5px bottom 5px, right 5px bottom 5px !important;
                filter: drop-shadow(0 0 3px rgba(0, 229, 255, 0.55)) drop-shadow(0 0 5px rgba(124, 107, 240, 0.5)) !important;
            }

            /* 无障碍：系统开启「减弱动态效果」时，关掉位移与角标外扩，仅保留静态背景/阴影变化 */
            @media (prefers-reduced-motion: reduce) {
                .wk-msg-row:has(.ai-badge) .wk-markdown:hover,
                .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover,
                .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover,
                .wk-fold-msg-text:hover {
                    transform: none !important;
                }
                body:not([data-octo-skin="worldcup"]) .wk-msg-row:has(.ai-badge) .wk-markdown:hover::before,
                body:not([data-octo-skin="worldcup"]) .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover::before,
                body:not([data-octo-skin="worldcup"]) .wk-fold-msg-text:hover::before,
                body:not([data-octo-skin="worldcup"]) .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover::before {
                    background-size:
                        11px 2px, 2px 11px, 11px 2px, 2px 11px,
                        11px 2px, 2px 11px, 11px 2px, 2px 11px !important;
                    background-position:
                        left top, left top, right top, right top,
                        left bottom, left bottom, right bottom, right bottom !important;
                    filter: none !important;
                }
            }
            .wk-fold-msg-text p { color: #5a5a72 !important; margin: 0.4em 0 !important; }
            .wk-fold-msg-text a { color: #5b58e8 !important; text-decoration: none !important; }
            .wk-fold-msg-text a:hover { text-decoration: underline !important; }
            .wk-fold-msg-text code {
                background: #f1efff !important;
                color: #5b50d6 !important;
                border: 1px solid #e3def8 !important;
                padding: 1px 6px !important;
                border-radius: 4px !important;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace !important;
                font-size: 13px !important;
            }
            .wk-fold-msg-text strong { color: #1c1c2b !important; font-weight: 600 !important; }
            .wk-fold-msg-text ul,
            .wk-fold-msg-text ol,
            .wk-fold-msg-text li { color: #5a5a72 !important; }

            /* 首/尾子元素去外边距，避免气泡内顶部/底部多出空隙 */
            .wk-msg-row:has(.ai-badge) .wk-markdown > :first-child,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown > :first-child,
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown > :first-child,
            .wk-fold-msg-text > :first-child { margin-top: 0 !important; }
            .wk-msg-row:has(.ai-badge) .wk-markdown > :last-child,
            .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown > :last-child,
            .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown > :last-child,
            .wk-fold-msg-text > :last-child { margin-bottom: 0 !important; }

            /* ========================================================
             * 单条消息限高 + 点击展开（纯 CSS，无 DOM 注入）
             * ====================================================== */
            .wk-markdown.octo-clamp:not(.octo-expanded),
            .wk-fold-msg-text.octo-clamp:not(.octo-expanded) {
                max-height: var(--octo-clamp-h) !important;
                overflow: hidden !important;
                cursor: zoom-in !important;
            }
            .wk-markdown.octo-clamp:not(.octo-expanded)::after,
            .wk-fold-msg-text.octo-clamp:not(.octo-expanded)::after {
                content: "展开全文 ▾" !important;
                position: absolute !important;
                left: 0 !important; right: 0 !important; bottom: 0 !important;
                display: flex !important;
                align-items: flex-end !important;
                justify-content: center !important;
                height: 56px !important;
                padding-bottom: 9px !important;
                font-size: 12px !important;
                font-weight: 600 !important;
                letter-spacing: 0.3px !important;
                color: var(--octo-accent, #5b58e8) !important;
                background: linear-gradient(transparent, var(--octo-bg, #fff) 70%) !important;
                pointer-events: none !important;
                border-radius: 0 0 9px 9px !important;
            }
            .wk-markdown.octo-clamp.octo-expanded,
            .wk-fold-msg-text.octo-clamp.octo-expanded { cursor: zoom-out !important; }

            /* ========================================================
             * Bot 详情弹窗 —— cyber-glass profile 卡片（frontend-design 精修）
             * DOM: .wk-bot-detail-content
             *        > .wk-bot-detail-header (头像 / 名字+AiBadge / @id / [chip])
             *        > .wk-bot-detail-desc ×N (.wk-bot-detail-label + 值)
             *        > .wk-bot-detail-commands / 按钮组
             * 设计：有氛围的 mesh banner + 发光头像环 + 堆叠柔色信息卡 + 强调色按钮 + 入场微动效
             * 纯 CSS 覆盖，不动源码。
             * ====================================================== */
            @keyframes octo-bot-in {
                from { opacity: 0; transform: translateY(10px); }
                to   { opacity: 1; transform: none; }
            }
            /* 扫描带自上而下 sweep（第1层 100%×54px no-repeat）+ tron 网格滚动（第2/3层无缝） */
            @keyframes octo-bot-grid {
                from { background-position: 0 -60px, 0 0, 0 0; }
                to   { background-position: 0 180px, 16px 0, 0 16px; }
            }
            /* CP2077 glitch：每隔几秒一次短促水平抖动 */
            @keyframes octo-glitch {
                0%, 86%, 100% { transform: translate(0, 0); }
                87% { transform: translate(-3px, 0); }
                89% { transform: translate(3px, 0); }
                91% { transform: translate(-2px, 0); }
                93% { transform: translate(0, 0); }
            }
            /* 底部霓虹青横线 + 紫辉光：不规则霓虹管闪烁(flicker)，cyberpunk 质感 */
            @keyframes octo-bot-neon {
                0%, 100% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                4%  { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.28), inset 0 -8px 12px -6px rgba(124, 60, 240, 0.12); }
                7%  { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                9%  { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.40), inset 0 -8px 12px -6px rgba(124, 60, 240, 0.16); }
                11% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                48% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                50% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.35), inset 0 -8px 12px -6px rgba(124, 60, 240, 0.14); }
                52% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                78% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
                80% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.45), inset 0 -8px 12px -6px rgba(124, 60, 240, 0.18); }
                82% { box-shadow: inset 0 -2px 0 0 rgba(0, 224, 255, 0.92), inset 0 -16px 22px -5px rgba(124, 60, 240, 0.44); }
            }

            /* 外壳：大圆角 + 裁切 + 柔和投影 */
            .wk-bot-detail-modal .wk-modal-shell {
                border-radius: 18px !important;
                overflow: hidden !important;
                box-shadow: 0 24px 64px rgba(26, 22, 64, 0.30) !important;
            }
            /* 内容：清顶 padding 给 banner，底部微暖白渐变，入场动效 */
            .wk-bot-detail-content {
                padding: 0 22px 22px !important;
                background: radial-gradient(130% 70% at 50% 0%, #fbfbff 0%, #ffffff 58%) !important;
                animation: octo-bot-in .3s cubic-bezier(.22,.8,.28,1) both !important;
            }

            /* 头部：左对齐，承载 banner */
            .wk-bot-detail-header {
                align-items: flex-start !important;
                position: relative !important;
                padding-top: 132px !important;
                margin-bottom: 6px !important;
            }
            /* banner 主体（浅色 cyberpunk）：淡紫底 + 霓虹青/品红 mesh + 底部霓虹青横线发光 */
            .wk-bot-detail-header::before {
                content: "" !important;
                position: absolute !important;
                top: 0 !important;
                left: -22px !important;
                right: -22px !important;
                height: 120px !important;
                background:
                    radial-gradient(62% 120% at 14% 0%, rgba(0, 220, 255, 0.32) 0%, transparent 56%),
                    radial-gradient(70% 130% at 92% 0%, rgba(255, 70, 210, 0.28) 0%, transparent 58%),
                    linear-gradient(118deg, #e7ecff 0%, #efe8ff 50%, #e0f3ff 100%) !important;
                border-radius: 18px 18px 0 0 !important;
                box-shadow:
                    inset 0 -2px 0 0 rgba(0, 224, 255, 0.60),
                    inset 0 -10px 16px -6px rgba(124, 60, 240, 0.28) !important;
                animation: octo-bot-neon 4s linear infinite, octo-glitch 5.5s linear infinite !important;
                z-index: 0 !important;
            }
            /* banner 霓虹网格（cyberpunk tron grid：竖紫 + 横青细线） */
            .wk-bot-detail-header::after {
                content: "" !important;
                position: absolute !important;
                top: 0 !important;
                left: -22px !important;
                right: -22px !important;
                height: 120px !important;
                background-image:
                    linear-gradient(180deg, transparent 40%, rgba(0, 229, 255, 0.5) 50%, transparent 60%),
                    repeating-linear-gradient(90deg, transparent 0 15px, rgba(124, 92, 240, 0.16) 15px 16px),
                    repeating-linear-gradient(0deg, transparent 0 15px, rgba(0, 196, 240, 0.14) 15px 16px) !important;
                background-size: 100% 54px, auto, auto !important;
                background-repeat: no-repeat, repeat, repeat !important;
                border-radius: 18px 18px 0 0 !important;
                animation: octo-bot-grid 3s linear infinite !important;
                pointer-events: none !important;
                z-index: 0 !important;
            }

            /* 头像：圆形 + 白环 + 品牌紫光晕环 + 浮起投影，压在 banner 底边 */
            .wk-bot-detail-avatar {
                position: relative !important;
                z-index: 1 !important;
                width: 84px !important;
                height: 84px !important;
                margin-top: -50px !important;
                border-radius: 50% !important;
                overflow: hidden !important;
                background: #fff !important;
                box-shadow:
                    0 0 0 4px #fff,
                    0 0 0 5px rgba(124, 107, 240, 0.5),
                    0 10px 24px rgba(40, 30, 90, 0.30) !important;
            }
            /* 头像内部不论 img / semi-image / WKAvatar(.wk-avatar)，统一放大并裁圆
             * (.wk-avatar 原生仅 40px，且 WKAvatar 不消费 size prop → 这里强制撑满父容器) */
            .wk-bot-detail-avatar > *,
            .wk-bot-detail-avatar .wk-avatar,
            .wk-bot-detail-avatar .semi-image,
            .wk-bot-detail-avatar .semi-image-img,
            .wk-bot-detail-avatar img {
                width: 100% !important;
                height: 100% !important;
                border-radius: 50% !important;
                object-fit: cover !important;
            }

            /* 名字 / handle 左对齐 */
            .wk-bot-detail-name {
                margin-top: 14px !important;
                font-size: 21px !important;
                font-weight: 700 !important;
                letter-spacing: 0.2px !important;
                background: linear-gradient(90deg,
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%),
                    hsl(calc(190deg + var(--octo-hue)), 92%, 52%),
                    hsl(calc(248deg + var(--octo-hue)), 78%, 63%)) !important;
                background-size: 200% auto !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-fill-color: transparent !important;
                color: transparent !important;
                animation: octo-name-wave 4s linear infinite !important;
            }
            /* 名字旁 AiBadge 是 flex 子元素：父级 text-fill 透明会继承下去 → 恢复白字，徽章不被流光染 */
            .wk-bot-detail-name .ai-badge {
                -webkit-text-fill-color: #fff !important;
                color: #fff !important;
            }
            .wk-bot-detail-id {
                align-self: flex-start !important;
                margin-top: 3px !important;
                font-size: 13px !important;
                color: #9a9db0 !important;
            }
            .wk-bot-detail-octopush-chip {
                margin-left: 0 !important;
                margin-right: 0 !important;
                margin-top: 10px !important;
            }

            /* 信息字段 → 赛博 HUD 面板：右上切角 + 紫→青霓虹左条（呼应 banner 紫青）+ 浅底可读 */
            .wk-bot-detail-desc,
            .wk-bot-detail-commands {
                position: relative !important;
                border: 1px solid #e2e0f2 !important;
                border-radius: 0 !important;
                background: #f5f5fc !important;
                clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 0 100%) !important;
                padding: 12px 15px !important;
                margin-bottom: 9px !important;
                font-size: 14px !important;
                color: #2e2e44 !important;
            }
            /* 紫→青霓虹左条（呼应 banner，取代 CP2077 黄） */
            .wk-bot-detail-desc::before,
            .wk-bot-detail-commands::before {
                content: "" !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                bottom: 0 !important;
                width: 3px !important;
                background: linear-gradient(180deg, #7c6bf0, #00c4f0) !important;
                box-shadow: 0 0 6px rgba(0, 196, 240, 0.45) !important;
            }
            /* 标签 → 浅紫 chip + 紫等宽字 + // 前缀（右下斜切，轻量 HUD tag，与 banner 同色系） */
            .wk-bot-detail-label {
                display: inline-block !important;
                text-transform: uppercase !important;
                letter-spacing: 1.2px !important;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                color: #5b58e8 !important;
                background: rgba(124, 107, 240, 0.12) !important;
                padding: 2px 9px !important;
                margin-bottom: 8px !important;
                clip-path: polygon(0 0, 100% 0, calc(100% - 6px) 100%, 0 100%) !important;
            }
            .wk-bot-detail-label::before { content: "// " !important; opacity: 0.55 !important; }
            /* 编辑入口 → 赛博青 */
            .wk-bot-detail-edit-action,
            .wk-bot-detail-value-edit {
                color: #1493ad !important;
            }
            /* 空状态 */
            .wk-bot-detail-empty {
                color: #a6a8bd !important;
                font-style: italic !important;
            }
            .wk-bot-detail-cmd-name {
                color: #1493ad !important;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace !important;
            }
            .wk-bot-detail-cmd-desc { color: #6b6f86 !important; }

            /* 底部主按钮（发送消息/聊天）：品牌紫渐变 + 浮起，接住消息气泡同色系。
             * 排除 Bot 管理 / 龙虾两个 light 次级按钮——Semi 默认 type=primary，
             * 否则它们会被套上紫渐变底却保留紫字 → 紫底紫字不可读。 */
            .wk-bot-detail-modal .semi-button-block.semi-button-primary:not(.wk-bot-detail-manage-btn):not(.wk-bot-detail-claw-btn) {
                background: linear-gradient(120deg, #6d5cf0, #5b58e8) !important;
                border: none !important;
                border-radius: 12px !important;
                height: 44px !important;
                font-weight: 600 !important;
                box-shadow: 0 6px 16px rgba(91, 88, 232, 0.35) !important;
                transition: transform .15s ease, box-shadow .15s ease, filter .15s ease !important;
            }
            .wk-bot-detail-modal .semi-button-block.semi-button-primary:not(.wk-bot-detail-manage-btn):not(.wk-bot-detail-claw-btn):hover {
                transform: translateY(-1px) !important;
                box-shadow: 0 9px 22px rgba(91, 88, 232, 0.45) !important;
                filter: brightness(1.05) !important;
            }

            /* 关闭按钮位于浅色 banner 之上 → 深灰，保证可读 */
            .wk-bot-detail-modal .semi-modal-close,
            .wk-bot-detail-modal .semi-modal-close .semi-icon,
            .wk-bot-detail-modal .semi-modal-close svg {
                color: #4a4a5e !important;
                fill: #4a4a5e !important;
            }
            .wk-bot-detail-modal .semi-modal-close:hover {
                background: rgba(74, 74, 94, 0.10) !important;
                border-radius: 8px !important;
            }

            /* 无障碍：减弱动态时关闭 banner 的网格滚动与霓虹脉冲（保留静态 cyber 外观） */
            @media (prefers-reduced-motion: reduce) {
                .wk-bot-detail-header::before,
                .wk-bot-detail-header::after {
                    animation: none !important;
                }
                .wk-bot-detail-content { animation: none !important; }
            }

            /* ========================================================
             * 用户资料卡（UserInfo，.wk-base-modal-userinfo）—— 套用同款 cyber-glass profile
             * DOM: .wk-userinfo > .wk-userinfo-content
             *        > .wk-userinfo-header > .wk-userinfo-user(头像+信息)
             *        > .wk-userinfo-sections > .wk-sections > .wk-section(.wk-section-title/-row)
             *      footer: .wk-userInfo-footer > .wk-userinfo-footer-sendbutton button
             * 注意：.wk-section* 是全 app 共用类，必须 scope 在 .wk-base-modal-userinfo 下。
             * ====================================================== */
            .wk-base-modal-userinfo .wk-modal-shell {
                border-radius: 18px !important;
                overflow: hidden !important;
                box-shadow: 0 24px 64px rgba(26, 22, 64, 0.30) !important;
            }
            .wk-base-modal-userinfo .wk-userinfo {
                background: #ffffff !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-content {
                padding: 0 18px 16px !important;
                overflow-x: hidden !important;
                overflow-y: auto !important;
                background: radial-gradient(130% 60% at 50% 0%, #fbfbff 0%, #ffffff 58%) !important;
                animation: octo-bot-in .3s cubic-bezier(.22,.8,.28,1) both !important;
            }

            /* header：竖排（头像上、名字下），承载 banner */
            .wk-base-modal-userinfo .wk-userinfo-header {
                position: relative !important;
                padding-top: 128px !important;
                margin-bottom: 6px !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-user {
                flex-direction: column !important;
                align-items: flex-start !important;
            }
            /* banner 主体（同款浅色 cyberpunk + 霓虹脉冲） */
            .wk-base-modal-userinfo .wk-userinfo-header::before {
                content: "" !important;
                position: absolute !important;
                top: 0 !important;
                left: -18px !important;
                right: -18px !important;
                height: 120px !important;
                background:
                    radial-gradient(62% 120% at 14% 0%, rgba(0, 220, 255, 0.32) 0%, transparent 56%),
                    radial-gradient(70% 130% at 92% 0%, rgba(255, 70, 210, 0.28) 0%, transparent 58%),
                    linear-gradient(118deg, #e7ecff 0%, #efe8ff 50%, #e0f3ff 100%) !important;
                border-radius: 18px 18px 0 0 !important;
                box-shadow:
                    inset 0 -2px 0 0 rgba(0, 224, 255, 0.60),
                    inset 0 -10px 16px -6px rgba(124, 60, 240, 0.28) !important;
                animation: octo-bot-neon 4s linear infinite, octo-glitch 5.5s linear infinite !important;
                z-index: 0 !important;
            }
            /* banner tron 网格滚动 */
            .wk-base-modal-userinfo .wk-userinfo-header::after {
                content: "" !important;
                position: absolute !important;
                top: 0 !important;
                left: -18px !important;
                right: -18px !important;
                height: 120px !important;
                background-image:
                    linear-gradient(180deg, transparent 40%, rgba(0, 229, 255, 0.5) 50%, transparent 60%),
                    repeating-linear-gradient(90deg, transparent 0 15px, rgba(124, 92, 240, 0.16) 15px 16px),
                    repeating-linear-gradient(0deg, transparent 0 15px, rgba(0, 196, 240, 0.14) 15px 16px) !important;
                background-size: 100% 54px, auto, auto !important;
                background-repeat: no-repeat, repeat, repeat !important;
                border-radius: 18px 18px 0 0 !important;
                animation: octo-bot-grid 3s linear infinite !important;
                pointer-events: none !important;
                z-index: 0 !important;
            }

            /* 头像：圆形 + 白环 + 紫光环，压在 banner 底边（取消原 margin-left/40% 圆角/灰底） */
            .wk-base-modal-userinfo .wk-userinfo-user-avatar {
                position: relative !important;
                z-index: 1 !important;
                width: 84px !important;
                height: 84px !important;
                margin: -50px 0 0 0 !important;
                border-radius: 50% !important;
                overflow: hidden !important;
                background: #fff !important;
                box-shadow:
                    0 0 0 4px #fff,
                    0 0 0 5px rgba(124, 107, 240, 0.5),
                    0 10px 24px rgba(40, 30, 90, 0.30) !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-user-avatar > *,
            .wk-base-modal-userinfo .wk-userinfo-user-avatar .wk-avatar,
            .wk-base-modal-userinfo .wk-userinfo-user-avatar img {
                width: 100% !important;
                height: 100% !important;
                border-radius: 50% !important;
                object-fit: cover !important;
            }

            /* 名字 / 信息左对齐 */
            .wk-base-modal-userinfo .wk-userinfo-user-info {
                margin-left: 0 !important;
                margin-top: 12px !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-user-info-name {
                font-size: 21px !important;
                font-weight: 700 !important;
                color: #1b1a2e !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-user-info-others li {
                color: #9094a8 !important;
            }

            /* sections → 堆叠柔色卡片（仅在用户资料卡内生效，不污染全局 .wk-section） */
            .wk-base-modal-userinfo .wk-userinfo-sections {
                margin-top: 8px !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-section {
                border: 1px solid #ecebf5 !important;
                border-radius: 12px !important;
                background: #f7f7fc !important;
                padding: 6px !important;
                margin-bottom: 8px !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-section-title {
                font-size: 11.5px !important;
                font-weight: 600 !important;
                color: #9094a8 !important;
                padding: 4px 8px !important;
            }

            /* 可编辑行(.wk-list-item) hover 优化：柔和圆角紫高亮，替代全宽直角 #eee 灰块 */
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item {
                background-color: transparent !important;
                border-radius: 8px !important;
                transition: background-color .15s ease !important;
            }
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item:not(.wk-list-item-static):hover {
                background-color: rgba(124, 107, 240, 0.12) !important;
            }
            /* 非交互行（进群方式等）不高亮 */
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item-static,
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item-static:hover {
                background-color: transparent !important;
            }
            /* 可编辑行标题转品牌紫，强化「可点」暗示（静态行标题保持默认） */
            .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item:not(.wk-list-item-static) .wk-list-item-title {
                color: #5b58e8 !important;
            }

            /* footer 发送按钮 → 品牌紫渐变 */
            .wk-base-modal-userinfo .wk-userinfo-footer-sendbutton button {
                background: linear-gradient(120deg, #6d5cf0, #5b58e8) !important;
                border: none !important;
                border-radius: 12px !important;
                color: #fff !important;
                font-weight: 600 !important;
                box-shadow: 0 6px 16px rgba(91, 88, 232, 0.35) !important;
            }

            /* 关闭按钮 × → 深灰（浅 banner 上可读） */
            .wk-base-modal-userinfo .semi-modal-close,
            .wk-base-modal-userinfo .semi-modal-close .semi-icon,
            .wk-base-modal-userinfo .semi-modal-close svg {
                color: #4a4a5e !important;
                fill: #4a4a5e !important;
            }

            /* RoutePage 顶栏「秃头」修复：把灰色 56px 空导航条变透明并浮到 banner 上，
             * 内容上移铺满（--wk-height-route-header→0），× 移到右上角并改深灰。
             * 严格 scope 在 .wk-base-modal-userinfo 内（.wk-route* 全 app 共用，不可全局改）。 */
            .wk-base-modal-userinfo .wk-route {
                position: relative !important;
                --wk-height-route-header: 0px !important;
            }
            .wk-base-modal-userinfo .wk-route-header {
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                height: 48px !important;
                padding: 0 !important;
                background: transparent !important;
                z-index: 5 !important;
                pointer-events: none !important;
            }
            .wk-base-modal-userinfo .wk-route-header-close {
                position: absolute !important;
                top: 4px !important;
                right: 10px !important;
                pointer-events: auto !important;
            }
            .wk-base-modal-userinfo .wk-route-header-close:hover {
                background-color: rgba(74, 74, 94, 0.12) !important;
            }
            /* × 由两条 background-color bar 组成 → 浅 banner 上改深灰可读 */
            .wk-base-modal-userinfo .wk-route-header-close-icon,
            .wk-base-modal-userinfo .wk-route-header-close-icon::before,
            .wk-base-modal-userinfo .wk-route-header-close-icon::after {
                background-color: #4a4a5e !important;
            }

            @media (prefers-reduced-motion: reduce) {
                .wk-base-modal-userinfo .wk-userinfo-header::before,
                .wk-base-modal-userinfo .wk-userinfo-header::after,
                .wk-base-modal-userinfo .wk-userinfo-content {
                    animation: none !important;
                }
            }

            /* =====================================================================
             * 主题切换按钮 —— 作为 NavRail 底部图标项注入到「语言切换」正上方，与原生导航项融为一体。
             * 复用 .wk-navrail__item 原生样式(56×44/透明底/hover 变色)，图标用 emoji(🌙/☀️)。
             * =================================================================== */
            #octo-theme-toggle { -webkit-appearance: none !important; appearance: none !important; }
            #octo-theme-toggle .octo-tt-ico {
                font-size: 17px !important;
                line-height: 1 !important;
                font-style: normal !important;
            }

            /* 主题选择弹出菜单（fixed 注入 body，锚定按钮右侧；暗色玻璃卡，亮/暗主题下均清晰） */
            #octo-theme-menu {
                position: fixed !important;
                z-index: 2147483600 !important;
                min-width: 188px !important;
                padding: 6px !important;
                background: #1b1830 !important;
                border: 1px solid rgba(124, 107, 240, 0.30) !important;
                border-radius: 12px !important;
                box-shadow: 0 12px 34px rgba(0, 0, 0, 0.40) !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 2px !important;
                font-size: 13px !important;
                -webkit-font-smoothing: antialiased !important;
            }
            #octo-theme-menu .octo-theme-menu__item {
                display: flex !important;
                align-items: center !important;
                gap: 10px !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 8px 10px !important;
                background: transparent !important;
                border: none !important;
                border-radius: 8px !important;
                color: #e7e8f1 !important;
                cursor: pointer !important;
                text-align: left !important;
                font: inherit !important;
                line-height: 1.2 !important;
                -webkit-appearance: none !important;
                appearance: none !important;
            }
            #octo-theme-menu .octo-theme-menu__item:hover { background: rgba(124, 107, 240, 0.22) !important; }
            #octo-theme-menu .octo-theme-menu__item.is-active { background: rgba(124, 107, 240, 0.16) !important; }
            #octo-theme-menu .octo-theme-menu__ico {
                font-size: 15px !important;
                line-height: 1 !important;
                width: 18px !important;
                text-align: center !important;
                font-style: normal !important;
            }
            #octo-theme-menu .octo-theme-menu__label { flex: 1 1 auto !important; white-space: nowrap !important; }
            #octo-theme-menu .octo-theme-menu__check {
                width: 12px !important;
                text-align: center !important;
                color: #9b8cff !important;
                font-weight: 700 !important;
            }

            /* =====================================================================
             * 暗色主题变体 —— 统一 scope 在 body[theme-mode="dark"] 下（与原生暗色同一开关）。
             * 原生界面(侧栏/会话/聊天区/输入框)由 app 自带 dark CSS 接管；以下把脚本钉死的
             * 浅色面翻暗。霓虹紫/青/绿强调色保留（暗底上更亮）。每条选择器复刻原浅色规则并加
             * body[theme-mode=dark] 前缀 → 特异性更高，覆盖原 !important 浅色值。
             * =================================================================== */

            /* ---- 修补原生暗色「遗漏的共享语义令牌」----
             * app 的 semantic.css 暗色段(body[theme-mode=dark]) 漏定义了下列颜色令牌，
             * 它们在 light :root 是近黑值(如 --wk-text-strong: rgba(28,28,35,.9))，
             * 暗底上保持近黑 → 左侧会话列表名字/图标「啥都看不见」。这里补上可读暗色值。
             * 全 app 共享令牌 → 同时修好其它用到它们的原生界面（导航/列表/标题等）。
             * （只补暗底文字/图标可见性，未动 --wk-brand-primary 等强调底色，避免误改全局观感。） */
            body[theme-mode="dark"] {
                --wk-text-strong: rgba(238, 240, 247, 0.95) !important;   /* 列表名字 .wk-conv-compact-name */
                --wk-icon-default: rgba(228, 230, 237, 0.62) !important;
                --wk-icon-muted: rgba(228, 230, 237, 0.40) !important;
                --wk-bg-item-hover: rgba(255, 255, 255, 0.06) !important;
                /* 幻影 bg 令牌：组件用 --wk-bg-*（如 webhook 卡 var(--wk-bg-primary,#fff)），但全工作区无定义
                 * （App.css 暗色变量叫 --bg-*，命名错配）→ 暗底上走 #fff 浅色兜底 = 白卡片。这里补暗色值。 */
                --wk-bg-primary: #1d1b29 !important;       /* 卡片/主表面 (webhook 卡等) */
                --wk-bg-secondary: #16151f !important;
                --wk-bg-tertiary: rgba(255, 255, 255, 0.06) !important;  /* 内层/图标底 */
                --wk-warning-bg: rgba(250, 173, 20, 0.15) !important;
                --wk-bg-tab: rgba(255, 255, 255, 0.05) !important;       /* 关注/最近 tab 轨道底（原浅色不可见）*/
                /* --wk-brand-primary 在 light 是 brand-black(黑)，暗色段漏改 → 用它当文字色的地方(如聊天
                 * header 频道名 .wk-chat-conversation-header-channel-info-name)黑字压暗底=隐形。改品牌紫，
                 * 文字可读、作主按钮/选中底色也 on-brand。 */
                --wk-brand-primary: #8b7cf0 !important;
                /* brand-tint 系列在 light 是 rgba(28,28,35,X)（近黑叠加，用于 hover/选中/边框等 subtle 面），
                 * 暗色段零覆盖 → 暗底上黑叠加全不可见（选中会话无高亮、header 底边线消失）。重映射为白 alpha。 */
                --wk-brand-tint-03: rgba(255, 255, 255, 0.03) !important;
                --wk-brand-tint-04: rgba(255, 255, 255, 0.04) !important;
                --wk-brand-tint-06: rgba(255, 255, 255, 0.06) !important;
                --wk-brand-tint-08: rgba(255, 255, 255, 0.08) !important;
                --wk-brand-tint-10: rgba(255, 255, 255, 0.10) !important;
                --wk-brand-tint-12: rgba(255, 255, 255, 0.12) !important;
                --wk-brand-tint-15: rgba(255, 255, 255, 0.15) !important;
                --wk-brand-tint-35: rgba(255, 255, 255, 0.32) !important;
                /* 整体配色优化：原生暗色是接近纯黑的中性灰、偏平。重映射核心表面为「微紫冷调 + 清晰层次」
                 * （deep < base < surface < elevated），呼应赛博紫主题，面与面之间有可辨识的层级。 */
                --wk-bg-deep: #0d0c13 !important;       /* 最底层：NavRail / 页面底 */
                --wk-bg-base: #131119 !important;       /* 主背景：列表 / 聊天区 */
                --wk-bg-surface: #191722 !important;    /* 面板：header / 输入框 / 卡片底 */
                --wk-bg-elevated: #201d2c !important;   /* 抬升层：tag / 系统消息 / 悬浮 */
            }

            /* ---- 关注/最近 tab：选中态原为纯白胶囊 var(--wk-color-white) → 暗底刺眼且浅字不可见，改紫选中态 ---- */
            body[theme-mode="dark"] .wk-sidebar-tabbar__btn--active {
                background: rgba(124, 107, 240, 0.25) !important;
            }
            /* ---- 选中会话高亮：原 .wk-conv-compact-item--selected 用 brand-tint-06，重映射后=白6%，会与 hover 撞
             * → 单独覆盖成醒目紫，明确区分「选中(紫)」vs「hover(中性白)」---- */
            body[theme-mode="dark"] .wk-conv-compact-item--selected {
                background: rgba(124, 107, 240, 0.26) !important;
            }
            /* ---- 底部输入框：原边框/引用条用硬编码近黑/浅色，暗底上边框消失、引用条变亮斑 → 修正 ---- */
            body[theme-mode="dark"] .wk-messageinput-card {
                background: var(--wk-bg-elevated) !important;   /* footer 内抬升的输入面，与 footer 区分 */
                border-color: rgba(255, 255, 255, 0.10) !important;
            }
            body[theme-mode="dark"] .wk-messageinput-card:focus-within {
                border-color: rgba(124, 107, 240, 0.65) !important;
            }
            body[theme-mode="dark"] .wk-replyview-new {
                background-color: rgba(255, 255, 255, 0.06) !important;
                border-color: rgba(255, 255, 255, 0.10) !important;
            }
            body[theme-mode="dark"] .wk-replyview-new-divider {
                background-color: rgba(255, 255, 255, 0.14) !important;
            }
            /* ---- 聊天三块底色统一：内容区原用 --wk-color-secondary-2(中性灰)与 header(微紫 surface)不搭。
             * 统一为「header=surface(顶部 chrome)、内容+footer=base(连续无色带)」，输入卡 elevated 浮于其上 ---- */
            body[theme-mode="dark"] .wk-conversation-content {
                background-color: var(--wk-bg-base) !important;
            }
            body[theme-mode="dark"] .wk-conversation-footer {
                background-color: var(--wk-bg-base) !important;
            }
            /* ---- 弹窗遮罩：Semi 用 --semi-color-overlay-bg(=brand-tint-35)，而 tint-35 被重映射为白(供
             * Mergeforward 文字等用)，导致遮罩变白纱把背景冲灰 → 单独把弹窗 scrim 覆盖成深色压暗 ---- */
            body[theme-mode="dark"] .wk-modal {
                --semi-color-overlay-bg: rgba(5, 4, 12, 0.6) !important;
            }
            /* ---- 消息时间：原生 .wk-msg-row-timestamp 用 rgba(28,28,35,.4) 近黑，暗底隐形(仅 AI 那档被脚本
             * 覆盖过 → 人类/自己档看不见)。统一覆盖为可读浅灰，与 AI 档一致 ---- */
            body[theme-mode="dark"] .wk-msg-row-timestamp,
            body[theme-mode="dark"] .wk-msg-row-timestamp-hover {
                color: #9da0b2 !important;
            }
            /* ---- 系统消息：历史分割线「以上为历史消息」(原文字/线均 rgba(9,30,66,..)近黑→暗底隐形) ---- */
            body[theme-mode="dark"] .wk-message-split-content {
                color: #9da0b2 !important;
            }
            body[theme-mode="dark"] .wk-message-split-line1 {
                background-image: linear-gradient(360deg, transparent, rgba(255, 255, 255, 0.16)) !important;
            }
            body[theme-mode="dark"] .wk-message-split-line2 {
                background-image: linear-gradient(360deg, rgba(255, 255, 255, 0.16), transparent) !important;
            }
            /* ---- 子区创建卡 .wk-thread-created-card(原卡底/左条/正文/参与者均近黑→暗底隐形) ---- */
            body[theme-mode="dark"] .wk-thread-created-card {
                background: rgba(255, 255, 255, 0.05) !important;
                border-left-color: #7c6bf0 !important;
            }
            body[theme-mode="dark"] .wk-thread-created-card:hover {
                background: rgba(255, 255, 255, 0.08) !important;
            }
            body[theme-mode="dark"] .wk-thread-created-preview {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-thread-created-link {
                color: #9b8cff !important;
            }
            body[theme-mode="dark"] .wk-thread-created-participants {
                color: #9da0b2 !important;
            }
            /* ---- 文件消息 .wk-message-file(原卡底/hover 近黑叠加、文件名/大小/扩展名/操作用近黑或 --wk-color-theme(#1C1C23)→暗底隐形) ---- */
            body[theme-mode="dark"] .wk-message-file {
                background: rgba(255, 255, 255, 0.05) !important;
            }
            body[theme-mode="dark"] .wk-message-file--clickable:hover {
                background: rgba(255, 255, 255, 0.08) !important;
            }
            body[theme-mode="dark"] .wk-message-file--clickable:active {
                background: rgba(255, 255, 255, 0.12) !important;
            }
            body[theme-mode="dark"] .wk-message-file--active {
                border-color: #7c6bf0 !important;
            }
            body[theme-mode="dark"] .wk-message-file-name {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-message-file-meta {
                color: #9da0b2 !important;
            }
            body[theme-mode="dark"] .wk-message-file-ext,
            body[theme-mode="dark"] .wk-message-file-action {
                color: #9b8cff !important;
            }
            /* 「自己发送」的文件消息(绿系)：扩展名/操作转绿，与发送气泡同色 */
            body[theme-mode="dark"] .wk-message-base-bubble-box.send .wk-message-file-ext,
            body[theme-mode="dark"] .wk-message-base-bubble-box.send .wk-message-file-action {
                color: #54cf90 !important;
            }
            /* ---- @提及 mention（TextContent 版 .mention-*：原 #6B3DD8 深紫 + 淡紫 chip，暗底太暗不明显）→ 提亮 ---- */
            body[theme-mode="dark"] .mention-highlight,
            body[theme-mode="dark"] .mention-fallback {
                color: #b39bff !important;
            }
            body[theme-mode="dark"] .mention-entity {
                color: #c2b3ff !important;
                background-color: rgba(124, 107, 240, 0.22) !important;
            }
            body[theme-mode="dark"] .mention-entity:hover {
                background-color: rgba(124, 107, 240, 0.32) !important;
            }
            /* ---- 合并转发卡片 .wk-mf-card(原卡底/边框/标题/预览/分割线/底标签均近黑→暗底隐形) ---- */
            body[theme-mode="dark"] .wk-mf-card {
                background: rgba(255, 255, 255, 0.05) !important;
                border-color: rgba(255, 255, 255, 0.10) !important;
            }
            body[theme-mode="dark"] .wk-mf-card:hover {
                background: rgba(255, 255, 255, 0.08) !important;
            }
            body[theme-mode="dark"] .wk-mf-card__title {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-mf-card__item {
                color: #b6b9cc !important;
            }
            body[theme-mode="dark"] .wk-mf-card__divider {
                background: rgba(255, 255, 255, 0.10) !important;
            }
            body[theme-mode="dark"] .wk-mf-card__footer {
                color: #9da0b2 !important;
            }
            /* ---- WKModal 弹窗底面板压暗：className 落在 Semi 内容上(.wk-modal)，但白底来自 Semi 的
             * .semi-modal-content/.semi-modal-body，靠 --semi-color-bg 令牌没压住 → 直接显式压暗。
             * 通用到所有 .wk-modal(自定义内容的 bot/用户卡有自己暗底覆盖其上，无害)，一次修好转发等弹窗发白。 */
            body[theme-mode="dark"] .wk-modal,
            body[theme-mode="dark"] .wk-modal.semi-modal-content,
            body[theme-mode="dark"] .wk-modal .semi-modal-content,
            body[theme-mode="dark"] .wk-modal .semi-modal-body,
            body[theme-mode="dark"] .wk-modal .wk-modal-content,
            body[theme-mode="dark"] .wk-modal .wk-modal-shell,
            body[theme-mode="dark"] .wk-modal .wk-modal-body {
                background-color: var(--wk-bg-surface) !important;
            }
            /* ---- 转发消息列表内容(MergeforwardMessageList)：名字/时间/正文近黑→暗底隐形 ---- */
            body[theme-mode="dark"] .wk-mergeforwardmessagelist-content-msg-info-first-name {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-mergeforwardmessagelist-content-msg-info-first-time {
                color: #9da0b2 !important;
            }
            body[theme-mode="dark"] .wk-mergeforwardmessagelist-content-msg-info-second-msgcontent {
                color: #cfd0e0 !important;
            }
            /* ---- 转发里的文件 .wk-mergeforward-file(卡底/文件名/大小近黑→隐形) ---- */
            body[theme-mode="dark"] .wk-mergeforward-file {
                background: rgba(255, 255, 255, 0.05) !important;
            }
            body[theme-mode="dark"] .wk-mergeforward-file--clickable:hover {
                background: rgba(255, 255, 255, 0.08) !important;
            }
            body[theme-mode="dark"] .wk-mergeforward-file__name {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-mergeforward-file__size {
                color: #9da0b2 !important;
            }
            /* ---- 输入框 @mention token：原 .wk-messageinput-editor .mention 用 --wk-color-theme(#1C1C23 近黑)→暗底不可读 ---- */
            body[theme-mode="dark"] .wk-messageinput-editor .mention {
                color: #b39bff !important;
            }
            /* 输入框内引用预览文字(原 #333/#555 暗底不可读) */
            body[theme-mode="dark"] .wk-replyview-new-content { color: #cfd0e0 !important; }
            body[theme-mode="dark"] .wk-replyview-new-text { color: #9da0b2 !important; }
            /* ---- @补全下拉 选中/hover 项：原 bg --wk-color-theme(近黑) + 文字 --wk-text-inverse(暗色下也是深色)→深字压深底 ---- */
            body[theme-mode="dark"] .mention-list.mention-list--mouse .mention-list-item:hover,
            body[theme-mode="dark"] .mention-list.mention-list--keyboard .mention-list-item.is-selected {
                background-color: #7c6bf0 !important;
                color: #fff !important;
            }
            body[theme-mode="dark"] .mention-list.mention-list--mouse .mention-list-item:hover .mention-list-item-space,
            body[theme-mode="dark"] .mention-list.mention-list--keyboard .mention-list-item.is-selected .mention-list-item-space {
                color: rgba(255, 255, 255, 0.85) !important;
            }
            /* ---- 折叠/文本消息正文：链路 TextContent → .wk-msg-text-content > MarkdownContent(.wk-markdown)。
             * .wk-markdown 的 p 无自身 color(继承父级即可)，但 blockquote 用 --semi-color-text-1(secondary 灰)、
             * 标题用 text-0；折叠(.wk-fold-msg-text)又不在 .wk-msg-row 下，AI 规则够不着 → 暗底发灰。
             * 统一把这两类容器内正文(含 blockquote/标题/段落/列表)强制提亮(code/链接/mention 各自色保留)。 */
            body[theme-mode="dark"] .wk-msg-text-content,
            body[theme-mode="dark"] .wk-fold-msg-text,
            body[theme-mode="dark"] .wk-msg-text-content .wk-markdown,
            body[theme-mode="dark"] .wk-fold-msg-text .wk-markdown,
            body[theme-mode="dark"] .wk-msg-text-content .wk-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
            body[theme-mode="dark"] .wk-fold-msg-text .wk-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) {
                color: #e7e8f1 !important;
            }
            /* ---- 聊天 header 会话标题：原 color:var(--wk-brand-primary) 暗底偏暗 → 改清晰浅色（私聊/群聊同此类）---- */
            body[theme-mode="dark"] .wk-chat-conversation-header-channel-info-name {
                color: #eef0f6 !important;
            }

            /* ---- 隐藏 Bot 资料卡的「Bot 管理」「🦞 查看龙虾信息」按钮（两个主题都隐藏，非暗色专属）---- */
            .wk-bot-detail-manage-btn,
            .wk-bot-detail-claw-btn {
                display: none !important;
            }

            /* ---- AI 消息气泡 ---- */
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown {
                background: #1b1830 !important;
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown:hover,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover {
                background: #221d3a !important;
            }
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown p,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown p,
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown ul,
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown ol,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown ul,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown ol {
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown a,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown a {
                color: #9b8cff !important;
            }
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown code,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown code {
                background: #2a2545 !important;
                color: #b7abff !important;
            }
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown strong,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown strong {
                color: #f1f0fa !important;
            }

            /* ---- 自己发送(绿) ---- */
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown {
                background: #15211b !important;
                color: #cdd6d0 !important;
            }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown p { color: #cdd6d0 !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover { background: #1c2a22 !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-msg-row-sender { color: #54cf90 !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown a { color: #7fd9ac !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown code { background: #22302a !important; color: #7fd9ac !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown strong { color: #eaf3ee !important; }

            /* ---- 他人(中性 slate) ---- */
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown {
                background: #1a1c24 !important;
                color: #c6c8d4 !important;
            }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown:hover { background: #212430 !important; }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown p { color: #c6c8d4 !important; }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown a { color: #9b8cff !important; }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown code { background: #262833 !important; color: #bcbfce !important; }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown strong { color: #eef0f6 !important; }

            /* ---- 暗底收敛：浅灰外框 + 实色 HUD 角标在暗底上会变刺眼霓虹框 → 调暗/降透明 ---- */
            /* 外框转暗调细线，保留彩色 border-left 作身份强调（只覆盖上/右/下三边） */
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown {
                border-top-color: rgba(124, 107, 240, 0.20) !important;
                border-right-color: rgba(124, 107, 240, 0.20) !important;
                border-bottom-color: rgba(124, 107, 240, 0.20) !important;
            }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown {
                border-top-color: rgba(70, 168, 119, 0.22) !important;
                border-right-color: rgba(70, 168, 119, 0.22) !important;
                border-bottom-color: rgba(70, 168, 119, 0.22) !important;
            }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown {
                border-top-color: rgba(255, 255, 255, 0.08) !important;
                border-right-color: rgba(255, 255, 255, 0.08) !important;
                border-bottom-color: rgba(255, 255, 255, 0.08) !important;
            }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown code {
                border-color: rgba(255, 255, 255, 0.08) !important;
            }
            /* HUD 取景角标整体降透明：保留赛博角标轮廓，但暗底上不刺眼 */
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown::before,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown::before,
            body[theme-mode="dark"] .wk-fold-msg-text::before,
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown::before {
                opacity: 0.5 !important;
            }
            /* clamp「展开全文」渐隐蒙层 fade-to 颜色跟随暗底（否则长消息底部露白）。
             * 蒙层用 var(--octo-bg)，此处把各气泡的 --octo-bg 改成对应暗底即可。 */
            body[theme-mode="dark"] .wk-msg-row:has(.ai-badge) .wk-markdown,
            body[theme-mode="dark"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown { --octo-bg: #1b1830 !important; }
            body[theme-mode="dark"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown { --octo-bg: #15211b !important; }
            body[theme-mode="dark"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown { --octo-bg: #1a1c24 !important; }

            /* ---- 消息正文通用子元素兜底（标题/引用/列表/表格在暗底上保持可读）---- */
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h1,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h2,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h3,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h4,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h5,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown h6,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown blockquote,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown li,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown td,
            body[theme-mode="dark"] .wk-msg-row .wk-markdown th {
                color: #d4d5e2 !important;
            }
            body[theme-mode="dark"] .wk-msg-row .wk-markdown pre { background: #15131f !important; }

            /* ---- 折叠 AI 消息 ---- */
            body[theme-mode="dark"] .wk-fold-msg-text {
                background: #1b1830 !important;
                --octo-bg: #1b1830 !important;
                border-top-color: rgba(124, 107, 240, 0.20) !important;
                border-right-color: rgba(124, 107, 240, 0.20) !important;
                border-bottom-color: rgba(124, 107, 240, 0.20) !important;
                color: #e7e8f1 !important;
            }
            body[theme-mode="dark"] .wk-fold-msg-text:hover { background: #221d3a !important; }

            /* ---- 引用/回复块（markdown blockquote 风：无填充，仅左竖条）---- */
            body[theme-mode="dark"] .wk-msg-row .wk-reply-block,
            body[theme-mode="dark"] .wk-msg-row .wk-message-text-reply {
                background: transparent !important;
            }
            body[theme-mode="dark"] .wk-msg-row .wk-reply-block:hover,
            body[theme-mode="dark"] .wk-msg-row .wk-message-text-reply:hover {
                background: rgba(255, 255, 255, 0.045) !important;
            }
            body[theme-mode="dark"] .wk-msg-row .wk-reply-block__name,
            body[theme-mode="dark"] .wk-msg-row .wk-message-text-reply-authorname {
                color: #b9bccd !important;
            }
            body[theme-mode="dark"] .wk-msg-row .wk-reply-block__digest,
            body[theme-mode="dark"] .wk-msg-row .wk-message-text-reply-content {
                color: #9296a8 !important;
            }

            /* ---- Bot 资料卡 ---- */
            body[theme-mode="dark"] .wk-bot-detail-content {
                background: radial-gradient(130% 70% at 50% 0%, #1a1733 0%, #121022 58%) !important;
            }
            body[theme-mode="dark"] .wk-bot-detail-header::before {
                background:
                    radial-gradient(62% 120% at 14% 0%, rgba(0, 220, 255, 0.32) 0%, transparent 56%),
                    radial-gradient(70% 130% at 92% 0%, rgba(255, 70, 210, 0.28) 0%, transparent 58%),
                    linear-gradient(118deg, #161430 0%, #1a1535 50%, #101a2e 100%) !important;
            }
            body[theme-mode="dark"] .wk-bot-detail-desc,
            body[theme-mode="dark"] .wk-bot-detail-commands {
                background: #211d38 !important;
                border-color: rgba(124, 107, 240, 0.24) !important;
                color: #d4d5e4 !important;
            }
            body[theme-mode="dark"] .wk-bot-detail-label {
                color: #a99cff !important;
                background: rgba(124, 107, 240, 0.16) !important;
            }
            body[theme-mode="dark"] .wk-bot-detail-cmd-desc { color: #a4a7ba !important; }
            body[theme-mode="dark"] .wk-bot-detail-empty { color: #8a8da1 !important; }
            body[theme-mode="dark"] .wk-bot-detail-modal .semi-modal-close,
            body[theme-mode="dark"] .wk-bot-detail-modal .semi-modal-close .semi-icon,
            body[theme-mode="dark"] .wk-bot-detail-modal .semi-modal-close svg {
                color: #c9ccda !important;
                fill: #c9ccda !important;
            }
            body[theme-mode="dark"] .wk-bot-detail-modal .semi-modal-close:hover {
                background: rgba(255, 255, 255, 0.12) !important;
            }

            /* ---- 用户资料卡 ---- */
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo { background: #121022 !important; }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-content {
                background: radial-gradient(130% 60% at 50% 0%, #1a1733 0%, #121022 58%) !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-header::before {
                background:
                    radial-gradient(62% 120% at 14% 0%, rgba(0, 220, 255, 0.32) 0%, transparent 56%),
                    radial-gradient(70% 130% at 92% 0%, rgba(255, 70, 210, 0.28) 0%, transparent 58%),
                    linear-gradient(118deg, #161430 0%, #1a1535 50%, #101a2e 100%) !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-user-info-name { color: #f0f0f8 !important; }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-user-info-others li { color: #9498ac !important; }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-sections .wk-section {
                background: #211d38 !important;
                border-color: rgba(124, 107, 240, 0.16) !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-sections .wk-section-title { color: #9296ab !important; }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item:not(.wk-list-item-static):hover {
                background-color: rgba(124, 107, 240, 0.18) !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-userinfo-sections .wk-list-item:not(.wk-list-item-static) .wk-list-item-title {
                color: #a99cff !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .semi-modal-close,
            body[theme-mode="dark"] .wk-base-modal-userinfo .semi-modal-close .semi-icon,
            body[theme-mode="dark"] .wk-base-modal-userinfo .semi-modal-close svg {
                color: #c9ccda !important;
                fill: #c9ccda !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-route-header-close-icon,
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-route-header-close-icon::before,
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-route-header-close-icon::after {
                background-color: #c9ccda !important;
            }
            body[theme-mode="dark"] .wk-base-modal-userinfo .wk-route-header-close:hover {
                background-color: rgba(255, 255, 255, 0.12) !important;
            }

            /* =====================================================================
             * 美加墨世界杯皮肤（body[data-octo-skin="worldcup"]）—— 体育画报 / 转播质感（浅色）
             *   palette  近白卡 #ffffff→#fdfbf7 + 暖墨字 #181818；三档=主办国珠宝深调身份：
             *            自己 Old Glory 深红 #C8102E / 他人 墨西哥松绿 #0B6E4F / AI 美队深藏蓝 #13294B
             *            金 = #C6A04A / #ECCB6E，作金底线 / AI 左轨金 trim / 名字铭牌 / 徽章金箔
             *   signature 右下角经典足球(::before, 静止淡角标, hover 踢球进球)坐同色「角落聚光」色晕
             *            + 金色底边线；近白卡 + 柔和景深阴影(浮起感) + 4px 珠宝色左轨；引用块=球门造型
             *   type     AI/Bot 名字=金箔铭牌：字距 +0.04em + 金属金流光（--octo-hue 每帧重绘）
             * 仅重塑「消息相关面」，侧栏/会话跟随浅色 base；worldcup 选择器带 body[attr] 覆盖基础 light。
             * =================================================================== */
            body[data-octo-skin="worldcup"] {
                /* 经典足球 SVG（navy 描边 + 填充五边形）；透明度交给 ::before 控制，以便 hover 踢球动画 */
                --octo-ball: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Cg%20fill='%2313294b'%20stroke='%2313294b'%20stroke-width='2'%20stroke-linejoin='round'%3E%3Ccircle%20cx='32'%20cy='32'%20r='29'%20fill='none'/%3E%3Cpolygon%20points='32,21%2040.6,27.2%2037.3,37.4%2026.7,37.4%2023.4,27.2'/%3E%3Cg%20fill='none'%3E%3Cpath%20d='M32%2021V7'/%3E%3Cpath%20d='M40.6%2027.2L53.4%2022.8'/%3E%3Cpath%20d='M37.3%2037.4L45.5%2050.6'/%3E%3Cpath%20d='M26.7%2037.4L18.5%2050.6'/%3E%3Cpath%20d='M23.4%2027.2L10.6%2022.8'/%3E%3C/g%3E%3Cpolygon%20points='32,4%2042,8%2040.6,18.5%2023.4,18.5%2022,8'/%3E%3Cpolygon%20points='55,20%2059,31%2050,38%2042.5,28.5%2049,21'/%3E%3Cpolygon%20points='47,52%2036,57%2031,47%2040,40%2049,45'/%3E%3Cpolygon%20points='17,52%205,45%2014,40%2023,47%2018,57'/%3E%3Cpolygon%20points='9,20%2015,21%2021.5,28.5%2014,38%205,31'/%3E%3C/g%3E%3C/svg%3E");
                /* 装饰层：仅金色底边线（足球移到 ::before 以便缓静 + hover 踢球动画） */
                --octo-deco:
                    linear-gradient(rgba(198,160,74,0.6), rgba(198,160,74,0.6)) no-repeat left bottom / 100% 1px;
            }

            /* ================= 世界杯：聊天区背景（随所选射门风格切换，浅暖纸基底 + 可见点缀） =================
             * 背景直接铺在 .wk-conversation-content（消息容器不滚动的包裹层）；渐变用视口比例(vw/vh/%)尺寸，
             * 才能在真实的大聊天区可见（小盒子预览里够大、放大后被稀释是之前看不清的原因）。
             * 同时给滚动层 .wk-conversation-messages 关掉横向滚动，杜绝底部横向滚动条。 */
            body[data-octo-skin="worldcup"] .wk-conversation-messages {
                overflow-x: hidden !important;   /* 消息永远不需要横向滚动 → 去掉底部横向滚动条 */
            }
            body[data-octo-skin="worldcup"] .wk-conversation-content {
                background-color: #f7f3ea !important;   /* 暖纸基底兜底 */
                background-repeat: no-repeat !important;
            }

            /* 1) 闪电：青蓝网格 + 紫青大辉光 + 两道斜电弧（视口比例，明显可见） */
            body[data-octo-skin="worldcup"][data-octo-kick-style="lightning"] .wk-conversation-content {
                background-image:
                    linear-gradient(118deg, transparent 0 38%, rgba(70,160,255,.28) 39% 39.8%, transparent 41%),
                    linear-gradient(118deg, transparent 0 60%, rgba(124,107,240,.22) 61% 61.7%, transparent 63%),
                    radial-gradient(70vw 60vh at 8% -10%, rgba(70,160,255,.20), transparent 70%),
                    radial-gradient(70vw 60vh at 100% 110%, rgba(124,107,240,.18), transparent 70%),
                    linear-gradient(rgba(70,150,240,.09) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(70,150,240,.09) 1px, transparent 1px) !important;
                background-size: 100% 100%, 100% 100%, 100% 100%, 100% 100%, 32px 32px, 32px 32px !important;
            }
            /* 2) 火焰：底部大片暖橙火光 + 上缘暖光 */
            body[data-octo-skin="worldcup"][data-octo-kick-style="fire"] .wk-conversation-content {
                background-image:
                    radial-gradient(120vw 45vh at 50% 118%, rgba(255,120,20,.34), transparent 72%),
                    radial-gradient(60vw 40vh at 15% 112%, rgba(255,70,10,.26), transparent 74%),
                    radial-gradient(60vw 40vh at 88% 112%, rgba(255,180,60,.24), transparent 74%),
                    radial-gradient(90vw 30vh at 50% -12%, rgba(255,190,110,.14), transparent 70%) !important;
                background-size: 100% 100% !important;
            }
            /* 3) 子弹时间：冷蓝顶光 + 斜向速度线（明显） */
            body[data-octo-skin="worldcup"][data-octo-kick-style="bullet"] .wk-conversation-content {
                background-image:
                    repeating-linear-gradient(108deg, rgba(70,110,160,.10) 0 2px, transparent 2px 22px),
                    radial-gradient(90vw 55vh at 60% -10%, rgba(80,120,170,.22), transparent 72%),
                    linear-gradient(180deg, rgba(200,215,235,.35), transparent 45%) !important;
                background-size: 100% 100%, 100% 100%, 100% 100% !important;
            }
            /* 4) 彗星：紫色大辉光 + 一道明显光轨 + 星点 */
            body[data-octo-skin="worldcup"][data-octo-kick-style="comet"] .wk-conversation-content {
                background-image:
                    linear-gradient(122deg, transparent 0 52%, rgba(150,110,255,.42) 53% 54%, transparent 56%),
                    radial-gradient(3px 3px at 20% 24%, rgba(150,110,255,.6), transparent),
                    radial-gradient(2px 2px at 42% 60%, rgba(120,90,220,.5), transparent),
                    radial-gradient(3px 3px at 74% 30%, rgba(170,130,255,.6), transparent),
                    radial-gradient(2px 2px at 88% 66%, rgba(150,110,255,.5), transparent),
                    radial-gradient(80vw 60vh at 82% -8%, rgba(150,110,255,.26), transparent 70%),
                    radial-gradient(70vw 55vh at 6% 108%, rgba(120,90,220,.20), transparent 72%) !important;
                background-size: 100% 100%, 200px 200px, 200px 200px, 200px 200px, 200px 200px, 100% 100%, 100% 100% !important;
            }
            /* 5) 重炮：右下大冲击放射 + 深红大辉光 */
            body[data-octo-skin="worldcup"][data-octo-kick-style="cannon"] .wk-conversation-content {
                background-image:
                    repeating-conic-gradient(from 0deg at 88% 82%, rgba(210,40,50,.10) 0 5deg, transparent 5deg 10deg),
                    radial-gradient(40vw 40vw at 88% 82%, rgba(230,50,50,.28), transparent 55%),
                    radial-gradient(80vw 60vh at 12% -10%, rgba(180,25,35,.16), transparent 72%) !important;
                background-size: 100% 100% !important;
            }
            /* 公共：近白卡 + 柔和景深(替代基础 drop-shadow) + 圆角 + 过渡(含 box-shadow)
             * 底部留一条独立地面带给足球/球门（它们已在正文下方单独一行），左右保持正常内边距 */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text {
                filter: none !important;
                border-radius: 12px !important;
                min-width: 100px !important;
                /* 上 12 / 左右 16(正常) / 下 40(足球+球门的地面带) */
                padding: 12px 16px 40px 16px !important;
                transition: background .15s ease, box-shadow .15s ease, transform .15s ease !important;
            }
            /* 折叠气泡的内边距同样让路（选择器特异性单列一条，确保覆盖其原始 padding） */
            body[data-octo-skin="worldcup"] .wk-fold-msg-text { padding: 12px 16px 40px 16px !important; }
            /* 名字金属流光：限定金/琥珀色相小幅摆动(每帧变色才会在 background-clip:text 下重绘) */
            @keyframes octo-name-wc {
                0%   { --octo-hue: 0deg;  background-position: 0% center; }
                50%  { --octo-hue: 14deg; }
                100% { --octo-hue: 0deg;  background-position: -200% center; }
            }

            /* ---- 三档 accent → 主办国珠宝深调（驱动左条 / 引用块条等）---- */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge),
            body[data-octo-skin="worldcup"] .wk-msg-row--continue[data-ai-continue="true"] { --octo-accent: #13294B !important; }
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) { --octo-accent: #C8102E !important; }
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) { --octo-accent: #0B6E4F !important; }

            /* ---- AI 气泡（含连续）+ 折叠气泡：近白卡 + 藏蓝左轨 + 金内嵌 trim + 角落足球聚光 ---- */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text {
                --octo-bg: #ffffff !important;
                --octo-accent: #13294B !important;
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(19,41,75,0.13) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                border: 1px solid #EAE3D6 !important;
                border-left: 4px solid #13294B !important;
                box-shadow: inset 5px 0 0 -3px rgba(198,160,74,0.75), 0 1px 2px rgba(30,30,50,0.07), 0 8px 20px rgba(30,30,50,0.06) !important;
                color: #181818 !important;
            }
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-markdown:hover,
            body[data-octo-skin="worldcup"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown:hover,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text:hover {
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(19,41,75,0.18) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                transform: translateY(-2px) !important;
                box-shadow: inset 5px 0 0 -3px rgba(198,160,74,0.9), 0 4px 12px rgba(19,41,75,0.16), 0 16px 34px rgba(19,41,75,0.16) !important;
            }

            /* ---- 自己发送：Old Glory 深红 + 角落足球聚光 ---- */
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown {
                --octo-bg: #ffffff !important;
                --octo-accent: #C8102E !important;
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(200,16,46,0.12) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                border: 1px solid #EFDDD9 !important;
                border-left: 4px solid #C8102E !important;
                box-shadow: 0 1px 2px rgba(30,30,50,0.07), 0 8px 20px rgba(30,30,50,0.06) !important;
                color: #181818 !important;
            }
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown:hover {
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(200,16,46,0.17) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 12px rgba(200,16,46,0.15), 0 16px 34px rgba(200,16,46,0.14) !important;
            }
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-msg-row-sender { color: #C8102E !important; letter-spacing: 0.02em !important; }

            /* ---- 他人：墨西哥松绿 + 角落足球聚光 ---- */
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown {
                --octo-bg: #ffffff !important;
                --octo-accent: #0B6E4F !important;
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(11,110,79,0.12) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                border: 1px solid #DCE8E1 !important;
                border-left: 4px solid #0B6E4F !important;
                box-shadow: 0 1px 2px rgba(30,30,50,0.07), 0 8px 20px rgba(30,30,50,0.06) !important;
                color: #181818 !important;
            }
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown:hover {
                background:
                    var(--octo-deco),
                    radial-gradient(70% 70% at 100% 100%, rgba(11,110,79,0.17) 0%, transparent 62%),
                    linear-gradient(180deg, #ffffff 0%, #fdfbf7 100%) !important;
                transform: translateY(-2px) !important;
                box-shadow: 0 4px 12px rgba(11,110,79,0.15), 0 16px 34px rgba(11,110,79,0.14) !important;
            }
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-msg-row-sender { color: #0B6E4F !important; letter-spacing: 0.02em !important; }

            /* ================= 世界杯角落足球：真实 DOM 节点 + 5 款可选射门 =================
             * 伪元素 ::before 角标作废；.octo-wc-ball 静止在左下角，右侧 .octo-wc-goal 为球门。
             * hover 时 JS 给 host 打 data-octo-kick="<style>" 并设 --octo-go(飞行距离)，
             * 由下面对应的 @keyframes 播放；额外的拖尾/残影/冲击波是 .octo-wc-ball-fx 节点。 */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-markdown::before,
            body[data-octo-skin="worldcup"] .wk-msg-row--continue[data-ai-continue="true"] .wk-markdown::before,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text::before,
            body[data-octo-skin="worldcup"] .wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown::before,
            body[data-octo-skin="worldcup"] .wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown::before {
                display: none !important;
            }
            body[data-octo-skin="worldcup"] .octo-wc-ball {
                position: absolute !important;
                left: 12px !important;
                bottom: 8px !important;
                width: 26px !important; height: 26px !important;
                background: var(--octo-ball) center / contain no-repeat !important;
                opacity: 0.16 !important;
                pointer-events: none !important;
                z-index: 3 !important;
                transform-origin: 50% 50% !important;
                will-change: transform, opacity, filter !important;
                transition: opacity .2s ease !important;
            }
            body[data-octo-skin="worldcup"] .octo-wc-ball.octo-wc-live { opacity: 1 !important; }
            /* 球门（右下角球网） */
            body[data-octo-skin="worldcup"] .octo-wc-goal {
                position: absolute !important;
                right: 8px !important; bottom: 8px !important;
                width: 26px !important; height: 40px !important;
                border: 2px solid rgba(19,41,75,.32) !important; border-right: none !important;
                border-radius: 3px 0 0 3px !important;
                background:
                    repeating-linear-gradient(45deg,  transparent 0 5px, rgba(19,41,75,.06) 5px 5.6px),
                    repeating-linear-gradient(-45deg, transparent 0 5px, rgba(19,41,75,.06) 5px 5.6px) !important;
                transform-origin: 100% 50% !important;
                pointer-events: none !important;
                z-index: 2 !important;
            }
            body[data-octo-skin="worldcup"] .octo-wc-goal.octo-shake { animation: octo-goal-shake .5s ease-out !important; }
            @keyframes octo-goal-shake {
                0%{transform:scaleY(1) skewX(0)} 25%{transform:scaleY(1.12) skewX(-3deg)}
                55%{transform:scaleY(.95) skewX(1.5deg)} 100%{transform:scaleY(1) skewX(0)}
            }
            /* 重炮：气泡整体轻微抖屏 */
            body[data-octo-skin="worldcup"] .octo-boom { animation: octo-screen-shake .4s ease-out .30s !important; }
            @keyframes octo-screen-shake {
                0%,100%{transform:translate(0,0)} 20%{transform:translate(-3px,2px)}
                40%{transform:translate(3px,-2px)} 60%{transform:translate(-2px,-1px)} 80%{transform:translate(2px,1px)}
            }
            /* 收起态(长消息 clamp 未展开)：藏球与球门，避免与「展开全文」蒙层重叠 */
            body[data-octo-skin="worldcup"] .wk-markdown.octo-clamp:not(.octo-expanded) .octo-wc-ball,
            body[data-octo-skin="worldcup"] .wk-markdown.octo-clamp:not(.octo-expanded) .octo-wc-goal,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text.octo-clamp:not(.octo-expanded) .octo-wc-ball,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text.octo-clamp:not(.octo-expanded) .octo-wc-goal {
                display: none !important;
            }
            /* fx 节点通用 */
            body[data-octo-skin="worldcup"] .octo-wc-ball-fx {
                position: absolute !important; pointer-events: none !important; z-index: 2 !important; opacity: 0;
            }

            /* ===== 1) 闪电爆射 ===== */
            body[data-octo-skin="worldcup"] [data-octo-kick="lightning"] .octo-wc-ball.octo-wc-live {
                animation: octo-kick-lightning .62s cubic-bezier(.16,.9,.3,1) !important;
            }
            @keyframes octo-kick-lightning {
                0%   { transform: translate(0,0) rotate(0) scaleX(1); }
                12%  { transform: translate(-8px,0) rotate(-18deg) scaleX(1.15) scaleY(.85); }
                45%  { transform: translate(var(--octo-go,240px),-10px) rotate(540deg); filter: drop-shadow(-14px 0 0 rgba(120,200,255,.6)) drop-shadow(-26px 0 0 rgba(120,200,255,.25)); }
                70%  { transform: translate(var(--octo-go,240px),0) rotate(760deg) scaleX(.7) scaleY(1.25); filter: drop-shadow(0 0 16px rgba(150,220,255,1)); }
                100% { transform: translate(var(--octo-go,240px),0) rotate(820deg); opacity: 0; filter: none; }
            }
            body[data-octo-skin="worldcup"] .octo-fx-bolt {
                bottom: 20px !important; left: 26px !important; height: 3px !important; width: 0 !important; border-radius: 2px !important;
                background: linear-gradient(90deg, transparent, #7fd3ff, #eaf6ff) !important;
                filter: drop-shadow(0 0 6px #7fd3ff) !important;
                animation: octo-fx-bolt .62s linear !important;
            }
            @keyframes octo-fx-bolt {
                0%,10%{width:0;opacity:0} 14%{width:0;opacity:1} 46%{width:var(--octo-go,240px);opacity:.9}
                60%{opacity:.9} 100%{width:var(--octo-go,240px);opacity:0}
            }

            /* ===== 2) 火焰弹道 ===== */
            body[data-octo-skin="worldcup"] [data-octo-kick="fire"] .octo-wc-ball.octo-wc-live {
                animation: octo-kick-fire .7s cubic-bezier(.2,.85,.3,1) !important;
            }
            @keyframes octo-kick-fire {
                0%   { transform: translate(0,0) rotate(0); }
                14%  { transform: translate(-7px,2px) rotate(-14deg) scale(.92); }
                55%  { transform: translate(var(--octo-go,240px),-8px) rotate(680deg); filter: drop-shadow(0 0 10px #ff8a2b) drop-shadow(0 0 20px #ff3d00); }
                75%  { transform: translate(var(--octo-go,240px),0) rotate(760deg) scaleX(.72) scaleY(1.25); filter: drop-shadow(0 0 22px #ffb347); }
                100% { transform: translate(var(--octo-go,240px),0) rotate(800deg); opacity:0; }
            }
            body[data-octo-skin="worldcup"] .octo-fx-flame {
                bottom: 10px !important; left: 22px !important; width: 26px !important; height: 26px !important; border-radius: 50% !important;
                background: radial-gradient(circle, rgba(255,255,255,.13) 0%, #ffb347 30%, #ff5722 60%, transparent 72%) !important;
                filter: blur(2px) !important;
                animation: octo-fx-flame .7s linear !important;
            }
            @keyframes octo-fx-flame {
                0%,12%{transform:translateX(0) scale(.6);opacity:0}
                18%{opacity:.9}
                55%{transform:translateX(calc(var(--octo-go,240px) - 10px)) scale(1.1);opacity:.85}
                100%{transform:translateX(var(--octo-go,240px)) scale(.4);opacity:0}
            }

            /* ===== 3) 子弹时间（残影分身） ===== */
            body[data-octo-skin="worldcup"] [data-octo-kick="bullet"] .octo-wc-ball.octo-wc-live {
                animation: octo-kick-bullet .95s cubic-bezier(.7,0,.2,1) !important;
            }
            @keyframes octo-kick-bullet {
                0%   { transform: translate(0,0) rotate(0) scale(1); }
                35%  { transform: translate(6px,-2px) rotate(60deg) scale(1.05); }
                42%  { transform: translate(-6px,0) rotate(40deg) scaleX(1.2) scaleY(.8); }
                72%  { transform: translate(var(--octo-go,240px),-6px) rotate(900deg); }
                88%  { transform: translate(var(--octo-go,240px),0) rotate(980deg) scaleX(.7) scaleY(1.25); }
                100% { transform: translate(var(--octo-go,240px),0) rotate(1020deg); opacity:0; }
            }
            body[data-octo-skin="worldcup"] .octo-fx-ghost {
                left: 12px !important; bottom: 8px !important; width: 26px !important; height: 26px !important;
                background: var(--octo-ball) center / contain no-repeat !important;
                animation: octo-fx-ghost .95s cubic-bezier(.7,0,.2,1) !important;
            }
            body[data-octo-skin="worldcup"] .octo-fx-ghost2 { animation-delay: .04s !important; }
            body[data-octo-skin="worldcup"] .octo-fx-ghost3 { animation-delay: .08s !important; }
            @keyframes octo-fx-ghost {
                0%,42%{transform:translate(0,0);opacity:0}
                58%{opacity:.32}
                72%{transform:translate(var(--octo-go,240px),-6px);opacity:.26}
                100%{transform:translate(var(--octo-go,240px),0);opacity:0}
            }

            /* ===== 4) 彗星光轨 ===== */
            body[data-octo-skin="worldcup"] [data-octo-kick="comet"] .octo-wc-ball.octo-wc-live {
                animation: octo-kick-comet .8s cubic-bezier(.25,.8,.3,1) !important;
            }
            @keyframes octo-kick-comet {
                0%   { transform: translate(0,0) rotate(0); filter: none; }
                16%  { transform: translate(-6px,0) rotate(-10deg) scale(.95); }
                60%  { transform: translate(var(--octo-go,240px),-12px) rotate(620deg); filter: drop-shadow(0 0 10px #b388ff) drop-shadow(0 0 18px #7c4dff); }
                100% { transform: translate(var(--octo-go,240px),0) rotate(740deg); filter: drop-shadow(0 0 6px #b388ff); opacity: 0; }
            }
            body[data-octo-skin="worldcup"] .octo-fx-trail {
                bottom: 19px !important; left: 24px !important; height: 8px !important; width: 0 !important; border-radius: 8px !important;
                background: linear-gradient(90deg, transparent, rgba(124,77,255,.15), rgba(179,136,255,.7), #ffffff) !important;
                filter: blur(1px) !important;
                animation: octo-fx-trail .8s cubic-bezier(.25,.8,.3,1) !important;
            }
            @keyframes octo-fx-trail {
                0%,14%{width:0;opacity:0}
                24%{opacity:.9}
                60%{width:calc(var(--octo-go,240px) - 6px);transform:translateY(-12px);opacity:.9}
                100%{width:calc(var(--octo-go,240px) - 6px);transform:translateY(0);opacity:0}
            }

            /* ===== 5) 重炮轰门（冲击波） ===== */
            body[data-octo-skin="worldcup"] [data-octo-kick="cannon"] .octo-wc-ball.octo-wc-live {
                animation: octo-kick-cannon .58s cubic-bezier(.12,.95,.35,1) !important;
            }
            @keyframes octo-kick-cannon {
                0%   { transform: translate(0,0) rotate(0); }
                16%  { transform: translate(-10px,1px) rotate(-22deg) scaleX(1.2) scaleY(.8); }
                44%  { transform: translate(var(--octo-go,240px),-6px) rotate(560deg) scaleX(1.1); }
                64%  { transform: translate(var(--octo-go,240px),0) rotate(720deg) scaleX(.6) scaleY(1.4); }
                100% { transform: translate(var(--octo-go,240px),0) rotate(760deg); opacity:0; }
            }
            body[data-octo-skin="worldcup"] .octo-fx-shock {
                right: 12px !important; bottom: 12px !important; width: 10px !important; height: 10px !important; border-radius: 50% !important;
                border: 2px solid rgba(200,16,46,.7) !important;
                animation: octo-fx-shock .58s ease-out .34s !important;
            }
            @keyframes octo-fx-shock {
                0%{transform:scale(.2);opacity:.9} 100%{transform:scale(6);opacity:0}
            }

            @media (prefers-reduced-motion: reduce) {
                body[data-octo-skin="worldcup"] .octo-wc-ball,
                body[data-octo-skin="worldcup"] .octo-wc-ball-fx,
                body[data-octo-skin="worldcup"] .octo-wc-goal { animation: none !important; }
            }

            /* ---- 正文 / 段落 / 列表：暖纸上暖墨字 ---- */
            body[data-octo-skin="worldcup"] .wk-msg-text-content,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text,
            body[data-octo-skin="worldcup"] .wk-markdown,
            body[data-octo-skin="worldcup"] .wk-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6),
            body[data-octo-skin="worldcup"] .wk-fold-msg-text :is(p, li, blockquote, h1, h2, h3, h4, h5, h6) {
                color: #1C1B19 !important;
            }
            /* 链接藏蓝、行内代码暖纸 chip */
            body[data-octo-skin="worldcup"] .wk-markdown a,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text a { color: #13294B !important; }
            body[data-octo-skin="worldcup"] .wk-markdown code,
            body[data-octo-skin="worldcup"] .wk-fold-msg-text code {
                background: rgba(28, 27, 25, 0.05) !important;
                color: #1C1B19 !important;
                border: 1px solid rgba(28, 27, 25, 0.10) !important;
            }

            /* ---- AI/Bot 名字：金箔铭牌（字距 + 金属金流光；--octo-hue 每帧变色才会重绘）---- */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-msg-row-sender,
            body[data-octo-skin="worldcup"] .wk-fold-msg-name,
            body[data-octo-skin="worldcup"] .wk-bot-detail-name {
                letter-spacing: 0.04em !important;
                background: linear-gradient(95deg,
                    hsl(calc(40deg + var(--octo-hue)), 58%, 38%),
                    hsl(calc(45deg + var(--octo-hue)), 72%, 64%),
                    hsl(calc(40deg + var(--octo-hue)), 58%, 38%)) !important;
                background-size: 200% auto !important;
                -webkit-background-clip: text !important;
                background-clip: text !important;
                -webkit-text-fill-color: transparent !important;
                color: transparent !important;
                animation: octo-name-wc 4s linear infinite !important;
            }
            @media (prefers-reduced-motion: reduce) {
                body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .wk-msg-row-sender,
                body[data-octo-skin="worldcup"] .wk-fold-msg-name,
                body[data-octo-skin="worldcup"] .wk-bot-detail-name { animation: none !important; }
            }
            /* ---- AI 徽章：金箔（带高光内嵌，含折叠名 ::after 徽章、bot 卡徽章）---- */
            body[data-octo-skin="worldcup"] .wk-msg-row:has(.ai-badge) .ai-badge,
            body[data-octo-skin="worldcup"] .wk-bot-detail-name .ai-badge {
                background: linear-gradient(160deg, #E8C56B 0%, #B68A2E 55%, #9A6E2E 100%) !important;
                color: #2A2206 !important;
                -webkit-text-fill-color: #2A2206 !important;   /* 覆盖基础规则的 #fff，否则金底白字糊 */
                box-shadow: inset 0 1px 0 rgba(255, 244, 214, 0.6), 0 1px 2px rgba(120, 90, 20, 0.35) !important;
            }
            body[data-octo-skin="worldcup"] .wk-fold-msg-name::after {
                background: linear-gradient(160deg, #E8C56B 0%, #B68A2E 55%, #9A6E2E 100%) !important;
                color: #2A2206 !important;
                -webkit-text-fill-color: #2A2206 !important;
            }

            /* ---- 引用块 → 球门：accent 门框(横梁+门柱) + 淡菱形网；hover 踢球时球门网抖动(进球入网)联动 ---- */
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-reply-block,
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-message-text-reply {
                border-left: 2px solid var(--octo-accent, #13294B) !important;
                border-right: 2px solid var(--octo-accent, #13294B) !important;
                border-top: 3px solid var(--octo-accent, #13294B) !important;
                border-radius: 4px 4px 0 0 !important;
                padding: 7px 12px 6px 12px !important;
                margin-bottom: 5px !important;
                background:
                    repeating-linear-gradient(45deg,  transparent 0 6px, rgba(20, 25, 40, 0.05) 6px 6.8px),
                    repeating-linear-gradient(-45deg, transparent 0 6px, rgba(20, 25, 40, 0.05) 6px 6.8px) !important; /* 菱形球门网 */
                transform-origin: 50% 0 !important;   /* 横梁固定, 网往下鼓 */
            }
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-reply-block__name,
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-message-text-reply-authorname { color: #1C1B19 !important; }
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-reply-block__digest,
            body[data-octo-skin="worldcup"] .wk-msg-row .wk-message-text-reply-content { color: #6E675A !important; }
            /* hover 踢球 → 球门网抖动(球落地入网)；延迟 ~1.0s 与球落地(82% of 1.25s)同步 */
            body[data-octo-skin="worldcup"] .wk-markdown:hover .wk-reply-block,
            body[data-octo-skin="worldcup"] .wk-markdown:hover .wk-message-text-reply {
                animation: octo-net-ripple 0.55s ease-out 1.0s 1 !important;
            }
            @keyframes octo-net-ripple {
                0%   { transform: scaleY(1)    skewX(0deg); }
                28%  { transform: scaleY(1.10) skewX(-2deg); }
                55%  { transform: scaleY(0.97) skewX(1.2deg); }
                78%  { transform: scaleY(1.03) skewX(-0.6deg); }
                100% { transform: scaleY(1)    skewX(0deg); }
            }
            @media (prefers-reduced-motion: reduce) {
                body[data-octo-skin="worldcup"] .wk-markdown:hover .wk-reply-block,
                body[data-octo-skin="worldcup"] .wk-markdown:hover .wk-message-text-reply { animation: none !important; }
            }

            body[data-octo-messi-watermark="true"] .wk-conversation-content::after {
                content: "";
                position: absolute;
                right: clamp(20px, 2.4vw, 40px);
                bottom: 22px;
                width: clamp(96px, 8vw, 140px);
                aspect-ratio: 374 / 900;
                background: var(--octo-messi-watermark-image) center bottom / contain no-repeat;
                filter: drop-shadow(0 8px 12px rgba(19, 41, 75, 0.18));
                opacity: 1;
                pointer-events: none;
                z-index: 3;
            }

            /* =====================================================================
             * 全站配色（body[data-octo-global-theme]）—— 独立于消息主题。
             * 消息主题仍由 body[theme-mode] / body[data-octo-skin] 控制；这里只覆盖
             * 导航、会话列表、聊天 chrome、输入区、弹层等外层 UI。
             * =================================================================== */
            body[data-octo-global-theme="cyber-light"] {
                --octo-global-page: #f4f5f8;
                --octo-global-ink: #1f2329;
                --octo-global-muted: #687182;
                --octo-global-soft: #8a93a6;
                --octo-global-line: #dfe3ea;
                --octo-global-rail: #eef0f5;
                --octo-global-side: #fbfcff;
                --octo-global-main: #f7f8fc;
                --octo-global-panel: #ffffff;
                --octo-global-panel-2: #f8f9fe;
                --octo-global-accent: #6d63e8;
                --octo-global-accent-2: #12b8d8;
                --octo-global-selected: rgba(109, 99, 232, 0.12);
                --octo-global-selected-strong: rgba(109, 99, 232, 0.20);
                --octo-global-hover: rgba(31, 35, 41, 0.05);
                --octo-global-shadow: 0 2px 10px rgba(27, 35, 58, 0.08);
            }
            body[data-octo-global-theme="cyber-dark"] {
                --octo-global-page: #0d0c13;
                --octo-global-ink: #eef0f7;
                --octo-global-muted: #a8adbc;
                --octo-global-soft: #7f8494;
                --octo-global-line: rgba(255, 255, 255, 0.10);
                --octo-global-rail: #111019;
                --octo-global-side: #15131d;
                --octo-global-main: #131119;
                --octo-global-panel: #1c1926;
                --octo-global-panel-2: #201d2c;
                --octo-global-accent: #8b7cf0;
                --octo-global-accent-2: #2fd2ea;
                --octo-global-selected: rgba(139, 124, 240, 0.18);
                --octo-global-selected-strong: rgba(139, 124, 240, 0.28);
                --octo-global-hover: rgba(255, 255, 255, 0.06);
                --octo-global-shadow: 0 3px 14px rgba(0, 0, 0, 0.24);
            }
            body[data-octo-global-theme="mist"] {
                --octo-global-page: #f3f6f7;
                --octo-global-ink: #1f2a2d;
                --octo-global-muted: #627077;
                --octo-global-soft: #87939a;
                --octo-global-line: #dce5e6;
                --octo-global-rail: #eaf0f1;
                --octo-global-side: #fbfdfd;
                --octo-global-main: #f6faf9;
                --octo-global-panel: #ffffff;
                --octo-global-panel-2: #f5f9f8;
                --octo-global-accent: #417d88;
                --octo-global-accent-2: #8d75de;
                --octo-global-selected: rgba(65, 125, 136, 0.13);
                --octo-global-selected-strong: rgba(65, 125, 136, 0.22);
                --octo-global-hover: rgba(31, 42, 45, 0.05);
                --octo-global-shadow: 0 2px 10px rgba(33, 62, 66, 0.08);
            }
            body[data-octo-global-theme="worldcup"] {
                --octo-global-page: #efe5d4;
                --octo-global-ink: #1c1b19;
                --octo-global-muted: #6e675a;
                --octo-global-soft: #9a8f7d;
                --octo-global-line: #e1d5c2;
                --octo-global-rail: #e9decf;
                --octo-global-side: #fbf7ef;
                --octo-global-main: #f7f3ea;
                --octo-global-panel: #fffdf8;
                --octo-global-panel-2: #f8efe2;
                --octo-global-accent: #13294B;
                --octo-global-accent-2: #C6A04A;
                --octo-global-selected: rgba(19, 41, 75, 0.10);
                --octo-global-selected-strong: rgba(19, 41, 75, 0.16);
                --octo-global-hover: rgba(28, 27, 25, 0.055);
                --octo-global-shadow: 0 3px 12px rgba(70, 48, 20, 0.09);
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) {
                --wk-text-strong: var(--octo-global-ink) !important;
                --wk-text-secondary: var(--octo-global-muted) !important;
                --wk-text-tertiary: var(--octo-global-soft) !important;
                --wk-icon-default: color-mix(in srgb, var(--octo-global-ink) 62%, transparent) !important;
                --wk-icon-muted: color-mix(in srgb, var(--octo-global-ink) 40%, transparent) !important;
                --wk-bg-deep: var(--octo-global-rail) !important;
                --wk-bg-base: var(--octo-global-main) !important;
                --wk-bg-surface: var(--octo-global-panel) !important;
                --wk-bg-elevated: var(--octo-global-panel-2) !important;
                --wk-bg-primary: var(--octo-global-panel) !important;
                --wk-bg-secondary: var(--octo-global-main) !important;
                --wk-bg-tertiary: var(--octo-global-panel-2) !important;
                --wk-bg-item-hover: var(--octo-global-hover) !important;
                --wk-bg-tab: var(--octo-global-hover) !important;
                --wk-brand-primary: var(--octo-global-accent) !important;
                --wk-brand-tint-06: var(--octo-global-selected) !important;
                --wk-brand-tint-08: var(--octo-global-selected) !important;
                --wk-brand-tint-10: var(--octo-global-selected-strong) !important;
            }

            body[data-octo-global-theme]:not([data-octo-global-theme="none"]),
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) #root,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-base,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-layout {
                background: var(--octo-global-page) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail {
                background: var(--octo-global-rail) !important;
                border-right-color: var(--octo-global-line) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__sep {
                background: var(--octo-global-line) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__item {
                color: var(--octo-global-soft) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__item:hover,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__item--active {
                background: var(--octo-global-selected-strong) !important;
                color: var(--octo-global-accent) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__user-avatar {
                background: var(--octo-global-panel) !important;
                box-shadow: var(--octo-global-shadow) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-navrail__user-status {
                border-color: var(--octo-global-rail) !important;
            }

            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat {
                background: var(--octo-global-side) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-sidebar-tabbar {
                border-bottom-color: var(--octo-global-line) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-sidebar-tabbar__btn {
                color: var(--octo-global-muted) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-sidebar-tabbar__btn--active {
                background: var(--octo-global-selected) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item {
                color: var(--octo-global-muted) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item:hover,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item--selected,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item-selected,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item-active {
                background: var(--octo-global-selected) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item-name {
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conv-breadcrumb,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item-time,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversationlist-item-lastmsg {
                color: var(--octo-global-muted) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conv-unread-num {
                background: color-mix(in srgb, #C8102E 13%, transparent) !important;
                color: #C8102E !important;
            }

            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-layout-splitter {
                background: var(--octo-global-page) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-layout-content-right,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-viewqueue,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-viewqueue-route,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-viewqueue-view,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-content-right,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-content-chat,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-conversation,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversation {
                background: var(--octo-global-main) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-conversation-header {
                background: var(--octo-global-panel) !important;
                border-bottom-color: var(--octo-global-line) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-conversation-header-channel-info-name,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-chat-conversation-header-channel {
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversation-content,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversation-messages {
                background-color: var(--octo-global-main) !important;
            }
            body[data-octo-global-theme="worldcup"] .wk-conversation-content {
                background-image:
                    radial-gradient(74% 58% at 8% -12%, rgba(198, 160, 74, 0.16), transparent 70%),
                    radial-gradient(62% 50% at 100% 105%, rgba(11, 110, 79, 0.11), transparent 72%),
                    linear-gradient(rgba(19, 41, 75, 0.035) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(19, 41, 75, 0.03) 1px, transparent 1px) !important;
                background-size: auto, auto, 36px 36px, 36px 36px !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-conversation-footer {
                background: var(--octo-global-main) !important;
                border-top-color: var(--octo-global-line) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-messageinput-card {
                background: var(--octo-global-panel) !important;
                border-color: var(--octo-global-line) !important;
                box-shadow: var(--octo-global-shadow) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-messageinput-card:focus-within {
                border-color: color-mix(in srgb, var(--octo-global-accent) 65%, var(--octo-global-line)) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-message-split-content {
                color: var(--octo-global-muted) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-message-split-line1,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-message-split-line2 {
                background-image: linear-gradient(90deg, transparent, var(--octo-global-line), transparent) !important;
            }

            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .semi-popover,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .semi-popover-content,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .semi-dropdown-menu,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-modal,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-modal .semi-modal-content,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-modal .semi-modal-body,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-modal .wk-modal-shell,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-modal .wk-modal-body {
                background: var(--octo-global-panel) !important;
                border-color: var(--octo-global-line) !important;
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .semi-dropdown-item:hover,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .semi-select-option:hover,
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-list-item:not(.wk-list-item-static):hover {
                background: var(--octo-global-hover) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-list-item-title {
                color: var(--octo-global-ink) !important;
            }
            body[data-octo-global-theme]:not([data-octo-global-theme="none"]) .wk-list-item-subtitle {
                color: var(--octo-global-muted) !important;
            }`;

// ---- style injection ----------------------------------------------------

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BEAUTIFY_CSS;
  (document.head || document.documentElement).appendChild(style);
}

// ---- theme model ---------------------------------------------------------

let currentThemeId = DEFAULT_THEME;
let currentGlobalThemeId = DEFAULT_GLOBAL_THEME;
let selfWritingTheme = false;

function themeById(id: string): ThemeDef {
  for (const t of THEMES) if (t.id === id) return t;
  return THEMES[0];
}

function globalThemeById(id: string): GlobalThemeDef {
  for (const t of GLOBAL_THEMES) if (t.id === id) return t;
  return GLOBAL_THEMES[0];
}

/** Reflect a theme id onto <body>: base -> [theme-mode], skin -> [data-octo-skin]. Idempotent. */
function reflectTheme(id: string): void {
  const body = document.body;
  if (!body) return;
  const t = themeById(id);
  // Suppress the theme observer while WE write, so our own attribute changes
  // can't feed back into a re-assert loop with the app.
  selfWritingTheme = true;
  try {
    if (t.base === 'dark') {
      if (body.getAttribute('theme-mode') !== 'dark') body.setAttribute('theme-mode', 'dark');
    } else if (body.getAttribute('theme-mode') === 'dark') {
      body.removeAttribute('theme-mode');
    }
    if (t.skin) {
      if (body.getAttribute('data-octo-skin') !== t.skin) body.setAttribute('data-octo-skin', t.skin);
    } else if (body.hasAttribute('data-octo-skin')) {
      body.removeAttribute('data-octo-skin');
    }
  } finally {
    selfWritingTheme = false;
  }
}

/** Reflect a whole-site color theme onto <body>. This is independent of message skin. */
function reflectGlobalTheme(id: string): void {
  const body = document.body;
  if (!body) return;
  const t = globalThemeById(id);
  if (t.id === 'none') {
    body.removeAttribute('data-octo-global-theme');
  } else if (body.getAttribute('data-octo-global-theme') !== t.id) {
    body.setAttribute('data-octo-global-theme', t.id);
  }
}

/**
 * Set the active theme (called on init and whenever the popup changes it).
 * The app forces light mode on startup (removes body[theme-mode]); a
 * MutationObserver below re-asserts our choice so we win that race.
 */
export function setTheme(id: string): void {
  currentThemeId = themeById(id).id;
  reflectTheme(currentThemeId);
  // Mount/unmount the worldcup soccer balls right away (don't wait for next sync).
  try { syncBalls(); } catch { /* noop */ }
}

export function setGlobalTheme(id: string): void {
  currentGlobalThemeId = globalThemeById(id).id;
  reflectGlobalTheme(currentGlobalThemeId);
}

export function setMessiWatermark(enabled: boolean, imageUrl: string): void {
  const body = document.body;
  if (!body) return;

  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    enabled = false;
    url = new URL('about:blank');
  }

  const validAsset =
    (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') &&
    url.pathname === '/messi-watermark.png';

  if (!enabled || !validAsset) {
    body.removeAttribute('data-octo-messi-watermark');
    body.style.removeProperty('--octo-messi-watermark-image');
    return;
  }

  body.setAttribute('data-octo-messi-watermark', 'true');
  body.style.setProperty('--octo-messi-watermark-image', `url(${JSON.stringify(url.href)})`);
}

let themeObserverBound = false;
let reassertTimer: number | undefined;
function watchThemeAttr(): void {
  if (themeObserverBound || !document.body) return;
  themeObserverBound = true;
  const mo = new MutationObserver(() => {
    // Ignore attribute changes we made ourselves; debounce app-driven ones so
    // a fight with the app can't become a synchronous tight loop.
    if (selfWritingTheme) return;
    if (reassertTimer) clearTimeout(reassertTimer);
    reassertTimer = window.setTimeout(() => reflectTheme(currentThemeId), 60);
  });
  mo.observe(document.body, { attributes: true, attributeFilter: ['theme-mode'] });
}

// ---- fold sessions: auto-expand + guard against re-collapse --------------

const TOGGLE_SEL = '.wk-fold-session-card-toggle';
const watchedToggles = new WeakSet<Element>();

// Cap auto-expand clicks per toggle so a toggle that re-collapses (app fights
// back) can't produce an infinite click loop.
const expandCounts = new WeakMap<Element, number>();
const MAX_EXPAND_CLICKS = 3;

function expandToggle(btn: Element | null): void {
  if (!btn || btn.getAttribute('aria-expanded') !== 'false') return;
  const n = expandCounts.get(btn) || 0;
  if (n >= MAX_EXPAND_CLICKS) return;
  expandCounts.set(btn, n + 1);
  (btn as HTMLElement).click();
}
function expandAllFoldSessions(): void {
  document.querySelectorAll(`${TOGGLE_SEL}[aria-expanded="false"]`).forEach(expandToggle);
}
function watchToggle(btn: Element): void {
  if (watchedToggles.has(btn)) return;
  watchedToggles.add(btn);
  const mo = new MutationObserver(() => {
    if (btn.getAttribute('aria-expanded') === 'false') expandToggle(btn);
  });
  mo.observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
}
function watchAllToggles(): void {
  document.querySelectorAll(TOGGLE_SEL).forEach(watchToggle);
}

// ---- mark AI continue rows (inherit previous sender's AI state) ----------

function markAIContinueMessages(): void {
  const allRows = document.querySelectorAll('.wk-msg-row');
  let currentSenderIsAI = false;
  allRows.forEach((row) => {
    if (row.classList.contains('wk-msg-row--continue')) {
      if (currentSenderIsAI && row.getAttribute('data-ai-continue') !== 'true') {
        row.setAttribute('data-ai-continue', 'true');
      } else if (!currentSenderIsAI && row.getAttribute('data-ai-continue') === 'true') {
        row.removeAttribute('data-ai-continue');
      }
    } else {
      currentSenderIsAI = !!row.querySelector('.ai-badge');
    }
  });
}

// ---- single-message height clamp + click to expand -----------------------

const CLAMP_SEL = [
  '.wk-msg-row:has(.ai-badge) .wk-markdown',
  '.wk-msg-row--continue[data-ai-continue="true"] .wk-markdown',
  '.wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown',
  '.wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown',
  '.wk-fold-msg-text',
].join(',');

function applyClamp(): void {
  document.querySelectorAll(CLAMP_SEL).forEach((el) => {
    const full = (el as HTMLElement).scrollHeight;
    const tall = full > CLAMP_HEIGHT + 8;
    if (tall) el.classList.add('octo-clamp');
    else el.classList.remove('octo-clamp', 'octo-expanded');
  });
}

let clickBound = false;
function bindClicks(): void {
  if (clickBound) return;
  clickBound = true;
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement;
      const clamp = target.closest && target.closest('.octo-clamp');
      if (clamp && !target.closest('a, button, code, pre, img')) {
        clamp.classList.toggle('octo-expanded');
      }
    },
    true,
  );
}

// ---- worldcup soccer ball: real DOM node + 5 selectable kick styles -------

// Bubbles that carry a corner ball under the worldcup skin.
const BALL_HOST_SEL = [
  '.wk-msg-row:has(.ai-badge) .wk-markdown',
  '.wk-msg-row--continue[data-ai-continue="true"] .wk-markdown',
  '.wk-msg-row--send:not(:has(.ai-badge)) .wk-markdown',
  '.wk-msg-row:not(.wk-msg-row--send):not(:has(.ai-badge)):not([data-ai-continue="true"]) .wk-markdown',
  '.wk-fold-msg-text',
].join(',');

const BALL_CLASS = 'octo-wc-ball';
const kickingBalls = new WeakSet<HTMLElement>();
let ballsMounted = false;

/** Selectable soccer-kick styles (worldcup skin). Shown in the popup. */
export interface KickStyleDef {
  id: string;
  label: string;
  icon: string;
  /** total animation duration in ms (for cleanup safety) */
  dur: number;
  /** extra trail/effect child nodes this style needs */
  fx: string[];
  /** whether the goal net + bubble shake on impact */
  shake?: boolean;
}
export const KICK_STYLES: KickStyleDef[] = [
  { id: 'lightning', label: '闪电爆射', icon: '⚡', dur: 620, fx: ['bolt'], shake: true },
  { id: 'fire', label: '火焰弹道', icon: '🔥', dur: 700, fx: ['flame'], shake: true },
  { id: 'bullet', label: '子弹时间', icon: '🎬', dur: 950, fx: ['ghost', 'ghost', 'ghost'] },
  { id: 'comet', label: '彗星光轨', icon: '☄️', dur: 800, fx: ['trail'] },
  { id: 'cannon', label: '重炮轰门', icon: '💥', dur: 620, fx: ['shock'], shake: true },
];
export const DEFAULT_KICK_STYLE = 'lightning';

let currentKickStyle = DEFAULT_KICK_STYLE;
function kickStyleById(id: string): KickStyleDef {
  for (const s of KICK_STYLES) if (s.id === id) return s;
  return KICK_STYLES[0];
}
export function setKickStyle(id: string): void {
  currentKickStyle = kickStyleById(id).id;
  // Reflect onto <body> so the chat-area background CSS (per-style) can match.
  if (document.body) document.body.setAttribute('data-octo-kick-style', currentKickStyle);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Kick a ball with the currently-selected style. The trajectory + effects are
 * CSS `@keyframes` (see BEAUTIFY_CSS, ported from the design preview); JS just
 * sets the travel distance, arms the effect nodes, retriggers the animation,
 * fires the goal/bubble shake, and cleans up on animationend (+ a safety
 * timeout so a backgrounded tab can never leave a ball stuck "live").
 */
function kickBall(ball: HTMLElement): void {
  if (kickingBalls.has(ball)) return; // one kick at a time per ball
  if (prefersReducedMotion()) return;
  const host = ball.parentElement as HTMLElement | null;
  if (!host) return;
  const style = kickStyleById(currentKickStyle);

  kickingBalls.add(ball);

  // Travel distance = bubble inner width minus the ball and both corner insets.
  const dist = Math.max(70, Math.min(560, host.clientWidth - 26 - 24));
  host.style.setProperty('--octo-go', dist + 'px');
  host.setAttribute('data-octo-kick', style.id);

  // (Re)build effect nodes for this style (bolt/flame/ghost.../trail/shock).
  host.querySelectorAll(`.${BALL_CLASS}-fx`).forEach((n) => n.remove());
  style.fx.forEach((fx, i) => {
    const el = document.createElement('span');
    el.className = `${BALL_CLASS}-fx octo-fx-${fx}${fx === 'ghost' ? ' octo-fx-ghost' + (i + 1) : ''}`;
    el.setAttribute('aria-hidden', 'true');
    host.insertBefore(el, ball); // behind the ball
  });

  // Retrigger the CSS animation from the start.
  ball.classList.add('octo-wc-live');
  ball.style.animation = 'none';
  // force reflow so removing+re-adding animation restarts it
  void ball.offsetWidth;
  ball.style.animation = '';

  // Goal net + bubble shake on impact styles.
  if (style.shake) {
    const goal = host.querySelector('.octo-wc-goal');
    if (goal) { goal.classList.remove('octo-shake'); void (goal as HTMLElement).offsetWidth; goal.classList.add('octo-shake'); }
    if (style.id === 'cannon') {
      host.classList.remove('octo-boom'); void host.offsetWidth; host.classList.add('octo-boom');
    }
  }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(safety);
    ball.removeEventListener('animationend', onEnd);
    ball.classList.remove('octo-wc-live');
    ball.style.animation = '';
    host.classList.remove('octo-boom');
    host.removeAttribute('data-octo-kick');
    host.querySelectorAll(`.${BALL_CLASS}-fx`).forEach((n) => n.remove());
    kickingBalls.delete(ball);
  };
  const onEnd = (e: AnimationEvent) => { if (e.target === ball) finish(); };
  ball.addEventListener('animationend', onEnd);
  // Safety: backgrounded tabs pause CSS anims + this timer, but on return the
  // timer resumes and force-cleans; also covers browsers that drop animationend.
  const safety = window.setTimeout(finish, style.dur + 400);
}

function ensureBall(host: HTMLElement): void {
  if (host.querySelector(`:scope > .${BALL_CLASS}`)) return;
  // goal (right-side net) — target of the shot
  const goal = document.createElement('span');
  goal.className = 'octo-wc-goal';
  goal.setAttribute('aria-hidden', 'true');
  host.appendChild(goal);
  // the ball
  const ball = document.createElement('span');
  ball.className = BALL_CLASS;
  ball.setAttribute('aria-hidden', 'true');
  host.appendChild(ball);
  // Hover the bubble -> kick this bubble's ball.
  host.addEventListener('mouseenter', () => {
    const b = host.querySelector<HTMLElement>(`:scope > .${BALL_CLASS}`);
    if (b) kickBall(b);
  });
}

function mountBalls(): void {
  ballsMounted = true;
  document.querySelectorAll<HTMLElement>(BALL_HOST_SEL).forEach(ensureBall);
}

function unmountBalls(): void {
  ballsMounted = false;
  document.querySelectorAll<HTMLElement>(`.${BALL_CLASS}, .octo-wc-goal, .${BALL_CLASS}-fx`).forEach((b) => b.remove());
}

/** Called from sync(): keep balls in step with the active skin. */
function syncBalls(): void {
  const worldcup = themeById(currentThemeId).skin === 'worldcup';
  if (worldcup) mountBalls();
  else if (ballsMounted) unmountBalls();
}

// ---- unified debounced DOM sync ------------------------------------------

function debounce(fn: () => void, wait: number): () => void {
  let t: number | undefined;
  return function () {
    if (t) clearTimeout(t);
    t = window.setTimeout(fn, wait);
  };
}

let bodyObserver: MutationObserver | null = null;
let syncing = false;

function sync(): void {
  // Re-entrancy + self-mutation guard: our own DOM writes below (attributes,
  // clamp classes, fold-expand clicks) would otherwise retrigger the body
  // observer and spin. Disconnect while we mutate, reconnect after.
  if (syncing) return;
  syncing = true;
  if (bodyObserver) bodyObserver.disconnect();
  try {
    try { reflectTheme(currentThemeId); } catch { /* noop */ }
    try { reflectGlobalTheme(currentGlobalThemeId); } catch { /* noop */ }
    try { watchAllToggles(); } catch { /* noop */ }
    try { expandAllFoldSessions(); } catch { /* noop */ }
    try { markAIContinueMessages(); } catch { /* noop */ }
    try { applyClamp(); } catch { /* noop */ }
    try { syncBalls(); } catch { /* noop */ }
  } finally {
    if (bodyObserver && document.body) {
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }
    syncing = false;
  }
}

const scheduleSync = debounce(sync, 120);
let started = false;

/**
 * Initialize the beautify engine once. `initialThemeId` is the theme resolved
 * from extension storage; later changes come via setTheme().
 */
export function initBeautify(initialThemeId: string): void {
  if (started) {
    setTheme(initialThemeId);
    return;
  }
  started = true;
  currentThemeId = themeById(initialThemeId).id;

  const boot = () => {
    injectStyles();
    setTheme(currentThemeId);
    setGlobalTheme(currentGlobalThemeId);
    setKickStyle(currentKickStyle); // reflect default kick style onto <body> for bg CSS
    watchThemeAttr();
    bindClicks();
    bodyObserver = new MutationObserver(scheduleSync);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    sync();
    window.setTimeout(sync, 500);
  };

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
}
