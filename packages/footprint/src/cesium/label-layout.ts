import { FONT_PX } from './labels';

/**
 * 标签的屏幕空间避让。
 *
 * 纯几何计算，不依赖 Cesium——因此可以单独测试，这也是把它从 labels.ts
 * 拆出来的原因。输入是每个标签的屏幕坐标与文字，输出是「放在哪个候选位、
 * 或者放不下」。
 */

/** 避让时给每个标签留的余量 */
const PAD = 3;
/** 一行文字占的高度（含行距） */
const LINE_HEIGHT = 17;
/** 与视口边缘的最小距离 */
const MARGIN = 4;

/**
 * 单帧参与避让的标签上限，按离视口中心由近到远取。
 * 不封顶时，标签一多每帧的两两相交判断会成为性能瓶颈。
 */
export const MAX_LABELS = 160;

/**
 * 候选位方向：8 个方向 × 3 圈。
 * 前两圈贴着标记，第三圈兜底——同城足迹点挨得近时（窄视口尤其明显），
 * 名字宁可放得远一点，也不能整个消失：消失会让人以为「这个点没显示出来」。
 */
const SLOT_DIRS = [
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0.7, y: 1 },
  { x: -0.7, y: 1 },
  { x: 0.7, y: -1 },
  { x: -0.7, y: -1 },
] as const;

const SLOT_RINGS = [1, 1.9, 2.6] as const;

export interface LabelCandidate {
  /** 标记在屏幕上的位置 */
  x: number;
  y: number;
  text: string;
  /** 标记图块尺寸，用于计算第一圈的偏移距离 */
  markerSize: number;
}

export interface LabelPlacement {
  /** 相对标记的像素偏移；null 表示这一帧放不下，应隐藏 */
  offset: { x: number; y: number } | null;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 估算文字宽度。
 *
 * 不用 measureText：那需要 canvas 上下文，且每帧对上百个标签调用开销不低。
 * 中日韩字符按一个字号宽、其余按 0.55 倍估算，对避让判断足够。
 */
export function estimateTextWidth(text: string, fontPx = FONT_PX): number {
  let w = 0;
  for (const ch of text) {
    w += /[一-龥　-〿＀-￯]/.test(ch) ? fontPx : fontPx * 0.55;
  }
  return w;
}

function intersects(a: Rect, b: Rect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * 逐个安排标签位置。
 *
 * 调用方应先按「离视口中心的距离」排序并截断到 MAX_LABELS——越靠中心的
 * 标签越重要，应优先占位。本函数按传入顺序贪心放置。
 */
export function layoutLabels(
  candidates: LabelCandidate[],
  viewport: { width: number; height: number }
): LabelPlacement[] {
  const placed: Rect[] = [];

  return candidates.map((c) => {
    const w = estimateTextWidth(c.text);
    const halfW = w / 2 + PAD;
    const halfH = LINE_HEIGHT / 2 + PAD;
    const base = Math.round(c.markerSize * 0.42) + 4;

    for (const ring of SLOT_RINGS) {
      for (const dir of SLOT_DIRS) {
        const ox = dir.x * base * ring;
        const oy = dir.y * base * ring;
        const cx = c.x + ox;
        const cy = c.y + oy;

        const rect: Rect = {
          left: cx - halfW,
          right: cx + halfW,
          top: cy - halfH,
          bottom: cy + halfH,
        };

        // 越出视口的候选位直接跳过，省得画一半
        if (
          rect.left < MARGIN ||
          rect.top < MARGIN ||
          rect.right > viewport.width - MARGIN ||
          rect.bottom > viewport.height - MARGIN
        ) {
          continue;
        }

        if (placed.some((p) => intersects(p, rect))) continue;

        placed.push(rect);
        return { offset: { x: ox, y: oy } };
      }
    }
    // 三圈都放不下：这一帧隐藏
    return { offset: null };
  });
}
