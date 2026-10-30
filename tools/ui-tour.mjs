// 前台截图巡检：登录无关，直接打开 /footprints，按 ONLY=名称,... 只截指定界面。
// 用法：node tools/ui-tour.mjs http://localhost:8092 /tmp/out   （W=390 H=844 截手机）

// 前台各主要界面截图：整球首屏 / 国内 / 足迹卡+照片环 / 省份卡片 / 城记 / 城市图片墙 / 票根册 / 洞察 / 书架 / 2D
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = process.argv[2] || 'http://localhost:8092';
const OUT = process.argv[3] || '/tmp/fp-ui/now'; mkdirSync(OUT, { recursive: true });
const W = +(process.env.W || 1440), H = +(process.env.H || 900);
const PORT = 9370; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`,
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', `--user-data-dir=/tmp/fp-ui-profile-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
let ws; for (let i = 0; i < 60; i++) { try { const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; } } catch {} await sleep(300); }
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0]); });
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'ERR ' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const click = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
const esc = async () => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(1200); };
const go = async () => { await send('Page.navigate', { url: `${ORIGIN}/footprints` }); for (let i = 0; i < 80 && !(await ev('!!window.FootprintMemoryData && !!window.__fpScene')); i++) await sleep(250); await sleep(6500); };
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 700 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./ui-tour-inject.js', import.meta.url), 'utf8') });
const only = (process.env.ONLY || '').split(',').filter(Boolean); const want = (n) => !only.length || only.includes(n);
await go();
await ev(`(() => { const b = document.getElementById('rotateBtn'); if (b && b.classList.contains('active')) b.click(); })()`);
if (want('01-globe')) await shot('01-globe');
// 国内范围
await ev(`__fpScene.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(112, 31, 3600000) })`); await sleep(3500);
if (want('02-china')) await shot('02-china');
// 点省份（广东）展开省份卡片
if (want('03-province')) { const p = JSON.parse(await ev(`JSON.stringify(Cesium.SceneTransforms.worldToWindowCoordinates(__fpScene, Cesium.Cartesian3.fromDegrees(113.4, 23.4)))`)); await click(p.x, p.y); await sleep(2600); await shot('03-province'); await esc(); }
// 点一个城市标记：城市卡
if (want('04-citycard')) { const t = JSON.parse(await ev(`JSON.stringify((() => { const now = Cesium.JulianDate.now(); for (const e of __fpEntities.values) { if (!e.billboard || e.show === false) continue; const p = e.position?.getValue(now); const s = p && Cesium.SceneTransforms.worldToWindowCoordinates(__fpScene, p); if (s && s.x > 400 && s.x < innerWidth - 400 && s.y > 200 && s.y < innerHeight - 200) return { x: s.x, y: s.y }; } })())`) || 'null');
  if (t) { await click(t.x, t.y); await sleep(1800); await shot('04-citycard'); } await esc(); }
// 贴近杭州：足迹点 + 足迹卡 + 照片环
if (want('05-footprint')) { await ev(`__fpScene.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(120.15, 30.25, 90000) })`); await sleep(4500);
  const t = JSON.parse(await ev(`JSON.stringify((() => { const now = Cesium.JulianDate.now(); for (const e of __fpEntities.values) { if (!e.billboard || e.show === false) continue; const w = e.billboard.width?.getValue(now); if (!(w > 0)) continue; const p = e.position?.getValue(now); const s = p && Cesium.SceneTransforms.worldToWindowCoordinates(__fpScene, p); if (s && s.x > 200 && s.x < innerWidth - 200 && s.y > 150 && s.y < innerHeight - 150) return { x: s.x, y: s.y }; } })())`) || 'null');
  if (t) { await click(t.x, t.y); await sleep(2600); await shot('05-footprint'); } await esc(); await esc(); }
await go();
if (want('06-citywall')) { await ev(`document.getElementById('cityWallBtn').click()`); await sleep(2500); await shot('06-citywall');
  if (want('07-cityview')) { await ev(`document.querySelector('#cityWall [data-ci], #cityWall .city-wall-card, #cityWall button')?.click()`); await sleep(2500); await shot('07-cityview'); await esc(); }
  if (want('08-insight')) { await ev(`document.getElementById('cityWallInsightBtn')?.click()`); await sleep(2500); await shot('08-insight'); await esc(); }
  await esc(); }
await go();
if (want('09-tickets')) { await ev(`document.getElementById('ticketGalleryBtn').click()`); await sleep(3000); await shot('09-tickets'); await esc(); }
if (want('10-shelf')) { await ev(`document.getElementById('memoryShelfBtn').click()`); await sleep(6000); await shot('10-shelf'); await esc(); }
if (want('11-2d')) { await ev(`document.getElementById('sceneModeBtn').click()`); await sleep(6000); await shot('11-2d'); }
console.log(JSON.stringify({ errs: errs.slice(0, 5) }));
chrome.kill(); process.exit(0);
