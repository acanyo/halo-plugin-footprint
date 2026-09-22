/**
 * 卡片封面加载队列。
 *
 * 迁移自 travel-memory.js「卡片封面」一节。原设计的三条约束都保留：
 *
 * 1. **并发限流**（同时 3 张）。封面走 new Image() 预加载，不和底图瓦片抢带宽——
 *    卡片墙一次可能有几十张封面，全部并发会让地图瓦片迟到，观感上就是「地图卡住」。
 * 2. **失败静默重试一次**（延迟 3 秒）。仍失败就停在首字占位，小卡片不放重试按钮。
 * 3. **失败结论只记一分钟**。过一会儿再打开还会重新试，避免一次网络抖动让封面
 *    在整个会话里永久缺失。
 *
 * 首字占位常驻做底、图片成功后淡入盖上去，是组件侧的事，这里只管加载。
 */

const CONCURRENCY = 3;
const RETRY_DELAY_MS = 3000;
const FAIL_TTL_MS = 60_000;

interface Result {
  ok: boolean;
  at: number;
}

type Loader = (url: string) => Promise<boolean>;

/** 默认加载器：用 Image 预热浏览器缓存 */
const defaultLoader: Loader = (url) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

export class CoverLoader {
  private readonly results = new Map<string, Result>();
  private readonly retried = new Set<string>();
  private readonly queue: Array<{ url: string; resolve: (ok: boolean) => void }> = [];
  private running = 0;

  constructor(
    private readonly loader: Loader = defaultLoader,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** 查缓存。命中成功结论直接返回；失败结论超过 TTL 视为未知。 */
  private cached(url: string): boolean | null {
    const hit = this.results.get(url);
    if (!hit) return null;
    if (hit.ok) return true;
    return this.now() - hit.at > FAIL_TTL_MS ? null : false;
  }

  /**
   * 请求加载一张封面。
   * @returns 是否加载成功
   */
  load(url: string): Promise<boolean> {
    if (!url) return Promise.resolve(false);

    const hit = this.cached(url);
    if (hit !== null) return Promise.resolve(hit);

    return new Promise<boolean>((resolve) => {
      this.queue.push({ url, resolve });
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.queue.length) {
      const task = this.queue.shift()!;
      this.running++;
      void this.run(task.url).then((ok) => {
        this.running--;
        task.resolve(ok);
        this.pump();
      });
    }
  }

  private async run(url: string): Promise<boolean> {
    const ok = await this.loader(url);
    if (ok) {
      this.results.set(url, { ok: true, at: this.now() });
      this.retried.delete(url);
      return true;
    }

    // 第一次失败：延迟后静默重试一次
    if (!this.retried.has(url)) {
      this.retried.add(url);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      const retryOk = await this.loader(url);
      if (retryOk) {
        this.results.set(url, { ok: true, at: this.now() });
        return true;
      }
    }

    this.results.set(url, { ok: false, at: this.now() });
    return false;
  }

  /** 测试与调试用 */
  get pending(): number {
    return this.queue.length + this.running;
  }
}

/** 全局共享一个实例：并发限额是针对整个页面的，不是每个卡片墙各自 3 张 */
export const coverLoader = new CoverLoader();
