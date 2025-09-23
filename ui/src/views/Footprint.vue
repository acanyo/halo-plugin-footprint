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
  IconCloseCircle,
  VDropdown,
  VModal} from "@halo-dev/components";
import {useQuery, useQueryClient} from "@tanstack/vue-query";
import {computed, h, onMounted, ref, watch} from "vue";
import { formatDatetime } from "@/utils/date";
import FootprintEditingModal from "../components/FootprintEditingModal.vue";
import { footprintApiClient } from "@/api";
import type {Footprint, Option} from "@/api/models";
import { FormKit } from "@formkit/vue";

// 定义组件名称
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
}

const hasFilters = computed(() => {
  return (
    selectedSort.value ||
    selectedFootprintType.value
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
  refetchInterval: (query) => {
    const data = query.state.data;
    if (!data) return false;
    const hasDeletingFootprints = data.some(
      (footprint: Footprint) => footprint?.metadata.deletionTimestamp,
    );
    return hasDeletingFootprints ? 1000 : false;
  },
});

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

const handleDeleteInBatch = () => {
  if (selectedFootprints.value.length === 0) return;
  Dialog.warning({
    title: "是否确认删除所选的足迹",
    description: "删除之后将无法恢复此操作不可恢复。",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprints(selectedFootprints.value)
          .then(() => {
            Toast.success("删除成功");
            selectedFootprints.value.length = 0;
            checkedAll.value = false;
          });
      } catch (e) {
        console.error("删除失败", e);
        Toast.error("删除失败");
      } finally {
        refetch();
      }
    },
  });
};

const handleOpenCreateModal = (footprint?: Footprint) => {
  selectedFootprint.value = footprint;
  editingModal.value = true;
};

const onEditingModalClose = async () => {
  selectedFootprint.value = undefined;
  refetch();
};

// 处理类型选择
const handleTypeSelect = (type: string | undefined) => {
  selectedFootprintType.value = type;
  refetch();
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  try {
    const types = await footprintApiClient.footprint.listFootprintTypes();
    footprintTypes.value = types;
  } catch (error) {
    console.error("Footprint.vue: 获取足迹类型失败:", error);
  }
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
    Toast.error("经度必须在-180到180之间");
    return;
  }
  
  if (lat < -90 || lat > 90) {
    Toast.error("纬度必须在-90到90之间");
    return;
  }
  
  try {
    const updatedFootprint = {
      ...currentFootprint.value,
      spec: {
        ...currentFootprint.value.spec,
        longitude: lng,
        latitude: lat,
      },
    };
    
    await footprintApiClient.footprint.updateFootprint(
      currentFootprint.value.metadata.name,
      updatedFootprint
    );
    
    Toast.success("更新成功");
    showManualInput.value = false;
    handleFetchData();
  } catch (e) {
    console.error("更新失败", e);
    Toast.error("更新失败，请重试");
  }
};

const handleFetchData = () => {
  refetch();
};

const handleEdit = (row: Footprint) => {
  handleOpenCreateModal(row);
};

const visitFrontend = () => {
  // 获取当前域名，构建前台页面URL
  const currentOrigin = window.location.origin;
  const frontendUrl = `${currentOrigin}/footprints`;
  window.open(frontendUrl, '_blank');
};
</script>

<template>
  <FootprintEditingModal
    v-model:visible="editingModal"
    :footprint="selectedFootprint"
    @close="onEditingModalClose"
  >
  </FootprintEditingModal>
  <VPageHeader title="足迹">
    <template #actions>
      <VSpace>
        <VButton
          type="primary"
          @click="visitFrontend"
        >
          <template #icon>
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
            </svg>
          </template>
          访问前台
        </VButton>
        <VButton
          type="secondary"
          @click="editingModal = true"
        >
          <template #icon>
            <IconAddCircle class="h-full w-full" />
          </template>
          新建
        </VButton>
      </VSpace>
    </template>
  </VPageHeader>

  <div class="m-0 md:m-4">
    <VCard :body-class="['!p-0']">
      <template #header>
        <div class="block w-full bg-gray-50 px-4 py-3">
          <div class="relative flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center">
            <div class="hidden items-center sm:flex">
              <input
                v-model="checkedAll"
                type="checkbox"
                @change="handleCheckAllChange"
              />
            </div>
            <div class="flex w-full flex-1 items-center sm:w-auto">
              <FormKit
                v-if="!selectedFootprints.length"
                v-model="searchText"
                placeholder="输入关键词搜索"
                type="text"
                outer-class="!moments-p-0 moments-mr-2"
                @keyup.enter="onKeywordChange"
              >
                <template v-if="keyword" #suffix>
                  <div
                    class="group flex h-full cursor-pointer items-center bg-white px-2 transition-all hover:bg-gray-50"
                    @click="handleReset"
                  >
                    <IconCloseCircle
                      class="h-4 w-4 text-gray-500 group-hover:text-gray-700"
                    />
                  </div>
                </template>
              </FormKit>
              <VSpace v-else>
                <VButton type="danger" @click="handleDeleteInBatch">
                  删除
                </VButton>
              </VSpace>
            </div>
            <VSpace spacing="lg" class="flex-wrap">
              <button
                v-if="hasFilters"
                class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                @click="handleClearFilters"
              >
                <span>清除筛选</span>
              </button>
              <div class="relative inline-block text-left">
                <VDropdown>
                  <button
                    type="button"
                    class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    <span>类型：{{ selectedFootprintType || '全部' }}</span>
                  </button>
                  <template #popper>
                    <div class="w-36 max-h-60 overflow-auto">
                      <VDropdownItem
                          :selected="selectedFootprintType === undefined"
                          @click="handleTypeSelect(undefined)"
                      >
                        全部
                      </VDropdownItem>
                      <VDropdownItem
                          v-for="type in footprintTypes"
                          :key="type.value"
                          :selected="selectedFootprintType === type.value"
                          @click="handleTypeSelect(type.value)"
                      >
                        {{ type.label }}
                      </VDropdownItem>
                    </div>
                  </template>
                </VDropdown>
              </div>
              <div class="relative inline-block text-left">
                <VDropdown>
                  <button
                    type="button"
                    class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                  >
                    <span>排序：{{ selectedSort === 'metadata.creationTimestamp,desc' ? '较近创建' : selectedSort === 'metadata.creationTimestamp,asc' ? '较早创建' : '默认' }}</span>
                  </button>
                  <template #popper>
                    <div class="w-36 max-h-60 overflow-auto">
                      <VDropdownItem
                        :selected="selectedSort === undefined"
                        @click="() => { selectedSort = undefined; refetch(); }"
                      >
                        默认
                      </VDropdownItem>
                      <VDropdownItem
                        :selected="selectedSort === 'metadata.creationTimestamp,desc'"
                        @click="() => { selectedSort = 'metadata.creationTimestamp,desc'; refetch(); }"
                      >
                        较近创建
                      </VDropdownItem>
                      <VDropdownItem
                        :selected="selectedSort === 'metadata.creationTimestamp,asc'"
                        @click="() => { selectedSort = 'metadata.creationTimestamp,asc'; refetch(); }"
                      >
                        较早创建
                      </VDropdownItem>
                    </div>
                  </template>
                </VDropdown>
              </div>
              <div class="flex flex-row gap-2">
                <div
                  class="group cursor-pointer rounded p-1 hover:bg-gray-200"
                  @click="refetch()"
                >
                  <IconRefreshLine
                    v-tooltip="'刷新'"
                    :class="{ 'animate-spin text-gray-900': isFetching }"
                    class="h-4 w-4 text-gray-600 group-hover:text-gray-900"
                  />
                </div>
              </div>
            </VSpace>
          </div>
        </div>
      </template>
      <VLoading v-if="isLoading" />

      <Transition v-else-if="!footprints?.length" appear name="fade">
        <VEmpty
          message="暂无足迹记录"
          title="暂无足迹记录"
        >
          <template #actions>
            <VSpace>
              <VButton @click="refetch()"> 刷新 </VButton>
            </VSpace>
          </template>
        </VEmpty>
      </Transition>

      <Transition v-else appear name="fade">
        <div class="w-full relative overflow-x-auto">
          <table class="w-full text-sm text-left text-gray-500 widefat">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center"> </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">名称 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">图片 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">足迹类型 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">经度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">纬度 </div></th>
              <th scope="col" class="px-4 py-3"><div class="w-max flex items-center">关联链接 </div></th>
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
              <td class="px-4 py-4 table-td">{{footprint.spec.longitude}}</td>
              <td class="px-4 py-4 table-td">{{footprint.spec.latitude}}</td>
              <td class="px-4 py-4">
                <span v-if="footprint.spec.article" class="text-blue-600">
                  {{footprint.spec.article}}
                </span>
                <span v-else class="text-gray-400">暂无关联</span>
              </td>
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
                    </div>
                  </template>
                </VDropdown>
              </td>
            </tr>
            </tbody>
          </table>
        </div>
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
</style>
