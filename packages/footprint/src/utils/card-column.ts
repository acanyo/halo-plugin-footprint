/**
 * 省份城市卡片的分列排版。
 *
 * 点省份后，该省每个有足迹的城市各出一张小卡片，分列排在屏幕左右两侧，
 * 用抛物线连回地图上对应的城市。
 *
 * 排版规则逐条迁自原实现：
 * - 卡片按城市在屏幕上的 x 坐标分到左右两列，避免连线交叉；
 * - **超过密度上限只压缩同侧间距，卡片尺寸保持不变**——同一个城市无论从
 *   省份进来还是从「全部城市」进来，都必须长得一模一样；
 * - 同侧卡片做四档阶梯缩进，避免排成一条笔直的队列；
 * - 上下留出安全区（顶部导航 + 留白）。
 */

export interface CardTarget {
  /** 城市在屏幕上的坐标，决定分到哪一列以及连线终点 */
  x: number;
  y: number;
  key: string;
}

export interface CardSlot {
  key: string;
  /** 卡片左上角 */
  left: number;
  top: number;
  side: 'left' | 'right';
  /** 连线应连到城市的哪个点 */
  target: { x: number; y: number };
}

export interface ColumnLayoutOptions {
  targets: CardTarget[];
  viewport: { width: number; height: number };
  cardWidth?: number;
  cardHeight?: number;
}

const CARD_W = 244;
const CARD_H = 96;
/** 同侧卡片最小间距，紧凑档减半 */
const GAP = 12;
/** 超过这个数量转入紧凑档（只压间距，不缩卡片） */
const DENSE_LIMIT = 6;
/** 四档阶梯缩进，避免排成笔直队列 */
const STAGGER = [0, 18, 36, 54];

/** 顶部导航 64 + 留白 */
const SAFE_TOP = 88;
const SAFE_BOTTOM = 96;

/** 离屏幕左右边缘的距离：不贴边，随视口宽度加大 */
const SIDE_INSET_MIN = 76;
const SIDE_INSET_RATIO = 0.07;

/** 窄屏不生效，与 CSS 断点一致 */
export const MIN_WIDTH = 821;

export function cardColumnsEnabled(viewportWidth: number): boolean {
  return viewportWidth >= MIN_WIDTH;
}

export function layoutCardColumns(opts: ColumnLayoutOptions): CardSlot[] {
  const { targets, viewport } = opts;
  const cardW = opts.cardWidth ?? CARD_W;
  const cardH = opts.cardHeight ?? CARD_H;
  if (!targets.length) return [];

  const inset = Math.max(SIDE_INSET_MIN, viewport.width * SIDE_INSET_RATIO);
  const midX = viewport.width / 2;

  // 按城市所在半屏分列，连线才不会横跨屏幕互相交叉
  const left = targets.filter((t) => t.x < midX).sort((a, b) => a.y - b.y);
  const right = targets.filter((t) => t.x >= midX).sort((a, b) => a.y - b.y);

  const place = (list: CardTarget[], side: 'left' | 'right'): CardSlot[] => {
    if (!list.length) return [];
    // 紧凑档只减半间距，卡片尺寸不动——同一张卡在任何入口下必须一样大
    const gap = list.length > DENSE_LIMIT ? GAP / 2 : GAP;
    const available = viewport.height - SAFE_TOP - SAFE_BOTTOM;
    const needed = list.length * cardH + (list.length - 1) * gap;
    const step = needed <= available ? cardH + gap : (available - cardH) / Math.max(list.length - 1, 1);
    const startY = SAFE_TOP + Math.max(0, (available - Math.min(needed, available)) / 2);

    return list.map((t, i) => {
      const stagger = STAGGER[i % STAGGER.length];
      const baseLeft = side === 'left' ? inset : viewport.width - inset - cardW;
      return {
        key: t.key,
        // 阶梯缩进方向朝屏幕内侧，避免卡片被推出视口
        left: side === 'left' ? baseLeft + stagger : baseLeft - stagger,
        top: Math.round(startY + i * step),
        side,
        target: { x: t.x, y: t.y },
      };
    });
  };

  return [...place(left, 'left'), ...place(right, 'right')];
}
