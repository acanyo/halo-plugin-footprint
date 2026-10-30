#!/usr/bin/env node
/**
 * 前台模块契约检查。
 *
 * 拆模块时最容易踩、而且 esbuild 不会报的几类问题，在这里一次性挡住：
 *
 *   1. 注入键不匹配 —— 模块里写 deps.FOO()，主文件注入的是 foo，
 *      运行时才炸 "undefined is not a function"；
 *   2. 模块顶层访问 deps —— ESM 的 import 先于主文件执行，
 *      此时 deps 还是 null，直接抛 Cannot read properties of null；
 *   3. 装配顺序 —— index.js 里 init* 早于 setup*，
 *      init 立刻跑的渲染回调会调到尚未注入的模块；
 *   4. 自引用 —— 模块用 deps.xxx() 调自己 export 的函数；
 *   5. 空的 init —— 把顶层副作用挪进 init 时只删不搬，
 *      监听整段丢失却不报任何错（province-cards 就这样丢过一次）。
 *
 * 用法（在仓库根）：
 *   node tools/check-frontend-contract.mjs
 *
 * 退出码 0 = 通过，1 = 有问题。
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "src/main/frontend/travel-memory");
const MODULES = join(FRONTEND, "modules");
const INDEX = join(FRONTEND, "index.js");

const problems = [];
const fail = (msg) => problems.push(msg);

// ---------- 收集模块 ----------
const moduleFiles = readdirSync(MODULES)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const text = readFileSync(join(MODULES, f), "utf8");
    // 去掉块注释与行注释后的代码，用于判断"实际用到了哪些注入键"
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    return { name: f, path: join(MODULES, f), text, code };
  });

const indexText = readFileSync(INDEX, "utf8");

// ---------- 1. 注入键匹配 ----------
// 解析主文件里的 setupXxx({...})，与模块内实际调用的 deps.X(...) 比对。
// 允许两种写法：`key: value,` 与最后一项没有逗号的 `key`（简写）。
function setupCalls(text) {
  const calls = [];
  // 支持两种写法：多行 setupXxx({ ... \n    }) 与单行 setupXxx({ viewer: () => viewer })
  const re = /setup(\w+)\(\{([^{}]*?)\}\)/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2];
    const keys = new Set();
    for (const km of body.matchAll(/^\s+(\w+)\s*[:,]/gm)) keys.add(km[1]);
    for (const km of body.matchAll(/^\s+(\w+)\s*$/gm)) keys.add(km[1]);
    calls.push({ setup: m[1], keys });
  }
  return calls;
}

// 除了 index.js，模块内部也可能把注入转发给子模块（如 ticket-gallery.js → ticket-*.js），一并检查
const allSetupCalls = [
  ...setupCalls(indexText).map((call) => ({ ...call, caller: "index.js" })),
  ...moduleFiles.flatMap((f) => setupCalls(f.code).map((call) => ({ ...call, caller: f.name }))),
];

for (const call of allSetupCalls) {
  const mod = moduleFiles.find((f) => new RegExp(`export function setup${call.setup}\\(`).test(f.text));
  if (!mod) {
    fail(`[注入] ${call.caller} 调用了 setup${call.setup}，但没有任何模块导出它`);
    continue;
  }
  // 既算运行期的 deps.X，也算 setup 函数体里的 d.X（注入时直接取用的键）
  const used = new Set([
    ...[...mod.code.matchAll(/deps\.(\w+)\s*\(/g)].map((m) => m[1]),
    ...[...mod.code.matchAll(/(?<![.\w])d\.(\w+)/g)].map((m) => m[1]),
  ]);
  const missing = [...used].filter((k) => !call.keys.has(k)).sort();
  if (missing.length) {
    fail(`[注入] setup${call.setup} (${mod.name}) 缺少注入: ${missing.join(", ")}`);
  }
  // 未使用的键：既没有 deps.key(...) 调用，也没有 deps.key 直接引用
  const referenced = new Set([
    ...[...mod.code.matchAll(/deps\.(\w+)/g)].map((m) => m[1]),
    ...[...mod.code.matchAll(/(?<![.\w])d\.(\w+)/g)].map((m) => m[1]),
  ]);
  const unused = [...call.keys].filter((k) => !referenced.has(k)).sort();
  if (unused.length) {
    // 只在没有注释说明时提示；这里统一按 warn 处理，不计入失败
    console.log(`  提示: setup${call.setup} 注入了未使用的键 ${unused.join(", ")}`);
  }
}

// ---------- 2. 模块顶层访问 deps ----------
// 顶层 = 花括号深度 0 且不在函数声明里。只抓真正会执行的语句，
// 包括 `const X = (() => deps.foo())()` 这种 IIFE 初始化。
for (const mod of moduleFiles) {
  const lines = mod.text.split("\n");
  let depth = 0;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }

    const isFunctionDecl = /^(export\s+)?(async\s+)?function\b/.test(trimmed);
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*");

    // 剥掉行尾注释再判断：注释里提到 deps 不算访问
    const codePart = line.replace(/\/\/.*$/, "");
    if (depth === 0 && !isFunctionDecl && !isComment && /\bdeps\.\w+/.test(codePart)) {
      // 例外：纯类型注释里的 @param d.xxx 不会被这条正则命中，无需额外处理
      fail(`[顶层] ${mod.name}:${i + 1} 在模块顶层访问 deps —— import 阶段 deps 为 null\n        ${trimmed.slice(0, 90)}`);
    }

    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (depth < 0) depth = 0;
  }
}

// ---------- 3. 装配顺序 ----------
const initLines = [];
const setupLines = [];
indexText.split("\n").forEach((line, i) => {
  if (/^ {4}init[A-Z]\w*\(/.test(line) || /^ {4}initTdtTerrain\(/.test(line)) initLines.push(i + 1);
  if (/^ {4}(setup[A-Z]|setTdtTerrainDeps)/.test(line)) setupLines.push(i + 1);
});

if (setupLines.length && initLines.length) {
  const lastSetup = setupLines[setupLines.length - 1];
  const firstInit = initLines[0];
  if (firstInit < lastSetup) {
    fail(
      `[顺序] index.js 第 ${firstInit} 行就有 init 调用，但最后一个 setup 在第 ${lastSetup} 行 —— ` +
        `init 会立刻跑渲染回调，调到尚未注入的模块`,
    );
  }
}

// ---------- 4. 自引用（deps 调本模块自己导出的函数） ----------
for (const mod of moduleFiles) {
  const exported = new Set([
    ...[...mod.text.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]),
    ...[...mod.text.matchAll(/^export const (\w+)/gm)].map((m) => m[1]),
  ]);
  const selfRef = [...exported].filter((n) => new RegExp(`deps\\.${n}\\s*\\(`).test(mod.text));
  if (selfRef.length) {
    fail(`[自引用] ${mod.name} 用 deps.xxx() 调用本模块自己导出的函数: ${selfRef.join(", ")}`);
  }
}

// ---------- 5. 空的 init ----------
// 按花括号配对取函数体，只看里面是否还有代码（注释已在 mod.code 里去掉）。
// 不用「行首 }」判断结尾：空函数体常常缩进着收尾，那样会整段漏检。
function functionBody(code, openBrace) {
  let depth = 0;
  for (let i = openBrace; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(openBrace + 1, i);
  }
  return null;
}

for (const mod of moduleFiles) {
  for (const m of mod.code.matchAll(/^export function (init\w*)\([^)]*\)\s*\{/gm)) {
    const body = functionBody(mod.code, m.index + m[0].length - 1);
    if (body !== null && !body.replace(/\/\/.*$/gm, "").trim()) {
      fail(`[空 init] ${mod.name} 的 ${m[1]}() 没有任何语句 —— 副作用可能在搬迁中丢了`);
    }
  }
}

// ---------- 输出 ----------
if (problems.length) {
  console.error(`\n❌ 前台模块契约检查发现 ${problems.length} 个问题：\n`);
  for (const p of problems) console.error("  " + p + "\n");
  process.exit(1);
}

console.log(`\n✅ 前台模块契约检查通过（${moduleFiles.length} 个模块）`);
