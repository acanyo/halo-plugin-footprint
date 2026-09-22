# AGENTS.md

## 收尾动作：改完代码必须重载插件

只要改动的是会进插件包的代码或资源（Java、`src/main/resources/static/**` 下的 JS/CSS、
`src/main/resources/templates/**`、`src/main/resources/extensions/**`、构建脚本等），
就在任务结束前执行一次：

```bash
gradlew reloadPlugin          # Windows PowerShell: .\gradlew.bat reloadPlugin
```

原因：Halo DevTools 的 `reloadPlugin` 会先跑 `processResources` / `jar` / `build`，再把插件热重载进
开发实例（默认 <http://localhost:8090>）。只跑 `processResources` 时，正在运行的实例不会真正重载，
页面拿到的仍是上一版资源。

补充说明：

- `src/main/resources/static/**` 里的 JS/CSS 没有独立构建步骤，`reloadPlugin` 会顺带完成打包与重载；
- 只改文档（`README.md` / `CHANGELOG.md` / 本文件）时不需要执行；
- 重载成功的标志是输出 `插件 足迹插件（footprint）已就绪!`；
- 重载后可以顺手确认实例已经在发新内容，例如
  `http://localhost:8090/plugins/footprint/assets/static/js/travel-memory.js`。
