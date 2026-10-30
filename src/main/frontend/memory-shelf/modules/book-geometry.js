/**
 * 书体几何：圆角平面、封板、书页块，以及把一本书组装成可动画的 rig。
 */

import { FOIL_COLORS } from './constants.js';
import { hexLum } from './room-theme.js';
import { palette } from './utils.js';
import { makeCanvas, clothTextures, pageEdgeTexture, contactShadowMaterial } from './textures.js';
import {
    paintCover,
    coverTexture,
    spineTexture,
    spineFoilTexture,
    backCoverTexture
} from './cover-art.js';
import {
    BOOK_SIZES,
    REF_SCALE,
    BOARD_T,
    SPINE_W,
    SPINE_BOARD,
    PAGE_INSET_W,
    PAGE_INSET_H,
    COVER_RADIUS,
    ART_INSET,
    GROOVE_W,
    GROOVE_X,
    TURN_IN
} from './book-dimensions.js';
import { LEAF_REST_STEP } from './book-rig.js';

// ---------------- 书体几何 ----------------

// 圆角矩形**平面**（照参考实现的 createRoundedPlaneGeometry）。
// ---------------------------------------------------------------------------

// 封面图案层、烫金层、环衬都用它：参考里这些贴面全是圆角的，
// 用方角平面盖在圆角封板上，四个角会露出一点点没被盖住的边。
function roundedPlaneGeometry(THREE, width, height, radius) {
    var halfW = width * 0.5;
    var halfH = height * 0.5;
    var corner = Math.min(radius, halfW, halfH);
    var shape = new THREE.Shape();
    shape.moveTo(-halfW + corner, -halfH);
    shape.lineTo(halfW - corner, -halfH);
    shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + corner);
    shape.lineTo(halfW, halfH - corner);
    shape.quadraticCurveTo(halfW, halfH, halfW - corner, halfH);
    shape.lineTo(-halfW + corner, halfH);
    shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - corner);
    shape.lineTo(-halfW, -halfH + corner);
    shape.quadraticCurveTo(-halfW, -halfH, -halfW + corner, -halfH);
    var geometry = new THREE.ShapeGeometry(shape, 8);
    var position = geometry.getAttribute('position');
    var uv = new Float32Array(position.count * 2);
    for (var i = 0; i < position.count; i++) {
        uv[i * 2] = (position.getX(i) + halfW) / width;
        uv[i * 2 + 1] = (position.getY(i) + halfH) / height;
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.computeVertexNormals();
    return geometry;
}


// 精装书封板：只有外侧两角是圆角，靠书脊那一侧保持直角 —— 真实硬壳书就是这样。
// 用 Shape + ExtrudeGeometry 挤出，自带一圈小倒角，边缘能吃到光，比纯 Box 真实得多。
function boardGeometry(THREE, width, height, depth, radius) {
    var x0 = -width / 2;
    var x1 = width / 2;
    var y0 = -height / 2;
    var y1 = height / 2;
    var shape = new THREE.Shape();
    shape.moveTo(x0, y0);
    shape.lineTo(x1 - radius, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
    shape.lineTo(x1, y1 - radius);
    shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
    shape.lineTo(x0, y1);
    shape.lineTo(x0, y0);

    // **不要倒角**。
    // 之前用的是 bevelEnabled + bevelSize 0.01（后来收到 0.004），会在封板
    // 四周形成一圈朝上/朝外的斜面。这圈斜面的法线已经转过 45°，主光（左上前方）
    // 打不到，渲染出来就是沿着封面**上边和右边**的一条暗线；翻开后封板内侧
    // 同样的倒角又出现在左上/下边 —— 和无头浏览器里量到的完全一致：
    // 上边缘内侧 1~2px 处亮度从 226 掉到 133，而左边缘只有一圈高光(207)。
    // 0.004 × (600px/1.5单位) ≈ 1.6px，正好就是那条线的宽度。
    // 参考实现是"圆角盒"，但它的圆角是**连续曲面**；挤出几何的倒角是**一个平面**，
    // 这个平面就是那条黑线。这里直接改成直角边：封板四面干净，靠圆角轮廓
    // （shape 里的 radius）保留硬壳书的外形。
    // 边缘改成**分段圆边**（不是以前那个单段平面倒角）。
    // 参考实现用的是 RoundedBoxGeometry —— 封板四周是一圈连续曲面：
    // 光扫过去是渐变的亮边，所以整块封面看起来有厚度、有起伏。
    // 我们之前因为单段倒角会形成一条死黑边而直接改成直角，结果封面四周
    // 是硬 90° 边、整体就是一块平板。这里用 3 段、圆角半径取板厚的 12%，
    // 既得到参考那种圆边，又不会出现那条平面倒角的暗线。
    var edgeRound = Math.min(depth * 0.12, 0.006);
    var geometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.001, depth - edgeRound * 2),
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: edgeRound,
        bevelThickness: edgeRound,
        curveSegments: 8
    });
    geometry.translate(0, 0, -depth / 2);
    remapBoardUV(geometry, width, height);
    return geometry;
}

// 书页块：照 complete-shelf 的 createPageBlockGeometry —— 圆角 + **靠书脊收腰**。
// 直角盒子近看就是一块方砖，边缘一点过渡都没有；真实书芯在订口那头是被
// 压紧的（|z| 变小），书口那头才是蓬开的。这两点一加，"一叠纸"的感觉才出来。
function pageBlockGeometry(THREE, width, height, depth, radius) {
    var x0 = -width / 2;
    var x1 = width / 2;
    var y0 = -height / 2;
    var y1 = height / 2;
    var shape = new THREE.Shape();
    shape.moveTo(x0 + radius, y0);
    shape.lineTo(x1 - radius, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + radius);
    shape.lineTo(x1, y1 - radius);
    shape.quadraticCurveTo(x1, y1, x1 - radius, y1);
    shape.lineTo(x0 + radius, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - radius);
    shape.lineTo(x0, y0 + radius);
    shape.quadraticCurveTo(x0, y0, x0 + radius, y0);

    // 同样不要倒角：书页块四周的斜面也会在上下/左右边形成一条暗带。
    var geometry = new THREE.ExtrudeGeometry(shape, {
        depth: depth,
        bevelEnabled: false,
        curveSegments: 6
    });
    geometry.translate(0, 0, -depth / 2);

    var position = geometry.attributes.position;
    for (var i = 0; i < position.count; i++) {
        var x = position.getX(i);
        var z = position.getZ(i);
        var nx = Math.max(0, Math.min(1, (x + width / 2) / width));
        var gp = Math.max(0, Math.min(1, nx / 0.16));
        var ease = gp * gp * (3 - 2 * gp);
        var pinch = (1 - ease) * 0.012;          // 订口处最多收 0.012
        position.setZ(i, (z >= 0 ? 1 : -1) * Math.max(0, Math.abs(z) - pinch));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    remapBoardUV(geometry, width, height);
    return geometry;
}

// ExtrudeGeometry 的正面 UV 直接取的是 Shape 的坐标（不是 0..1），
// 直接贴封面图会只取到左上角一小块。这里把正面/背面的 UV 归一化回 0..1。
function remapBoardUV(geometry, width, height) {
    var position = geometry.attributes.position;
    var uv = geometry.attributes.uv;
    if (!position || !uv || !geometry.groups) return;
    geometry.groups.forEach(function (group) {
        if (group.materialIndex !== 0) return;      // 0 = 正/背面，1 = 侧边
        for (var i = group.start; i < group.start + group.count; i++) {
            uv.setXY(i,
                (position.getX(i) + width / 2) / width,
                (position.getY(i) + height / 2) / height);
        }
    });
    uv.needsUpdate = true;
}



export function buildRig(THREE, book, index) {
    var colors = palette(index);
    var cloth = clothTextures(THREE, colors[0]);
    // 这一本自己的尺寸（照参考七本的比例轮换）；构造常数（封板/书脊/包边/
    // 印刷层内缩…）是绝对尺寸，不跟着书变大变小 —— 参考也是这么做的。
    var profile = BOOK_SIZES[index % BOOK_SIZES.length];
    var w = (book.size ? book.size.w : profile[0]) * REF_SCALE;
    var h = (book.size ? book.size.h : profile[1]) * REF_SCALE;
    var t = (book.size ? book.size.t : profile[2]) * REF_SCALE;
    var pageDepth = t - 0.026 * REF_SCALE;
    // 下面整段书体构造全是照模块常量写的；这里用**同名局部量把它们遮住**，
    // 于是同一段代码就自动按"这一本自己的尺寸"来建 —— 不用逐行改，
    // 也不会漏掉某处仍用着默认尺寸。
    var BOOK_W = w;
    var BOOK_H = h;
    var BOOK_T = t;
    var PAGE_DEPTH = pageDepth;
    // 书页块前表面（块厚 = 页芯厚 - 0.03×比例尺），书签带和叶叠都要用它
    var PAGE_BLOCK_FRONT = (pageDepth - 0.03 * REF_SCALE) / 2;

    // 照 complete-shelf 用 MeshPhysicalMaterial：法线 + 粗糙度贴图 + sheen。
    // sheen 是织物那种柔软的高光，是「布面」和「塑料板」的分界线。
    var boardMaterial = new THREE.MeshPhysicalMaterial({
        map: cloth.map,
        normalMap: cloth.normal,
        normalScale: new THREE.Vector2(0.34, 0.34),
        roughnessMap: cloth.roughness,
        roughness: 0.96,
        metalness: 0.02,
        bumpMap: cloth.bump,
        bumpScale: 0.0045,
        sheen: 0.34,
        sheenRoughness: 0.76,
        sheenColor: new THREE.Color(colors[3])
    });
    var pageMaterial = new THREE.MeshStandardMaterial({
        map: pageEdgeTexture(THREE),
        roughness: 0.95,
        metalness: 0,
        side: THREE.DoubleSide
    });

    var root = new THREE.Group();

    // 后封板
    var backBoard = new THREE.Mesh(
        // 圆角必须和前封板**同一个值**：之前这里是 0.05、前封是 0.009，
        // 后封看起来比前封圆得多。参考实现两块板共用同一个 coverGeometry。
        // 几何换成 three examples 的 RoundedBoxGeometry（vendor 原样文件，
        // 挂到 window.THREE 上），与参考实现用的是同一个类。
        // 取不到（加载顺序/旧缓存）就退回原来的挤出圆角几何，不会因此挂掉。
        (window.THREE_RoundedBoxGeometry
            ? new window.THREE_RoundedBoxGeometry(BOOK_W, BOOK_H, BOARD_T, 2, COVER_RADIUS)
            : boardGeometry(THREE, BOOK_W, BOOK_H, BOARD_T, COVER_RADIUS)),
        boardMaterial
    );
    // 封板包在书芯**外面**：内表面正好是 -BOOK_T/2
    backBoard.position.set(0, 0, -(BOOK_T / 2 + BOARD_T / 2));
    backBoard.castShadow = true;
    backBoard.receiveShadow = true;
    root.add(backBoard);

    // 封板与书脊之间的「书脊沟」（hinge groove）——complete-shelf 在前封和后封
    // 各贴一条 0.012 宽的窄条，颜色是布色 ×0.42，正好在合页的位置。
    // 硬壳书翻开时这里会凹下去一道，是精装本最容易被认出来的一条细节，
    // 我们之前完全没有。
    // 书脊沟（hinge groove）这两片薄贴片**撤掉了**。
    // 参考实现里确实有 frontGroove / backGroove，但我这版试了两轮都不对：
    // 先是变成封面左侧一条突兀的黑线（用户第一轮反馈），改成布面 + 渐变遮罩
    // 之后又出现了位置不对的黑条（alphaMap 取的是绿通道，那张渐变是纯黑的，
    // 结果是整片透明，反而让别处的暗边显出来）。合页那点凹痕靠书脊贴图上的
    // 明暗渐变 + 封板的圆角倒角已经能读出来，不再单独加片。

    // 书页块：比封板小一圈，形成硬壳书特有的「封面外伸」；
    // 外露的上下 + 书口三面是书口纸纹
    // 块要明显薄于书腔：叶叠在它的前后两面之外，不然会插进块里显穿模。
    var pageBlock = new THREE.Mesh(
        // 块比书芯略薄：叶叠在它前后两面之外，留出拱形外鼓的净空。
        // 圆角 + 订口收腰，见 pageBlockGeometry。
        // 尺寸与圆角照参考的 createPageBlockGeometry(pageWidth, pageHeight,
        // pageDepth, pageRadius)：页比封面窄 PAGE_INSET_W、矮 PAGE_INSET_H，
        // 圆角是它的 pageRadius(0.0025)×比例尺 —— 之前我们用 0.016 的圆角，
        // 相当于把一叠纸做成了圆角砖。
        pageBlockGeometry(THREE, BOOK_W - PAGE_INSET_W, BOOK_H - PAGE_INSET_H,
            PAGE_DEPTH - 0.03 * REF_SCALE, 0.0025 * REF_SCALE),
        pageMaterial
    );
    pageBlock.position.set(0.02, 0, 0);
    pageBlock.castShadow = true;
    root.add(pageBlock);

    // ===== 书口 / 天头 / 地脚：三块**独立纸边平面**（照参考的 foreEdge + edge）=====
    // 之前这里试过一版又撤掉了：那一版用的是"铺满整面"的平面，比页块的面还大，
    // 于是从上面看会看到一圈台阶、像贴纸。参考实现的这三块是**内缩**的：
    //   书口   pageDepth*0.94 × (pageHeight - 0.028)
    //   天/地  (pageWidth - 0.035) × pageDepth*0.94
    // 都比页块对应的面小一圈，只贴在面外侧 2mm —— 所以不会有台阶，
    // 反而把"一叠纸"分层做出来了（页块那三面的纸纹还在，正好当底色）。
    var pageEdgeTex = pageEdgeTexture(THREE);
    var edgeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: pageEdgeTex,
        bumpMap: pageEdgeTex,
        bumpScale: 0.002,
        roughness: 0.93,
        metalness: 0,
        sheen: 0.02,
        sheenRoughness: 1,
        side: THREE.DoubleSide
    });
    var pageW_ = BOOK_W - PAGE_INSET_W;
    var pageH_ = BOOK_H - PAGE_INSET_H;
    // **页块实际厚度**（比页芯薄 0.03×比例尺）。纸边层的厚度必须按它算：
    // 之前用 PAGE_DEPTH（页芯厚）算，纸边层比页块还厚 2cm 多 ——
    // 用户看到的就是"书口那条纸边比里面的页还宽"。
    var blockDepth_ = PAGE_DEPTH - 0.03 * REF_SCALE;
    var foreEdge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), edgeMaterial);
    foreEdge.scale.set(blockDepth_ * 0.94, pageH_ - 0.012 * REF_SCALE, 1);
    foreEdge.rotation.y = Math.PI * 0.5;
    // 位置要盖住**最外面那层纸**：叶是从书脊挂出来的，它的书口边在
    // spineX + pageW，比页块的书口面还远一点点。之前按页块算，纸边层反而
    // 落在叶的里面 —— 侧着看就是"纸边离书页很远、中间一条缝"。
    var foreEdgeX = Math.max(pageBlock.position.x + pageW_ * 0.5,
        (-BOOK_W / 2 + SPINE_W * 0.62) + pageW_) + 0.001;
    foreEdge.position.set(foreEdgeX, 0, 0);
    foreEdge.receiveShadow = true;
    root.add(foreEdge);
    [-1, 1].forEach(function (direction) {
        var edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), edgeMaterial);
        edge.scale.set(pageW_ - 0.02 * REF_SCALE, blockDepth_ * 0.94, 1);
        edge.rotation.x = direction > 0 ? -Math.PI * 0.5 : Math.PI * 0.5;
        // 天地两面同理，横向取页块中心与叶中心的中点，保证盖住两层纸
        // 上下纸边贴着页顶/页底（只抬 1mm），不再悬在离页 2mm 的地方
        edge.position.set((pageBlock.position.x + ((-BOOK_W / 2 + SPINE_W * 0.62) + pageW_ * 0.5)) * 0.5,
            direction * (pageH_ * 0.5 + 0.001), 0);
        edge.receiveShadow = true;
        root.add(edge);
    });

    // 真正解决"下缘发黑"的是环境贴图
    // （见 buildStudioEnvironment），纸边的细线则靠纹理本身画清楚 —— 见
    // pageEdgeTexture()。所以这三块平面撤掉。

    // 堵头布：完全照 complete-shelf 的构法 —— 圆柱轴向绕 X 转 90°，
    // 也就是**顺着书的厚度方向（Z）**，长度取书厚的一小段，位置贴书脊。
    // 从正面看它就是书脊两端的一个小圆点，而不是一条横贯整本书的彩带。
    // 堵头布：参考是一条**织纹圆柱**（细密的纵向条纹 + 一点绒感），
    // 不是一根纯色塑料棒。条纹画在贴图的 u 方向 —— 圆柱的 u 是绕圈方向，
    // v 是轴方向，所以条纹是"沿着轴的一道道"，正是堵头布的织法。
    var bandCanvas = makeCanvas(64, 8);
    var bctx = bandCanvas.getContext('2d');
    bctx.fillStyle = colors[3];
    bctx.fillRect(0, 0, 64, 8);
    for (var bi = 0; bi < 64; bi += 2) {
        bctx.fillStyle = bi % 4 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.16)';
        bctx.fillRect(bi, 0, 1, 8);
    }
    var bandTexture = new THREE.CanvasTexture(bandCanvas);
    bandTexture.colorSpace = THREE.SRGBColorSpace;
    bandTexture.wrapS = bandTexture.wrapT = THREE.RepeatWrapping;
    bandTexture.repeat.set(6, 1);
    var headbandMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: bandTexture,
        roughness: 0.78,
        metalness: 0
    });
    // 完全照 complete-shelf 的四组数：
    //   长度 = pageDepth × 0.88
    //   x    = -pageWidth/2 + 0.046      ← 以**页宽**为基准，不是封面宽
    //   y    = ±(pageHeight/2 - 0.004)   ← 以**页高**为基准，不是书高
    // 之前 y 用的是 BOOK_H/2，比页高多了 0.034 —— 正好把它顶到内衬与书页的
    // 覆盖范围之外，于是整个圆柱都露在外面。
    // 堵头布贴着**书页块**的上下沿，所以尺寸跟着页走（见 REF_SCALE 那一段）
    var hbPageW = BOOK_W - PAGE_INSET_W;
    var hbPageH = BOOK_H - PAGE_INSET_H;
    var headbandLength = PAGE_DEPTH * 0.88;
    var headbandX = -hbPageW * 0.5 + 0.046;
    [-1, 1].forEach(function (sign) {
        // 用户反馈"下边那个圆柱离书脊太近、也放大一点"：
        // 半径 0.012 → 0.016，离书脊再让开 0.014（x 从 +0.046 到 +0.060）。
        var band = new THREE.Mesh(
            new THREE.CylinderGeometry(0.016, 0.016, headbandLength, 14), headbandMaterial);
        band.rotation.x = Math.PI * 0.5;
        band.position.set(headbandX + 0.014, sign * (hbPageH / 2 - 0.004), 0);
        root.add(band);
    });

    // 书脊：照 complete-shelf —— 薄板（0.014）贴在封面**之外**，
    // 而且深度是「书芯 + 封板×1.88」，把上下封板的边一起包进去。
    // 这样书的轮廓才是精装书那种「书脊把两块板夹住」的样子。
    var spine = new THREE.Mesh(
        // 参考用的是 RoundedBoxGeometry(spineBoardThickness, height-0.012,
        //   depth + board*1.88, 1, spineRadius=0.0015)，**且不旋转** ——
        // RBG 的轴本来就对：x = 薄边、y = 高、z = 书的厚度方向。
        // 所以参数顺序与它逐字一致，并去掉原来的 -90° 旋转。
        // （取不到 RBG 时退回原来的"挤出 + 转 -90°"写法，不会因此挂掉。）
        (window.THREE_RoundedBoxGeometry
            ? new window.THREE_RoundedBoxGeometry(SPINE_BOARD, BOOK_H - 0.012,
                BOOK_T + BOARD_T * 1.88, 1, 0.0015)
            : boardGeometry(THREE, BOOK_T + BOARD_T * 1.88, BOOK_H - 0.012,
                SPINE_BOARD, 0.0015)),
        new THREE.MeshPhysicalMaterial({
            map: spineTexture(THREE, book, index),
            normalMap: cloth.normal,
            // 凸起感要明显：法线 + bump 都比封面那套大得多（封面 0.28/0.0035）。
            // 书脊在货架视角只有七八十像素宽，强度不够就完全看不出来。
            normalScale: new THREE.Vector2(0.9, 0.9),
            roughnessMap: cloth.roughness,
            bumpMap: cloth.bump,
            bumpScale: 0.012,
            roughness: 0.9,
            metalness: 0.02,
            sheen: 0.32,
            sheenRoughness: 0.76,
            sheenColor: new THREE.Color(colors[3])
        })
    );
    // 只对**退回的挤出几何**需要把轴转过去：挤出轴原本是 z，要转到 x。
    // 用 **-90°** 而不是 +90°：
    // remapBoardUV 只归一化了"正面"那组 UV，反过来的那面字是镜像的；
    // -90° 正好让标了 UV 的 +z 面朝外（书脊外侧），书名才不会反着读。
    // 用 RBG 时它已经是 x = 薄边，再转就错了 —— 所以按有没有 RBG 分别设。
    // 两种配置下贴图朝向一致（u 沿 +z、v 沿 +y），书脊书名不需要重画。
    spine.rotation.y = window.THREE_RoundedBoxGeometry ? 0 : -Math.PI / 2;
    spine.position.set(-BOOK_W / 2 - SPINE_BOARD * 0.35, 0, 0);
    spine.castShadow = true;
    root.add(spine);

    // 书脊内衬：照 complete-shelf —— 书脊里侧的一层「衬纸」，
    // 尺寸 spineWidth*0.68 × (高−0.056) × (pageDepth−0.008)，
    // 位置在 -width/2 + spineWidth*0.38。书本摊开时，书脊里那一层厚度靠它显示。
    var spineLining = new THREE.Mesh(
        // 内衬要**看得见厚度**：加宽到书脊宽的 0.9（原来 0.68 太窄），
        // 并用比书页更暖更深一档的纸色，才能和右边的书页拉开对比。
        new THREE.BoxGeometry(SPINE_W * 0.9, BOOK_H - 0.056, Math.max(0.045, PAGE_DEPTH - 0.008)),
        new THREE.MeshStandardMaterial({ color: '#e6d8bd', roughness: 0.95, metalness: 0 })
    );
    spineLining.position.set(-BOOK_W / 2 + SPINE_W * 0.38, 0, 0);
    root.add(spineLining);

    // 书口订口分层：complete-shelf 在书口有 6 道「订口」细条，
    // 书合上时从侧面看就是一叠分层的纸，而不是一整块。
    var signatureMaterial = new THREE.MeshStandardMaterial({
        color: '#d9c9a8', roughness: 0.95, metalness: 0
    });
    for (var si = 0; si < 6; si++) {
        var signature = new THREE.Mesh(
            new THREE.BoxGeometry(0.0035, 0.00135, PAGE_DEPTH * 0.91), signatureMaterial);
        signature.position.set(
            0.018 * REF_SCALE + (BOOK_W - PAGE_INSET_W) * 0.5 + 0.001,
            -(BOOK_H - PAGE_INSET_H) * 0.5 + ((si + 1) / 7) * (BOOK_H - PAGE_INSET_H),
            0);
        root.add(signature);
    }

    // 书签带：完全照 complete-shelf 的摆法 ——
    //   尺寸 0.034 × pageHeight*0.76 × 0.002
    //   位置 x = -pageWidth/2 + 0.09，y = -pageHeight*0.17，z = pageDepth/2 + 0.003
    //   再带一点点侧倾 rotation.z = ±0.014
    // 它是躺在**整叠纸的最前**、从中间往下垂的，不是贴在后封上。
    var rw = BOOK_W - PAGE_INSET_W;
    var rh = BOOK_H - PAGE_INSET_H;
    var ribbonLength = rh * 0.76;
    var ribbon = new THREE.Mesh(
        new THREE.BoxGeometry(0.034, ribbonLength, 0.002),
        new THREE.MeshStandardMaterial({ color: colors[3], roughness: 0.62, metalness: 0.04 })
    );
    // z 要落在**整叠纸的最后面**（书页块正前方），不能夹在中间：
    // 夹在中间的话，翻过几页就会从书页里露出上半段 —— 用户看到的就是
    // 「第 7 页露出一点、第 9 页全露出来」。放在最后面，无论翻到第几页，
    // 它都被所有页盖住，只有垂出书底的那一截露着，这才是书签该有的样子。
    ribbon.position.set(-rw * 0.5 + 0.09 * REF_SCALE, -rh * 0.17,
        PAGE_BLOCK_FRONT + 0.0025);
    ribbon.rotation.z = 0.014;
    root.add(ribbon);
    // （书签带末端那截斜切口按用户要求撤掉了，恢复成平口的一根带子。）

    // 书脚接触阴影：脚下的一小块软椭圆，让书"坐"在板上而不是飘着。
    // 之前删掉的那版是"比书还大的一块半透明黑贴片"，铺在书后看着像黑背景；
    // 正确做法是只在落地那一小块、很淡。
    var contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactShadowMaterial(THREE));
    contact.rotation.x = -Math.PI / 2;
    // 书的占地：x 方向是书厚（含两块封板），z 方向是书宽
    contact.scale.set((BOOK_T + BOARD_T * 1.9) * 2.2, BOOK_W * 1.5, 1);
    // 根节点的原点是书的中心，往下 BOOK_H/2 就是板面（缩放会自动跟着走）
    contact.position.set(0, -(BOOK_H / 2) + 0.003, 0);
    root.add(contact);

    // 这里原来还有三片「翻页时扇一下」的薄纸。那是早期没有真正的叶结构时的
    // 临时做法，现在叶本身就是逐张可翻的，这三片纯属多余 —— 而且它们会被
    // 转到近 170° 卡在那里，变成一张斜插进整本书的黄条纹纸。
    // 前封板：挂在书脊处的 pivot 上，旋转 pivot 即可「翻开」
    var coverPivot = new THREE.Group();
    // 前封板同样包在书芯外面：枢轴定在书芯前表面
    coverPivot.position.set(-BOOK_W / 2, 0, BOOK_T / 2 + BOARD_T / 2);
    root.add(coverPivot);

    var coverTextureRef = coverTexture(THREE, book, index);
    // 封面上的印刷图案（照 complete-shelf 的 coverArt）：**印在布上**，
    // 所以布面那套法线/粗糙度/织纹要一起带上来，再补一点点 clearcoat
    // （印刷墨层的光泽）。我原来是 MeshStandardMaterial + 只有 bumpMap，
    // 于是封面看着像一层光滑塑料贴纸 —— 用户说的"纯布面不够真实"就是它。
    // ⚠️ 但印刷层的织纹扰动必须**比布面本身轻**：布板那层 normalScale 0.34 /
    // bumpScale 0.0045 是对的，照搬到印字这层，细笔画会被经纬纹打碎，
    // 远看就是"糊"。这里压到 0.1 / 0.0015，并去掉那层 clearcoat（0.06 的
    // 清漆在斜看时是一层薄高光，正压在字上）。
    var coverMaterial = new THREE.MeshPhysicalMaterial({
        map: coverTextureRef,
        normalMap: cloth.normal,
        normalScale: new THREE.Vector2(0.1, 0.1),
        roughnessMap: cloth.roughness,
        bumpMap: cloth.bump,
        bumpScale: 0.0015,
        roughness: 0.92,
        metalness: 0.035,
        clearcoat: 0,
        // 印刷层的 sheen（柔和高光）比纯布面那层再低一档：它是盖在字上的
        // 一层薄雾，越高越把细笔画冲淡
        sheen: 0.14,
        sheenRoughness: 0.78,
        sheenColor: new THREE.Color(colors[3])
    });
    // 封板 = **纯布面**，封面图案另做一层贴在它外面 —— 照参考实现的结构
    // （它也是 cloth 的 frontCover + 单独的 coverPlane 印刷层）。
    // 之前是把封面贴图直接给封板的两个大面，于是**封板内侧也是封面图案**，
    // 通过纸叠和封板之间那条缝就能看见（用户报的"后封里面也能看到图片"）。
    var frontBoard = new THREE.Mesh(
        // 与后封板同一个类（three examples 的 RoundedBoxGeometry）
        (window.THREE_RoundedBoxGeometry
            ? new window.THREE_RoundedBoxGeometry(BOOK_W, BOOK_H, BOARD_T, 2, COVER_RADIUS)
            : boardGeometry(THREE, BOOK_W, BOOK_H, BOARD_T, COVER_RADIUS)),
        boardMaterial
    );
    frontBoard.position.set(BOOK_W / 2, 0, 0);
    frontBoard.castShadow = true;
    frontBoard.receiveShadow = true;
    coverPivot.add(frontBoard);

    // 封面印刷层（对应参考的 coverPlane / coverSurfaceGeometry）：
    // 尺寸在封板基础上内缩 ART_INSET，圆角取 0.0035×比例尺，和参考一致。
    var coverSurfaceGeometry = roundedPlaneGeometry(
        THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET, 0.0035 * REF_SCALE);
    var frontArt = new THREE.Mesh(coverSurfaceGeometry, coverMaterial);
    // 台阶高度照参考：封面印刷层在 board*0.55（比封板外表面高出 5% 板厚）
    frontArt.position.set(BOOK_W / 2, 0, BOARD_T * 0.55);
    coverPivot.add(frontArt);

    // ---- 烫金独立层（照 complete-shelf：alphaMap + 高金属度 + polygonOffset）----
    // 画在贴图里的金色不会反光，只有做成独立金属网格才有压印烫金的感觉。
    var foilCanvas = makeCanvas(768, 1152);
    paintCover(foilCanvas, book, index, true);
    var foilTexture = new THREE.CanvasTexture(foilCanvas);
    foilTexture.colorSpace = THREE.SRGBColorSpace;
    foilTexture.anisotropy = 16;      // 烫金细字同理
    // 烫金该"亮"还是该"暗"，取决于它相对布色是亮还是暗 —— 这也是这次
    // "封面字看不清"的正解：
    //   · 金比布**亮**（深布那五组）：高金属度在这间屋子里反射不到足够的
    //     光，会把亮金渲成一片中暗调，字只比布亮一点点（实测对比度 47~62）。
    //     把金属度降到 0.32 让 baseColor 重新当反照率用、再补一点自发光，
    //     亮金才真的亮起来。
    //   · 金比布**暗**（第 3 组：#8f6f33 深铜金配 #d5c5a0 浅亚麻）：
    //     它本来就是靠"深字压浅布"读出来的，保持金属度、不要自发光 ——
    //     一起改成亮金反而会把这两本弄糊（实测 149 → 78）。
    var foilHex = FOIL_COLORS[index % FOIL_COLORS.length];
    var foilIsBright = hexLum(foilHex) > hexLum(colors[0]);
    var foilTune = foilIsBright
        ? { metalness: 0.32, roughness: 0.24, emissiveIntensity: 0.14 }
        : { metalness: 0.9, roughness: 0.2, emissiveIntensity: 0 };
    var foilMaterial = new THREE.MeshPhysicalMaterial({
        color: foilHex,
        map: foilTexture,
        alphaMap: foilTexture,
        // 烫金要**压印出来**才有厚度：参考给烫金层单独烘了一张 emboss 图当
        // bumpMap（bumpScale 0.016）。我们之前只贴了颜色，于是书名/图案是
        // 平的 —— 这也是"封面整体不够凹凸"的一半原因。这里直接拿烫金图当
        // 高度图（金线处凸、空白处凹）。
        bumpMap: foilTexture,
        bumpScale: 0.014,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        // 见上面 foilTune 的说明：亮金配深布要降金属度 + 一点自发光，
        // 深铜金配浅布保持金属度（靠深字压浅布读出来）。
        roughness: foilTune.roughness,
        metalness: foilTune.metalness,
        emissive: new THREE.Color(foilHex),
        emissiveIntensity: foilTune.emissiveIntensity,
        clearcoat: 0.18,
        clearcoatRoughness: 0.12
    });
    var frontFoil = new THREE.Mesh(
        roundedPlaneGeometry(THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET,
            0.0035 * REF_SCALE), foilMaterial);
    // 烫金再往外一层：board*0.605
    frontFoil.position.set(BOOK_W / 2, 0, BOARD_T * 0.605);
    coverPivot.add(frontFoil);

    // ---- 合页沟（hinge groove）----
    // 参考实现前封/后封各一条：宽 0.012、距书脊 0.038、颜色 = 布色 ×0.42，
    // 带布面凹凸。精装书翻开时合页处凹下去的那道痕，是"这是本硬壳书"最直接的
    // 信号。以前撤掉是因为当时用的是纯黑材质，看着像一条突兀的黑线；
    // 这次照参考用"布色压暗"，位置也照它的 0.038×比例尺。
    // ===== 合页沟：要读成"凹进去"，不能是一块硬边深色条 =====
    // 之前那版是平色条 + 两条肩线，侧着看还是一张纸。这版改成**渐变沟**：
    //   · alphaMap：中间最实、两侧渐隐 → 看不出硬边
    //   · bumpMap：中间凹、两侧微微起坡 → 主光扫过去有"暗-亮"的滚动
    // 就是参考那条 `frontGroove/backGroove` 的做法，只是把它的平色换成了渐变，
    // 照参考原样：**平色**深色条（布色 ×0.42）+ 布面凹凸，不用渐变也不用几何
    // （前两版我自己发明的"渐变沟""凸起几何脊"全部撤掉）。
    // 参考的 frontGroove 就是一条 flat quad，位置在 board*0.655，
    // 也就是比封面印刷层(0.55)、烫金层(0.605)再往外一层 —— **四层台阶**。
    var grooveMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(colors[0]).multiplyScalar(0.42),
        bumpMap: cloth.bump,
        bumpScale: 0.006,
        roughness: 0.9,
        metalness: 0,
        transparent: true,
        side: THREE.DoubleSide
    });
    var frontGroove = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1), grooveMaterial);
    frontGroove.scale.set(GROOVE_W, BOOK_H * 0.94, 1);
    frontGroove.position.set(GROOVE_X, 0, BOARD_T * 0.655);
    coverPivot.add(frontGroove);

    // 书脊烫金层：贴在书脊外表面
    var spineFoilTex = spineFoilTexture(THREE, book, index);
    var spineFoilMaterial = new THREE.MeshPhysicalMaterial({
        color: foilHex,
        map: spineFoilTex,
        alphaMap: spineFoilTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        // 书脊烫金同前封（见 foilTune）：竖排书名才不会在深布上糊成一片
        roughness: foilTune.roughness,
        metalness: foilTune.metalness,
        emissive: new THREE.Color(foilHex),
        emissiveIntensity: foilTune.emissiveIntensity,
        side: THREE.DoubleSide
    });
    var spineFoil = new THREE.Mesh(
        new THREE.PlaneGeometry(BOOK_T + BOARD_T * 1.82, BOOK_H - 0.018), spineFoilMaterial);
    spineFoil.rotation.y = -Math.PI * 0.5;
    spineFoil.position.set(-BOOK_W / 2 - SPINE_BOARD * 0.35 - SPINE_BOARD * 0.5 - 0.001, 0, 0);
    root.add(spineFoil);

    // 封底图案：贴在后封板外表面
    // （同样是**独立一层**，封板本身保持纯布面；圆角与内缩都照参考的
    //   coverSurfaceGeometry：宽高各内缩 ART_INSET、圆角 0.0035×比例尺）
    var backArt = new THREE.Mesh(
        roundedPlaneGeometry(THREE, BOOK_W - ART_INSET, BOOK_H - ART_INSET,
            0.0035 * REF_SCALE),
        new THREE.MeshStandardMaterial({
            map: backCoverTexture(THREE, book, index), roughness: 0.92, metalness: 0.02
        })
    );
    // 后封同构：印刷层 -board*0.55、烫金 -board*0.605（照参考的台阶高度）
    backArt.position.set(0, 0, -(BOOK_T / 2 + BOARD_T / 2 + BOARD_T * 0.55));
    backArt.rotation.y = Math.PI;
    root.add(backArt);

    // 后封的合页沟（照参考的 backGroove：位置在书脊侧 0.038×比例尺处）
    var backGroove = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1), grooveMaterial);
    backGroove.scale.set(GROOVE_W, BOOK_H * 0.94, 1);
    backGroove.position.set(-BOOK_W / 2 + GROOVE_X, 0,
        -(BOOK_T / 2 + BOARD_T / 2 + BOARD_T * 0.535));
    backGroove.rotation.y = Math.PI;
    root.add(backGroove);

    // 这里原来有一片「环衬」，和书本模式加进去的内侧扉页几乎共面，
    // 两者会 z-fighting —— 表现就是合上封面时有一条东西「穿进第一页里」。
    // 内侧那一层统一交给 insideMesh，这里不再重复。

    // 封面内侧的 turn-ins：照 complete-shelf —— 布面向内折进去的那一圈边。
    // 四条窄条（头 / 脚 / 书脊侧 / 书口侧）贴在封板内表面，宽度取 0.018。
    // 有了它，翻开封面看到的内侧才像「布边包住纸板」，而不是一块平的布。
    var turnInDepth = 0.002;
    [
        [BOOK_W * 0.5, BOOK_H * 0.5 - TURN_IN * 0.56, BOOK_W - TURN_IN * 0.7, TURN_IN],
        [BOOK_W * 0.5, -BOOK_H * 0.5 + TURN_IN * 0.56, BOOK_W - TURN_IN * 0.7, TURN_IN],
        [TURN_IN * 0.56, 0, TURN_IN, BOOK_H - TURN_IN * 2.2],
        [BOOK_W - TURN_IN * 0.56, 0, TURN_IN, BOOK_H - TURN_IN * 2.2]
    ].forEach(function (def) {
        var strip = new THREE.Mesh(
            new THREE.BoxGeometry(def[2], def[3], turnInDepth), boardMaterial);
        strip.position.set(def[0], def[1], -BOARD_T / 2 - turnInDepth / 2);
        // 包边条**不参与投影**。无头浏览器量出来：翻开封面后，内侧的上/下/左
        // 各有一条 4~5px、亮度只有 72~89 的暗带（书页是 237~241）。那就是这四条
        // 2mm 厚的窄条：它们贴在封板内表面、又比封板更靠近光源，被封板自己的
        // 阴影整条吃掉。关掉 castShadow/receiveShadow，它们就回到和封板同样的布色。
        strip.castShadow = false;
        strip.receiveShadow = false;
        coverPivot.add(strip);
    });

    return {
        root: root,
        coverPivot: coverPivot,
        frontBoard: frontBoard,
        coverTexture: coverTextureRef,
        contact: contact,
        book: book,
        index: index,
        // 这一本自己的尺寸与由它推出的站位（书架布局、摊开对位、
        // 叶叠的起止位置都从这里取，别再读模块常量）
        dims: {
            width: w,
            height: h,
            depth: t,
            pageDepth: pageDepth,
            pageW: w - PAGE_INSET_W,
            pageH: h - PAGE_INSET_H,
            spineX: -w / 2 + SPINE_W * 0.65,
            board: BOARD_T,
            pageBlockFront: PAGE_BLOCK_FRONT,
            leafRestFront: t / 2 - 0.006,
            leafRestBack: PAGE_BLOCK_FRONT + 0.005,
            leafRestStep: LEAF_REST_STEP
        },
        target: new THREE.Vector3(),
        targetRotationY: 0,
        targetScale: 1,
        visible: true
    };
}

export function disposeRig(rig) {
    rig.disposed = true;
    rig.__book = null;
    rig.root.traverse(function (object) {
        if (object.geometry) object.geometry.dispose();
        var materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(function (material) {
            if (!material) return;
            // 共享纹理（布面 / 书口 / 木架）不能在这里释放，只释放每本书独有的封面贴图
            if (material.map && material.map === rig.coverTexture) material.map.dispose();
            material.dispose();
        });
    });
}
