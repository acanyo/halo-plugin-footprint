<script setup lang="ts">
/**
 * 足迹编辑窗。
 *
 * 这里只保留「把几块拼起来」与提交流程。表单的三个分组各自成组件，
 * 校验、附件归一化、图片墙排序同步都收敛到 utils / composables：
 * - 校验：utils/footprint-form
 * - 附件 URL 归一化：utils/attachment
 * - 图片墙 URL ↔ 有序项同步：composables/useGalleryImages
 */

import { Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import { computed, onMounted, ref, watch } from "vue";
import { footprintApiClient } from "@/api";
import type { Footprint, GalleryImage, Option } from "@/api/models";
import { toDatetimeLocal, toISOString } from "@/utils/date";
import { parseCoordinate } from "@/utils/coordinate";
import {
  shouldShowPitchAngle,
  validateFootprintForm,
  validateGalleryOrders,
} from "@/utils/footprint-form";
import { unwrapAttachmentImageUrl } from "@/utils/attachment";
import { useGalleryImages } from "@/composables/useGalleryImages";
import MapPickerModal from "./MapPickerModal.vue";
import FootprintFormBasics from "./FootprintFormBasics.vue";
import FootprintFormMapSection from "./FootprintFormMapSection.vue";
import FootprintFormMetaSection from "./FootprintFormMetaSection.vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    footprint?: Footprint;
  }>(),
  {
    visible: false,
    footprint: undefined,
  },
);

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "close"): void;
}>();

const initialFormState: Footprint = {
  metadata: {
    name: "",
    generateName: "footprint-",
  },
  spec: {
    name: "",
    description: "",
    longitude: 0,
    latitude: 0,
    address: "",
    footprintType: "旅游",
    image: "",
    ticketImage: "",
    galleryImages: [],
    article: "",
    zoomLevel: "14",
    pitchAngle: "0",
    rotationAngle: "0",
    createTime: new Date().toISOString(),
  },
  kind: "Footprint",
  apiVersion: "footprint.lik.cc/v1alpha1",
};

const deepClone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));

const formState = ref<Footprint>(deepClone(initialFormState));
const saving = ref(false);
const formVisible = ref(false);
const createTime = ref<string | undefined>(undefined);
const showManualInput = ref(false);
const manualLongitude = ref("");
const manualLatitude = ref("");
const awaitingGeocode = ref(false);
const mapPickerVisible = ref(false);

const gallery = useGalleryImages();
const galleryImageUrls = gallery.urls;

const isUpdateMode = computed(() => !!formState.value.metadata.creationTimestamp);
const modalTitle = computed(() => (isUpdateMode.value ? "编辑足迹" : "新建足迹"));
const showPitchAngle = computed(() => shouldShowPitchAngle(formState.value.spec.zoomLevel));
const hasCoordinate = computed(() => !!formState.value.spec.longitude && !!formState.value.spec.latitude);

const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`,
} as const;

/**
 * 按钮可用状态。真正的错误提示在提交时由 validateFootprintForm 给出 ——
 * 这里只需要知道「现在能不能点」，不要让两处规则各写一遍。
 */
const isFormValid = computed(() => validateFootprintForm(formState.value, createTime.value).ok);

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});

function onVisibleChange(visible: boolean) {
  emit("update:visible", visible);
  if (!visible) emit("close");
}

function handleResetForm() {
  formState.value = deepClone(initialFormState);
  gallery.reset();
  createTime.value = undefined;
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      formVisible.value = true;
      return;
    }
    // 等关闭动画走完再清空，否则用户会看到表单在收起过程中闪一下空值
    setTimeout(() => {
      formVisible.value = false;
      handleResetForm();
    }, 200);
  },
);

watch(
  () => props.footprint,
  (footprint) => {
    if (footprint) {
      formState.value = deepClone(footprint);
      createTime.value = toDatetimeLocal(formState.value.spec.createTime);
      gallery.loadFromFootprint(formState.value.spec.galleryImages);
    } else {
      createTime.value = undefined;
      gallery.reset();
    }
  },
  { immediate: true },
);

function handleMapPicked(result: {
  longitude: number;
  latitude: number;
  province?: string;
  city?: string;
  provinceAdcode?: string;
  cityAdcode?: string;
}) {
  const spec = formState.value.spec;
  spec.longitude = result.longitude;
  spec.latitude = result.latitude;
  if (result.province) {
    spec.province = result.province;
    spec.city = result.city;
    spec.provinceAdcode = result.provinceAdcode;
    spec.cityAdcode = result.cityAdcode;
  }
  Toast.success("已更新位置");
}

/**
 * 重新解析省/市。走按经纬度解析的接口，因此新建状态下也能用 ——
 * 原先必须先保存，是因为旧接口只接受已存在的足迹名。
 */
async function handleReparse() {
  if (!hasCoordinate.value) {
    Toast.error("请先通过地图选点或填写地址确定经纬度");
    return;
  }
  try {
    awaitingGeocode.value = true;
    const geoInfo = await footprintApiClient.footprint.reverseGeocode(
      formState.value.spec.longitude,
      formState.value.spec.latitude,
    );
    Object.assign(formState.value.spec, {
      province: geoInfo.province,
      city: geoInfo.city,
      provinceAdcode: geoInfo.provinceAdcode,
      cityAdcode: geoInfo.cityAdcode,
    });
    Toast.success("省/市信息解析成功");
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = false;
  }
}

/** 组装提交数据：图片墙换成 {url, order}，票根只解包附件对象、保留处理后缀。 */
function buildSubmitState(): Footprint {
  const submitState = deepClone(formState.value);
  submitState.spec.galleryImages = gallery.toSubmit();
  submitState.spec.ticketImage = unwrapAttachmentImageUrl(submitState.spec.ticketImage);
  return submitState;
}

async function save() {
  const submitState = buildSubmitState();
  if (isUpdateMode.value) {
    await footprintApiClient.footprint.updateFootprint(
      formState.value.metadata.name,
      submitState,
    );
    Toast.success("更新成功");
  } else {
    await footprintApiClient.footprint.createFootprint(submitState);
    Toast.success("创建成功");
  }
  onVisibleChange(false);
}

/**
 * 保存主流程：校验 → 按地址解析经纬度 → 保存。
 *
 * 地址解析失败时打开「手动输入经纬度」小窗，用户填完由 handleManualInput
 * 接着走保存 —— 因此解析逻辑本身返回「是否继续」，而不是自己吞掉流程。
 */
async function handleSubmit() {
  const validation = validateFootprintForm(formState.value, createTime.value);
  if (!validation.ok) {
    Toast.error(validation.message ?? "请检查表单填写是否正确");
    return;
  }

  const galleryCheck = validateGalleryOrders(gallery.orders());
  if (!galleryCheck.ok) {
    Toast.error(galleryCheck.message ?? "图片墙顺序有误");
    return;
  }

  saving.value = true;
  try {
    const address = formState.value.spec.address!.trim();
    const response = await fetch(
      `/apis/api.footprint.lik.cc/v1alpha1/footprints/location/${encodeURIComponent(address)}`,
    );
    if (!response.ok) {
      Toast.error("获取地址经纬度失败");
      return;
    }

    const location = await response.text();
    const coordinates = parseLocation(location);
    if (!coordinates) {
      Toast.info("无法自动获取地址经纬度，请手动输入");
      showManualInput.value = true;
      return;
    }

    formState.value.spec.longitude = coordinates.longitude;
    formState.value.spec.latitude = coordinates.latitude;
    if (createTime.value) formState.value.spec.createTime = toISOString(createTime.value);

    await save();
  } catch (e) {
    console.error("保存失败", e);
    Toast.error("保存失败，请重试");
  } finally {
    saving.value = false;
  }
}

/** 解析 `"经度,纬度"`；格式或范围不对返回 null，交给调用方转手动输入。 */
function parseLocation(location: string): { longitude: number; latitude: number } | null {
  if (!location || !location.includes(",")) return null;
  const [lng, lat] = location.split(",");
  const longitude = parseFloat(lng);
  const latitude = parseFloat(lat);
  if (
    Number.isNaN(longitude) ||
    Number.isNaN(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }
  return { longitude, latitude };
}

/** 手动输入经纬度之后的保存：与 handleSubmit 的后半段相同，只是跳过地址解析。 */
function handleManualInput() {
  const result = parseCoordinate(manualLongitude.value, manualLatitude.value);
  if (!result.ok) {
    Toast.error(result.message);
    return;
  }

  formState.value.spec.longitude = result.longitude;
  formState.value.spec.latitude = result.latitude;
  showManualInput.value = false;

  if (createTime.value) formState.value.spec.createTime = toISOString(createTime.value);

  const galleryCheck = validateGalleryOrders(gallery.orders());
  if (!galleryCheck.ok) {
    Toast.error(galleryCheck.message ?? "图片墙顺序有误");
    return;
  }

  save().catch((e) => {
    console.error("保存失败", e);
    Toast.error("保存失败，请重试");
  });
}
</script>

<template>
  <!--
    编辑／新建窗必须 `mount-to-body`：Halo 控制台的内容区带 transform / 布局包含（contain），
    会替 `position: fixed` 重新指定包含块。留在原地渲染时，.modal-wrapper 的 top:0 + height:100%
    是相对"整页内容高度"算的，弹窗就跑到当前视口下面去了（页面越长越明显）。
    teleport 到 body 之后包含块回到视口，才会稳稳地出现在当前屏幕正中间。
    注意：它和下面那个"手动输入经纬度"小窗都在 body 上、z-index 都是 2000，
    同层同值时谁在后面谁在上 —— 所以小窗必须排在后面（改动顺序会让小窗被压在编辑窗之下）。
  -->
  <VModal
    :visible="visible"
    :width="850"
    :title="modalTitle"
    :mask-closable="false"
    mount-to-body
    @update:visible="onVisibleChange"
  >
    <FormKit
      v-if="formVisible"
      id="footprint-form"
      name="footprint-form"
      type="form"
      :config="{ validationVisibility: 'submit' }"
      @submit.prevent
    >
      <!-- 编辑模式预览 -->
      <div v-if="isUpdateMode" class="mb-6 rounded-lg bg-gray-50 p-4" style="margin-bottom: 10px">
        <div class="flex items-center gap-4">
          <img
            v-if="formState.spec.image"
            :src="formState.spec.image"
            width="80"
            class="rounded-lg object-cover"
            alt="足迹图片"
          />
          <div>
            <p class="text-lg font-semibold text-gray-900">{{ formState.spec.name }}</p>
            <p class="mt-1 text-sm text-gray-500">{{ formState.spec.description }}</p>
          </div>
        </div>
      </div>

      <FootprintFormBasics
        v-model:spec="formState.spec"
        v-model:gallery-image-urls="galleryImageUrls"
        :has-coordinate="hasCoordinate"
        :awaiting-geocode="awaitingGeocode"
        :validation-messages="validationMessages"
        @open-map-picker="mapPickerVisible = true"
        @reparse="handleReparse"
      />

      <FootprintFormMapSection
        v-model:spec="formState.spec"
        :show-pitch-angle="showPitchAngle"
      />

      <FootprintFormMetaSection
        v-model:spec="formState.spec"
        v-model:create-time="createTime"
        :footprint-types="footprintTypes"
      />
    </FormKit>

    <template #footer>
      <VSpace>
        <VButton type="secondary" @click="onVisibleChange(false)">取消</VButton>
        <VButton type="primary" :loading="saving" :disabled="!isFormValid" @click="handleSubmit">
          确定
        </VButton>
      </VSpace>
    </template>
  </VModal>

  <!-- 手动输入经纬度的对话框（排在编辑窗之后，才会盖在它上面） -->
  <Teleport to="body">
    <VModal
      v-model:visible="showManualInput"
      :width="500"
      title="手动输入经纬度"
      :mask-closable="false"
    >
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700">经度</label>
          <input
            v-model="manualLongitude"
            type="number"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入经度（-180到180）"
            step="0.000001"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">纬度</label>
          <input
            v-model="manualLatitude"
            type="number"
            class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="请输入纬度（-90到90）"
            step="0.000001"
          />
        </div>
      </div>
      <template #footer>
        <VSpace>
          <VButton type="secondary" @click="showManualInput = false">取消</VButton>
          <VButton type="primary" @click="handleManualInput">确定</VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>

  <!-- 同样需要 Teleport：排在编辑窗之后才会盖在它上面 -->
  <Teleport to="body">
    <MapPickerModal
      v-model:visible="mapPickerVisible"
      :longitude="formState.spec.longitude || undefined"
      :latitude="formState.spec.latitude || undefined"
      :address="formState.spec.address"
      @confirm="handleMapPicked"
    />
  </Teleport>
</template>
