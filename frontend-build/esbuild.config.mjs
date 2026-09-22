import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 前台资源构建。
 *
 * 两类输入，一个出口：
 *
 * 1. **已模块化的源码**（src/main/frontend/）——打包 + 压缩。
 *    这些目录用 ES 模块写，esbuild 负责 bundle 回单文件。
 *    打成 IIFE：原来那些顶层变量本就在全局词法作用域里裸奔，
 *    包起来反而更干净；且已确认 travel-memory 与 footprint.js、
 *    与模板内联脚本之间没有任何跨文件引用，包起来不会断链。
 *
 * 2. **还没模块化的静态文件**（src/main/resources/static/{js,css}）——只压缩。
 *    随着分层推进，这里的文件会逐个搬到第 1 类去，这份清单自然缩短。
 *
 * 输出一律写到 build/resources/main/static/，覆盖 processResources 拷过去的那份。
 * 源文件原地不动：开发时看的是可读代码，打进 jar 的是压缩版，
 * 也不会出现「忘了重新构建」导致两份不一致。
 *
 * 带 sourcemap：线上出问题时打开 devtools 仍能对到原始行号，
 * map 只有开着 devtools 才会被请求，不影响正常访问的流量。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const FRONTEND = join(ROOT, 'src/main/frontend');
const STATIC_SRC = join(ROOT, 'src/main/resources/static');
const OUT = join(ROOT, 'build/resources/main/static');

/** 第 1 类：已模块化，需要 bundle。key 是输出的文件名（不含扩展名） */
const BUNDLES = {
  'travel-memory': join(FRONTEND, 'travel-memory/index.js'),
};

/** 第 2 类：尚未模块化，只压缩。扫这两个目录下的散文件 */
const PLAIN_DIRS = ['js', 'css'];

/** 已经是压缩产物的不再处理，免得二次压缩把 sourcemap 搞乱 */
const SKIP = /\.min\.(js|css)$/;

function collectPlain() {
  const files = [];
  for (const dir of PLAIN_DIRS) {
    const abs = join(STATIC_SRC, dir);
    let names;
    try {
      names = readdirSync(abs);
    } catch {
      continue; // 目录不存在就跳过，不算错误
    }
    for (const name of names) {
      const p = join(abs, name);
      if (!statSync(p).isFile()) continue;
      if (!/\.(js|css)$/.test(name) || SKIP.test(name)) continue;
      files.push({ in: p, out: join(OUT, dir, name) });
    }
  }
  return files;
}

const COMMON = {
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  target: ['es2020'],
  logLevel: 'warning',
};

let before = 0;
let after = 0;
let count = 0;

for (const [name, entry] of Object.entries(BUNDLES)) {
  const out = join(OUT, 'js', `${name}.js`);
  before += statSync(entry).size;
  await build({ ...COMMON, entryPoints: [entry], outfile: out, bundle: true, format: 'iife' });
  after += statSync(out).size;
  count++;
}

for (const f of collectPlain()) {
  before += statSync(f.in).size;
  await build({ ...COMMON, entryPoints: [f.in], outfile: f.out, bundle: false });
  after += statSync(f.out).size;
  count++;
}

const kb = (n) => (n / 1024).toFixed(0);
console.log(
  `[frontend-build] ${count} 个产物：${kb(before)} KB → ${kb(after)} KB ` +
    `(-${(100 - (after / before) * 100).toFixed(0)}%)`
);
