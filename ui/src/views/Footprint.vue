<script setup lang="ts">
/**
 * 足迹管理页。
 *
 * 这个文件只负责「把几块拼起来」和页头动作。具体职责已经分出去：
 * - 列表请求与筛选条件：composables/useFootprintList
 * - 统计数据：composables/useFootprintStats
 * - 统计概览与覆盖率：components/FootprintOverview
 * - 单行视图：components/FootprintListItem
 * - 省/市分布：components/ProvinceCityDistribution
 * - 手动修正经纬度：components/ManualLocationModal
 *
 * 外观与 plugin-auth-ui / plugin-lingui 的工作台一致，样式在 styles/。
 */

import { Dialog, IconRefreshLine, Toast, VButton, VLoading, VPagination } from "@halo-dev/components";
import RiAddLine from "~icons/ri/add-line";
import RiExternalLinkLine from "~icons/ri/external-link-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import { computed, onMounted, ref } from "vue";
import { useFootprintList } from "@/composables/useFootprintList";
import { useFootprintStats } from "@/composables/useFootprintStats";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import FootprintListItem from "../components/FootprintListItem.vue";
import FootprintOverview from "../components/FootprintOverview.vue";
import ManualLocationModal from "../components/ManualLocationModal.vue";
import ProvinceCityDistribution from "../components/ProvinceCityDistribution.vue";
import { footprintApiClient } from "@/api";
import type { Footprint, Option } from "@/api/models";
import "@/styles/index.css";

defineOptions({
  name: "FootprintManagement",
});

const {
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
} = useFootprintList();

const { stats, refetch: refetchStats } = useFootprintStats();

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});

// 省/市分布里点中的地区：同时作为列表关键字与高亮依据
const activeRegion = ref<string | null>(null);
const showDistribution = ref(false);
const hasRegionFilter = computed(() => activeRegion.value !== null);

function handleRegionSelect(name: string) {
  const isActive = activeRegion.value === name;
  activeRegion.value = isActive ? null : name;
  keyword.value = isActive ? "" : name;
}

function handleClearFilters() {
  activeRegion.value = null;
  clearFilters();
}

// 列表与统计是一对：任何改动足迹的操作之后都要一起刷新
const refreshAll = async () => {
  await Promise.all([refetch(), refetchStats()]);
};

// 编辑弹窗
const selectedFootprint = ref<Footprint | undefined>();
const editingModal = ref(false);

function handleEdit(footprint?: Footprint) {
  selectedFootprint.value = footprint;
  editingModal.value = true;
}

async function onEditingModalClose() {
  selectedFootprint.value = undefined;
  await refreshAll();
}

// 批量选择与删除
const selectedFootprints = ref<string[]>([]);
const checkedAll = ref(false);

function handleCheckAllChange(e: Event) {
  const { checked } = e.target as HTMLInputElement;
  checkedAll.value = checked;
  selectedFootprints.value = checked
    ? footprints.value?.map((footprint) => footprint.metadata.name) || []
    : [];
}

function clearSelection() {
  selectedFootprints.value = [];
  checkedAll.value = false;
}

function setSelected(name: string, selected: boolean) {
  const next = new Set(selectedFootprints.value);
  if (selected) next.add(name);
  else next.delete(name);
  selectedFootprints.value = [...next];
  checkedAll.value = footprints.value?.every((f) => next.has(f.metadata.name)) ?? false;
}

async function handleDeleteInBatch() {
  if (selectedFootprints.value.length === 0) return;
  const names = [...selectedFootprints.value];
  Dialog.warning({
    title: "是否确认删除所选的足迹",
    description: "删除之后将无法恢复，此操作不可撤销。",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprints(names);
        Toast.success("删除成功");
        clearSelection();
        // 服务端为最终一致，稍等再拉一次，避免读到删除前的快照
        setTimeout(refreshAll, 300);
      } catch (e) {
        console.error("删除失败", e);
        Toast.error("删除失败");
      }
    },
  });
}

// 刷新
const refreshing = ref(false);
async function handleRefreshAll() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await refreshAll();
    Toast.success("已刷新足迹列表与统计");
  } catch (error) {
    console.error("刷新足迹列表失败:", error);
    Toast.error("刷新失败，请稍后重试");
  } finally {
    refreshing.value = false;
  }
}

// 逆地理编码
const awaitingGeocode = ref<string | null>(null);
async function handleGeocodeFootprint(footprint: Footprint) {
  try {
    awaitingGeocode.value = footprint.metadata.name;
    await footprintApiClient.footprint.geocodeFootprint(footprint.metadata.name);
    Toast.success("逆地理编码成功，省/市信息已更新");
    await refreshAll();
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = null;
  }
}

// 手动修正经纬度
const manualLocationTarget = ref<Footprint | null>(null);
const manualLocationVisible = ref(false);

function handleUpdateLocation(footprint: Footprint) {
  manualLocationTarget.value = footprint;
  manualLocationVisible.value = true;
}

async function onLocationUpdated() {
  await refetch();
}

function handleOpenFrontend() {
  window.open("/footprints", "_blank");
}
</script>

<template>
  <div class="fp-workbench">
    <header class="fp-app-header">
      <div class="fp-brand">
        <span class="fp-brand-mark" aria-hidden="true">
          <RiMapPinLine width="19" height="19" />
        </span>
        <h1>足迹</h1>
        <span class="fp-brand-divider" aria-hidden="true">/</span>
        <span class="fp-brand-caption">去过的地方 · 照片 · 票根</span>
      </div>
      <div class="fp-header-actions">
        <button
          type="button"
          class="fp-text-button"
          title="在新窗口打开前台足迹页"
          @click="handleOpenFrontend"
        >
          <RiExternalLinkLine width="15" height="15" aria-hidden="true" /><span>前台地图</span>
        </button>
        <button type="button" class="fp-button is-primary" @click="handleEdit()">
          <RiAddLine width="15" height="15" aria-hidden="true" />新建足迹
        </button>
      </div>
    </header>

    <main class="fp-main">
      <FootprintOverview
        v-if="stats"
        :stats="stats"
        :distribution-open="showDistribution"
        @toggle-distribution="showDistribution = !showDistribution"
      />

      <ProvinceCityDistribution
        v-if="stats && showDistribution"
        :stats="stats"
        :active-region="activeRegion"
        @select="handleRegionSelect"
      />

      <section aria-labelledby="fp-list-title">
        <header class="fp-section-header">
          <h2 id="fp-list-title">
            全部足迹<span class="fp-count">{{ total }}</span>
          </h2>
        </header>

        <div class="fp-panel">
          <div class="fp-toolbar">
            <div class="fp-toolbar-main">
              <input
                v-model="checkedAll"
                type="checkbox"
                aria-label="全选本页"
                :disabled="!footprints?.length"
                @change="handleCheckAllChange"
              />
              <div v-if="selectedFootprints.length" class="fp-selection">
                <span>已选 {{ selectedFootprints.length }} 项</span>
                <VButton size="sm" type="danger" @click="handleDeleteInBatch">删除</VButton>
                <VButton size="sm" @click="clearSelection">取消</VButton>
              </div>
              <SearchInput v-else v-model="keyword" placeholder="搜索名称、地址或省市" />
            </div>
            <div class="fp-toolbar-filters">
              <FilterCleanButton v-if="hasFilters || hasRegionFilter" @click="handleClearFilters" />
              <FilterDropdown
                v-model="footprintType"
                label="类型"
                :items="[
                  { label: '全部' },
                  ...footprintTypes.map((t) => ({ label: t.label, value: t.value })),
                ]"
              />
              <FilterDropdown
                v-model="sort"
                label="排序"
                :items="[
                  { label: '默认' },
                  { label: '最近创建', value: 'spec.createTime,desc' },
                  { label: '较晚创建', value: 'spec.createTime,asc' },
                ]"
              />
              <button
                v-tooltip="'刷新'"
                type="button"
                class="fp-icon-button"
                aria-label="刷新"
                @click="handleRefreshAll"
              >
                <IconRefreshLine
                  :class="{ 'animate-spin': refreshing || isFetching }"
                  width="16"
                  height="16"
                />
              </button>
            </div>
          </div>

          <VLoading v-if="isLoading" />
          <div v-else-if="!footprints?.length" class="fp-state" role="status">
            <RiMapPinLine width="28" height="28" aria-hidden="true" />
            <h3>{{ hasFilters || hasRegionFilter ? "没有符合条件的足迹" : "还没有足迹" }}</h3>
            <p>
              {{
                hasFilters || hasRegionFilter
                  ? "换个关键字或清除筛选条件试试。"
                  : "新建第一条足迹，它会出现在前台的地图和地球上。"
              }}
            </p>
            <div class="fp-state-actions">
              <button
                v-if="hasFilters || hasRegionFilter"
                type="button"
                class="fp-button"
                @click="handleClearFilters"
              >
                清除筛选
              </button>
              <button v-else type="button" class="fp-button is-primary" @click="handleEdit()">
                <RiAddLine width="15" height="15" aria-hidden="true" />新建足迹
              </button>
            </div>
          </div>
          <ul v-else class="fp-rows">
            <FootprintListItem
              v-for="footprint in footprints"
              :key="footprint.metadata.name"
              :footprint="footprint"
              :selected="selectedFootprints.includes(footprint.metadata.name)"
              :geocoding="awaitingGeocode === footprint.metadata.name"
              @update:selected="setSelected(footprint.metadata.name, $event)"
              @edit="handleEdit"
              @update-location="handleUpdateLocation"
              @geocode="handleGeocodeFootprint"
            />
          </ul>

          <div v-if="total > 0" class="fp-panel-footer">
            <VPagination
              v-model:page="page"
              v-model:size="size"
              :total="total"
              :size-options="[20, 30, 50, 100]"
            />
          </div>
        </div>
      </section>
    </main>
  </div>

  <ManualLocationModal
    v-model:visible="manualLocationVisible"
    :footprint="manualLocationTarget"
    @updated="onLocationUpdated"
  />

  <FootprintEditingModal
    v-model:visible="editingModal"
    :footprint="selectedFootprint"
    @close="onEditingModalClose"
  />
</template>
