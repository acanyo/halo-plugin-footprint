#!/usr/bin/env node
/**
 * README 截图：打开开发实例的 /footprints，按顺序截首屏、城市卡、足迹卡、城记、票根册、
 * 书架、2D 地图、2D 信息卡，存成 .github/readme/*.webp（宽 1600，WebP 质量 82）。
 *
 * 示意照片：设了 SAMPLE_PHOTOS=<目录> 时，把页面上请求的足迹图片轮流换成该目录里的 jpg
 * （只在这个测试浏览器里换，和 settings-previews.mjs 同一个做法），截图不会露出开发数据里的占位图。
 * 主题色固定用默认淡紫（README 展示的是装好插件后的默认样子），不读开发实例里保存的颜色。
 *
 * 用法（开发实例跑着时，在仓库根）：
 *   SAMPLE_PHOTOS=/path/to/jpgs node tools/readme-shots.mjs [http://localhost:8092]
 * 只重截某几张：ONLY=globe,citycard node tools/readme-shots.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.github/readme');
const ORIGIN = process.argv[2] || 'http://localhost:8092';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1440, H = 900;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
mkdirSync(OUT, { recursive: true });

const SAMPLES = process.env.SAMPLE_PHOTOS
  ? readdirSync(process.env.SAMPLE_PHOTOS).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => readFileSync(join(process.env.SAMPLE_PHOTOS, f)))
  : [];

const PORT = 9471;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`,
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--user-data-dir=/tmp/fp-readme-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
let ws;
for (let i = 0; i < 60; i++) {
  try {
    const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page');
    if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
  } catch { /* 浏览器还没起来 */ }
  await sleep(300);
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const errs = [];
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const waitFor = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(250); } return false; };
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const esc = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(1200); };

// 页面 HTML：主题色换回默认淡紫；开发数据常常所有足迹都指向同一张图，给每处图片地址加一个序号，
// 浏览器才会分别请求，下面再按序号换成不同的示意图
const sampleOf = new Map();
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  if (/\/footprints(\?|$)/.test(request.url)) {
    let html = await (await fetch(request.url)).text();
    html = html.replace(/(\baccentColor:\s*)("[^"]*"|'[^']*'|null)/, '$1"#7c7bc0"');
    if (SAMPLES.length) {
      let k = 0;
      // 模板内联 JSON 会把 / 转义成 \/，两种写法都要认
      html = html.replace(/(\\?\/upload\\?\/[^"'\s?\\]+\.(?:jpe?g|png|webp))/gi, (s) => `${s}?fp-sample=${k++}`);
    }
    send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(html).toString('base64') });
    return;
  }
  if (SAMPLES.length && /\/(upload|thumbnails)\/|image-proxy/.test(request.url) && !/\.(js|css)(\?|$)/.test(request.url)) {
    const n = /fp-sample(?:=|%3D)(\d+)/.exec(request.url);
    let index;
    if (n) index = Number(n[1]);
    else {
      if (!sampleOf.has(request.url)) sampleOf.set(request.url, sampleOf.size);
      index = sampleOf.get(request.url);
    }
    send('Fetch.fulfillRequest', { requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: SAMPLES[index % SAMPLES.length].toString('base64') });
    return;
  }
  send('Fetch.continueRequest', { requestId });
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(join(ROOT, 'tools/ui-tour-inject.js'), 'utf8') });
await send('Fetch.enable', { patterns: [{ urlPattern: '*/footprints*', requestStage: 'Request' },
  ...(SAMPLES.length ? [{ urlPattern: '*/upload/*', requestStage: 'Request' }, { urlPattern: '*/thumbnails/*', requestStage: 'Request' }, { urlPattern: '*image-proxy*', requestStage: 'Request' }] : [])] });

const shot = async (name, clip) => {
  const scale = 1600 / ((clip ? clip.width : W) * 2);
  const r = await send('Page.captureScreenshot', { format: 'webp', quality: 82, ...(clip ? { clip: { ...clip, scale } } : { clip: { x: 0, y: 0, width: W, height: H, scale } }) });
  writeFileSync(join(OUT, `${name}.webp`), Buffer.from(r.result.data, 'base64'));
  console.log('  ✓', name);
};
const open3D = async () => {
  await send('Page.navigate', { url: `${ORIGIN}/footprints` });
  await ev(`try { localStorage.setItem('travelMemoryViewMode', '3d'); localStorage.setItem('travelMemoryAutoRotate', '0'); localStorage.setItem('travelMemoryBaseMap', 'amapImgClean'); } catch (e) {}`);
  await send('Page.navigate', { url: `${ORIGIN}/footprints` });
  await waitFor('!!window.FootprintMemoryData && !!window.__fpScene');
  await sleep(7000);
};
const screenOf = (lng, lat) => ev(`JSON.stringify(Cesium.SceneTransforms.worldToWindowCoordinates(__fpScene, Cesium.Cartesian3.fromDegrees(${lng}, ${lat})))`).then(JSON.parse);
// 视口中部第一个看得见的标记（城市圆点或足迹点）
const visibleMarker = () => ev(`JSON.stringify((() => { const now = Cesium.JulianDate.now(); for (const e of __fpEntities.values) { if (!e.billboard || e.show === false) continue; const w = e.billboard.width?.getValue(now); if (!(w > 0)) continue; const p = e.position?.getValue(now); const s = p && Cesium.SceneTransforms.worldToWindowCoordinates(__fpScene, p); if (s && s.x > 380 && s.x < innerWidth - 380 && s.y > 200 && s.y < innerHeight - 200) return { x: s.x, y: s.y }; } return null; })())`).then(JSON.parse);

await open3D();

if (want('globe')) await shot('globe');

if (want('province')) {
  // 「全部城市」：每座去过的城市一张小卡片，从城市圆点拉一条引线连过去（会先自动飞到能看见中国轮廓的高度）
  await ev(`document.getElementById('provinceAllBtn').click()`);
  await waitFor(`document.querySelectorAll('.prop-city-card.show').length > 3`, 12000);
  await sleep(2500);
  await shot('province');
  await esc();
}

if (want('footprint')) {
  await ev(`__fpScene.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(120.15, 30.25, 90000) })`);
  await sleep(5000);
  const t = await visibleMarker();
  if (t) { await click(t.x, t.y); await sleep(3000); await shot('footprint'); }
  await esc(); await esc();
}

if (want('citywall')) {
  await open3D();
  await ev(`document.getElementById('cityWallBtn').click()`);
  await sleep(3000);
  await shot('citywall');
  await esc();
}

if (want('tickets')) {
  await open3D();
  await ev(`document.getElementById('ticketGalleryBtn').click()`);
  await sleep(3500);
  await shot('tickets');
  await esc();
}

if (want('shelf')) {
  await open3D();
  await ev(`document.getElementById('memoryShelfBtn').click()`);
  await sleep(8000);
  await shot('shelf');
  await esc();
}

if (want('map2d') || want('infocard')) {
  await open3D();
  await ev(`document.getElementById('sceneModeBtn').click()`);
  await waitFor(`document.querySelectorAll('.amap-marker').length > 3`, 20000);
  await sleep(5000);
  if (want('map2d')) await shot('map2d');
  if (want('infocard')) {
    // 点一个露在屏幕中部、看得见的标记，等地图飞过去、信息卡弹出
    const t = await ev(`JSON.stringify((() => { const m = [...document.querySelectorAll('.amap-marker')].map(el => ({ el, r: el.getBoundingClientRect() })).find(o => o.r.width > 8 && o.r.x > 500 && o.r.x < innerWidth - 500 && o.r.y > 250 && o.r.y < innerHeight - 200 && getComputedStyle(o.el).visibility !== 'hidden'); return m ? { x: m.r.x + m.r.width / 2, y: m.r.y + m.r.height / 2 } : null; })())`).then(JSON.parse);
    if (t) {
      await click(t.x, t.y);
      await waitFor(`!!document.querySelector('.info-window')`, 8000);
      await sleep(1800);
      await shot('infocard');
    }
  }
}

console.log(JSON.stringify({ errs: errs.slice(0, 5) }));
chrome.kill();
process.exit(0);
