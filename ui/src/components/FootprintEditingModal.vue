<script lang="ts" setup>
import {Toast, VButton, VModal, VSpace} from "@halo-dev/components";
import {ref, computed, watch, onMounted} from "vue";
import {footprintApiClient} from "@/api";
import type {Footprint, GalleryImage, Option} from "@/api/models";
import {toDatetimeLocal, toISOString} from "@/utils/date";
import {FormKit} from "@formkit/vue";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {Teleport} from "vue";


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

const articleType = ref<'post' | 'custom'>('post');

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

// 使用JSON.parse(JSON.stringify())进行深拷贝，替代lodash.clonedeep
const deepClone = <T, >(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

const formState = ref<Footprint>(deepClone(initialFormState));
const galleryImageUrls = ref<string[]>([]);
const galleryImageItems = ref<GalleryImage[]>([]);
const saving = ref<boolean>(false);
const formVisible = ref(false);
const createTime = ref<string | undefined>(undefined);
const showManualInput = ref(false);
const manualLongitude = ref<string>("");
const manualLatitude = ref<string>("");
const awaitingGeocode = ref(false);

const isUpdateMode = computed(() => {
  return !!formState.value.metadata.creationTimestamp;
});

const modalTitle = computed(() => {
  return isUpdateMode.value ? "编辑足迹" : "新建足迹";
});

const onVisibleChange = (visible: boolean) => {
  emit("update:visible", visible);
  if (!visible) {
    emit("close");
  }
};

const handleResetForm = () => {
  formState.value = deepClone(initialFormState);
  galleryImageUrls.value = [];
  galleryImageItems.value = [];
};

const unwrapAttachmentImageUrl = (url: unknown): string => {
  // attachment 组件在不同 Halo 版本中可能返回 URL、对象或单元素数组。
  // 不能直接对对象调用 String，否则会把附件保存成 "[object Object]"。
  let value: unknown = url;
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === "object") {
    const image = value as {url?: unknown; src?: unknown; thumbnail?: unknown; path?: unknown};
    value = image.url ?? image.src ?? image.thumbnail ?? image.path ?? "";
  }
  return String(value ?? "").trim();
};

const normalizeAttachmentImageUrl = (url: unknown): string => {
  return unwrapAttachmentImageUrl(url).replace(
    /(\.(?:jpe?g|png|gif|webp|bmp|svg|avif|ico))(?:![^/?#]*)?(?=([?#]|$))/i,
    "$1",
  );
};

const normalizeGalleryImagesForEditor = (images: unknown): GalleryImage[] => {
  if (!Array.isArray(images)) return [];
  return images.map((item, index) => {
    if (typeof item === "string") {
      return {url: item, order: index + 1};
    }
    if (item && typeof item === "object") {
      const image = item as {url?: string; src?: string; thumbnail?: string; order?: number};
      const order = Number(image.order);
      return {
        url: image.url || image.src || image.thumbnail || "",
        order: Number.isInteger(order) && order > 0 ? order : index + 1,
      };
    }
    return {url: "", order: index + 1};
  }).filter((item) => item.url).sort((a, b) => a.order - b.order);
};

const syncGalleryImageItems = (urls: string[]) => {
  const existingUrls = new Map(
    galleryImageItems.value.map((item) => [normalizeAttachmentImageUrl(item.url), item.url]),
  );
  const normalizedUrls = urls.map(normalizeAttachmentImageUrl).filter(Boolean);
  const originalUrls = urls.map((url) => String(url ?? "").trim()).filter(Boolean);
  galleryImageItems.value = normalizedUrls.map((url, index) => ({
    url: existingUrls.get(url) ?? originalUrls[index] ?? url,
    order: index + 1,
  }));
  if (normalizedUrls.length !== urls.length || normalizedUrls.some((url, index) => url !== urls[index])) {
    galleryImageUrls.value = normalizedUrls;
  }
};

watch(galleryImageUrls, (urls) => {
  syncGalleryImageItems(urls);
}, {deep: true});

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      formVisible.value = true;
    } else {
      setTimeout(() => {
        formVisible.value = false;
        handleResetForm();
      }, 200);
    }
  },
);

watch(
  () => props.footprint,
  (footprint) => {
    if (footprint) {
      formState.value = deepClone(footprint);
      createTime.value = toDatetimeLocal(formState.value.spec.createTime);
      galleryImageItems.value = normalizeGalleryImagesForEditor(formState.value.spec.galleryImages);
      galleryImageUrls.value = galleryImageItems.value.map((item) => normalizeAttachmentImageUrl(item.url));
    } else {
      createTime.value = undefined;
      galleryImageUrls.value = [];
      galleryImageItems.value = [];
    }
  },
);

// 添加一个计算属性来控制pitchAngle的显示
const showPitchAngle = computed(() => {
  const zoomLevel = parseFloat(formState.value.spec.zoomLevel || '0')
  return zoomLevel >= 18
})

const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`,
} as const;

// 修改表单验证状态
const isFormValid = computed(() => {
  // 检查必填项
  if (!formState.value.spec.name?.trim()) return false;
  if (!formState.value.spec.description?.trim()) return false;
  if (!formState.value.spec.zoomLevel?.trim()) return false;
  if (!formState.value.spec.pitchAngle?.trim()) {
    formState.value.spec.pitchAngle = "0";
  }
  if (!formState.value.spec.rotationAngle?.trim()) {
    formState.value.spec.rotationAngle = "0";
  }
  return formState.value.spec.address?.trim();
});

const getGalleryImagesForSubmit = (): GalleryImage[] => {
  return galleryImageItems.value.filter((item) => item.url).map((item, index) => ({
    url: item.url,
    order: index + 1,
  }));
};

const validateGalleryImageOrders = () => {
  const galleryImages = getGalleryImagesForSubmit();
  if (galleryImages.some((item) => !Number.isInteger(item.order) || item.order < 1)) {
    Toast.error("图片墙显示顺序必须是大于 0 的整数");
    return false;
  }
  if (new Set(galleryImages.map((item) => item.order)).size !== galleryImages.length) {
    Toast.error("图片墙显示顺序不能重复");
    return false;
  }
  return true;
};

const getSubmitFormState = (): Footprint => {
  const submitState = deepClone(formState.value);
  submitState.spec.galleryImages = getGalleryImagesForSubmit();
  // 票根图片 URL 可能包含图片处理后缀（如 !w100），保存时不能去掉。
  // 这里只负责解析 attachment 组件返回的对象/数组，不做任何后缀清理。
  submitState.spec.ticketImage = unwrapAttachmentImageUrl(submitState.spec.ticketImage);
  return submitState;
};


const handleRegoecode = async () => {
  if (!formState.value.spec.longitude || !formState.value.spec.latitude) {
    Toast.error("请先填写地址以获取经纬度，或手动输入经纬度");
    return;
  }
  if (!isUpdateMode.value) {
    Toast.warning("请先保存足迹后再解析省/市信息");
    return;
  }
  try {
    awaitingGeocode.value = true;
    const geoInfo = await footprintApiClient.footprint.geocodeFootprint(
      formState.value.metadata.name
    );
    formState.value.spec.province = geoInfo.province;
    formState.value.spec.city = geoInfo.city;
    formState.value.spec.provinceAdcode = geoInfo.provinceAdcode;
    formState.value.spec.cityAdcode = geoInfo.cityAdcode;
    Toast.success("省/市信息解析成功");
  } catch (error) {
    console.error("逆地理编码失败:", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = false;
  }
};
const handleSubmit = async () => {
  try {
    // 先进行表单验证
    if (!isFormValid.value) {
      // 检查具体错误并显示提示
      if (!formState.value.spec.name?.trim()) {
        Toast.error("足迹名称不能为空");
        return;
      }
      if (!formState.value.spec.description?.trim()) {
        Toast.error("足迹描述不能为空");
        return;
      }
      if (!formState.value.spec.address?.trim()) {
        Toast.error("地址不能为空");
        return;
      }
      if (!formState.value.spec.zoomLevel?.trim()) {
        Toast.error("缩放级别不能为空");
        return;
      }
      if (!formState.value.spec.pitchAngle?.trim()) {
        Toast.error("俯仰角度不能为空");
        return;
      }
      if (!formState.value.spec.rotationAngle?.trim()) {
        Toast.error("旋转角度不能为空");
        return;
      }
      if (!createTime.value) {
        Toast.error("请选择创建时间");
        return;
      }

      Toast.error("请检查表单填写是否正确");
      return;
    }

    if (!validateGalleryImageOrders()) return;

    const zoomLevel = formState.value.spec.zoomLevel;
    if (parseFloat(zoomLevel) < 4 || parseFloat(zoomLevel) > 26) {
      Toast.error("缩放级别必须在4-20之间");
      return;
    }

    const pitchAngle = formState.value.spec.pitchAngle;
    if (parseFloat(pitchAngle) < 0 || parseFloat(pitchAngle) > 83) {
      Toast.error("俯仰角度必须在0-83之间");
      return;
    }

    const rotationAngle = formState.value.spec.rotationAngle;
    if (parseFloat(rotationAngle) < -360 || parseFloat(rotationAngle) > 360) {
      Toast.error("旋转角度必须在-360到360之间");
      return;
    }

    saving.value = true;

    // 获取地址的经纬度
    const address = formState.value.spec.address?.trim();
    if (!address) {
      Toast.error("地址不能为空");
      return;
    }
    const response = await fetch(
      `/apis/api.footprint.lik.cc/v1alpha1/footprints/location/${encodeURIComponent(address)}`,
    );
    if (!response.ok) {
      Toast.error("获取地址经纬度失败");
      return;
    }
    const location = await response.text();
    console.log("获取到的地址经纬度:", location);

    // 检查location是否为空或无效
    if (!location || location.trim() === "" || !location.includes(",")) {
      console.log("地址经纬度无效，显示手动输入框");
      Toast.info("无法自动获取地址经纬度，请手动输入");
      showManualInput.value = true;
      saving.value = false;
      return;
    }

    const [lng, lat] = location.split(",");
    // 验证经纬度是否有效
    const longitude = parseFloat(lng);
    const latitude = parseFloat(lat);

    if (
      isNaN(longitude) ||
      isNaN(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      console.log("经纬度数值无效，显示手动输入框");
      Toast.info("获取到的经纬度无效，请手动输入");
      showManualInput.value = true;
      saving.value = false;
      return;
    }

    // 更新表单数据
    formState.value.spec.longitude = longitude;
    formState.value.spec.latitude = latitude;

    if (createTime.value) {
      formState.value.spec.createTime = toISOString(createTime.value);
    }

    const submitFormState = getSubmitFormState();
    if (isUpdateMode.value) {
      await footprintApiClient.footprint.updateFootprint(
        formState.value.metadata.name,
        submitFormState,
      );
      Toast.success("更新成功");
      onVisibleChange(false);
    } else {
      await footprintApiClient.footprint.createFootprint(submitFormState);
      Toast.success("创建成功");
      onVisibleChange(false);
    }
  } catch (e) {
    console.error("保存失败", e);
    Toast.error("保存失败，请重试");
  } finally {
    saving.value = false;
  }
};

const handleManualInput = () => {
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

  formState.value.spec.longitude = lng;
  formState.value.spec.latitude = lat;
  showManualInput.value = false;

  // 继续保存流程
  if (createTime.value) {
    formState.value.spec.createTime = toISOString(createTime.value);
  }

  if (!validateGalleryImageOrders()) return;

  const submitFormState = getSubmitFormState();

  if (isUpdateMode.value) {
    footprintApiClient.footprint.updateFootprint(
      formState.value.metadata.name,
      submitFormState
    ).then(() => {
      Toast.success("更新成功");
      onVisibleChange(false);
    })
      .catch((e) => {
        console.error("保存失败", e);
        Toast.error("保存失败，请重试");
      });
  } else {
    footprintApiClient.footprint
      .createFootprint(submitFormState)
      .then(() => {
        Toast.success("创建成功");
        onVisibleChange(false);
      })
      .catch((e) => {
        console.error("保存失败", e);
        Toast.error("保存失败，请重试");
      });
  }
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value =
    await footprintApiClient.footprint.listFootprintTypes();
});
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

      <!-- 基本信息 -->
      <div class="md:grid md:grid-cols-4 md:gap-6">
        <div class="md:col-span-1">
          <div class="sticky top-0 pt-1">
            <span class="text-sm font-semibold text-gray-700">基本信息</span>
          </div>
        </div>
        <div class="divide-y divide-gray-100 md:col-span-3" style="margin-top: 10px">
          <FormKit
            v-model="formState.spec.name"
            type="text"
            name="足迹名称"
            validation="required"
            :validation-messages="validationMessages"
            label="足迹名称"
            placeholder="输入足迹名称"
          ></FormKit>
          <FormKit
            v-model="formState.spec.description"
            type="textarea"
            name="足迹描述"
            validation="required"
            :validation-messages="validationMessages"
            label="足迹描述"
            :rows="3"
            placeholder="描述一下这个足迹吧"
          ></FormKit>
          <FormKit
            v-model="formState.spec.address"
            type="text"
            validation="required"
            name="address"
            label="地址"
            help="建议格式：市+地址，如杭州市灵隐寺，系统会根据地址自动获取经纬度"
            placeholder="输入详细地址"
          ></FormKit>

          <!-- 省份/城市 -->
          <div class="formkit-outer py-5" data-type="text">
            <label class="formkit-label">省份 / 城市（自动解析）</label>
            <div class="flex items-center gap-2 w-full" style="max-width: 31em">
              <input
                :value="formState.spec.province || '—'"
                readonly
                class="flex-1 min-w-0 w-0 rounded border px-3 py-1.5 text-base bg-white text-gray-900 border-gray-300 outline-none"
                placeholder="省份"
              />
              <span class="shrink-0 text-gray-300 text-sm">/</span>
              <input
                :value="formState.spec.city || '—'"
                readonly
                class="flex-1 min-w-0 w-0 rounded border px-3 py-1.5 text-base bg-white text-gray-900 border-gray-300 outline-none"
                placeholder="城市"
              />
              <VButton
                type="secondary"
                size="sm"
                :loading="awaitingGeocode"
                :disabled="!isUpdateMode"
                @click="handleRegoecode"
              >
                解析
              </VButton>
            </div>
            <p v-if="!isUpdateMode" class="formkit-help">保存后可使用"解析"自动填充省/市信息</p>
          </div>
          <FormKit
            v-model="formState.spec.image"
            :type="'attachment' as any"
            name="image"
            label="足迹图片"
          ></FormKit>
          <FormKit
            v-model="formState.spec.ticketImage"
            :type="'attachment' as any"
            name="ticketImage"
            label="票根图片"
            help="每个足迹最多上传一张票根，票根墙只展示已配置票根的足迹"
          ></FormKit>
          <FormKit
            v-model="galleryImageUrls"
            :type="'attachment' as any"
            name="galleryImages"
            label="图片墙图片"
            :accepts="['image/*']"
            :multiple="true"
            width="140px"
            aspect-ratio="1/1"
            help="支持拖拽图片调整图片墙显示顺序"
          ></FormKit>
        </div>
      </div>

      <!-- 地图设置 -->
      <div class="mt-8 md:grid md:grid-cols-4 md:gap-6">
        <div class="md:col-span-1">
          <div class="sticky top-0 pt-1">
            <span class="text-sm font-semibold text-gray-700">地图设置</span>
          </div>
        </div>
        <div class="divide-y divide-gray-100 md:col-span-3">
          <FormKit
            v-model="formState.spec.zoomLevel"
            type="number"
            name="zoomLevel"
            label="缩放级别"
            validation="required|number|between:4,26"
            validation-visibility="live"
            :validation-messages="{
              required: '缩放级别不能为空',
              between: '缩放级别必须在4到26之间'
            }"
            help="标记的放大级别，4-26（支持两位小数），≥18时可开启3D效果"
            min="4"
            max="26"
            step="0.01"
          ></FormKit>
          <FormKit
            v-if="showPitchAngle"
            v-model="formState.spec.pitchAngle"
            type="number"
            name="pitchAngle"
            label="3D 俯仰角度"
            validation="required|number|between:0,83"
            validation-visibility="live"
            :validation-messages="{
              required: '俯仰角不能为空',
              between: '俯仰角必须在0到83之间'
            }"
            help="3D 视图的俯仰角度，范围 0-83"
            min="0"
            max="90"
            step="1"
          ></FormKit>
          <FormKit
            v-if="showPitchAngle"
            v-model="formState.spec.rotationAngle"
            type="number"
            name="rotationAngle"
            label="3D 旋转角度"
            validation="required|number|between:-360,360"
            validation-visibility="live"
            :validation-messages="{
              required: '旋转角度不能为空',
              between: '旋转角度必须在-360到360之间'
            }"
            help="3D 视图的旋转角度，范围 -360 到 360"
            min="-360"
            max="360"
            step="1"
          ></FormKit>
        </div>
      </div>

      <!-- 其他信息 -->
      <div class="mt-8 md:grid md:grid-cols-4 md:gap-6">
        <div class="md:col-span-1">
          <div class="sticky top-0 pt-1">
            <span class="text-sm font-semibold text-gray-700">其他信息</span>
          </div>
        </div>
        <div class="divide-y divide-gray-100 md:col-span-3">
          <FormKit
            v-model="formState.spec.footprintType"
            :options="footprintTypes"
            label="足迹类型"
            name="footprintType"
            type="select"
          ></FormKit>
                   <FormKit
            v-model="articleType"
            type="select"
            name="articleType"
            label="关联类型"
            :options="[
              { label: '文章', value: 'post' },
              { label: '自定义链接', value: 'custom' },
            ]"
          ></FormKit>
          <template v-if="articleType === 'post'">
            <FormKit
              v-model="formState.spec.article"
              type="select"
              name="article"
              label="关联文章"
              :multiple="false"
              clearable
              searchable
              action="/apis/content.halo.run/v1alpha1/posts"
              :request-option="{
                method: 'GET',
                pageField: 'page',
                sizeField: 'size',
                totalField: 'total',
                itemsField: 'items',
                labelField: 'spec.title',
                valueField: 'status.permalink',
              }"
            ></FormKit>
          </template>
          <template v-else-if="articleType === 'custom'">
            <FormKit
              v-model="formState.spec.article"
              type="text"
              name="customArticle"
              label="链接地址"
              placeholder="请输入完整URL，如 https://example.com"
              validation="url"
              :validation-messages="{
                url: '请输入有效的URL地址，需包含http://或https://',
              }"
            ></FormKit>
          </template>
          <FormKit
            v-model="formState.spec.metadataNames"
            type="select"
            name="metadataNames"
            label="关联足迹"
            :multiple="true"
            :debounce="300"
            :min-chars="1"
            clearable
            searchable
            action="/apis/api.footprint.lik.cc/v1alpha1/footprints"
            :request-option="{
              method: 'GET',
              pageField: 'page',
              sizeField: 'size',
              totalField: 'total',
              itemsField: 'items',
              labelField: 'spec.name',
              valueField: 'metadata.name',
            }"
          ></FormKit>
          <FormKit
            v-model="createTime"
            type="datetime-local"
            min="0000-01-01T00:00"
            max="9999-12-31T23:59"
            name="createTime"
            validation="required"
            label="创建时间"
            help="如果为空，则使用当前时间"
          ></FormKit>
        </div>
      </div>
    </FormKit>

    <template #footer>
      <VSpace>
        <VButton type="secondary" @click="onVisibleChange(false)">取消</VButton>
        <VButton type="primary" :loading="saving" :disabled="!isFormValid" @click="handleSubmit">确定</VButton>
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
          <VButton type="primary" @click="handleManualInput"> 确定</VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>
</template>
