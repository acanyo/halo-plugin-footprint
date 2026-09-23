/**
 * 高德底图图层（无需 Key）。
 *
 * 三个 UrlTemplateImageryProvider 在模块求值时就构造好。这比原先的位置提前了
 * 一点（ESM 的 import 先于主文件 body 执行），确认过是安全的：
 * 它们只依赖 Cesium 全局，而 Cesium 由页面的 <script> 先加载；
 * 主文件的配置段对 Cesium 有 0 处引用、0 处写操作，不存在被抢跑的全局状态。
 *
 * 注意瓦片域名的两套前缀：webrd* 是矢量路网，webst* 是卫星影像，写错了会 404。
 * 底图坐标系是 GCJ-02，标记落点必须先过 modules/coordinate.js 换算。
 */

// 高德矢量路网图（含地名标注）
export const amapVec = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18
});

// 高德卫星影像
export const amapImg = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18
});

// 高德卫星影像上的中文标注（style=8，透明标注层，叠加在影像上）
export const amapImgLabel = new Cesium.UrlTemplateImageryProvider({
    url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
    subdomains: ['1', '2', '3', '4'],
    maximumLevel: 18
});
