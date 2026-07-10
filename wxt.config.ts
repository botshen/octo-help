import { defineConfig } from 'wxt';

// Octo target host. Adjust matches here if the deployment domain changes.
const OCTO_MATCHES = ['https://im.deepminer.com.cn/*'];

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Octo 撤回消息还原',
    description: '在 Octo 聊天里显示已撤回消息的原文',
    permissions: ['storage'],
    host_permissions: OCTO_MATCHES,
    web_accessible_resources: [
      {
        // MAIN-world script plus assets referenced from the page context.
        resources: ['octo-main-world.js', 'messi-watermark.png'],
        matches: OCTO_MATCHES,
      },
    ],
  },
});
