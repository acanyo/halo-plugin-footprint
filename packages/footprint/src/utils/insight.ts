import type { Footprint } from '../types/footprint';
import { haversineKm, journeyStats, sortByTime } from './distance';
import { cityKeyOf } from '../cesium/markers';

/**
 * 足迹洞察与「去年今天」的数据计算。
 *
 * 全是纯函数，与展示无关——原实现把这些算法和 DOM 渲染写在同一段 1584 行的
 * 「创意功能入口与覆盖层」里，改一条文案要在里面找半天。
 */

/** 季节划分逐字迁自原实现 */
export function seasonOf(month: number): '春' | '夏' | '秋' | '冬' {
  if (month >= 3 && month <= 5) return '春';
  if (month >= 6 && month <= 8) return '夏';
  if (month >= 9 && month <= 11) return '秋';
  return '冬';
}

/**
 * 取足迹所属月份。
 *
 * 直接截字符串而非 new Date()：ISO 串用 Date 解析会被时区推前一天，
 * 月底的足迹可能被算进上个月。
 */
export function monthOf(fp: Footprint): number {
  const m = Number(String(fp.spec.createTime ?? '').slice(5, 7));
  return m >= 1 && m <= 12 ? m : 0;
}

/**
 * 「去年今天」：历史上同月同日、且不是今年的足迹，按时间倒序。
 *
 * @param now 便于测试注入固定时间
 */
export function timeCapsuleItems(footprints: Footprint[], now = new Date()): Footprint[] {
  const md =
    String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const thisYear = now.getFullYear();

  return footprints
    .filter((fp) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(fp.spec.createTime ?? '');
      if (!m) return false;
      return Number(m[1]) < thisYear && `${m[2]}-${m[3]}` === md;
    })
    .sort((a, b) => String(b.spec.createTime).localeCompare(String(a.spec.createTime)));
}

export interface Insight {
  key: string;
  title: string;
  value: string;
  detail?: string;
}

/**
 * 生成洞察卡。
 *
 * 每条都是「有数据才出现」——没有对应素材时整条略过，而不是显示 0 或「暂无」。
 * 原实现是同样的做法：洞察是锦上添花，空洞的卡片反而降低质感。
 */
export function buildInsights(footprints: Footprint[]): Insight[] {
  if (!footprints.length) return [];
  const out: Insight[] = [];
  const stats = journeyStats(footprints);

  if (stats.totalKm > 0) {
    out.push({
      key: 'distance',
      title: '走过的距离',
      value: `${Math.round(stats.totalKm).toLocaleString('zh-CN')} km`,
      detail: `相当于绕地球 ${(stats.totalKm / 40075).toFixed(2)} 圈`,
    });
  }

  // 最常去的城市
  const cityCount = new Map<string, { name: string; n: number }>();
  for (const fp of footprints) {
    const key = cityKeyOf(fp);
    if (!key) continue;
    const hit = cityCount.get(key);
    if (hit) hit.n++;
    else cityCount.set(key, { name: fp.spec.city || key, n: 1 });
  }
  const topCity = [...cityCount.values()].sort((a, b) => b.n - a.n)[0];
  if (topCity && topCity.n > 1) {
    out.push({
      key: 'city',
      title: '去得最多的地方',
      value: topCity.name,
      detail: `${topCity.n} 次`,
    });
  }

  // 最偏爱的季节
  const seasons = new Map<string, number>();
  for (const fp of footprints) {
    const m = monthOf(fp);
    if (!m) continue;
    const s = seasonOf(m);
    seasons.set(s, (seasons.get(s) ?? 0) + 1);
  }
  const topSeason = [...seasons.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topSeason) {
    out.push({
      key: 'season',
      title: '最爱出发的季节',
      value: `${topSeason[0]}天`,
      detail: `${topSeason[1]} 次出行`,
    });
  }

  // 最远的一次跨越
  const sorted = sortByTime(footprints);
  let maxLeg = 0;
  let maxFrom = '';
  let maxTo = '';
  for (let i = 1; i < sorted.length; i++) {
    const km = haversineKm(
      { lat: sorted[i - 1].spec.latitude, lng: sorted[i - 1].spec.longitude },
      { lat: sorted[i].spec.latitude, lng: sorted[i].spec.longitude }
    );
    if (km > maxLeg) {
      maxLeg = km;
      maxFrom = sorted[i - 1].spec.city || sorted[i - 1].spec.name;
      maxTo = sorted[i].spec.city || sorted[i].spec.name;
    }
  }
  if (maxLeg > 0) {
    out.push({
      key: 'leg',
      title: '最远的一次跨越',
      value: `${Math.round(maxLeg).toLocaleString('zh-CN')} km`,
      detail: `${maxFrom} → ${maxTo}`,
    });
  }

  if (stats.spanDays > 0) {
    out.push({
      key: 'span',
      title: '时间跨度',
      value: `${stats.spanDays} 天`,
      detail: `${stats.stops} 条足迹`,
    });
  }

  return out;
}
