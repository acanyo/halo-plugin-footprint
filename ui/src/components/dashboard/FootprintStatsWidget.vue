<script lang="ts" setup>
/**
 * 仪表盘小组件：足迹统计
 *
 * 与「足迹」管理页的统计卡**刻意分工**：管理页负责完整口径（省市清单、行政区类型、可搜索、
 * 可展开），这里只做"一眼概览" —— 主数字 + 覆盖范围 + 照片/票根/今年新增 + 最近一次足迹
 * （这几条管理页统计卡里都没有），另有省份（或城市）排行、类型分布两种视图。
 * 点整块卡片进管理页看细节。
 *
 * Halo 运行时约定（按 v2.26 控制台源码核对）：
 * - 小组件库预览：`<component preview-mode :config="defaultConfig" />`，盒子尺寸 w*100 × h*36，
 *   外层 pointer-events: none —— 所以预览态**不请求接口**，用固定示例数字。
 * - 仪表盘查看：`<component :config="item.config" />`
 * - 仪表盘编辑：`<component edit-mode :config @update:config />`，右上角悬浮的「设置 / 删除」由
 *   Halo 自己按 configFormKitSchema 渲染 —— 这里不做配置入口，也不占用右上角。
 */
import {useQuery} from "@tanstack/vue-query";
import {computed, ref} from "vue";
import {useElementSize} from "@vueuse/core";
import {footprintApiClient} from "@/api";
import type {Footprint, ProvinceStat, StatsResult} from "@/api/models";
import {summarizeFootprints, type FootprintSummary} from "./footprint-stats";
import {timeAgo} from "@/utils/date";

const props = withDefaults(
  defineProps<{
    editMode?: boolean;
    previewMode?: boolean;
    config?: Record<string, unknown>;
  }>(),
  {
    editMode: false,
    previewMode: false,
    config: undefined,
  },
);

const EMPTY_STATS: StatsResult = {
  totalFootprints: 0,
  totalProvinces: 0,
  totalCities: 0,
  provinces: [],
  cities: [],
};

// 预览数据是写死的：小组件库会一次性渲染所有小组件，不能在那里发请求
const PREVIEW_PROVINCES: ProvinceStat[] = [
  {name: "广东", adcode: "440000", count: 8, cities: ["广州", "深圳"]},
  {name: "浙江", adcode: "330000", count: 6, cities: ["杭州"]},
  {name: "江苏", adcode: "320000", count: 5, cities: ["南京"]},
  {name: "四川", adcode: "510000", count: 3, cities: ["成都"]},
  {name: "云南", adcode: "530000", count: 2, cities: ["昆明"]},
];
const PREVIEW_STATS: StatsResult = {
  totalFootprints: 42,
  totalProvinces: 16,
  totalCities: 37,
  provinces: PREVIEW_PROVINCES,
  cities: [
    {name: "广州", adcode: "440100", province: "广东", provinceAdcode: "440000", count: 5},
    {name: "杭州", adcode: "330100", province: "浙江", provinceAdcode: "330000", count: 4},
    {name: "深圳", adcode: "440300", province: "广东", provinceAdcode: "440000", count: 3},
    {name: "成都", adcode: "510100", province: "四川", provinceAdcode: "510000", count: 3},
    {name: "南京", adcode: "320100", province: "江苏", provinceAdcode: "320000", count: 2},
  ],
};
const PREVIEW_SUMMARY: FootprintSummary = {
  photos: 318,
  tickets: 24,
  thisYear: 9,
  types: [
    {name: "旅游", count: 21},
    {name: "美食", count: 9},
    {name: "住宿", count: 5},
    {name: "交通", count: 4},
    {name: "其他", count: 3},
  ],
  years: [
    {year: 2026, count: 9},
    {year: 2025, count: 18},
    {year: 2024, count: 15},
  ],
};

const title = computed(() => String(props.config?.title ?? "足迹统计"));
const view = computed(() => {
  const value = props.config?.view;
  return value === "ranking" || value === "types" || value === "years" ? value : "overview";
});
const rankBy = computed(() => (props.config?.rankBy === "city" ? "city" : "province"));
const topN = computed(() => {
  const value = Number(props.config?.topN);
  return Number.isFinite(value) ? Math.min(10, Math.max(3, Math.round(value))) : 5;
});

// 同一份数据按组件实际高度分三档：极矮只给主数字，稍高加"照片/票根/今年"，再高才铺进度条与最近一次
const bodyRef = ref<HTMLElement | null>(null);
const {height: bodyHeight} = useElementSize(bodyRef);
const minimal = computed(() => bodyHeight.value > 0 && bodyHeight.value < 132);
const compact = computed(() => bodyHeight.value > 0 && bodyHeight.value < 196);
const rankRows = computed(() => {
  const usable = Math.max(0, (bodyHeight.value || 210) - 40);
  return Math.min(topN.value, Math.max(3, Math.floor(usable / 26)));
});

// 预览态不发请求；其余情况每次挂载都取一次新数据（刚在管理页加完足迹，回仪表盘就是新的）
const enabled = computed(() => !props.previewMode);
const statsQuery = useQuery({
  queryKey: ["plugin:footprint:dashboard-stats"],
  queryFn: () => footprintApiClient.footprint.getStats(),
  enabled,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
});
const allFootprintsQuery = useQuery({
  // 全量足迹：只为了让小组件多出"照片 / 票根 / 今年 / 类型分布"这几个管理页没有的口径。
  // 个人旅行记录的量级很小（几十~几百条），一次最多翻 20 页（2000 条）就停。
  queryKey: ["plugin:footprint:dashboard-all"],
  queryFn: async () => {
    const pageSize = 100;
    const items: Footprint[] = [];
    for (let page = 1; page <= 20; page++) {
      const response = await footprintApiClient.footprint.listFootprints({
        page,
        size: pageSize,
        sort: ["spec.createTime,desc"],
      });
      items.push(...(response.items || []));
      if (!response.hasNext || (response.items || []).length < pageSize) break;
    }
    return items;
  },
  enabled,
  staleTime: 30_000,
  refetchOnMount: "always",
  refetchOnWindowFocus: false,
});

const stats = computed<StatsResult>(() => {
  if (props.previewMode) return PREVIEW_STATS;
  return statsQuery.data.value ?? EMPTY_STATS;
});
const loading = computed(() => enabled.value && statsQuery.isLoading.value);
const failed = computed(() => enabled.value && statsQuery.isError.value);
const coverage = computed(() =>
  Math.min(100, Math.round((stats.value.totalProvinces / 34) * 100)),
);

// 排行：省份或城市，两种都直接来自 stats 接口
const ranking = computed(() => {
  const source =
    rankBy.value === "city" ? stats.value.cities || [] : stats.value.provinces || [];
  const rows = [...source].sort((a, b) => b.count - a.count).slice(0, rankRows.value);
  const max = rows.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
  return rows.map((item) => ({
    ...item,
    percent: Math.max(8, Math.round((item.count / max) * 100)),
  }));
});

const summary = computed<FootprintSummary>(() => {
  if (props.previewMode) return PREVIEW_SUMMARY;
  return summarizeFootprints(allFootprintsQuery.data.value ?? []);
});
const summaryReady = computed(
  () => props.previewMode || (!allFootprintsQuery.isLoading.value && !allFootprintsQuery.isError.value),
);
const typeRows = computed(() => {
  const rows = summary.value.types.slice(0, rankRows.value);
  const max = rows.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
  return rows.map((item) => ({
    ...item,
    percent: Math.max(8, Math.round((item.count / max) * 100)),
  }));
});
const yearRows = computed(() => {
  const rows = summary.value.years.slice(0, rankRows.value);
  const max = rows.reduce((acc, item) => Math.max(acc, item.count), 0) || 1;
  return rows.map((item) => ({
    label: String(item.year),
    count: item.count,
    percent: Math.max(8, Math.round((item.count / max) * 100)),
  }));
});

const latestText = computed(() => {
  if (props.previewMode) return "上海 · 3 天前";
  const latest: Footprint | undefined = allFootprintsQuery.data.value?.[0];
  if (!latest) return "";
  const place = latest.spec.city || latest.spec.province || latest.spec.name || "";
  const when = timeAgo(latest.spec.createTime || latest.metadata.creationTimestamp);
  return [place, when].filter(Boolean).join(" · ");
});

// 整块卡片点击 → 足迹管理页。用全局注册的 RouterLink（控制台装的 vue-router 自带），
// 不再自己取 $router —— 之前那样写在点击回调里，getCurrentInstance() 拿不到实例，点了没反应。
// 编辑态（拖拽/缩放）与预览态（不可交互）不挂跳转。
const navigable = computed(() => !props.editMode && !props.previewMode);
const wrapperProps = computed(() => (navigable.value ? {to: {name: "Footprint"}} : {}));
const wrapperTag = computed(() => (navigable.value ? "RouterLink" : "div"));
</script>

<template>
  <WidgetCard>
    <template #title>
      <span class="truncate font-medium">{{ title }}</span>
    </template>

    <component
      :is="wrapperTag"
      ref="bodyRef"
      v-bind="wrapperProps"
      class="fp-widget"
      :class="{'fp-widget--clickable': navigable}"
    >
      <template v-if="loading">
        <div class="fp-widget__skeleton fp-widget__skeleton--lg"></div>
        <div class="fp-widget__skeleton"></div>
      </template>

      <template v-else-if="failed">
        <p class="fp-widget__muted">统计加载失败</p>
        <button type="button" class="fp-widget__retry" @click.stop="statsQuery.refetch()">
          重试
        </button>
      </template>

      <template v-else-if="view === 'overview'">
        <div class="fp-widget__total">
          <span class="fp-widget__total-value">{{ stats.totalFootprints }}</span>
          <span class="fp-widget__total-unit">条足迹</span>
        </div>
        <p class="fp-widget__muted">
          覆盖 {{ stats.totalProvinces }} 个省级行政区 · {{ stats.totalCities }} 个城市
        </p>
        <div v-if="!minimal" class="fp-widget__facts">
          <span class="fp-widget__fact">
            <span class="fp-widget__fact-label">照片</span>
            <span class="fp-widget__fact-value">{{ summaryReady ? summary.photos : "—" }}</span>
          </span>
          <span class="fp-widget__fact">
            <span class="fp-widget__fact-label">票根</span>
            <span class="fp-widget__fact-value">{{ summaryReady ? summary.tickets : "—" }}</span>
          </span>
          <span class="fp-widget__fact">
            <span class="fp-widget__fact-label">今年</span>
            <span class="fp-widget__fact-value">{{ summaryReady ? summary.thisYear : "—" }}</span>
          </span>
        </div>
        <div v-if="!compact" class="fp-widget__coverage">
          <div class="fp-widget__coverage-head">
            <span>全国省级行政区</span>
            <span>{{ stats.totalProvinces }} / 34</span>
          </div>
          <div
            class="fp-widget__bar"
            role="progressbar"
            :aria-valuenow="coverage"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="省级行政区覆盖率"
          >
            <div class="fp-widget__bar-fill" :style="{width: coverage + '%'}"></div>
          </div>
        </div>
        <p v-if="!compact && latestText" class="fp-widget__latest">
          最近一次：<span class="fp-widget__latest-value">{{ latestText }}</span>
        </p>
      </template>

      <template v-else-if="view === 'ranking'">
        <div v-if="ranking.length" class="fp-widget__ranks">
          <div
            v-for="item in ranking"
            :key="item.adcode || item.name"
            class="fp-widget__rank"
          >
            <span class="fp-widget__rank-name">{{ item.name }}</span>
            <span class="fp-widget__bar fp-widget__bar--grow">
              <span class="fp-widget__bar-fill" :style="{width: item.percent + '%'}"></span>
            </span>
            <span class="fp-widget__rank-count">{{ item.count }}</span>
          </div>
        </div>
        <p v-else class="fp-widget__muted">还没有足迹数据</p>
      </template>

      <template v-else-if="view === 'types'">
        <div v-if="typeRows.length" class="fp-widget__ranks">
          <div v-for="item in typeRows" :key="item.name" class="fp-widget__rank">
            <span class="fp-widget__rank-name">{{ item.name }}</span>
            <span class="fp-widget__bar fp-widget__bar--grow">
              <span class="fp-widget__bar-fill" :style="{width: item.percent + '%'}"></span>
            </span>
            <span class="fp-widget__rank-count">{{ item.count }}</span>
          </div>
        </div>
        <p v-else class="fp-widget__muted">还没有足迹数据</p>
      </template>

      <template v-else>
        <div v-if="yearRows.length" class="fp-widget__ranks">
          <div v-for="item in yearRows" :key="item.label" class="fp-widget__rank">
            <span class="fp-widget__rank-name">{{ item.label }}</span>
            <span class="fp-widget__bar fp-widget__bar--grow">
              <span class="fp-widget__bar-fill" :style="{width: item.percent + '%'}"></span>
            </span>
            <span class="fp-widget__rank-count">{{ item.count }}</span>
          </div>
        </div>
        <p v-else class="fp-widget__muted">还没有足迹数据</p>
      </template>

      <p v-if="navigable" class="fp-widget__footer">去足迹管理 ›</p>
    </component>
  </WidgetCard>
</template>

<style scoped>
/* 小组件的关键版式走自己的 CSS：不依赖控制台那份 Tailwind 里恰好有没有某个工具类 */
.fp-widget {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  height: 100%;
  padding: 16px;
  overflow: hidden;
  /* RouterLink 渲染出来是 <a>：抹掉浏览器默认的链接样式 */
  color: inherit;
  text-decoration: none;
}
.fp-widget--clickable {
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.fp-widget--clickable:hover {
  background: #f9fafb;
}
.fp-widget__total {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.fp-widget__total-value {
  font-size: 2rem;
  line-height: 1;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #0b0e14;
  font-variant-numeric: tabular-nums;
}
.fp-widget__total-unit {
  padding-bottom: 2px;
  font-size: 12px;
  color: #6b7280;
}
.fp-widget__muted {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: #6b7280;
}
.fp-widget__coverage {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fp-widget__facts {
  display: flex;
  align-items: baseline;
  gap: 14px;
}
.fp-widget__fact {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.fp-widget__fact-label {
  font-size: 11px;
  color: #9ca3af;
}
.fp-widget__fact-value {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
}
.fp-widget__coverage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}
.fp-widget__bar {
  display: block;
  height: 8px;
  border-radius: 9999px;
  background: #f3f4f6;
  overflow: hidden;
}
.fp-widget__bar--grow {
  flex: 1 1 auto;
  min-width: 0;
}
.fp-widget__bar-fill {
  display: block;
  height: 100%;
  border-radius: 9999px;
  background: #6366f1;
  transition: width 0.3s ease;
}
.fp-widget__latest {
  margin: auto 0 0;
  font-size: 12px;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fp-widget__latest-value {
  color: #1f2937;
}
.fp-widget__ranks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fp-widget__rank {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.fp-widget__rank-name {
  width: 3.5rem;
  flex: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #4b5563;
}
.fp-widget__rank-count {
  width: 2rem;
  flex: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #6b7280;
}
.fp-widget__footer {
  margin: auto 0 0;
  text-align: right;
  font-size: 12px;
  color: #4f46e5;
}
.fp-widget__skeleton {
  height: 12px;
  width: 60%;
  border-radius: 6px;
  background: #f3f4f6;
  animation: fp-widget-pulse 1.4s ease-in-out infinite;
}
.fp-widget__skeleton--lg {
  height: 32px;
  width: 40%;
}
.fp-widget__retry {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  font-size: 12px;
  color: #4f46e5;
  cursor: pointer;
}
@keyframes fp-widget-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .fp-widget__bar-fill,
  .fp-widget--clickable {
    transition: none;
  }
  .fp-widget__skeleton {
    animation: none;
  }
}
</style>
