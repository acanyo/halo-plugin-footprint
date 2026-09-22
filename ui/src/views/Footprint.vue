<script setup lang="ts">
import {
  Dialog,
  IconAddCircle,
  IconRefreshLine,
  Toast,
  VButton,
  VCard,
  VDropdownItem,
  VEmpty,
  VEntity,
  VEntityContainer,
  VEntityField,
  VLoading,
  VModal,
  VPageHeader,
  VPagination,
  VSpace,
  VStatusDot,
  VTabbar,
  VTag,
} from "@halo-dev/components";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiEarthLine from "~icons/ri/earth-line";
import RiImageLine from "~icons/ri/image-line";
import { useQuery } from "@tanstack/vue-query";
import { computed, onMounted, ref, watch } from "vue";
import { formatDatetime } from "@/utils/date";
import { parseCoordinate } from "@/utils/coordinate";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import { footprintApiClient } from "@/api";
import type { Footprint, Option, StatsResult } from "@/api/models";

defineOptions({
  name: "FootprintManagement",
});

// 全国省级行政区总数，用于计算覆盖率
const TOTAL_PROVINCES = 34;

const selectedFootprint = ref<Footprint | undefined>();
const selectedFootprints = ref<string[]>([]);
const checkedAll = ref(false);
const selectedSort = ref<string | undefined>(undefined);
const selectedFootprintType = ref<string | undefined>(undefined);
const page = ref(1);
const size = ref(20);
const keyword = ref("");
const total = ref(0);
const editingModal = ref(false);
const footprintTypes = ref<Option[]>([]);

const showDistribution = ref(false);
const distributionTab = ref("province");
const distributionKeyword = ref("");
const activeRegionFilter = ref<string | null>(null);

watch(
  () => [selectedSort.value, selectedFootprintType.value, keyword.value],
  () => {
    page.value = 1;
  },
);

const hasFilters = computed(() => {
  return !!(
    selectedSort.value ||
    selectedFootprintType.value ||
    activeRegionFilter.value ||
    keyword.value
  );
});

function handleClearFilters() {
  selectedSort.value = undefined;
  selectedFootprintType.value = undefined;
  activeRegionFilter.value = null;
  keyword.value = "";
}

const {
  data: footprints,
  isLoading,
  isFetching,
  refetch,
} = useQuery({
  queryKey: ["footprints", page, size, selectedSort, selectedFootprintType, keyword],
  queryFn: async () => {
    try {
      const response = await footprintApiClient.footprint.listFootprints({
        page: page.value,
        size: size.value,
        sort: selectedSort.value ? [selectedSort.value] : [],
        footprintType: selectedFootprintType.value,
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

const stats = ref<StatsResult | null>(null);
const fetchStats = async () => {
  try {
    const result = await footprintApiClient.footprint.getStats();
    if (result) {
      result.provinces.sort((a, b) => b.count - a.count);
      result.cities.sort((a, b) => b.count - a.count);
      stats.value = result;
    }
  } catch (error) {
    console.error("获取足迹统计失败:", error);
  }
};
fetchStats();

onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});

// 省/市分布：两个 Tab 共用一份搜索词与筛选状态，避免维护两套几乎相同的逻辑
const distributionItems = computed(() => {
  if (!stats.value) return [];
  const source =
    distributionTab.value === "province"
      ? stats.value.provinces.map((p) => ({
          key: p.adcode,
          name: p.name,
          count: p.count,
          description: p.cities?.length ? p.cities.slice(0, 5).join("、") : "",
        }))
      : stats.value.cities.map((c) => ({
          key: c.adcode,
          name: c.name,
          count: c.count,
          description: c.province,
        }));

  const q = distributionKeyword.value.trim().toLowerCase();
  if (!q) return source;
  return source.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
  );
});

const handleRegionClick = (name: string) => {
  const isActive = activeRegionFilter.value === name;
  activeRegionFilter.value = isActive ? null : name;
  keyword.value = isActive ? "" : name;
};

const handleCheckAllChange = (e: Event) => {
  const { checked } = e.target as HTMLInputElement;
  checkedAll.value = checked;
  selectedFootprints.value = checked
    ? footprints.value?.map((footprint) => footprint.metadata.name) || []
    : [];
};

const handleDeleteInBatch = async () => {
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
        setTimeout(async () => {
          await refetch();
          await fetchStats();
        }, 300);
      } catch (e) {
        console.error("删除失败", e);
        Toast.error("删除失败");
      }
    },
  });
};

const handleOpenFrontend = () => {
  window.open("/footprints", "_blank");
};

const handleEdit = (footprint?: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};

const onEditingModalClose = async () => {
  selectedFootprint.value = undefined;
  await refetch();
  await fetchStats();
};

const refreshing = ref(false);
const handleRefreshAll = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await refetch();
    await fetchStats();
    Toast.success("已刷新足迹列表与统计");
  } catch (error) {
    console.error("刷新足迹列表失败:", error);
    Toast.error("刷新失败，请稍后重试");
  } finally {
    refreshing.value = false;
  }
};

const awaitingGeocode = ref<string | null>(null);
const handleGeocodeFootprint = async (footprint: Footprint) => {
  try {
    awaitingGeocode.value = footprint.metadata.name;
    await footprintApiClient.footprint.geocodeFootprint(footprint.metadata.name);
    Toast.success("逆地理编码成功，省/市信息已更新");
    await refetch();
    await fetchStats();
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = null;
  }
};

// 手动修正经纬度
const showManualInput = ref(false);
const currentFootprint = ref<Footprint | null>(null);
const manualLongitude = ref("");
const manualLatitude = ref("");

const handleUpdateLocation = (footprint: Footprint) => {
  currentFootprint.value = footprint;
  manualLongitude.value = String(footprint.spec.longitude ?? "");
  manualLatitude.value = String(footprint.spec.latitude ?? "");
  showManualInput.value = true;
};

const handleManualInput = async () => {
  if (!currentFootprint.value) return;

  const result = parseCoordinate(manualLongitude.value, manualLatitude.value);
  if (!result.ok) {
    Toast.error(result.message);
    return;
  }

  try {
    currentFootprint.value.spec.longitude = result.longitude;
    currentFootprint.value.spec.latitude = result.latitude;
    await footprintApiClient.footprint.updateFootprint(
      currentFootprint.value.metadata.name,
      currentFootprint.value,
    );
    Toast.success("经纬度更新成功");
    showManualInput.value = false;
    await refetch();
  } catch (error) {
    console.error("更新经纬度失败:", error);
    Toast.error("更新经纬度失败");
  }
};
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
      class="mb-4 flex flex-col gap-3 rounded-lg border border-gray-200 bg-white/90 p-3 shadow-sm md:flex-row md:items-center md:justify-between"
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
      <VSpace>
        <VButton size="sm" @click="showDistribution = !showDistribution">
          {{ showDistribution ? "收起分布" : "省 / 市分布" }}
        </VButton>
      </VSpace>
    </div>

    <VCard v-if="stats && showDistribution" class="mb-4" :body-class="['!p-0']">
      <template #header>
        <div class="block w-full bg-gray-50 px-4 py-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <VTabbar
              v-model:active-id="distributionTab"
              :items="[
                { id: 'province', label: `省份 ${stats.provinces.length}` },
                { id: 'city', label: `城市 ${stats.cities.length}` },
              ]"
              type="outline"
            />
            <div class="sm:w-64">
              <SearchInput v-model="distributionKeyword" placeholder="搜索省份或城市" />
            </div>
          </div>
        </div>
      </template>
      <div class="p-4">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <button
            v-for="item in distributionItems"
            :key="item.key"
            v-tooltip="'点击可筛选下方足迹列表'"
            type="button"
            class="flex items-center gap-2 rounded-base border px-3 py-2 text-left transition-all"
            :class="
              activeRegionFilter === item.name
                ? 'border-primary bg-gray-50'
                : 'border-gray-100 hover:border-gray-300 hover:shadow-sm'
            "
            @click="handleRegionClick(item.name)"
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
        <VEmpty v-if="!distributionItems.length" message="没有匹配的地区" />
      </div>
    </VCard>

    <VCard :body-class="['!p-0']">
      <template #header>
        <div class="block w-full bg-gray-50 px-4 py-3">
          <div
            class="relative flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center"
          >
            <div class="hidden items-center sm:flex">
              <input
                v-model="checkedAll"
                type="checkbox"
                @change="handleCheckAllChange"
              />
            </div>
            <div class="flex w-full flex-1 items-center sm:w-auto">
              <SearchInput v-if="!selectedFootprints.length" v-model="keyword" />
              <VSpace v-else>
                <VButton type="danger" @click="handleDeleteInBatch">删除选中</VButton>
                <VButton @click="selectedFootprints = []">取消选择</VButton>
              </VSpace>
            </div>
            <VSpace spacing="lg" class="flex-wrap">
              <FilterCleanButton v-if="hasFilters" @click="handleClearFilters" />
              <FilterDropdown
                v-model="selectedFootprintType"
                label="类型"
                :items="[
                  { label: '全部' },
                  ...footprintTypes.map((t) => ({ label: t.label, value: t.value })),
                ]"
              />
              <FilterDropdown
                v-model="selectedSort"
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
          <VEntity
            v-for="footprint in footprints"
            :key="footprint.metadata.name"
            :is-selected="selectedFootprints.includes(footprint.metadata.name)"
          >
            <template #checkbox>
              <input
                v-model="selectedFootprints"
                :value="footprint.metadata.name"
                type="checkbox"
              />
            </template>
            <template #start>
              <VEntityField>
                <template #description>
                  <div class="h-10 w-10 overflow-hidden rounded border bg-white p-1">
                    <img
                      v-if="footprint.spec.image"
                      :src="footprint.spec.image"
                      class="h-full w-full rounded-sm object-cover"
                      alt=""
                    />
                    <RiImageLine v-else class="h-full w-full text-gray-300" />
                  </div>
                </template>
              </VEntityField>
              <VEntityField :title="footprint.spec.name">
                <template #description>
                  <VSpace class="flex-wrap">
                    <span class="text-xs text-gray-500">{{ footprint.spec.address }}</span>
                    <VTag v-if="footprint.spec.footprintType">
                      {{ footprint.spec.footprintType }}
                    </VTag>
                  </VSpace>
                </template>
              </VEntityField>
            </template>
            <template #end>
              <VEntityField v-if="footprint.metadata.deletionTimestamp">
                <template #description>
                  <VStatusDot v-tooltip="'删除中'" state="warning" animate />
                </template>
              </VEntityField>
              <VEntityField>
                <template #description>
                  <span
                    class="text-xs"
                    :class="footprint.spec.province ? 'text-gray-500' : 'text-gray-300'"
                  >
                    {{
                      [footprint.spec.province, footprint.spec.city].filter(Boolean).join(" · ")
                        || "省 / 市未解析"
                    }}
                  </span>
                </template>
              </VEntityField>
              <VEntityField>
                <template #description>
                  <span class="truncate text-xs tabular-nums text-gray-500">
                    {{ footprint.spec.longitude }}, {{ footprint.spec.latitude }}
                  </span>
                </template>
              </VEntityField>
              <VEntityField>
                <template #description>
                  <span class="truncate text-xs tabular-nums text-gray-500">
                    {{ formatDatetime(footprint.spec.createTime) }}
                  </span>
                </template>
              </VEntityField>
            </template>
            <template #dropdownItems>
              <VDropdownItem @click="handleEdit(footprint)">编辑</VDropdownItem>
              <VDropdownItem @click="handleUpdateLocation(footprint)">
                手动修正经纬度
              </VDropdownItem>
              <VDropdownItem
                :disabled="awaitingGeocode === footprint.metadata.name"
                @click="handleGeocodeFootprint(footprint)"
              >
                重新解析省/市
              </VDropdownItem>
            </template>
          </VEntity>
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

  <!-- 需要 Teleport：VModal 自身不做传送，直接内联会被列表容器的层叠上下文裁剪 -->
  <Teleport to="body">
    <VModal
      v-model:visible="showManualInput"
      :width="500"
      title="手动修正经纬度"
      :mask-closable="false"
    >
    <FormKit type="form" :actions="false" @submit.prevent>
      <FormKit
        v-model="manualLongitude"
        name="longitude"
        label="经度"
        type="number"
        step="0.000001"
        validation="required|between:-180,180"
        help="取值范围 -180 到 180"
      />
      <FormKit
        v-model="manualLatitude"
        name="latitude"
        label="纬度"
        type="number"
        step="0.000001"
        validation="required|between:-90,90"
        help="取值范围 -90 到 90"
      />
    </FormKit>
      <template #footer>
        <VSpace>
          <VButton type="secondary" @click="showManualInput = false">取消</VButton>
          <VButton type="primary" @click="handleManualInput">确定</VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>

  <FootprintEditingModal
    v-model:visible="editingModal"
    :footprint="selectedFootprint"
    @close="onEditingModalClose"
  />
</template>
