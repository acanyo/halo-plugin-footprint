# @xhhao/footprint

足迹插件**前台页面**的 Svelte 组件包。产物是一组标准 Custom Element，
由 `src/main/resources/templates/footprint.html` 以普通 `<script>` 加载。

> 控制台（`ui/`）不在本包范围内，也不可能迁过来：Halo 的插件扩展契约把 Vue 写死了
> （`PluginModule.components` 要求 Vue 组件、`routes` 是 vue-router 的 `RouteRecordRaw`、
> `@halo-dev/ui-shared` 的 peerDependencies 是 `vue: ^3.5.x`）。

## 为什么是 Custom Element

前台原本是 `static/js/travel-memory.js`（10903 行）+ `footprint.js`（3326 行）
加 12743 行全局 CSS，类名是 `.city-*` `.ticket-*` `.photo-*` 这类通用名词，
987 个符号全部暴露在全局作用域，52 处 `!important` 就是内部互相打架留下的伤疤。

Custom Element + Shadow DOM 给出样式与作用域的硬边界，且每个模块可独立复用。
主题定制通过 CSS 变量穿透边界（见 `src/var.css`），沿用 comment-next 的做法。

## 边界：哪些迁，哪些不迁

迁移**只覆盖 UI 面板**，地图层保持原样。这不是偷懒，是硬约束：

| 不迁（约 3500 行） | 原因 |
| --- | --- |
| Cesium Viewer 初始化、相机交互、自动旋转 | 命令式 SDK，声明式模型使不上劲 |
| 足迹标记点、常驻地名标注层、标记自愈 | 与渲染引擎搏斗的逻辑，与框架无关 |
| 地名标签屏幕空间避让、城市聚合 | 同上 |
| 底图切换、天地图三维地形、中国轮廓 | 同上 |
| 坐标转换 WGS84↔GCJ-02 | 纯函数，抽成 `utils/` 即可 |

Cesium 自带 `static/cesium/Widgets/` 下 2000+ 行样式且假定自己在全局作用域，
地图 canvas 的事件、全屏、右键菜单也都按 light DOM 设计——
**把地图塞进 Shadow DOM 会引出一串要逐个打补丁的问题。**

| 迁（约 6500 行） | 目标元素 |
| --- | --- |
| 票根墙 / 横向长串 / 命运抽票 | `<footprint-ticket-wall>` |
| 未寄出的明信片 | `<footprint-postcard>` |
| 城市卡片墙 / 卡片封面 / PC 悬停轮播 | `<footprint-city-wall>` |
| 照片环 | `<footprint-photo-ring>` |
| 省份城市卡片 | `<footprint-province-cards>` |
| 重走一遍 | `<footprint-journey-replay>` |
| 图片灯箱 | `<footprint-lightbox>` |
| 足迹详情卡 | `<footprint-detail-card>` |
| 左侧标题卡 | `<footprint-title-card>` |
| 2D/3D 切换按钮 | `<footprint-view-switch>` |

## 两侧怎么通信

地图层（命令式，light DOM）与组件层（声明式，Shadow DOM）**只通过 DOM 事件往来**，
不共享可变全局状态。这是整件事最关键的设计约束：

- **地图 → 组件**：设置元素 attribute/property，或派发事件到元素上
- **组件 → 地图**：`dispatchEvent` 一个 `CustomEvent`，地图层监听

```js
// 地图层：点中标记，让照片环展开
document.querySelector('footprint-photo-ring').open(footprintId, screenXY);

// 组件层：用户在票根墙点了某张票，请求相机飞过去
this.dispatchEvent(new CustomEvent('footprint:flyto', {
  bubbles: true, composed: true,   // composed 必须为 true，否则事件出不了 Shadow DOM
  detail: { longitude, latitude },
}));
```

`composed: true` 容易漏，漏了事件会被 Shadow 边界吃掉，且不会有任何报错。

## 迁移顺序

按「与地图耦合度」从浅到深，每完成一个就接进 `footprint.html` 验证，不攒大批量：

1. `<footprint-ticket-wall>` — 只依赖足迹数据，耦合最浅，用来验证整条链路
2. `<footprint-postcard>` — 纯生成与下载
3. `<footprint-lightbox>` — 纯展示
4. `<footprint-city-wall>` — 数据量大但交互独立
5. `<footprint-photo-ring>` — 需要标记的屏幕坐标，开始与地图耦合
6. `<footprint-province-cards>` — 同上，且涉及抛物线连线
7. `<footprint-detail-card>` / `<footprint-title-card>` / `<footprint-view-switch>`
8. `<footprint-journey-replay>` — 与相机动画深度耦合，放最后

迁移过程中原 `travel-memory.js` 的对应段落**直接删除**，不留两份实现。
旧代码里「照片环」和「省份城市卡片」各有两处实现（分散在相隔 6000 行的位置），
迁移时必须合并成一处——这本身就是收益。

## 开发

```bash
pnpm install
pnpm dev      # demo 页，/apis 已代理到 localhost:8090
pnpm build    # 产物写入 ../../src/main/resources/static/next/
pnpm check    # svelte-check + tsc
pnpm test     # vitest
```

`pnpm build` 通过 `vite-plugin-static-copy` 把 `footprint.iife.js` 与 `footprint.css`
直接投递到插件静态资源目录，`footprint.html` 引用 `/plugins/footprint/assets/static/next/`。
