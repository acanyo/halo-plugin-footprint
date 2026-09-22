import { svelte } from '@sveltejs/vite-plugin-svelte';
import { minify } from 'terser';
import { fileURLToPath } from 'url';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy as StaticCopy } from 'vite-plugin-static-copy';

// See https://github.com/vitejs/vite/issues/6555
const minifyBundle = (): Plugin => ({
  name: 'minify-bundle',
  async generateBundle(_, bundle) {
    for (const asset of Object.values(bundle)) {
      if (asset.type === 'chunk') {
        const code = (await minify(asset.code, { sourceMap: false })).code;
        if (code) {
          asset.code = code;
        }
      }
    }
  },
});

export default defineConfig({
  plugins: [
    svelte(),
    minifyBundle(),
    // 产物落到插件静态资源目录，由 footprint.html 以 <script type="module"> 加载。
    //
    // 投递 ES 产物而非 IIFE：IIFE 按定义是单文件，动态 import 会被内联回主包，
    // 代码分割完全失效（实测 GSAP 让 IIFE 从 77 kB 涨到 109 kB，而 ES 构建
    // 把 Flip 拆成 24 kB 独立 chunk，只有真正打开票根页才加载）。
    // 因此连同 chunk 一起拷贝，用通配匹配带 hash 的文件名。
    StaticCopy({
      targets: [
        {
          src: ['./dist/*.js', './dist/footprint.css'],
          dest: fileURLToPath(
            new URL('../../src/main/resources/static/next', import.meta.url)
          ),
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'footprint',
      fileName: 'footprint',
      // 只出 ES：见上方 StaticCopy 注释，IIFE 会让动态 import 失去意义
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
