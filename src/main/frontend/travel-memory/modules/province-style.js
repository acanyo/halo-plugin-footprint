/**
 * 省份 / 城市高亮的共享配色与强度。
 *
 * 这几个值同时被两处使用：省份卡片模块（标记明暗、悬停加亮）与主文件里的
 * 城市淡色填充（把某个城市的高亮面换成青蓝）。放在各自的文件里会让另一边
 * 反向 import，所以单独抽一份。
 */

/** 非选中省份的标记压暗到这一档。 */
export const PROVINCE_MARKER_DIM_ALPHA = 0.35;

/** 悬停卡片时，对应城市的「城市高亮」填充加亮一档（比默认的 rgba(255,149,66,.22) 更实）。 */
export const PROVINCE_CITY_HL_FILL = 'rgba(255, 196, 120, 0.42)';

/** 城市淡色填充的主题；amber 是默认档。 */
export const CITY_FILL_THEME = 'amber';

export const CITY_FILL_THEMES = {
    amber: { fill: 'rgba(255, 149, 66, 0.22)' },
    gold:  { fill: 'rgba(240, 198, 120, 0.25)' },
    mint:  { fill: 'rgba(88, 204, 180, 0.20)' },
    ice:   { fill: 'rgba(110, 160, 255, 0.18)' }
};
