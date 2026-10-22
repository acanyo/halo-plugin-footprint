<script setup lang="ts">
/**
 * 手动修正经纬度弹窗。
 *
 * 足迹列表里「手动修正经纬度」打开的那个表单。只做两件事：把输入框里的
 * 文本交给 utils/coordinate 校验，通过后写回足迹并推送更新。
 *
 * 用 Teleport 挂到 body：VModal 自身不做传送，内联在列表容器里会被
 * 容器的层叠上下文裁剪（这是原先内联写法踩过的坑）。
 */

import { ref, watch } from "vue";
import { Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import { parseCoordinate } from "@/utils/coordinate";
import { footprintApiClient } from "@/api";
import type { Footprint } from "@/api/models";

const props = defineProps<{
  visible: boolean;
  footprint: Footprint | null;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "updated"): void;
}>();

const longitude = ref("");
const latitude = ref("");
const saving = ref(false);

// 每次打开时用当前足迹的值初始化，避免上一轮的输入残留
watch(
  () => [props.visible, props.footprint] as const,
  ([visible, footprint]) => {
    if (!visible || !footprint) return;
    longitude.value = String(footprint.spec.longitude ?? "");
    latitude.value = String(footprint.spec.latitude ?? "");
  },
  { immediate: true },
);

const close = () => emit("update:visible", false);

async function submit() {
  if (!props.footprint || saving.value) return;

  const result = parseCoordinate(longitude.value, latitude.value);
  if (!result.ok) {
    Toast.error(result.message);
    return;
  }

  saving.value = true;
  try {
    await footprintApiClient.footprint.updateFootprint(props.footprint.metadata.name, {
      ...props.footprint,
      spec: {
        ...props.footprint.spec,
        longitude: result.longitude,
        latitude: result.latitude,
      },
    });
    Toast.success("经纬度更新成功");
    close();
    emit("updated");
  } catch (error) {
    console.error("更新经纬度失败:", error);
    Toast.error("更新经纬度失败");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <VModal
      :visible="visible"
      :width="500"
      title="手动修正经纬度"
      :mask-closable="false"
      @update:visible="emit('update:visible', $event)"
    >
      <FormKit type="form" :actions="false" @submit.prevent>
        <FormKit
          v-model="longitude"
          name="longitude"
          label="经度"
          type="number"
          step="0.000001"
          validation="required|between:-180,180"
          help="取值范围 -180 到 180"
        />
        <FormKit
          v-model="latitude"
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
          <VButton type="secondary" @click="close">取消</VButton>
          <VButton type="primary" :loading="saving" @click="submit">确定</VButton>
        </VSpace>
      </template>
    </VModal>
  </Teleport>
</template>
