/**
 * 翻页、退出与合书：翻到指定页、拖拽翻页、每帧推进翻页，退回书架的合书动画与行命中。
 */

import { state, els, shelf, reduceMotion } from './state.js';
import { CAMERA_Z, shelfLayout, layoutShelf } from './shelf-scene.js';
import { $, clamp, lerp, smoothstep } from './utils.js';
import { BOOK_H, PLANK_TOP } from './book-dimensions.js';
import { setPhase } from './shelf-interaction.js';
import { announceSpread, syncViewReset } from './overlay.js';
import { playCue } from './audio.js';
import {
    LEAF_SPEED,
    LEAF_UNTURNED,
    LEAF_TURNED,
    leafFanStep,
    turnedFanStep,
    BOOK_Z,
    COVER_TILT,
    camPlan,
    book,
    curlEnvelope,
    updateLeafFlex,
    deformLeaf
} from './book-rig.js';
import { refreshBookSpread, bookSpreads } from './book-open.js';

// 翻到"第 pageIndex 页"所在的那一跨。
// 近处（1~2 跨）就正常逐页翻过去；远处先把中间那些跨**直接过去**
// （几十页逐页播动画要翻半分钟），只在最后留一页做可见的落页动画 ——
// 观感就是"书自动翻到那一页"。
// 把每一片叶直接摆到它该在的姿态（翻过的落左、没翻的留右），**不走阻尼**。
// 多跳时专用：阻尼会让叶子一格一格飘过中间那几跨，看着像"先到城市页再跳到足迹页"。
function snapLeafPoses() {
    if (!book) return;
    var step = turnedFanStep();
    book.leaves.forEach(function (leaf) {
        var turned = leaf.index < state.bookSpread;
        leaf.pivot.rotation.y = turned
            ? LEAF_TURNED + leaf.index * step
            : LEAF_UNTURNED + leaf.index * leafFanStep;
        leaf.pivot.position.z = turned ? leaf.turnedZ : leaf.restZ;
    });
}

export function turnToPage(pageIndex) {
    if (!book) return;
    var target = Math.max(0, Math.min(bookSpreads() - 1, Math.floor((pageIndex || 0) / 2)));
    var guard = 0;
    var step = function (forward) {
        if (forward && Math.abs(target - state.bookSpread) > 1) {
            state.pageTurn = null;
            state.bookSpread += 1;
            refreshBookSpread();
            // ⚠️ 多跳时必须把叶子姿态**直接吸附到位**：姿态平时是每帧阻尼追的，
            // 连着改几跨的话叶子会一格一格飘过去 —— 用户看到的就是
            // "先跳到城市页、再突然到足迹页"。吸附之后只剩最后一跨的翻页动画。
            snapLeafPoses();
            return true;
        }
        if (!forward && Math.abs(target - state.bookSpread) > 1) {
            state.pageTurn = null;
            state.bookSpread -= 1;
            refreshBookSpread();
            snapLeafPoses();
            return true;
        }
        // 最后一跨：起一次真正的翻页，交给 updateBookTurn 播完（可见的落页）
        if (state.pageTurn) return false;
        if (!beginPageTurn(forward)) return false;
        settlePageTurn(true);
        return true;
    };
    while (state.bookSpread < target && guard < 400) {
        if (!step(true)) break;
        guard += 1;
    }
    while (state.bookSpread > target && guard < 400) {
        if (!step(false)) break;
        guard += 1;
    }
    announceSpread();
}

// 翻页：同样由「进度 p」驱动。p=0 停在右侧，p=1 完全落到左侧。
// 拖拽时直接写 p（1:1 跟手），松手后补间到 1 或弹回 0。
// 要翻的是哪一片：往前翻时是当前右页所在的那片，往回翻时是左边最上面那片。
function leafForTurn(forward) {
    return forward ? state.bookSpread : state.bookSpread - 1;
}

// 把"还在落位路上"的那一次翻页立刻收尾，好让新的拖拽马上开始：
//   - 目标是翻过去（target=1）→ 直接把页集推到位，剩下的姿态交给每帧阻尼收；
//   - 目标是弹回来（target=0）→ 直接丢掉，那一片会自己阻尼回原位。
// 没有这一步的话，一次点击（会起一次行程为 0 的翻页）之后要等它弹回完，
// 期间再也拖不动下一页 —— 快速连翻就废了。
export function settleTurnNow() {
    var t = state.pageTurn;
    if (!t) return;
    state.pageTurn = null;
    if (t.target === 1) {
        state.bookSpread += t.forward ? 1 : -1;
        refreshBookSpread();
        announceSpread();
    }
}

export function beginPageTurn(forward) {
    if (!book || state.mode !== 'book' || state.pageTurn) return false;
    var next = state.bookSpread + (forward ? 1 : -1);
    if (next < 0 || next >= bookSpreads()) return false;
    var leafIndex = leafForTurn(forward);
    if (leafIndex < 0 || leafIndex >= book.leaves.length) return false;
    state.pageTurn = {
        forward: forward, p: 0, target: 0, dragging: true,
        leafIndex: leafIndex, speedResponse: 0, verticalBias: 0
    };
    return true;
}

export function dragPageTurn(p, options) {
    var t = state.pageTurn;
    if (!t) return;
    t.p = clamp(p, 0, 1);
    t.target = t.p;
    if (options) {
        t.speedResponse = clamp(options.speedResponse || 0, 0, 1);
        t.verticalBias = clamp(options.verticalBias || 0, -1, 1);
    }
}

export function settlePageTurn(complete) {
    var t = state.pageTurn;
    if (!t) return;
    // 拖拽翻页走的是这里（不经过 turnBookPage），所以音效要在这也挂一次：
    // 只有"这次真的翻过去"才出声，拖到一半又收回来的不算。
    if (complete) playCue('page', { rate: t.forward ? 1 : 0.93 });
    t.dragging = false;
    t.target = complete ? 1 : 0;
}

export function turnBookPage(step) {
    // 参考对翻页做了音高区分：往回翻 0.93 倍速（更低沉）
    playCue('page', { rate: step > 0 ? 1 : 0.93 });
    if (!book || state.mode !== 'book') return;
    // 上一次翻页还在落位：立刻收尾，连续按方向键也能一页一页跟得上
    settleTurnNow();
    var forward = step > 0;
    if (!beginPageTurn(forward)) return;
    if (reduceMotion) {
        state.bookSpread += forward ? 1 : -1;
        state.pageTurn = null;
        refreshBookSpread();
        announceSpread();
        return;
    }
    state.pageTurn.dragging = false;
    state.pageTurn.target = 1;
}

// 每帧：封面开合 + 每片叶的姿态与柔性
export function updateBookTurn(delta) {
    if (!book) return;
    syncViewReset();
    var THREE = shelf.THREE;
    var spread = state.bookSpread;
    var active = state.pageTurn;

    if (active && !active.dragging) {
        // 松手后的补间只保留这一级（pivot 直接由 p 推出）。
        // 阻尼速度照 complete-shelf 取 10.5，和叶子的 LEAF_SPEED 同一档 ——
        // 之前用的 14 比它快一档，落页显得急。
        active.p = THREE.MathUtils.damp(active.p, active.target, 10.5, delta);
        if (active.target === 1 && active.p > 0.994) {
            state.bookSpread += active.forward ? 1 : -1;
            state.pageTurn = null;
            active = null;
            // 落页：补画新跨页附近的页，并把顶栏面包屑切到当前这座城市
            // （城市内容已经排在同一本书里，标题得跟着翻页走）
            refreshBookSpread();
        } else if (active.target === 0 && active.p < 0.006) {
            state.pageTurn = null;
            active = null;
        }
    }

    // 封面开合：拖拽时 1:1 跟手；否则补间到目标；合着时悬停会微微裂开一线
    if (state.coverDrag) {
        state.bookOpen = state.coverDrag.p;
    } else {
        var coverTarget = state.openTarget;
        if (state.coverHover && state.openTarget < 0.02) coverTarget = 0.06;
        state.bookOpen = THREE.MathUtils.damp(state.bookOpen, coverTarget, 8, delta);
    }
    // 掀开的角度从 0.055 收到 0.02：0.055 的倾角会让封面**远边**在 z 上
    // 抬起 1.5 × sin(0.055) ≈ 0.082（从 0.202 抬到约 0.284），而翻过去的纸
    // 落在 0.206 —— 于是纸被压在封面远边之下，从侧面看就是纸穿进封面里。
    book.frontPivot.rotation.y = (-Math.PI + COVER_TILT) * state.bookOpen;

    book.leaves.forEach(function (leaf) {
        var isTurned = leaf.index < state.bookSpread;
        var unturned = LEAF_UNTURNED + leaf.index * leafFanStep;
        var turned = LEAF_TURNED + leaf.index * turnedFanStep();
        var target = isTurned ? turned : unturned;
        var zTarget = isTurned ? leaf.turnedZ : leaf.restZ;
        // 静止时几乎放平：叶只要有静态拱形，靠封面那面就会被顶穿，
        // 拱形只在真正翻页的过程中才起
        var curveTarget = 0.004;
        var twistTarget = 0;
        var draggingThis = false;

        if (active && active.leafIndex === leaf.index) {
            draggingThis = true;
            var eased = smoothstep(active.p);
            target = active.forward
                ? lerp(unturned, turned, eased)
                : lerp(turned, unturned, eased);
            // z 跟着**角度**走，并且**必须在转过 45°~90° 这段里就升到左叠之上**。
            // 线性插值的话，纸转到 90° 时 z 才走到一半（≈0.1805），
            // 而摊开封面那块板占的厚度区间是 0.17~0.202 —— 正好穿在里面。
            // 一路拖到底时这个区间一闪而过；**中途松手**则纸会在这个角度
            // 附近慢下来，穿模就一直看得见。
            var angleProgress = clamp(Math.abs(target) / Math.PI, 0, 1);
            var lift = clamp((angleProgress - 0.25) / 0.25, 0, 1);
            zTarget = lerp(leaf.restZ, leaf.turnedZ, lift);
            // 翻得越快纸拱得越高；左右拖动的纵向偏差变成纸的扭转。
            // ⚠️ 拱形与扭转都要按**这一叶自己的转角**（angleProgress）来，不能按
            // 拖拽进度 active.p：往回拖左边那页时 p 走 10% 就已经 curlEnvelope(0.1)
            // ≈ 0.4，而这一叶才刚离开左叠 5° —— 它此刻的局部 +z 指向书里，
            // 0.4 的拱等于把纸肚子**按进左叠**，松手回正那一段看得最清楚
            //（用户报的「轻轻拖一下就穿模到后面」）。参考实现也是按纸自己的转角。
            curveTarget = 0.004 + curlEnvelope(angleProgress) *
                (0.08 + active.speedResponse * 0.1);
            twistTarget = Math.sin(Math.PI * angleProgress) * active.verticalBias * 0.08;
        }
        // 曾经这里还给「刚翻过去、落在左边」的那一片单独加 0.02 的余韵。
        // 那是错的：翻过去之后叶自己的 +z 已经指向书里，0.02 的拱会把它的
        // 「肚子」按进下面的纸叠和封面里 —— 页数一多，下面那厚厚一叠就会
        // 从上一层纸里透出来（用户看到的「翻几页之后开始穿模」）。
        // complete-shelf 没有这个特例，落页后拱形只由转角推出来，自然回平。

        if (draggingThis) {
            // 正在翻的这一片**直接赋值，不做二次阻尼**。
            // 之前是「进度 p 阻尼一次、pivot 再阻尼一次」，两级滞后叠加，
            // 手感就是拖起来黏、松手后回弹慢 —— 这是「不丝滑」的主因。
            leaf.pivot.rotation.y = target;
            leaf.pivot.position.z = zTarget;
        } else {
            // 照 complete-shelf：目标姿态要**乘封面开合度 amount**。
            // 封面合上（amount=0）时每片纸都摊平归位，所以不会斜着插进封面里 ——
            // 这就是「合上封面后第一页穿模」的根因。
            var amount = state.bookOpen;
            leaf.pivot.rotation.y = THREE.MathUtils.damp(
                leaf.pivot.rotation.y, target * amount, LEAF_SPEED, delta);
            var wantZ = leaf.restZ + (zTarget - leaf.restZ) * amount;
            leaf.pivot.position.z = THREE.MathUtils.damp(
                leaf.pivot.position.z, wantZ, LEAF_SPEED, delta);
        }
        // 纸的凸起由**叶自己的转角**推出来（不是拖拽进度）：
        // 转到一半拱得最高，落页后回平 —— 这就是开关封面时的「下压 / 凸起」。
        var turnProgress = clamp(Math.abs(leaf.pivot.rotation.y) / Math.PI, 0, 1);
        // 拖拽时**再多拱一截**（照参考的 dragCurveBoost = 0.032 + speedResponse*0.064）：
        // 之前只有 sin 那 0.082，纸是"挺"着翻过去的，几乎没有弧。
        // 松手后这一截会自己衰减掉（dragging 变 false），纸再回落 —— 和参考一致。
        var curveBoost = 0;
        if (active && active.dragging && draggingThis) {
            // ⚠️ 两条限制缺一不可：
            //   1. 只给**正被拖的这片** —— 原来对所有叶一视同仁，平放着的那些页
            //      会一起鼓起来（用户报的"翻页时所有的页都改变弧度了"）；
            //   2. 包络用 curlEnvelope（靠近左叠那几度已经归零），不能用
            //      sin(π·转角)：后者在"停在左侧"的这片上还剩 0.156 的残余，
            //      轻轻一拖就有约 0.015 的肚子按进左叠 —— 就是这次的穿模。
            curveBoost = (0.032 + clamp(active.speedResponse || 0, 0, 1) * 0.064)
                * curlEnvelope(turnProgress);
        }
        var curveFromTurn = state.bookOpen *
            // 纸的拱形由**这一叶自己的转角**推出来（0.082→0.13）：
            // 原来峰值只有页宽的 6%，而且只出现在转到 90° 那一小段，
            // 观感上"完全感觉不到弧度"（用户反馈）。参考实现的纸是明显的一张
            // C 形，这里把幅度提到约 10%，配合下面的 sin 包络首末自动归零。
            // ⚠️ 拱形要在**整段翻页**里都看得出来，不能只在 90° 附近闪一下：
            // sin(π·t) 的峰很尖，0.3 秒的翻页里可见窗口不到 0.1 秒，观感就是
            // "没有弧度"。这里用 pow(sin, 0.55) 把包络压胖（两端仍然归零，
            // 所以落页姿态不变），幅度 0.13 → 0.2。
            (0.004 + curlEnvelope(turnProgress) * 0.2 + curveBoost);
        leaf.flex.targetCurve = Math.max(curveTarget, curveFromTurn);
        leaf.flex.targetTwist = twistTarget;
        // ⚠️ 收尾阶段**直接钳掉弹簧滞后**：弹簧的速度上限只有 1.8/s，
        // 最后那点转角里根本收不完 —— 纸会带着约 0.1 的弧度落到左叠上、
        // 顶进后面那几张（用户报的"翻到左边穿模一下、随后恢复"），
        // 而"恢复"正是弹簧事后慢慢追回来。转角过了 0.6π（弧度已按
        // curlEnvelope 收到 0）就直接令 curve = target，不再有滞后。
        if (turnProgress > 0.6) {
            leaf.flex.curve = leaf.flex.targetCurve;
            leaf.flex.curveVelocity = 0;
            leaf.flex.twist = leaf.flex.targetTwist;
            leaf.flex.twistVelocity = 0;
        }
        updateLeafFlex(leaf, delta);
    });
}

export function exitBookMode() {
    state.mode = 'shelf';
    setPhase('shelf');
    state.pageTurn = null;
    state.bookLevel = 'chapters';
    if (book) {
        // 把每一片叶都收回未翻姿态。翻到左边的叶如果不收回，就会留在
        // 闭合的书外面 —— 这正是「Esc 关掉之后原来的精选书也穿模」的原因。
        book.leaves.forEach(function (leaf) {
            // 必须归 0，**不能**留那个扇开角。
            // 扇开角只在书摊开时才存在（它乘了封面开合度）；合上封面时
            // complete-shelf 把 amount 归零，所有页一律放平。
            // 之前这里留着 -0.038 + index×0.008，第 0 片前倾 0.038 rad，
            // 页宽 1.426 的自由边因此前移 0.054（0.155 → 0.209），
            // 直接顶穿封面（外表面才 0.202）—— 就是「关闭后封面穿模」。
            leaf.pivot.rotation.y = 0;
            leaf.pivot.position.z = leaf.restZ;
            leaf.flex.curve = 0.004;
            leaf.flex.twist = 0;
            leaf.flex.curveVelocity = 0;
            leaf.flex.twistVelocity = 0;
            leaf.flex.targetCurve = 0.004;
            leaf.flex.targetTwist = 0;
            deformLeaf(leaf);
        });
        // 封面也要合回去（书架模式下 updateBookTurn 不再运行）
        book.frontPivot.rotation.y = 0;
        // 不用手动隐藏：rig.root 的可见性交回 layoutShelf（它就是书架上那本）
        book.group.visible = true;
    }
    state.bookSpread = 0;
    if (shelf && shelf.plank) shelf.plank.visible = true;
    if (shelf && shelf.plankLip) shelf.plankLip.visible = true;
    if (shelf && shelf.backRail) shelf.backRail.visible = true;
    if (shelf && shelf.uprights) shelf.uprights.forEach(function (u) { u.visible = true; });
    // 书列归位：不在这里硬抬回架上，交给 layoutShelf 那条确定时间线
    // （从架下升回来，末帧精确落在各自的位置上）
    if (shelf) {
        shelf.rigs.forEach(function (rig) {
            rig.sinkTarget = 0;
        });
    }
    state.bookOpen = 0;
    state.closing = null;
    state.openTarget = 0;
    state.coverHover = false;
    state.coverDrag = null;
    state.orbit = null;
    state.bookDrag = null;
    state.closing = null;
    state.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
    // 复位按钮的显隐是 updateBookTurn 每帧算的，而书架模式下那个函数不再运行，
    // 所以它会把「可见」的状态一直挂在画面上（用户看到的：Esc 关书之后
    // 右下角那颗「复位视角」还赖着不走）。这里手动收一次。
    syncViewReset();
    if (els.root) els.root.classList.remove('book-mode');
    var hint = els.stage && els.stage.querySelector('.ms-stage-hint');
    // 回到书架：底部那句提示不再恢复（顶栏副标题里已经有同一句）
    if (hint) hint.textContent = '';
    var floor = els.stage && els.stage.querySelector('.ms-floor');
    if (floor) floor.hidden = false;
    if (shelf) layoutShelf(false);
    // 强制重绘一次 canvas：退出书本模式时，信息板与画布都在做合成层切换，
    // 过渡结束的瞬间偶尔会在画布边缘留下几像素的残影（用户看到的就是
    // 「一圈很窄的褐色」，点一下别处触发重绘就消失）。
    // resizeShelf 会重设画布尺寸并清空后备缓冲，等于强制整幅重画。
}


var CLOSE_MS = 620;

// 合书：和翻开对称的一段动画 —— 封面合上、翻过去的叶全部翻回来、
// 整本书滑回它在书架上的位置，走完再执行收尾动作。
export function beginClose(after) {
    if (state.mode !== 'book' || !book || reduceMotion) {
        if (state.mode === 'book') exitBookMode();
        after();
        return;
    }
    state.openTarget = 0;
    state.bookSpread = 0;
    state.pageTurn = null;
    state.coverDrag = null;
    state.coverHover = false;
    state.orbit = null;
    state.bookDrag = null;
    setPhase('closing');
    playCue('close');
    // 「复位视角」按钮只在检视态有意义：合书一开始就收掉，
    // 否则它会跟着那 620ms 的关闭动画一起挂在右下角。
    var resetBtn = $('msViewReset');
    if (resetBtn) resetBtn.hidden = true;
    // **合书动画一开始**就把焦点从舞台上挪走。
    // 舞台是「点击打开书」时获得焦点的，随后按 Esc 是键盘操作，
    // 浏览器据此把 :focus-visible 判为匹配 —— 于是整个 620ms 的关闭过程中，
    // 画布四周都挂着那圈 2px 的强调色描边。等到动画结束再移焦点已经晚了。
    if (els.back && els.back.focus && document.activeElement === els.stage) {
        els.back.focus({ preventScroll: true });
    }
    state.closing = {
        started: performance.now(),
        from: {
            x: book.group.position.x, y: book.group.position.y, z: book.group.position.z,
            scale: book.group.scale.x,
            rotX: book.group.rotation.x, rotY: book.group.rotation.y
        },
        // 相机也可能已经被用户绕着转走了：连它一起记下来，
        // 否则合书那一刻画面会"啪"地跳回棚位
        fromCam: { x: camPlan.pos.x, y: camPlan.pos.y, z: camPlan.pos.z },
        fromTarget: { x: camPlan.target.x, y: camPlan.target.y, z: camPlan.target.z },
        after: after
    };
}

export function updateClosing() {
    var closing = state.closing;
    if (!closing || !book) return false;
    var t = Math.min(1, (performance.now() - closing.started) / CLOSE_MS);
    var eased = t * t * (3 - 2 * t);
    var layout = shelfLayout();
    var shelfScale = 1.14;
    // 合书要落回**这一本自己**在书架上的位姿：高度不同的书落点也不同
    var halfH = ((book.rig && book.rig.dims) ? book.rig.dims.height : BOOK_H) / 2;
    var from = closing.from;
    book.group.scale.setScalar(lerp(from.scale, shelfScale, eased));
    book.group.rotation.x = lerp(from.rotX, 0, eased);
    book.group.rotation.y = lerp(from.rotY, 0, eased);
    book.group.position.set(
        lerp(from.x, layout.activeX, eased),
        lerp(from.y, PLANK_TOP + halfH * shelfScale, eased),
        lerp(from.z, 0, eased)
    );
    // 相机回到棚位（和书同一条时间线、同一个缓动，末帧精确）
    var camFrom = closing.fromCam;
    if (camFrom) {
        camPlan.pos.x = lerp(camFrom.x, 0, eased);
        camPlan.pos.y = lerp(camFrom.y, 0.42, eased);
        camPlan.pos.z = lerp(camFrom.z, CAMERA_Z, eased);
        var tgtFrom = closing.fromTarget || { x: 0, y: 0.42, z: BOOK_Z };
        camPlan.target.x = lerp(tgtFrom.x, 0, eased);
        camPlan.target.y = lerp(tgtFrom.y, 0.3, eased);
        camPlan.target.z = lerp(tgtFrom.z, 0, eased);
    }
    if (t >= 1) {
        // 收尾时把这本书**精确**摆回它在书架上的位姿，而不是留给阻尼去慢慢逼近。
        // 阻尼永远只逼近不相等，残留的那点偏差会让书投射在木板上的阴影跟着变 ——
        // 而木板是画面里唯一的褐色大面，用户看到的就是「书周围多出一圈褐色」。
        book.group.scale.setScalar(shelfScale);
        book.group.rotation.set(0, 0.16, 0);
        // z 必须跟 layoutShelf 给当前书的目标一致（0.35），
        // 之前收尾写的是 0，于是关闭后那本书还得多走一段才回到位。
        book.group.position.set(layout.activeX, PLANK_TOP + halfH * shelfScale, 0.35);
        var after = closing.after;
        state.closing = null;
        exitBookMode();
        if (after) after();
    }
    return true;
}

// 点到某一行 → 进那座城市的相册。返回 { spec, index }：调用方要知道点中的是
// **哪一页**（右页 = 当前这片叶的正面 pages[1+2s]；左页 = 上一片的背面 pages[2s]）。
// 以前只认右页，于是"城市列表页落在左页"时点不动 —— 加了目录页之后列表正好在左页。
export function pickRowHit(event) {
    if (!book || !shelf || state.mode !== 'book') return null;
    var rect = els.stage.getBoundingClientRect();
    var pointer = new shelf.THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    shelf.raycaster.setFromCamera(pointer, shelf.camera);
    var candidates = [
        { leaf: book.leaves[state.bookSpread], face: 'front',
          pageIndex: 1 + state.bookSpread * 2 },
        { leaf: book.leaves[state.bookSpread - 1], face: 'back',
          pageIndex: state.bookSpread * 2 }
    ];
    for (var i = 0; i < candidates.length; i += 1) {
        var c = candidates[i];
        var spec = (state.bookPages || [])[c.pageIndex];
        if (!c.leaf || !spec || !spec.rows || !spec.rows.length) continue;
        var mesh = c.leaf[c.face] && c.leaf[c.face].mesh;
        if (!mesh) continue;
        var hits = shelf.raycaster.intersectObject(mesh, false);
        if (!hits.length || !hits[0].uv) continue;
        var canvasY = (1 - hits[0].uv.y) * 564;
        // 优先用页面记下的**逐行上下沿**：目录页的行高不统一（城市行高、足迹点矮），
        // 用一个统一行距反推会点错行。没有这张表的老页面再退回"起点 + 行距"。
        if (spec.rowTops && spec.rowTops.length === spec.rows.length) {
            var hitRow = -1;
            var nearest = -1;
            var nearestGap = 1e9;
            for (var r = 0; r < spec.rowTops.length; r += 1) {
                var top = spec.rowTops[r][0];
                var bottom = spec.rowTops[r][1];
                if (canvasY >= top && canvasY < bottom) {
                    hitRow = r;
                    break;
                }
                // 记一下最近的一行：行高不统一（城市行 34 / 足迹点行 22）时，
                // 点按换算出的 y 常常落在两行的缝里或压在行的边线上，
                // 只认"严格落在行内"会让整页偶发点不动。
                var gap = canvasY < top ? top - canvasY : canvasY - bottom;
                if (gap < nearestGap) { nearestGap = gap; nearest = r; }
            }
            if (hitRow >= 0) return { spec: spec, index: hitRow };
            // 容差吸附：半个行高以内就算点在这一行上（最大 26 逻辑 px）
            if (nearest >= 0 && nearestGap <= 26) return { spec: spec, index: nearest };
            // 落在行与行之间的缝里（行高不同、边界取整）：不要就此放弃，
            // 继续用"起点 + 行距"兜一次，免得整页点不动。
        }
        var pitch = spec.rowPitch || 54;
        var index = Math.floor((canvasY - (spec.rowsTop + 20)) / pitch + 0.5);
        if (index >= 0 && index < spec.rows.length) return { spec: spec, index: index };
    }
    return null;
}
