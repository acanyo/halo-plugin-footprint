/**
 * 省份 / 城市高亮的共享配色与强度。
 *
 * 这几个值同时被两处使用：省份卡片模块（标记明暗、悬停加亮）与主文件里的
 * 城市淡色填充（悬停卡片时把对应城市的填充加实一档）。放在各自的文件里会让另一边
 * 反向 import，所以单独抽一份。
 *
 * 颜色是唯一的强调色 --fp-accent（后台「主题色」，默认淡紫，见 shared/accent.js）。
 * Cesium 材质读不到 CSS 变量，所以这里直接取色值；alpha 都压得很低，卫星影像要能透出来。
 * 上一版的 survey / water / contour 三档主题名保留（city-fill.js 按名字取），现在都是同一个强调色。
 */

import { accentRgba } from '../../shared/accent.js';

/** 非选中省份的标记压暗到这一档。 */
export const PROVINCE_MARKER_DIM_ALPHA = 0.35;

/** 悬停卡片时，对应城市的「城市高亮」填充加实一档（比默认的 0.18 更实）。 */
export const PROVINCE_CITY_HL_FILL = accentRgba(0.34);

/** 城市淡色填充的主题；survey（「去过」）是默认档。 */
export const CITY_FILL_THEME = 'survey';

const CITY_FILL = accentRgba(0.18);
export const CITY_FILL_THEMES = {
    survey:  { fill: CITY_FILL },
    water:   { fill: CITY_FILL },
    contour: { fill: CITY_FILL },
    // city-fill.js 在主题名找不到时回落到 amber，保留这一档作兜底
    amber:   { fill: CITY_FILL }
};
