<script setup lang="ts">
/**
 * 足迹管理页。
 *
 * 这个文件只负责「把几块拼起来」和页头动作。具体职责已经分出去：
 * - 列表请求与筛选条件：composables/useFootprintList
 * - 统计数据：composables/useFootprintStats
 * - 单行视图：components/FootprintListItem
 * - 省/市分布：components/ProvinceCityDistribution
 * - 覆盖率面板：components/ProvinceCoveragePanel
 * - 手动修正经纬度：components/ManualLocationModal
 */

import {
  Dialog,
  IconAddCircle,
  IconRefreshLine,
  Toast,
  VButton,
  VCard,
  VEmpty,
  VEntityContainer,
  VLoading,
  VPageHeader,
  VPagination,
  VSpace,
} from "@halo-dev/components";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiEarthLine from "~icons/ri/earth-line";
import { computed, onMounted, ref } from "vue";
import { TOTAL_PROVINCES } from "@/utils/province-coverage";
import { useFootprintList } from "@/composables/useFootprintList";
import { useFootprintStats } from "@/composables/useFootprintStats";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import FootprintListItem from "../components/FootprintListItem.vue";
import ManualLocationModal from "../components/ManualLocationModal.vue";
import ProvinceCityDistribution from "../components/ProvinceCityDistribution.vue";
import ProvinceCoveragePanel from "../components/ProvinceCoveragePanel.vue";
import { footprintApiClient } from "@/api";
import type { Footprint, Option } from "@/api/models";

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
        selectedFootprints.value = [];
        checkedAll.value = false;
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
  <VPageHeader title="足迹管理">
    <template #icon>
      <RiMapPinLine class="self-center" />
    </template>
    <template #actions>
      <VSpace>
        <VButton size="sm" ghost @click="handleOpenFrontend">
          <template #icon>
            <RiEarthLine class="h-full w-full" />
          </template>
          前台地图
        </VButton>
        <VButton size="sm" type="secondary" @click="handleEdit()">
          <template #icon>
            <IconAddCircle class="h-full w-full" />
          </template>
          新建足迹
        </VButton>
      </VSpace>
    </template>
  </VPageHeader>

  <div class="p-4">
    <div
      v-if="stats"
      class="mb-4 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white/90 p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between"
    >
      <dl class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div class="flex items-baseline gap-1.5">
          <dt class="text-xs text-gray-500">足迹</dt>
          <dd class="text-sm font-medium tabular-nums text-gray-900">
            {{ stats.totalFootprints }}
          </dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt class="text-xs text-gray-500">省级行政区</dt>
          <dd class="text-sm font-medium tabular-nums text-gray-900">
            {{ stats.totalProvinces }}
            <span class="font-normal text-gray-400">/ {{ TOTAL_PROVINCES }}</span>
          </dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt class="text-xs text-gray-500">城市</dt>
          <dd class="text-sm font-medium tabular-nums text-gray-900">
            {{ stats.totalCities }}
          </dd>
        </div>
      </dl>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
        <ProvinceCoveragePanel
          class="min-w-0 flex-1 lg:w-96 lg:flex-none"
          :provinces="stats.provinces"
          :total-provinces="stats.totalProvinces"
        />
        <VButton size="sm" @click="showDistribution = !showDistribution">
          {{ showDistribution ? "收起分布" : "省 / 市分布" }}
        </VButton>
      </div>
    </div>

    <ProvinceCityDistribution
      v-if="stats && showDistribution"
      :stats="stats"
      :active-region="activeRegion"
      @select="handleRegionSelect"
    />

    <VCard :body-class="['!p-0']">
      <template #header>
        <div class="block w-full bg-gray-50 px-4 py-3">
          <div
            class="relative flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center"
          >
            <div class="hidden items-center sm:flex">
              <input v-model="checkedAll" type="checkbox" @change="handleCheckAllChange" />
            </div>
            <div class="flex w-full flex-1 items-center sm:w-auto">
              <SearchInput v-if="!selectedFootprints.length" v-model="keyword" />
              <VSpace v-else>
                <VButton type="danger" @click="handleDeleteInBatch">删除选中</VButton>
                <VButton @click="selectedFootprints = []">取消选择</VButton>
              </VSpace>
            </div>
            <VSpace spacing="lg" class="flex-wrap">
              <FilterCleanButton
                v-if="hasFilters || hasRegionFilter"
                @click="handleClearFilters"
              />
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
                class="group cursor-pointer rounded p-1 hover:bg-gray-200"
                @click="handleRefreshAll"
              >
                <IconRefreshLine
                  :class="{ 'animate-spin text-gray-900': refreshing || isFetching }"
                  class="h-4 w-4 text-gray-600 group-hover:text-gray-900"
                />
              </button>
            </VSpace>
          </div>
        </div>
      </template>

      <VLoading v-if="isLoading" />
      <Transition v-else-if="!footprints?.length" appear name="fade">
        <VEmpty message="没有找到足迹，你可以尝试刷新或者新建足迹" title="暂无足迹">
          <template #actions>
            <VSpace>
              <VButton @click="handleRefreshAll">刷新</VButton>
              <VButton type="primary" @click="handleEdit()">
                <template #icon>
                  <IconAddCircle />
                </template>
                新建足迹
              </VButton>
            </VSpace>
          </template>
        </VEmpty>
      </Transition>
      <Transition v-else appear name="fade">
        <VEntityContainer>
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
        </VEntityContainer>
      </Transition>

      <template #footer>
        <VPagination
          v-model:page="page"
          v-model:size="size"
          :total="total"
          :size-options="[20, 30, 50, 100]"
        />
      </template>
    </VCard>
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
