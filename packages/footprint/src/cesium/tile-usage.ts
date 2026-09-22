import type { ImageryProvider } from './global';

/**
 * 天地图瓦片用量统计。
 *
 * 天地图按 Key 计额度（个人 Key 每天约一万次），这里只做「看得见」：
 * 把当天发出的瓦片数记在 localStorage，由 UI 自行展示。
 *
 * **不要在客户端做令牌桶限速/排队/透明瓦片兜底**——那会让瓦片迟到或留空，
 * 转动地球时看起来就是「卡住」。观感远比省几次额度重要。要省量请走缓存方案。
 * 这条是原实现注释里明确写下的结论，迁移时原样保留。
 *
 * 与 UI 解耦：本模块只负责计数并通知订阅者，不直接碰任何 DOM。
 * 原实现在这里直接调 `updateStatusText()`，把数据层和展示层黏在了一起。
 */

const STORAGE_KEY = 'footprint-tile-usage';

/** 攒够这么多张才通知一次订阅者，避免每来一张瓦片就触发一次 UI 更新 */
const NOTIFY_EVERY = 25;

type Listener = (todayCount: number) => void;

const listeners = new Set<Listener>();
let sinceNotify = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 读取今日用量。跨天自动归零。 */
export function todayUsage(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return raw.date === today() ? Number(raw.count) || 0 : 0;
  } catch {
    // 隐私模式下 localStorage 不可用，用量统计属于可选功能，静默降级
    return 0;
  }
}

function increment(): void {
  try {
    const t = today();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const count = raw.date === t ? Number(raw.count) || 0 : 0;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: t, count: count + 1 }));
  } catch {
    // 同上
  }
}

/** 订阅用量变化，返回取消订阅的函数 */
export function onUsageChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function countTile(): void {
  increment();
  sinceNotify += 1;
  if (sinceNotify >= NOTIFY_EVERY) {
    sinceNotify = 0;
    const count = todayUsage();
    listeners.forEach((fn) => fn(count));
  }
}

/**
 * 给 provider 包一层计数。**只计数，不改请求节奏。**
 */
export function withUsageCounting(provider: ImageryProvider): ImageryProvider {
  const original = provider.requestImage.bind(provider);
  provider.requestImage = function (x: number, y: number, level: number, request: unknown) {
    countTile();
    return original(x, y, level, request);
  };
  return provider;
}
