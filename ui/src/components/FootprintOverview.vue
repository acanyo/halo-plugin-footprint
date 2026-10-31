<script setup lang="ts">
/**
 * 统计概览：足迹 / 省级行政区 / 城市三张数字卡，加一张覆盖率卡。
 *
 * 覆盖率卡沿用原来的口径（utils/province-coverage）：一条总覆盖率 + 行政区类型四分类。
 * 「省 / 市分布」的展开由父级持有，这里只抛出切换事件。
 */
import { computed } from "vue";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiMap2Line from "~icons/ri/map-2-line";
import RiBuilding2Line from "~icons/ri/building-2-line";
import type { StatsResult } from "@/api/models";
import {
  TOTAL_PROVINCES,
  coverageRate,
  provinceCategoryStats,
  provinceCoverageRate,
} from "@/utils/province-coverage";

const props = defineProps<{
  stats: StatsResult;
  distributionOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "toggle-distribution"): void;
}>();

const overallRate = computed(() => provinceCoverageRate(props.stats.totalProvinces));
const categories = computed(() => provinceCategoryStats(props.stats.provinces));
</script>

<template>
  <section class="fp-overview" aria-label="足迹统计">
    <dl class="fp-stat">
      <dt><RiMapPinLine width="14" height="14" aria-hidden="true" />足迹</dt>
      <dd>{{ stats.totalFootprints }}</dd>
    </dl>
    <dl class="fp-stat">
      <dt><RiMap2Line width="14" height="14" aria-hidden="true" />省级行政区</dt>
      <dd>
        {{ stats.totalProvinces }}<small>/ {{ TOTAL_PROVINCES }}</small>
      </dd>
    </dl>
    <dl class="fp-stat">
      <dt><RiBuilding2Line width="14" height="14" aria-hidden="true" />城市</dt>
      <dd>{{ stats.totalCities }}</dd>
    </dl>

    <div class="fp-stat is-coverage">
      <div class="fp-coverage-head">
        <dl>
          <dt>省份覆盖率</dt>
          <dd>{{ overallRate }}<small>%</small></dd>
        </dl>
        <button
          type="button"
          class="fp-button is-small"
          :aria-pressed="distributionOpen"
          @click="emit('toggle-distribution')"
        >
          {{ distributionOpen ? "收起分布" : "省 / 市分布" }}
        </button>
      </div>
      <div
        class="fp-bar"
        role="progressbar"
        :aria-valuenow="overallRate"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="省份覆盖率"
      >
        <span :style="{ width: `${overallRate}%` }" />
      </div>
      <div class="fp-categories">
        <div v-for="category in categories" :key="category.key">
          <div class="fp-category-label">
            <span>{{ category.label }}</span>
            <span>
              {{ category.visited }}<small> / {{ category.total }}</small>
            </span>
          </div>
          <div
            class="fp-bar is-thin"
            role="progressbar"
            :aria-valuenow="coverageRate(category.visited, category.total)"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`${category.label}覆盖率`"
          >
            <span :style="{ width: `${coverageRate(category.visited, category.total)}%` }" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
