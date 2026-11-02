<script setup lang="ts">
/**
 * 旅程/收藏成员选择器。
 *
 * 左侧筛选和选择足迹，右侧持续展示已选路线。旅程按访问时间排序；
 * 收藏选择手动顺序时，可在右侧拖拽或使用方向键调整。
 */
import { computed, ref, watch } from "vue";
import RiAddLine from "~icons/ri/add-line";
import RiCloseLine from "~icons/ri/close-line";
import RiDragMoveLine from "~icons/ri/drag-move-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import type { Footprint, Option } from "@/api/models";
import {
  MAX_GROUP_MEMBERS,
  groupRange,
  sortFootprintsForGroup,
  sortFootprintsByVisitTime,
  uniqueMemberNames,
  visitTimeOf,
} from "@/utils/footprint-groups";
import { formatDatetime } from "@/utils/date";

const props = defineProps<{
  modelValue: string[];
  footprints: Footprint[];
  footprintTypes?: Option[];
  groupType?: "trip" | "collection";
  max?: number;
  orderMode?: "time" | "manual";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const query = ref("");
const filterType = ref("");
const filterYear = ref("");
const activePane = ref<"browse" | "selected">("browse");
const limitMessage = ref("");
const draggedName = ref("");
const dragOverName = ref("");

const footprintMap = computed(
  () => new Map(props.footprints.map((footprint) => [footprint.metadata.name, footprint])),
);
const selectedNames = computed(() => uniqueMemberNames(props.modelValue));
const selectedMembers = computed(() =>
  sortFootprintsForGroup(
    {
      apiVersion: "footprint.lik.cc/v1alpha1",
      kind: "FootprintGroup",
      metadata: { name: "picker" },
      spec: {
        groupType: props.groupType || (props.orderMode === "manual" ? "collection" : "trip"),
        memberOrderMode: props.orderMode === "manual" ? "manual" : "time",
        title: "picker",
        visibility: "private",
        memberNames: selectedNames.value,
      },
    },
    selectedNames.value
      .map((name) => footprintMap.value.get(name))
      .filter((item): item is Footprint => !!item),
  ),
);
const range = computed(() => groupRange(selectedMembers.value));
const firstMember = computed(() => selectedMembers.value[0]);
const lastMember = computed(() => selectedMembers.value[selectedMembers.value.length - 1]);
const selectedLabel = computed(() =>
  props.groupType === "collection" || props.orderMode === "manual" ? "已选收藏" : "已选路线",
);

const years = computed(() =>
  [
    ...new Set(
      props.footprints
        .map((footprint) => visitTimeOf(footprint).slice(0, 4))
        .filter((year) => /^\d{4}$/.test(year)),
    ),
  ].sort((a, b) => b.localeCompare(a)),
);

const searchResults = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return sortFootprintsByVisitTime(props.footprints)
    .filter((footprint) => {
      if (filterType.value && footprint.spec.footprintType !== filterType.value) return false;
      if (filterYear.value && visitTimeOf(footprint).slice(0, 4) !== filterYear.value) return false;
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
    .slice(0, 120);
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

function footprintImage(footprint: Footprint): string {
  const gallery = Array.isArray(footprint.spec.galleryImages) ? footprint.spec.galleryImages : [];
  for (const image of gallery) {
    const url = typeof image === "string" ? image : image?.url;
    if (url) return url;
  }
  return footprint.spec.image || "";
}

function footprintTypeLabel(value: string): string {
  return (props.footprintTypes || []).find((type) => type.value === value)?.label || value;
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

function move(name: string, delta: number) {
  if (props.orderMode !== "manual") return;
  const ordered = selectedMembers.value.map((member) => member.metadata.name);
  const index = ordered.indexOf(name);
  const nextIndex = index + delta;
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
  [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
  emit("update:modelValue", ordered);
}

function startSelectedDrag(event: DragEvent, member: Footprint) {
  if (props.orderMode !== "manual") {
    event.preventDefault();
    return;
  }
  draggedName.value = member.metadata.name;
  dragOverName.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", member.metadata.name);
  }
}

function dragOverSelected(event: DragEvent, member: Footprint) {
  if (props.orderMode !== "manual" || !draggedName.value) return;
  if (draggedName.value === member.metadata.name) return;
  event.preventDefault();
  dragOverName.value = member.metadata.name;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

function dropSelected(event: DragEvent, target: Footprint) {
  if (props.orderMode !== "manual") return;
  event.preventDefault();
  const sourceName = draggedName.value || event.dataTransfer?.getData("text/plain") || "";
  draggedName.value = "";
  dragOverName.value = "";
  if (!sourceName || sourceName === target.metadata.name) return;
  const ordered = selectedMembers.value.map((member) => member.metadata.name);
  const from = ordered.indexOf(sourceName);
  const to = ordered.indexOf(target.metadata.name);
  if (from < 0 || to < 0) return;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  emit("update:modelValue", ordered);
}

function endSelectedDrag() {
  draggedName.value = "";
  dragOverName.value = "";
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

function clearSelection() {
  emit("update:modelValue", []);
}
</script>

<template>
  <div class="fp-member-workbench" :data-pane="activePane">
    <div class="fp-member-mobile-tabs" role="group" aria-label="成员选择视图">
      <button type="button" :aria-pressed="activePane === 'browse'" @click="activePane = 'browse'">
        选择足迹
      </button>
      <button
        type="button"
        :aria-pressed="activePane === 'selected'"
        @click="activePane = 'selected'"
      >
        {{ selectedLabel }} {{ selectedMembers.length }}
      </button>
    </div>
    <span v-if="limitMessage" class="fp-group-limit fp-member-limit" role="status">
      {{ limitMessage }}
    </span>

    <section class="fp-member-browse" aria-label="选择足迹">
      <header class="fp-member-pane-head">
        <div>
          <h4>选择足迹</h4>
          <span>{{ searchResults.length }} 条可选</span>
        </div>
        <button type="button" class="fp-button is-small" @click="addVisible">
          <RiAddLine width="14" height="14" aria-hidden="true" />
          加入筛选结果
        </button>
      </header>

      <div class="fp-member-browse-tools">
        <div class="fp-member-search">
          <input
            v-model="query"
            type="search"
            placeholder="搜索名称、城市、省份或地址"
            aria-label="搜索足迹"
          />
        </div>

        <div class="fp-member-filters">
          <select v-model="filterType" aria-label="按足迹类型筛选">
            <option value="">全部类型</option>
            <option v-for="type in footprintTypes || []" :key="type.value" :value="type.value">
              {{ type.label }}
            </option>
          </select>
          <select v-model="filterYear" aria-label="按年份筛选">
            <option value="">全部年份</option>
            <option v-for="year in years" :key="year" :value="year">{{ year }}</option>
          </select>
        </div>
      </div>

      <div class="fp-member-result-list" role="group" aria-label="可选足迹">
        <label
          v-for="footprint in searchResults"
          :key="footprint.metadata.name"
          class="fp-member-result"
          :class="{ 'is-selected': isSelected(footprint.metadata.name) }"
        >
          <input
            type="checkbox"
            :checked="isSelected(footprint.metadata.name)"
            @change="toggle(footprint.metadata.name, ($event.target as HTMLInputElement).checked)"
          />
          <span class="fp-member-thumb">
            <img
              v-if="footprintImage(footprint)"
              :src="footprintImage(footprint)"
              alt=""
              loading="lazy"
            />
            <RiMapPinLine v-else width="16" height="16" aria-hidden="true" />
          </span>
          <span class="fp-member-result-copy">
            <span class="fp-member-result-title">
              <strong>{{ footprint.spec.name }}</strong>
              <span v-if="footprint.spec.footprintType" class="fp-tag">
                {{ footprintTypeLabel(footprint.spec.footprintType) }}
              </span>
            </span>
            <small>
              {{
                [footprint.spec.city, footprint.spec.province].filter(Boolean).join(" / ") ||
                "未解析地区"
              }}
            </small>
            <time v-if="visitTimeOf(footprint)" :datetime="visitTimeOf(footprint)">
              {{ formatDatetime(visitTimeOf(footprint)) }}
            </time>
          </span>
        </label>
        <p v-if="!searchResults.length" class="fp-group-picker-empty">没有匹配的足迹</p>
      </div>
    </section>

    <section class="fp-member-selected" aria-label="已选择的足迹">
      <header class="fp-member-pane-head">
        <div>
          <h4>{{ selectedLabel }}</h4>
          <span>{{ selectedMembers.length }} 条</span>
        </div>
        <button
          v-if="selectedMembers.length"
          type="button"
          class="fp-button is-small"
          @click="clearSelection"
        >
          清空
        </button>
      </header>

      <div v-if="selectedMembers.length" class="fp-member-route-summary">
        <div>
          <span>{{ groupType === "collection" ? "首项" : "起点" }}</span>
          <strong>{{ firstMember?.spec.name }}</strong>
        </div>
        <span class="fp-member-route-arrow" aria-hidden="true">→</span>
        <div>
          <span>{{ groupType === "collection" ? "末项" : "终点" }}</span>
          <strong>{{ lastMember?.spec.name }}</strong>
        </div>
        <small v-if="range.start && range.end">
          {{ formatDatetime(range.start).slice(0, 10) }} 至
          {{ formatDatetime(range.end).slice(0, 10) }}，{{ range.days }} 天
        </small>
      </div>

      <ol v-if="selectedMembers.length" class="fp-member-selected-list">
        <li
          v-for="(member, index) in selectedMembers"
          :key="member.metadata.name"
          :class="{
            'is-dragging': draggedName === member.metadata.name,
            'is-drag-over': dragOverName === member.metadata.name,
            'has-drag-handle': orderMode === 'manual',
          }"
          @dragover="dragOverSelected($event, member)"
          @drop="dropSelected($event, member)"
        >
          <button
            v-if="orderMode === 'manual'"
            type="button"
            class="fp-member-drag-handle"
            draggable="true"
            :aria-label="`拖动调整 ${member.spec.name} 的顺序`"
            @dragstart="startSelectedDrag($event, member)"
            @dragend="endSelectedDrag"
            @keydown.up.prevent="move(member.metadata.name, -1)"
            @keydown.down.prevent="move(member.metadata.name, 1)"
          >
            <RiDragMoveLine width="15" height="15" aria-hidden="true" />
          </button>
          <span class="fp-group-member-index" aria-hidden="true">{{ index + 1 }}</span>
          <span class="fp-member-thumb">
            <img
              v-if="footprintImage(member)"
              :src="footprintImage(member)"
              alt=""
              loading="lazy"
            />
            <RiMapPinLine v-else width="16" height="16" aria-hidden="true" />
          </span>
          <span class="fp-member-result-copy">
            <strong>{{ member.spec.name }}</strong>
            <small>{{
              [member.spec.city, member.spec.province].filter(Boolean).join(" / ")
            }}</small>
            <time v-if="visitTimeOf(member)" :datetime="visitTimeOf(member)">
              {{ formatDatetime(visitTimeOf(member)) }}
            </time>
          </span>
          <button
            type="button"
            class="fp-icon-button"
            :aria-label="`移除 ${member.spec.name}`"
            @click="remove(member.metadata.name)"
          >
            <RiCloseLine width="15" height="15" />
          </button>
        </li>
      </ol>
      <p v-else class="fp-group-selected-empty">
        {{ footprints.length ? "还没有选择成员" : "还没有可选择的足迹" }}
      </p>
    </section>
  </div>
</template>
