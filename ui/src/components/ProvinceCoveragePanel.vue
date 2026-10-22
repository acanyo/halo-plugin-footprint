<script setup lang="ts">
/**
 * 省份覆盖率面板。
 *
 * 管理页统计条右侧的「覆盖率」区域：一条总覆盖率进度条 + 按行政区类型的四分类细分。
 * 统计口径全部来自 utils/province-coverage.ts，这里只负责呈现，
 * 既方便单独测试口径，也让管理页模板不必再堆一段计算逻辑。
 */
import { computed } from "vue";
import type { ProvinceStat } from "@/api/models";
import {
  TOTAL_PROVINCES,
  coverageRate,
  provinceCategoryStats,
  provinceCoverageRate,
} from "@/utils/province-coverage";

const props = defineProps<{
  provinces: ProvinceStat[];
  totalProvinces: number;
}>();

const overallRate = computed(() => provinceCoverageRate(props.totalProvinces));
const categories = computed(() => provinceCategoryStats(props.provinces));
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-xs text-gray-500">省份覆盖率</span>
        <span class="text-sm font-medium tabular-nums text-gray-900">
          {{ overallRate }}%
          <span class="font-normal text-gray-400">
            ({{ totalProvinces }} / {{ TOTAL_PROVINCES }})
          </span>
        </span>
      </div>
      <div
        class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        :aria-valuenow="overallRate"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-label="省份覆盖率"
      >
        <div
          class="coverage-bar h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          :style="{ width: `${overallRate}%` }"
        />
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
      <div v-for="category in categories" :key="category.key">
        <div class="flex items-baseline justify-between gap-2">
          <dt class="truncate text-xs text-gray-500">{{ category.label }}</dt>
          <dd class="shrink-0 text-xs tabular-nums text-gray-900">
            {{ category.visited }}
            <span class="text-gray-400">/ {{ category.total }}</span>
          </dd>
        </div>
        <div
          class="mt-1 h-1 overflow-hidden rounded-full bg-gray-100"
          role="progressbar"
          :aria-valuenow="coverageRate(category.visited, category.total)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${category.label}覆盖率`"
        >
          <div
            class="coverage-bar coverage-bar--minor h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
            :style="{ width: `${coverageRate(category.visited, category.total)}%` }"
          />
        </div>
      </div>
    </dl>
  </div>
</template>

<style scoped>
/*
 * 进度条颜色用宿主的 --primary 变量，而不是 bg-primary/70 这类带透明度的工具类：
 * 控制台的 Tailwind 是预先构建的，插件里临时用到的透明度变体不一定在产物里，
 * 类名没生成就会退化成透明条。这里用 scoped 样式，行为可预期。
 */
.coverage-bar {
  background-color: var(--primary, #6366f1);
}

.coverage-bar--minor {
  opacity: 0.7;
}
</style>
