/**
 * 展开的书：三维精装书的尺寸与机位常量、书本运行时，以及纸页（叶）的结构与卷曲。
 */

import { shelf, reduceMotion } from './state.js';
import { clamp } from './utils.js';
import { BOOK_W, BOOK_T, PAGE_DEPTH } from './book-dimensions.js';

// ==========================================================================
// 展开的书：一本真正的三维精装书
// --------------------------------------------------------------------------
// 书脊 = Y 轴，书脊位置 = SPINE_X。结构：
//   bookGroup
//     ├─ 后封板 / 书脊 / 书页块（静态的三块实体）
//     ├─ frontPivot  → 前封板，开合就是绕书脊从 0 转到 -π
//     └─ 一片片「叶」：每片是书脊处的 pivot + 正反两片 18x8 分段的平面
// 每片叶有两套目标姿态：未翻（右侧、微翘）与已翻（左侧、叠起来），
// 再加上一个弹簧驱动的「肚子」（curve）让纸拱起来 —— 纸从来不是平的，
// 这一条是页面像不像纸的关键。
// ==========================================================================

var BK_WIDTH = 1.5;         // 封面宽
var BK_HEIGHT = 2.02;       // 封面高
var BK_DEPTH = 0.34;        // 书厚
var BK_BOARD = 0.055;       // 封板厚
var BK_SPINE = 0.10;        // 书脊宽
var PAGE_W = BK_WIDTH - 0.16;   // 可见页宽：比封面窄一圈，形成封面外伸
var PAGE_H = BK_HEIGHT - 0.04;
var SPINE_X = -BK_WIDTH / 2 + BK_SPINE * 0.62;

export var LEAF_SEG_X = 18;        // 横向分段数：决定卷曲有多顺
export var LEAF_SEG_Y = 8;
export var LEAF_SPEED = 10.5;      // 封/页开合的阻尼速度
export var LEAF_UNTURNED = -0.026; // 未翻的页微微上翘（越小纸叠越紧、越像压过的书芯）
export var LEAF_TURNED = -Math.PI + 0.085;
// 未翻纸叠的站位。**所有叶都必须待在书页块"前面"**：
// 书页块那张横条纹纸面在 z = PAGE_BLOCK_FRONT，只要有叶跑到它后面，
// 块的正脸就会盖在那片叶上 —— 看起来就是「右页外侧有一块横条纹的纸」。
// 页数多时片间距和片间张角都会自动缩小，保证最后一片仍在块的前面。
var PAGE_BLOCK_FRONT = (PAGE_DEPTH - 0.03) / 2;   // 书页块前表面（块厚 PAGE_DEPTH-0.03）
var LEAF_REST_FRONT = BOOK_T / 2 - 0.006;         // 最前一片：贴近前封板内侧，留出拱形净空
var LEAF_REST_BACK = PAGE_BLOCK_FRONT + 0.005;    // 最后一片的下限：仍在书页块前面
// 纸叠要紧：前倾角与扇开角都收小（用户反馈"书页看起来像散开的一叠纸"）。
// 片间距 0.0015 → 0.0012，片间张角 0.008 → 0.0055。
export var LEAF_REST_STEP = 0.0012;                      // 片间距（页多时自动缩）
var LEAF_FAN_STEP_MAX = 0.0055;                   // 片间张角（页多时自动缩）
export var leafFanStep = LEAF_FAN_STEP_MAX;
// 翻过去那一叠的片间扇开角：**总角度固定，按片数分摊**（和右边那叠同一套做法）。
// 原来是每片固定 0.014 rad：30 片就是 22.6°，页宽 1.39 意味着一叠纸的外缘
// 往前探出 0.53 —— 比整本书芯（0.38）还厚，用户看到的就是"左边凸起一大块"。
// 片数≤4 时归一值仍等于上限，小书观感完全不变。
var TURNED_FAN_TOTAL = 0.05;
var TURNED_FAN_STEP_MAX = 0.014;

export function turnedFanStep() {
    var n = (book && book.leaves) ? book.leaves.length : 1;
    return Math.min(TURNED_FAN_STEP_MAX, TURNED_FAN_TOTAL / Math.max(1, n - 1));
}
// 叶的几何**照参考实现：不加任何位移**。纸的 pivot 就钉在订口，整段翻页
// 都是绕订口做的纯旋转 —— 左缘因此始终连着书脊。
// 之前为了"消灭左页外缘那条露出来的封面内侧"，我试过按转角把 pivot 或纸面
// 往外挪，两次都不对：轴一动就不是绕订口翻了（"凭空翻页"），纸面一动左缘又
// 离开书脊。参考实现（complete-shelf）本来就不补这段 —— 翻过去的那叠纸比封面
// 小一圈，外缘露出封面内侧/环衬是**正常的**，这里就按它来。
export var PAGE_ROWS = 6;          // 列表页每页几行
var BOOK_CAMERA_Z = 7.4;    // 与书架态的相机完全一致：进检视态相机一动不动
export var BOOK_Z = 0.62;          // 书摆在镜头前的哪个深度（比 0 近，会显得更大）
var BOOK_FOV = 32;          // 与 initShelf 里建相机用的 fov 保持一致
// 摊开后的书本占可见高度的多少。原来是 0.86 / 0.78 —— 摊开那一下
// 几乎顶满画面，用户反馈"放大太大了"。收到 0.70 / 0.62：
// 展开完成后只是**适当**放大一档，四周留出呼吸空间。
var BOOK_FILL_H = 0.70;
var BOOK_FILL_W = 0.62;
// 封面完全打开时的残余倾角。它决定封面**远边**在 z 上抬起多少
// （≈ 书宽 × sin(倾角)），而翻过去的纸必须落在这个高度之上，
// 否则纸会被压在封面远边下面 —— 那就是「翻页穿模」的来源。
// 收成 0：封面完全摊平（-π）。这样它的厚度区间就是干净的 0.17~0.202，
// 翻过去的纸可以**贴着封面**落（0.206），既没有穿模也不会离得太远。
// 之前留 0.055 / 0.02 的倾角，远边会被抬起 0.08 / 0.03，
// 纸就只能跟着抬到 0.238 才不撞 —— 那就是「离翻面太远」。
export var COVER_TILT = 0;
// 封面远边因倾角抬起的高度 ≈ 书宽 × sin(倾角)，再留 0.006 余量
var COVER_TILT_BOOK_W_LIFT = BOOK_W * Math.sin(COVER_TILT) + 0.006;
export var BOOK_PITCH = -0.17;     // 检视态的基础俯仰（书微微后仰）
// 检视态的机位：**相机绕书心做轨道**（照 complete-shelf 的 OrbitControls），
// 而不是"把书转起来"。BOOK_Z 处就是轨道圆心，基础半径 = 相机到书的距离，
// 所以 yaw = pitch = 0、zoom = 1 时的机位与原来看起来是同一个。
export var INSPECT_DIST = BOOK_CAMERA_Z - BOOK_Z;
// 书本在检视态**离地的高度**（书心）。比原来抬高 0.73：
//   · 书下沿离地面从 0.71 变成 1.44，"书浮在棚里"而不是"搁在地上"；
//   · 从下往上看时留给相机的余量大得多（俯仰下限就是被地面卡住的）。
export var BOOK_INSPECT_Y = 1.15;
// 俯仰上限：照 complete-shelf 的 OrbitControls（它没有上下限位），
// 这里给到 72°，基本可以俯视整本书。
export var INSPECT_PITCH_MAX = 1.25;
// 左右**不设限**：OrbitControls 的方位角是能一直转下去的，转多少圈都行。
// 之所以敢不设限：房间四面墙都是朝内的单面，相机绕到某面墙外时那一面会被
// 背面剔除、自己让开，背后那几面墙和它们的角始终在画面里，不会"穿墙看空"。

// 每帧算出来的机位计划（书架态 / 检视态 / 合书过程都只写它，最后统一落到相机上）
export var camPlan = {
    pos: { x: 0, y: 0.42, z: 7.4 },
    target: { x: 0, y: 0.3, z: 0 }
};

// 书的缩放不写死：按「相机到书的实际距离 + 当前画幅」算出来。
// 之前把书放在 z=1.15 却按 z=0 推尺寸，等于凭空放大了 22%，上下直接顶出屏幕。
export function fitBookScale() {
    if (!shelf || !shelf.camera) return 1.3;
    var dims = (book && book.dims) || { pageW: PAGE_W, height: BK_HEIGHT };
    var aspect = shelf.camera.aspect || 1.8;
    var distance = Math.max(1, BOOK_CAMERA_Z - BOOK_Z);
    var viewH = 2 * Math.tan(BOOK_FOV / 2 * Math.PI / 180) * distance;
    var viewW = viewH * aspect;
    var openW = dims.pageW * 2 + 0.12;
    var openH = dims.height || BK_HEIGHT;
    return Math.max(0.6, Math.min(viewH * BOOK_FILL_H / openH, viewW * BOOK_FILL_W / openW));
}

export var book = null;            // 展开态的书本运行时
export function setBook(value) { book = value; }


// 一片纸：书脊处的 pivot + 正反两片分段平面。正面朝右（未翻），
// 翻过去之后看到的是背面。
// host 需要 { group, leaves, dims }：dims 让同一套叶结构既能装进独立书本，
// 也能装进书架上那本精选书。
export function addLeaf(THREE, host, index) {
    var dims = host.dims || {
        spineX: SPINE_X, depth: BK_DEPTH, board: BK_BOARD,
        pageW: PAGE_W, pageH: PAGE_H
    };
    // 叶叠的起止位置由**这一本自己的厚度**决定（书厚度不同的书不能共用一套）
    var restFront = dims.leafRestFront !== undefined ? dims.leafRestFront : LEAF_REST_FRONT;
    var restStep = dims.leafRestStep || LEAF_REST_STEP;
    var pivot = new THREE.Group();
    // index 0 是最上面那片（最先被翻），所以它**最靠前**，往后依次后退。
    // 这里的数值只是占位；真正的位置由 layoutLeafStack() 按当前页集的
    // 片数统一排（页多时片间距自动缩小，保证不插进书页块里）。
    pivot.position.set(dims.spineX, 0, restFront - index * restStep);
    host.group.add(pivot);

    function face(sign) {
        var geometry = new THREE.PlaneGeometry(1, 1, LEAF_SEG_X, LEAF_SEG_Y);
        var material = new THREE.MeshStandardMaterial({
            map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0
        });
        var mesh = new THREE.Mesh(geometry, material);
        mesh.scale.set(dims.pageW, dims.pageH, 1);
        mesh.position.set(dims.pageW / 2, 0, sign * 0.0003);
        if (sign < 0) mesh.rotation.y = Math.PI;
        pivot.add(mesh);
        return {
            mesh: mesh,
            base: new Float32Array(geometry.attributes.position.array),
            direction: sign
        };
    }

    var leaf = {
        index: index,
        pivot: pivot,
        restZ: pivot.position.z,
        // 翻过去之后落到**左边封面的上方**（而不是后封板内侧）。
        // complete-shelf 的 turnedZ 是 depth/2 + board + 0.004，也就是在
        // 摊开的封面之外；我之前写成 -depth/2 + board，页就跑到封面下面去了 ——
        // 这正是「翻过去的那一页被压在封面下、穿模」的原因。
        // 落在摊开封面之上：要盖过封面远边被倾角抬起的那一点高度。
        turnedZ: dims.depth / 2 + dims.board + COVER_TILT_BOOK_W_LIFT + index * 0.0015,
        front: face(1),
        back: face(-1),
        flex: { curve: 0.004, curveVelocity: 0, twist: 0, twistVelocity: 0,
                targetCurve: 0.004, targetTwist: 0 }
    };
    host.leaves.push(leaf);
    return leaf;
}

// 按当前页集的片数重排未翻纸叠。
// 两件事必须一起做：片间距要缩到「最后一片仍在书页块前面」，
// 片间张角也要缩到「最后一片不会往后倒」—— 否则那片纸的外侧就会被
// 书页块的横条纹纸面盖住（页数越多越明显，正是"翻到后面几页开始穿模"）。
export function layoutLeafStack(count) {
    if (!book) return;
    var n = Math.max(1, count);
    var d = book.dims || {};
    var restFront = d.leafRestFront !== undefined ? d.leafRestFront : LEAF_REST_FRONT;
    var restBack = d.leafRestBack !== undefined ? d.leafRestBack : LEAF_REST_BACK;
    var restStep = d.leafRestStep || LEAF_REST_STEP;
    var span = restFront - restBack;
    var step = Math.min(restStep, span / Math.max(1, n - 1));
    // 张角总和不能超过 LEAF_UNTURNED 那点前倾，否则后面的片会往后倒
    leafFanStep = Math.min(LEAF_FAN_STEP_MAX, Math.abs(LEAF_UNTURNED) / Math.max(1, n - 1));
    book.leaves.forEach(function (leaf) {
        leaf.restZ = restFront - step * leaf.index;
    });
}

// 页集变小（比如从 28 张照片的相册回到只有一页的城市章节）时，
// 多出来的叶必须真的从场景里拿掉：three 的射线检测不看 visible，
// 只是隐藏的话，这些空叶仍会被"点到"，而且它们的横条纹空页还会露出来。
export function trimLeaves(host, count) {
    while (host.leaves.length > count) {
        var leaf = host.leaves.pop();
        if (leaf.pivot.parent) leaf.pivot.parent.remove(leaf.pivot);
        [leaf.front, leaf.back].forEach(function (face) {
            if (face.mesh.geometry) face.mesh.geometry.dispose();
            if (face.mesh.material) face.mesh.material.dispose();
        });
    }
}

// 拱形包络：**不换向**（所以不能用 cos(转角) 之类会过零翻面的系数），
// 用"前半段快速起拱、后半段更快收回"——后半段收得快，落页时弧度已接近 0，
// 纸的肚子不会顶进下面那叠纸里（这正是当初引入 cos 系数的原因）。
export function curlEnvelope(t) {
    var p = clamp(t, 0, 1);
    // 0.45（约 81°）起收、0.65（约 117°）就归零 —— 弧度必须**在靠近左边之前
    // 消失**，否则纸会带着弧度落到左叠上、顶进后面那几张里。
    return p <= 0.45
        ? Math.pow(p / 0.45, 0.6)
        : Math.pow(Math.max(0, (0.65 - p) / 0.2), 1.6);
}

// 纸的柔性：弹簧把 curve/twist 推向目标，再按这两个量重摆平面顶点。
// curve 就是纸的「肚子」：正弦拱形 + 自由边抬升，离书脊越远拱得越高。
export function updateLeafFlex(leaf, delta) {
    var flex = leaf.flex;
    var step = Math.min(delta, 0.033);
    if (reduceMotion) {
        flex.curve = flex.targetCurve;
        flex.twist = flex.targetTwist;
        flex.curveVelocity = 0;
        flex.twistVelocity = 0;
    } else {
        var accCurve = (flex.targetCurve - flex.curve) * 178 - flex.curveVelocity * 19;
        var accTwist = (flex.targetTwist - flex.twist) * 210 - flex.twistVelocity * 21;
        flex.curveVelocity = clamp(flex.curveVelocity + accCurve * step, -1.8, 1.8);
        flex.twistVelocity = clamp(flex.twistVelocity + accTwist * step, -1.6, 1.6);
        flex.curve = clamp(flex.curve + flex.curveVelocity * step, -0.03, 0.22);
        flex.twist = clamp(flex.twist + flex.twistVelocity * step, -0.12, 0.12);
    }
    deformLeaf(leaf);
}

export function deformLeaf(leaf) {
    // 纸的「肚子」方向**在整段翻页里固定**（叶自己的局部法线，由 direction 定）。
    // 参考实现的纸就是绕订口转的一张 C 形，中途不换向。
    // 这里原来乘了 cos(转角)：本意是让落页后的肚子仍朝镜头（躲开"顶进纸叠"），
    // 代价却是转到 90° 时系数过零、后半段把弧度**翻了面** —— 用户报的
    // "弧度在中途换方向"就是它，而且过零那一下弧度归零，整段翻页更看不出弧。
    // 现在改成"方向固定 + 后半段更快收弧"（见 curlEnvelope），落页时弧度已接近 0，
    // 一样不会顶进下面的纸叠。
    [leaf.front, leaf.back].forEach(function (face) {
        var position = face.mesh.geometry.attributes.position;
        var base = face.base;
        var direction = face.direction;
        var curve = leaf.flex.curve;
        var twist = leaf.flex.twist;
        for (var i = 0; i < position.count; i++) {
            var x = base[i * 3];
            var y = base[i * 3 + 1];
            var u = x + 0.5;                              // 0=书脊侧，1=自由边
            var mapped = direction > 0 ? u : 1 - u;
            var arch = Math.sin(Math.PI * mapped);
            var lift = mapped * mapped * 0.16;
            var shape = arch * 0.84 + lift;
            var diagonal = twist * y * Math.pow(mapped, 1.35);
            var ripple = twist * Math.sin(mapped * Math.PI * 2) *
                (1 - Math.min(1, Math.abs(y) * 1.65)) * 0.09;
            var z = (curve * shape * (1 + y * 0.14) + diagonal + ripple) * direction;
            position.setXYZ(i, x, y, z);
        }
        position.needsUpdate = true;
        face.mesh.geometry.computeVertexNormals();
    });
}
