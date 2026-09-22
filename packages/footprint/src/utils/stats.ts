import type { Footprint } from '../types/footprint';

/**
 * 足迹统计。迁移自 footprint.js 的 computeStats。
 *
 * 省级行政区按 adcode 前两位分类。这套前缀是行政区划编码的固定规则，
 * 不是随手写的魔法数字，因此保留原值并注明含义。
 */

/** 直辖市：北京 天津 上海 重庆 */
const MUNICIPALITY_PREFIXES = ['11', '12', '31', '50'];
/** 自治区：内蒙古 广西 西藏 宁夏 新疆 */
const AUTONOMOUS_PREFIXES = ['15', '45', '54', '64', '65'];
/** 特别行政区：香港 澳门 */
const SAR_PREFIXES = ['81', '82'];

export interface CategoryStat {
  label: string;
  /** 已到访数量 */
  visited: number;
  /** 该类总数 */
  total: number;
}

export interface Stats {
  total: number;
  provinces: number;
  cities: number;
  categories: CategoryStat[];
}

export function computeStats(footprints: Footprint[]): Stats {
  const provinceCodes = new Set<string>();
  const cityCodes = new Set<string>();
  let municipality = 0;
  let autonomous = 0;
  let sar = 0;
  let province = 0;

  for (const fp of footprints) {
    const code = fp.spec.provinceAdcode;
    if (code) {
      const prefix = code.substring(0, 2);
      // 只在首次见到该省时计数，同省多条足迹不重复累加
      if (!provinceCodes.has(code)) {
        provinceCodes.add(code);
        if (MUNICIPALITY_PREFIXES.includes(prefix)) municipality++;
        else if (AUTONOMOUS_PREFIXES.includes(prefix)) autonomous++;
        else if (SAR_PREFIXES.includes(prefix)) sar++;
        else province++;
      }
    }
    if (fp.spec.cityAdcode) cityCodes.add(fp.spec.cityAdcode);
  }

  return {
    total: footprints.length,
    provinces: provinceCodes.size,
    cities: cityCodes.size,
    categories: [
      { label: '直辖市', visited: municipality, total: 4 },
      { label: '自治区', visited: autonomous, total: 5 },
      { label: '特区', visited: sar, total: 2 },
      { label: '省份', visited: province, total: 23 },
    ],
  };
}
