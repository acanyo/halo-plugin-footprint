/**
 * 「世界这本书」的视觉自检（十几秒跑完）
 *
 * 用途：每次动书体几何 / 材质 / 页面版式后先跑它，能在几秒内抓到
 * "面翻反面、整块消失、贴图错位、控制台报错"这类硬伤——这类问题肉眼要翻到
 * 特定角度才看得见，靠人眼逐个姿势去试很容易漏。
 *
 * 用法（开发实例要在 8090 上跑着）：
 *     node tools/shelf-visual-check.mjs
 * 输出：tools/.visual-check/*.png（书架 / 翻开 / 翻页后 / 合书后）与一路的控制台记录。
 *
 * 依赖：本机 Chrome（路径见 CHROME 常量）、Node 18+（自带 fetch/WebSocket）。
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CHROME = process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = process.env.PAGE_URL || 'http://localhost:8090/footprints?view=books';
const OUT = 'tools/.visual-check';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const profile = `${process.env.TEMP || '/tmp'}/shelf-visual-check-${Date.now()}`;
const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--remote-debugging-address=127.0.0.1', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--window-size=1600,1000', `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

const bail = (message) => {
    console.error(message);
    try { chrome.kill(); } catch (e) { /* 忽略 */ }
    process.exit(1);
};

let ws = null;
try {
    await sleep(3000);
    const targets = await (await fetch(`${BASE}/json/list`)).json();
    const target = targets.find((t) => t.type === 'page');
    if (!target) bail('没有找到可用的页面 target');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
} catch (error) {
    bail('连不上 CDP（Chrome 没起来？）：' + error.message);
}

let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'log') {
        logs.push(`[${msg.params.type}] ` +
            msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 160));
    } else if (msg.method === 'Runtime.exceptionThrown') {
        logs.push('[exception] ' + String(
            msg.params.exceptionDetails.exception?.description ||
            msg.params.exceptionDetails.text).slice(0, 160));
    }
});
const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq; pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result?.result?.value;
};
const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.result.data, 'base64');
    writeFileSync(`${OUT}/${name}`, buf);
    return `${name} md5=${createHash('md5').update(buf).digest('hex').slice(0, 8)}`;
};
const drag = async (x, y, dx, dy) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await send('Input.dispatchMouseEvent',
        { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 12; i += 1) {
        await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved', x: Math.round(x + (dx * i) / 12),
            y: Math.round(y + (dy * i) / 12), button: 'left', buttons: 1
        });
        await sleep(20);
    }
    await send('Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
    await sleep(800);
};
const key = async (name, code) => {
    for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    }
    await sleep(700);
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: PAGE });
await sleep(15000);

const out = [];
out.push(await shot('1-shelf.png'));
const box = JSON.parse(await evaluate(`JSON.stringify((() => {
  const r = document.querySelector('.ms-canvas')?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })())`));
if (!box) bail('书架的 canvas 没出现——插件没加载或 WebGL 起不来');
// 当前这本在画面里的竖直位置会随信息板宽度/画幅变，所以按几个候选点试点，
// 直到进入 book-mode（否则这个自检本身会偶发误报）
let opened = false;
const clickY = [40, -40, 120, -120, 0];
for (const offset of clickY) {
    const x = Math.round(box.x + box.w / 2);
    const y = Math.round(box.y + box.h / 2) + offset;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', {
            type, x, y, button: 'left', clickCount: 1,
            buttons: type === 'mousePressed' ? 1 : 0
        });
    }
    await sleep(3200);
    opened = await evaluate(`document.getElementById('memoryShelf')?.classList.contains('book-mode')`);
    if (opened) break;
}
out.push(await shot('2-opened.png'));

// 拖拽翻页一次（这次改动最容易碰到的路径），再键盘回翻一次
await drag(Math.round(box.x + box.w * 0.62), Math.round(box.y + box.h * 0.5), -180, 0);
out.push(await shot('3-after-page-drag.png'));
await key('ArrowLeft', 37);
out.push(await shot('4-after-page-key.png'));

// 合书回架
await key('Escape', 27);
await sleep(1800);
const closed = await evaluate(`document.getElementById('memoryShelf')?.classList.contains('book-mode')`);
out.push(await shot('5-back-to-shelf.png'));

console.log(out.join('\n'));
console.log('翻开成功:', opened, ' 合书成功:', closed === false);
console.log('左侧竖栏:', await evaluate(`(() => {
  const rail = document.getElementById('msRail');
  const items = rail ? rail.querySelectorAll('[data-ms-rail]').length : 0;
  const wordEl = document.querySelector('.ms-rail-word');
  const wordRect = wordEl ? wordEl.getBoundingClientRect() : null;
  const card = document.querySelector('.ms-info');
  return (rail ? '有轨道(' + items + '条)' : '无轨道') + ' / 词标:' + (wordEl ? '有' : '无')
    + (wordRect ? '(' + Math.round(wordRect.left) + ',' + Math.round(wordRect.top)
        + ' ' + Math.round(wordRect.width) + 'x' + Math.round(wordRect.height) + ')' : '')
    + ' / 卡片左边距:' + (card ? Math.round(card.getBoundingClientRect().left) : '-') + 'px';
})()`));
console.log('phase:', await evaluate(`window.__footprintPhase || '(未设置)'`));
const unique = [...new Set(logs)];
console.log('控制台警告/异常:', unique.length ? '\n  ' + unique.join('\n  ') : '（无）');

ws.close();
try { chrome.kill(); } catch (e) { /* 忽略 */ }
try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
process.exit(unique.length ? 2 : 0);
