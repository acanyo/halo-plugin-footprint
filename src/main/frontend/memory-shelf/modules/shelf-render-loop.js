/**
 * 书架渲染循环：每帧推进书架、检视态与合书动画，以及释放场景与拾取书本。
 */

import { roomTheme, updateRoomTheme } from './room-theme.js';
import { state, els, shelf, setShelf, renderer3d, setRenderer3d, reduceMotion } from './state.js';
import {
    updateDust,
    CAMERA_Z,
    SINK_DEPTH,
    LANE_Z,
    LANE_SCALE,
    ROOM_FLOOR_Y,
    rigRawProgress,
    rigEase
} from './shelf-scene.js';
import { clamp, lerp } from './utils.js';
import { disposeRig } from './book-geometry.js';
import { setPhase } from './shelf-interaction.js';
import {
    BOOK_Z,
    BOOK_PITCH,
    INSPECT_DIST,
    BOOK_INSPECT_Y,
    INSPECT_PITCH_MAX,
    camPlan,
    fitBookScale,
    book,
    setBook
} from './book-rig.js';
import { updateBookTurn, updateClosing } from './page-turn.js';

export function startAnimation() {
    if (!shelf) return;
    var THREE = shelf.THREE;

    function frame() {
        if (!shelf || shelf.disposed) return;
        // 整个渲染循环包一层：任何一帧里抛异常都会让 requestAnimationFrame
        // 不再续期，整个 3D 场景就永久冻住 —— 必须保证循环能活下去。
        try {
            tick();
        } catch (error) {
            console.warn('书架渲染帧出错（已跳过该帧）：', error);
        }
        if (shelf && !shelf.disposed) shelf.frame = requestAnimationFrame(frame);
    }

    function tick() {
        var delta = Math.min(0.05, shelf.clock.getDelta());
        var now = performance.now();
        updateDust(shelf.dust, (now - shelf.startedAt) / 1000);
        // 屋子配色也跟着帧走：换省份时墙、地、木架、灯一起过渡到新一套
        updateRoomTheme(delta);

        if (state.mode === 'book') updateBookTurn(delta);

        // 书本入场：从「刚掀开一条缝」的角度落到摊平，避免书架上那本书
        // 翻开一半之后直接硬切成另一本书
        if (state.mode === 'book' && book) {
            if (updateClosing()) {
                // 合书动画进行中：本帧的摆放已经由它接管，直接进入渲染
            } else {
            // 每帧重算一遍适配比例：信息板缩回/展开时画幅在变宽变窄，
            // 书要跟着重新贴合，不能只在入场那一次算死
            // 封面翻开过一半就进入 reading（参考把 reading 与 inspection 分开）
            setPhase(state.bookOpen >= 0.5 ? 'reading' : 'inspection');
            var fit = fitBookScale();
            var view = state.view;
            var eased = 1;
            if (state.bookEnterAt) {
                // 900ms 的 ease-in-out：起步和落位都慢，中间快，最不容易看成「切换」
                var t = Math.min(1, (performance.now() - state.bookEnterAt) / 900);
                eased = t < 0.5
                    ? 4 * t * t * t
                    : 1 - Math.pow(-2 * t + 2, 3) / 2;
            }
            var from = state.bookFrom || {
                x: 0, y: BOOK_INSPECT_Y, z: BOOK_Z, scale: fit, rotX: BOOK_PITCH, rotY: 0
            };
            // 尺寸、倾角、位置**全部从当时的实际值插到目标值**，
            // 不再用「从 0.88 倍长到 1 倍」这种写法，避免交接瞬间跳一下
            var bookScale = lerp(from.scale, fit, eased);
            book.group.scale.setScalar(bookScale);
            // 书**自己不再吃视角**：画面上看到的角度变化全部由相机绕它运动产生
            // （原来把 yaw/pitch 加在书上，屋子纹丝不动，看着就是"书在转、背景是贴纸"）
            book.group.rotation.y = lerp(from.rotY, 0, eased);
            book.group.rotation.x = lerp(from.rotX, BOOK_PITCH, eased);
            // 摊开后让**整本书的中心**落在画面正中（不是书脊）。
            // openCenterX 是封面摊平时实测的包围盒中心；没有它（老数据）就
            // 退回按书脊估的旧算法。
            var openCenterX = typeof book.openCenterX === 'number'
                ? book.openCenterX
                : (book.dims ? book.dims.spineX : -0.75);
            var centerX = -openCenterX * bookScale;
            book.group.position.set(
                lerp(from.x, centerX, eased),
                // 落位高度：抬到 BOOK_INSPECT_Y（比原来高 0.73），离地更远
                lerp(from.y, BOOK_INSPECT_Y, eased),
                lerp(from.z, BOOK_Z, eased)
            );
            // ===== 检视态机位：绕书心的轨道（orbit / pan / zoom 全在相机上）=====
            // 相机一动，墙面的明暗、地板的透视、书本的轮廓全都跟着变 ——
            // 这才是"整间屋子跟着书一起转"，而不是只转一本书。
            // 视觉中心已经在世界 x = 0（上面那步就是把它挪过来的），
            // 相机盯着 0 + 平移量即可
            var focusX = view.panX;
            var focusY = BOOK_INSPECT_Y + view.panY;
            var focusZ = BOOK_Z;
            // 滚轮缩放 = 相机拉近拉远（过去是缩书本模型）
            var dist = INSPECT_DIST / clamp(view.zoom, 0.35, 3);
            // 俯仰限位放在**角度**上、而不是像之前那样去夹相机高度：
            // 夹高度会把 x/z 留在"按原角度算"的位置上，等于把相机硬拽近，
            // 用户看到的就是"从下面看的时候自动放大"。夹角度则半径不变。
            var minPitch = Math.max(-1.1,
                Math.asin(clamp((ROOM_FLOOR_Y + 0.3 - focusY) / dist, -1, 1)));
            var pitch = clamp(view.pitch, minPitch, INSPECT_PITCH_MAX);
            var flat = Math.cos(pitch) * dist;
            // 注意这个**负号**：左右拖动时"看起来在转"的是被看的物体，不是相机。
            // 往右拖 = 相机绕到左边去 = 书朝右边转（和改前的「转书」以及
            // three 的 OrbitControls 是同一个方向）。少这个负号，手感就是反的。
            var orbitX = focusX - Math.sin(view.yaw) * flat;
            var orbitY = focusY + Math.sin(pitch) * dist;
            var orbitZ = focusZ + Math.cos(view.yaw) * flat;
            if (eased >= 1) {
                camPlan.pos.x = orbitX;
                camPlan.pos.y = orbitY;
                camPlan.pos.z = orbitZ;
                camPlan.target.x = focusX;
                camPlan.target.y = focusY;
                camPlan.target.z = focusZ;
            } else {
                // 入场那一秒：从书架机位滑到检视机位（首尾都精确）
                camPlan.pos.x = lerp(0, orbitX, eased);
                camPlan.pos.y = lerp(0.42, orbitY, eased);
                camPlan.pos.z = lerp(CAMERA_Z, orbitZ, eased);
                camPlan.target.x = lerp(0, focusX, eased);
                camPlan.target.y = lerp(0.3, focusY, eased);
                camPlan.target.z = lerp(0, focusZ, eased);
            }
            }
        }
        shelf.rigs.forEach(function (rig, index) {
            // 位姿一律由时间线求值：p = 0 就是上一帧的实际位姿（首帧不跳），
            // p = 1 就是 layoutShelf 给的精确目标（末帧不留残差）。
            // ① 相位切分：退场那几本要在时间轴上"先沉、后移"。切分必须切在
            // **原始**进度上（切缓动后的进度会被曲线带偏），所以这里分别算出
            // sinkP（管下沉）和 moveP（管位移/旋转/缩放）。
            var raw = rigRawProgress(rig, now);
            var p = rigEase(rig, raw);
            var sinkP = p;
            var moveP = p;
            if (rig.sinkPhase > 0 && rig.sinkPhase < 1) {
                var ph = rig.sinkPhase;
                sinkP = rigEase(rig, clamp(raw / ph, 0, 1));
                moveP = rigEase(rig, clamp((raw - ph) / (1 - ph), 0, 1));
            }
            var from = rig.fromPose || {
                x: rig.target.x, y: rig.target.y, z: rig.target.z,
                rotX: 0, rotY: rig.targetRotationY, scale: rig.targetScale, sink: 0
            };
            if (state.mode === 'book') {
                // 当前这本由上面的书本逻辑驱动；其余的书按同一条时间线退场
                // （沉到画面下缘之外 —— 书本模式里搁板是藏起来的，没人替它们挡）
                if (book && rig === book.rig) return;
                var bookSink = lerp(from.sink, 1, p);
                rig.sink = bookSink;
                rig.root.position.set(
                    lerp(from.x, rig.target.x, p),
                    lerp(from.y, rig.target.y, p) - bookSink * SINK_DEPTH,
                    lerp(from.z, rig.target.z, p)
                );
                rig.root.rotation.x = lerp(from.rotX, 0, p);
                rig.root.rotation.y = lerp(from.rotY, rig.targetRotationY, p);
                rig.root.scale.setScalar(lerp(from.scale, rig.targetScale, p));
                rig.root.visible = bookSink < 0.999;
                return;
            }
            // 悬停抬升是**叠加**在时间线之外的：它由指针驱动，不是过渡，
            // 所以单独用一个阻尼量（0..1），不去污染上面那段确定性插值。
            var hovering = !reduceMotion && index === shelf.hoverIndex && index !== state.active;
            var hover = THREE.MathUtils.damp(rig.hover || 0, hovering ? 1 : 0, 12, delta);
            rig.hover = hover;
            // 沉下去 / 升上来：一段行程里包含"从板后消失"和"从板后出现"
            var sink = lerp(from.sink, rig.sinkTarget === undefined ? 0 : rig.sinkTarget, sinkP);
            rig.sink = sink;
            // ③ 被点中的那本：途中朝镜头偏一点、略微放大，落位时收回
            var bump = rig.lane ? Math.sin(Math.PI * moveP) : 0;
            rig.root.position.set(
                lerp(from.x, rig.target.x, moveP),
                lerp(from.y, rig.target.y, moveP) - sink * SINK_DEPTH,
                lerp(from.z, rig.target.z, moveP) + hover * 0.3 + bump * LANE_Z
            );
            // 俯仰也必须回到 0：书本模式会把 rotation.x 拨到 BOOK_PITCH，
            // 而这一行以前没有，于是退出后那本书永远斜着 —— 既包括关掉之后，
            // 也包括「选中下一本之后，上一本在书列里仍是斜的」。
            rig.root.rotation.x = lerp(from.rotX, 0, moveP);
            rig.root.rotation.y = lerp(from.rotY, rig.targetRotationY, moveP);
            rig.root.scale.setScalar(lerp(from.scale, rig.targetScale, moveP) * (1 + bump * LANE_SCALE));
            // 完全沉下去之后才摘掉：p = 1 时它已经在画面/搁板之外，
            // 这一下 visible = false 不会看见任何东西"啪"地消失。
            rig.root.visible = sink < 0.999;
            if (rig.contact) {
                rig.contact.visible = !state.opening && sink < 0.5;
            }
            var openTarget = (state.opening && index === state.active) ? -1.92 : 0;
            rig.coverPivot.rotation.y = THREE.MathUtils.damp(rig.coverPivot.rotation.y, openTarget, 7, delta);
        });

        // 书架态：棚位固定（摊开前后同一个 z，避免"点一下立马放大"）。
        // 书本态与合书过程：机位由上面算好的 camPlan 决定。
        if (state.mode !== 'book') {
            camPlan.pos.x = 0;
            camPlan.pos.y = 0.42;
            camPlan.pos.z = CAMERA_Z;
            camPlan.target.x = 0;
            camPlan.target.y = 0.3;
            camPlan.target.z = 0;
        }
        // 相机只按计划赋值，不再每帧 damp 追目标（阻尼只逼近不相等，
        // 会让"最后一帧还在动"，也就没有确定的首末帧）
        shelf.camera.position.set(camPlan.pos.x, camPlan.pos.y, camPlan.pos.z);
        shelf.camera.lookAt(camPlan.target.x, camPlan.target.y, camPlan.target.z);

        renderer3d.render(shelf.scene, shelf.camera);
        // 记一帧"已经画到画布上"。注意计数器放在 render 之后：
        // 首帧的 render 里要编译所有着色器（慢机器几百毫秒），
        // 这一步过去之后，画布上才真的有内容。
        shelf.painted += 1;
    }
    shelf.frame = requestAnimationFrame(frame);
}

export function disposeShelf() {
    if (!shelf) return;
    shelf.disposed = true;
    // 屋子配色是模块级状态：场景销毁了就把它的"当前值"一并作废，
    // 下次重建（从章节页返回书架）会按那时的选中省份重新刷一遍
    roomTheme.moving = false;
    roomTheme.index = -1;
    if (shelf.frame) cancelAnimationFrame(shelf.frame);
    if (shelf.resizeObserver) shelf.resizeObserver.disconnect();
    shelf.rigs.forEach(disposeRig);
    if (renderer3d) {
        renderer3d.dispose();
        if (renderer3d.domElement && renderer3d.domElement.parentNode) {
            renderer3d.domElement.parentNode.removeChild(renderer3d.domElement);
        }
    }
    setRenderer3d(null);
    setShelf(null);
    els.canvas = null;
    // 书体本身没独立对象了（就是 rig.root），它的释放由 disposeRig 负责
    setBook(null);
    (state.bookTextures || []).forEach(function (texture) {
        if (texture && texture.dispose) texture.dispose();
    });
    state.bookTextures = [];
    state.bookPages = [];
    state.bookSpread = 0;
    state.pageTurn = null;
}

// 拾取：射线打在所有书体上，返回命中的书本下标
export function pickBookIndex(event) {
    if (!shelf) return -1;
    var rect = els.stage.getBoundingClientRect();
    shelf.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    shelf.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    shelf.raycaster.setFromCamera(shelf.pointer, shelf.camera);
    // 正在沉下去（沉到一半）的书已经被搁板挡住大半，不该还能点中：
    // 「看不见却能点」比「点不到」更让人困惑。
    var roots = shelf.rigs.filter(function (rig) {
        return rig.root.visible && (rig.sink || 0) < 0.5;
    })
        .map(function (rig) { return rig.root; });
    var hits = shelf.raycaster.intersectObjects(roots, true);
    if (!hits.length) return -1;
    var node = hits[0].object;
    while (node && node.parent) {
        var found = shelf.rigs.findIndex(function (rig) { return rig.root === node; });
        if (found >= 0) return found;
        node = node.parent;
    }
    return -1;
}
