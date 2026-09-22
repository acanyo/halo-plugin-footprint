import { getCesium, type CesiumViewer } from './global';
import { isPointOnGlobe, isScene3D } from './camera';

/**
 * 地球自动旋转。
 *
 * 状态分两层，这是原实现想清楚了的设计，迁移时完整保留——合并成一个布尔值会
 * 直接引出「打开卡片就永久关掉」「切回 3D 又自己转起来」这类不一致：
 *
 * - `pref`：**用户偏好**。只由用户动作（点按钮 / 拖动地球）改变，写 localStorage。
 * - `pauses`：**临时暂停原因**集合（卡片、票根页、2D、入场动画…）。
 *   对应状态退出即自动恢复，同一原因重复调用是幂等的。
 *
 * 「此刻是否真的在转」= pref 成立 且 pauses 为空，只由 refresh() 推导，不单独存。
 */

const STORAGE_KEY = 'travelMemoryAutoRotate';

/** 拖动判定阈值（像素）。单纯点击不应取消自动旋转。 */
const DRAG_THRESHOLD_PX = 5;

/** 悬停检测节流间隔（毫秒），约 16 次/秒 */
const HOVER_CHECK_INTERVAL = 60;

/** 旋转速度（度/秒） */
const ROTATE_DEGREES_PER_SECOND = 2;

/**
 * 单帧时间差上限（秒）。
 * 标签页切后台再切回来时 performance.now() 的差值会非常大，不封顶会让地球
 * 一帧转过去一大截，看起来像瞬移。
 */
const MAX_DELTA_SECONDS = 0.2;

export interface AutoRotateOptions {
  /** 状态变化时回调，用于同步按钮的高亮与 aria-pressed */
  onChange?: (state: { enabled: boolean; spinning: boolean }) => void;
}

function readPref(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // 默认开启：首次访问跟随入场动画
    return saved === null ? true : saved === '1';
  } catch {
    return true;
  }
}

function writePref(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 隐私模式下不可用，记不住偏好不影响功能
  }
}

export class AutoRotate {
  private pref = readPref();
  private readonly pauses = new Set<string>();
  private spinning = false;

  /** 系统「减弱动效」偏好。开启时完全不转，且按钮点击无效。 */
  private readonly reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * Cesium 1.120 的 Clock 没有 deltaTime（旧版本才有），直接读会得到 NaN 并卡死
   * 页面。这里用 performance.now() 自己算真实时间差。
   */
  private lastTick: number | null = null;

  private hoverPaused = false;
  private lastHoverCheck = 0;
  private dragActive = false;
  private dragStartX = 0;
  private dragStartY = 0;

  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly viewer: CesiumViewer,
    private readonly options: AutoRotateOptions = {}
  ) {
    this.bindInteractions();
    this.viewer.clock.onTick.addEventListener(this.tick);
    this.disposers.push(() => this.viewer.clock.onTick.removeEventListener(this.tick));
    this.refresh();
  }

  /** 用户偏好是否允许旋转（供按钮高亮使用，与「此刻是否在转」不同） */
  get enabled(): boolean {
    return this.pref && !this.reduceMotion;
  }

  /** 用户动作：切换偏好。即使此刻正被临时暂停，按钮也该如实反映设置本身。 */
  setPreference(on: boolean): void {
    if (this.reduceMotion) return;
    this.pref = on;
    writePref(on);
    this.refresh();
  }

  toggle(): void {
    this.setPreference(!this.pref);
  }

  pause(reason: string): void {
    if (this.pauses.has(reason)) return;
    this.pauses.add(reason);
    this.refresh();
  }

  resume(reason: string): void {
    if (!this.pauses.delete(reason)) return;
    this.refresh();
  }

  destroy(): void {
    this.disposers.forEach((fn) => fn());
    this.disposers.length = 0;
  }

  private refresh(): void {
    const want = this.enabled && this.pauses.size === 0;
    if (want !== this.spinning) {
      this.spinning = want;
      // 状态切换后从零计步，避免累积的时间差导致镜头瞬移
      this.lastTick = null;
    }
    this.options.onChange?.({ enabled: this.enabled, spinning: this.spinning });
  }

  private readonly tick = (): void => {
    if (!this.spinning) return;
    // 只在 3D 场景旋转；2D 平面模式下转动无意义
    if (!isScene3D(this.viewer)) return;
    if (this.hoverPaused) return;

    const now = performance.now();
    const dt = this.lastTick === null ? 0 : Math.min((now - this.lastTick) / 1000, MAX_DELTA_SECONDS);
    this.lastTick = now;
    if (dt <= 0) return;

    const Cesium = getCesium();
    try {
      this.viewer.camera.rotate(
        Cesium.Cartesian3.UNIT_Z,
        -Cesium.Math.toRadians(ROTATE_DEGREES_PER_SECOND) * dt
      );
    } catch (e) {
      // 相机在某些极端姿态下 rotate 会抛错，吞掉即可，不能让它中断整个 tick 循环
      console.error('[footprint] 自动旋转出错：', e);
    }
  };

  private bindInteractions(): void {
    const canvas: HTMLCanvasElement = this.viewer.scene.canvas;

    const onPointerDown = (e: PointerEvent) => {
      this.dragActive = true;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
    };
    const onPointerUp = () => {
      this.dragActive = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!this.dragActive || !this.spinning) return;
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        this.dragActive = false;
        // 拖动后取消自动旋转，需手动再开——这是用户动作，改的是偏好
        this.setPreference(false);
      }
    };

    // 悬停在地球表面时暂停，移开（星空/空白/控件上方）即恢复
    const onHoverMove = (e: PointerEvent) => {
      if (!this.spinning || !isScene3D(this.viewer)) {
        this.hoverPaused = false;
        return;
      }
      const now = performance.now();
      if (now - this.lastHoverCheck < HOVER_CHECK_INTERVAL) return;
      this.lastHoverCheck = now;
      const rect = canvas.getBoundingClientRect();
      this.hoverPaused = isPointOnGlobe(this.viewer, e.clientX - rect.left, e.clientY - rect.top);
    };
    const onMouseLeave = () => {
      this.hoverPaused = false;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointermove', onHoverMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    this.disposers.push(() => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointermove', onHoverMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    });
  }
}
