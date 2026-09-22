import { getCesium, type CesiumViewer } from './global';
import { MARKER_SIZE, MARKER_SIZE_SELECTED } from './marker-icon';

/**
 * 标记的拾取与悬停。
 *
 * 只负责「屏幕上哪个标记被点/被悬停」，不负责打开什么卡片——那是 UI 组件的事，
 * 本模块通过回调把结果交出去。原实现把拾取和详情卡的 DOM 操作写在一起，
 * 光是取 DOM 引用就占了 20 行。
 */

export type PickedKind = 'footprint' | 'city';

export interface PickedTarget {
  kind: PickedKind;
  index: number;
}

/**
 * 悬停命中半径系数。
 *
 * **必须按屏幕距离再过滤一次**：标签文字与圆点同属一个实体，Cesium 拾取会把
 * 文字也算命中，于是光标划过文字也会弹提示并放大标记。
 * 文字距圆心的距离是 图块半径×0.42 + 间隙，这里取 0.55 留出安全余量——
 * 覆盖得到图块，够不到紧挨着的标签文字。
 */
const HIT_SLOP = 0.55;

export interface PickingCallbacks {
  onHover?: (target: PickedTarget | null) => void;
  onClick?: (target: PickedTarget | null) => void;
}

export interface PickingOptions {
  /** 返回足迹标记实体数组，用于把拾取结果映射回索引 */
  footprintEntities: () => unknown[];
  /** 返回城市标记实体数组 */
  cityEntities: () => unknown[];
}

export class MarkerPicking {
  private readonly handler: { destroy(): void; setInputAction: Function; removeInputAction: Function };
  private hovered: PickedTarget | null = null;

  constructor(
    private readonly viewer: CesiumViewer,
    private readonly options: PickingOptions,
    private readonly callbacks: PickingCallbacks = {}
  ) {
    const Cesium = getCesium();
    this.handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    this.handler.setInputAction(
      (movement: { endPosition: { x: number; y: number } }) => {
        const target = this.pickAt(movement.endPosition);
        if (this.sameTarget(target, this.hovered)) return;
        this.hovered = target;
        this.callbacks.onHover?.(target);
      },
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );

    this.handler.setInputAction(
      (movement: { position: { x: number; y: number } }) => {
        this.callbacks.onClick?.(this.pickAt(movement.position));
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );
  }

  destroy(): void {
    this.handler.destroy();
  }

  private sameTarget(a: PickedTarget | null, b: PickedTarget | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.kind === b.kind && a.index === b.index;
  }

  /**
   * 拾取并按屏幕距离过滤。
   *
   * 两步：先用 Cesium 的 pick 找到实体，再确认命中点确实落在圆点范围内
   * 而非标签文字上。
   */
  private pickAt(position: { x: number; y: number }): PickedTarget | null {
    const Cesium = getCesium();
    const picked = this.viewer.scene.pick(position);
    if (!picked || !picked.id) return null;

    const footprints = this.options.footprintEntities();
    const cities = this.options.cityEntities();

    let target: PickedTarget | null = null;
    const fi = footprints.indexOf(picked.id);
    if (fi >= 0) {
      target = { kind: 'footprint', index: fi };
    } else {
      const ci = cities.indexOf(picked.id);
      if (ci >= 0) target = { kind: 'city', index: ci };
    }
    if (!target) return null;

    // 把实体位置投影回屏幕，确认命中点在圆点半径内
    const entity = (target.kind === 'footprint' ? footprints : cities)[target.index] as {
      position?: { getValue(t: unknown): unknown };
    };
    const world = entity.position?.getValue(this.viewer.clock.currentTime);
    if (!world) return target; // 拿不到位置时不过滤，宁可多响应也别漏点

    const screen = Cesium.SceneTransforms.worldToWindowCoordinates(this.viewer.scene, world);
    if (!screen) return target;

    const dx = position.x - screen.x;
    const dy = position.y - screen.y;
    const radius = MARKER_SIZE * HIT_SLOP;
    return dx * dx + dy * dy <= radius * radius ? target : null;
  }
}

/** 标记的选中态尺寸与透明度。未选中的标记压暗，突出被选中的那个。 */
export function applyMarkerSelection(
  entities: Array<{ billboard: { width: number; height: number; color: unknown } }>,
  selectedIndex: number
): void {
  const Cesium = getCesium();
  entities.forEach((ent, i) => {
    const selected = i === selectedIndex;
    ent.billboard.width = selected ? MARKER_SIZE_SELECTED : MARKER_SIZE;
    ent.billboard.height = selected ? MARKER_SIZE_SELECTED : MARKER_SIZE;
    ent.billboard.color = selected ? Cesium.Color.WHITE : Cesium.Color.WHITE.withAlpha(0.42);
  });
}
