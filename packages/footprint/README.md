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

## 全量迁移：Shadow DOM 是逐组件的选择，不是一刀切

目标是前台**全部**改成 Svelte，包括地图层。这能成立的前提是：
「用 Svelte 写」和「开 Shadow DOM」是两件独立的事。

Svelte 5 的 `customElement` 支持 `shadow: 'none'`，因此地图层照样是 Svelte 组件，
只是不开影子根、留在 light DOM——Cesium 自带 `static/cesium/Widgets/` 下 2000+ 行
样式且假定自己在全局作用域，canvas 的事件、全屏、右键菜单也都按 light DOM 设计，
开了影子根就要逐个打补丁。

```svelte
<!-- 地图层：Svelte 组件，但不开影子根 -->
<svelte:options customElement={{ tag: 'footprint-globe', shadow: 'none' }} />

<!-- UI 面板：默认 shadow: 'open'，拿到样式硬边界 -->
<svelte:options customElement={{ tag: 'footprint-lightbox' }} />
```

| 组件 | shadow | 迁自 |
| --- | --- | --- |
| `<footprint-globe>` | `none` | Viewer 初始化 / 相机 / 自动旋转 / 底图 / 地形 |
| `<footprint-markers>` | `none` | 足迹标记点 / 标记自愈 / 城市聚合 |
| `<footprint-labels>` | `none` | 常驻地名标注 / 屏幕空间避让 |
| `<footprint-amap>` | `none` | 2D 高德地图（footprint.js） |
| `<footprint-ticket-wall>` | `open` | 票根墙 / 横向长串 / 命运抽票 |
| `<footprint-postcard>` | `open` | 未寄出的明信片 |
| `<footprint-city-wall>` | `open` | 城市卡片墙 / 卡片封面 / 悬停轮播 |
| `<footprint-photo-ring>` | `open` | 照片环 |
| `<footprint-province-cards>` | `open` | 省份城市卡片 |
| `<footprint-journey-replay>` | `open` | 重走一遍 |
| `<footprint-lightbox>` | `open` | 图片灯箱 |
| `<footprint-detail-card>` | `open` | 足迹详情卡 |
| `<footprint-title-card>` | `open` | 左侧标题卡 |
| `<footprint-view-switch>` | `open` | 2D/3D 切换按钮 |

纯函数（坐标转换 WGS84↔GCJ-02、图片 URL 规则、日期格式化）抽到 `utils/`，
不做成组件。

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

按依赖方向推进：先落地基础设施与纯函数，再是地图层（其余组件都要向它派发事件），
最后是 UI 面板。

1. `utils/` — 坐标转换、图片 URL 规则、日期、存储封装
2. `stores/` — 足迹数据、当前选中、2D/3D 视图模式（Svelte 5 runes）
3. `<footprint-globe>` / `<footprint-markers>` / `<footprint-labels>` — 3D 地图层
4. `<footprint-amap>` — 2D 地图层
5. UI 面板，按与地图耦合度从浅到深：
   `lightbox` → `postcard` → `city-wall` → `photo-ring` → `province-cards`
   → `detail-card` / `title-card` / `view-switch` → `ticket-wall` → `journey-replay`

**注意**：票根子系统（票根墙 + 命运抽票 + 明信片 + 重走一遍 + 横向长串）在旧代码里
横跨 7187→9357 约 2200 行，共享 40 多个模块级可变状态，是耦合最深的一块，放最后。
按分节标题看它只有 437 行，那只是声明段（90 个 getElementById），别被误导。

每迁完一个模块，原 `travel-memory.js` 的对应段落**直接删除**，不留两份实现。
旧代码里「照片环」和「省份城市卡片」各有两处实现（分散在相隔 6000 行的位置），
迁移时必须合并成一处——这本身就是收益。

## 如何保证「一模一样」

纯逻辑一律用**黄金值等价测试**锁住：先用 Node 跑迁移前的 `travel-memory.js`
对应片段，把输出记成常量，再断言新实现产出同样的值。

```bash
node -e "
const f=require('fs').readFileSync('../../src/main/resources/static/js/travel-memory.js','utf8');
eval(f.split('\n').slice(81,135).join('\n').replace(/^\s{4}/gm,''));
console.log(wgs84ToGcj02(120.15, 30.28));
"
```

见 `src/utils/coordinate.test.ts`。这类代码出偏差不会报错——坐标转换错了只是
所有标记整体平移几百米，肉眼很难发现，只能靠数值断言。

写断言时不要凭直觉设定范围：GCJ-02 的纬度偏移方向随地点变化（杭州为负、
北京为正），一开始按「总是正偏移」写就直接挂了。**以原实现的实际输出为准，
不要以对算法的想象为准。**

视觉部分没有等价测试可言，只能逐个接进页面人工比对，因此迁移按模块推进、
每个模块单独验收。

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
