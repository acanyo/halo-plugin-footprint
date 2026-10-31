#!/usr/bin/env node
/**
 * 前台视觉规范检查（柔光玻璃，见 src/main/frontend/styles/DESIGN.md）。
 *
 * 只查机器能判断的那几条「不做的事」：
 *   1. 英文大写小标题 —— 模板 / 脚本里出现的整串大写英文文案（TRAVEL MEMORY 之类）；
 *   2. 用「·」拼接元信息 —— 脚本里的 ' · ' 拼接与 join(' · ')；
 *   3. 色值散落 —— 样式里直接写的 #hex / rgb()，应该走 --fp-* 变量；
 *      例外：阴影里的纯黑 rgba(0,0,0,…)、玻璃用的半透明白 rgba(255,255,255,…)；
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

// footprint/ 是「2D 地图」页（高德地图）的样式与脚本
const STYLE_DIRS = ["travel-memory", "memory-shelf", "shared", "footprint"].map((d) => join(ROOT, "src/main/frontend/styles", d));
const SCRIPT_DIRS = ["travel-memory", "memory-shelf", "footprint", "shared"].map((d) => join(ROOT, "src/main/frontend", d));
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
    // 单独画出来的列表圆点 fillText('·', …) 不是拼接，不算
    if (/fillText\(\s*(['"`])·\1/.test(line)) return;
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
    // 允许：阴影里的纯黑、玻璃用的半透明白（两者是「材质」，不是色板里的颜色）
    const withoutShadowBlack = line.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,[^)]*\)/g, '');
    const isShadow = /(text|box)-shadow|^\s*0\s|^\s*\d+px\s/.test(line);
    const probe = (isShadow ? withoutShadowBlack : line).replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,[^)]*\)/g, '');
    if (/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(probe)) issues.color.push(`${rel(f)}:${i + 1}`);
    if (/font(-family)?\s*:[^;]*(STXingkai|华文行楷|Songti|STSong|SimSun|Noto Serif|monospace|Consolas|LXGW|WenKai)/i.test(line)) issues.font.push(`${rel(f)}:${i + 1}  ${line.trim().slice(0, 70)}`);
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
