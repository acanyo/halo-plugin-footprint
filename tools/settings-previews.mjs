#!/usr/bin/env node
/**
 * 生成插件设置里 toggle 选项的效果图（static/img/settings/*.webp）。
 *
 * 每个选项：拦截 /footprints 的 HTML，把 FOOTPRINT_CONFIG 里对应的那一项改成该选项，
 * 打开对应界面，裁一块区域存成 WebP。不改开发实例的任何设置。
 *
 * 示意照片：开发数据往往只有一张图，效果图会千篇一律。设了 SAMPLE_PHOTOS=<目录> 时，
 * 把页面上请求的足迹图片按 URL 轮流换成该目录里的 jpg（只在这个测试浏览器里换）。
 *
 * 用法（开发实例跑着时，在仓库根）：
 *   node tools/settings-previews.mjs [http://localhost:8092]
 * 只重做某几项：ONLY=markerStyle,highlightScheme node tools/settings-previews.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/main/resources/static/img/settings');
const ORIGIN = process.argv[2] || 'http://localhost:8092';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const PORT = 9420 + Math.floor(Math.random() * 40);
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });
const SAMPLES = process.env.SAMPLE_PHOTOS
  ? readdirSync(process.env.SAMPLE_PHOTOS).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => readFileSync(join(process.env.SAMPLE_PHOTOS, f)))
  : [];
const sampleFor = new Map();   // 同一张原图始终换成同一张示意图

const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`,
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--user-data-dir=/tmp/fp-previews-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 60; i++) {
  try { const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; } } catch {}
  await sleep(300);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); let override = {};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params;
    if (/\/footprints(\?|$)/.test(request.url)) {
      let html = await (await fetch(request.url)).text();
      // 只覆盖 FOOTPRINT_CONFIG 里的那几个字符串字段
      for (const [k, v] of Object.entries(override)) {
        html = html.replace(new RegExp(`(\\b${k}:\\s*)("[^"]*"|'[^']*'|null)`), `$1${JSON.stringify(v)}`);
      }
      // 标记样式还由服务端写进 <body class="… marker-style-xxx">；前台脚本再按配置加一个，两个同时在就会混样式
      if (override.markerStyle) html = html.replace(/(<body[^>]*class="[^"]*)marker-style-[a-z]+/, `$1marker-style-${override.markerStyle}`);
      // 开发数据常常所有足迹都指向同一张图：给每处图片地址加一个序号，浏览器才会分别请求，
      // 下面的拦截再按序号换成不同的示意图
      if (SAMPLES.length) {
        let k = 0;
        // 模板内联 JSON 会把 / 转义成 \/，两种写法都要认
        html = html.replace(/(\\?\/upload\\?\/[^"'\s?\\]+\.(?:jpe?g|png|webp))/gi, (m) => `${m}?fp-sample=${k++}`);
      }
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html).toString('base64') });
      return;
    }
    // 足迹图片：/upload/… 及其缩略图、图片代理
    if (SAMPLES.length && /\/(upload|thumbnails)\/|image-proxy/.test(request.url) && !/\.(js|css)(\?|$)/.test(request.url)) {
      const n = /fp-sample(?:=|%3D)(\d+)/.exec(request.url);
      let body;
      if (n) body = SAMPLES[Number(n[1]) % SAMPLES.length];
      else {
        if (!sampleFor.has(request.url)) sampleFor.set(request.url, SAMPLES[sampleFor.size % SAMPLES.length]);
        body = sampleFor.get(request.url);
      }
      send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: body.toString('base64') });
      return;
    }
    send('Fetch.continueRequest', { requestId });
  }
});
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(250); } return false; };
const click = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
const OUT_WIDTH = 400;
const shot = async (name, clip) => {
  // 视口是 2 倍像素：输出宽 = clip.width × scale × 2
  const scale = OUT_WIDTH / (clip.width * 2);
  const r = await send('Page.captureScreenshot', { format: 'webp', quality: 80, clip: { ...clip, scale } });
  writeFileSync(join(OUT, `${name}.webp`), Buffer.from(r.result.data, 'base64'));
  console.log('  ✓', name);
};
await send('Page.enable'); await send('Runtime.enable');
// 拿到 Cesium 场景引用，便于摆相机（只在这个测试浏览器里注入）
await send('Page.addScriptToEvaluateOnNewDocument', { source: (await import('node:fs')).readFileSync(join(ROOT, 'tools/ui-tour-inject.js'), 'utf8') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/footprints*', requestStage: 'Request' }, ...(SAMPLES.length ? [{ urlPattern: '*/upload/*', requestStage: 'Request' }, { urlPattern: '*/thumbnails/*', requestStage: 'Request' }, { urlPattern: '*image-proxy*', requestStage: 'Request' }] : [])] });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });

const open = async (cfg) => {
  override = cfg;
  // 上一张图可能切到了 2D：视图模式记在 localStorage 里，每次都回到 3D 起步
  await send('Page.navigate', { url: `${ORIGIN}/footprints` });
  await ev(`try { localStorage.setItem('travelMemoryViewMode', '3d'); } catch (e) {}`);
  await send('Page.navigate', { url: `${ORIGIN}/footprints` });
  await waitFor('!!window.FootprintMemoryData');
  await sleep(2500);
};
const to2D = async () => {
  await ev(`document.getElementById('sceneModeBtn').click()`);
  await waitFor(`document.querySelectorAll('.amap-marker').length > 3`, 20000);
  await sleep(3500);
};
const want = (k) => !ONLY.length || ONLY.includes(k);
// 2D 页：在某个城市的标记上滚轮放大几格，让标记散开（全国视野下标记会叠成一团）
// 效果图只要地图和标记：把 2D 页的控制栏、统计、标题收起来
const hide2DChrome = () => ev(`(() => { const st = document.createElement('style'); st.textContent = '.map-controls,#map-stats,.logo-container,#topNav{visibility:hidden!important}'; document.head.appendChild(st); })()`);
async function zoomTo2D(name) {
  const t = await ev(`(() => { const o = [...document.querySelectorAll('.amap-marker')].map(m => ({ r: m.getBoundingClientRect(), t: m.textContent.replace(/\\s+/g, '') })).find(o => o.t.includes(${JSON.stringify(name)})); return o && { x: o.r.x + o.r.width / 2, y: o.r.y + o.r.height / 2 }; })()`);
  if (!t) return;
  for (let i = 0; i < 5; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: t.x, y: t.y, deltaX: 0, deltaY: -260 });
    await sleep(260);
  }
  await sleep(2600);
}
if (want('markerStyle')) {
  console.log('markerStyle');
  for (const v of ['pin', 'circle', 'card', 'photo']) {
    await open({ markerStyle: v });
    await to2D();
    await hide2DChrome();
    await zoomTo2D('杭州');
    // 裁地图中央一块：标记最密的地方
    const c = await ev(`(() => { const rs = [...document.querySelectorAll('.amap-marker')].map(m => m.getBoundingClientRect()).filter(r => r.width > 6 && r.x > 0 && r.y > 0 && r.x < innerWidth && r.y < innerHeight); if (!rs.length) return { x: 720, y: 450 }; rs.sort((a, b) => a.x - b.x); const m = rs[Math.floor(rs.length / 2)]; return { x: m.x, y: m.y }; })()`);
    await shot(`marker-${v}`, { x: Math.max(0, Math.min(W - 400, c.x - 200)), y: Math.max(0, Math.min(H - 300, c.y - 150)), width: 400, height: 300 });
  }
}
if (want('highlightScheme')) {
  console.log('highlightScheme');
  for (const v of ['glow', 'pulse', 'bounce', 'ring']) {
    await open({ highlightScheme: v, markerStyle: 'photo' });
    await to2D();
    await hide2DChrome();
    await zoomTo2D('杭州');
    // 高亮一个标记（与时间线悬停时一样，加 marker-highlight），等动画走到最明显的那一刻
    const c = await ev(`(() => { const ms = [...document.querySelectorAll('.amap-marker')].map(m => ({ m, r: m.getBoundingClientRect() })).filter(o => o.r.width > 6 && o.r.x > 300 && o.r.x < innerWidth - 300 && o.r.y > 200 && o.r.y < innerHeight - 200); const o = ms[0]; if (!o) return null; o.m.classList.add('marker-highlight'); return { x: o.r.x + o.r.width / 2, y: o.r.y + o.r.height / 2 }; })()`);
    await sleep(v === 'pulse' ? 700 : 450);
    const p = c || { x: 720, y: 450 };
    await shot(`highlight-${v}`, { x: p.x - 130, y: p.y - 110, width: 260, height: 200 });
  }
}
if (want('globeLabels')) {
  console.log('globeLabels');
  // 用无字卫星底图：画面上只有插件自己的标注，三种模式的区别才看得出来
  for (const v of ['off', 'city', 'all']) {
    await open({ globeLabels: v });
    await ev(`try { localStorage.setItem('travelMemoryBaseMap', 'amapImgClean'); } catch (e) {}`);
    await send('Page.navigate', { url: `${ORIGIN}/footprints` });
    await waitFor('!!window.FootprintMemoryData && !!window.__fpScene');
    await sleep(2500);
    await ev(`(() => { const b = document.getElementById('rotateBtn'); if (b && b.classList.contains('active')) b.click(); })()`);
    // 关闭 / 只城市：停在城市聚合层（华中一带，城市名最多）；城市 + 足迹：拉近到江浙沪，足迹点展开。
    // 裁一块 400×300 的原尺寸区域（不缩小）：效果图只有 400px 宽，裁大了再缩，12px 的地名会糊成看不清的小点，
    // 「关闭」和「只城市」两张就看不出区别
    const view = v === 'all' ? [120.2, 30.3, 150000] : [113.5, 30.5, 2000000];
    await ev(`window.__fpScene.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(${view.join(',')}) })`);
    await sleep(5000);
    await shot(`globe-labels-${v}`, { x: W / 2 - 200, y: H / 2 - 150, width: 400, height: 300 });
  }
}
if (want('ticketGalleryStyle')) {
  console.log('ticketGalleryStyle');
  for (const v of ['fan', 'strip']) {
    await open({ ticketGalleryStyle: v });
    await ev(`document.getElementById('ticketGalleryBtn').click()`);
    await sleep(3200);
    await shot(`ticket-${v}`, { x: 0, y: 0, width: W, height: H });
  }
}
chrome.kill();
process.exit(0);
