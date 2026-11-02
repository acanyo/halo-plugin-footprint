<script setup lang="ts">
/** 足迹管理页的“我的旅途集”面板。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Dialog, IconRefreshLine, Toast, VButton, VLoading } from "@halo-dev/components";
import RiDeleteBinLine from "~icons/ri/delete-bin-line";
import RiDragMoveLine from "~icons/ri/drag-move-line";
import RiExternalLinkLine from "~icons/ri/external-link-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiPencilLine from "~icons/ri/pencil-line";
import type { Footprint, FootprintGroup, Option } from "@/api/models";
import { footprintApiClient } from "@/api";
import {
  GROUP_PINNED_ANNOTATION,
  GROUP_SORT_ORDER_ANNOTATION,
  isGroupPinned,
  sortGroupSummaries,
  summarizeGroup,
  type FootprintGroupSummary,
} from "@/utils/footprint-groups";
import FootprintGroupEditingModal from "./FootprintGroupEditingModal.vue";

const groups = ref<FootprintGroup[]>([]);
const footprints = ref<Footprint[]>([]);
const footprintTypes = ref<Option[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref("");
const query = ref("");
const filterType = ref<"all" | "trip" | "collection">("all");

const editorVisible = ref(false);
const editingGroup = ref<FootprintGroup>();
const draftMemberNames = ref<string[]>([]);
const highlightedKey = ref("");
const selectedNames = ref<string[]>([]);
const reordering = ref(false);
const draggedName = ref("");
const dragOverName = ref("");
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let editorWasCreate = false;
let editorStartScroll = 0;

const footprintMap = computed(
  () => new Map(footprints.value.map((footprint) => [footprint.metadata.name, footprint])),
);
const summaries = computed(() =>
  sortGroupSummaries(groups.value.map((group) => summarizeGroup(group, footprintMap.value))),
);
const filteredSummaries = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return summaries.value.filter((summary) => {
    if (filterType.value !== "all" && summary.group.spec.groupType !== filterType.value) {
      return false;
    }
    if (!keyword) return true;
    return [
      summary.group.spec.title,
      summary.group.spec.description,
      ...(summary.group.spec.footprintTypes || []),
      ...summary.searchTerms,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });
});
const groupCounts = computed(() => ({
  all: summaries.value.length,
  trip: summaries.value.filter((summary) => summary.group.spec.groupType === "trip").length,
  collection: summaries.value.filter((summary) => summary.group.spec.groupType === "collection")
    .length,
}));
const selectedSummaries = computed(() =>
  summaries.value.filter((summary) => selectedNames.value.includes(summary.group.metadata.name)),
);

function formatRange(summary: FootprintGroupSummary) {
  if (summary.group.spec.groupType === "collection") {
    const latest = summary.range.end || summary.group.metadata.creationTimestamp;
    return latest
      ? `最近收录 ${String(latest).slice(0, 10).replace(/-/g, ".")}`
      : "尚无收录时间";
  }
  if (!summary.range.start || !summary.range.end) return "尚无访问时间";
  const start = summary.range.start.slice(0, 10).replace(/-/g, ".");
  const end = summary.range.end.slice(0, 10).replace(/-/g, ".");
  if (start === end) return `${start}，1 天`;
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${start.slice(5)} - ${end.slice(5)}，${summary.range.days} 天`;
  }
  return `${start} - ${end}，${summary.range.days} 天`;
}

function typeLabel(summary: FootprintGroupSummary) {
  return summary.group.spec.groupType === "trip" ? "旅程" : "收藏";
}

function progressText(summary: FootprintGroupSummary) {
  const count = summary.memberCount;
  const target = Number(summary.group.spec.targetCount);
  return Number.isFinite(target) && target > 0 ? `${count} / ${target}` : `${count} 条`;
}

function openFrontend(summary: FootprintGroupSummary) {
  window.open(
    `/footprints?view=groups&group=${encodeURIComponent(summary.group.metadata.name)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

function coverStyle(summary: FootprintGroupSummary) {
  const focus = ["top", "bottom", "left", "right"].includes(
    String(summary.group.spec.coverFocus || ""),
  )
    ? summary.group.spec.coverFocus
    : "center";
  return { objectPosition: focus };
}

function toggleSelected(name: string, checked: boolean) {
  const next = new Set(selectedNames.value);
  if (checked) next.add(name);
  else next.delete(name);
  selectedNames.value = [...next];
}

function clearSelection() {
  selectedNames.value = [];
}

async function openCreate(memberNames: string[] = []) {
  while (loading.value) await new Promise((resolve) => setTimeout(resolve, 30));
  await ensureFootprints();
  editingGroup.value = undefined;
  draftMemberNames.value = [...new Set(memberNames)];
  editorWasCreate = true;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
}

async function openEdit(summary: FootprintGroupSummary) {
  await ensureFootprints();
  editingGroup.value = summary.group;
  draftMemberNames.value = [];
  editorWasCreate = false;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
}

async function ensureFootprints() {
  if (footprints.value.length) return;
  footprints.value = await footprintApiClient.footprint.listAllFootprints();
}

async function load(manual = false) {
  if (loading.value || refreshing.value) return;
  if (manual) refreshing.value = true;
  else loading.value = true;
  errorMessage.value = "";
  try {
    const [nextGroups, nextFootprints, nextTypes] = await Promise.all([
      footprintApiClient.footprint.listAllFootprintGroups(),
      footprintApiClient.footprint.listAllFootprints(),
      footprintApiClient.footprint.listFootprintTypes(),
    ]);
    groups.value = nextGroups;
    footprints.value = nextFootprints;
    footprintTypes.value = nextTypes;
    selectedNames.value = selectedNames.value.filter((name) =>
      nextGroups.some((group) => group.metadata.name === name),
    );
  } catch (error) {
    console.error("读取旅途集失败", error);
    errorMessage.value = "读取旅途集失败，请稍后重试。";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function confirmDelete(summary: FootprintGroupSummary) {
  Dialog.warning({
    title: `删除${typeLabel(summary)}`,
    description: `确认删除“${summary.group.spec.title}”吗？成员足迹不会被删除，旅途集删除后无法撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprintGroup(summary.group.metadata.name);
        toggleSelected(summary.group.metadata.name, false);
        Toast.success("已删除");
        await load(true);
      } catch (error) {
        console.error("删除旅程或收藏失败", error);
        Toast.error("删除失败");
      }
    },
  });
}

async function updateGroupSpec(group: FootprintGroup, patch: Partial<FootprintGroup["spec"]>) {
  return footprintApiClient.footprint.updateFootprintGroup(group.metadata.name, {
    ...group,
    spec: { ...group.spec, ...patch },
  });
}

async function updateGroupAnnotations(
  group: FootprintGroup,
  patch: { pinned?: boolean; sortOrder?: number },
) {
  const annotations = { ...(group.metadata.annotations || {}) };
  if (patch.pinned !== undefined) {
    annotations[GROUP_PINNED_ANNOTATION] = String(patch.pinned);
  }
  if (patch.sortOrder !== undefined) {
    annotations[GROUP_SORT_ORDER_ANNOTATION] = String(patch.sortOrder);
  }
  return footprintApiClient.footprint.updateFootprintGroup(group.metadata.name, {
    ...group,
    metadata: { ...group.metadata, annotations },
  });
}

async function togglePinned(summary: FootprintGroupSummary) {
  try {
    const nextPinned = !isGroupPinned(summary.group);
    await updateGroupAnnotations(summary.group, { pinned: nextPinned });
    await load(true);
    highlightedKey.value = summary.group.metadata.name;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedKey.value = "";
    }, 2400);
    Toast.success(nextPinned ? "已置顶" : "已取消置顶");
  } catch (error) {
    console.error("更新置顶状态失败", error);
    Toast.error("更新置顶状态失败");
  }
}

async function moveGroup(summary: FootprintGroupSummary, delta: number) {
  if (reordering.value) return;
  const ordered = summaries.value;
  const index = ordered.findIndex(
    (item) => item.group.metadata.name === summary.group.metadata.name,
  );
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  if (
    (ordered[index].group.spec.pinned === true) !==
    (ordered[target].group.spec.pinned === true)
  ) {
    return;
  }
  reordering.value = true;
  try {
    const next = ordered.slice();
    [next[index], next[target]] = [next[target], next[index]];
    await Promise.all(
      next.map((item, order) => updateGroupAnnotations(item.group, { sortOrder: order + 1 })),
    );
    await load(true);
    Toast.success("顺序已更新");
  } catch (error) {
    console.error("更新旅途集顺序失败", error);
    Toast.error("更新顺序失败");
  } finally {
    reordering.value = false;
  }
}

function startGroupDrag(event: DragEvent, summary: FootprintGroupSummary) {
  if (reordering.value) {
    event.preventDefault();
    return;
  }
  draggedName.value = summary.group.metadata.name;
  dragOverName.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", summary.group.metadata.name);
  }
}

function dragOverGroup(event: DragEvent, summary: FootprintGroupSummary) {
  if (!draggedName.value || draggedName.value === summary.group.metadata.name) return;
  const source = summaries.value.find((item) => item.group.metadata.name === draggedName.value);
  if (!source || isGroupPinned(source.group) !== isGroupPinned(summary.group)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    return;
  }
  event.preventDefault();
  dragOverName.value = summary.group.metadata.name;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

async function dropGroup(event: DragEvent, target: FootprintGroupSummary) {
  event.preventDefault();
  const sourceName = draggedName.value || event.dataTransfer?.getData("text/plain") || "";
  dragOverName.value = "";
  draggedName.value = "";
  if (!sourceName || sourceName === target.group.metadata.name || reordering.value) return;
  const ordered = summaries.value;
  const sourceIndex = ordered.findIndex((item) => item.group.metadata.name === sourceName);
  const targetIndex = ordered.findIndex(
    (item) => item.group.metadata.name === target.group.metadata.name,
  );
  if (sourceIndex < 0 || targetIndex < 0) return;
  if (isGroupPinned(ordered[sourceIndex].group) !== isGroupPinned(ordered[targetIndex].group)) return;
  const next = ordered.slice();
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  reordering.value = true;
  try {
    await Promise.all(
      next.map((item, order) => updateGroupAnnotations(item.group, { sortOrder: order + 1 })),
    );
    await load(true);
    Toast.success("顺序已更新");
  } catch (error) {
    console.error("拖拽更新旅途集顺序失败", error);
    Toast.error("更新顺序失败");
  } finally {
    reordering.value = false;
  }
}

function endGroupDrag() {
  draggedName.value = "";
  dragOverName.value = "";
}

async function batchSetVisibility(visibility: "public" | "private") {
  if (!selectedSummaries.value.length) return;
  try {
    await Promise.all(
      selectedSummaries.value.map((summary) =>
        updateGroupSpec(summary.group, { visibility }),
      ),
    );
    Toast.success(visibility === "public" ? "已批量公开" : "已批量转为私密");
    clearSelection();
    await load(true);
  } catch (error) {
    console.error("批量更新可见性失败", error);
    Toast.error("批量更新失败");
  }
}

function batchDelete() {
  if (!selectedSummaries.value.length) return;
  Dialog.warning({
    title: "批量删除",
    description: `确认删除选中的 ${selectedSummaries.value.length} 个旅途集吗？此操作无法撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    async onConfirm() {
      try {
        await Promise.all(
          selectedSummaries.value.map((summary) =>
            footprintApiClient.footprint.deleteFootprintGroup(summary.group.metadata.name),
          ),
        );
        Toast.success("已批量删除");
        clearSelection();
        await load(true);
      } catch (error) {
        console.error("批量删除旅途集失败", error);
        Toast.error("批量删除失败");
      }
    },
  });
}

async function handleSaved(savedGroup: FootprintGroup) {
  const targetKey = savedGroup.metadata.name;
  const wasCreate = editorWasCreate;
  await load(true);
  await nextTick();
  const target = document.querySelector(`[data-group-key="${CSS.escape(targetKey)}"]`);
  if (wasCreate && target) {
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    window.scrollTo({ top: editorStartScroll, behavior: "auto" });
  }
  highlightedKey.value = targetKey;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightedKey.value = "";
  }, 2400);
}

onMounted(() => load());
onBeforeUnmount(() => {
  clearTimeout(highlightTimer);
});

defineExpose({
  openCreate,
  refresh: () => load(true),
});
</script>

<template>
  <main class="fp-main fp-groups-main" role="tabpanel" aria-labelledby="fp-tab-groups">
    <section aria-labelledby="fp-groups-title">
      <header class="fp-section-header">
        <div>
          <h2 id="fp-groups-title">
            我的旅途集
            <span class="fp-count">{{ groups.length }}</span>
          </h2>
          <p>把已有足迹组合成一段有日期的旅程，或者一组长期收藏。</p>
        </div>
        <div class="fp-section-actions">
          <VButton :loading="refreshing" @click="load(true)">
            <template #icon>
              <IconRefreshLine width="15" height="15" />
            </template>
            刷新
          </VButton>
        </div>
      </header>

      <div class="fp-panel">
        <div class="fp-toolbar">
          <div class="fp-groups-filters" role="group" aria-label="旅途集筛选">
            <button
              type="button"
              class="fp-button is-small"
              :aria-pressed="filterType === 'all'"
              @click="filterType = 'all'"
            >
              全部 <span class="fp-filter-count">{{ groupCounts.all }}</span>
            </button>
            <button
              type="button"
              class="fp-button is-small"
              :aria-pressed="filterType === 'trip'"
              @click="filterType = 'trip'"
            >
              旅程 <span class="fp-filter-count">{{ groupCounts.trip }}</span>
            </button>
            <button
              type="button"
              class="fp-button is-small"
              :aria-pressed="filterType === 'collection'"
              @click="filterType = 'collection'"
            >
              收藏 <span class="fp-filter-count">{{ groupCounts.collection }}</span>
            </button>
          </div>
          <label class="fp-groups-search">
            <span class="sr-only">搜索旅途集</span>
            <input v-model="query" type="search" placeholder="搜索标题、成员、地点或类型" />
          </label>
        </div>
        <div v-if="selectedSummaries.length" class="fp-group-batch-bar" role="region" aria-label="批量操作">
          <span>已选 {{ selectedSummaries.length }} 项</span>
          <button type="button" class="fp-button is-small" @click="batchSetVisibility('public')">
            公开
          </button>
          <button type="button" class="fp-button is-small" @click="batchSetVisibility('private')">
            转私密
          </button>
          <button type="button" class="fp-button is-small is-danger" @click="batchDelete">
            删除
          </button>
          <button type="button" class="fp-button is-small" @click="clearSelection">取消</button>
        </div>

        <VLoading v-if="loading" />
        <div v-else-if="errorMessage" class="fp-state" role="alert">
          <RiMapPinLine width="28" height="28" aria-hidden="true" />
          <h3>暂时无法读取</h3>
          <p>{{ errorMessage }}</p>
          <VButton @click="load()">重新加载</VButton>
        </div>
        <div v-else-if="!filteredSummaries.length" class="fp-state" role="status">
          <RiMapPinLine width="28" height="28" aria-hidden="true" />
          <h3>{{ groups.length ? "没有符合筛选条件的记录" : "还没有旅程或收藏" }}</h3>
          <p>
            {{
              groups.length
                ? "调整类型或搜索条件后再试。"
                : "从已有足迹中选出几个地点，创建第一段旅程或主题收藏。"
            }}
          </p>
          <VButton v-if="!groups.length" type="primary" @click="openCreate()">
            新建旅程或收藏
          </VButton>
        </div>

        <div v-else class="fp-group-grid">
          <article
            v-for="summary in filteredSummaries"
            :key="summary.group.metadata.name"
            class="fp-group-card"
            :class="{
              'is-highlighted': highlightedKey === summary.group.metadata.name,
              'is-dragging': draggedName === summary.group.metadata.name,
              'is-drag-over': dragOverName === summary.group.metadata.name,
            }"
            :data-group-key="summary.group.metadata.name"
            @dragover="dragOverGroup($event, summary)"
            @drop="dropGroup($event, summary)"
          >
            <div class="fp-group-card-cover">
              <img
                v-if="summary.cover"
                :src="summary.cover"
                alt=""
                loading="lazy"
                :style="coverStyle(summary)"
              />
              <span v-else>{{ (summary.group.spec.title || "行").slice(0, 1) }}</span>
              <b>{{ typeLabel(summary) }}</b>
            </div>
            <div class="fp-group-card-body">
              <div class="fp-group-card-title">
                <input
                  type="checkbox"
                  :checked="selectedNames.includes(summary.group.metadata.name)"
                  :aria-label="`选择${summary.group.spec.title}`"
                  @change="
                    toggleSelected(
                      summary.group.metadata.name,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <button
                  type="button"
                  class="fp-group-drag-handle"
                  draggable="true"
                  title="拖动排序，聚焦后可用上下方向键"
                  :aria-label="`拖动排序 ${summary.group.spec.title}`"
                  :disabled="reordering"
                  @dragstart="startGroupDrag($event, summary)"
                  @dragend="endGroupDrag"
                  @keydown.up.prevent.stop="moveGroup(summary, -1)"
                  @keydown.down.prevent.stop="moveGroup(summary, 1)"
                >
                  <RiDragMoveLine width="16" height="16" aria-hidden="true" />
                </button>
                <h3>{{ summary.group.spec.title }}</h3>
                <div class="fp-group-card-status">
                  <span v-if="isGroupPinned(summary.group)" class="fp-tag">置顶</span>
                  <span
                    class="fp-tag"
                    :class="{ 'is-private': summary.group.spec.visibility === 'private' }"
                  >
                    {{ summary.group.spec.visibility === "private" ? "私密" : "公开" }}
                  </span>
                </div>
              </div>
              <p v-if="summary.group.spec.description" class="fp-group-card-desc">
                {{ summary.group.spec.description }}
              </p>
              <div class="fp-group-card-types">
                <span
                  v-for="type in summary.group.spec.footprintTypes || []"
                  :key="type"
                  class="fp-tag"
                >
                  {{ type }}
                </span>
              </div>
              <div class="fp-group-card-meta">
                <span>{{ formatRange(summary) }}</span>
                <span>{{ progressText(summary) }}</span>
                <span>{{ summary.cityCount }} 座城市</span>
              </div>
              <p v-if="summary.missingCount" class="fp-group-missing" role="status">
                有 {{ summary.missingCount }} 个成员足迹已失效，请编辑后移除。
              </p>
            </div>
            <footer class="fp-group-card-actions">
              <div class="fp-group-card-order-actions">
                <button
                  type="button"
                  class="fp-button is-small"
                  @click="togglePinned(summary)"
                >
                  {{ isGroupPinned(summary.group) ? "取消置顶" : "置顶" }}
                </button>
              </div>
              <div class="fp-group-card-record-actions">
                <button type="button" class="fp-button is-small" @click="openEdit(summary)">
                  <RiPencilLine width="14" height="14" aria-hidden="true" />
                  编辑
                </button>
                <button
                  v-if="summary.group.spec.visibility !== 'private'"
                  type="button"
                  class="fp-button is-small"
                  @click="openFrontend(summary)"
                >
                  <RiExternalLinkLine width="14" height="14" aria-hidden="true" />
                  前台
                </button>
                <button
                  type="button"
                  class="fp-button is-small is-danger"
                  @click="confirmDelete(summary)"
                >
                  <RiDeleteBinLine width="14" height="14" aria-hidden="true" />
                  删除
                </button>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </section>

    <FootprintGroupEditingModal
      v-model:visible="editorVisible"
      :group="editingGroup"
      :footprints="footprints"
      :footprint-types="footprintTypes"
      :initial-member-names="draftMemberNames"
      @saved="handleSaved"
    />
  </main>
</template>
