<script setup lang="ts">
/**
 * 省 / 市分布卡片。
 *
 * 概览里「省 / 市分布」展开的那块：省份、城市两个分段，共用一份搜索词；
 * 点某一项会把它写进列表的关键字筛选。数据由父级传入（同一份 stats），
 * 这里只维护分段、搜索词这两个纯视图状态。
 */

import { computed, ref, watch } from "vue";
import RiSearchLine from "~icons/ri/search-line";
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
const source = computed<DistributionItem[]>(() =>
  tab.value === "province"
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
      })),
);

const items = computed(() => {
  const q = keyword.value.trim().toLowerCase();
  if (!q) return source.value;
  return source.value.filter(
    (item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
  );
});

// 切换分段时清掉搜索词，避免搜「杭州」后切到城市还残留筛选
watch(tab, () => {
  keyword.value = "";
});
</script>

<template>
  <section class="fp-distribution" aria-labelledby="fp-distribution-title">
    <header class="fp-section-header">
      <div>
        <h2 id="fp-distribution-title">省 / 市分布</h2>
        <p>点击某个地区可筛选下方的足迹列表，再点一次取消。</p>
      </div>
      <div class="fp-section-actions">
        <div class="fp-segmented" role="group" aria-label="分布维度">
          <button type="button" :aria-pressed="tab === 'province'" @click="tab = 'province'">
            省份 {{ stats.provinces.length }}
          </button>
          <button type="button" :aria-pressed="tab === 'city'" @click="tab = 'city'">
            城市 {{ stats.cities.length }}
          </button>
        </div>
        <label class="fp-search">
          <RiSearchLine width="15" height="15" aria-hidden="true" />
          <input v-model="keyword" type="search" placeholder="搜索省份或城市" />
        </label>
      </div>
    </header>

    <div v-if="items.length" class="fp-region-grid">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="fp-region"
        :aria-pressed="activeRegion === item.name"
        @click="emit('select', item.name)"
      >
        <span class="fp-region-text">
          <strong>{{ item.name }}</strong>
          <span v-if="item.description">{{ item.description }}</span>
        </span>
        <span class="fp-region-count">{{ item.count }}</span>
      </button>
    </div>
    <p v-else class="fp-muted">没有匹配的地区</p>
  </section>
</template>
