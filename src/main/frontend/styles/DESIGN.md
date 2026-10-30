# 前台视觉：测绘手簿

足迹页是一份个人地理记录。视觉借测绘手簿与地形图的语言：真实的坐标、日期、里程就是主角，
不靠米色纸、抒情文案、英文小标题去「营造氛围」。

## 色板

地球场景是深色太空，浮在地球上的界面用「夜图」一套；全屏翻阅的界面（城记、洞察、书架外框）
用「白图」一套。两套共用同一组色相，只换明度。

| 名称 | 夜图 | 白图 | 用途 |
|---|---|---|---|
| 纸 `--fp-paper` | `#12171c` | `#f3f4f1` | 底色 |
| 墨 `--fp-ink` | `#e9ece8` | `#1e2a33` | 标题、正文 |
| 淡墨 `--fp-ink-soft` | `#aeb6b2` | `#4d5a62` | 次要文字 |
| 弱墨 `--fp-ink-faint` | `#7b8682` | `#7d878b` | 辅助说明、坐标 |
| 格线 `--fp-rule` | `rgba(233,236,232,.14)` | `rgba(30,42,51,.14)` | 分隔线、边框 |
| 等高线 `--fp-contour` | `#8fa070` | `#6b7a4f` | 次强调：选中、进度 |
| 水系 `--fp-water` | `#7fa8c4` | `#3e6e8e` | 链接、可点的地名 |
| 标注红 `--fp-mark` | `#d65a4f` | `#b8322a` | 只用于「去过」：标记点、打卡、主按钮 |

标注红是唯一的饱和色，出现得越少越有分量。

## 字

- `--fp-font-title`：霞鹜文楷屏幕版（LXGW WenKai Screen，OFL），用于标题、地名、手簿条目。
  按 unicode-range 切片，浏览器只下载用到的字。
- `--fp-font-text`：系统黑体（PingFang SC / 微软雅黑），用于正文与控件。
- 数字一律 `font-variant-numeric: tabular-nums`，不换等宽字体。

字号阶梯（px）：12 · 13 · 15 · 18 · 24 · 34 · 56。正文行高 1.7，标题 1.25。

## 不做的事

- 不在标题上方放英文大写小标题。需要说明时用一句中文，放在标题下面。
- 不用「·」拼接元信息。两项以上分行写，或用顿号、空格。
- 不做一排一模一样的数字卡片。统计写成句子或手簿式的小表格。
- 不用卡片投影堆层次。层次靠留白和一条格线。
- 圆角只有三档：控件 6px、面板 10px、照片 2px。
- 文案平实，说事实：「62 条足迹，30 座城市」，不写「每一处坐标都是一个故事」。

## 动效

只有地球入场是一段编排好的动画。其余动效只回应操作：打开、展开、切换，时长 160～240ms。
`prefers-reduced-motion` 时全部关闭。

## 检查

`tools/check-frontend-style.mjs --strict` 挂在 `./gradlew build` 上（任务 `checkFrontendStyle`），
不过就构建失败。它拦四类问题：英文大写小标题、「·」拼接、样式里散写的色值、旧字体栈。
压在照片上的可读性暗影（纯黑 rgba 的 text-shadow / box-shadow）与单独画出的列表圆点不算。

canvas 与 SVG 读不到 CSS 变量，下列文件里写死了同一套色值，改色板时要一起改：
`marker-icons.js`、`marker-visibility.js`、`postcard.js`、`ticket-letter.js`、
`parabola-animation.js`、`memory-shelf/modules/constants.js`（PAGE_PAPER / PAGE_EDGE）。

## 截图巡检

`node tools/ui-tour.mjs http://localhost:8092 /tmp/out` 截各主要界面；`W=390 H=844` 截手机，
`ONLY=06-citywall,08-insight` 只截指定几张。开发实例用 `./gradlew haloServer -PhaloPort=8092`。
