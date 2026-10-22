/**
 * 省级行政区覆盖率统计。
 *
 * 管理页的「省份覆盖率」进度条与「行政区类型」四分类都依赖同一套划分口径，
 * 而且这套口径需要能被单独测试，所以从视图里抽出来：
 * - 直辖市 4 个：北京 11 / 天津 12 / 上海 31 / 重庆 50
 * - 自治区 5 个：内蒙古 15 / 广西 45 / 西藏 54 / 宁夏 64 / 新疆 65
 * - 特别行政区 2 个：香港 81 / 澳门 82
 * - 其余计入省份（含台湾 71），共 23 个
 *
 * 划分依据是省市县行政区划代码的前两位，而不是省份名称：
 * 名称可能带「省 / 市 / 自治区」后缀，adcode 才是稳定标识。
 */

import type { ProvinceStat } from "@/api/models";

/** 全国省级行政区总数（含港澳台）。 */
export const TOTAL_PROVINCES = 34;

export interface ProvinceCategory {
  key: string;
  label: string;
  /** 该类别下全国共有的省级行政区数量。 */
  total: number;
  /** 已到访的数量。 */
  visited: number;
}

interface CategoryDefinition {
  key: string;
  label: string;
  total: number;
  /** 属于该类别的 adcode 前两位；空数组表示「其余都算这一类」。 */
  prefixes: string[];
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  { key: "municipality", label: "直辖市", total: 4, prefixes: ["11", "12", "31", "50"] },
  { key: "autonomous", label: "自治区", total: 5, prefixes: ["15", "45", "54", "64", "65"] },
  { key: "sar", label: "特别行政区", total: 2, prefixes: ["81", "82"] },
  { key: "province", label: "省份", total: 23, prefixes: [] },
];

/** 把 visited/total 折算成 0-100 的整数百分比，total 为 0 时按 0 处理。 */
export function coverageRate(visited: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((visited / total) * 100));
}

/** 已到访省份数占全国 34 个省级行政区的百分比。 */
export function provinceCoverageRate(visitedProvinces: number): number {
  return coverageRate(visitedProvinces, TOTAL_PROVINCES);
}

/**
 * 按四类行政区划统计已到访数量。
 *
 * 同一省份出现多次（数据异常或重复统计）时只算一次，避免覆盖率超过 100%。
 */
export function provinceCategoryStats(provinces: ProvinceStat[]): ProvinceCategory[] {
  const stats = CATEGORY_DEFINITIONS.map(({ key, label, total, prefixes }) => ({
    key,
    label,
    total,
    prefixes,
    visited: 0,
  }));

  const seen = new Set<string>();

  for (const province of provinces) {
    const adcode = province.adcode ?? "";
    if (adcode) {
      if (seen.has(adcode)) continue;
      seen.add(adcode);
    }

    const prefix = adcode.substring(0, 2);
    const matched = stats.find(
      (category) => category.prefixes.length > 0 && category.prefixes.includes(prefix),
    );
    // 匹配不到具体类别的（含 adcode 缺失）归入「省份」兜底
    (matched ?? stats[stats.length - 1]).visited++;
  }

  return stats.map(({ key, label, total, visited }) => ({ key, label, total, visited }));
}
