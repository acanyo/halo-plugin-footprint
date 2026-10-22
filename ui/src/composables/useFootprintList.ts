/**
 * 足迹列表的查询状态。
 *
 * 分页、排序、类型、关键字四个筛选条件加上列表请求本身，本来都挤在管理页的
 * script 里，和「删除 / 刷新 / 逆地理编码」这些操作混在一起。这里只负责
 * 「按当前条件取一页数据」，不关心用户点的是哪个按钮：
 * - 筛选条件变化时自动回到第一页（否则会停在越界的页码上）；
 * - 删除中的条目会每 500ms 重拉一次，直到服务端把 deletionTimestamp 清掉。
 */

import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { Toast } from "@halo-dev/components";
import { footprintApiClient } from "@/api";
import type { Footprint } from "@/api/models";

export function useFootprintList() {
  const page = ref(1);
  const size = ref(20);
  const sort = ref<string | undefined>(undefined);
  const footprintType = ref<string | undefined>(undefined);
  const keyword = ref("");
  const total = ref(0);

  watch(
    () => [sort.value, footprintType.value, keyword.value],
    () => {
      page.value = 1;
    },
  );

  const {
    data: footprints,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["footprints", page, size, sort, footprintType, keyword],
    queryFn: async () => {
      try {
        const response = await footprintApiClient.footprint.listFootprints({
          page: page.value,
          size: size.value,
          sort: sort.value ? [sort.value] : [],
          footprintType: footprintType.value,
          keyword: keyword.value,
        });
        total.value = response.total;
        return response.items;
      } catch (error) {
        console.error("获取足迹列表失败:", error);
        Toast.error("获取足迹列表失败");
        return [];
      }
    },
    refetchInterval: (data) => {
      const deleting =
        Array.isArray(data) &&
        data.some((footprint: Footprint) => footprint.metadata.deletionTimestamp !== undefined);
      return deleting ? 500 : false;
    },
  });

  const hasFilters = computed(() => {
    return !!(sort.value || footprintType.value || keyword.value);
  });

  function clearFilters() {
    sort.value = undefined;
    footprintType.value = undefined;
    keyword.value = "";
  }

  return {
    page,
    size,
    sort,
    footprintType,
    keyword,
    total,
    footprints,
    isLoading,
    isFetching,
    refetch,
    hasFilters,
    clearFilters,
  };
}
