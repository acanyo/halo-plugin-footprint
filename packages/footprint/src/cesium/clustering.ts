import type { CesiumViewer } from './global';

/**
 * 城市聚合：整球视角显示城市标记，放大到城市尺度后展开为单个足迹。
 *
 * 只管「此刻该显示哪一组标记」，切换时的副作用（收起照片环、重排标签、
 * 复检漏画、重算遮挡）由调用方通过回调处理——原实现把这些全写在
 * applyMarkerMode 里，一个函数同时操心五件事。
 */

/** 相机低于此高度（米）时展开为单个足迹 */
export const CITY_EXPAND_HEIGHT = 1_500_000;

export type MarkerMode = 'city' | 'footprint';

export interface ClusteringCallbacks {
  /**
   * 模式切换时触发。调用方据此收起照片环、标记标签需重排、
   * 复检渲染结果、重算遮挡关系等。
   */
  onModeChange?: (mode: MarkerMode) => void;
}

export interface ClusteringOptions {
  cityEntities: () => Array<{ show: boolean }>;
  footprintEntities: () => Array<{ show: boolean }>;
}

export class Clustering {
  private mode: MarkerMode = 'city';
  private readonly dispose: () => void;

  constructor(
    private readonly viewer: CesiumViewer,
    private readonly options: ClusteringOptions,
    private readonly callbacks: ClusteringCallbacks = {}
  ) {
    const onMoveEnd = () => this.syncFromCamera();
    viewer.camera.moveEnd.addEventListener(onMoveEnd);
    this.dispose = () => viewer.camera.moveEnd.removeEventListener(onMoveEnd);
    // 用 reapply 而非 apply('city')：mode 初值就是 'city'，apply 会因
    // 「模式未变」直接短路，实体显隐一次都没设过，表现为城市标记与足迹标记
    // 同时显示。构造时必须无条件套用一次。
    this.reapply();
    // 再按当前相机高度校正——页面可能从保存的视角恢复，未必是整球视图
    this.syncFromCamera();
  }

  get current(): MarkerMode {
    return this.mode;
  }

  destroy(): void {
    this.dispose();
  }

  /** 按当前相机高度决定模式 */
  syncFromCamera(): void {
    const height = this.viewer.camera.positionCartographic.height;
    this.apply(height < CITY_EXPAND_HEIGHT ? 'footprint' : 'city');
  }

  apply(mode: MarkerMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    const city = mode === 'city';
    this.options.cityEntities().forEach((e) => {
      e.show = city;
    });
    this.options.footprintEntities().forEach((e) => {
      e.show = !city;
    });
    this.callbacks.onModeChange?.(mode);
  }

  /** 强制重新套用当前模式（实体重建后调用） */
  reapply(): void {
    const city = this.mode === 'city';
    this.options.cityEntities().forEach((e) => {
      e.show = city;
    });
    this.options.footprintEntities().forEach((e) => {
      e.show = !city;
    });
  }
}
