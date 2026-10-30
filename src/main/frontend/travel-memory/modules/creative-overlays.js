/**
 * 创意覆盖层：时间胶囊 / 足迹洞察 / 旅行明信片的共同入口。
 *
 * 三块都从城市卡片墙之上打开，卡片墙保持在下一层，关闭后回到原滚动位置。
 * 各块的渲染与状态已拆到自己的文件：
 *   - time-capsule.js   去年今天：找出「往年的今天」去过的足迹，逐张翻看；
 *   - insight-view.js   足迹洞察：统计口径来自 modules/footprints-insight.js，这里只渲染 DOM；
 *   - postcard.js       旅行明信片：把某座城市的照片 + 文案画到 canvas，导出/分享。
 * 本文件只保留卡片墙上的入口按钮、点遮罩关闭，以及卡片墙自身的几处绑定。
 *
 * 注入约定：可变的足迹数据一律用取值函数（FOOTPRINTS / cityList 会整体重建），
 * 素材与画布函数则直接传引用。
 */

import { timeCapsule, timeCapsuleItems, openTimeCapsule, closeTimeCapsule, initTimeCapsule } from './time-capsule.js';
import { insightView, openInsight, closeInsight, initInsightView } from './insight-view.js';
import { postcardPreview, closePostcard, initPostcard } from './postcard.js';

let deps = null;

/**
 * @param {object} d 宿主注入的依赖集合
 * @param d.featureEnabled                (key) => boolean
 * @param d.setCityWallProvinceFilter     (name) => void
 * @param d.closeCityWall / d.openCityWall / d.renderCityWall
 * @param d.cityWall / d.cityWallBack / d.cityWallBtn
 * @param d.cityWallInsightBtn / d.cityWallTimeCapsuleBtn / d.cityWallProvinceFilter
 */
export function setupCreativeOverlays(d) {
    deps = d;
}

// ================= 创意功能入口与覆盖层 =================
// 时间胶囊 / 足迹洞察 / 明信片预览都从城市卡片墙之上打开；
// 城市卡片墙保持在下一层，关闭新层后回到卡片墙原滚动位置（见 city-wall.js 的 focusCityWallTop）。

export function refreshCityWallFeatureActions() {
    if (deps.cityWallTimeCapsuleBtn()) {
        deps.cityWallTimeCapsuleBtn().hidden =
            !deps.featureEnabled('enableTimeCapsule') || timeCapsuleItems().length === 0;
    }
    if (deps.cityWallInsightBtn()) {
        deps.cityWallInsightBtn().hidden = !deps.featureEnabled('enableInsight');
    }
}

/**
 * 绑定三块覆盖层的全部交互。必须在 setupCreativeOverlays（以及三块各自的 setup）之后调用一次。
 */
export function initCreativeOverlays() {
    if (deps.cityWallTimeCapsuleBtn()) deps.cityWallTimeCapsuleBtn().addEventListener('click', openTimeCapsule);
    if (deps.cityWallInsightBtn()) deps.cityWallInsightBtn().addEventListener('click', openInsight);
    // 三块各自的按钮：顺序与拆分前一致（去年今天 → 足迹洞察 → 明信片）
    initTimeCapsule();
    initInsightView();
    initPostcard();
    [timeCapsule, insightView, postcardPreview].forEach(overlay => {
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                if (overlay === timeCapsule) closeTimeCapsule();
                else if (overlay === insightView) closeInsight();
                else closePostcard();
            }
        });
    });

    deps.cityWallBtn().addEventListener('click', deps.openCityWall);
    deps.cityWallBack().addEventListener('click', () => deps.closeCityWall());
    if (deps.cityWallProvinceFilter()) {
        deps.cityWallProvinceFilter().addEventListener('click', () => deps.setCityWallProvinceFilter(''));
    }
    // 数据重新加载（如刷新直达）后，若卡片墙正处于打开状态则重建
    document.addEventListener('footprints:loaded', () => {
        if (deps.cityWall() && deps.cityWall().classList.contains('show')) deps.renderCityWall();
    });

}
