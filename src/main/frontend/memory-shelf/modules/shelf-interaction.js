/**
 * L1 书架的交互：显式五态、选书、点击 / 拖拽 / 长按旋转 / 滚轮等舞台事件。
 */

import { LONG_PRESS_MS, ROTATE_LIMIT, OPEN_ANIM_MS } from './constants.js';
import { applyRoomTheme } from './room-theme.js';
import { state, els, shelf, reduceMotion } from './state.js';
import { layoutShelf, applyActiveRotation } from './shelf-scene.js';
import { clamp, setTimer } from './utils.js';
import { attachCoverPhoto } from './cover-photos.js';
import { pickBookIndex } from './shelf-render-loop.js';
import { syncLeftRail, updateInfo, renderFallbackShelf } from './shelf-dom.js';
import { openChapters } from './chapters.js';
import { openAlbum } from './album.js';
import { playCue } from './audio.js';
import { INSPECT_PITCH_MAX, book } from './book-rig.js';
import { prepareBookPages } from './book-open.js';
import {
    turnToPage,
    settleTurnNow,
    beginPageTurn,
    dragPageTurn,
    settlePageTurn,
    pickRowHit
} from './page-turn.js';

// ---------------- L1 书架：交互 ----------------


// ---- 显式五态：状态切换都从这里走（顺带挂一个只读全局量便于排查）----
var SHELF_PHASES = ['shelf', 'opening', 'inspection', 'reading', 'closing'];
export function setPhase(next) {
    if (SHELF_PHASES.indexOf(next) < 0 || state.phase === next) return;
    state.phase = next;
    try { window.__footprintPhase = next; } catch (e) { /* 忽略 */ }
}
export function setActive(index) {
    if (state.opening) return;
    // ③ 只在书架态可用。阅读态点左缘的省名会把**底下那本**悄悄换掉：实测
    // 摊开的是"山东"、点一下"浙江"，书一个字没变、bookMode 还是 true，但底层
    // 已切到浙江 —— 按 Esc 回书架，看到的书和你刚才翻开的那本对不上。
    // （方向键那条路是安全的：keydown 里 state.mode === 'book' 的分支会先返回，
    // 把左右键让给翻页；舞台滚轮在书本模式下也只缩放。）
    // ⚠️ 判据用 state.mode 而不是 state.phase：exitBookMode() 和 close() 都会
    // 复位 mode，而 close() **不复位 phase** —— 阅读中途关掉覆盖层再打开，
    // phase 可能还停在 reading，用 phase 做守卫会把正常的书架点击一起挡掉。
    if (state.mode !== 'shelf') return;
    var total = state.books.length;
    if (!total) return;
    var next = ((index % total) + total) % total;
    var changed = next !== state.active;
    // ⑤ 方向感：把"这次是往书脊轨的哪一头走"写进 --ms-dir（1 = 往下，-1 = 往上），
    // 进场/退场的竖直位移按它取正负 —— 动作本身就能"说出"你在往哪翻，
    // 而不是不管上翻下翻都从左边滑进来、一律往上退。索引顺序就是书脊轨的
    // 上下顺序，所以比较索引即可（10 → 0 这种回绕也会正确读成"往上走"）。
    if (changed && els.root) {
        els.root.style.setProperty('--ms-dir', next > state.active ? '1' : '-1');
    }
    state.active = next;
    if (changed) playCue('navigate');
    state.bookRotation = null;
    // 这里必须是「非即时」：点了右侧某一本，它要转着滑到中间去，而不是瞬移
    layoutShelf(false);
    syncLeftRail();
    // 整间屋子跟着换色（墙、地、木架、灯、雾 + 信息板的强调色）
    if (changed) applyRoomTheme(next);
    if (changed) updateInfo();
    if (shelf && shelf.rigs[next]) {
        attachCoverPhoto(shelf.rigs[next]);
    } else if (!shelf && state.level === 'shelf') {
        renderFallbackShelf();      // CSS 回退模式没有 WebGL 状态，直接重排卡片
    }
}

export function openActiveBook() {
    var book = state.books[state.active];
    if (!book || state.opening) return;
    state.opening = true;
    setPhase('opening');
    playCue('select');
    // 这一秒是"把书抽出来 + 封面掀开"的过程，里面那两页（省份信息 / 城市列表）
    // 现在就贴好，动画里就能看到内容，而不是两张白纸
    prepareBookPages(book);
    // 左侧信息板**立刻**开始缩回，不等那一秒的"抽出来"动画跑完。
    // 这个类原来是在 loadBookPages 里加的（也就是动画结束时），于是信息板
    // 要等书完全摊开才开始让位。提前到这里，点下去就和抽书同时收。
    if (els.root) els.root.classList.add('book-mode');
    // 同样交给补间：先把书抬到中间、镜头推近、封面翻开，再切章节页
    layoutShelf(false);
    setTimer('open', function () {
        state.opening = false;
        if (!els.root || !els.root.classList.contains('show')) return;
        openChapters(book);
    }, reduceMotion ? 0 : OPEN_ANIM_MS);
}

// 已翻开的书上点一下：命中右页某一行 → 进相册。
// 这里**不再**把「点左页」当成返回上一级：翻页本来就是拖拽/方向键，
// 手一抖点在左边那叠纸上就会被弹回城市章节，还会顺带闪一下书架。
// 返回改由顶栏那个「‹ 返回城市章节」按钮和 Esc 负责。
function onBookClick(event) {
    // 封面不接受点击开合：翻书只用拖拽（用户明确要求去掉点击效果）。
    // 合着的时候点在书上什么都不做，避免误触把书打开。
    if (state.bookOpen < 0.85) return;
    var hit = pickRowHit(event);
    if (hit) {
        // 用命中的那一页去找城市（可能是左页的城市章节，也可能是右页的目录）。
        // 目录行自带 city + spread（足迹点行能直接跳到相册里对应的那一跨），
        // 城市章节页的行没有这两个字段，就按行号回到它的城市分片。
        var row = hit.spec.rows && hit.spec.rows[hit.index];
        var city = (row && row.city) || (hit.spec.cities && hit.spec.cities[hit.index]);
        // 城市内容已经排在同一本书里，所以这里是**翻页过去**，不是换一套页集
        // （用户要的：不刷新、页码不重置）。row.pageIndex 是那一页在本书里的下标。
        if (row && row.pageIndex !== undefined) { turnToPage(row.pageIndex); return; }
        if (city) openAlbum(state.province, city, row && row.spread);
        return;
    }
}

// 拖拽起点落在左页还是右页：决定这次翻页是往前还是往回
// 指针是不是落在书本本体上（含封面、书脊、书页块）：只有落在书本之外
// 才允许用拖拽移动整本书，否则「拖了但没有页可翻」会莫名其妙把书拖走。
function bookHitTest(event) {
    if (!book || !shelf) return false;
    var rect = els.stage.getBoundingClientRect();
    var pointer = new shelf.THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    shelf.raycaster.setFromCamera(pointer, shelf.camera);
    return shelf.raycaster.intersectObject(book.group, true).length > 0;
}

function bookPageSide(event) {
    if (!book || !shelf) return '';
    var rect = els.stage.getBoundingClientRect();
    var pointer = new shelf.THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    shelf.raycaster.setFromCamera(pointer, shelf.camera);
    var meshes = [];
    book.leaves.forEach(function (leaf) { meshes.push(leaf.front.mesh, leaf.back.mesh); });
    if (book.insideMesh) meshes.push(book.insideMesh);
    var hits = shelf.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return '';
    // 掀开的封面（内侧扉页）算左页，拖它就是把封面合回去
    if (book.insideMesh && hits[0].object === book.insideMesh) return 'left';
    var hit = book.leaves.find(function (leaf) {
        return leaf.front.mesh === hits[0].object || leaf.back.mesh === hits[0].object;
    });
    if (!hit) return '';
    // 这片叶翻到什么程度，决定它现在算左页还是右页
    return hit.pivot.rotation.y > -1.2 ? 'right' : 'left';
}

export function bindStage() {
    var stage = els.stage;
    if (!stage) return;

    var pointerId = null;
    var startX = 0;
    var moved = false;
    var mode = null;              // pending(可能旋转) | book(旋转中) | shelf(拖动书架)
    var holdTimer = 0;
    var rotationDistance = 150;

    function clearHold() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    }

    function beginRotation() {
        // 长按旋转当前这本：保留
        if (pointerId === null || mode !== 'pending') return;
        clearHold();
        mode = 'book';
        moved = true;
        state.bookRotation = 0;
        try { stage.setPointerCapture(pointerId); } catch (e) { /* 忽略 */ }
        stage.classList.add('rotating');
        // 走时间线：从「微侧身」转到正对读者是一段过渡，不是瞬移
        layoutShelf(false);
    }

    function finish(event) {
        if (state.mode === 'book') {
            // 松手/取消：光标从「抓取」回到「五指张开」
            stage.classList.remove('page-dragging');
            if (state.orbit) {
                state.orbit = null;
                try {
                    if (event && stage.hasPointerCapture(event.pointerId)) {
                        stage.releasePointerCapture(event.pointerId);
                    }
                } catch (e) { /* 忽略 */ }
                return;
            }
            if (state.coverDrag) {
                var cover = state.coverDrag;
                state.coverDrag = null;
                try {
                    if (event && stage.hasPointerCapture(event.pointerId)) {
                        stage.releasePointerCapture(event.pointerId);
                    }
                } catch (e) { /* 忽略 */ }
                // 拖过一半就定在那一侧；几乎没动就当成点击，切换开合
                // 拖过一半就定在那一侧；**没怎么动就保持原样**。
                // 之前这里把「没拖动」当成点击来切换开合，于是封面一被点
                // 就自动开/关，而且合上之后左边那块空位置还能点出封面来。
                state.openTarget = cover.moved ? (cover.p > 0.5 ? 1 : 0) : state.openTarget;
                state.suppressClickUntil = performance.now() + 260;
                return;
            }
            var drag = state.bookDrag;
            if (!drag) return;
            state.bookDrag = null;
            try {
                if (stage.hasPointerCapture(event && event.pointerId)) {
                    stage.releasePointerCapture(event.pointerId);
                }
            } catch (e) { /* 忽略 */ }
            if (drag.turning || state.pageTurn) {
                var turn = state.pageTurn;
                // 照 complete-shelf：看**拖到过的最远处**（peak），拖过 0.18 就翻过去。
                // 只看松手那一刻的 p 的话，「拖出去又收回来」会被判成没翻，
                // 手感上就是「我明明拖了它却弹回来」。
                settlePageTurn(!!turn && (drag.peak || 0) >= 0.18);
            }
            // 只有真的拖动了才吃掉随后的 click；单纯点一下要留给「点城市行进相册」
            if (drag.moved) state.suppressClickUntil = performance.now() + 260;
            return;
        }
        clearHold();
        if (pointerId === null || (event && event.pointerId !== pointerId)) return;
        try {
            if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
        } catch (e) { /* 忽略 */ }

        if (mode === 'book') {
            state.suppressClickUntil = performance.now() + 220;
            state.bookRotation = null;
            pointerId = null;
            mode = null;
            stage.classList.remove('rotating');
            layoutShelf(true);
            return;
        }
        if (mode === 'pending') { pointerId = null; mode = null; return; }

        // 书架上的拖动**不再切换书**（用户要求去掉）。这里只保留
        // 「拖动过就不触发点击」这一条，避免误点。
        if (moved) state.suppressClickUntil = performance.now() + 180;
        pointerId = null;
        mode = null;
        stage.classList.remove('dragging');
        layoutShelf(false);
    }

    stage.addEventListener('pointerdown', function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        // 舞台里的 DOM 按钮（复位视角）必须在这里放行：
        // 下面几条分支都会 setPointerCapture，而指针被舞台捕获之后，
        // 随后的 click 会派发给捕获者（舞台）而不是按钮 —— 按钮的
        // click 监听永远收不到事件。放行等于让浏览器按常规派发 click。
        if (event.target && event.target.closest && event.target.closest('.ms-view-reset')) return;
        if (state.mode === 'book') {
            if (!bookHitTest(event)) {
                // 只有书本之外才允许移动整本书：绕它旋转（按住 Shift 改成平移）
                state.orbit = {
                    startX: event.clientX, startY: event.clientY,
                    yaw: state.view.yaw, pitch: state.view.pitch,
                    panX: state.view.panX, panY: state.view.panY,
                    pan: !!event.shiftKey
                };
                try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
                return;
            }
            var side = bookPageSide(event);
            var closed = state.bookOpen < 0.5;
            // 合着时拖封面 = 掀开；翻开后停在第 0 跨页时拖内侧封面 = 合回去
            if (closed || (side === 'left' && state.bookSpread === 0 && !state.pageTurn)) {
                state.coverDrag = { startX: event.clientX, p: state.bookOpen, moved: false };
                playCue('select');
                stage.classList.add('page-dragging');
                try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
                return;
            }
            // 上一次翻页还没落完位（松手后的自动落页 / 点一下之后的弹回）：
            // 立刻把它收尾，别让它挡住这一次新的拖拽。
            // 不加这一步，连点两下想快速翻页时第二次按下去会被「已经有一页在翻」
            // 挡掉 —— 手感就是「点完书页之后马上拖，拖不动」。
            settleTurnNow();
            if (state.bookOpen < 0.85) return;
            if (!side) {
                // 落在书本上但不在任何一页上（书脊、书页块、封面外沿）：
                // 记一次「什么都不做」的拖拽，既不动书也不翻页，只用来吃掉随后的 click
                state.bookDrag = {
                    startX: event.clientX, startY: event.clientY,
                    forward: false, moved: false, turning: false
                };
                return;
            }
            // 无论这次能不能翻（比如这本只有一跨页），都要先把拖拽记下来：
            // 否则 pointerup 会因为拿不到 bookDrag 而提前返回，后面的 click
            // 就没被抑制，一次拖拽会被当成「点了右页的城市行」直接进相册。
            state.bookDrag = {
                startX: event.clientX,
                startY: event.clientY,
                // 方向**不在这里定**：照参考实现，往左拖 = 往后翻、往右拖 = 往前翻（把左边
                // 那页拉回来），跟手按在哪一页无关。等到第一次真的移动了，再按位移的
                // 符号起翻页 —— 这样在右页往右拖也能把左页翻回来（双向）。
                forward: null,
                moved: false,
                peak: 0,
                turning: false
            };
            stage.classList.add('page-dragging');
            try { stage.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
            return;
        }
        if (state.opening) return;
        // 用显式 phase 收口边界：正在抽出/合书时不接受新的点选，
        // 免得快速连点把"选中哪一本"和动画搅在一起（待办 6 收尾的收益点）
        if (state.phase === 'opening' || state.phase === 'closing') return;
        pointerId = event.pointerId;
        startX = event.clientX;
        moved = false;
        var pressedActive = pickBookIndex(event) === state.active;
        mode = pressedActive ? 'pending' : 'shelf';
        rotationDistance = 150;
        if (pressedActive) holdTimer = setTimeout(beginRotation, LONG_PRESS_MS);
    });

    stage.addEventListener('pointermove', function (event) {
        if (state.mode === 'book') {
            if (state.orbit) {
                var o = state.orbit;
                var rectO = stage.getBoundingClientRect();
                var dxO = event.clientX - o.startX;
                var dyO = event.clientY - o.startY;
                if (o.pan) {
                    state.view.panX = o.panX + dxO / Math.max(1, rectO.width) * 3.2;
                    state.view.panY = o.panY - dyO / Math.max(1, rectO.height) * 2.2;
                } else {
                    // 左右**不设限**（和 OrbitControls 一样可以一直转下去）
                    state.view.yaw = o.yaw + dxO * 0.006;
                    // 上下先按"能用"的范围存着，真正的下限在渲染帧里按
                    // 当前缩放距离精算（见 tick 里的 minPitch）
                    state.view.pitch = clamp(o.pitch + dyO * 0.004, -1.1, INSPECT_PITCH_MAX);
                }
                return;
            }
            if (state.coverDrag) {
                var cd = state.coverDrag;
                var dxC = event.clientX - cd.startX;
                if (Math.abs(dxC) > 4) cd.moved = true;
                // 合着时向左拖是掀开，翻开时向右拖是合上 —— 同一个公式都成立
                // 一次约半屏的拖动才走完整个开合：之前是 0.22 屏，
                // 拖一点点封面就翻到底，手感太急
                var spanC = Math.max(280, stage.getBoundingClientRect().width * 0.5);
                cd.p = clamp(cd.p - dxC / spanC, 0, 1);
                return;
            }
            if (!state.bookDrag) {
                // 悬停：书还合着时把鼠标压上去，封面裂开一线
                state.coverHover = state.bookOpen < 0.5 && !!bookPageSide(event);
                return;
            }
            var drag = state.bookDrag;
            if (!drag) return;
            var dxBook = event.clientX - drag.startX;
            var dyBook = event.clientY - drag.startY;
            if (Math.abs(dxBook) > 4) drag.moved = true;
            // 拖得越快纸拱得越高；纵向偏差变成纸的扭转
            var dt = Math.max(16, performance.now() - (drag.lastAt || performance.now()));
            var speed = Math.abs(dxBook - (drag.lastDx || 0)) / dt;
            drag.lastAt = performance.now();
            drag.lastDx = dxBook;
            // 第一次移动才定方向：位移向左 ⇒ 往后翻（forward）
            if (!drag.turning) {
                if (Math.abs(dxBook) < 6) return;        // 太小的抖动先不算
                drag.forward = dxBook < 0;
                drag.turning = beginPageTurn(drag.forward);
                if (!drag.turning) return;               // 那一头没有可翻的页
            }
            // 走完一整次翻页需要的指针行程。照 complete-shelf 取 ~150px：
            // 原来是舞台宽度的 34%（宽屏上 490px），手指/鼠标动了纸却几乎没动，
            // 读起来就是「拖拽有延迟」。
            var span = clamp(stage.getBoundingClientRect().width * 0.105, 130, 185);
            var progress = (drag.forward ? -dxBook : dxBook) / span;
            drag.peak = Math.max(drag.peak || 0, clamp(progress, 0, 1));
            dragPageTurn(progress, {
                speedResponse: Math.min(1, speed / 5.5),
                verticalBias: Math.max(-1, Math.min(1, dyBook / 160))
            });
            return;
        }
        // 没有按下时：只做悬停抬升
        if (pointerId === null) {
            if (shelf && !reduceMotion) shelf.hoverIndex = pickBookIndex(event);
            return;
        }
        if (event.pointerId !== pointerId) return;

        var totalDx = event.clientX - startX;
        if (mode === 'pending') {
            if (Math.abs(totalDx) > 6) beginRotation();
            else return;
        }
        if (mode === 'book') {
            event.preventDefault();
            state.bookRotation = Math.max(-ROTATE_LIMIT,
                Math.min(ROTATE_LIMIT, totalDx / rotationDistance * ROTATE_LIMIT));
            state.suppressClickUntil = performance.now() + 220;
            // 跟手：角度直接写，不走插值（只把这段补间的起点一起改掉）
            applyActiveRotation();
            return;
        }

        // 书架上不跟手平移、也不按拖动切书（那条交互已经去掉），
        // 这里的拖动只用来判定「拖过 = 不是点击」，别把一次拖拽误读成点选。
        if (!moved && Math.abs(totalDx) > 7) {
            moved = true;
            try { stage.setPointerCapture(pointerId); } catch (e) { /* 忽略 */ }
            stage.classList.add('dragging');
        }
    });

    stage.addEventListener('pointerup', finish);
    stage.addEventListener('pointercancel', finish);
    stage.addEventListener('pointerleave', function (event) {
        if (shelf) shelf.hoverIndex = -1;
        if (pointerId !== null && !stage.hasPointerCapture(pointerId)) finish(event);
    });

    stage.addEventListener('wheel', function (event) {
        event.preventDefault();
        if (state.mode === 'book') {
            // 检视态：滚轮缩放（规格里的 zoom）
            state.view.zoom = clamp(state.view.zoom * (event.deltaY > 0 ? 0.92 : 1.08), 0.6, 2.2);
            return;
        }
        var now = performance.now();
        if (now - state.wheelAt < 320) return;
        state.wheelAt = now;
        var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        setActive(state.active + (delta > 0 ? 1 : -1));
    }, { passive: false });

    stage.addEventListener('click', function (event) {
        if (performance.now() < state.suppressClickUntil) return;
        // （这里原来拦两个已经不存在的类：.ms-pager 和 .ms-book-nav —— 两者
        // 在 DOM 里都查不到了，拦空气。留一行注释说明去过哪儿。）
        if (state.mode === 'book') { onBookClick(event); return; }
        var index = pickBookIndex(event);
        if (index < 0) return;
        if (index !== state.active) { setActive(index); return; }
        openActiveBook();
    });
}
