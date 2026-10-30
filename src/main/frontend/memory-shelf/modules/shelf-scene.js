/**
 * 书架场景：纸尘、相机与房间尺寸、Three.js 场景搭建、尺寸自适应、
 * 书本重排时间线与书架布局。
 */

import { roomTint, applyRoomTheme } from './room-theme.js';
import {
    state,
    els,
    setShelf,
    shelf,
    setRenderer3d,
    renderer3d,
    reduceMotion,
    setMaxAnisotropy
} from './state.js';
import { woodMaps } from './textures.js';
import { buildRig } from './book-geometry.js';
import { BOOK_W, BOOK_H, BOOK_T, PLANK_TOP, PLANK_H } from './book-dimensions.js';
import { startAnimation } from './shelf-render-loop.js';

// ---------------- 纸尘（照 complete-shelf 的 addDust） ----------------
// 棚里飘的一点浮尘。它给的是：110 个点、种子随机分布在一个长方体里、
// 暖褐色、size 0.014、透明度 0.3、不写深度；动画只有极慢的自转与上下浮动。
// 纵向按"相对书心"换算（它的书心 y≈1.45，我的 ≈0.15，减 1.30）。
function addDust(THREE, scene) {
    var count = 110;
    var positions = new Float32Array(count * 3);
    var seed = 20260728;
    var random = function () {          // 与它同款的确定性随机，保证每次布局一致
        seed = (seed * 1831565813 + 1) >>> 0;
        var t = seed;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (var i = 0; i < count; i++) {
        positions[i * 3] = (random() - 0.5) * 14;
        positions[i * 3 + 1] = (0.7 + random() * 4.7) - 1.3;
        positions[i * 3 + 2] = -1.7 + random() * 4;
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var material = new THREE.PointsMaterial({
        color: 0xc3a97b,
        size: 0.014,
        transparent: true,
        opacity: 0.3,
        depthWrite: false
    });
    var dust = new THREE.Points(geometry, material);
    dust.name = 'paper-dust';
    scene.add(dust);
    return dust;
}

export function updateDust(dust, elapsed) {
    if (!dust || reduceMotion) return;
    dust.rotation.y = elapsed * 0.012;
    dust.position.y = Math.sin(elapsed * 0.17) * 0.025;
}

// ---------------- 书架场景 ----------------

function stageSize() {
    var stage = els.stage;
    if (!stage) return { width: 1, height: 1 };
    var rect = stage.getBoundingClientRect();
    // **必须取整**。ResizeObserver 报的是小数（1439.97…），
    // 而初始化时可能是整数 1440；差这不到 1 像素，渲染结果整体平移一点点，
    // 于是两次截图只在所有高对比边缘上出现差异 —— 看上去就像画面里多出
    // 「一圈」东西。取整之后两种状态用的画布尺寸完全一致，就不会再漂。
    return {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height))
    };
}

// 书架布局一律用「世界坐标」算：书排在世界空间的 X 轴上，
// 屏幕像素只在算可视宽度和拖拽换算时出现一次，避免两套单位混用。
export var CAMERA_Z = 7.4;
var CAMERA_FOV = 32;
// 相邻两本书的书脊中心距。原来 0.78 对 0.34 的书厚来说太松了（书与书之间空出
// 比书本身还宽的缝），现在压到 1.3 倍书厚，读起来才像真正排在架上。
var SHELF_GAP = 0.44;
// 换书 / 重排的时间线时长。所有书架位姿都按"归一化进度 p"求值，
// 所以这段时间里无论掉不掉帧，末帧都精确落在目标上（见 startRigTimeline）。
// ② 一次切换的"节拍"：卡片落位、内容分层结束、房间换色、书本滑到位，
// 全都收在 0.45s 左右 —— 原来这四处分别是 0.34 / 0.52 / 0.50 / 0.52s，
// 各走各的，读起来是"几件事同时发生"而不是一个连贯的手势。
var SHELF_MOVE_MS = 450;
// 沉下去的深度。书本模式里搁板是藏起来的，所以这里必须沉到**画面下缘之外**
// （书高 2.2 + 余量），否则"藏起来"那一下会看见书凭空消失；
// 书架模式下则只需要沉到搁板下面，板子会替我们挡住剩下的行程。
export var SINK_DEPTH = 2.9;
// ② 点书列中间那本时整排要平移好几格：时长按**跨了几格**给，并封顶。
// 原来是所有人共用 450ms —— 点第 5 本时它要挪 5 格，等于 5 倍速，糊成一道影。
var SHELF_MOVE_MAX_MS = 900;       // 单次重排的时长上限
var SHELF_MOVE_PER_STEP_MS = 90;   // 每多跨一格加多少
// ③ 被点中的那本走"前面那条道"：途中朝镜头偏一点、略微放大，落位时收回 ——
// 让它成为这一下的主角，其他书的整体平移退成背景（也顺带杜绝任何穿插）
export var LANE_Z = 0.26;
export var LANE_SCALE = 0.04;
// ① 退场那几本"就地沉下去"占整段时长的比例：沉完再在隐藏状态下滑到新位置。
// 原来是瞬移 + 直接隐藏 —— 用户看到的是"好几本一起凭空消失"。
var SINK_PHASE = 0.45;
// ④ 从板后升上来的那几本按位次错开，读起来是"一排书依次归位"而不是一堵墙升上来
var SEAM_RISE_STAGGER = 40;
// 展开书本时，书列退场的时间线时长（照参考实现把整排书架推出画面）。
export var BOOK_RETREAT_MS = 620;

// 房间尺寸（照 complete-shelf 的 addRoom 换算）。**必须放模块级**：
// 房间在 initShelf 里搭，但检视态的相机限位（别钻到地板下面）也要读它，
// 放在函数里就会在每帧抛 ReferenceError，整个画面直接冻住。
export var ROOM_FLOOR_Y = PLANK_TOP - 0.49;
var ROOM_WALL_W = 34;
var ROOM_WALL_H = 16;
var ROOM_WALL_Z = -3.6;
var ROOM_WALL_DROP = 1.48;      // 墙下沿低于地面的深度（照参考）
// 房间的另外三面（正面墙 + 左右侧墙）与侧墙的横向位置。
// 参考实现只有一面背墙：转到侧面，墙就"到头了"，看着不像房间的一角，
// 而像一个能绕出去的缺口。补齐四面、且每面都朝内，四个角就接上了 ——
// 而且因为都是单面，相机绕到墙外时那一面会被背面剔除自动让开，
// 从任何角度看过去，背后那几面墙和它们的角都还在。
var ROOM_FRONT_Z = 9.0;
var ROOM_SIDE_X = 12.0;
var ROOM_WALL_Y = ROOM_FLOOR_Y + ROOM_WALL_H / 2 - ROOM_WALL_DROP;

export function shelfLayout() {
    var size = stageSize();
    var aspect = size.width / Math.max(1, size.height);
    var halfHeight = Math.tan(CAMERA_FOV / 2 * Math.PI / 180) * CAMERA_Z;
    var halfWidth = halfHeight * aspect;
    // 信息板现在是**浮在舞台上**的，不能再把它当成舞台外的东西。
    // 精选书必须整体落在它的右边缘之外，否则会被面板盖住半个封面。
    var panelPx = 0;
    if (!document.getElementById('memoryShelf').classList.contains('book-mode')) {
        // 左侧占用 = 信息卡与省份书脊轨**两条里更靠右的那条**的右边缘
        // （原来只量卡宽，加了书脊轨之后书就可能压到轨道上）
        var stageLeft = els.stage ? els.stage.getBoundingClientRect().left : 0;
        [document.querySelector('.ms-info'), document.getElementById('msRail')]
            .forEach(function (node) {
                if (!node) return;
                panelPx = Math.max(panelPx, node.getBoundingClientRect().right - stageLeft);
            });
    }
    var panelWorld = (panelPx / Math.max(1, size.width)) * 2 * halfWidth;
    var activeHalfWidth = BOOK_W / 2 * 1.14;
    // 精选书默认摆在**画面正中**（世界 x = 0），而不是贴着信息板摆 ——
    // 之前是从面板右缘起算，虽然算出来没压住，但只留了 20px 余量，看着就是
    // 被面板顶住了。只有当窗口窄到面板真的会盖上来时，才把它往右推。
    var activeX = Math.max(0,
        -halfWidth + panelWorld + activeHalfWidth + 0.2);
    // 第一本书脊的中心：从当前书的右边缘再留一点点缝，别按整本书宽去推
    var activeHalf = activeHalfWidth;
    // 精选书和书列之间要留出比书列内部更大的缝：它是「从架上抽出来」的那本
    var spineStart = activeX + activeHalf + 0.36 + BOOK_T / 2;
    var capacity = Math.max(1, Math.floor((halfWidth - spineStart) / SHELF_GAP));
    return {
        gap: SHELF_GAP,
        capacity: capacity,
        activeX: activeX,
        spineStart: spineStart,
        halfWidth: halfWidth,
        pxPerWorld: size.width / Math.max(0.001, halfWidth * 2)   // 拖拽时把像素位移换算成世界位移
    };
}

// 手搭一个"小摄影棚"烘成环境贴图（IBL）。
// 参考实现用的是 three 自带的 RoomEnvironment + scene.environment，
// 强度 0.72；我们的 three 是 r160（没有 environmentIntensity），
// 所以把 0.72 这一档直接乘进环境场景的发光值里。
function buildStudioEnvironment(THREE, renderer) {
    if (typeof THREE.PMREMGenerator !== 'function') return null;
    var pmrem = null;
    try {
        pmrem = new THREE.PMREMGenerator(renderer);
        var room = new THREE.Scene();
        var unit = new THREE.BoxGeometry(1, 1, 1);
        var LEVEL = 0.72;                  // = 参考实现的 scene.environmentIntensity
        var panel = function (w, h, d, color, intensity, x, y, z, backSide) {
            var mesh = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({
                color: new THREE.Color(color).multiplyScalar(intensity * LEVEL),
                side: backSide ? THREE.BackSide : THREE.FrontSide
            }));
            mesh.scale.set(w, h, d);
            mesh.position.set(x, y, z);
            room.add(mesh);
            return mesh;
        };
        // 房间外壳：**要亮**。这是"下缘发黑"的关键 —— three 的 RoomEnvironment
        // 是一间很亮的房间，朝下的面靠环境下半球（也就是那面亮地板/墙）拿到光；
        // 我一开始把外壳做成深褐色，于是朝下的面几乎只能拿到半球光的地面色，
        // 看上去就是一条黑边。现在按真实摄影棚的浅色环境来。
        panel(26, 14, 26, 0xcbbfae, 0.78, 0, 0.4, 0, true);
        // 一块专门朝上的大反光地板，把光从底下反回来
        panel(16, 0.4, 16, 0xd8cdbb, 1.1, 0, -4.6, 0);
        // 顶部主灯（暖白）
        panel(7, 0.5, 7, 0xfff1da, 3.2, 0, 5.4, 0);
        // 左侧大柔光板：方向与场景里那盏 softKey 一致
        panel(0.5, 5.4, 6.4, 0xffe8c2, 2.6, -5.4, 1.6, 1.4);
        // 右侧冷补光
        panel(0.5, 4.2, 5.2, 0xd8e3e7, 1.5, 5.4, 1.2, 1.2);
        // 背后一条暖光，把书从背景里托出来
        panel(9, 3.4, 0.5, 0xd8a866, 1.1, 0, 0.8, -6.2);
        var target = pmrem.fromScene(room, 0.04);
        return target ? target.texture : null;
    } catch (e) {
        console.warn('世界这本书：环境贴图构建失败，退回纯灯光', e);
        return null;
    } finally {
        if (pmrem) pmrem.dispose();
    }
}

export function initShelf() {
    var THREE = window.THREE;
    if (!THREE || !els.stage) return false;

    var size = stageSize();
    setRenderer3d(new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }));
    renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer3d.setSize(size.width, size.height, false);
    renderer3d.outputColorSpace = THREE.SRGBColorSpace;
    renderer3d.toneMapping = THREE.ACESFilmicToneMapping;
    renderer3d.toneMappingExposure = 1.16;
    renderer3d.shadowMap.enabled = true;
    renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(renderer3d.capabilities.getMaxAnisotropy() || 4);

    els.canvas = renderer3d.domElement;
    els.canvas.className = 'ms-canvas';
    els.canvas.setAttribute('aria-hidden', 'true');
    els.stage.insertBefore(els.canvas, els.stage.firstChild);
    // 画布起来之后，DOM 那层"脚下阴影"必须收掉：它是没有 3D 地面时的权宜
    // 之计，现在画布本身已经有地面和投影，那团模糊的褐色留在画面里就是
    // "墙上浮着一块脏东西"（它排在画布之后，是盖在 3D 画面上的）。
    els.stage.classList.add('has-canvas');

    var scene = new THREE.Scene();
    // 环境贴图（IBL）——这是"背光面发黑"的根因。
    // complete-shelf 用 RoomEnvironment + PMREM 给 scene.environment，
    // 强度 0.72。没有环境贴图时，凡是背着主光的面（正好是书页块的**下缘**
    // 和**书口**）只能拿到半球光那一点点，翻动书本、改变俯仰角时就会
    // 一会儿亮一会儿黑——用户看到的就是那两条边"会变黑"。
    // 我们的 three 是 r160，没有 scene.environmentIntensity，
    // 所以把 0.72 这一档直接烘进环境场景里。
    scene.environment = buildStudioEnvironment(THREE, renderer3d);
    // 雾照它来：很淡的暖色，把远处往墙面色上带一点，别让边缘死黑
    scene.fog = new THREE.FogExp2(0xe9dfcb, 0.027);
    var camera = new THREE.PerspectiveCamera(32, size.width / size.height, 0.1, 40);
    camera.position.set(0, 0.42, 7.4);
    camera.lookAt(0, 0.3, 0);

    // ================= 布光：照 complete-shelf 的摄影棚灯组 =================
    // 它一共 7 盏：一盏半球光 + 两盏方向光 + **五盏面光**。
    // 书看起来像"棚拍"而不是"CG"，主要靠那几盏面光——
    // 大面积柔光给出布面的柔和过渡，暖色 rim 专门擦亮烫金，
    // 冷色 backFill 把书从背景里分离出来，spineRake 单独扫书脊。
    //
    // 位置是按"相对书本中心"换算过来的：它的书心在 y≈1.45，我的在 y≈0.15，
    // 所以每盏灯统一减去 1.30 的纵向偏移。
    var BOOK_CENTER_Y = 0.15;
    // 半球光留个引用：它的天色/地色也参与"按书换色"（照参考实现的
    // roomLights.hemisphere.color / groundColor）。
    var hemi = new THREE.HemisphereLight(0xfff8e8, 0x5b4030, 0.56);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xffe8c2, 1.42);
    key.position.set(-4.6, 7.4 - 1.3, 5.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    // 视锥照 complete-shelf 的 ±6 / bottom -1.5：光从上方来，只需要盖住书架那一条。
    // 之前我放到 ±9，同样 2048 的阴影图摊到 18 个世界单位上，每个纹素大一倍多，
    // 书页块**下缘**和**书口**这两面几乎与光线平行，最先出现自阴影痤疮 ——
    // 看上去就是那两条边发黑、有斑。收紧视锥就是把阴影分辨率翻倍。
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -1.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    // 注意 shadow.bias 的符号：**负值会加重自阴影（acne）**，正值才是往外推。
    // 之前照抄参考实现的 -0.00018，结果封板那几条"侧边"（很薄的斜面）
    // 全被自己遮住：无头浏览器量到翻开后封面侧边只有 47 亮度，
    // 而同一块布在正面是 100~150。正负一对调，边缘立刻回到正常亮度。
    key.shadow.bias = 0.0002;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3.5;
    scene.add(key);

    // 面光组：用 try 包住 —— 万一运行环境没有 RectAreaLightUniformsLib，
    // 也不该把整个书架拖垮，退化成方向光/环境光一样能看。
    try {
        // 大面积柔光（布面的主光）
        var softKey = new THREE.RectAreaLight(0xffe8c2, 5.4, 4.8, 5.6);
        softKey.position.set(-3.2, 5.5 - 1.3, 4.6);
        softKey.lookAt(0, BOOK_CENTER_Y, 0);
        scene.add(softKey);
        // 冷补光（方向光，压住过曝）
        var fill = new THREE.DirectionalLight(0xd8e3e7, 0.3);
        fill.position.set(5.5, 3.6 - 1.3, 4.2);
        scene.add(fill);
        // 暖金色轮廓光：专门擦烫金，让它有金属高光
        var rim = new THREE.RectAreaLight(0xd5a45e, 3.45, 1.6, 4.8);
        rim.position.set(3.8, 3.6 - 1.3, -2.1);
        rim.lookAt(-0.2, BOOK_CENTER_Y, 0);
        scene.add(rim);
        // 背后冷光：把书从背景里托出来
        var backFill = new THREE.RectAreaLight(0xd8e3e7, 2.7, 3.8, 4.8);
        backFill.position.set(-1.8, 2.9 - 1.3, -4.5);
        backFill.lookAt(-0.1, BOOK_CENTER_Y, 0);
        scene.add(backFill);
        // 窄条光，专门扫书脊
        var spineRake = new THREE.RectAreaLight(0xffe8c2, 1.9, 0.9, 4.6);
        spineRake.position.set(-4.6, 3.2 - 1.3, 1.1);
        spineRake.lookAt(-0.55, BOOK_CENTER_Y, 0);
        scene.add(spineRake);
        // 扫纸面
        var pageRake = new THREE.RectAreaLight(0xfff7e7, 2.15, 1.15, 3.8);
        pageRake.position.set(4.2, 4.8 - 1.3, 3.1);
        pageRake.lookAt(0.65, BOOK_CENTER_Y + 0.1, 0);
        scene.add(pageRake);
    } catch (e) {
        console.warn('面光源不可用（缺少 RectAreaLight 支持），退回基础布光：', e);
        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        var fallbackFill = new THREE.DirectionalLight(0xffffff, 0.5);
        fallbackFill.position.set(0.6, 1.2, 6);
        scene.add(fallbackFill);
    }

    // ================= 【A 档 · 1】房间：地台 + 背板墙（照 complete-shelf 的 addRoom） =================
    // 上一版这里是"一面 30×18 的渐变背板（带拼板缝 + 灰泥颗粒）+ 两片往内倾
    // 22° 的侧墙"，**但没有地面**。没有地面就没有墙地交线，整块背景读起来只
    // 是一片渐变 —— 用户说的"展开书本后一点墙面的样子都看不出来"就是它。
    //
    // 参考实现的房间其实极简（index.html / addRoom）：一块 30×20 的地板 +
    // 一面 28×14 的**纯色**背墙，木架贴在墙前面。空间感全部来自"墙地交线 +
    // 木架接地 + 灯光衰减"，不来自贴图。这里就照它搭，只按我们的画幅换算尺寸：
    //   - 地面 40×26，一直铺到镜头脚下；高度 = 搁板下沿再往下 0.49
    //     （参考是 shelfBoardTop - 0.49，我这里 PLANK_TOP 就是"搁板顶面"）；
    //   - 背墙 34×16，中心在 z = -3.6，下沿伸到地面以下 1.48，
    //     所以墙地接缝处不会漏出背景色；
    //   - 两者都是纯色 PBR（墙 roughness 1、地 0.92），颜色跟着选中的省份走
    //     （applyRoomTheme），换一本就是换一间屋子。
    var roomFloorMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(roomTint(0, 'floor')), roughness: 0.92, metalness: 0
    });
    var roomFloor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomFloorMaterial);
    roomFloor.scale.set(40, 26, 1);
    roomFloor.rotation.x = -Math.PI / 2;
    // 稍微往前放一点：后缘要压在墙脚之下，前缘要越过镜头
    roomFloor.position.set(0, ROOM_FLOOR_Y, 0.6);
    roomFloor.receiveShadow = true;
    scene.add(roomFloor);

    var roomWallMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color(roomTint(0, 'wall')), roughness: 1, metalness: 0
    });
    var roomWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
    roomWall.scale.set(ROOM_WALL_W, ROOM_WALL_H, 1);
    roomWall.position.set(0, ROOM_WALL_Y, ROOM_WALL_Z);
    roomWall.receiveShadow = true;
    scene.add(roomWall);

    // 正面墙（相机在书本前时它落在身后，不参与画面；绕到背面时它就是背景）
    var roomFrontWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
    roomFrontWall.scale.set(ROOM_WALL_W, ROOM_WALL_H, 1);
    roomFrontWall.position.set(0, ROOM_WALL_Y, ROOM_FRONT_Z);
    roomFrontWall.rotation.y = Math.PI;          // 法线朝 -z，朝向房间内侧
    roomFrontWall.receiveShadow = true;
    scene.add(roomFrontWall);

    // 左右侧墙：从背墙一直连到正面墙，四个角因此严丝合缝
    var roomSideWalls = [];
    [-1, 1].forEach(function (side) {
        var wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), roomWallMaterial);
        wall.scale.set(ROOM_FRONT_Z - ROOM_WALL_Z, ROOM_WALL_H, 1);
        wall.position.set(side * ROOM_SIDE_X, ROOM_WALL_Y,
            (ROOM_WALL_Z + ROOM_FRONT_Z) / 2);
        wall.rotation.y = -side * Math.PI / 2;   // 法线朝房间内侧
        wall.receiveShadow = true;
        scene.add(wall);
        roomSideWalls.push(wall);
    });

    // ================= 【A 档 · 2】木架：新木纹 + 前缘压条 =================
    // 顶面高度固定为 PLANK_TOP，所有书都按这个高度「落座」，不会插进木板里。
    var wood = woodMaps(THREE);
    var plankMaterial = new THREE.MeshStandardMaterial({
        map: wood.map,
        roughnessMap: wood.roughness,
        normalMap: wood.normal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        roughness: 0.88,
        metalness: 0
    });
    wood.map.repeat.set(5, 1);
    wood.roughness.repeat.copy(wood.map.repeat);
    wood.normal.repeat.copy(wood.map.repeat);
    // 深一档的胡桃色：前缘压条、立柱、背挡都用它（照参考的 walnutDark）
    var woodDarkMaterial = new THREE.MeshStandardMaterial({
        map: wood.map,
        roughnessMap: wood.roughness,
        normalMap: wood.normal,
        normalScale: new THREE.Vector2(0.5, 0.5),
        color: 0x8a6a3c,
        roughness: 0.9,
        metalness: 0
    });
    var plank = new THREE.Mesh(
        // 进深 1.6 → 2.0：书立着时在 z 上要占整本书的宽度（1.5×0.9 ≈ 1.35），
        // 1.6 的板子放不下，前排会探出板沿；加深后前后都留出余量，
        // 也给背挡腾出"仍在板面上"的位置。
        new THREE.BoxGeometry(20, PLANK_H, 2.0),
        plankMaterial
    );
    plank.position.set(0, PLANK_TOP - PLANK_H / 2, 0.12);
    plank.receiveShadow = true;
    scene.add(plank);

    // 前缘压条：照 complete-shelf 的 walnut-shelf-lip —— 一条比板面略宽、
    // 更深色的**矩形**窄条压在搁板下前沿。
    // （上一版我自创了一根牛鼻圆边：既不是参考的样子，而且摊开书之后它
    // 还留在画面底部，就是用户说的"书本展开后底部还有木条"。）
    var plankLip = new THREE.Mesh(
        new THREE.BoxGeometry(20.05, 0.075, 2.06),
        woodDarkMaterial
    );
    plankLip.position.set(0, PLANK_TOP - PLANK_H + 0.02, 0.12);
    plankLip.receiveShadow = true;
    scene.add(plankLip);

    // 这里原来照 complete-shelf 铺了一条"板面接触阴影"（19×1.5 的 αMap 平面）。
    // 实测在亮色场景里它就是"木板上多了一层阴影"，所以撤掉：
    // 板的接地感交给每本书脚下那小块椭圆阴影就够了。

    // 书架的**立柱**与**背挡**（照它 hero 场景的 walnut-upright / back-rail）：
    // 这两样才是"一整排书架"的样子 —— 我之前的"两侧墙"是斜的摄影棚墙，
    // 不是书架的侧板。
    var uprights = [];
    [-1, 1].forEach(function (side) {
        var upright = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, 3.6, 0.78), woodDarkMaterial);
        // 立柱底端落在搁板底面（和参考一样是"撑到板底"，不是浮在板面上）
        upright.position.set(side * 8.35, PLANK_TOP + 1.6, -0.28);
        upright.receiveShadow = true;
        scene.add(upright);
        uprights.push(upright);
    });
    // 背挡（照参考实现的 walnut-back-rail）。
    // 上一版我把它删了 —— 那是错的：它本来该在，问题只是位置。
    // 现在书排的进深已经压平（见 layoutShelf：z = 0.12 - ordered*0.03），
    // 书后背最深 ≈ -0.63；板子加深到 2.0 后，后缘在 -0.91，
    // 所以横挡放在 z = -0.80（前脸 -0.73）既在板面上、又和书留 0.1 净空。
    var backRail = new THREE.Mesh(
        new THREE.BoxGeometry(16.5, 0.17, 0.14), woodDarkMaterial);
    backRail.position.set(0, PLANK_TOP + 0.21, -0.80);
    scene.add(backRail);
    // ================= 【A 档 · 3】书房道具（照用户所选 1+2）=================
    // 位置都是**按相机可见范围算过**的：fov 32 / 相机 z=7.4 时，
    // 书架深度（z≈0）可见横向约 ±3.9，墙面（z=-3.6）约 ±5.8。
    // 所以：墙面高处、以及搁板**前方**的地面看得见；
    // 搁板右端（x≈6~8）其实已经在画面之外 —— 原方案 2 就改成前景右下。
    // 上方墙面：暗木画框 + 一张纸面（挂在书架线上方，不在书后面）
    // （壁灯按用户选择 B 去掉了：只留画框，墙面更干净；那盏暖光也一并去掉）
    var wallFrame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.78, 0.055), woodDarkMaterial);
    wallFrame.position.set(2.7, 2.15, -3.56);
    wallFrame.receiveShadow = true;
    scene.add(wallFrame);
    var framePaper = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.62),
        new THREE.MeshStandardMaterial({ color: '#f6f0e2', roughness: 0.95, metalness: 0 }));
    framePaper.position.set(2.7, 2.15, -3.52);
    scene.add(framePaper);

    // （地面上的三本平放书 + 落地小台灯按用户要求整组去掉；只留墙面上的画框与壁灯。
    //   相应的那盏暖光也一并去掉，避免"没有来源的光"。）

    var dust = addDust(THREE, scene);

    var rigs = state.books.map(function (book, index) { return buildRig(THREE, book, index); });
    rigs.forEach(function (rig) { scene.add(rig.root); });

    setShelf({
        THREE: THREE,
        scene: scene,
        plank: plank,
        plankLip: plankLip,
        backRail: backRail,
        uprights: uprights,
        dust: dust,
        camera: camera,
        rigs: rigs,
        raycaster: new THREE.Raycaster(),
        pointer: new THREE.Vector2(-2, -2),
        clock: new THREE.Clock(),
        startedAt: performance.now(),
        frame: 0,
        // 真正"画出来"的帧数（首帧要编译着色器，可能几百毫秒）。
        // 「正在装订书架…」占位必须等到它涨上来才能收（见 whenShelfPainted）。
        painted: 0,
        hoverIndex: -1,
        disposed: false,
        resizeObserver: null,
        // 房间里参与"按省份换色"的东西（照参考实现的 roomMaterials/roomLights）。
        // 灯光分组：warm = 主光那一路，cool = 冷补光那一路，rim = 擦烫金的轮廓光。
        room: {
            floor: roomFloorMaterial,
            wall: roomWallMaterial,
            wood: plankMaterial,
            woodDark: woodDarkMaterial,
            fog: scene.fog,
            hemi: hemi,
            warm: [key, softKey, spineRake, pageRake].filter(Boolean),
            cool: [fill, backFill].filter(Boolean),
            rim: [rim].filter(Boolean)
        }
    });

    // 建好就先把当前这本的屋子刷上（不过渡，避免开场从 0 号色滑到当前色）
    applyRoomTheme(state.active, true);
    layoutShelf(true);
    startAnimation();

    if ('ResizeObserver' in window) {
        shelf.resizeObserver = new ResizeObserver(function () { resizeShelf(); });
        shelf.resizeObserver.observe(els.stage);
    }
    return true;
}

function resizeShelf() {
    if (!shelf || shelf.disposed) return;
    var size = stageSize();
    renderer3d.setSize(size.width, size.height, false);
    shelf.camera.aspect = size.width / size.height;
    shelf.camera.updateProjectionMatrix();
    // ⚠️ setSize 会重建画布的后端缓冲并把它**清空**，而 ResizeObserver 的回调
    // 跑在同一帧的 rAF **之后**（渲染循环那一步已经画完了）—— 于是这一帧合成
    // 上屏的就是那张被清空的画布：透明的，露出底下 #memoryShelf 的米色背景，
    // 看上去就是"屏幕闪一下"。实测这一帧内的事件顺序正是
    // raf → attr(width/height 变了) → raf → attr …：每帧闪一次。
    // 舞台尺寸只变一次时（书架 ↔ 书本模式）只有 1 帧闪，看不出来；顶栏收窄
    // 做成 0.45s 过渡后尺寸连续变，就变成连闪三十来帧。
    // 这里补一帧渲染，把刚清空的缓冲在同一次回调里填回去。
    // 只 render 不 tick：tick 会推进动画时钟（updateBookTurn 吃 delta），
    // 一帧推两次会让翻页速度翻倍。
    renderer3d.render(shelf.scene, shelf.camera);
    // 只用补间更新目标：信息板缩回/展开会让舞台连续变宽变窄，
    // 这里要是即时吸附，就会把书「啪」地按到新位置，过渡全废
    layoutShelf(false);
}

// 给一本书起一段**确定的时间线**：起点 = 它此刻实际在哪儿，终点 = rig.target*。
// 之后每一帧都按 p = (now - t0) / dur 求值，而不是"每帧往前挪一点"，
// 所以帧率不影响结果，p = 1 时精确落在目标上（首末帧对齐）。
//
// seam = true 表示这本书是从书架另一头绕过来的（排位跳了半圈以上）。
// 沿路插值会让它横穿整个画面 —— 参考实现遇到这种情况是**在看不见的时候瞬移**
// （updateShelfLayout 里的 wrappedAcrossSeam：直接把 x 写成目标、opacity 归零）。
// 这里同样处理：立刻落到新位姿，同时让它沉在搁板下面，再从容升起。
// 「从板后升上来」这类入场的延迟（ms）：等刚让位的那本把精选位腾开再升。
// 不然两本书会在同一个横坐标上叠着，看着就是"新的一本出现得太快、穿模"。
var SEAM_RISE_DELAY = 160;

export function startRigTimeline(rig, now, duration, seam, delay, lane) {
    if (!rig || !rig.target) return;
    var sink = rig.sink || 0;
    var teleported = false;
    var sinkPhase = 0;
    if (seam && rig.sinkTarget < 0.5) {
        // 入场（从板后升上来）：瞬移到目标位姿再藏起来，然后原地升起
        sink = 1;
        rig.root.position.copy(rig.target);
        rig.root.rotation.y = rig.targetRotationY;
        rig.root.scale.setScalar(rig.targetScale);
        rig.root.visible = false;
        teleported = true;
    } else if (seam) {
        // ① 退场（跨半圈去书列尾端，目标在容量之外）：**就地沉下去**，
        // 沉完再在隐藏状态下滑到新位置 —— 不瞬移、不凭空消失。
        sinkPhase = SINK_PHASE;
    }
    rig.fromPose = {
        x: rig.root.position.x,
        // ⚠️ y 这里必须分两种情况，混在一起会出大问题：
        //   · 没被瞬移的书：root.position.y 里**已经含**着当前的下沉量，
        //     要先用 + sink*SINK_DEPTH 还原成基础位姿，否则下沉量算两遍；
        //   · seam 那条路刚刚 position.copy(rig.target)，y 已经是目标位姿、
        //     不含下沉量。这时再加一次，就等于把"升上来"整段抵消掉 ——
        //     tick 里 y 会恒等于目标值，那本书变成**凭空出现**在精选位
        //     （正好压在还没滑走的上一本身上："上一本出现得太快、穿模"）。
        y: teleported ? rig.root.position.y : rig.root.position.y + sink * SINK_DEPTH,
        z: rig.root.position.z,
        rotX: rig.root.rotation.x,
        rotY: rig.root.rotation.y,
        scale: rig.root.scale.x,
        sink: sink
    };
    rig.sink = sink;
    rig.animT0 = now + (delay || 0);
    rig.animDur = duration;
    rig.sinkPhase = sinkPhase;
    rig.lane = lane || 0;
    // 入场/退场都走 ease-in-out：默认那套 1-(1-p)³ 是"起步最快"，
    // 用在"升起"上是啪地弹出来，用在"沉下去"上是咣地掉下去。
    rig.animEase = seam ? 'rise' : '';
}

function rigProgress(rig, now) {
    return rigEase(rig, rigRawProgress(rig, now));
}

// 原始进度（0..1，**未缓动**）：相位切分（先沉后移）必须切在时间轴上，
// 切在缓动后的进度上会被缓动曲线带偏。
export function rigRawProgress(rig, now) {
    if (!rig || !rig.animDur) return 1;
    var p = (now - rig.animT0) / rig.animDur;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return p;
}

// 时间线求值：默认 ease-out（1-(1-p)³，起步快、收尾稳，和参考的 damp 手感接近
// 但**有确定终点**）；'rise' 用 ease-in-out（从板后升起 / 就地沉下都走它）。
export function rigEase(rig, p) {
    if (rig.animEase === 'rise') {
        return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    }
    return 1 - Math.pow(1 - p, 3);
}

// 把每本书摆到自己的位置：当前书居中偏左（左上是信息板，右侧留给书列）。
// 所有位姿都只是"目标"；真正的动画由 startRigTimeline + tick 里的求值完成。
export function layoutShelf(instant) {
    if (!shelf) return;
    if (state.mode === 'book') {
        // 书本模式下书架整排都收起来了：翻页这对按钮和中间的计数都不露头
        if (els.prev) els.prev.hidden = true;
        if (els.next) els.next.hidden = true;
        syncPageCount(false);
        return;
    }
    var layout = shelfLayout();
    var total = shelf.rigs.length;
    if (!total) return;

    var now = performance.now();
    var duration = (instant || reduceMotion) ? 0 : SHELF_MOVE_MS;
    var activeX = layout.activeX;
    var spineStart = layout.spineStart;
    shelf.rigs.forEach(function (rig, index) {
        // 每本书高度不同（BOOK_SIZES），"站在板面上"要按各自的半高算
        var half = (rig.dims ? rig.dims.height : BOOK_H) / 2;
        // 书脚接触阴影只在"书在架上"的时候出现：抽出来 / 摊开后那块阴影要收掉，
        // 否则会留在板上变成一块没来由的暗斑。
        if (rig.contact) rig.contact.visible = (state.mode === 'shelf' && !state.opening);
        // 排位：当前那本在精选位（-1），书列从它右边 0 起。**同一套坐标**才能
        // 判断一本书是从精选位掉回书列尾端（-1 → total-2，跨了半圈以上）。
        var slot = index === state.active
            ? -1
            : (index - state.active - 1 + total) % total;
        var oldSlot = rig.slot;
        var seam = oldSlot !== undefined && Math.abs(slot - oldSlot) > total * 0.5;
        rig.slot = slot;
        // ② 这一本要挪几格 → 决定它自己的时长（封顶）。跨半圈那种（seam）
        // 不算距离：它们要么就地沉下去、要么原地升起，都是"原地"的动作。
        var stepCount = seam || oldSlot === undefined ? 1 : Math.abs(slot - oldSlot);
        var rigDur = duration
            ? Math.min(SHELF_MOVE_MAX_MS,
                SHELF_MOVE_MS + SHELF_MOVE_PER_STEP_MS * Math.max(0, stepCount - 1))
            : 0;
        var sinkTarget;

        if (index === state.active) {
            // **就地翻开**：点开的那一瞬间不再"抽出来"（不放大、不往前抬）。
            // 之前 state.opening 时会把这本书放大到 1.24、往前 0.95、抬高 0.18，
            // 用户看到的就是"点一下先猛地放大一次"，然后摊开时又放大一次。
            // 现在只在原地转身面对读者，尺寸和位置都保持书架态；
            // 真正的放大交给摊开之后的 settle 阶段（而且幅度更小）。
            var activeScale = 1.14;
            rig.targetScale = activeScale;
            rig.target.set(
                activeX,
                PLANK_TOP + half * activeScale,
                // 精选书也往板里收一点（原来 0.35）：书立着时前后各占 0.855，
                // 站在 0.35 会探出板沿；0.15 正好整本落在加深后的板面内。
                0.15
            );
            rig.targetRotationY = state.bookRotation === null
                ? (state.opening ? 0 : 0.16)
                : (state.bookRotation * Math.PI / 180);
            sinkTarget = 0;
        } else {
            var beyond = slot >= layout.capacity;
            // 尺度随排位递减：越靠后越矮越小，一眼看出先后
            var scale = Math.max(0.78, 0.93 - slot * 0.025);
            // 原来这里有一项"高低错落"（每本抬 0~0.088），书一多、每本的
            // 高度又不同，看起来就是"这一排书底部没对齐"。整排压平：
            // 统一落到板面上，高矮差别只由各自的真实高度给。
            // 高低错落已按用户要求去掉（值恒为 0，保留变量供下面复用）
            var stagger = 0;
            rig.targetScale = scale;
            rig.target.set(
                spineStart + slot * layout.gap,
                PLANK_TOP + half * scale + stagger,
                // 进深方向只留很小的错落（原来是每本退 0.1）。
                // 退到后面时，书的后背会伸到搁板外、还会撞上背挡 ——
                // 用户看到的「书本开口朝后的位置穿进横杠」就是这么来的。
                // 参考实现的一排书基本站在同一进深上，这里也压平。
                0.12 - slot * 0.03
            );
            // 侧身立着露出书脊，并按序号微调倾角，避免整排像复制粘贴
            rig.targetRotationY = (84 + ((index % 3) - 1) * 1.1) * Math.PI / 180;
            // 一屏放不下的书**不是瞬间隐藏**，而是沉到搁板下面去 ——
            // 板子是实心的，从板后消失/升起读起来就是"挪到下一层架子上"，
            // 循环翻到那一头时也不会出现"唰地一下没了"。
            sinkTarget = beyond ? 1 : 0;
        }
        rig.sinkTarget = sinkTarget;
        rig.visible = sinkTarget < 0.5;
        // ④ 只有"从板后升上来"的那种 seam（入场，sinkTarget=0）需要延迟，
        // 而且按位次错开：slot 越小离精选位越近，先归位。
        // 退场那种（sinkTarget=1）不等，直接就地往下沉。duration=0
        // （instant / reduceMotion）时两者都不需要。
        var riseDelay = (seam && sinkTarget < 0.5 && rigDur)
            ? SEAM_RISE_DELAY + Math.max(0, slot) * SEAM_RISE_STAGGER
            : 0;
        // ③ 被点中的那本（从书列里挪 2 格以上过来）走"前面那条道"
        var lane = (index === state.active && !seam && stepCount >= 2) ? 1 : 0;
        startRigTimeline(rig, now, rigDur, seam, riseDelay, lane);
    });

    // 分页按钮 / 上一本下一本只在**书架**这一层有用：书已经摊开在手上时
    // 它们必须收掉（之前只判 state.level，书本模式里 level 还停在 'shelf'，
    // 于是右边那颗「›」一直挂在那里）。
    var shelfLevel = state.level === 'shelf' && state.mode === 'shelf';
    if (els.prev) els.prev.hidden = !shelfLevel;
    if (els.next) els.next.hidden = !shelfLevel;
    syncPageCount(shelfLevel);
}

// 顶栏那对箭头中间的「第几 / 共几本」。它们一次翻**一屏**（见 pageStep），
// 只看箭头本身会以为它在乱跳 —— 有这行数字，"1/11 → 6/11 → 11/11 → 5/11"
// 的规律就自己说清楚了。字号和颜色压到最淡，不跟标题抢视线。
export function syncPageCount(show) {
    var count = els.pageCount;
    if (!count) return;
    var total = state.books.length;
    if (!show || !total) {
        count.hidden = true;
        return;
    }
    count.hidden = false;
    count.textContent = (state.active + 1) + ' / ' + total;
}

// 顶栏那对箭头一次翻**一屏**：精选书右边排不下的那几本（沉到搁板下面）
// 一次换上来。一次一本已经有滚轮、←/→ 方向键、左侧书脊轨三条路，
// 不需要第四处；真正没有替代品的是"跳到后面那一屏"。
export function pageStep() {
    if (!shelf || state.mode !== 'shelf') return 1;
    var total = state.books.length;
    var cap = Math.max(1, shelfLayout().capacity);
    // 一屏就装得下时"翻一屏"会原地打转（加完再对总数取模还是自己），退回一本
    if (total < 2 || cap >= total - 1) return 1;
    return cap;
}

// 长按拖动旋转当前这本：跟手的角度**不走时间线**（手指到哪儿书到哪儿），
// 同时把这段补间的起点一起改掉，免得松手后从旧角度重新插一遍。
export function applyActiveRotation() {
    if (!shelf || state.mode !== 'shelf') return;
    var rig = shelf.rigs[state.active];
    if (!rig || !rig.target) return;
    var angle = state.bookRotation === null
        ? 0.16
        : (state.bookRotation * Math.PI / 180);
    rig.targetRotationY = angle;
    if (rig.fromPose) rig.fromPose.rotY = angle;
    rig.animDur = 0;
    rig.root.rotation.y = angle;
}
