<script setup lang="ts">
/**
 * 省 / 市分布卡片。
 *
 * 管理页里「省 / 市分布」按钮展开的那块：省份、城市两个 Tab，共用一份搜索词；
 * 点某一项会把它写进列表的关键字筛选。数据由父级传入（同一份 stats），
 * 这里只维护 Tab、搜索词和「当前选中项」这三个纯视图状态。
 */

import { computed, ref, watch } from "vue";
import { VCard, VEmpty, VTabbar } from "@halo-dev/components";
import type { StatsResult } from "@/api/models";

interface DistributionItem {
  key: string;
  name: string;
  count: number;
  description: string;
}

const props = defineProps<{
  stats: StatsResult;
  activeRegion: string | null;
}>();

const emit = defineEmits<{
  (e: "select", name: string): void;
}>();

const tab = ref<"province" | "city">("province");
const keyword = ref("");

// 省份展示前 5 个城市名作为副标题；城市展示所属省份
const source = computed<DistributionItem[]>(() => {
  if (props.stats) {
    return tab.value === "province"
      ? props.stats.provinces.map((p) => ({
          key: p.adcode,
          name: p.name,
          count: p.count,
          description: p.cities?.length ? p.cities.slice(0, 5).join("、") : "",
        }))
      : props.stats.cities.map((c) => ({
          key: c.adcode,
          name: c.name,
          count: c.count,
          description: c.province,
        }));
  }
  return [];
});

const items = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return source.value;
  return source.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
  );
});

// 切换 Tab 时清掉搜索词，避免搜「杭州」后切到城市 Tab 还残留筛选
watch(tab, () => {
  keyword.value = "";
});
</script>

<template>
  <VCard class="mb-4" :body-class="['!p-0']">
    <template #header>
      <div class="block w-full bg-gray-50 px-4 py-3">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <VTabbar
            v-model:active-id="tab"
            :items="[
              { id: 'province', label: `省份 ${stats.provinces.length}` },
              { id: 'city', label: `城市 ${stats.cities.length}` },
            ]"
            type="outline"
          />
          <div class="sm:w-64">
            <SearchInput v-model="keyword" placeholder="搜索省份或城市" />
          </div>
        </div>
      </div>
    </template>
    <div class="p-4">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <button
          v-for="item in items"
          :key="item.key"
          v-tooltip="'点击可筛选下方足迹列表'"
          type="button"
          class="flex items-center gap-2 rounded-base border px-3 py-2 text-left transition-all"
          :class="
            activeRegion === item.name
              ? 'border-primary bg-gray-50'
              : 'border-gray-100 hover:border-gray-300 hover:shadow-sm'
          "
          @click="emit('select', item.name)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-gray-900">{{ item.name }}</span>
            <span v-if="item.description" class="block truncate text-xs text-gray-500">
              {{ item.description }}
            </span>
          </span>
          <span class="shrink-0 text-xs tabular-nums text-gray-500">{{ item.count }}</span>
        </button>
      </div>
      <VEmpty v-if="!items.length" message="没有匹配的地区" />
    </div>
  </VCard>
</template>
