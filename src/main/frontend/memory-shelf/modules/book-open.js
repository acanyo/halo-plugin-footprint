/**
 * 进入检视态：把书架上那本书变成可翻阅的书，准备并加载页面贴图、同步面包屑。
 */

import { state, els, shelf, reduceMotion } from './state.js';
import { BOOK_RETREAT_MS, startRigTimeline, syncPageCount } from './shelf-scene.js';
import { api, clamp } from './utils.js';
import { loadImage } from './cover-photos.js';
import { ENDPAPER_INSET } from './book-dimensions.js';
import { setPhase } from './shelf-interaction.js';
import { setHeader, ensureViewReset } from './overlay.js';
import {
    LEAF_SEG_X,
    LEAF_SEG_Y,
    LEAF_UNTURNED,
    LEAF_TURNED,
    leafFanStep,
    COVER_TILT,
    book,
    setBook,
    addLeaf,
    layoutLeafStack,
    trimLeaves
} from './book-rig.js';
import { pageTextureFor, blankPageTexture, repaintTexture } from './page-paint.js';
import { bookPageSpecs } from './page-specs.js';

// ---------------- 进入 / 翻页 / 退出 ----------------

// 不再另建一本「检视用」的书：直接把书架上那本精选书变成可翻阅的书。
// 这样打开时画面完全不切换 —— 就是同一本书在原地摊开。
function makeRigBook(rig) {
    if (rig.__book) return rig.__book;
    var THREE = shelf.THREE;
    // **这一本自己的尺寸**（每本书的宽高厚不同，见 BOOK_SIZES）。
    // 摊开后的页宽/页高、转轴位置、叶叠起止全部从它取。
    var dims = rig.dims;
    var BOOK_W = dims.width;
    var BOOK_H = dims.height;
    var BOOK_T = dims.depth;
    var BOARD_T = dims.board;

    // 前面内侧的扉页：封面掀开后左边看到的那一整页
    var insideMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1, LEAF_SEG_X, LEAF_SEG_Y),
        new THREE.MeshStandardMaterial({ map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0 }));
    // 内侧扉页几乎铺满整个封板内表面（只留 3mm 布边）。
    // 原来是让出 TURN_IN(0.018) —— 那圈布边本身就是"黑边"：
    // 无头浏览器量出来它只有 72~89 亮度，而纸页是 237~241，
    // 翻开封面后内侧上/下/左各一条 4~5px 的暗带就是它。
    // 参考实现的扉页也是"比封面小一点点"，不是让出一整圈 18mm。
    insideMesh.scale.set(BOOK_W - 0.006, BOOK_H - 0.006, 1);
    // 内侧扉页贴在封板里侧，且比最上面那片叶更靠前：
    // 掀开时它从纸叠上方扫过去，而不是从纸里穿过去
    // 内侧纸页紧贴封板（原来是 -0.003，留了一条 3mm 的缝；那条缝从斜角看进去
    // 是黑的，也会加深内侧四周那圈暗带）。贴平之后内表面就是"布边 + 纸页"。
    insideMesh.position.set(BOOK_W / 2, 0, -BOARD_T / 2 - 0.0006);
    insideMesh.rotation.y = Math.PI;
    rig.coverPivot.add(insideMesh);

    // 后封内侧 = **环衬（纸）**，照参考实现的 backEndpaper：
    // 尺寸是 (宽 - 0.045) × (高 - 0.045)（各内缩 0.0225，×比例尺），
    // 四周留出包边的布边 —— 不是一张铺满的纸。
    //
    // ⚠️ 这一层**不能贴内容页**：之前它取的是最后一页的贴图（章节里是省份封面、
    // 相册里是最后一张照片），而纸叠比封板小一圈，转到侧面时透过那条缝就能
    // 看到后封内侧的图片 —— 用户报的"后面的封面里面也能看到图片"就是它。
    // 内容页有自己的叶，书末翻到最后一跨页时自然会露出来。
    var insideBackMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1, 4, 4),
        new THREE.MeshStandardMaterial({ map: null, color: '#fdfaf3', roughness: 0.95, metalness: 0 }));
    insideBackMesh.scale.set(BOOK_W - ENDPAPER_INSET, BOOK_H - ENDPAPER_INSET, 1);
    insideBackMesh.position.set(0, 0, -BOOK_T / 2 + 0.0006);
    rig.root.add(insideBackMesh);

    // 接触阴影整块删掉了。它是一张比书还大的半透明暗色贴片，铺在书后 ——
    // 在亮色墙面上看就是「书背后有一块黑背景」。书本身的投影由场景里的
    // 方向光 shadowMap 给出，已经够了。

    // 摊开后要**居中显示**：封面掀开以后比纸页还宽，视觉重心落在书脊左边，
    // 所以不能按书脊估（那样书会明显偏左）。这里直接量一次"封面摊平"时
    // 整本书在自己坐标系里的包围盒，取它的中心作为对齐基准。
    // 叶只会落在封面范围内，所以这本书量一次就够，不用每帧算。
    var savedPos = rig.root.position.clone();
    var savedRot = rig.root.rotation.clone();
    var savedScale = rig.root.scale.clone();
    var savedCover = rig.coverPivot.rotation.y;
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    rig.root.scale.setScalar(1);
    rig.coverPivot.rotation.y = -Math.PI;
    rig.root.updateMatrixWorld(true);
    var openBox = new THREE.Box3().setFromObject(rig.root);
    rig.coverPivot.rotation.y = savedCover;
    rig.root.position.copy(savedPos);
    rig.root.rotation.copy(savedRot);
    rig.root.scale.copy(savedScale);
    rig.root.updateMatrixWorld(true);

    rig.__book = {
        group: rig.root,          // 要移动的就是书架上的这本书本体
        frontPivot: rig.coverPivot,
        frontBoard: rig.frontBoard,
        insideMesh: insideMesh,
        insideBackMesh: insideBackMesh,
        leaves: [],
        dims: dims,
        rig: rig,
        // 摊开后整本书的中心（本书自己的坐标系，x 方向）
        openCenterX: (openBox.min.x + openBox.max.x) / 2
    };
    return rig.__book;
}

function applyFaceTexture(face, texture) {
    if (!face || !face.mesh) return;
    // 贴图是共享的（state.bookTextures 里缓存着，翻回来还要用），只换引用不释放
    face.mesh.material.map = texture;
    face.mesh.material.needsUpdate = true;
}

// 把一组页装进书本，并显示第 spreadIndex 个跨页
// 「抽出来」那一秒里，书已经翻开一角、里面两页是看得见的，
// 所以贴图必须**在动画开始前**就贴上去。否则第一次进来这一秒是两张白纸
// （第二次来，上一回贴好的贴图还留在网格上，看起来就正常 —— 这正是
// 「同一本书第一次看不见、第二次能看见」的原因）。
// ⚠️ 参数**不能叫 book**：模块级有个同名的 book（当前展开的书），参数会把它遮住，
// 里面那句 book = runtime 就只改了参数，paintBookPageWindow 读到的仍是 null、
// 直接早退 —— 翻开动画那几张页因此是白纸（用户报的"翻开过程中页的内容没了"）。
export function prepareBookPages(data) {
    var three = shelf && shelf.THREE;
    var rig = shelf && shelf.rigs[state.active];
    if (!three || !rig || !data) return;
    var runtime = makeRigBook(rig);
    if (!runtime) return;
    var pages = bookPageSpecs(data);
    var blank = blankPageTexture(three);
    var leafCount = Math.max(1, Math.ceil(Math.max(0, pages.length - 1) / 2));
    trimLeaves(runtime, leafCount);
    while (runtime.leaves.length < leafCount) addLeaf(three, runtime, runtime.leaves.length);
    layoutLeafStack(leafCount);
    // 先全部铺白纸，再由 paintBookPageWindow 只画"当前跨页附近"那几页 ——
    // 城市内容现在都排在同一本书里，一次全画要几百 MB 画布（见那里的说明）。
    state.bookPages = pages;
    state.bookTextures = [];
    applyFaceTexture({ mesh: runtime.insideMesh }, blank);
    // 后封内侧是**环衬**，不是内容页（见 makeRigBook 里的说明）
    if (runtime.insideBackMesh) {
        applyFaceTexture({ mesh: runtime.insideBackMesh }, blank);
    }
    runtime.leaves.forEach(function (leaf) {
        applyFaceTexture(leaf.front, blank);
        applyFaceTexture(leaf.back, blank);
        leaf.pivot.rotation.y = LEAF_UNTURNED + leaf.index * leafFanStep;
        leaf.pivot.position.z = leaf.restZ;
    });
    var savedBook = book;
    setBook(runtime);
    paintBookPageWindow(pages, 0);
    setBook(savedBook);
    // 记下"这本书 + 这叠页"：openChapters 里 loadBookPages 会拿到**同一个数组**，
    // 于是它不会再清空贴图缓存、重画一遍 —— 否则翻开动画刚结束那一下，
    // 页会先白一帧再重新画出来（用户看到的"翻开过程中页的内容没了"）。
    preparedPages = { book: data, pages: pages };
}

var preparedPages = null;

// 翻开动画前已经把这叠页画好了：这里把同一个数组交回去（见 prepareBookPages 的说明）
export function preparedPageSpecs(b) {
    if (preparedPages && preparedPages.book === b) return preparedPages.pages;
    return bookPageSpecs(b);
}

export function loadBookPages(pages, spreadIndex, title, intro, crumb) {
    var d = api();
    var three = shelf && shelf.THREE;
    if (!three) return;
    // 用书架上当前这本精选书本身，而不是另建一本
    var activeRig = shelf.rigs[state.active];
    if (!activeRig) return;
    // 必须写回模块级的 book：检视态的每一处逻辑（翻页、封面开合、轨道旋转、
    // 行命中）都读它。漏掉这一行，整本书就停在书架姿态上一动不动 —— 看起来
    // 就是「书在左边、超出屏幕、拖不动也翻不了」。
    setBook(makeRigBook(activeRig));
    var runtime = book;
    if (!runtime) return;

    // 从书架进来才播「抽出来 + 封面掀开」；章节与相册之间换页集时不重播
    var fromShelf = state.mode !== 'book';
    state.bookPages = pages;
    state.bookSpread = spreadIndex || 0;
    state.mode = 'book';
    setPhase('inspection');
    state.bookEnterAt = fromShelf ? performance.now() : 0;
    runtime.group.visible = true;
    runtime.rig.disposed = false;
    // 书列退场：其余的书按一条**确定的时间线**沉下去（参考实现是把整个
    // shelfStage 平移出画面）。**只有从书架进来才起这段动画** —— 章节 <-> 相册
    // 只是在书本模式里换页集，那些书早就在下面藏好了，再起一次会让整排书架
    // 在摊开的书后面闪一下（用户说的「书架突然显示又消失」）。
    if (fromShelf) {
        var retreatAt = performance.now();
        shelf.rigs.forEach(function (rig) {
            if (rig === runtime.rig) return;
            rig.sinkTarget = 1;
            rig.visible = false;
            startRigTimeline(rig, retreatAt, reduceMotion ? 0 : BOOK_RETREAT_MS, false);
        });
    }
    runtime.rig.sinkTarget = 0;
    runtime.rig.sink = 0;
    runtime.rig.root.visible = true;
    // 书脚那圈接触阴影是"坐在板上"用的：书摊开悬在半空之后它就成了
    // 挂在书底下的一块灰斑（也让人以为书搁在地上）。检视态收掉，
    // 合书回到书架时由 layoutShelf / 每帧逻辑自动放回来。
    if (runtime.rig.contact) runtime.rig.contact.visible = false;
    // 书架那排木板（含前缘压条、背挡）在摊开的书底下会显得很怪，一起收掉。
    // 之前只收了 plank，我新加的前缘压条就留在画面底部 —— 用户看到的
    // 「书本展开后底部还有木条」就是它。
    if (shelf.plank) shelf.plank.visible = false;
    if (shelf.plankLip) shelf.plankLip.visible = false;
    // 背挡（walnut-back-rail）是**横在整面墙上的一条深色木条**，
    // 之前漏了它：搁板和压条都收掉之后，这条木条就孤零零地横在空屋子里 ——
    // 用户说的「书本展开后横条没有消失」就是它。收书时候再一起放回来。
    if (shelf.backRail) shelf.backRail.visible = false;
    // 立柱也收掉：书本检视态是特写，两侧留着两根木柱会像是"还在书架上"。
    // 参考实现是把整个 shelfStage 平移出画面（同一目的）。
    if (shelf.uprights) shelf.uprights.forEach(function (u) { u.visible = false; });
    // 左侧信息板向左缩回，把整幅舞台让给摊开的书
    els.root.classList.add('book-mode');

    // 书架上那套提示与地面阴影在书本模式下都不再成立，换掉/藏掉，
    // 否则会出现「书已经摊开了，底下还写着拖动浏览书架」这种错位提示
    var hint = els.stage.querySelector('.ms-stage-hint');
    if (hint) hint.textContent = '拖动空白处转动整间屋子，点右页城市条目看相册';
    var floor = els.stage.querySelector('.ms-floor');
    if (floor) floor.hidden = true;

    // 建贴图：只画"当前跨页 ±2 跨"那几页（见 paintBookPageWindow），其余留给
    // blank，翻到附近时再补画 —— 几十页一次全建出来太吃显存。
    // ⚠️ 如果这叠页正是 prepareBookPages 刚画过的那一份（同一个数组），
    // 就**别清空缓存**：清了以后要重画一遍，动画刚结束那一下页会先白一下。
    var freshPages = state.bookPages !== pages;
    if (freshPages) state.bookTextures = [];

    // 页序：pages[0] 是封面内侧那一页（扉页），从 pages[1] 起才排到叶上，
    // 每片叶承载「一页正面 + 一页背面」。这样第 0 个跨页就是「扉页 | 第一页」，
    // 一打开就能看到可点的城市列表，而不是先对着一张单独的封面页。
    var blank = blankPageTexture(three);
    var leafCount = Math.max(1, Math.ceil(Math.max(0, pages.length - 1) / 2));
    // 先按当前页集裁掉多余的叶，再补齐、再统一排站位（站位依赖片数）
    trimLeaves(runtime, leafCount);
    while (runtime.leaves.length < leafCount) addLeaf(three, runtime, runtime.leaves.length);
    layoutLeafStack(leafCount);
    // 同一叠页（prepareBookPages 刚画过）就别铺白了：留着的贴图正是动画里
    // 已经显示出来的那几张，铺白会让页在动画末尾先白一帧。
    if (freshPages) {
        applyFaceTexture({ mesh: runtime.insideMesh }, blank);
        // 后封内侧是**环衬**（纸），不贴内容页
        if (runtime.insideBackMesh) {
            applyFaceTexture({ mesh: runtime.insideBackMesh }, blank);
        }
        runtime.leaves.forEach(function (leaf) {
            applyFaceTexture(leaf.front, blank);
            applyFaceTexture(leaf.back, blank);
        });
    }
    runtime.leaves.forEach(function (leaf) {
        // 整叠往书脊处收一点，让每页的左边贴着书脊
        leaf.flex.targetCurve = 0.004;
        leaf.flex.targetTwist = 0;
        // 换页集时直接把姿态按新的跨页摆好，避免从上一本书的姿态飘过来
        var turned = leaf.index < state.bookSpread;
        leaf.pivot.rotation.y = turned
            ? LEAF_TURNED + leaf.index * 0.014
            : LEAF_UNTURNED + leaf.index * leafFanStep;
        leaf.pivot.position.z = turned ? leaf.turnedZ : leaf.restZ;
    });

    refreshBookSpread();
    setHeader(title, intro, crumb);

    if (els.prev) els.prev.hidden = true;
    if (els.next) els.next.hidden = true;
    syncPageCount(false);
    if (fromShelf) {
        // 别再硬把封面按回 0：从书架"抽出来"的那一秒里，架上的书本来就被
        // 掀开了一角（renderShelfStage 那段 -1.92）。这里归零的话，封面会
        // 先合上、再重新翻开 —— 用户看到的就是"放大过程中又翻了一次"。
        // 直接从当前角度接着往下开，动画才是连续的一下。
        var COVER_FULL = -Math.PI + COVER_TILT;
        state.bookOpen = COVER_FULL
            ? clamp(book.frontPivot.rotation.y / COVER_FULL, 0, 1)
            : 0;
        ensureViewReset();
        // 直接展开到第一页内容：不再要求用户先点一次封面。
        // bookOpen 从 0 补间到 1，所以掀封面这个动作仍然看得到，只是不用手点。
        state.openTarget = 1;
        state.coverHover = false;
        state.coverDrag = null;
        state.orbit = null;
        state.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
        // 记下这本书**此刻**的位姿：入场就是从这个位姿补间到检视态，
        // 中途没有尺寸突变、没有倾角突变，读起来就是「这一本滑到中间摊开」
        state.bookFrom = {
            x: runtime.group.position.x,
            y: runtime.group.position.y,
            z: runtime.group.position.z,
            scale: runtime.group.scale.x,
            rotX: runtime.group.rotation.x,
            rotY: runtime.group.rotation.y
        };
    }
}



function queuePagePhoto(texture, spec) {
    var d = api();
    if (!d) return;
    // 一页可能有**多张**照片（spec.shots）；封面/扉页那种单张的走 spec.photo。
    var jobs = [];
    if (spec.shots && spec.shots.length) {
        spec.shots.forEach(function (shot) {
            if (shot && shot.url && !shot.image) {
                jobs.push({ get: function () { return shot.image; },
                    set: function (img) { shot.image = img; }, url: shot.url });
            }
        });
    } else if (spec.photo && !spec.image) {
        jobs.push({ get: function () { return spec.image; },
            set: function (img) { spec.image = img; }, url: spec.photo });
    }
    jobs.forEach(function (job) {
        var url = d.cityCardImageUrl(job.url) || job.url;
        if (!url) return;
        var apply = function (image) {
            if (!image || job.get()) return;
            job.set(image);
            repaintTexture(texture, spec);
        };
        // 慢图床（直连超时或代理 502）第一次拿不到很常见；隔一会儿再试一次，
        // 免得相册里留下一个空页
        loadImage(url).then(apply).catch(function () {
            setTimeout(function () {
                loadImage(url).then(apply).catch(function () { /* 还是拿不到就留白 */ });
            }, 2600);
        });
    });
}

export function refreshBookSpread() {
    if (!book) return;
    // spread = 已经翻过去的叶数。每片叶的姿态由 updateBookTurn 每帧推向目标，
    // 这里只负责把数值夹到合法范围。
    state.bookSpread = Math.max(0, Math.min(state.bookSpread, bookSpreads() - 1));
    state.pageTurn = null;
    // 翻到新的一跨：把这一跨附近的页补画出来（城市内容都在同一本书里，
    // 一次全画太吃显存），同时把顶栏面包屑切到当前这座城市。
    paintBookPageWindow(state.bookPages, state.bookSpread);
    syncSpreadCityCrumb();
}

// 只画「当前跨页 ±2 跨」那几页。一本省的书可能有几十页（每座城市的内容都
// 排在同一页集里），一次全画成 800×1128 的画布要几百 MB；按窗口画，
// 内存有界，翻到别处再补画，用户完全看不出来。
function paintBookPageWindow(pages, spread) {
    var three = shelf && shelf.THREE;
    if (!three || !book || !pages || !pages.length) return;
    var from = Math.max(0, spread * 2 - 4);
    var to = Math.min(pages.length - 1, spread * 2 + 5);
    for (var i = from; i <= to; i += 1) {
        if (state.bookTextures[i]) continue;
        var spec = pages[i];
        var texture = pageTextureFor(three, spec,
            (spec.kind || 'page') + ':' + (spec.title || '') + ':' + i);
        state.bookTextures[i] = texture;
        queuePagePhoto(texture, spec);
        applyPageTextureAt(i, texture);
    }
    // 窗口外的页**真的释放**。只补画不释放，"懒渲染"其实只省了首屏 ——
    // 一路翻到书尾，整本书的贴图都会留在显存里（34 页 ≈ 163MB）。
    // 窗口 = 当前跨 ±2 跨（10 页）；释放后的页翻回来会重画，
    // 而重画发生在它进入视野**之前**（翻一跨窗口整体移 2 页，新进的那两页
    // 当场补画），所以看不到白页。
    for (var j = 0; j < state.bookTextures.length; j += 1) {
        if (j >= from && j <= to) continue;
        var old = state.bookTextures[j];
        if (!old) continue;
        applyPageTextureAt(j, blankPageTexture(three));   // 先换回白纸，别留坏引用
        old._released = true;
        if (old.dispose) old.dispose();
        state.bookTextures[j] = null;
    }
}

// 第 i 页贴到哪儿：0 是封面内侧那面，其余按 (i-1) 落到第几片叶的正面/背面
function applyPageTextureAt(index, texture) {
    if (!book) return;
    if (index === 0) {
        applyFaceTexture({ mesh: book.insideMesh }, texture);
        return;
    }
    var leaf = book.leaves[Math.floor((index - 1) / 2)];
    if (!leaf) return;
    applyFaceTexture((index - 1) % 2 === 0 ? leaf.front : leaf.back, texture);
}

// 顶栏面包屑跟着"现在翻到哪座城市"走：城市内容已经排进同一本书，
// 不能再等换页集时才更新标题了。
function syncSpreadCityCrumb() {
    if (!book) return;
    var pages = state.bookPages || [];
    // 城市名可能落在**跨页的任意一侧**（例如"城市章节 | 某城扉页"这一跨，
    // 城市在右页），所以两侧都要看。
    var left = pages[state.bookSpread * 2];
    var right = pages[1 + state.bookSpread * 2];
    // 跨页的两页可能属于不同层级：左边是上一座城市的最后一页、右边是新城市的
    // 扉页时，面包屑**跟右页走** —— 那是这次翻页刚到达、接下来要读的内容，
    // 而左页自己带着书眉（省名/城市名），信息不会丢。
    // ⚠️ city / spotName / cityPage 必须取自**同一页**，否则会出现
    // "城市已经是新的、足迹点还挂着上一座城的"这种错位。
    var main = right || left;
    var city = main && main.city;
    // 足迹点进面包屑的判据用 spec.spotName：点在它自己的**照片页**上也带着
    // 这个名字（只认 kind==='spot' 的话，一翻到照片页名字就会消失、来回翻一直抖）。
    var spotName = (main && main.spotName) || '';
    var cityPage = main && main.cityPage;
    // 用户要求：点省那段回到**目录页**（不是城市章节页），所以用 tocPage
    var tocPage = (left && left.tocPage !== undefined)
        ? left.tocPage : (right && right.tocPage);
    var province = state.province;
    if (!province) return;
    // 省那段也走"翻页过去"（和城市段一致）；拿不到页码时才退回原来的层级返回
    var crumb = [{ label: '世界这本书', to: 'shelf' }];
    crumb.push(tocPage !== undefined
        ? { label: province.name, to: 'page', page: tocPage, tag: '目 录' }
        : { label: province.name, to: 'chapters' });
    if (city && city.name) {
        // 城市那段可点：直接翻到这座城市的扉页
        crumb.push(cityPage !== undefined && cityPage !== state.bookSpread * 2
            ? { label: city.name, to: 'page', page: cityPage, tag: '旅行相册' }
            : { label: city.name });
    }
    if (spotName) crumb.push({ label: spotName, tag: '足迹点' });
    else if (crumb.length && crumb[crumb.length - 1].to) {
        // 当前这一段（省或市）补上层级后缀，一眼看出深度
        var last = crumb[crumb.length - 1];
        crumb[crumb.length - 1] = { label: last.label, tag: last.tag };
    }
    state.city = city || null;
    var titleText = spotName
        ? spotName + ' · 足迹点'
        : (city && city.name ? city.name + ' · 旅行相册' : province.name + ' · 城市章节');
    // ⚠️ 副标题**不能传空串**：<p> 没有内容就不生成行盒，高度从 18px 掉到 0，
    // 顶栏随之变矮，下面的画布/书本跟着重排 —— 用户看到的就是"翻页时提示突然
    // 消失、屏幕突然变大"。这里按当前层级给对应的引导语（本来副标题就是这个用途）。
    var introText = spotName
        ? '左右翻页看这个足迹点的照片；点上面的城市名可以跳回这座城。'
        : (city && city.name
            ? '左右翻页看照片；点上面的「' + province.name + '」回到目录。'
            : '点右页的城市条目，翻开它的旅行相册。');
    setHeader(titleText, introText, crumb);
}


export function bookSpreads() {
    // 返回的是**跨页总数**，合法索引是 0 .. 总数-1。
    // 第 s 个跨页 = 左 pages[2s] | 右 pages[1+2s]（pages[0] 印在封面内侧）。
    // 能翻到的最大 s 是「左页还在」的最大 s：2s <= P-1 → floor((P-1)/2)，
    // 加 1 就是总数。原来写的是 ceil((P-1)/2)，P 为偶数时正好多一跨 ——
    // 于是「最后有内容的那一跨」之后还能再翻一页全白的纸。
    var pages = (state.bookPages || []).length;
    return Math.max(1, Math.floor((pages + 1) / 2));
}
