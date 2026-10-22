<script setup lang="ts">
/**
 * 足迹编辑窗 · 地图设置分组。
 *
 * 缩放级别始终显示；俯仰与旋转只在缩放 ≥ 18 时出现（3D 效果在那之前没有意义）。
 * 显示条件由 utils/footprint-form 的 shouldShowPitchAngle 决定，与校验口径共用一处。
 */

import type { FootprintSpec } from "@/api/models";

defineProps<{
  showPitchAngle: boolean;
}>();

const spec = defineModel<FootprintSpec>("spec", { required: true });
</script>

<template>
  <div class="mt-8 md:grid md:grid-cols-4 md:gap-6">
    <div class="md:col-span-1">
      <div class="sticky top-0 pt-1">
        <span class="text-sm font-semibold text-gray-700">地图设置</span>
      </div>
    </div>
    <div class="divide-y divide-gray-100 md:col-span-3">
      <FormKit
        v-model="spec.zoomLevel"
        type="number"
        name="zoomLevel"
        label="缩放级别"
        validation="required|number|between:4,26"
        validation-visibility="live"
        :validation-messages="{
          required: '缩放级别不能为空',
          between: '缩放级别必须在4到26之间',
        }"
        help="标记的放大级别，4-26（支持两位小数），≥18时可开启3D效果"
        min="4"
        max="26"
        step="0.01"
      />
      <FormKit
        v-if="showPitchAngle"
        v-model="spec.pitchAngle"
        type="number"
        name="pitchAngle"
        label="3D 俯仰角度"
        validation="required|number|between:0,83"
        validation-visibility="live"
        :validation-messages="{
          required: '俯仰角不能为空',
          between: '俯仰角必须在0到83之间',
        }"
        help="3D 视图的俯仰角度，范围 0-83"
        min="0"
        max="90"
        step="1"
      />
      <FormKit
        v-if="showPitchAngle"
        v-model="spec.rotationAngle"
        type="number"
        name="rotationAngle"
        label="3D 旋转角度"
        validation="required|number|between:-360,360"
        validation-visibility="live"
        :validation-messages="{
          required: '旋转角不能为空',
          between: '旋转角必须在-360到360之间',
        }"
        help="3D 视图的旋转角度，范围 -360 到 360"
        min="-360"
        max="360"
        step="1"
      />
    </div>
  </div>
</template>
