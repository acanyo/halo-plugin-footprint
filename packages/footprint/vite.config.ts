import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
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
