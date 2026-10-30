<script setup lang="ts">
/**
 * 足迹列表项。
 *
 * 单行视图：勾选框、封面、名称/地址/类型、省市、经纬度、创建时间，外加右侧操作。
 * 只负责渲染一条足迹并把动作原样抛给父级，自己不做任何请求，也不持有状态。
 */

import { VDropdown, VDropdownItem } from "@halo-dev/components";
import RiImageLine from "~icons/ri/image-line";
import RiMore2Line from "~icons/ri/more-2-line";
import RiPencilLine from "~icons/ri/pencil-line";
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
  <li class="fp-row" :class="{ 'is-selected': selected }">
    <input
      :checked="selected"
      type="checkbox"
      :aria-label="`选择 ${footprint.spec.name}`"
      @change="emit('update:selected', ($event.target as HTMLInputElement).checked)"
    />
    <span class="fp-row-thumb">
      <img v-if="footprint.spec.image" :src="footprint.spec.image" alt="" loading="lazy" />
      <RiImageLine v-else width="18" height="18" aria-hidden="true" />
    </span>

    <div class="fp-row-main">
      <div class="fp-row-title">
        <button type="button" @click="emit('edit', footprint)">{{ footprint.spec.name }}</button>
        <span v-if="footprint.spec.footprintType" class="fp-tag">
          {{ footprint.spec.footprintType }}
        </span>
        <span
          v-if="footprint.metadata.deletionTimestamp"
          v-tooltip="'删除中'"
          class="fp-status-dot is-warning"
        />
      </div>
      <p class="fp-row-sub">{{ footprint.spec.address || "未填写地址" }}</p>
    </div>

    <span class="fp-row-cell" :class="{ 'is-missing': !footprint.spec.province }">
      {{
        [footprint.spec.province, footprint.spec.city].filter(Boolean).join(" · ") ||
        "省 / 市未解析"
      }}
    </span>
    <span class="fp-row-cell is-coords fp-num">
      {{ footprint.spec.longitude }}, {{ footprint.spec.latitude }}
    </span>
    <span class="fp-row-cell is-date fp-num">
      {{ formatDatetime(footprint.spec.createTime) }}
    </span>

    <div class="fp-row-actions">
      <button
        v-tooltip="'编辑'"
        type="button"
        class="fp-icon-button"
        aria-label="编辑"
        @click="emit('edit', footprint)"
      >
        <RiPencilLine width="16" height="16" />
      </button>
      <VDropdown>
        <button type="button" class="fp-icon-button" aria-label="更多操作">
          <RiMore2Line width="16" height="16" />
        </button>
        <template #popper>
          <VDropdownItem @click="emit('update-location', footprint)">手动修正经纬度</VDropdownItem>
          <VDropdownItem :disabled="geocoding" @click="emit('geocode', footprint)">
            重新解析省 / 市
          </VDropdownItem>
        </template>
      </VDropdown>
    </div>
  </li>
</template>
