<script setup lang="ts">
/**
 * 行程/集合成员选择器。
 *
 * 成员值始终是 Footprint.metadata.name；展示顺序只由访问时间决定，不允许拖动。
 */
import { computed, ref, watch } from "vue";
import RiAddLine from "~icons/ri/add-line";
import RiCloseLine from "~icons/ri/close-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import type { Footprint } from "@/api/models";
import {
  MAX_GROUP_MEMBERS,
  sortFootprintsByVisitTime,
  uniqueMemberNames,
  visitTimeOf,
} from "@/utils/footprint-groups";
import { formatDatetime } from "@/utils/date";

const props = defineProps<{
  modelValue: string[];
  footprints: Footprint[];
  max?: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const query = ref("");
const limitMessage = ref("");
const footprintMap = computed(
  () => new Map(props.footprints.map((footprint) => [footprint.metadata.name, footprint])),
);
const selectedNames = computed(() => uniqueMemberNames(props.modelValue));
const selectedMembers = computed(() =>
  sortFootprintsByVisitTime(
    selectedNames.value
      .map((name) => footprintMap.value.get(name))
      .filter((item): item is Footprint => !!item),
  ),
);

const searchResults = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return sortFootprintsByVisitTime(props.footprints)
    .filter((footprint) => {
      if (!keyword) return true;
      return [
        footprint.spec.name,
        footprint.spec.city,
        footprint.spec.province,
        footprint.spec.address,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    })
    .slice(0, 80);
});

watch(
  () => props.modelValue,
  () => {
    limitMessage.value = "";
  },
);

function isSelected(name: string) {
  return selectedNames.value.includes(name);
}

function toggle(name: string, selected: boolean) {
  const next = new Set(selectedNames.value);
  if (selected) {
    if (next.size >= (props.max || MAX_GROUP_MEMBERS)) {
      limitMessage.value = `最多选择 ${props.max || MAX_GROUP_MEMBERS} 条足迹`;
      return;
    }
    next.add(name);
  } else {
    next.delete(name);
  }
  limitMessage.value = "";
  emit("update:modelValue", [...next]);
}

function remove(name: string) {
  toggle(name, false);
}

function addVisible() {
  const next = new Set(selectedNames.value);
  const max = props.max || MAX_GROUP_MEMBERS;
  for (const footprint of searchResults.value) {
    if (next.size >= max) break;
    next.add(footprint.metadata.name);
  }
  limitMessage.value =
    searchResults.value.some((footprint) => !next.has(footprint.metadata.name)) && next.size >= max
      ? `最多选择 ${max} 条足迹`
      : "";
  emit("update:modelValue", [...next]);
}
</script>

<template>
  <div class="fp-group-members">
    <div class="fp-group-members-head">
      <div>
        <strong>已选 {{ selectedNames.length }} 条</strong>
        <span>最多 {{ max || MAX_GROUP_MEMBERS }} 条，按访问时间自动排序</span>
      </div>
      <span v-if="limitMessage" class="fp-group-limit" role="status">{{ limitMessage }}</span>
    </div>

    <ul v-if="selectedMembers.length" class="fp-group-selected" aria-label="已选择的足迹">
      <li v-for="(member, index) in selectedMembers" :key="member.metadata.name">
        <span class="fp-group-member-index" aria-hidden="true">{{ index + 1 }}</span>
        <div>
          <strong>{{ member.spec.name }}</strong>
          <span>
            {{
              [member.spec.city, member.spec.province].filter(Boolean).join(" / ") || "未解析地区"
            }}
            <template v-if="visitTimeOf(member)"
              >，{{ formatDatetime(visitTimeOf(member)) }}</template
            >
          </span>
        </div>
        <button
          type="button"
          class="fp-icon-button"
          :aria-label="`移除 ${member.spec.name}`"
          @click="remove(member.metadata.name)"
        >
          <RiCloseLine width="15" height="15" />
        </button>
      </li>
    </ul>
    <p v-else class="fp-group-selected-empty">
      {{ footprints.length ? "还没有选择成员" : "还没有可选择的足迹" }}
    </p>

    <div v-if="footprints.length" class="fp-group-picker">
      <div class="fp-group-picker-toolbar">
        <input
          v-model="query"
          type="search"
          placeholder="搜索名称、城市、省份或地址"
          aria-label="搜索足迹"
        />
        <button type="button" class="fp-button is-small" @click="addVisible">
          <RiAddLine width="14" height="14" aria-hidden="true" />
          加入当前结果
        </button>
      </div>
      <div class="fp-group-picker-list" role="group" aria-label="可选足迹">
        <label
          v-for="footprint in searchResults"
          :key="footprint.metadata.name"
          class="fp-group-picker-item"
          :class="{ 'is-selected': isSelected(footprint.metadata.name) }"
        >
          <input
            type="checkbox"
            :checked="isSelected(footprint.metadata.name)"
            @change="toggle(footprint.metadata.name, ($event.target as HTMLInputElement).checked)"
          />
          <RiMapPinLine width="16" height="16" aria-hidden="true" />
          <span>
            <strong>{{ footprint.spec.name }}</strong>
            <small>
              {{
                [footprint.spec.city, footprint.spec.province].filter(Boolean).join(" / ") ||
                "未解析地区"
              }}
              <template v-if="visitTimeOf(footprint)"
                >，{{ formatDatetime(visitTimeOf(footprint)) }}</template
              >
            </small>
          </span>
        </label>
        <p v-if="!searchResults.length" class="fp-group-picker-empty">没有匹配的足迹</p>
      </div>
    </div>
  </div>
</template>
