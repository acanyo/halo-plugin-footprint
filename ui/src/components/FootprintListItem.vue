<script setup lang="ts">
/**
 * 足迹列表项。
 *
 * 从管理页模板里抽出来的单行视图：勾选框、封面、名称/地址/类型、省市、
 * 经纬度、创建时间，外加右侧的下拉操作。只负责渲染一条足迹并把动作原样
 * 抛给父级，自己不做任何请求，也不持有状态 —— 这样列表页和以后可能出现的
 * 筛选预览都能直接复用。
 */

import RiImageLine from "~icons/ri/image-line";
import { VDropdownItem, VEntity, VEntityField, VSpace, VStatusDot, VTag } from "@halo-dev/components";
import { formatDatetime } from "@/utils/date";
import type { Footprint } from "@/api/models";

defineProps<{
  footprint: Footprint;
  selected: boolean;
  geocoding: boolean;
}>();

const emit = defineEmits<{
  (e: "update:selected", value: boolean): void;
  (e: "edit", footprint: Footprint): void;
  (e: "update-location", footprint: Footprint): void;
  (e: "geocode", footprint: Footprint): void;
}>();
</script>

<template>
  <VEntity :is-selected="selected">
    <template #checkbox>
      <input
        :checked="selected"
        type="checkbox"
        @change="emit('update:selected', ($event.target as HTMLInputElement).checked)"
      />
    </template>
    <template #start>
      <VEntityField>
        <template #description>
          <div class="h-10 w-10 overflow-hidden rounded border bg-white p-1">
            <img
              v-if="footprint.spec.image"
              :src="footprint.spec.image"
              class="h-full w-full rounded-sm object-cover"
              alt=""
            />
            <RiImageLine v-else class="h-full w-full text-gray-300" />
          </div>
        </template>
      </VEntityField>
      <VEntityField :title="footprint.spec.name">
        <template #description>
          <VSpace class="flex-wrap">
            <span class="text-xs text-gray-500">{{ footprint.spec.address }}</span>
            <VTag v-if="footprint.spec.footprintType">
              {{ footprint.spec.footprintType }}
            </VTag>
          </VSpace>
        </template>
      </VEntityField>
    </template>
    <template #end>
      <VEntityField v-if="footprint.metadata.deletionTimestamp">
        <template #description>
          <VStatusDot v-tooltip="'删除中'" state="warning" animate />
        </template>
      </VEntityField>
      <VEntityField>
        <template #description>
          <span
            class="text-xs"
            :class="footprint.spec.province ? 'text-gray-500' : 'text-gray-300'"
          >
            {{
              [footprint.spec.province, footprint.spec.city].filter(Boolean).join(" · ") ||
              "省 / 市未解析"
            }}
          </span>
        </template>
      </VEntityField>
      <VEntityField>
        <template #description>
          <span class="truncate text-xs tabular-nums text-gray-500">
            {{ footprint.spec.longitude }}, {{ footprint.spec.latitude }}
          </span>
        </template>
      </VEntityField>
      <VEntityField>
        <template #description>
          <span class="truncate text-xs tabular-nums text-gray-500">
            {{ formatDatetime(footprint.spec.createTime) }}
          </span>
        </template>
      </VEntityField>
    </template>
    <template #dropdownItems>
      <VDropdownItem @click="emit('edit', footprint)">编辑</VDropdownItem>
      <VDropdownItem @click="emit('update-location', footprint)">
        手动修正经纬度
      </VDropdownItem>
      <VDropdownItem :disabled="geocoding" @click="emit('geocode', footprint)">
        重新解析省/市
      </VDropdownItem>
    </template>
  </VEntity>
</template>
