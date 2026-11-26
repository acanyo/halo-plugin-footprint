import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue(), Icons({ compiler: "vue3" })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 当前测试都是纯函数测试；默认 jsdom 会加载 Node 22.13 尚不支持的新版
    // undici/zstd API。需要 DOM 的单测可在文件顶部用 @vitest-environment jsdom。
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    root: fileURLToPath(new URL("./", import.meta.url)),
  },
});
