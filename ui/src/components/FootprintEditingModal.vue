<script lang="ts" setup>
import { Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import {ref, computed, watch, onMounted} from "vue";
import { footprintApiClient } from "@/api";
import type {Footprint, Option} from "@/api/models";
import { toDatetimeLocal, toISOString } from "@/utils/date";
import { FormKit } from "@formkit/vue";
import { Teleport } from "vue";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    footprint?: Footprint;
  }>(),
  {
    visible: false,
    footprint: undefined,
  }
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
    article: "",
    createTime: new Date().toISOString(),
  },
  kind: "Footprint",
  apiVersion: "footprint.lik.cc/v1alpha1",
};

// 使用JSON.parse(JSON.stringify())进行深拷贝，替代lodash.clonedeep
const deepClone = <T,>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

const formState = ref<Footprint>(deepClone(initialFormState));
const saving = ref<boolean>(false);
const formVisible = ref(false);
const createTime = ref<string | undefined>(undefined);
const showManualInput = ref(false);
const manualLongitude = ref<string>("");
const manualLatitude = ref<string>("");

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
};

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
  }
);

watch(
  () => props.footprint,
  (footprint) => {
    if (footprint) {
      formState.value = deepClone(footprint);
      createTime.value = toDatetimeLocal(formState.value.spec.createTime);
    } else {
      createTime.value = undefined;
    }
  },
);

const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`,
} as const;

// 修改表单验证状态
const isFormValid = computed(() => {
  // 检查必填项
  if (!formState.value.spec.name?.trim()) return false;
  if (!formState.value.spec.description?.trim()) return false;
  return formState.value.spec.address?.trim();
});

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
      if (!createTime.value) {
        Toast.error("请选择创建时间");
        return;
      }

      Toast.error("请检查表单填写是否正确");
      return;
    }

    saving.value = true;

    // 获取地址的经纬度
    const address = formState.value.spec.address?.trim();
    if (!address) {
      Toast.error("地址不能为空");
      return;
    }
    const response = await fetch(`/apis/api.footprint.lik.cc/v1alpha1/footprints/location/${encodeURIComponent(address)}`);
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
    
    if (isNaN(longitude) || isNaN(latitude) || 
        longitude < -180 || longitude > 180 || 
        latitude < -90 || latitude > 90) {
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

    if (isUpdateMode.value) {
      await footprintApiClient.footprint.updateFootprint(
        formState.value.metadata.name,
        formState.value
      );
      Toast.success("更新成功");
      onVisibleChange(false);
    } else {
      await footprintApiClient.footprint.createFootprint(formState.value);
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

  if (isUpdateMode.value) {
    footprintApiClient.footprint.updateFootprint(
      formState.value.metadata.name,
      formState.value
    ).then(() => {
      Toast.success("更新成功");
      onVisibleChange(false);
    }).catch(e => {
      console.error("保存失败", e);
      Toast.error("保存失败，请重试");
    });
  } else {
    footprintApiClient.footprint.createFootprint(formState.value)
      .then(() => {
        Toast.success("创建成功");
        onVisibleChange(false);
      })
      .catch(e => {
        console.error("保存失败", e);
        Toast.error("保存失败，请重试");
      });
  }
};

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});
</script>

<template>
  <!-- 手动输入经纬度的对话框 -->
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

  <VModal
    :visible="visible"
    :width="700"
    :title="modalTitle"
    :mask-closable="false"
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
      <div class="md:grid md:grid-cols-4 md:gap-6">
        <div class="md:col-span-1">
          <div class="sticky top-0">
            <span class="text-base font-medium text-gray-900">基本信息</span>
          </div>
        </div>
        <div class="mt-5 divide-y divide-gray-100 md:col-span-3 md:mt-0">
          <div v-if="isUpdateMode" class="pb-4">
            <p v-if="formState.spec.image"><img :src="formState.spec.image" width="100" class="rounded"></p>
            <p class="text-lg font-medium">{{formState.spec.name}}</p>
            <p class="text-gray-500">{{formState.spec.description}}</p>
          </div>
          
          <FormKit
            type="text"
            v-model="formState.spec.name"
            name="足迹名称"
            validation="required"
            :validation-messages="validationMessages"
            label="足迹名称"
          ></FormKit>
          
          <FormKit
            type="textarea"
            v-model="formState.spec.description"
            name="足迹描述"
            validation="required"
            :validation-messages="validationMessages"
            label="足迹描述"
            :rows="3"
          ></FormKit>
          
          <FormKit
            type="text"
            v-model="formState.spec.address"
            validation="required"
            name="address"
            label="地址"
            help="建议地址格式：市+地址，如杭州市灵隐寺,系统会根据所填写地址获取经纬度"
          ></FormKit>
          
          <FormKit
            :options="footprintTypes"
            label="足迹类型"
            v-model="formState.spec.footprintType"
            name="footprintType"
            type="select"
          ></FormKit>
          
          <FormKit
            :type="'attachment' as any"
            v-model="formState.spec.image"
            name="image"
            label="足迹图片"
          ></FormKit>
          
          <FormKit
            type="select"
            v-model="formState.spec.article"
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
              valueField: 'status.permalink'
            }"
          ></FormKit>
          
          <FormKit
            type="datetime-local"
            min="0000-01-01T00:00"
            max="9999-12-31T23:59"
            v-model="createTime"
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
        <VButton
          type="secondary"
          @click="onVisibleChange(false)"
        >
          取消
        </VButton>
        <VButton
          type="primary"
          :loading="saving"
          :disabled="!isFormValid"
          @click="handleSubmit"
        >
          确定
        </VButton>
      </VSpace>
    </template>
  </VModal>
</template>

<style scoped lang="scss">
.divide-y td {
  margin-bottom: 9px;
  line-height: 1.3;
  padding-bottom: 1rem;
}

.divide-y td p {
  margin-bottom: 6px;
}

.formkit-wrapper {
  margin-bottom: 1rem;
  padding-top: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.formkit-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: #374151;
  margin-bottom: 0.25rem;
}

.formkit-input {
  display: block;
  width: 100%;
  border-radius: 0.375rem;
  border: 1px solid #d1d5db;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  color: #111827;
  background-color: #fff;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.formkit-input:focus {
  outline: none;
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
}
</style> 
