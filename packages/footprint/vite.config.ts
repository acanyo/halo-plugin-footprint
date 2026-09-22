import { svelte } from '@sveltejs/vite-plugin-svelte';
// 从 vitest/config 导入而非 vite：test 选项不在 vite 的 UserConfig 类型里
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  // 用 jsdom 而非默认的 node：localStorage、Image、matchMedia 这些浏览器 API
  // 在 node 下不存在，会被模块里的 try/catch 静默降级，测试便无法验证真实行为
  // （实测护照集章的两个用例因此变成了在测「没有 localStorage 时不崩」）。
  test: {
    environment: 'jsdom',
  },
  server: {
    proxy: {
      // 代理到本地开发用的 Halo 实例：
      // /apis    —— 插件接口
      // /plugins —— 插件静态资源，demo 页据此加载真实的 Cesium.js 与其 Workers/Assets
      '/apis': { target: 'http://localhost:8090', changeOrigin: true },
      '/plugins': { target: 'http://localhost:8090', changeOrigin: true },
    },
  },
});
