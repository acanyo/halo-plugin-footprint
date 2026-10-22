<script setup lang="ts">
/**
 * 足迹编辑窗 · 基本信息分组。
 *
 * 名称 / 描述 / 地址 / 位置 / 三类图片。位置这一块只负责显示与触发，
 * 「地图选点」和「重新解析省市」都由父级处理 —— 选点要开的是一个独立的
 * 高德地图弹窗，逆地理编码要走接口，都不属于表单渲染。
 */

import { VButton } from "@halo-dev/components";
import RiMapPin2Line from "~icons/ri/map-pin-2-line";
import type { FootprintSpec } from "@/api/models";

defineProps<{
  hasCoordinate: boolean;
  awaitingGeocode: boolean;
  validationMessages: Record<string, (ctx: { name: string }) => string>;
}>();

const spec = defineModel<FootprintSpec>("spec", { required: true });
const galleryImageUrls = defineModel<string[]>("galleryImageUrls", { required: true });

const emit = defineEmits<{
  (e: "open-map-picker"): void;
  (e: "reparse"): void;
}>();
</script>

<template>
  <div class="md:grid md:grid-cols-4 md:gap-6">
    <div class="md:col-span-1">
      <div class="sticky top-0 pt-1">
        <span class="text-sm font-semibold text-gray-700">基本信息</span>
      </div>
    </div>
    <div class="divide-y divide-gray-100 md:col-span-3" style="margin-top: 10px">
      <FormKit
        v-model="spec.name"
        type="text"
        name="足迹名称"
        validation="required"
        :validation-messages="validationMessages"
        label="足迹名称"
        placeholder="输入足迹名称"
      />
      <FormKit
        v-model="spec.description"
        type="textarea"
        name="足迹描述"
        validation="required"
        :validation-messages="validationMessages"
        label="足迹描述"
        :rows="3"
        placeholder="描述一下这个足迹吧"
      />
      <FormKit
        v-model="spec.address"
        type="text"
        validation="required"
        name="address"
        label="地址"
        help="建议格式：市+地址，如杭州市灵隐寺，系统会根据地址自动获取经纬度"
        placeholder="输入详细地址"
      />

      <!-- 位置：地图选点是主路径，省/市由选点结果带出 -->
      <div class="formkit-outer py-5" data-type="text">
        <label class="formkit-label">位置</label>
        <div class="w-full" style="max-width: 31em">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm">
              <span v-if="hasCoordinate" class="tabular-nums text-gray-900">
                {{ spec.longitude }}, {{ spec.latitude }}
              </span>
              <span v-else class="text-gray-400">未选点，保存时将按地址自动解析</span>
            </div>
            <VButton size="sm" @click="emit('open-map-picker')">
              <template #icon>
                <RiMapPin2Line class="h-full w-full" />
              </template>
              地图选点
            </VButton>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <div class="min-w-0 flex-1 rounded border border-gray-300 bg-gray-50 px-3 py-1.5 text-sm">
              <span v-if="spec.province" class="text-gray-900">
                {{ [spec.province, spec.city].filter(Boolean).join(" · ") }}
              </span>
              <span v-else class="text-gray-400">省 / 市未解析</span>
            </div>
            <VButton
              size="sm"
              :loading="awaitingGeocode"
              :disabled="!hasCoordinate"
              @click="emit('reparse')"
            >
              重新解析
            </VButton>
          </div>
        </div>
        <p class="formkit-help">
          点「地图选点」可直接在地图上确定位置，省 / 市会一并解析，无需先保存。
        </p>
      </div>

      <FormKit v-model="spec.image" :type="'attachment' as any" name="image" label="足迹图片" />
      <FormKit
        v-model="spec.ticketImage"
        :type="'attachment' as any"
        name="ticketImage"
        label="票根图片"
        help="每个足迹最多上传一张票根，票根墙只展示已配置票根的足迹"
      />
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
      />
    </div>
  </div>
</template>
