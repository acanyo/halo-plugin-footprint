#!/usr/bin/env node
/**
 * 前台单测入口：收集 src/test/frontend 下全部 *.test.mjs，交给 node:test 跑。
 *
 * 单独写一个入口而不是在 gradle 里写 `node --test <glob>`：
 * glob 展开依赖 Node 版本与 shell，入口脚本里自己列文件最稳。
 *
 * 用法（在仓库根）：
 *   node tools/run-frontend-tests.mjs
 */

import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(ROOT, "src/test/frontend");

const files = readdirSync(TESTS, { recursive: true })
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => join(TESTS, f))
  .sort();

let failed = false;
run({ files })
  .on("test:fail", () => { failed = true; })
  .compose(spec)
  .on("end", () => { process.exitCode = failed ? 1 : 0; })
  .pipe(process.stdout);
