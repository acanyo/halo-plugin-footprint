/**
 * 足迹统计数据的查询。
 *
 * 管理页的统计条、覆盖率面板、省/市分布三处都读同一份 StatsResult，
 * 之前是管理页自己 fetchStats 后往下一层层传。这里收敛成一个可复用查询：
 * - 省份与城市列表按足迹数降序，调用方不用各自再排一遍；
 * - 查询失败只写控制台，不打断页面 —— 统计是辅助信息，列表才是主体。
 */

import { useQuery } from "@tanstack/vue-query";
import { footprintApiClient } from "@/api";
import type { StatsResult } from "@/api/models";

/** 全部为空，用于接口还没返回时给模板一个稳定的初始值。 */
export const EMPTY_STATS: StatsResult = {
  totalFootprints: 0,
  totalProvinces: 0,
  totalCities: 0,
  provinces: [],
  cities: [],
};

function sortByCount<T extends { count: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.count - a.count);
}

export function useFootprintStats() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["footprint-stats"],
    queryFn: async (): Promise<StatsResult> => {
      try {
        const result = await footprintApiClient.footprint.getStats();
        if (!result) return EMPTY_STATS;
        return {
          ...result,
          provinces: sortByCount(result.provinces ?? []),
          cities: sortByCount(result.cities ?? []),
        };
      } catch (error) {
        console.error("获取足迹统计失败:", error);
        return EMPTY_STATS;
      }
    },
  });

  return { stats: data, isLoading, refetch };
}
