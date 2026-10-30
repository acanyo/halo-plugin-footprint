# 前台视觉：柔光玻璃

参考 kunkunyu.com/footprint 的观感与动效：浅灰底、半透明白玻璃面板、大圆角柔阴影、
圆形照片标记、淡紫强调色；动效轻、快、带一点去模糊的弹出。

## 色板（`styles/shared/tokens.css`）

| 名称 | 值 | 用途 |
|---|---|---|
| `--fp-paper` | `#f2f2f4` | 页面底、全屏界面底 |
| `--fp-paper-raised` | `#ffffff` | 不透明卡片、照片底 |
| `--fp-glass` | `rgba(255,255,255,.62)` | 浮在地图 / 地球上的面板（配合 `backdrop-filter: blur(var(--fp-blur))`） |
| `--fp-glass-strong` | `rgba(255,255,255,.82)` | 需要更实一点的玻璃：菜单、下拉 |
| `--fp-ink` | `#3a3a40` | 标题、正文 |
| `--fp-ink-soft` | `#66666e` | 次要文字 |
| `--fp-ink-faint` | `#9a9aa3` | 辅助说明 |
| `--fp-rule` | `rgba(58,58,64,.08)` | 分隔、浅底按钮 |
| `--fp-accent` | `#7c7bc0` | 唯一的强调色：选中、主按钮、聚合点、「去过」 |
| `--fp-accent-soft` | `rgba(124,123,192,.14)` | 强调色的浅底 |

`--fp-mark` / `--fp-contour` / `--fp-water` 是上一版留下的角色名，现在都指向 `--fp-accent`。
新写的代码直接用 `--fp-accent`。

## 字

- `--fp-font-title`：快看世界体（插件自带 `static/font/result.css`，按字切片），用于页面标题、地名、卡片标题。
- `--fp-font-text`：MiSans / 苹方 / 微软雅黑，正文与控件。数字 `tabular-nums`。

## 形

- 面板：`--fp-glass` + `backdrop-filter: blur(var(--fp-blur))` + `--fp-shadow` + 圆角 `--fp-radius-panel`（16px），无描边。
- 照片：圆角 `--fp-radius-photo`（12px）。地图上的照片标记是圆形：白玻璃圆环 + 圆形照片。
- 按钮：胶囊（`--fp-radius-control`）。次要按钮是 `--fp-rule` 浅底无描边；主按钮是强调色实底。
- 阴影只有两档：`--fp-shadow`（常态）与 `--fp-shadow-lift`（悬停 / 弹出）。

## 动效

- 缓动统一 `--fp-ease`（`cubic-bezier(.6,.2,.25,1)`），常规时长 `--fp-dur`（300ms）。
- 弹出：透明度 + 缩放 0.92→1 + 上移 8px + 模糊 8px→0（`@keyframes fpPopIn`），卡片、菜单、浮层共用。
- 悬停：上浮 2～4px、阴影换成 `--fp-shadow-lift`；按下缩到 0.96。
- 列表 / 网格首次出现可以错峰 40ms 一项，最多 8 项；之后不再重播。
- 首屏标题与说明淡入上浮；地图 / 地球移动用飞行动画，标记打开详情时从标记处弹出。
- `prefers-reduced-motion` 时去掉位移与模糊，只保留透明度。

## 不做的事

- 不在标题上方放英文大写小标题；不用「·」拼接元信息。
- 文案平实，说事实：「62 条足迹，30 座城市」。
- 强调色只有淡紫一种；不再用红、绿、蓝、琥珀做装饰。

## 检查

`tools/check-frontend-style.mjs --strict` 挂在 `./gradlew build` 上（任务 `checkFrontendStyle`）：
英文大写小标题、「·」拼接、样式里散写的色值、旧字体栈。
允许：纯黑 rgba 的阴影（text-shadow / box-shadow）与白色半透明玻璃 `rgba(255,255,255,…)`。

canvas 与 SVG 读不到 CSS 变量，下列文件写死了同一套色值，改色板时要一起改：
`marker-icons.js`、`marker-visibility.js`、`postcard.js`、`ticket-letter.js`、
`parabola-animation.js`、`memory-shelf/modules/constants.js`（PAGE_PAPER / PAGE_EDGE）。

## 截图巡检

`node tools/ui-tour.mjs http://localhost:8092 /tmp/out` 截各主要界面；`W=390 H=844` 截手机，
`ONLY=06-citywall,08-insight` 只截指定几张。开发实例用 `./gradlew haloServer -PhaloPort=8092`。
