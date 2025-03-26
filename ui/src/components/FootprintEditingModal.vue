<script lang="ts" setup>
import { Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import {ref, computed, watch, onMounted} from "vue";
import { footprintApiClient } from "@/api";
import type {Footprint, Option} from "@/api/models";
import { toDatetimeLocal, toISOString } from "@/utils/date";
import { FormKit } from "@formkit/vue";

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
      
      // 加载数据后进行验证
      const longitude = toNumber(formState.value.spec.longitude);
      const latitude = toNumber(formState.value.spec.latitude);
      
      // 验证经度
      if (isNaN(longitude) || !validateLongitude(longitude) || longitude === 0) {
        longitudeError.value = '经度必须在-180到180之间且不能为0';
      } else {
        longitudeError.value = '';
      }
      
      // 验证纬度
      if (isNaN(latitude) || !validateLatitude(latitude) || latitude === 0) {
        latitudeError.value = '纬度必须在-90到90之间且不能为0';
      } else {
        latitudeError.value = '';
      }
    } else {
      createTime.value = undefined;
      longitudeError.value = '';
      latitudeError.value = '';
    }
  }
);

// 添加验证消息配置
const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`,
  number: (ctx: { name: string }) => `${ctx.name}必须是数字`
} as const;

// 添加数字转换函数
const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

// 添加经纬度验证函数
const validateLongitude = (value: number): boolean => {
  return value >= -180 && value <= 180;
};

const validateLatitude = (value: number): boolean => {
  return value >= -90 && value <= 90;
};

// 添加错误状态
const longitudeError = ref<string>('');
const latitudeError = ref<string>('');

// 添加数字输入处理函数
const handleNumberInput = (value: unknown, field: 'longitude' | 'latitude') => {
  const num = toNumber(value);
  if (field === 'longitude') {
    if (isNaN(num)) {
      longitudeError.value = '请输入有效的数字';
      return;
    }
    if (!validateLongitude(num)) {
      longitudeError.value = '经度必须在-180到180之间';
      return;
    }
    if (num === 0) {
      longitudeError.value = '经度不能为0';
      return;
    }
    longitudeError.value = '';
  }
  if (field === 'latitude') {
    if (isNaN(num)) {
      latitudeError.value = '请输入有效的数字';
      return;
    }
    if (!validateLatitude(num)) {
      latitudeError.value = '纬度必须在-90到90之间';
      return;
    }
    if (num === 0) {
      latitudeError.value = '纬度不能为0';
      return;
    }
    latitudeError.value = '';
  }
  formState.value.spec[field] = num;
};

// 添加数字显示值
const longitudeDisplay = computed({
  get: () => formState.value.spec.longitude.toString(),
  set: (value) => handleNumberInput(value, 'longitude')
});

const latitudeDisplay = computed({
  get: () => formState.value.spec.latitude.toString(),
  set: (value) => handleNumberInput(value, 'latitude')
});

// 添加失焦验证
const handleBlur = (field: 'longitude' | 'latitude') => {
  const value = field === 'longitude' ? formState.value.spec.longitude : formState.value.spec.latitude;
  handleNumberInput(value, field);
};

// 修改表单验证状态
const isFormValid = computed(() => {
  // 检查必填项
  if (!formState.value.spec.name?.trim()) return false;
  if (!formState.value.spec.description?.trim()) return false;
  
  // 检查经纬度
  const longitude = toNumber(formState.value.spec.longitude);
  const latitude = toNumber(formState.value.spec.latitude);
  
  // 检查经纬度是否为0或无效（包括更新模式）
  if (longitude === 0 || latitude === 0) {
    if (isUpdateMode.value) {
      Toast.error("经纬度不能为0");
    }
    return false;
  }
  
  if (isNaN(longitude) || !validateLongitude(longitude)) {
    if (isUpdateMode.value) {
      Toast.error("经度必须在-180到180之间");
    }
    return false;
  }
  
  if (isNaN(latitude) || !validateLatitude(latitude)) {
    if (isUpdateMode.value) {
      Toast.error("纬度必须在-90到90之间");
    }
    return false;
  }
  
  // 检查是否有错误提示
  if (longitudeError.value || latitudeError.value) return false;
  
  // 检查创建时间
  if (!createTime.value) return false;
  
  return true;
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
      
      // 经纬度验证
      const longitude = toNumber(formState.value.spec.longitude);
      const latitude = toNumber(formState.value.spec.latitude);
      
      if (longitude === 0) {
        longitudeError.value = '经度不能为0';
        Toast.error("请输入有效的经度");
        return;
      }
      
      if (latitude === 0) {
        latitudeError.value = '纬度不能为0';
        Toast.error("请输入有效的纬度");
        return;
      }
      
      if (isNaN(longitude) || !validateLongitude(longitude)) {
        longitudeError.value = '经度必须在-180到180之间';
        Toast.error("请检查经度输入");
        return;
      }
      if (isNaN(latitude) || !validateLatitude(latitude)) {
        latitudeError.value = '纬度必须在-90到90之间';
        Toast.error("请检查纬度输入");
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

    if (createTime.value) {
      formState.value.spec.createTime = toISOString(createTime.value);
    }

    if (isUpdateMode.value) {
      // 更新模式下再次验证
      const longitude = toNumber(formState.value.spec.longitude);
      const latitude = toNumber(formState.value.spec.latitude);
      
      if (longitude === 0 || latitude === 0 || 
          !validateLongitude(longitude) || !validateLatitude(latitude)) {
        Toast.error("请检查经纬度是否正确");
        return;
      }

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

const footprintTypes = ref<Option[]>([]);
onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
});
</script>

<template>
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
            v-model="longitudeDisplay"
            name="经度"
            validation="required"
            :validation-messages="validationMessages"
            label="经度"
            placeholder="请输入经度"
            @blur="handleBlur('longitude')"
          >
            <template #help>
              <div v-if="longitudeError" class="text-red-500 text-sm mt-1">{{ longitudeError }}</div>
            </template>
          </FormKit>
          
          <FormKit
            type="text"
            v-model="latitudeDisplay"
            name="纬度"
            validation="required"
            :validation-messages="validationMessages"
            label="纬度"
            placeholder="请输入纬度"
            @blur="handleBlur('latitude')"
          >
            <template #help>
              <div v-if="latitudeError" class="text-red-500 text-sm mt-1">{{ latitudeError }}</div>
            </template>
          </FormKit>
          
          <FormKit
            type="text"
            v-model="formState.spec.address"
            name="address"
            label="地址"
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
