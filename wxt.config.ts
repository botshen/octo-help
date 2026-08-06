import { defineConfig } from 'wxt';
import { OCTO_MATCHES } from './utils/octoRecall';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Auto-imports are off on purpose. Every module here already imports
  // explicitly, so scanning utils/ only produced "Duplicated imports" warnings
  // for the deliberate name pairs (octoFullscreenKickLazy vs
  // octoFullscreenKickPixi, octoBeautify vs octoThemeCatalog) — and it resolved
  // those globals to the *pixi* implementation, so a single forgotten import in
  // main-world code would have silently pulled ~540 KB of WebGL engine into the
  // always-injected bundle, right past the eslint no-restricted-imports guard.
  // WXT APIs are imported from '#imports' instead.
  imports: false,
  dev: {
    server: {
      port: 17321,
      strictPort: true,
    },
  },
  // Keep development startup headless; load the generated extension manually
  // when interactive testing is explicitly needed.
  webExt: {
    disabled: true,
  },
  manifest: {
    name: 'Octo 聊天增强',
    description: '增强 Octo 网页聊天：消息美化、舒适输入框、输入框宠物、GitHub 快捷入口和本地桌面宠物。',
    minimum_chrome_version: '114',
    action: {
      default_title: '打开 Octo 聊天增强设置',
    },
    permissions: ['storage', 'unlimitedStorage'],
    host_permissions: [...OCTO_MATCHES],
    web_accessible_resources: [
      {
        // MAIN-world scripts plus assets referenced from the page context.
        // octo-kick-world.js carries pixi.js and is injected on demand only
        // (see utils/octoFullscreenKickLazy.ts), keeping it out of every load.
        resources: [
          'octo-main-world.js',
          'octo-kick-world.js',
          'player-animation/*.webp',
        ],
        matches: [...OCTO_MATCHES],
      },
    ],
  },
});
