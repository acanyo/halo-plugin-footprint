/**
 * 省份 / 城市高亮的共享配色与强度。
 *
 * 这几个值同时被两处使用：省份卡片模块（标记明暗、悬停加亮）与主文件里的
 * 城市淡色填充（悬停卡片时把对应城市的填充加实一档）。放在各自的文件里会让另一边
 * 反向 import，所以单独抽一份。
 *
 * 颜色取自测绘手簿色板（见 styles/DESIGN.md，夜图一套）。Cesium 材质读不到 CSS 变量，
 * 所以这里按色值抄写；alpha 都压得很低，卫星影像要能透出来。
 *   标注红 --fp-mark    #d65a4f = rgb(214, 90, 79)
 *   水系   --fp-water   #7fa8c4 = rgb(127, 168, 196)
 *   等高线 --fp-contour #8fa070 = rgb(143, 160, 112)
 */

/** 非选中省份的标记压暗到这一档。 */
export const PROVINCE_MARKER_DIM_ALPHA = 0.35;

/** 悬停卡片时，对应城市的「城市高亮」填充加实一档（比默认的 0.14 更实）。 */
export const PROVINCE_CITY_HL_FILL = 'rgba(214, 90, 79, 0.30)';

/** 城市淡色填充的主题；survey（标注红，「去过」）是默认档。 */
export const CITY_FILL_THEME = 'survey';

export const CITY_FILL_THEMES = {
    survey:  { fill: 'rgba(214, 90, 79, 0.14)' },
    water:   { fill: 'rgba(127, 168, 196, 0.16)' },
    contour: { fill: 'rgba(143, 160, 112, 0.16)' },
    // city-fill.js 在主题名找不到时回落到 amber，保留这一档作兜底
    amber:   { fill: 'rgba(214, 90, 79, 0.14)' }
};
