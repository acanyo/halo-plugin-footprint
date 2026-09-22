# 3D 地球 · 省份城市卡片与连线（实现方案）

> 状态：**待实现**。本文件只描述方案，尚未改动任何代码。
> 范围：`/footprints` 3D 地球页（`travel-memory.js` / `travel-memory.css` / `footprint.html`）。
> 日期：2026-09-17

## 1. 目标

在 3D 地球上点击某个省份后，如果该省有足迹城市数据，就为**每一个有足迹的城市**各生成一张小型城市卡片，
并从该城市的聚合标记拉出一条抛物线连到对应卡片。卡片可拖拽，点击卡片直接进入该城市的相册
（现有全屏城市视图）。整个过程中**相机完全不动**。

## 2. 已确认的设计决策

| # | 项目 | 结论 |
| --- | --- | --- |
| 1 | 触发层级 | 仅当中国轮廓已显示（相机高度 < 9500 km）**且**处于城市聚合态（> 1500 km）时可点 |
| 2 | 相机 | 点击后完全不动，不调用 `flyToCity` |
| 3 | 无足迹省份 | 不处理：不开卡、不关闭已打开的卡片、不做提示 |
| 4 | 高亮时机 | 点击后才高亮；不做 hover 视觉高亮（hover 只把光标变成手型） |
| 5 | 卡片数量 | 每个有足迹的城市一张卡片，一条线，一对一 |
| 6 | 卡片形态 | 仿 `cityCard` 的缩小**横版**（左图右文）：封面图 + 城市名 + 足迹数 + 照片数 + 最近到访时间，**无任何按钮** |
| 7 | 卡片点击 | 整卡点击 → `openCityView(ci)`（现有全屏城市视图 / 相册） |
| 8 | 卡片拖拽 | 支持拖拽；拖拽后不复位；再次点击该省份时重新排版 |
| 9 | 卡片方位 | 就近边优先：贴哪条边就放哪条边（上下左右都可以），沿边逐步外扩并互相避让 |
| 10 | 溢出处理 | 本边被占满就换次近的边；四条边都排满才做网格兜底，最后才允许重叠 |
| 11 | 连线 | 抛物线（二次贝塞尔），青蓝渐变配色 |
| 12 | 省名标签 | 需要，贴在省份轮廓中心的屏幕位置上方，随地球转动移动 |
| 13 | 标记转到背面 | 该城市对应的线与卡片一起淡出，转回正面再淡入，卡片位置保留 |
| 14 | 关闭粒度 | 只能整组收：点空白 / Esc / 再点同一省 / 切 2D / 打开城市墙或票根册 |
| 15 | 相册往返 | 从相册返回地球后恢复原卡片组（相机未动，可直接重建） |
| 16 | 生效范围 | 仅桌面端（视口宽度 > 820px），窄屏不生效 |
| 17 | 全部城市 | 导航栏加「全部城市」入口：一键把所有去过的城市都展开成卡片 + 连线（复用省份那套布局与连线） |

### 默认处理（未单独确认，可按需调整）

- 打开卡片组时暂停自动旋转（与现有卡片行为一致），关闭后按用户偏好恢复。
- 再点同一个省 = 收起；点另一个省 = 换一组。
- 相机离开城市聚合态（拖近到 1500 km 以下、城市标记已展开为足迹点）时自动收起卡片组。
- 进入相册时整组淡出清线，返回时重建并播入场动画。
- 拖拽限制在视口内留 8px 边距，不限制左右。
- 卡片的图片取该城市第一张照片；没有照片时用城市名首字占位（与现有逻辑一致）。

## 3. 交互流程

```
LEFT_CLICK（3D / 桌面端）
  ├─ 命中足迹标记        → 现有足迹卡（不变）
  ├─ 命中城市聚合标记    → 现有城市卡（不变）
  ├─ 门控通过 + 命中省份 → showProvinceCards(adcode)
  │      ├─ 该省有城市 → 高亮省份 + 每城一张卡 + 每城一条抛物线
  │      └─ 该省无城市 → 什么都不做（不关卡、不提示）
  └─ 其它                → 关闭卡片（现有逻辑）
```

门控条件（三者同时满足才继续判定省份）：

1. `viewer.scene.mode === Cesium.SceneMode.SCENE3D`；
2. `boundaryVisible === true`（相机 < 9500 km，中国轮廓已显示）；
3. `!cityMode` 为假，即当前处于城市聚合态（相机 > 1500 km）。

外加 `window.innerWidth > 820`（窄屏不生效）。

状态机只有两个状态：`idle` 与 `provinceOpen`（同一时刻只可能有一组省份卡片）。

## 4. 代码前提（本次已核对的事实）

### 4.1 省份面现在**不可拾取**

`china-full.json` 以 `fill: Cesium.Color.PALETURQUOISE.withAlpha(0)` 载入
（[travel-memory.js:7984](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:7984)），
而 Cesium 的拾取片元着色器是：

```glsl
czm_old_main();
if (out_FragColor.a == 0.0) { discard; }
out_FragColor = czm_pickColor;
```

**alpha 为 0 的片元在拾取通道被直接丢弃**，所以 `scene.pick()` 在省面内部返回 `undefined`。
今天点击省内部只会走"点空白 → 关卡片"这条现有分支；只有正好点在省界描边（1px 白色折线，alpha 为 1）上才会命中实体。

结论：**省份拾取不能依赖 `scene.pick` 的面**，主判定必须换成几何判定（§5.1）。

### 4.2 一个省对应多个 Entity

`GeoJsonDataSource` 处理 `MultiPolygon` 时对每个子多边形各建一个 Entity（它们共享同一份 `properties`）。
实测数据分布：

| 指标 | 数值 |
| --- | --- |
| `china-full.json` 的 feature 数 | 35 |
| 子多边形总数 | 339 |
| 浙江省 | 44 |
| 台湾省 / 辽宁省 / 上海市 | 14 / 11 / 7 |
| 澳门 / 天津 | 2 |

所以"实体数量 = 省份数量"的假设不成立，高亮必须按 adcode 归组（§5.3）。

### 4.3 可以直接复用的现有能力

| 能力 | 位置 |
| --- | --- |
| 城市聚合列表与标记 | `cityList` / `cityMarkerEntities`，`applyMarkerMode()`（[1764](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1764)） |
| 城市中心坐标 | `cityCenter(city)`（[1162](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1162)） |
| 城市聚合键 | `cityKeyOf(fp)`（[1717](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1717)） |
| 城市足迹 / 照片列表 | `cityViewItems(ci)` / `cityPhotoItems(ci)`（[2039](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:2039) 附近） |
| 世界坐标 → 屏幕坐标（含背面剔除） | `markerScreenPosition()`（[1974](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1974)） |
| 卡片布局盒测量 | `cardLayoutRect()`（[1960](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1960)） |
| 单实体聚焦（其它标记压暗） | `setMarkerFocus()`（[2371](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:2371)） |
| 标注式引导线样式参考 | `#markerTip` 的 dot + line（CSS 500 行附近） |
| 进入城市相册 | `openCityView(ci)`（[3467](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:3467)） |
| 暂停自动旋转 | `pauseAutoRotate('city-card')` / `resumeAutoRotate(...)` |

`openCityView()` **不移动相机**，只是叠加全屏层并暂停地球渲染循环，因此"返回后恢复卡片组"可以原样重建，没有状态冲突。

## 5. 数据与拾取

### 5.1 拾取：三级判定

保留 `scene.pick` 作为第一级（标记、省界描边都能直接命中实体，成本最低），
第二级才用几何判定补齐"省面内部"这个大头。

```js
function pickProvinceAtScreen(windowPos) {
  // 1) 标记优先：命中足迹/城市标记时直接交给现有分支
  // 2) scene.pick 返回省界描边实体（属性里带 adcode）时直接取用
  // 3) 几何判定：屏幕坐标 → 椭球交点 → 经纬度 → 点在多边形内
  const cart = viewer.camera.pickEllipsoid(windowPos, viewer.scene.globe.ellipsoid);
  if (!cart) return null;
  const c = Cesium.Cartographic.fromCartesian(cart);
  return pointInProvince(Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude));
}
```

几何判定细节：

- 载入本地 `china-full.json`（同一份数据，直接 `fetch`），建 `provinceIndex: Map<adcode, {name, bbox, polygons}>`；
- 先用每个 feature 的 bbox 预筛（35 个矩形比较，成本可忽略），再对命中的 feature 做环测试；
- 环测试要支持 `Polygon` 与 `MultiPolygon`，内环（洞）视为外部；
- 命中后返回 `{ adcode, name }`。

坐标系说明：省界数据是 GCJ-02，`pickEllipsoid` 给的是 WGS84 坐标，两者在高德底图下相差约 500 m
（天地图底图下省界本身就有同样量级的偏移）。省级尺度下不影响可用性，设计上接受该误差。

代价：单次判定只做 35 次 bbox 比较 + 至多 1 次环测试，点击与 hover 每次都在毫秒级以下。

### 5.2 省份 → 城市

```js
function provinceCities(adcode) {
  return cityList
    .map((city, ci) => ({ ci, provinceAdcode: FOOTPRINTS[city.indices[0]]?.provinceAdcode || '' }))
    .filter(item => item.provinceAdcode === adcode)
    .map(item => item.ci);
}
```

- 优先用 `provinceAdcode` 精确匹配（`test/test.json` 的 21 条数据全部有值，且与 `china-full.json` 的 adcode 同源）；
- 老数据缺少 adcode 时，退回按 `province` 名称匹配，匹配前统一去掉"省 / 市 / 自治区 / 特别行政区"等后缀做一次归一化；
- 结果为空 → 按 §2 第 3 条，什么都不做；
- 足迹数据重载（`footprints:loaded`）时重建索引，并收起已打开的卡片组。

### 5.3 高亮

加载 `china-full.json` 后遍历 `chinaBoundarySource.entities.values`，按 adcode 归组：
`Map<adcode, Entity[]>`，同时把每个实体的原始 `polygon.material` / `polyline.material` / `polyline.width` 记下来。

选中时对该 adcode 的所有实体赋值：

| 属性 | 选中值 | 还原值 |
| --- | --- | --- |
| `polygon.material` | 青蓝 `rgba(127,231,255,0.10)` | 载入时的原始材质引用 |
| `polyline.material` | 青蓝 `#7FE7FF`（alpha 0.9） | 原始白色材质 |
| `polyline.width` | `1.4` | `0.5` |

说明：`GeoJsonDataSource` 下所有实体最初共享同一个材质实例，因此**必须给单个实体赋新值**，不能改共享实例，
否则一改就是全部省份一起高亮。取消选中时按记录的原值还原。

同时把其它城市的标记压暗（`billboard.color` 设为 `WHITE.withAlpha(0.35)`），该省的城市标记保持全亮并轻微放大——
沿用 `setMarkerFocus()` 已有的视觉语言，但作用对象是一组城市而不是单个。

## 6. 卡片规格

### 6.1 结构与尺寸

复用 `cityCard` 的玻璃容器 token 与横版骨架（左图右文），新建独立类名 `prop-city-card`：

| 项 | 默认档 | 紧凑档 |
| --- | --- | --- |
| 宽度 | 244px | 214px |
| 版面 | `grid-template-columns: 40% minmax(0, 1fr)`：封面在左，信息在右 | 同左 |
| 封面 | 占左侧 40% 宽，高度随卡片拉伸并裁切 | 同左 |
| 总高 | 约 96px（由信息区内容决定） | 约 86px |
| 圆角 | 12px | 12px |
| 间距（同侧） | 12px | 6px |

信息区自上而下居中排布：城市名（行楷，21px）→ `N 足迹 · M 照片`（11px）→ 最近到访时间（11px）；
紧凑档封面高度降到 86px，方便城市很多时排得下。
**没有任何按钮**，整张卡是点击目标。

### 6.2 交互

- `pointerdown` → `setPointerCapture` → `pointermove` 改 `left/top`；位移 < 4px 判定为点击；
- 点击 → `openCityView(ci)`；
- 拖拽中的卡片标记为"已锁定"，本次会话内不再被自动布局移动；
- 拖拽时线条实时跟随（卡片锚点按当前 `getBoundingClientRect` 取）；
- 拖拽不改变其它卡片的位置。

## 7. 布局与避让算法

### 7.1 可用区

```
avail = {
  top:    88,                    // 顶部导航 64 + 24 留白
  bottom: innerHeight - 96,      // 底部留白
  left:   sideInset,             // max(76, 7vw)：不贴屏幕边缘，宽屏再多让一点
  right:  innerWidth - sideInset
}
```

卡片列只在 `sideInset` 内侧起排（拖拽是用户主动行为，仍按 8px 夹紧，不强制这个留白）。

同时把右下角浮动按钮（`#backGlobeBtn` / `#cityFillFloatBtn`）作为避让矩形；
打开卡片组时给 `body` 加 `card-open` 类，让这两个按钮隐藏（与现有卡片行为一致）。

### 7.2 就近边优先（上下左右都能放）

取所有城市标记的屏幕坐标，对每张卡片算出它到自己四条安全边界的「相对距离」
（用各边的可用跨度归一化，这样上下和左右才可比）：

```
left   = (marker.x - area.left)  / spanX
right  = (area.right - marker.x) / spanX
top    = (marker.y - area.top)   / spanY + 0.05     // 平手时让左右先赢
bottom = (area.bottom - marker.y)/ spanY + 0.10
```

按这个分数升序得到「就近边 → 次近边 → …」的顺序：贴左边的去左边、贴上边的去上边，
居中的标记因为左右有偏置仍然优先左右（保持原来的观感）。

### 7.3 沿边外扩 + 互相避让

对每条候选边，从「与自己的标记对齐」开始，沿这条边向两侧按 `卡片尺寸 + 间距` 逐步外扩
（最多 12 步），第一个不被占用的位置就落子。评分：

```
cost = |步数| × 70 + 边优先级 × 30
     + (与该边中心反向的步数 ? 8 : 0)          // 优先往屏幕中心那侧铺，避免甩到角落
     + 900 × (与标记群包围盒的重叠面积 / 卡片面积)   // 尽量别压住标记
```

同一条边上按顺序取 `[0, 18, 36, 54]` 的阶梯缩进（四档循环），所以队列不是一条笔直线，
而是有进有出的斜向分布 —— 这就是"散开"的来源。

### 7.4 溢出兜底

1. 四条边都排满 → 在安全区内做粗网格扫描（步长约半张卡片），挑一个不压别的卡片、离自己标记最近的位置；
2. 真的没地方了 → 落回首选边、允许压住别的卡片（保证卡片不丢）。

排布顺序上，最贴边的标记先排（它可选方向最少），拖拽过的卡片位置固定、先占位当障碍。

### 7.5 重排时机

- 打开卡片组时；
- 再次点击同一省份时（用户确认的重排入口）；
- 窗口 resize 时（重算可用区、分侧与堆叠）；
- **不**在拖拽后自动重排。

## 8. 连线规格

### 8.1 几何

- 起点：城市标记圆点的**中心**，端点画 3px 实心圆点；
- 终点：卡片中心朝自己的标记方向与卡片边框的交点（无论卡片在上下左右哪条边，线都钉在朝向标记的那一侧；
  卡片落在拐角附近时自然落在角上）；
- 形状：二次贝塞尔，控制点 = 弦中点沿"垂直于弦"的方向偏移 `0.30 × 弦长`，方向统一朝屏幕外侧（远离视口中心）；
- 同一条边上的多条线按顺序把偏移系数从 `0.22` 递增到 `0.38`，形成扇面；
- 端点可加 4px 短横，强调"钉在卡片上"的落点感。

### 8.2 颜色（青蓝）

| 元素 | 值 |
| --- | --- |
| 线渐变（标记端） | `#8FE9FF`，alpha 0.95 |
| 线渐变（卡片端） | `rgba(143,233,255,0.28)` |
| 线宽 | 1.2px，圆头 |
| 外发光 | `drop-shadow(0 0 6px rgba(72,196,255,0.45))` |
| 起点圆点 | `#BFF3FF`，alpha 0.95 |
| hover / 选中加亮 | 整条线 alpha 提到 1，线宽 1.6px |

### 8.3 绘制与动画

- 用 `#view-3d` 内的 `<svg id="leaderOverlay">`（`position:absolute; inset:0; pointer-events:none; z-index:1`）承载；
  `#view-3d` 自身 `position:relative; z-index:2`，卡片（`z-index:9997`）在其之上，线自然压在卡片下面；
- 每条线一个 `<path>` + `<circle>`，颜色走 `<linearGradient>`；
- "拉出来"的生长动画：`stroke-dasharray = pathLength`，`stroke-dashoffset` 从 1 → 0，0.55s，
  多张卡片依次延迟 60ms；`prefers-reduced-motion` 下取消动画。

### 8.4 更新与节流

- 挂在现有 `viewer.scene.postRender` 链上（与 `updateMarkerTipPosition` 同级）；
- 只在"有活动卡片组 且（相机移动 或 卡片被拖动 或 resize）"时更新，复用 `updateMarkerOcclusion()` 已有的相机变化判定；
- 卡片锚点矩形做缓存，用 `ResizeObserver` 在卡片尺寸变化时刷新，避免每帧 `getBoundingClientRect` 触发强制布局；
- 城市标记转到地球背面时，对应卡片与线条一起淡出（`opacity → 0`、`pointer-events:none`），转回正面淡入，卡片位置不变。

### 8.5 悬停强调（卡片 ↔ 连线 ↔ 标记 串成一条链）

悬停（或键盘聚焦）某张卡片时，靠**对比**把这条链挑出来，而不是只加粗几个像素：

| 元素 | 悬停态 | 其余 |
| --- | --- | --- |
| 连线 | 2px、透明度 1、`brightness(1.45)` 提亮核心色、更强的青蓝光晕 | 1px、透明度 0.32 |
| 线头 | `stroke-dasharray: 12 6` + 1.1s 循环流动（线头从标记流向卡片） | 静态实线 |
| 起点圆点 | r 3 → 4.5，1.6s 呼吸脉冲 | r=3 |
| 城市标记 | 放大 1.16、全亮（复用 `setMarkerFocus()` 的既有语言） | 维持省份选中态的压暗 |

实现要点：`#leaderOverlay` 上加一个 `has-focus` 类统管"其余线压暗"，
`is-hidden` 规则必须排在 `has-focus` 之后（同权重靠后生效），否则转到背面的线会被 hover 状态点亮；
`pointerleave` / `blur` 只在"既没有键盘焦点也不在 hover"时才熄灭高亮；
收起卡片组时会先归还被卡片悬停提亮的那个标记（否则它会一直停在放大态）；
`prefers-reduced-motion` 下关闭流动与脉冲。

## 9. 省名标签

- 内容：`河南省 · 3 座城市`（省名取 `provinceIndex` 的 name，城市数取 `provinceCities().length`）；
- 位置：省份轮廓中心的屏幕坐标再上移 18px（用预先算好的 feature bbox 中心）；
- 样式：13px、字距 0.14em、`rgba(255,255,255,0.92)`，沿用 `#markerTip` 的文字阴影族；无边框、无背景；
- 同样随地球转动每帧更新，省名中心转到背面时淡出；`pointer-events:none`。

## 10. 相册往返

- 点击卡片 → 收起整个卡片组（淡出并清线）→ `openCityView(ci)`；
- 相册返回（`closeCityView`）时，如果进入前存在卡片组，则重建该组卡片与连线并播入场动画；
- 因为 `openCityView()` 不动相机，重建时城市标记仍在原位，不需要额外保存相机状态；
- 若用户在相册中通过"重走 / 定位"改变了相机（如 `flyToCityFootprint`），返回时按当前相机重新布局；
  若此时已不在城市聚合态，则按默认规则不收不建，直接保持关闭。

## 11. 代码改动清单

### 11.1 `src/main/resources/templates/footprint.html`

在 `#view-3d` 内、`#cesiumContainer` 之后插入三个容器（约 130 行附近）：

```html
<svg id="leaderOverlay" aria-hidden="true"></svg>
<div id="provinceLabel" aria-hidden="true"></div>
<div id="provinceCardLayer"></div>
```

顶部导航主操作组里新增「全部城市」入口（`票根册` 之后，随导航一起在 2D 下隐藏）：

```html
<button id="provinceAllBtn" type="button" aria-pressed="false"
        title="在 3D 地球上展开所有去过的城市卡片与连线">全部城市</button>
```

**资源版本号不再写死在模板里**：`travel-memory.css` / `district-pinyin.js` / `travel-memory.js`
三个资源的 `<link>` / `<script>` 已移到 `FootprintHeadProcessor`，用插件版本号加载
（`?version=${version}`，取自 `pluginWrapper.getDescriptor().getVersion()`，即 `gradle.properties` 的 `version`），
模板里只留一行说明注释（见 §11.5）。

### 11.5 `FootprintHeadProcessor` / `FootprintRouter`

| 文件 | 改动 |
| --- | --- |
| `FootprintHeadProcessor` | 原有资源（footprint.css / result.css / footprint.js）与新增的三个资源**统一改为只在足迹页注入**，版本号统一取插件版本 |
| `FootprintRouter` | 渲染足迹页时向 model 写入 `ModelConst.TEMPLATE_ID = "plugin:footprint:footprints"`，供 Head 处理器识别页面 |

两个关键点：

1. **按页面注入**：`TemplateHeadProcessor` 是全局的。`travel-memory.js` 直接依赖 Cesium 与页面 DOM，
   注入到其它页面会抛错；`footprint.css` / `result.css`（"快看世界体"字体，53KB 的 @font-face 分片）/
   `footprint.js` 也只服务于足迹页。所以处理器先判断 `context.getVariable(ModelConst.TEMPLATE_ID)`
   是否等于足迹页标识（Halo 约定的 `_templateId`），不匹配时**一个字节都不输出**。
2. **必须 `defer`**：Head 处理器只能往 `<head>` 里写，而这两个脚本原先挂在 `</body>` 前、依赖 DOM 已就绪，
   所以注入时加 `defer`（在解析完成后、`DOMContentLoaded` 之前按文档顺序执行）。

### 11.2 `src/main/resources/static/css/travel-memory.css`

新增一节（建议放在 cityCard 之后）：

- `#leaderOverlay` / `#provinceLabel` / `#provinceCardLayer` 的定位与层级；
- `.prop-city-card` 及内部元素（媒体、标题、统计、时间）的默认档与紧凑档；
- `.prop-city-card.is-stacked`、`.is-hidden`（背面淡出）等状态；
- `@media (max-width: 820px)` 内整体禁用（`display:none`）。

### 11.3 `src/main/resources/static/js/travel-memory.js`

修改点：

| 位置 | 改动 |
| --- | --- |
| [`updateIntroVisibility()` 470 行附近](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:468) | 回到整球视图时同时收起省份卡片组（挂在现有 `detailCardsReady` 分支里） |
| [`closeGlobeOverlays()`](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:653) | 切 2D 之前收起卡片组并清线 |
| [`applyMarkerMode()`](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:1764) | 离开城市聚合态（展开足迹点）时按默认规则收起卡片组 |
| [`MOUSE_MOVE` 处理器](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:2683) | 未悬停到标记时，用几何判定决定 `cursor:pointer` |
| [`LEFT_CLICK` 处理器](D:/A1MY/TheServer/halo/chajian/halo-plugin-footprint-master/src/main/resources/static/js/travel-memory.js:2711) | 在"点空白 → 关卡"之前插入省份分支，保持标记优先 |
| 现有 `chinaDataSource` 加载块（7984 行附近） | 加载完成后建 `Map<adcode, Entity[]>` 与原始材质快照 |
| `footprints:loaded` 监听 | 重建省份→城市索引，必要时收起卡片组 |

新增函数（建议集中成"省份城市卡片"一节，便于后续抽成通用能力）：

```js
buildProvinceIndex(geojson)          // Map<adcode, {name, bbox, polygons}>
pointInRing(lng, lat, ring)
pointInProvince(lng, lat)            // bbox 预筛 + 环测试（含内环与 MultiPolygon）
provinceAtScreenPoint(windowPos)     // 省界描边 pick + 几何判定两级
provinceHoverAt(windowPos)           // 光标手型（节流 100ms）
applyProvinceHighlight(adcode | null)  // 材质改写 + 标记明暗
provinceCitiesOf(adcode, name)
activateCityCards(config)            // 通用入口：一组城市 → 卡片 + 连线
activateProvinceCards(adcode)        // 省份点击（config 里带高亮与省名标注）
activateAllCityCards()               // 导航栏「全部城市」
layoutProvinceCards()                // 分侧 / 错位 / 堆叠
updateProvinceLeaderLines()          // postRender 调用
attachProvinceCardDrag(item)
cityMarkerScreenPosition(ci)         // markerScreenPosition 的城市版
syncProvinceAllBtn() / syncProvinceAllAvailability()
```

> `activateCityCards(config)` 是通用入口：省份点击传该省的城市下标并带 `adcode`（触发省份高亮与省名标注），
> 导航栏「全部城市」传整份 `cityList` 下标、`adcode` 为空（不高亮任何省份，标注写"全部城市 · N 座"）。

### 11.4 收尾

按仓库 AGENTS.md：改动静态资源后必须执行

```powershell
.\gradlew.bat reloadPlugin
```

成功标志是输出 `插件 足迹插件（footprint）已就绪!`，并确认
`http://localhost:8090/plugins/footprint/assets/static/js/travel-memory.js` 已是新版本。

## 12. 边界与异常清单

| 场景 | 处理 |
| --- | --- |
| 整球视图（> 9500 km） | 不响应省份点击 |
| 贴地视图（< 1500 km，城市标记已展开） | 不响应；若此时卡片组已打开则收起 |
| 无足迹的省 | 什么都不做，不关卡、不提示 |
| 省界附近（±500 m 坐标误差） | 接受；点击靠边界时可能落到邻省，属可接受误差 |
| 岛屿型省份（浙 / 粤 / 台 / 港等） | MultiPolygon 全部参与判定与高亮 |
| 南海诸岛那个无名 feature（adcode `100000_JD`） | 索引时跳过，unmatched 视为未命中 |
| 2D 视图 / morph 过程中 | 门控直接返回；切 2D 前收起卡片组 |
| 城市墙 / 票根册 / 城市视图打开时 | 收起卡片组（与现有卡片一致） |
| 城市高亮图层开启 | 只影响渲染，不参与省份拾取（拾取走几何判定） |
| 底图切换（高德 ↔ 天地图） | 城市标记位置重建，连线每帧读世界坐标，自动跟随 |
| 足迹数据重载 | 重建索引；若卡片组打开则收起 |
| 窗口 resize / 宽度降到 820px 以下 | 重排；窄屏直接整组收起 |
| 卡片被拖到屏幕外 | 拖拽时夹紧到视口内（8px 边距） |
| 自动旋转开启时打开卡片组 | 暂停自转，关闭后按偏好恢复 |
| 拖拽卡片跨越省份/城市 | 只影响该卡位置，不改变归属 |

## 13. 性能预算

- 拾取：每次点击 35 次 bbox 比较 + 至多 1 次环测试（亚毫秒）；
- hover 光标判定：沿用现有 60ms 节流；
- 连线更新：只在相机移动 / 卡片拖动 / resize 时执行，每条线 1 次坐标换算 + 1 次路径写入；
  单省城市数通常在 1~4 张，即便 10 张也在 1ms 量级；
- 高亮：最多 44 个实体（浙江）的属性赋值，一次点击一次开销；
- 卡片锚点矩形用缓存 + `ResizeObserver`，避免每帧强制布局。

## 14. 实施顺序（可分步验收）

1. **数据与拾取**：`provinceIndex` + 几何判定 + 门控，先用 `console.log` 验证点击省份能打印出正确的省名与城市数；
2. **高亮**：选中/取消的材质改写与标记压暗；
3. **卡片与布局**：`showCityCards` + 分侧 / 错位 / 堆叠 + 拖拽；
4. **连线与标签**：SVG 覆盖层、青蓝抛物线、生长动画、省名标签；
5. **状态收口**：相册往返、整球 / 2D / 全屏层 / 数据重载 / resize 的收起与恢复；
6. 按 §15 逐条手测后 `reloadPlugin`。

## 15. 验收清单

- [ ] 整球视图点击省份无任何反应；放大到出现中国轮廓后点击才生效；
- [ ] 单城市省份：一张卡片 + 一条线，卡片内容与时间正确；
- [ ] 多城市省份（如河南省 3 城）：每城一张卡 + 一条线，左右分侧、同侧错开、线不交叉；
- [ ] 城市特别多且集中在同一侧时进入堆叠模式，hover 能看清完整卡片；
- [ ] 无足迹的省份点击后无反应，且不关闭已经打开的卡片；
- [ ] 点击省份时相机完全不动；
- [ ] 点击卡片进入对应城市相册；返回地球后卡片组恢复；
- [ ] 拖动卡片：线实时跟随；再点一次省份后卡片回到自动排版位置；
- [ ] 点空白 / Esc / 切 2D / 打开城市墙或票根册：整组收起；
- [ ] 手动拖动地球让某城市转到背面：对应卡片与线淡出，转回正面恢复；
- [ ] 窄屏（< 820px）点击省份无反应；
- [ ] 拖近到 1500 km 以下：卡片组自动收起；
- [ ] 控制台无报错；切底图、重载足迹数据后连线仍正确。

## 16. 一键展开全部城市（已实现）

导航栏主操作组的 **「全部城市」** 按钮：

- 门控：桌面端 + 3D + 城市聚合态（`cityCardsEnabled()`）——不要求中国轮廓显示，因为它是全局动作；
  不可用时按钮自动置灰（`updateIntroVisibility` 每帧校正一次，只在翻转时写 DOM）；
- **自动缩放**：如果这时相机还没放大到能看见中国轮廓（整球视图），先飞到
  `(104.0, 34.5, 8000km)`（轮廓可见 < 9500km、仍是城市聚合态 > 1500km），落地后再展开卡片；
  飞行期间按钮保持按下态并忽略重复点击，Esc / 切 2D / 关组都会取消这次飞行；
- 行为：把 `cityList` 的全部城市交给 `activateCityCards()`，复用省份那套分侧 / 错位 / 堆叠 / 连线 / 拖拽；
  不点亮任何省份，标注写「全部城市 · N 座」（锚点取所有城市中心的世界坐标平均值）；
- 再点一次收起；按钮本身的 `active` 态与 `aria-pressed` 跟着卡片组状态走；
- 从卡片进相册再返回，会按原来的模式恢复（`provinceRestorePending` 现在带 `mode`）。

城市多（> 6）时自动切紧凑档，所以「全部城市」用的是 214px 的窄版卡片；同侧排不下就进入堆叠模式。

## 17. 待微调的视觉常量

这些数值先按本文档实现，跑起来看截图再调，不需要现在拍板：

- 卡片宽度 / 高度 / 圆角 / 间距（§6.1）；
- 卡片列到屏幕左右边缘的留白（`max(76px, 7vw)`）；
- 阶梯缩进档位（0 / 18 / 36 / 54px）与沿边搜索步数上限（12）；
- 抛物线弧度系数（0.22 → 0.38）与线宽（1.2px）；
- 青蓝渐变的具体色值与发光强度（§8.2）；
- 省名标签距离省份中心的偏移（18px）与字号。

---

## 附录：实现记录（2026-09-17 已完成）

### 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/main/resources/templates/footprint.html` | `#view-3d` 内新增 `#leaderOverlay` / `#provinceLabel` / `#provinceCardLayer`；JS 与 CSS 版本号 v137 → v138 |
| `src/main/resources/static/css/travel-memory.css` | 新增「省份城市卡片」一节（连线层、省名标注、卡片、紧凑档、窄屏禁用） |
| `src/main/resources/static/js/travel-memory.js` | 新增「省份城市卡片」实现区；接入点击/悬停、高亮、整球与 2D 收起、相册往返、数据重载等状态点 |

### 与方案的两处实现取舍

1. **卡片尺寸改成"先量再排"**：卡片高度由内容决定（写死高度会把信息裁掉），
   所以建组与 resize 时各量一次 `offsetWidth/offsetHeight` 参与布局，避免每帧读尺寸触发强制布局。
2. **溢出只保留"堆叠"一档**：不再走"缩小间距 → 缩小卡片 → 拆两列 → 逐级滚动"的链条，
   而是普通排布 + 堆叠两种模式（这与最终确认的"优先左右错位、实在超了就堆叠"一致）。
   仍有紧凑档（城市数 > 6 时卡片降到 148px）。
3. **省名标注锚点用 DataV 的 `center`**（人工校正过），缺失时才退回几何包围盒中心。

### 第二版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 连线起点从标记圆点中间开始 | 去掉原来的"标记外缘 + 18px"偏移，起点直接取标记屏幕坐标 |
| 卡片改成横版、再小一点 | `grid-template-columns: 38% minmax(0,1fr)`（左图右文），默认档 200px×约 76px、紧凑档 178px；数字与日期字号降到 10px |
| 卡片不要贴着屏幕左右边缘 | 自动排布的内缩改为 `max(76px, 7vw)`（原为固定 24px）；拖拽仍按 8px 夹紧 |

资源版本号同步升到 `v139`。

### 第三版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 卡片有点小，再大一些 | 默认档 200→**244px** 宽、76→**96px** 高（封面 40% 在左），城市名 18→21px、数字 12→13.5px、日期 10→11px；紧凑档 178→214px、封面高度 86px |
| 加一键展开所有卡片 | 导航栏主操作组新增 **「全部城市」**（`#provinceAllBtn`）：门控为「桌面端 + 3D + 城市聚合态」，一次把 `cityList` 全员展开；再点收起；相册往返按原模式恢复 |

资源版本号同步升到 `v140`。

### 第四版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 错开不够、还是像一列 | 布局从"左右两列 + 同列推挤"改成**四边就近放置**：贴哪条边就放哪条边（上下左右都参与），沿边从与标记对齐的位置向两侧逐步外扩，同边阶梯缩进改成四档 `[0,18,36,54]`，卡片因此沿视口四周散开 |
| 上面/下面也要能用；本边不够换别的边 | 边优先级按归一化距离排序（平手时左右优先），本边找不到位置就自动换次近的边；四条边都排满再做网格兜底，最后才允许重叠 |
| —— | 连线终点改成「卡片中心朝标记方向与卡片边框的交点」，所以上下边的卡片也能把线钉在朝向标记的那一侧 |

### 布局自测（Node 里跑同一份 `pickProvinceCardSpot` / `layoutProvinceCards`）

| 场景 | 结果 |
| --- | --- |
| 1920×1080，整球视图，16 城 | 0 重叠、0 越界，四边分布 4 / 5 / 3 / 4 |
| 1920×1080，国内范围，16 城 | 0 重叠、0 越界，四边分布 6 / 6 / 2 / 2 |
| 1920×1080，单省 3 城（偏右） | 0 重叠，分布在 right / top / bottom |
| 1920×1080，左上角 8 城 | 0 重叠，四边各 2 |
| 1366×768，5 城 | 0 重叠、0 越界 |
| 1920×1080，24 城（极端） | 0 重叠、0 越界 |
| 1440×900，24 城（超出容量） | 4 处重叠（容量上限，属预期兜底） |

### 第五版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 悬停卡片时希望对应的连线更显眼 | 按 A+B+C+D+E 全做：其余连线压暗到 0.32 / 1px，被悬停那条 2px + 提亮 + 流动虚线；起点圆点放大到 4.5 并呼吸；对应的城市标记一起放大提亮；进出过渡 0.25s / 0.15s |

资源版本号同步升到 `v142`。

### 第六版调整（同日，含一个 bug 修正）

| 反馈 | 原因 / 调整 |
| --- | --- |
| 地球转到后面，卡片消失了但连线还在 | **bug**：隐藏只写了 `item.group.classList.toggle('is-hidden')`，但 CSS 里没有任何规则匹配 `g.is-hidden` —— 规则挂在 `.prop-leader` / `.prop-leader-dot` 上，所以线从来没被真正隐藏过。现在 `<g>`、`path`、起点圆点、终点圆点四者一起切换类，隐藏规则排在样式表最后 |
| 悬停卡片时城市高亮改成和省份一样的青蓝 | `setProvinceCardFocus()` 里在 `setMarkerFocus()` 之后把该城市的 `billboard.color` 设为省份同款 `#7FE7FF`；移开时由 `setMarkerFocus(null)` 按当前选中态刷回去 |
| 连线结束部分太淡 | 渐变末端 alpha 0.28 → **0.72**，并在卡片端补一个 r=2.4 的落点小圆（`#CDF6FF`），让线看起来是"钉"在卡片上而不是渐渐消失 |
| —— | 顺带修掉两个连带问题：悬停中关闭卡片组时 `has-focus` 类会残留（下次打开一上来就是全暗的）；卡片被转到地球背面时若正被悬停，`is-active` 与压暗状态现在会一起还原 |

资源版本号同步升到 `v143`。

### 第七版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 「全部城市」下悬停卡片，城市标记没有变青蓝 | 颜色从"一次性赋值"改成**由状态推导**：`markerEmphasisColor()` 里新增 `provinceFocusEntity` + `provinceCardsMode === 'all'` 判断并排在最前。这样任何一次 `refreshMarkerColors()` 都会把它算回来，不会被之后的状态刷新覆盖掉 |
| 只有「全部城市」模式才要青蓝；省份模式悬停不要改变城市高亮 | 悬停卡片时的标记强调（青蓝 + 放大 + 其余压暗）只在 `mode === 'all'` 时执行；省份模式下悬停只强调"连线 + 起点圆点"，完全不碰标记 —— 省份轮廓已经把这一片标出来了，再改颜色是多余的干扰 |

资源版本号同步升到 `v144`。

### 第八版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 要变青蓝的是「城市高亮」的金色填充，不是城市标记点 | 去掉之前给标记 `billboard.color` 上的青蓝；改为把该城市的**城市高亮填充**（`CITY_FILL_THEMES.amber` = `rgba(255,149,66,0.22)` 那层金色）换成省份同款青蓝 `rgba(127,231,255,0.30)`，移开或收起时还原主题金色 |
| 同上 · 仅「全部城市」模式 | 换色 + 标记放大 + 其余标记压暗一律只在 `mode === 'all'` 时执行；省份模式悬停只强调连线，球面上什么都不动 |
| 点「全部城市」时若相机还没放大到出现中国轮廓，自动缩放 | `activateAllCityCards()` 里判断 `boundaryVisible`：不可见就先 `flyTo(104.0, 34.5, 8000km)`，`moveEnd` 落地后再展开卡片（带 700ms 超时兜底；`prefers-reduced-motion` 直接跳转） |

实现要点：`buildCityFills()` 建图层时顺手记录 `cityFillIndex: Map<cityAdcode, { entities }>`，
换色时**逐实体**赋新材质（同一数据源内的实体共享材质实例，改实例会整城一起变）；
`clearCityFills()`（切底图 / 重载数据时触发）会一并清空索引与换色状态。

> 注意：城市高亮图层只有在导航栏「城市高亮」开启时才会构建，关着的时候没有金色可换 ——
> 此时的悬停只体现为连线强调 + 标记压暗。

资源版本号同步升到 `v145`。

### 第九版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 把模板里写死版本号的 travel-memory.css / district-pinyin.js / travel-memory.js 改到 FootprintHeadProcessor 用版本号加载 | 三个标签从 `footprint.html` 移除，改由 `FootprintHeadProcessor` 注入 `?version=${version}`（插件版本，当前 `2.9.14`）；`FootprintRouter` 写入 `ModelConst.TEMPLATE_ID = "plugin:footprint:footprints"`，处理器据此**只在足迹页注入** |

实测（渲染结果核对）：

| 检查项 | 结果 |
| --- | --- |
| `/footprints` 是否注入三个资源 | 是，`travel-memory.css?version=2.9.14`、`district-pinyin.js?version=2.9.14`、`travel-memory.js?version=2.9.14`（两个脚本带 `defer`） |
| 首页 `/` 是否被注入 | 否（`travel-memory.js` / `district-pinyin.js` 均未出现） |
| 三个资源带版本号能否取到 | 均 200（267KB / 9.3KB / 408KB） |
| 模板里是否还有写死版本号 | 已无（`footprint-reveal-v*` 全部移除） |

> 遗留观察：原有的 `footprint.css` / `result.css` / `footprint.js` 仍是**全局注入**（本次未改动其行为），
> 如果也想收敛到足迹页，可以在同一个处理器里一并加上页面判断。

### 第十版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 原有的三个老资源也只在足迹页加载 | `FootprintHeadProcessor.process()` 一开头就把整个注入（老资源 + 3D 地球资源）包在 `isFootprintPage(context)` 判断里：不是足迹页直接 `Mono.empty()` |

实测（多页面核对）：

| 页面 | 是否包含插件资源 |
| --- | --- |
| `/footprints` | 6 个全在（footprint.css / result.css / footprint.js / travel-memory.css / district-pinyin.js / travel-memory.js），统一 `?version=2.9.14` |
| `/` `/archives` `/categories/default` `/about` | 全部为 `false`（此前老资源是全局注入的） |
| 6 个资源带版本号访问 | 均 200 |

### 第十一版调整（同日）

| 反馈 | 调整 |
| --- | --- |
| 抛物线结束位置不要有圆点 | 去掉之前补的卡片端落点小圆（`.prop-leader-end` / `item.end`）：DOM 不再创建、CSS 规则删除、每帧更新里对应的坐标写入一并移除。**保留**渐变末端 alpha 0.72（上一版把线尾提亮的那次调整），所以线尾仍然清晰，只是不再有圆点 |

> 开发提示：静态资源响应头是 `Cache-Control: no-cache`（浏览器每次都会回源校验），
> 所以同一插件版本下刷新页面就能拿到最新文件；正式发版时改 `gradle.properties` 的 `version` 即可让所有客户端失效缓存。

### 第十二版调整（同日）：展开动画改成「线到、卡到」

按 A+B+C+D+E+G 落地（F 收起动画本轮未做）。

| 代号 | 做法 | 参数 |
| --- | --- | --- |
| A | **卡片从自己的标记飞出来**（FLIP）：先把卡片定到它自己那个城市标记的屏幕位置并缩到 0.82，落一次样式计算后过渡到布局算出的落点 | 500ms / `cubic-bezier(0.16, 1, 0.3, 1)` |
| B | **线到、卡到**：卡片与线共用同一套错峰，卡片比线晚 120ms 出发，两者时长相同，基本同时到位 | 线 500ms、卡 500ms、lead 120ms |
| C | **起点"引爆"脉冲**：标记在一个短脉冲里鼓到 1.28 再回 1（只做「全部城市」；正在被悬停聚焦的标记不参与；收起时立刻取消并还原） | 320ms，`1 + 0.26·sin(πt)` |
| D | **错峰顺序有意义 + 总量封顶**：单省按"到标记群中心的距离"由内向外推开；步长 40ms，总错峰不超过 600ms（卡片多时自动压缩） | step `min(40ms, 600ms/(n-1))` |
| E | **全部城市按经度西→东扫过**：像一道波从西边推到东边，正好对上"全国铺开"的语义 | 同 D 的错峰参数 |
| G | **入场期间锁住重排**：`provinceEntranceUntil` 时间戳内的每帧只刷新锚点+连线+标注，不重写卡片位置 —— 既避免改写 transform 打断过渡，也避免路径长度变化把"整段 dash"的铺开动画切出断口 | 总时长 = max(线结束, 卡结束) + 120ms |

配套细节：

- `is-flying` 只在入场那一小段时间挂在卡片上（常驻的话，相机转动时的逐帧重排会被过渡拖成"追着跑"，拖拽也会发黏）；
  `.prop-city-card.is-dragging { transition: none }` 保证入场没结束时拖动也立刻跟手。
- 卡片不再在构建时加 `.show`，改由入场动画统一放飞；标记在背面的那批直接落到最终位置（由 `is-hidden` 负责隐藏），
  等它们转回正面时能正常显示。
- `prefers-reduced-motion` 下：不飞、不脉冲、不铺线，卡片直接到位。

排期参考：3 座城市约 700ms 走完；16 座（全部城市）约 1.2s，其中 0.6s 是西→东的错峰。

### 第十三版调整（同日）：卡片封面统一成"首字兜底 + 限流加载"

原来只有"这座城市没有照片"时才显示首字：只要有封面 URL 就直接挂 `background-image`，
于是**加载慢能看到的只有渐变底色、加载失败就永久空着**（而且没有 `onerror`，失败是静默的）。
现在小城市卡与 `cityCard` 统一走同一个 helper（足迹卡本来就是"首字 + 重试按钮"，未改动）。

结构改成两层：媒体区里**首字常驻做底**（`.card-cover-monogram`），封面是另一层
`.card-cover-photo`，`onload` 之后才淡入 0.25s 盖上去。所以：

| 情况 | 现在的表现 |
| --- | --- |
| 加载中 | 首字（不再是空底色） |
| 加载失败 | 停在首字，不再空白 |
| 加载成功 | 图片淡入覆盖首字，无布局跳动（两层都是绝对定位） |

配套的加载策略：

| 机制 | 参数 | 说明 |
| --- | --- | --- |
| 预加载 | `new Image()` + `decoding='async'` | 只有 `onload` 才挂图，避免"灰着半天突然出现" |
| 并发限流 | 同时 3 张（`CARD_COVER_CONCURRENCY`） | 与城市墙同量级，不和底图瓦片抢带宽 |
| 加载顺序 | 小卡片按**展开动画的错峰顺序**排队 | 先飞出来的卡片先拿到封面 |
| 失败重试 | 3s 后静默重试一次（`CARD_COVER_RETRY_MS`） | 图床偶发 502 很常见；按约定不放重试按钮 |
| 失败缓存 | 失败结论只记 60s（`CARD_COVER_FAIL_TTL_MS`） | 避免同一张坏图反复请求，但过一会儿再点还会重试 |
| 成功缓存 | 永久（按 URL） | 再打开同一座城直接出图，不再发请求 |
| 竞态保护 | 每个媒体区一个 `coverToken` + `isConnected` | 卡片被复用/关组后到达的 `onload` 直接丢弃 |

### 第十四版调整（同日）：连线改成"地图标注引线"材质

反馈是「连接线与地球很不搭」。诊断出三个原因：冷色青蓝是全页唯一的冷色（其余是暖白 / 琥珀金）、
`drop-shadow` 发光带来霓虹感、屏幕空间抛物线拉得又长又飘。按 A + C 落地：

| 项 | 之前 | 现在 |
| --- | --- | --- |
| 线的材质 | 青蓝渐变 + 6px 辉光 | **深色描边打底（2.4px `rgba(8,12,20,.55)`）+ 暖白细线（1.1px）**，**没有任何发光** |
| 线色 | `#8FE9FF → rgba(143,233,255,.72)` | `#F7F5F1 → rgba(247,245,241,.68)` |
| 默认存在感 | 整组不透明 | 整组默认 **0.58**（16 条同时在场也不糊成一张网） |
| 起点圆点 | `#bff3ff` 实心 + 辉光 | 暖白实心 + 深色描边（r 3.2，悬停 4.6） |
| 弧度 | 扇面 `0.22 → 0.38` | 收敛到 **`0.10 → 0.18`**（更像标注引线，不再像数据流） |
| 悬停 | 2px + `brightness(1.45)` + 9px 辉光 + 流动虚线 | 2px（底线 3.2px）+ 两层同步的流动虚线；**去掉 brightness 与辉光** |
| 卡片悬停描边 | 青蓝 | 暖白（青蓝只留给"选中区域"：省份轮廓与城市高亮） |

为什么这样更搭：地名标注、卡片文字本来就是「亮色 + 深色描边」这一族材质，连线跟着走之后，
浅色矢量底图与深色卫星底图上都能读清（不需要按底图换色），画面里也只剩一套"中性引线 + 区域强调色"。
青蓝仍然保留在**区域高亮**上（省份轮廓/填充、全城市模式悬停时的城市填充），那是用户明确选定的"选中色"。

#### 最终参数（试色定稿）

试色顺序：青蓝（霓虹）→ 暖白（太淡）→ 提亮暖白 → 琥珀金 → 薄荷青绿 → 雾蓝 → 珊瑚粉 → **象牙白（定稿）**。
最终取值：

| 项 | 值 |
| --- | --- |
| 亮线 | `#FFF3E0 → rgba(255,243,224,0.86)`，1.6px，悬停 2.4px |
| 深色底描边 | `rgba(8,12,20,0.42)`，2.8px，悬停 3.8px（只作浅色底图保底，压到 0.42 就没有"铅笔脏边"） |
| 整组不透明度 | 默认 0.92，悬停其它压到 0.30、被悬停那条 1 |
| 起点圆点 | `#FFF7E8` + 深色描边，r 3.6 → 悬停 5 |
| 弧度 | 扇面 `0.10 → 0.18` |
| 卡片悬停描边 | 同色系象牙白 |
| 区域高亮 | 省份轮廓/填充仍为琥珀金 `#FFB067`（与城市填充同族） |

**修复（同日）**：铺开动画原先只作用于亮线，深色底描边没有参与 dash 动画，
于是展开时**整条黑线先出现**、亮线才慢慢盖上去。现在两层共用同一段
`stroke-dasharray / stroke-dashoffset` 生长动画（同长度、同延迟、同时长），一起从标记端铺到卡片。
### 验证结果

| 项目 | 结果 |
| --- | --- |
| JS 语法 | `node --check` 通过 |
| CSS 括号平衡 | 1350 / 1350 通过 |
| 省级索引 | 34 个省级行政区（排除南海诸岛空名分区） |
| 几何判定（城市点位） | 13 / 13 通过（含海面、境外两个负数用例） |
| 几何判定（真实足迹数据） | 20 / 21 通过，唯一失败项见下 |
| 插件热重载 | `.\\gradlew.bat reloadPlugin` 输出「插件 足迹插件（footprint）已就绪!」 |
| 线上资源 | `/footprints` 已引用 `?v=footprint-reveal-v138`，`travel-memory.js` 已包含新实现 |

**唯一失败用例**：`南天门(金灯寺)`（山西/河南交界的山脊，坐标 113.6925 / 36.0199）。
地址反查记录为山西省，但该坐标落在边界折线偏河南一侧，偏移 ±55 m 就会在两个省之间跳变。
这属于"点击点位落在省界线上"的固有精度问题（不影响其他省份与整体可用性）。

### 尚未验证的部分

本环境没有可用的浏览器自动化，**卡片布局/连线的实际视觉效果未经真机确认**，需按 §15 的验收清单人工过一遍，
重点看：多城市省份的左右分侧与错开、堆叠模式的 hover 展开、拖动后连线跟随、相册往返恢复。
