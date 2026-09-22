import { readConfig } from '../types/footprint';
import type { Footprint, FootprintConfig } from '../types/footprint';

/**
 * 全局共享状态（Svelte 5 runes）。
 *
 * 旧代码把 987 个符号摊在全局作用域里互相读写，谁改了谁全靠人脑追踪。
 * 这里只保留真正需要跨组件共享的少量状态，并且**只允许通过导出的函数修改**，
 * 组件不直接赋值——否则等于把全局变量换个地方接着用。
 *
 * 注意：本文件必须是 `.svelte.ts` 后缀，runes 才会被编译。
 */

class FootprintStore {
  /** 后台注入的配置，页面生命周期内不变 */
  readonly config: FootprintConfig = readConfig();

  /** 全部足迹 */
  footprints = $state<Footprint[]>([]);

  /** 当前选中的足迹（点击标记后设置），null 表示未选中 */
  selected = $state<Footprint | null>(null);

  /** 视图模式。持久化在 localStorage，刷新后恢复上次的选择 */
  viewMode = $state<'2d' | '3d'>('3d');

  /** 当前聚焦的城市，用于城市卡片墙与票根筛选；空串表示全部 */
  cityFilter = $state('');

  constructor() {
    this.footprints = this.config.footprints ?? [];
  }

  /** 有票根图的足迹。票根墙与护照集章都基于这个集合。 */
  get ticketFootprints(): Footprint[] {
    return this.footprints.filter((fp) => !!fp.spec.ticketImage);
  }

  /** 按城市分组。key 优先用 cityAdcode，缺失时退回城市名。 */
  get byCity(): Map<string, Footprint[]> {
    const map = new Map<string, Footprint[]>();
    for (const fp of this.footprints) {
      const key = fp.spec.cityAdcode || fp.spec.city || '';
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(fp);
      else map.set(key, [fp]);
    }
    return map;
  }

  select(fp: Footprint | null) {
    this.selected = fp;
  }

  setViewMode(mode: '2d' | '3d') {
    this.viewMode = mode;
    try {
      localStorage.setItem('footprint-view-mode', mode);
    } catch {
      // 隐私模式下 localStorage 可能抛错，记不住不影响功能
    }
  }

  restoreViewMode() {
    try {
      const saved = localStorage.getItem('footprint-view-mode');
      if (saved === '2d' || saved === '3d') this.viewMode = saved;
    } catch {
      // 同上
    }
  }

  setCityFilter(city: string) {
    this.cityFilter = city;
  }
}

export const store = new FootprintStore();
