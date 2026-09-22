import { build } from 'esbuild';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 前台静态资源压缩。
 *
 * 做法：**源文件原地不动，只压缩构建产物**。
 * 读 src/main/resources/static/{js,css}，写 build/resources/main/static/{js,css}，
 * 覆盖 processResources 刚拷过去的那份。这样：
 * - 开发时编辑的还是可读的原文件，不用面对压缩后的代码；
 * - 打进 jar 和 dev 容器的都是压缩版，不会出现「忘了重新构建」导致两份不一致；
 * - 不需要改 FootprintHeadProcessor 里的任何路径。
 *
 * 带 sourcemap：线上出问题时打开 devtools 仍能对到原始行号，
 * map 文件只有开着 devtools 才会被请求，不影响正常访问的流量。
 *
 * 实测收益（gzip 后）：245 KB → 127 KB。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const SRC = join(ROOT, 'src/main/resources/static');
const OUT = join(ROOT, 'build/resources/main/static');

/** 只压这两个目录；cesium / vendor 都是第三方的既有压缩产物，再压一遍没有意义 */
const DIRS = ['js', 'css'];

/** 已经是压缩产物的不再处理，避免二次压缩把 sourcemap 搞乱 */
const SKIP = /\.min\.(js|css)$/;

function collect() {
  const files = [];
  for (const dir of DIRS) {
    const abs = join(SRC, dir);
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

const files = collect();
if (!files.length) {
  console.error('[frontend-build] 没找到要压缩的文件，检查 processResources 是否已执行');
  process.exit(1);
}

let before = 0;
let after = 0;

for (const f of files) {
  before += statSync(f.in).size;
  await build({
    entryPoints: [f.in],
    outfile: f.out,
    minify: true,
    sourcemap: true,
    // 不 bundle：这些文件目前各自独立，没有 import 关系。
    // 等第二阶段把 travel-memory.js 拆成模块时，这里改成 bundle: true。
    bundle: false,
    legalComments: 'none',
    target: ['es2020'],
    logLevel: 'warning',
  });
  after += statSync(f.out).size;
}

const kb = (n) => (n / 1024).toFixed(0);
console.log(
  `[frontend-build] 压缩 ${files.length} 个文件：${kb(before)} KB → ${kb(after)} KB ` +
    `(-${(100 - (after / before) * 100).toFixed(0)}%)`
);
