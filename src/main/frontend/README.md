# 前台代码结构

足迹页（`/footprints`）的浏览器端代码。后台管理界面在 `ui/`，不在本文范围内。

## 目录

```
src/main/frontend/
├── travel-memory/        3D 地球（Cesium）：标记、省份卡片、照片环、城记、票根册、我的旅途集、洞察……
│   ├── index.js          装配层：建 Viewer，按顺序 setup / init 各模块
│   └── modules/
├── footprint/            2D 地图（高德）：时间线、照片墙、抛物线动画
│   ├── index.js          DOMContentLoaded 入口 + window.Footprint2D
│   └── modules/
├── memory-shelf/         「世界这本书」书架（three.js）
│   ├── index.js
│   └── modules/
└── styles/
    ├── travel-memory/    index.css 用 @import 串起各片段
    ├── footprint/
    └── memory-shelf/

src/test/frontend/        纯函数单测（node:test）
tools/
├── check-frontend-contract.mjs   travel-memory 模块契约检查
└── run-frontend-tests.mjs        单测入口
frontend-build/esbuild.config.mjs 打包配置
```

## 构建

`frontend-build/esbuild.config.mjs` 把每个入口打成一个文件，写到 `build/resources/main/static/{js,css}/`：

| 入口 | 产物 | 格式 |
|---|---|---|
| `travel-memory/index.js` | `static/js/travel-memory.js` | IIFE |
| `footprint/index.js` | `static/js/footprint.js` | IIFE |
| `memory-shelf/index.js` | `static/js/memory-shelf.js` | IIFE |
| `styles/<name>/index.css` | `static/css/<name>.css` | — |

产物的 URL 由 `FootprintHeadProcessor.java` 注入到页面，**文件名不能改**，改了要同步改 Java。

产物带 sourcemap，开 DevTools 时能对到源码行号。

Gradle 任务的依赖关系：

```
./gradlew build
 ├─ classes → minifyFrontend → checkFrontendContract   （契约不过，构建失败）
 └─ test    → testFrontend                              （单测不过，构建失败）
```

单独跑：

```bash
node tools/check-frontend-contract.mjs
node tools/run-frontend-tests.mjs
cd frontend-build && npm install && node esbuild.config.mjs
```

## 跨模块共享：两种做法

### setup / init 注入（travel-memory 的主要做法）

```js
// modules/foo.js
let deps = null;

export function setupFoo(d) {   // 只保存依赖，不做任何事
    deps = d;
}

export function initFoo() {     // 绑定事件、注册渲染回调
    deps.viewer().scene.postRender.addEventListener(updateFoo);
}
```

```js
// index.js
setupFoo({ viewer: () => viewer, footprints: () => FOOTPRINTS });
// ……所有 setup 之后……
initFoo();
```

规则（契约检查会逐条拦）：

1. **注入键要对得上**。模块里写 `deps.footprints()`，主文件就得注入 `footprints`，大小写一致。
2. **模块顶层不能碰 `deps`**。ES 模块的 import 先于 `index.js` 的代码执行，那时 `deps` 还是 `null`。
   事件绑定、`getElementById` 之后马上要用 `deps` 的逻辑，都放进 `init*`。
3. **所有 `setup*` 在所有 `init*` 之前**。init 会立刻跑一轮渲染回调，可能调到别的模块，
   那个模块必须已经注入。
4. **不要用 `deps.xxx()` 调本模块自己导出的函数**，直接调。
5. **`init*` 不能是空函数**。把顶层副作用挪进 init 时要「搬」，不是「删」。

注入的值尽量用取值函数（`() => FOOTPRINTS`）而不是直接传值：数据刷新时数组会整体重建，
传进去的快照会变成旧数据。

### 直接 import

兄弟模块之间优先直接 `import`，比加注入键简单。限制只有一条：**不要形成循环 import**，
否则模块顶层读取对方导出时会拿到未初始化的值。确实需要双向调用时，改用注入
（`markers.js` ↔ `marker-detail-card.js` 就是这么处理的）。

### 会被重新赋值的状态

`export let x` 被别的模块 import 后是只读的，对方写不了。需要跨模块改的状态：

- 留在一个模块里，导出 getter / setter（如 `ticket-state.js` 的 `getTicketItems` / `setTicketItems`）；
- 或者放进一个共享对象，改属性而不是改绑定（如 `footprint/modules/state.js` 的 `state.activeCard`）。

## 加一个新模块（travel-memory）

1. 在 `modules/` 新建文件，写 `setupXxx` / `initXxx`，文件头一段注释说明职责。
2. `index.js` 里 import，`setupXxx({...})` 放到 setup 区，`initXxx()` 放到 init 区。
3. `node tools/check-frontend-contract.mjs` 通过。
4. 如果是纯函数（不碰 DOM、不碰 Cesium），在 `src/test/frontend/` 加 `*.test.mjs`。

## 与其他脚本的接口

| 全局量 | 提供方 | 使用方 |
|---|---|---|
| `window.FootprintMemoryData` | travel-memory | memory-shelf |
| `window.Footprint2D` | footprint | travel-memory（`view-mode.js` 切到 2D 时；含旅途集地图联动） |
| `window.THREE`、`window.THREE_RoundedBoxGeometry` | `FootprintHeadProcessor` 的内联 module | memory-shelf |
| `window.FOOTPRINT_CONFIG` | 模板 `footprint.html` | 三个包都读 |

除此之外三个包互不引用。新增跨包接口时补到这张表里。
