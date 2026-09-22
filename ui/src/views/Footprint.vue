<script setup lang="ts">
import {
  VCard,
  IconRefreshLine,
  Dialog,
  VButton,
  VEmpty,
  VLoading,
  VPagination,
  VPageHeader,
  VDropdownItem,
  Toast,
  VSpace,
  IconAddCircle,
  VDropdown,
  VModal} from "@halo-dev/components";
import {useQuery, useQueryClient} from "@tanstack/vue-query";
import {computed, onMounted, ref, watch} from "vue";
import { formatDatetime } from "@/utils/date";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import { footprintApiClient } from "@/api";
import type {Footprint, Option, StatsResult} from "@/api/models";
import { FormKit } from "@formkit/vue";
defineOptions({
  name: "FootprintManagement"
});
const selectedFootprint = ref<Footprint | undefined>();
const selectedFootprints = ref<string[]>([]);
const checkedAll = ref(false);
const selectedSort = ref<string | undefined>(undefined);
const selectedFootprintType = ref<string | undefined>(undefined);
const page = ref(1);
const size = ref(20);
const keyword = ref("");
const searchText = ref("");
const total = ref(0);
const editingModal = ref(false);
const showManualInput = ref(false);
const currentFootprint = ref<Footprint | null>(null);
const manualLongitude = ref("");
const manualLatitude = ref("");

const showStatsDetail = ref(false);

// 详情 Tab 切换
const activeDetailTab = ref<'province' | 'city'>('province');

// 详情内搜索
const provinceSearchText = ref('');
const citySearchText = ref('');

// 点击筛选
const activeProvinceFilter = ref<string | null>(null);
const activeCityFilter = ref<string | null>(null);

const queryClient = useQueryClient();

watch(
  () => [
    selectedSort.value,
    selectedFootprintType.value,
    keyword.value,
  ],
  () => {
    page.value = 1;
  }
);
function handleClearFilters() {
  selectedSort.value = undefined;
  selectedFootprintType.value = undefined;
  activeProvinceFilter.value = null;
  activeCityFilter.value = null;
  keyword.value = "";
  searchText.value = "";
}

const hasFilters = computed(() => {
  return (
    selectedSort.value ||
    selectedFootprintType.value ||
    activeProvinceFilter.value ||
    activeCityFilter.value
  );
});

function onKeywordChange() {
  keyword.value = searchText.value;
  refetch();
}

function handleReset() {
  keyword.value = "";
  searchText.value = "";
  refetch();
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
    if (!data) return false;
    let hasDeletingFootprints = false;
    if (Array.isArray(data)) {
      hasDeletingFootprints = data.some((footprint: Footprint) => 
        footprint.metadata.deletionTimestamp !== undefined
      );
    }
    return hasDeletingFootprints ? 500 : false;
  },
});
const stats = ref<StatsResult | null>(null);
const fetchStats = async () => {
  try {
    const result = await footprintApiClient.footprint.getStats();
    if (result) {
      // 按数量倒序排列
      result.provinces.sort((a, b) => b.count - a.count);
      result.cities.sort((a, b) => b.count - a.count);
      stats.value = JSON.parse(JSON.stringify(result));
    }
  } catch (error) {
    console.error("获取足迹统计失败:", error);
  }
};
fetchStats();

const provinceCoverageRate = computed(() => {
  if (!stats.value) return 0;
  return Math.min(100, Math.round((stats.value.totalProvinces / 34) * 100));
});

const categoryProgressRate = (visited: number, total: number) => {
  if (!total) return 0;
  return Math.min(100, Math.round((visited / total) * 100));
};

const provinceCategoryStats = computed(() => {
  if (!stats.value) return null;
  const categoryDefs = [
    { key: 'municipality', label: '直辖市', total: 4, prefixes: ['11','12','31','50'], visited: 0 },
    { key: 'autonomous',  label: '自治区', total: 5, prefixes: ['15','45','54','64','65'], visited: 0 },
    { key: 'sar',         label: '特别行政区', total: 2, prefixes: ['81','82'], visited: 0 },
    { key: 'province',    label: '省份', total: 23, prefixes: [], visited: 0 },
  ];

  for (const p of stats.value.provinces) {
    const prefix = p.adcode?.substring(0, 2) || '';
    const cat = categoryDefs.find(
      c => c.prefixes.length > 0 && c.prefixes.includes(prefix)
    );
    if (cat) cat.visited++;
    else categoryDefs[3].visited++; // province
  }

  return categoryDefs;
  return categoryDefs;
});

// 过滤后的省份列表
const filteredProvinces = computed(() => {
  if (!stats.value) return [];
  const q = provinceSearchText.value.trim().toLowerCase();
  if (!q) return stats.value.provinces;
  return stats.value.provinces.filter(p => p.name.toLowerCase().includes(q));
});

// 过滤后的城市列表
const filteredCities = computed(() => {
  if (!stats.value) return [];
  const q = citySearchText.value.trim().toLowerCase();
  if (!q) return stats.value.cities;
  return stats.value.cities.filter(c => c.name.toLowerCase().includes(q) || c.province.toLowerCase().includes(q));
});

// 点击省份筛选表格
const handleProvinceClick = (name: string) => {
  if (activeProvinceFilter.value === name) {
    activeProvinceFilter.value = null;
    activeCityFilter.value = null;
    keyword.value = '';
    searchText.value = '';
  } else {
    activeProvinceFilter.value = name;
    activeCityFilter.value = null;
    keyword.value = name;
    searchText.value = name;
  }
  refetch();
};

// 点击城市筛选表格
const handleCityClick = (name: string) => {
  if (activeCityFilter.value === name) {
    activeCityFilter.value = null;
    activeProvinceFilter.value = null;
    keyword.value = '';
    searchText.value = '';
  } else {
    activeCityFilter.value = name;
    activeProvinceFilter.value = null;
    keyword.value = name;
    searchText.value = name;
  }
  refetch();
};
const handleCheckAllChange = (e: Event) => {
  const { checked } = e.target as HTMLInputElement;
  checkedAll.value = checked;
  if (checkedAll.value) {
    selectedFootprints.value =
      footprints.value?.map((footprint) => {
        return footprint.metadata.name;
      }) || [];
  } else {
    selectedFootprints.value.length = 0;
  }
};
const handleDeleteInBatch = async () => {
  if (selectedFootprints.value.length === 0) return;
  const names = [...selectedFootprints.value];
  Dialog.warning({
    title: "是否确认删除所选的足迹",
    description: "删除之后将无法恢复此操作不可恢复。",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprints(names);
        Toast.success("删除成功");
        selectedFootprints.value.length = 0;
        checkedAll.value = false;
        // 删除成功后延迟刷新，确保服务端数据已更新
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
  window.open('/footprints', '_blank');
};

const handleOpenCreateModal = (footprint?: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};
const onEditingModalClose = async () => {
  selectedFootprint.value = undefined;
  await refetch();
  await fetchStats();
};
const handleTypeSelect = (type: string | undefined) => {
  selectedFootprintType.value = type;
  refetch();
};
const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});
const handleUpdateLocation = (row: Footprint) => {
  showManualInput.value = true;
  currentFootprint.value = row;
};
const handleManualInput = async () => {
  if (!currentFootprint.value) return;
  
  const lng = parseFloat(manualLongitude.value);
  const lat = parseFloat(manualLatitude.value);
  
  if (isNaN(lng) || isNaN(lat)) {
    Toast.error("请输入有效的经纬度");
    return;
  }
  
  if (lng < -180 || lng > 180) {
    Toast.error("经度范围应在-180到180之间");
    return;
  }
  
  if (lat < -90 || lat > 90) {
    Toast.error("纬度范围应在-90到90之间");
    return;
  }
  
  try {
    currentFootprint.value.spec.longitude = lng;
    currentFootprint.value.spec.latitude = lat;
    
    await footprintApiClient.footprint.updateFootprint(
      currentFootprint.value.metadata.name,
      currentFootprint.value
    );
    
    Toast.success("经纬度更新成功");
    showManualInput.value = false;
    refetch();
  } catch (error) {
    console.error("更新经纬度失败:", error);
    Toast.error("更新经纬度失败");
  }
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
const handleEdit = (footprint: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
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
</script>
<template>
  <div>
    <VPageHeader title="足迹管理">
      <template #actions>
        <VButton type="primary" @click="handleOpenFrontend">
          前台地图
        </VButton>
        <VButton type="secondary" @click="editingModal = true">
          <template #icon>
            <IconAddCircle />
          </template>
          新建足迹
        </VButton>
      </template>
    </VPageHeader>
    <div class="m-0 md:m-4">
    <!-- 统计概览 -->
    <VCard v-if="stats" class="mb-4 overflow-hidden border border-gray-200 shadow-sm">
      <div class="grid grid-cols-1 md:grid-cols-3">
        <section class="relative bg-slate-50/80 p-5 sm:p-6 md:border-r md:border-gray-200">
          <div class="absolute inset-y-0 left-0 w-1 bg-indigo-500"></div>
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600">Footprint index</p>
              <h2 class="mt-2 text-lg font-semibold tracking-tight text-gray-900">足迹总览</h2>
            </div>
            <button
              type="button"
              class="inline-flex min-h-9 items-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 active:translate-y-px"
              :aria-expanded="showStatsDetail"
              aria-controls="footprint-stats-detail"
              @click="showStatsDetail = !showStatsDetail"
            >
              {{ showStatsDetail ? '收起详情' : '查看详情' }}
            </button>
          </div>
          <div class="mt-8 flex items-end gap-3">
            <span class="stats-overview-total tabular-nums font-semibold leading-none tracking-[-0.06em] text-gray-950">{{ stats.totalFootprints }}</span>
            <span class="pb-1 text-sm text-gray-500">条足迹记录</span>
          </div>
          <div class="mt-5 flex items-center gap-2 text-xs text-gray-500">
            <span class="h-2 w-2 rounded-full bg-indigo-500"></span>
            <span>覆盖 {{ stats.totalProvinces }} 个省级行政区 · {{ stats.totalCities }} 个城市</span>
          </div>
        </section>

        <section class="border-t border-gray-200 p-5 sm:p-6 md:border-t-0 md:border-r">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-gray-500">省份覆盖</p>
              <p class="mt-1 text-xs text-gray-400">全国省级行政区</p>
            </div>
            <span class="tabular-nums text-sm font-semibold text-gray-900">{{ stats.totalProvinces }} / 34</span>
          </div>
          <div class="mt-8 flex items-baseline gap-2">
            <span class="stats-overview-metric tabular-nums font-semibold tracking-tight text-gray-950">{{ provinceCoverageRate }}%</span>
            <span class="text-xs text-gray-400">覆盖率</span>
          </div>
          <div
            class="stats-progress mt-4"
            role="progressbar"
            :aria-valuenow="provinceCoverageRate"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-label="省份覆盖率"
          >
            <div
              class="stats-progress__bar"
              :style="{ '--progress-value': provinceCoverageRate + '%' }"
            ></div>
          </div>
        </section>

        <section class="border-t border-gray-200 p-5 sm:p-6 md:border-t-0">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-sm font-medium text-gray-500">已到访城市</p>
              <p class="mt-1 text-xs text-gray-400">按城市编码去重</p>
            </div>
            <span class="text-xs font-medium text-indigo-600">城市</span>
          </div>
          <div class="mt-8 flex items-baseline gap-2">
            <span class="stats-overview-metric tabular-nums font-semibold tracking-tight text-gray-950">{{ stats.totalCities }}</span>
            <span class="text-xs text-gray-400">个</span>
          </div>
          <div class="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <span class="h-2 w-2 rounded-full bg-indigo-500"></span>
            <span>每一次记录都将城市版图向外延伸</span>
          </div>
        </section>
      </div>

      <div v-if="provinceCategoryStats" class="border-t border-gray-200 px-5 py-5 sm:px-6">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-gray-700">行政区类型</p>
            <p class="mt-1 text-xs text-gray-400">按省级行政区类别统计</p>
          </div>
          <span class="text-xs text-gray-400">已覆盖 / 总数</span>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          <div v-for="cat in provinceCategoryStats" :key="cat.key" class="min-w-0">
            <div class="flex items-center justify-between gap-3 text-xs">
              <span class="truncate text-gray-500">{{ cat.label }}</span>
              <span class="tabular-nums shrink-0 font-medium text-gray-900">{{ cat.visited }} / {{ cat.total }}</span>
            </div>
            <div
              class="stats-progress stats-progress--compact mt-2"
              role="progressbar"
              :aria-valuenow="categoryProgressRate(cat.visited, cat.total)"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="cat.label + '覆盖率'"
            >
              <div
                class="stats-progress__bar"
                :style="{ '--progress-value': categoryProgressRate(cat.visited, cat.total) + '%' }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </VCard>

    <!-- 统计详情 -->
    <Transition name="fade">
    <VCard v-if="showStatsDetail && stats" id="footprint-stats-detail" class="mb-4 overflow-hidden">
        <div class="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-medium text-gray-500">统计详情</p>
            <p class="mt-1 text-xs text-gray-400">点击省份或城市可筛选下方足迹列表</p>
          </div>
          <div class="inline-flex rounded-lg bg-gray-100 p-1">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeDetailTab === 'province'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'"
              @click="activeDetailTab = 'province'"
            >
              省份详情
              <span class="ml-1 text-gray-400">{{ stats.provinces.length }}</span>
            </button>
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              :class="activeDetailTab === 'city'
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'"
              @click="activeDetailTab = 'city'"
            >
              城市详情
              <span class="ml-1 text-gray-400">{{ stats.cities.length }}</span>
            </button>
          </div>
        </div>

        <div v-show="activeDetailTab === 'province'" class="p-5">
          <input
            v-model="provinceSearchText"
            type="text"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="搜索省份..."
          />
          <div class="stats-detail-grid mt-4 gap-3">
            <div
              v-for="(province, index) in filteredProvinces"
              :key="province.adcode"
              class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors"
              :class="activeProvinceFilter === province.name
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'hover:border-gray-200 hover:bg-gray-50'"
              @click="handleProvinceClick(province.name)"
            >
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                :class="activeProvinceFilter === province.name
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-500'"
              >
                {{ index + 1 }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ province.name }}</div>
                <div v-if="province.cities && province.cities.length > 0" class="mt-0.5 truncate text-xs text-gray-400">
                  {{ province.cities.slice(0, 5).join('、') }}<template v-if="province.cities.length > 5">等</template>
                </div>
              </div>
              <span class="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {{ province.count }} 条
              </span>
            </div>
          </div>
          <VEmpty v-if="filteredProvinces.length === 0" message="无匹配省份" />
        </div>

        <div v-show="activeDetailTab === 'city'" class="p-5">
          <input
            v-model="citySearchText"
            type="text"
            class="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="搜索城市..."
          />
          <div class="stats-detail-grid mt-4 gap-3">
            <div
              v-for="(city, index) in filteredCities"
              :key="city.adcode"
              class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-3 py-2.5 transition-colors"
              :class="activeCityFilter === city.name
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'hover:border-gray-200 hover:bg-gray-50'"
              @click="handleCityClick(city.name)"
            >
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                :class="activeCityFilter === city.name
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-100 text-gray-500'"
              >
                {{ index + 1 }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ city.name }}</div>
                <div class="mt-0.5 truncate text-xs text-gray-400">{{ city.province }}</div>
              </div>
              <span class="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                {{ city.count }} 条
              </span>
            </div>
          </div>
          <VEmpty v-if="filteredCities.length === 0" message="无匹配城市" />
        </div>
      </VCard>
    </Transition>

      <VCard>
        <div class="flex justify-between bg-white py-4 px-4">
          <div class="flex flex-row items-center gap-3">
            <!-- 排序 -->
            <div class="flex flex-row items-center gap-1 text-sm text-gray-500">
              <FilterDropdown
                v-model="selectedSort"
                :items="[
                  { label: '创建时间升序', value: 'spec.createTime,asc' },
                  { label: '创建时间降序', value: 'spec.createTime,desc' },
                ]"
                label="排序"
              />
            </div>
            <!-- 类型 -->
            <div class="flex flex-row items-center gap-1 text-sm text-gray-500">
              <FilterDropdown
                v-model="selectedFootprintType"
                :items="[...footprintTypes.map(t => ({ label: t.label, value: t.value }))]"
                label="类型"
              />
            </div>
            <!-- 搜索输入框，回车搜索 -->
            <div class="flex items-center gap-1">
              <input
                v-model="searchText"
                type="text"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="搜索足迹名称/省份/城市"
                @keyup.enter="onKeywordChange"
              />
              <VButton type="secondary" size="sm" @click="handleReset">
                清空搜索
              </VButton>
            </div>
            <!-- 清空所有过滤条件 -->
<!--            <FilterCleanButton v-if="hasFilters" @click="handleClearFilters" />-->
            <!-- 详情开关 -->
            <button
              class="inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors"
              :class="showStatsDetail ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'"
              @click="showStatsDetail = !showStatsDetail"
            >
              省/市详情
            </button>
          </div>
          <div class="flex flex-row items-center gap-3">
            <!-- 批量删除按钮 -->
            <VSpace>
              <VButton
                v-if="selectedFootprints.length"
                type="danger"
                @click="handleDeleteInBatch"
              >
                删除选中
              </VButton>
            </VSpace>
            <button
              type="button"
              class="fp-refresh"
              :class="{ 'is-rolling': refreshing || isFetching }"
              :disabled="refreshing"
              aria-label="刷新足迹列表与统计"
              title="刷新"
              @click="handleRefreshAll"
            >
              <IconRefreshLine />
            </button>
          </div>
        </div>
        <div class="table-container relative min-h-[200px]">
          <Transition name="fade" mode="out-in">
            <VLoading v-if="isLoading" />
            <VEmpty v-else-if="!footprints?.length" message="暂无足迹数据" />
            <table v-else class="widefat min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3 w-10">
                <input
                  v-model="checkedAll"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  type="checkbox"
                  @change="handleCheckAllChange"
                />
              </th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹名称 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹图片 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹类型 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">省份 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">城市 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">经度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">纬度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">地址 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">创建时间 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center"> </div></th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="footprint in footprints" :key="footprint.metadata.name" class="border-b last:border-none hover:bg-gray-100">
              <td class="px-4 py-4">
                <input
                  v-model="selectedFootprints"
                  :value="footprint.metadata.name"
                  class="h-4 w-4 rounded border-gray-300 text-indigo-600"
                  name="post-checkbox"
                  type="checkbox"
                />
              </td>
              <td class="px-4 py-4">{{footprint.spec.name}}</td>
              <td class="px-4 py-4 poster">
                <img v-if="footprint.spec.image" :src="footprint.spec.image" class="h-16 w-auto object-cover rounded">
              </td>
              <td class="px-4 py-4 table-td">{{footprint.spec.footprintType}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.province || '-'}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.city || '-'}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.longitude}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.latitude}}</td>
              <td class="px-4 py-4">{{footprint.spec.address}}</td>
              <td class="px-4 py-4 table-td">{{formatDatetime(footprint.spec.createTime)}}</td>
              <td class="px-4 py-4 table-td">
                <VDropdown>
                  <button
                    type="button"
                    class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    操作
                  </button>
                  <template #popper>
                    <div class="w-36 max-h-60 overflow-auto">
                      <VDropdownItem @click="handleEdit(footprint)">
                        编辑
                      </VDropdownItem>
                      <VDropdownItem @click="handleUpdateLocation(footprint)">
                        更新经纬度
                      </VDropdownItem>
                      <VDropdownItem @click="handleGeocodeFootprint(footprint)">
                        重新解析省/市
                      </VDropdownItem>
                    </div>
                  </template>
                </VDropdown>
              </td>
            </tr>
            </tbody>
          </table>
          </Transition>
        </div>
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
  </div>
  <!-- 手动输入经纬度的对话框 -->
  <Teleport to="body">
    <VModal
      v-model:visible="showManualInput"
      :width="500"
      title="手动更新经纬度"
      :mask-closable="false"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">经度</label>
          <input
            type="number"
            v-model="manualLongitude"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入经度（-180到180）"
            step="0.000001"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">纬度</label>
          <input
            type="number"
            v-model="manualLatitude"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入纬度（-90到90）"
            step="0.000001"
          />
        </div>
      </div>
      <template #footer>
        <VSpace>
          <VButton
            type="secondary"
            @click="showManualInput = false"
          >
            取消
          </VButton>
          <VButton
            type="primary"
            @click="handleManualInput"
          >
            确定
          </VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>
  <FootprintEditingModal
    v-model:visible="editingModal"
    :footprint="selectedFootprint"
    @close="onEditingModalClose"
  >
  </FootprintEditingModal>
</template>
<style scoped lang="scss">
.widefat * {
  word-wrap: break-word;
}
.poster img {
  width: 64px;
  height: 64px;
  border-radius: 4px;
  object-fit: cover;
}
.table-td {
  white-space: nowrap;
}

/* 列表右上角的刷新按钮：原来是个 div，`rolling` 类也没有对应样式，
   点了之后数据没变化就等于零反馈。现在做成真按钮 + 旋转动画 + 完成后 Toast。 */
.fp-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #4b5563;
  cursor: pointer;
  transition: color 0.2s ease, background-color 0.2s ease;
}
.fp-refresh:hover:not(:disabled) {
  background-color: #f3f4f6;
  color: #111827;
}
.fp-refresh:focus-visible {
  outline: 2px solid #6366f1;
  outline-offset: 2px;
}
.fp-refresh:disabled {
  cursor: default;
  opacity: 0.6;
}
.fp-refresh.is-rolling svg {
  animation: fp-refresh-spin 0.9s linear infinite;
}

@keyframes fp-refresh-spin {
  to {
    transform: rotate(360deg);
  }
}

.stats-progress {
  height: 8px;
  overflow: hidden;
  border-radius: 9999px;
  background-color: #f3f4f6;
}

.stats-progress--compact {
  height: 6px;
}

.stats-progress__bar {
  width: var(--progress-value, 0%);
  height: 100%;
  border-radius: inherit;
  background-color: #6366f1;
  transition: width 300ms ease;
}

.stats-overview-total {
  font-size: 3rem;
}

.stats-overview-metric {
  font-size: 1.875rem;
}

.stats-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

@media (max-width: 639px) {
  .stats-detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 640px) {
  .stats-overview-total {
    font-size: 3.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stats-progress__bar {
    transition: none;
  }
  .fp-refresh.is-rolling svg {
    animation: none;
  }
}
</style>
