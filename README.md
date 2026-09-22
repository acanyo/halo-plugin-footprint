# Halo-Plugin-Footprint

> 基于高德地图的 Halo 足迹插件，记录和展示你去过的地方。

![img.png](img.png)

![img.png](img2.png)

## 项目介绍

`足迹` 是专为 Halo 开发的旅行足迹插件。它把每一条旅行记录变成一个地图标记、一组照片和一个可以回看的旅行故事，支持从后台录入数据，在前台展示。v2.8.0 起，前台默认以 3D 地球展示足迹，并支持一键切换回 2D 高德地图（图片墙、时间线等功能完整保留）。

[演示站](https://www.yunduan019.com/footprints)

## 原作者

本项目原作者为 Handsome，主页：<https://www.lik.cc/>。

原始项目地址：[acanyo/halo-plugin-footprint](https://github.com/acanyo/halo-plugin-footprint)

[演示站](https://www.lik.cc/footprints) · [在线文档](https://www.lik.cc/docs/halo-plugins) · [GitHub](https://github.com/acanyo/halo-plugin-footprint)

![Logo](src/main/resources/logo.svg)

## 功能特点

- 3D 地球首页：`/footprints` 默认以 Cesium 3D 地球展示足迹，支持自动旋转、城市聚合、城市足迹与相册、图片灯箱、中国轮廓和底图切换。
- 2D/3D 一键切换：顶部导航栏切换，3D→2D 地球展开、2D→3D 合并的 Cesium 动画过渡；2D 模式为原高德地图，时间线、图片墙等全部保留，切换状态刷新后自动记忆。
- 高德 2D 地图：自定义地图样式、独立楼块图层，每个足迹可保存独立的缩放级别、俯仰角和旋转角。
- 天地图支持：配置天地图 Key 后可启用天地图影像/矢量底图与国内三维地形。
- 自定义足迹标记：照片、名称、类型组合的标记点，支持 4 种标记样式和 4 种悬停高亮动画。
- 3D 票根页：支持票夹叠放与横向长串两种切换样式，包含加载/失败状态、进度条与位置拼音等细节。
- 城市/足迹图片墙：从城市卡或足迹卡直接进入城市图片墙，顶部可下拉切换城市，手账照片滚动到底自动加载。
- 图片墙：桌面端在地图外围展示，移动端以底部抽屉展示，支持经典、画廊、胶片、手账、聚焦 5 种布局，包含灯箱、翻页和胶带掀角动画。
- 时间线抽屉：按时间回看足迹，悬停卡片时地图自动移动并渲染抛物线轨迹；快速切换或滚动时自动取消旧动画，避免地图排队移动。
- 足迹统计：展示总足迹数、省级行政区覆盖、城市数量，以及直辖市、自治区、特别行政区、省份分类统计。
- 已去过城市高亮：基于高德行政区图层，用主题色高亮已经去过的城市区域。
- 地图控制：缩放、标准/卫星图层、路网、路况、标记点显隐、返回中国全图、全屏。
- 主题定制：通过 HSL 配置全局配色，适配浅色/深色模式。
- 后台管理：足迹 CRUD、关键字/类型筛选、批量删除、统计详情、图片墙图片排序、省/市自动解析。
- Finder API：主题可以自由获取并渲染足迹数据。

## 环境要求

- Halo `>= 2.22.0`
- Java `17` 或更高版本
- 高德 JS Key（用于加载地图和前端安全密钥）
- 高德 Web 服务 Key（用于服务端地理编码、逆地理编码和 POI 搜索）
- 可正常访问高德地图 JS API
- 天地图 Key（可选）：用于 3D 地球的天地图底图与三维地形，不填则 3D 地球仅显示高德底图

## 安装

1. 从 [GitHub Releases](https://github.com/yunDuan-G/halo-plugin-footprint/releases) 下载最新版本的插件 JAR。
2. 进入 Halo 控制台，依次打开「插件」->「安装」，上传 JAR。
3. 启用插件，然后在「足迹」插件设置中填写高德 Key 和其他展示配置。

> 升级到 2.9.1 后，高德 JS Key 和 Web 服务 Key 改为通过 Halo Secret 选择，不再直接填写明文。请分别创建包含 `key` 字段的 Secret，再在插件设置中选择；旧版本 ConfigMap 中的明文配置不会自动迁移。升级后使用新的 Secret 设置项，旧的失效引用会被忽略。

如果插件已经发布到应用市场，也可以在 Halo 控制台的应用市场中直接搜索安装。

## 快速使用

1. 在插件设置中填写「高德 JsKey」和「高德 WebKey」，并保存。
2. 在控制台左侧菜单的「内容」分组中进入「足迹」，新建一条足迹：
   - 填写名称、描述和详细地址，系统会根据地址自动获取经纬度；
   - 上传足迹封面和图片墙图片，图片墙图片支持拖拽调整顺序；
   - 选择足迹类型，关联文章或自定义链接，并关联其他足迹；
   - 设置缩放级别；缩放级别 `>= 18` 时可以额外设置 3D 俯仰角和旋转角。
3. 保存后访问 `/footprints` 查看前台足迹地图。

## 插件设置

### 基本设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 页面标题 | `我的足迹` | 前台页面标题 |
| 左下角标题 | `足迹` | 地图左下角 Logo 文案 |
| 足迹描述 | `每一处足迹都充满了故事...` | 地图左下角的描述文字 |
| hsl 颜色值 | `109,68%,60%` | 全局配色，格式如 `322,68%,60%`，去掉 `deg`，数值之间不要有空格 |
| 启用悬停缩放 | 开 | 悬停时间线卡片时，是否先缩放到对应位置再显示抛物线动画 |
| 高亮已去过城市 | 开 | 使用主题色高亮已经去过的城市区域 |
| 图片墙单页展示数量 | `6` | 图片墙单页最多展示的图片数量，范围 `1-12` |
| 图片墙样式 | `original` | 桌面端图片墙展示方式，见下方样式说明 |
| 高德 JsKey | 无 | 浏览器端加载高德地图并设置安全密钥 |
| 高德 WebKey | 无 | 服务端调用高德地理编码、POI 搜索和逆地理编码 |
| 地图样式 | `标准` | 高德地图内置样式主题 |
| 标记点样式 | `photo` | 前台足迹标记样式 |
| 悬停高亮方案 | `ring` | 时间线悬停时标记点的高亮动画 |

### 图片墙样式

| 值 | 名称 | 说明 |
| --- | --- | --- |
| `original` | 经典方案 | 散落的拍立得卡片，带细线和胶带装饰 |
| `gallery` | 地图侧边展开式画廊 | 大图 + 缩略图轨道，固定每页 8 张 |
| `filmstrip` | 胶片带模式 | 大图 + 可横向滚动的胶片缩略图，不翻页 |
| `journal` | 旅行手账模式 | 三列手账网格，带编号和胶带装饰 |
| `focus` | 聚焦式照片墙 | 中央主图 + 四周小图聚焦布局 |

> 移动端固定使用胶片带式底部抽屉图片墙，打开时隐藏底部控制栏，关闭后自动恢复；没有图片的足迹仍显示原有信息窗口。

### 标记样式

- `pin`：水滴标记
- `circle`：简约圆形
- `card`：卡片标记
- `photo`：照片徽章

### 悬停高亮方案

- `glow`：缩放光晕
- `pulse`：脉冲光环
- `bounce`：弹跳动画
- `ring`：边框高亮环

### 高级设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 足迹类型 | `旅游、美食、购物、住宿、交通、其他` | 自定义足迹类型列表，后台新建和筛选足迹时使用 |

### 3D 地球设置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 3D 地球标题 | `旅行记忆` | 3D 地球导航栏与首页标题卡的标题，独立于基本设置的「左下角标题」 |
| 3D 地球描述 | `把每一次出发，收藏成地球上的坐标；让走过的城市，成为星空下的故事。` | 3D 地球首页标题卡的描述，独立于基本设置的「足迹描述」 |
| 天地图 Key | 无 | 天地图浏览器端 Key，用于天地图影像/矢量底图与三维地形；不填时 3D 地球仅显示高德底图 |
| 默认启用三维地形 | 关 | 配置天地图 Key 后，进入 3D 地球时是否默认开启三维地形，仍可在导航栏手动切换 |
| 地球地名标注 | `城市名 + 足迹名` | 常驻地名的显示方式：关闭（仅悬停显示）/ 只显示城市名 / 城市名 + 足迹名。城市名在相机低于 4000 公里后出现，放大到城市后改为标注各条足迹名；使用「高德卫星·无字」或「天地图无标注」底图时建议开启，否则画面上没有任何地名参照 |

### 图片处理配置

如果你的图床需要为同一张原图生成不同质量的缩略图，可以按用途配置 URL 规则。**三项全部留空时，界面直接使用足迹中保存的图片 URL**，适合大多数图床与 Halo 本地附件。

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| 标记点图片：要替换的片段 | 空 | 例如 `!w100`，匹配 2D 地图标记点原图中的片段 |
| 标记点图片：替换为 | 空 | 例如 `!A100`，低质量/缩略图后缀 |
| 标记点图片：追加后缀 | 空 | 例如 `/fw/200`，追加在图床 URL 末尾的压缩参数 |
| 时间线/详情图片：要替换的片段 | 空 | 与标记点独立配置，例如 `!w100` |
| 时间线/详情图片：替换为 | 空 | 例如 `!A100` |
| 时间线/详情图片：追加后缀 | 空 | 例如 `/fw/500` |
| 城市卡片墙图片：要替换的片段 | 空 | 3D 地球城市卡片墙封面与轮播预览图使用；三项都留空时沿用标记点图片的 from→to 规则 |
| 城市卡片墙图片：替换为 | 空 | 例如 `!A100` |
| 城市卡片墙图片：追加后缀 | 空 | 例如 `/fw/300` |

阿里云 OSS 场景参考配置：标记点填 `!w100 → !A100 + /fw/200`，时间线/详情填 `!w100 → !A100 + /fw/500`；其他图床可自行调整替换片段与后缀格式。

## 后台管理

控制台菜单路径为 `/footprint`，位于「内容」分组，使用「足迹」图标。

插件提供两个角色模板：

- `足迹查看`：查看足迹列表和统计。
- `足迹管理`：创建、编辑、删除足迹，并调用逆地理编码等自定义接口。

后台主要功能：

- 足迹列表：显示名称、图片、类型、省份、城市、经纬度、地址和创建时间。
- 搜索与筛选：支持按名称/省份/城市关键字搜索，按足迹类型筛选，按创建时间排序。
- 批量操作：勾选后批量删除足迹。
- 统计概览：展示总足迹、省级覆盖、城市覆盖和行政区分类，点击省份/城市可反查足迹列表。
- 新建/编辑：支持足迹信息、图片墙图片、足迹类型、关联文章/链接、关联足迹、创建时间和地图参数。
- 更新经纬度：对已有足迹手动修正经纬度。
- 重新解析省/市：调用高德逆地理编码，回填省份、城市及 adcode。

## 前台页面

前台路由固定为 `/footprints`，模板为 `src/main/resources/templates/footprint.html`。页面会通过 `FootprintHeadProcessor` 自动注入 CSS、字体和 JS 资源。

### 地图交互

- 默认进入 `/footprints` 显示 3D 地球整球视图；顶部导航栏提供 2D/3D 切换（Cesium 展开/合并动画）、自动旋转、城市高亮、三维地形和底图下拉。
- 3D 地球：整球视图按城市聚合标记，放大后展开为单个足迹；点击城市打开城市足迹与相册，支持图片灯箱和标记详情卡；底图支持高德矢量/卫星（默认高德卫星·无字）与天地图影像/矢量。
- 3D 地名标注：整球与中远距离保持干净，相机低于 4000 公里后标注城市名，放大到城市后标注各条足迹名（后台可切换为只显示城市名或关闭）；同屏多个名称会做屏幕空间避让，宁可让位也不叠字；悬停名称气泡只在标记圆点上触发，划过文字不会触发。
- 3D 城市卡片与连线：点击省份（已放大到显示中国轮廓时）→ 该省每座去过的城市各出一张小卡片，并从城市标记圆点拉一条青蓝抛物线连到卡片；卡片按「就近边」在视口四周铺开、互不重叠、可拖拽，点击卡片进入对应城市的相册，从相册返回后原样恢复；全程不移动相机。
- 全部城市：顶部导航「全部城市」一键把所有去过的城市铺成卡片与连线（相机还没放大到国内范围时会先自动飞到能看见中国轮廓的层级）；悬停某张卡片时，它自己的连线会加粗提亮并流动，其余连线压暗，全部城市模式下对应城市的高亮填充也会从主题金色变成青蓝。
- 票根页：导航栏或足迹详情卡可进入票根墙，支持票夹/横向长串两种切换样式；票根字幕显示足迹名、城市/省份与拼音（可选用 AlexBrush 手写字体）。
- 图片墙：城市卡与足迹卡均可打开城市图片墙，顶部城市名支持下拉切换城市；足迹手账照片按滚动位置分批自动加载，不再需要手动点击“加载更多”。
- 2D 模式（高德地图）：底部控制栏提供缩放、标准/卫星图层、路网、路况、标记点显隐、中国全图、3D 地球、全屏和时间线入口。
- 2D/3D 状态通过浏览器本地存储记忆，刷新后保持上次视图模式。
- 点击标记点：有图片墙图片时，桌面端展示地图外围图片墙，移动端展示底部抽屉式图片墙；没有图片时展示信息窗口。
- 信息窗口包含足迹名称、类型、日期、地址、描述和关联文章入口。
- 已去过城市通过高德行政区图层以主题色高亮，与标记点显隐相互独立。
- 空数据状态：插件不内置演示足迹；当后台没有任何足迹数据时，页面保持无标记状态并显示 `0` 统计，不加载伪造的样例数据。
- 当前版本已关闭地图右键拖拽旋转和调整仰角（`pitchEnable: false`、`rotateEnable: false`）。3D 视角只由每个足迹保存的缩放级别、俯仰角和旋转角决定，并在缩放级别 `>= 18` 时生效。

### 时间线抽屉

- 点击底部「时间线」打开抽屉，足迹按创建时间倒序排列。
- 桌面端悬停卡片时，地图会移动到对应位置，并在 Canvas 上绘制从卡片到标记点的抛物线轨迹；有关联足迹时还会显示关联标记点的聚焦波纹。
- 快速划过卡片或滚动时间线时，会立即取消旧卡片的地图移动、画布动画和标记高亮，滚动停止后再根据鼠标位置重新触发悬停。
- 点击「查看旅行故事」会打开该足迹关联的文章或自定义链接。

## 主题适配与 Finder API

插件为 `/footprints` 提供了默认模板，也注册了名为 `footprintFinder` 的 Finder API，主题可以自行渲染足迹列表。

### 模板变量

`footprint.html` 可以直接使用以下模型变量：

- `settings`：插件基本设置。
- `footprints`：按创建时间倒序排列的完整足迹列表。

静态资源由 `ReverseProxy` 提供，路径前缀为 `/plugins/footprint/assets/static/**`。

### Finder 方法

| 方法 | 返回值 | 说明 |
| --- | --- | --- |
| `listAll()` | `Flux<FootprintVo>` | 获取全部足迹 |
| `list(page, size)` | `Mono<ListResult<FootprintVo>>` | 分页获取足迹，页码从 `1` 开始，`size` 默认 `10` |
| `getByName(name)` | `Mono<FootprintVo>` | 按 `metadata.name` 获取单个足迹 |
| `listByName(page, size, name)` | `Mono<ListResult<FootprintVo>>` | 按 `spec.name` 分页获取足迹 |

#### listAll 示例

```html
<div th:each="footprint : ${footprintFinder.listAll()}">
  <span th:text="${footprint.spec.name}"></span>
  <p th:text="${footprint.spec.description}"></p>
</div>
```

#### list 示例

```html
<th:block th:with="footprints = ${footprintFinder.list(1, 10)}">
  <div th:each="footprint : ${footprints.items}">
    <a th:href="${footprint.spec.article}" target="_blank"
       th:text="${footprint.spec.name}"></a>
  </div>
  <span th:text="${footprints.page}"></span>
</th:block>
```

## 数据模型

足迹以 Halo 自定义模型 `Footprint` 存储，`apiVersion` 为 `footprint.lik.cc/v1alpha1`，`kind` 为 `Footprint`。

### FootprintVo

```json
{
  "metadata": {
    "name": "footprint-xxxxx",
    "generateName": "footprint-",
    "version": 0,
    "creationTimestamp": "2024-01-16T16:13:17.925131783Z"
  },
  "apiVersion": "footprint.lik.cc/v1alpha1",
  "kind": "Footprint",
  "spec": {
    "name": "足迹名称",
    "description": "足迹描述",
    "longitude": 120.145369,
    "latitude": 30.238845,
    "address": "杭州市西湖风景区-三潭印月",
    "zoomLevel": "14",
    "pitchAngle": "0",
    "rotationAngle": "0",
    "footprintType": "旅游",
    "image": "https://example.com/cover.jpg",
    "galleryImages": [
      {
        "url": "https://example.com/photo-1.jpg",
        "order": 1
      }
    ],
    "article": "https://example.com/post",
    "metadataNames": ["footprint-xxxxx"],
    "createTime": "2024-01-16T16:13:17.925131783Z",
    "province": "浙江省",
    "city": "杭州市",
    "provinceAdcode": "330000",
    "cityAdcode": "330100"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `spec.name` | string | 足迹名称 |
| `spec.description` | string | 足迹描述 |
| `spec.longitude` / `spec.latitude` | number | 经纬度 |
| `spec.address` | string | 详细地址 |
| `spec.zoomLevel` | string | 标记点缩放级别 |
| `spec.pitchAngle` | string | 3D 俯仰角，范围 `0-83` |
| `spec.rotationAngle` | string | 3D 旋转角，范围 `-360-360` |
| `spec.footprintType` | string | 足迹类型 |
| `spec.image` | string | 足迹封面图 URL |
| `spec.galleryImages` | array | 图片墙图片，`url` + `order`，兼容旧版字符串数组 |
| `spec.article` | string | 关联文章或自定义链接 |
| `spec.metadataNames` | array | 关联足迹的 `metadata.name` 列表 |
| `spec.createTime` | instant | 足迹创建时间 |
| `spec.province` / `spec.city` | string | 省/市名称 |
| `spec.provinceAdcode` / `spec.cityAdcode` | string | 省/市行政区编码 |

### ListResult

```json
{
  "page": 1,
  "size": 10,
  "total": 0,
  "items": [],
  "first": true,
  "last": true,
  "hasNext": false,
  "hasPrevious": false,
  "totalPages": 0
}
```

## HTTP API

### 足迹核心 API

Halo 会为自定义模型自动提供标准 CRUD 接口：

```text
GET    /apis/footprint.lik.cc/v1alpha1/footprints
POST   /apis/footprint.lik.cc/v1alpha1/footprints
GET    /apis/footprint.lik.cc/v1alpha1/footprints/{name}
PUT    /apis/footprint.lik.cc/v1alpha1/footprints/{name}
DELETE /apis/footprint.lik.cc/v1alpha1/footprints/{name}
```

### 插件自定义 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/apis/api.footprint.lik.cc/v1alpha1/footprints` | 分页查询足迹，支持 `page`、`size`、`sort`、`keyword`、`footprintType` |
| `GET` | `/apis/api.footprint.lik.cc/v1alpha1/footprints/stats` | 获取足迹统计信息 |
| `GET` | `/apis/api.footprint.lik.cc/v1alpha1/footprints/location/{address}` | 根据地址返回经纬度，响应为 `经度,纬度` 文本 |
| `POST` | `/apis/api.footprint.lik.cc/v1alpha1/footprints/{name}/geocode` | 对指定足迹执行逆地理编码，并回填省/市及 adcode |

### 票根图片代理

```text
GET /footprints/image-proxy?url={图片地址}
```

票根图可能放在别的域名（图床、CDN，本地开发时页面域名与图片域名也常不同），跨域图片既会被 CORS 拦掉，
画进 canvas 之后也无法导出（`toBlob` 抛 `SecurityError`），「未寄出的明信片」「旅行明信片」就出不来图。
前端遇到跨域票根图时会改走这个同源代理，由插件服务端取一次图再回给浏览器。

出于安全考虑只允许代理**本站足迹里出现过的图片域名**（`spec.ticketImage`、`spec.image`、`spec.galleryImages[].url` 的 host），
并且拒绝 localhost / 内网地址、非 http(s) 协议与非图片响应；单张图片上限 10MB。

`GET /footprints/stats` 返回：

```json
{
  "totalFootprints": 10,
  "totalProvinces": 4,
  "totalCities": 5,
  "provinces": [
    {
      "name": "山东省",
      "adcode": "370000",
      "count": 2,
      "cities": ["青岛市", "威海市"]
    }
  ],
  "cities": [
    {
      "name": "青岛市",
      "adcode": "370200",
      "province": "山东省",
      "provinceAdcode": "370000",
      "count": 1
    }
  ]
}
```

## 开发与构建

### 项目结构

```text
src/main/java                 Halo 插件后端
src/main/resources/extensions 插件配置、角色模板、静态资源代理
src/main/resources/static     前台 CSS、JS、Cesium 地球资源与字体
src/main/resources/templates  /footprints 页面模板
ui                            Halo 控制台 UI（Vue 3 + TypeScript + Vite）
```

### 打包插件

```bash
./gradlew clean build
```

Windows 下使用：

```powershell
.\gradlew.bat clean build
```

构建过程会自动安装 `ui/` 依赖并构建前端，产物位于 `build/libs/`。

### 前端开发

```bash
cd ui
pnpm install
pnpm dev
```

控制台 UI 使用 `@halo-dev/ui-plugin-bundler-kit`，依赖 pnpm 管理。

## 更新记录

- **v2.8.0**：新增 3D 地球首页（Cesium 本地资源随插件打包）、2D/3D 动画切换与状态记忆、后台「3D 地球」设置（标题/描述、天地图 Key、默认三维地形）；3D 默认底图改为高德卫星·无字；修复页面底部空白、切回 3D 地球变形、切换后无法拖拽、2D 切页突兀、底部按钮样式不统一等多项问题。

## 问题反馈

- [GitHub Issues](https://github.com/acanyo/halo-plugin-footprint/issues)
- [Halo 社区](https://bbs.halo.run)

## 许可证

本项目使用 [GPL-3.0 License](./LICENSE)。

## 鸣谢

感谢所有贡献者的支持。

样式设计参考：困困鱼 & Thyuu
