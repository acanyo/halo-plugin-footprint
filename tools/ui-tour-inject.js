// 仅供 tools/ui-tour.mjs 在测试浏览器里注入：拿到 Cesium 场景引用，便于脚本摆相机。不进产物。

(() => {
  // 只在测试浏览器里注入：从每帧都会调用的 Scene#render 里拿到 scene，再找到持有它的 viewer。
  // 不改被测代码。Cesium 的 Viewer 原型属性不可重定义，Scene#render 是普通方法可以包。
  const hook = () => {
    const S = window.Cesium && window.Cesium.Scene;
    if (!S || !S.prototype.render) return false;
    if (S.prototype.render.__hooked) return true;
    const orig = S.prototype.render;
    const wrapped = function (...a) {
      if (!window.__fpScene) {
        window.__fpScene = this;
        const canvas = this.canvas;
        // viewer 只需要几个字段：用一个代理对象顶上，测试脚本里统一用 __fpViewer.scene / camera / entities
        window.__fpViewer = { scene: this, camera: this.camera, get clock() { return window.__fpClock; },
          get entities() { return window.__fpEntities; }, get dataSources() { return { length: -1 }; }, canvas };
      }
      return orig.apply(this, a);
    };
    wrapped.__hooked = true;
    S.prototype.render = wrapped;
    // viewer.entities 就是 DataSourceDisplay 的默认数据源；它的 update 每帧都跑
    const D = window.Cesium.DataSourceDisplay;
    if (D && !D.prototype.update.__hooked) {
      const upd = D.prototype.update;
      const w = function (...a) { if (!window.__fpEntities && this.defaultDataSource) window.__fpEntities = this.defaultDataSource.entities; return upd.apply(this, a); };
      w.__hooked = true; D.prototype.update = w;
    }
    const K = window.Cesium.Clock;
    if (K && !K.prototype.tick.__hooked) {
      const tick = K.prototype.tick;
      const w = function (...a) { if (!window.__fpClock) window.__fpClock = this; return tick.apply(this, a); };
      w.__hooked = true; K.prototype.tick = w;
    }
    return true;
  };
  if (hook()) return;
  const id = setInterval(() => { if (hook()) clearInterval(id); }, 0);
})();
