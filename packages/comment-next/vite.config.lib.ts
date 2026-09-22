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
  experimental: {
    enableNativePlugin: true,
  },
  plugins: [
    svelte(),
    minifyBundle(),
    StaticCopy({
      targets: [
        {
          src: ['./dist/comment-next.iife.js', './dist/comment-next.css'],
          dest: fileURLToPath(
            new URL('../../src/main/resources/static', import.meta.url)
          ),
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/altcha/dist/main/altcha.i18n.min.js',
          dest: fileURLToPath(
            new URL('../../src/main/resources/static/vendor/altcha', import.meta.url)
          ),
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/cap-widget/cap.min.js',
          dest: fileURLToPath(
            new URL('../../src/main/resources/static/vendor/cap', import.meta.url)
          ),
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'comment-next',
      fileName: 'comment-next',
      formats: ['es', 'iife'],
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
