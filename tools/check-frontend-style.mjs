#!/usr/bin/env node
/**
 * 前台视觉规范检查（测绘手簿，见 src/main/frontend/styles/DESIGN.md）。
 *
 * 只查机器能判断的那几条「不做的事」：
 *   1. 英文大写小标题 —— 模板 / 脚本里出现的整串大写英文文案（TRAVEL MEMORY 之类）；
 *   2. 用「·」拼接元信息 —— 脚本里的 ' · ' 拼接与 join(' · ')；
 *   3. 色值散落 —— 样式里直接写的 #hex / rgb()，应该走 --fp-* 变量；
 *   4. 旧字体 —— 行楷 / 宋体 / 等宽字体栈。
 *
 * 默认只报告不失败（迁移期间）；传 --strict 时有问题即退出码 1。
 * 用法：node tools/check-frontend-style.mjs [--strict] [--quiet]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STRICT = process.argv.includes("--strict");
const QUIET = process.argv.includes("--quiet");

const walk = (dir, ext) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p, ext) : (p.endsWith(ext) ? [p] : []);
});

// 2D 地图页（footprint.css / footprint/）是另一套独立界面，暂不纳入
const STYLE_DIRS = ["travel-memory", "memory-shelf", "shared"].map((d) => join(ROOT, "src/main/frontend/styles", d));
const SCRIPT_DIRS = ["travel-memory", "memory-shelf"].map((d) => join(ROOT, "src/main/frontend", d));
const TEMPLATE = join(ROOT, "src/main/resources/templates/footprint.html");

const issues = { eyebrow: [], dot: [], color: [], font: [] };
const rel = (p) => relative(ROOT, p);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// 1. 英文大写小标题：模板里的文本节点，脚本里的字符串字面量
const CAPS = /\b[A-Z]{3,}(?:[ '&-]+[A-Z]{2,})+\b/;
{
  const html = readFileSync(TEMPLATE, "utf8");
  html.split("\n").forEach((line, i) => {
    const text = line.replace(/<[^>]*>/g, " ");
    if (CAPS.test(text)) issues.eyebrow.push(`${rel(TEMPLATE)}:${i + 1}  ${text.trim().slice(0, 60)}`);
  });
}
for (const f of SCRIPT_DIRS.flatMap((d) => walk(d, ".js"))) {
  stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) {
      if (CAPS.test(m[2]) && !/^[A-Z_]+$/.test(m[2])) issues.eyebrow.push(`${rel(f)}:${i + 1}  ${m[2].slice(0, 60)}`);
    }
  });
}

// 2. 「·」拼接
for (const f of SCRIPT_DIRS.flatMap((d) => walk(d, ".js"))) {
  stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
    if (/(['"`])\s*·\s*\1|join\(\s*(['"`])\s*·\s*\2\s*\)/.test(line)) issues.dot.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 80)}`);
  });
}
{
  readFileSync(TEMPLATE, "utf8").split("\n").forEach((line, i) => {
    const text = line.replace(/<[^>]*>/g, " ");
    if (/\S\s·\s\S/.test(text)) issues.dot.push(`${rel(TEMPLATE)}:${i + 1}  ${text.trim().slice(0, 60)}`);
  });
}

// 3/4. 样式里的色值与字体栈（tokens.css 本身就是定义处，不查）
for (const f of STYLE_DIRS.flatMap((d) => walk(d, ".css"))) {
  if (/shared\/(tokens|wenkai)\.css$/.test(f)) continue;
  stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
    if (/^\s*--[\w-]+\s*:/.test(line)) return;            // 局部变量定义允许直接写值
    if (/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(line)) issues.color.push(`${rel(f)}:${i + 1}`);
    if (/font(-family)?\s*:[^;]*(STXingkai|华文行楷|Songti|STSong|SimSun|Noto Serif|monospace|Consolas)/i.test(line)) issues.font.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 70)}`);
  });
}

const LABEL = { eyebrow: "英文大写小标题", dot: "「·」拼接", color: "样式里直接写的色值", font: "旧字体栈" };
let total = 0;
for (const [k, list] of Object.entries(issues)) {
  total += list.length;
  console.log(`${LABEL[k]}：${list.length}`);
  if (!QUIET) for (const x of list.slice(0, 40)) console.log("  " + x);
  if (!QUIET && list.length > 40) console.log(`  …另有 ${list.length - 40} 处`);
}
if (STRICT && total) process.exit(1);
