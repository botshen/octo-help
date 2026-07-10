import { defineConfig } from 'wxt';

// Octo target host. Adjust matches here if the deployment domain changes.
const OCTO_MATCHES = ['https://im.deepminer.com.cn/*'];

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Octo 聊天增强',
    description: '增强 Octo 网页聊天：还原已撤回消息，提供消息美化、全站主题、世界杯特效和梅西水印。',
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
