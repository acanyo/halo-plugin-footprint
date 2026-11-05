/**
 * 详情卡：足迹卡与城市聚合卡的内容填充、入场方向、显隐与焦点管理。
 *
 * 从 markers.js 拆出。标记实体与城市聚合仍归 markers.js，这里通过它导出的取值函数读
 * （markerEntityList / cityListSnapshot，数组重建后拿到的永远是新的那份）。
 *
 * 依赖方向只有一条：本模块 import markers.js；markers.js 的键盘焦点按钮要打开这里的卡片时，
 * 走 setupMarkers 注入的 showMarkerCard / showCityCard / rememberKeyboardMarkerBtn，不反向 import。
 */

import { formatLatitude, formatLongitude } from './survey-format.js';
import {
    cityWallImages,
    loadCardCoverImage,
    formatCityDate,
    openCityView,
    closeCityView,
    openCityViewAtFootprint,
    showCardCover,
    cityView
} from './city-view.js';
import { hidePhotoRing } from './photo-ring.js';
import { closeProvinceCards } from './province-cards.js';
import { pauseAutoRotate, resumeAutoRotate } from './auto-rotate.js';
import {
    ticketImageUrl,
    ticketDate,
    ticketItemsFromFootprints,
    setTicketView
} from './ticket-gallery.js';
import { MARKER_SIZE, MARKER_SIZE_SELECTED } from './marker-icons.js';
import {
    markerEntityList,
    cityListSnapshot,
    cityViewItems,
    cityPhotoItems,
    cancelCityReveal,
    flyToCity,
    hideMarkerTip
} from './markers.js';
import {
    clearWishEntitySelection,
    setWishEntitySelected
} from './wish-layer.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.footprints               () => Footprint[]
 * @param d.viewer                   () => Cesium.Viewer
 * @param d.reduceMotion             () => boolean
 */
export function setupMarkerDetailCard(d) {
    deps = d;
}

// 键盘打开足迹卡时记下的那个标记按钮：关卡片后把焦点还给它
let lastKeyboardMarkerBtn = null;

/** 键盘（Enter）从标记按钮打开足迹卡时调用，关闭卡片后焦点回到这个按钮。 */
export function rememberKeyboardMarkerBtn(btn) {
    lastKeyboardMarkerBtn = btn;
}

// ================= 标记交互：悬停显示名称，点击打开详情卡 =================
export const markerCard = document.getElementById('markerCard');
const markerCardMedia = document.getElementById('markerCardMedia');
const markerCardTitle = document.getElementById('markerCardTitle');
const markerCardMeta = document.getElementById('markerCardMeta');
const markerCardKind = document.getElementById('markerCardKind');
const cityCardProvince = document.getElementById('cityCardProvince');
const markerCardAddr = document.getElementById('markerCardAddr');
const markerCardAddrRow = document.getElementById('markerCardAddrRow');
const markerCardDesc = document.getElementById('markerCardDesc');
const markerCardTags = document.getElementById('markerCardTags');
const markerCardActions = markerCard.querySelector('.marker-card-actions');
const markerCardTicket = document.getElementById('markerCardTicket');
export const markerCardGallery = document.getElementById('markerCardGallery');
const markerCardGalleryLabel = document.getElementById('markerCardGalleryLabel');
const markerCardStamp = document.getElementById('markerCardStamp');
export const cityCard = document.getElementById('cityCard');
const cityCardMedia = document.getElementById('cityCardMedia');
const cityCardTitle = document.getElementById('cityCardTitle');
const cityCardDesc = document.getElementById('cityCardDesc');
const cityStatFootprints = document.getElementById('cityStatFootprints');
const cityStatPhotos = document.getElementById('cityStatPhotos');
const cityCardGallery = document.getElementById('cityCardGallery');
const cityCardLocate = document.getElementById('cityCardLocate');
let activeCityIndex = -1;
let cityCardTriggerBtn = null;
// 详情卡（足迹卡 / 城市聚合卡）：整球视图（标题卡出现）时自动收起；初始化完成前不触发
let detailCardsReady = false;

detailCardsReady = true;   // 详情卡已就绪，可响应整球视图自动关闭
let activeFootprintIndex = -1;
let activeWishKey = '';
let markerRestoreRaf = null;

function setMarkerSelected(index) {
    if (markerRestoreRaf) {
        cancelAnimationFrame(markerRestoreRaf);
        markerRestoreRaf = null;
    }
    cancelCityReveal();
    markerEntityList().forEach((ent, i) => {
        const sel = i === index;
        ent.billboard.width = sel ? MARKER_SIZE_SELECTED : MARKER_SIZE;
        ent.billboard.height = sel ? MARKER_SIZE_SELECTED : MARKER_SIZE;
        ent.billboard.color = sel ? Cesium.Color.WHITE : Cesium.Color.WHITE.withAlpha(0.42);
    });
}

// 关闭卡片时，标记圆点/光圈与卡片淡出同节奏复原。
// 注意：billboard.width/color 读回的是 Property 包装对象，不能直接当数值用，
// 所以起点状态用代码里记录的选中项（选中/全亮，其他基准尺寸/42% 透明度）。
function restoreMarkers(duration, selIndex) {
    if (markerRestoreRaf) {
        cancelAnimationFrame(markerRestoreRaf);
        markerRestoreRaf = null;
    }
    const start = performance.now();
    function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        const k = t * t * (3 - 2 * t);   // smoothstep 缓动
        markerEntityList().forEach((ent, i) => {
            const fromW = (i === selIndex) ? MARKER_SIZE_SELECTED : MARKER_SIZE;
            const fromA = (i === selIndex) ? 1.0 : 0.42;
            ent.billboard.width = fromW + (MARKER_SIZE - fromW) * k;
            ent.billboard.height = fromW + (MARKER_SIZE - fromW) * k;
            ent.billboard.color = Cesium.Color.WHITE.withAlpha(fromA + (1 - fromA) * k);
        });
        if (t < 1) {
            markerRestoreRaf = requestAnimationFrame(tick);
        } else {
            markerRestoreRaf = null;
        }
    }
    markerRestoreRaf = requestAnimationFrame(tick);
}

// 浮层显隐统一先处理焦点：隐藏时先 blur，再置 inert，最后更新 aria-hidden，
// 避免“焦点停留在 aria-hidden=true 的祖先内”造成的无障碍警告。
export function setOverlayHidden(el, hidden) {
    if (!el) return;
    if (hidden && el.contains && el.contains(document.activeElement)) {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
    }
    if ('inert' in el) {
        el.inert = !!hidden;
    }
    el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

export function hideMarkerCard() {
    hidePhotoRing();                               // 卡片收起时照片环一起收（环是卡片的延伸）
    document.body.classList.remove('card-open');   // 恢复右下角浮动按钮
    resumeAutoRotate('card');                      // 详情卡关掉：按用户偏好恢复自转
    clearWishEntitySelection();
    activeWishKey = '';
    markerCard.classList.remove('is-wish');
    delete markerCard.dataset.wishEntity;
    markerCardTags.hidden = true;
    markerCardTags.replaceChildren();
    if (!markerCard.classList.contains('visible')) return;
    markerCard.classList.remove('visible');
    // 注意：这里要的是「那个按钮」，不是判断结果 —— 直接写 && 链会得到布尔值，
    // 后面调 .focus() 会抛 TypeError（键盘打开卡片后再点「打开图片墙」会因此打不开图墙）
    const keyboardRestore = (lastKeyboardMarkerBtn &&
        lastKeyboardMarkerBtn.isConnected &&
        markerCard.contains(document.activeElement))
        ? lastKeyboardMarkerBtn
        : null;
    lastKeyboardMarkerBtn = null;
    setOverlayHidden(markerCard, true);
    const selIndex = activeFootprintIndex;   // 先记录再置空，供复原动画使用
    activeFootprintIndex = -1;
    if (deps.reduceMotion()) {
        markerEntityList().forEach(ent => {
            ent.billboard.width = MARKER_SIZE;
            ent.billboard.height = MARKER_SIZE;
            ent.billboard.color = Cesium.Color.WHITE;
        });
    } else {
        restoreMarkers(450, selIndex);   // 与卡片淡出时长一致
    }
    // 键盘关闭后，把焦点还给触发打开的标记按钮
    if (keyboardRestore) {
        keyboardRestore.focus();
    }
}

// ================= 详情卡主图：加载成功显示图片，失败回退首字占位 + 重试 =================
let cardImgLoadId = 0;   // 防止快速切换卡片时旧请求覆盖新图

function showCardMonogram(fp, showRetry) {
    markerCardMedia.classList.add('no-image');
    markerCardMedia.style.backgroundImage = 'none';
    markerCardMedia.innerHTML =
        '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>' +
        (showRetry ? '<button class="marker-card-retry" type="button">重试</button>' : '');
    if (showRetry) {
        markerCardMedia.querySelector('.marker-card-retry').addEventListener('click', (e) => {
            e.stopPropagation();
            const f = deps.footprints()[activeFootprintIndex];
            if (f && f.image) loadCardImage(f, true);   // 重试：绕过失败缓存
        });
    }
}

// force=true 用于卡片上的"重试"按钮：跳过共享缓存里那条失败结论，真的重新请求一次
function loadCardImage(fp, force) {
    const myId = ++cardImgLoadId;
    markerCardMedia.classList.add('no-image');
    markerCardMedia.style.backgroundImage = 'none';
    markerCardMedia.innerHTML =
        '<span class="marker-card-monogram">' + (fp.name ? fp.name.charAt(0) : '?') + '</span>';
    // 走共用的封面加载队列（并发限流 + 成功缓存）；这张卡有显式的重试按钮，
    // 所以关掉"静默重试"，失败立刻把重试按钮交出来。
    loadCardCoverImage(fp.image, (ok) => {
        if (myId !== cardImgLoadId) return;   // 已被更新的卡片取代
        if (!ok) {
            showCardMonogram(fp, true);   // 图片失败：首字占位 + 重试
            return;
        }
        markerCardMedia.classList.remove('no-image');
        markerCardMedia.style.backgroundImage = 'url("' + fp.image + '")';
        markerCardMedia.innerHTML = '';
    }, { retry: false, force: !!force });
}

// ================= 足迹卡入场方向：从被点的标记那一侧长出来 =================
// 足迹卡是「这一条记录」的展开，所以位移方向与缩放原点都指向标记点，
// 城市卡则是侧边容器、固定从右侧滑入。这样不用读文字也能看出这张卡属于哪个点。
const CARD_ENTER_DISTANCE = 22;    // 入场起点离静止位的距离（像素）
const CARD_ENTER_MIN_DIST = 40;    // 标记离卡片太近时不硬凑方向，退回默认的右侧滑入

// 卡片的「静止布局盒」：只按定位属性和布局尺寸推算，绝不碰 transform。
// 一旦临时改 transform，浏览器会从被改动的那一帧重新开始一段过渡，
// 把真正的入场动画搅乱（实测会把「从标记方向展开」变成「从上往下掉」）。
// offsetWidth/offsetHeight 本身不受 transform 影响，left/right/top/bottom
// 是 position:fixed 相对视口的计算值，桌面（right+top）与窄屏（left+bottom）都覆盖。
export function cardLayoutRect(card) {
    if (!card) return null;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (!width || !height) return null;
    const cs = getComputedStyle(card);
    const px = (value) => (value === 'auto' ? null : parseFloat(value));
    const left = px(cs.left) ?? (px(cs.right) === null ? null : window.innerWidth - px(cs.right) - width);
    const top = px(cs.top) ?? (px(cs.bottom) === null ? null : window.innerHeight - px(cs.bottom) - height);
    if (left === null || top === null) return null;
    return { left, top, width, height };
}

// 标记点的屏幕坐标；聚合态 / 地球背面 / 数据缺失时返回 null，调用方走默认方向
export function markerScreenPosition(index) {
    const ent = markerEntityList()[index];
    if (!ent || ent.show === false) return null;
    if (!ent.billboard || ent.billboard.show === false) return null;
    const pos = ent.position && ent.position.getValue(Cesium.JulianDate.now());
    if (!pos) return null;
    // 与悬停标注同一套半球判定：转到地球背面的标记没有可参照的屏幕位置
    const normal = Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3());
    const toCamera = Cesium.Cartesian3.subtract(deps.viewer().camera.positionWC, pos, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(normal, toCamera) < 0) return null;
    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(deps.viewer().scene, pos);
    return screen && Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
}

function applyCardEnterDirection(index) {
    const rect = cardLayoutRect(markerCard);
    const screen = rect ? markerScreenPosition(index) : null;
    if (!screen) {
        markerCard.style.removeProperty('--card-enter-x');
        markerCard.style.removeProperty('--card-enter-y');
        markerCard.style.removeProperty('--card-origin-x');
        markerCard.style.removeProperty('--card-origin-y');
        return;
    }
    const dx = screen.x - (rect.left + rect.width / 2);
    const dy = screen.y - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < CARD_ENTER_MIN_DIST) {
        markerCard.style.setProperty('--card-enter-x', '0px');
        markerCard.style.setProperty('--card-enter-y', '0px');
    } else {
        markerCard.style.setProperty('--card-enter-x', Math.round(dx / len * CARD_ENTER_DISTANCE) + 'px');
        markerCard.style.setProperty('--card-enter-y', Math.round(dy / len * CARD_ENTER_DISTANCE) + 'px');
    }
    // 缩放原点落在离标记最近的那条边上：卡片看起来是从标记这一侧张开的
    const pct = (value) => Math.max(0, Math.min(100, value)).toFixed(1) + '%';
    markerCard.style.setProperty('--card-origin-x', pct((screen.x - rect.left) / rect.width * 100));
    markerCard.style.setProperty('--card-origin-y', pct((screen.y - rect.top) / rect.height * 100));
}

// 开场时序：带方向的「隐藏态」必须先落到样式上，再切到可见态。
// 否则浏览器会把这次变化当成「上一次的静止值 → 可见值」，过渡起点变成默认的右侧位置，
// 表现为第一张卡片总是从右边滑进来、只有第二次打开才从标记方向展开。
function openMarkerCardFrom(index) {
    const savedTransition = markerCard.style.transition;
    markerCard.style.transition = 'none';   // 让隐藏态立即生效（卡片此刻不可见，不会有闪烁）
    applyCardEnterDirection(index);
    void markerCard.offsetWidth;            // 强制一次样式计算，把带方向的隐藏态定为过渡起点
    markerCard.style.transition = savedTransition;
    markerCard.classList.add('visible');
}

export function showMarkerCard(fp, index) {
    hideCityCard(false);
    closeProvinceCards();   // 详情卡与省份卡片组互斥：打开详情卡就收起省份卡片
    pauseAutoRotate('card');   // 打开足迹详情卡：临时停转（关掉卡片按用户偏好自动恢复）
    clearWishEntitySelection();
    activeWishKey = '';
    markerCard.classList.remove('is-wish');
    markerCardTags.hidden = true;
    markerCardTags.replaceChildren();
    activeFootprintIndex = index;
    markerCardTitle.textContent = fp.name;
    markerCardAddr.textContent = fp.address || '';
    // 地址为空时连图标一起收起（编辑窗里地址是必填的，这里只是兜底）
    if (markerCardAddrRow) markerCardAddrRow.hidden = !(fp.address || '').trim();
    markerCardDesc.textContent = fp.description || '';

    // 眉标位写「类型」（旅游 / 美食…），信息行写所在城市与坐标：都是这条记录自己的事实
    if (markerCardKind) {
        markerCardKind.textContent = fp.footprintType || '';
        markerCardKind.hidden = !fp.footprintType;
    }
    const coord = Number.isFinite(fp.lat) && Number.isFinite(fp.lng) && (fp.lat || fp.lng)
        ? formatLatitude(fp.lat) + '  ' + formatLongitude(fp.lng)
        : '';
    const metaParts = [fp.city, coord].filter(Boolean);
    markerCardMeta.textContent = metaParts.join('，');
    markerCardMeta.hidden = metaParts.length === 0;

    // 日期单独做成印章（纸票据的识别符号），不再和信息行挤在一行
    const stampText = ticketDate(fp.createTime || fp.ticketDate);
    markerCardStamp.textContent = stampText;
    markerCardStamp.hidden = !stampText;

    // 足迹详情卡动作：只有配置了票根的足迹才提供“打开票根”，无票根时整行隐藏。
    // 主次分开：有票根时票根是主操作，否则图片墙顶上，避免所有按钮看起来一样重要。
    const hasTicket = !!ticketImageUrl(fp.ticketImage);
    const galleryCount = cityWallImages(fp).length;
    const hasGallery = galleryCount > 0;
    markerCardGallery.hidden = !hasGallery;
    markerCardTicket.hidden = !hasTicket;
    markerCardActions.hidden = !hasGallery && !hasTicket;
    markerCardTicket.classList.toggle('is-primary', hasTicket);
    markerCardGallery.classList.toggle('is-primary', hasGallery && !hasTicket);
    markerCardGalleryLabel.textContent = galleryCount > 1 ? '打开图片墙 · ' + galleryCount : '打开图片墙';

    if (fp.image) {
        loadCardImage(fp);
    } else {
        showCardMonogram(fp, false);
    }

    setMarkerSelected(index);
    openMarkerCardFrom(index);   // 从被点的标记方向展开（标记不可用时保持默认的右侧滑入）
    document.body.classList.add('card-open');   // 隐藏右下角浮动按钮，避免遮挡
    setOverlayHidden(markerCard, false);
}

function wishPlanStamp(wish) {
    const year = Number(wish?.spec?.plannedYear);
    const month = Number(wish?.spec?.plannedMonth);
    if (Number.isFinite(year) && year > 0) {
        return `${year}${Number.isFinite(month) && month > 0
            ? `.${String(month).padStart(2, '0')}`
            : ''}`;
    }
    return String(wish?.spec?.plannedTimeNote || '').trim();
}

export function wishCardIsOpenFor(wish, entity) {
    return markerCard.classList.contains('visible') &&
        activeWishKey === wish?.metadata?.name &&
        (!entity || String(entity.id || '') === markerCard.dataset.wishEntity);
}

export function showWishCard(wish, entity) {
    if (!wish?.spec) return;
    hideCityCard(false);
    closeProvinceCards();
    hidePhotoRing();
    hideMarkerTip();
    pauseAutoRotate('card');
    activeFootprintIndex = -1;
    activeWishKey = wish.metadata?.name || '';
    markerCard.dataset.wishEntity = entity?.id || '';
    markerCard.classList.add('is-wish');

    const title = String(wish.spec.title || '未来足迹');
    const status = {
        wish: '心愿',
        planning: '计划中',
        booked: '已订票',
        visited: '已实现'
    }[wish.spec.status] || '心愿';
    const region = [wish.spec.province, wish.spec.city].filter(Boolean).join(' / ');
    const lng = Number(wish.spec.longitude);
    const lat = Number(wish.spec.latitude);
    const coordinate = Number.isFinite(lng) && Number.isFinite(lat)
        ? `${formatLatitude(lat)}  ${formatLongitude(lng)}`
        : '';
    const plan = wishPlanStamp(wish);

    markerCardMedia.classList.add('no-image');
    markerCardMedia.style.backgroundImage = 'none';
    markerCardMedia.innerHTML =
        '<span class="marker-card-monogram">' +
        (Array.from(title)[0] || '愿') +
        '</span>';
    markerCardKind.textContent = status;
    markerCardKind.hidden = false;
    markerCardStamp.textContent = plan;
    markerCardStamp.hidden = !plan;
    markerCardTitle.textContent = title;
    markerCardMeta.textContent = [region, coordinate].filter(Boolean).join('，');
    markerCardMeta.hidden = !markerCardMeta.textContent;
    markerCardAddr.textContent = wish.spec.address || '';
    if (markerCardAddrRow) {
        markerCardAddrRow.hidden = !(wish.spec.address || '').trim();
    }
    markerCardDesc.textContent =
        wish.spec.description || '还没有写下想去这里的理由。';
    const tags = [...new Set(
        (Array.isArray(wish.spec.tags) ? wish.spec.tags : [])
            .map(tag => String(tag || '').trim())
            .filter(Boolean)
    )];
    markerCardTags.replaceChildren(...tags.map(tag => {
        const item = document.createElement('span');
        item.textContent = tag;
        return item;
    }));
    markerCardTags.hidden = tags.length === 0;
    markerCardActions.hidden = true;
    markerCardTicket.hidden = true;
    markerCardGallery.hidden = true;
    setWishEntitySelected(entity || null);
    markerCard.classList.add('visible');
    document.body.classList.add('card-open');
    setOverlayHidden(markerCard, false);
}

document.getElementById('markerCardClose').addEventListener('click', hideMarkerCard);

// 打开票根：跳到票根墙并定位到当前足迹对应的那张票根
markerCardTicket.addEventListener('click', () => {
    if (activeFootprintIndex < 0) return;
    const fp = deps.footprints()[activeFootprintIndex];
    if (!fp || !ticketImageUrl(fp.ticketImage)) return;
    const items = ticketItemsFromFootprints();
    // 优先按足迹唯一 key 定位，避免对象替换/顺序变化时错配到其他票根
    let ticketIndex = fp.key ? items.findIndex(item => item.key === fp.key) : -1;
    if (ticketIndex < 0) ticketIndex = items.indexOf(fp);
    if (ticketIndex < 0) return;
    hideMarkerCard();
    setTicketView(true, ticketIndex, false);   // 从足迹卡进入票根时不自动开启地球旋转
});

export function showCityCard(ci, triggerBtn) {
    const city = cityListSnapshot()[ci];
    if (!city) return;
    closeProvinceCards();   // 详情卡与省份卡片组互斥：打开城市卡就收起省份卡片
    pauseAutoRotate('city-card');   // 打开城市聚合卡：临时停转（关掉卡片按用户偏好自动恢复）
    if (markerCard.classList.contains('visible')) hideMarkerCard();
    if (cityView.classList.contains('show')) closeCityView(false);
    hideMarkerTip();

    activeCityIndex = ci;
    cityCardTriggerBtn = triggerBtn || null;
    const fps = cityViewItems(ci);
    const photos = cityPhotoItems(ci);
    const latest = fps.map(fp => fp.createTime).filter(Boolean).sort().pop();
    const types = [...new Set(fps.map(fp => fp.footprintType).filter(Boolean))];
    cityCardTitle.textContent = city.city;
    if (cityCardProvince) {
        const province = fps.map(fp => fp.province).find(Boolean) || '';
        cityCardProvince.textContent = province;
        cityCardProvince.hidden = !province;
    }
    // 容器层要回答的是「这里有多少」：两个数字比一句话更好扫读
    cityStatFootprints.textContent = String(fps.length);
    cityStatPhotos.textContent = String(photos.length);
    // 最近到访带上年份（旅行记录里年份是有意义的，之前挤进统计格被截掉了），
    // 和记录类型合成一行次级信息
    const descParts = [];
    if (latest) descParts.push('最近一次 ' + formatCityDate(latest).replace(/\s*\/\s*/, '.'));
    if (types.length) descParts.push(types.join('、'));
    cityCardDesc.textContent = descParts.join('，');
    cityCardDesc.hidden = descParts.length === 0;
    // 封面按需加载，不做任何预取：曾试过「悬停城市标记即预热 + 预解码」，
    // 实测拖动一次扫过标记区就会打出 7 个封面图请求（和底图瓦片抢带宽/主线程），
    // 拖动明显变卡，所以退回按需加载。
    // 这里统一走 cardCover 那套：首字先顶上，图片加载成功后淡入，失败就停在首字。
    showCardCover(cityCardMedia, photos.length ? photos[0].url : '', city.city ? city.city.charAt(0) : '?');
    cityCard.classList.add('visible');
    setOverlayHidden(cityCard, false);
    flyToCity(ci);
}

export function hideCityCard(returnFocus = true) {
    resumeAutoRotate('city-card');   // 城市卡关掉：按用户偏好恢复自转
    if (!cityCard.classList.contains('visible')) return;
    cityCard.classList.remove('visible');
    cityCard.classList.remove('is-revealed');
    setOverlayHidden(cityCard, true);
    const trigger = cityCardTriggerBtn;
    cityCardTriggerBtn = null;
    activeCityIndex = -1;
    if (returnFocus && trigger) trigger.focus();
}

document.getElementById('cityCardClose').addEventListener('click', () => hideCityCard());
cityCardLocate.addEventListener('click', () => {
    if (activeCityIndex >= 0) flyToCity(activeCityIndex);
});
cityCardGallery.addEventListener('click', () => {
    if (activeCityIndex < 0) return;
    const ci = activeCityIndex;
    const trigger = cityCardTriggerBtn;
    hideCityCard(false);
    openCityView(ci, trigger);
});

// 从足迹详情卡进入“城市图片墙”：实现见 modules/city-view.js。
// 找城市、找 tab、记录关闭后要还原的足迹卡，都在那边统一处理。
const openFootprintAlbum = openCityViewAtFootprint;

markerCardGallery.addEventListener('click', () => {
    if (activeFootprintIndex < 0) return;
    const fp = deps.footprints()[activeFootprintIndex];
    if (fp) openFootprintAlbum(fp, markerCardGallery);
});

/** 详情卡是否已就绪（标题卡据此决定要不要自动收起卡片）。 */
export function areDetailCardsReady() {
    return detailCardsReady;
}

/** 回到整球视图时收起详情卡（标题卡会与卡片重叠）。 */
export function hideDetailCardsForIntro() {
    if (markerCard.classList.contains('visible')) hideMarkerCard();
    if (cityCard.classList.contains('visible')) hideCityCard(false);
}
