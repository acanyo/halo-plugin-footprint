<script lang="ts" setup>
import { Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import { ref, computed, watch } from "vue";
import { footprintApiClient } from "@/api";
import type { Footprint } from "@/api/models";
import { toDatetimeLocal, toISOString } from "@/utils/date";
import { FormKit } from "@formkit/vue";
import { coreApiClient } from "@halo-dev/api-client";

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
    } else {
      createTime.value = undefined;
    }
  }
);

const handleSubmit = async () => {
  try {
    // 表单验证
    if (!formState.value.spec.name) {
      Toast.error("足迹名称不能为空");
      return;
    }
    if (!formState.value.spec.description) {
      Toast.error("足迹描述不能为空");
      return;
    }
    if (formState.value.spec.longitude === 0) {
      Toast.error("经度不能为空或者必须大于0");
      return;
    }
    if (formState.value.spec.latitude === 0) {
      Toast.error("纬度不能为空或者必须大于0");
      return;
    }

    saving.value = true;

    if (createTime.value) {
      formState.value.spec.createTime = toISOString(createTime.value);
    }

    // 如果选择了文章，获取文章URL
    if (formState.value.spec.article) {
      try {
        const { data: post } = await coreApiClient.content.post.getPost({
          name: formState.value.spec.article,
        });
        if (post?.status?.permalink) {
          formState.value.spec.article = post.status.permalink;
        }
      } catch (e) {
        console.error("获取文章URL失败", e);
        Toast.error("获取文章URL失败");
        return;
      }
    }

    if (isUpdateMode.value) {
      await footprintApiClient.footprint.updateFootprint(
        formState.value.metadata.name,
        formState.value
      );
      Toast.success("更新成功");
    } else {
      await footprintApiClient.footprint.createFootprint(formState.value);
      Toast.success("创建成功");
    }

    onVisibleChange(false);
  } catch (e) {
    console.error("保存失败", e);
  } finally {
    saving.value = false;
  }
};

const footprintTypes = [
  { label: "旅游", value: "旅游" },
  { label: "美食", value: "美食" },
  { label: "购物", value: "购物" },
  { label: "住宿", value: "住宿" },
  { label: "交通", value: "交通" },
  { label: "其他", value: "其他" },
];

// 添加验证消息配置
const validationMessages = {
  required: (ctx: { name: string }) => `${ctx.name}不能为空`
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

// 添加数字输入处理函数
const handleNumberInput = (value: unknown, field: 'longitude' | 'latitude') => {
  const num = toNumber(value);
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
      @submit="handleSubmit"
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
          ></FormKit>
          
          <FormKit
            type="text"
            v-model="latitudeDisplay"
            name="纬度"
            validation="required"
            :validation-messages="validationMessages"
            label="纬度"
            placeholder="请输入纬度"
          ></FormKit>
          
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
            :type="'postSelect' as any"
            v-model="formState.spec.article"
            name="article"
            label="关联文章"
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