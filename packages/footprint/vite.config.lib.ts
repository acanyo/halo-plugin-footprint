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
    // 产物直接落到插件的静态资源目录，由 footprint.html 以普通 <script> 加载。
    // 前台页面不经过 Halo Console 的构建，所以不能走 ui/ 那条链路。
    StaticCopy({
      targets: [
        {
          src: ['./dist/footprint.iife.js', './dist/footprint.css'],
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
      formats: ['es', 'iife'],
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
