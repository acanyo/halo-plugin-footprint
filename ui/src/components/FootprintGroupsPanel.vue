<script setup lang="ts">
/** 足迹管理页的“我的旅途集”面板。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Dialog, IconRefreshLine, Toast, VButton, VLoading } from "@halo-dev/components";
import RiDeleteBinLine from "~icons/ri/delete-bin-line";
import RiExternalLinkLine from "~icons/ri/external-link-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiPencilLine from "~icons/ri/pencil-line";
import type { Footprint, FootprintGroup, Option } from "@/api/models";
import { footprintApiClient } from "@/api";
import {
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
const pendingUndo = ref<{ group: FootprintGroup; title: string }>();
let undoTimer: ReturnType<typeof setTimeout> | undefined;
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

function formatRange(summary: FootprintGroupSummary) {
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
  const count = summary.members.length;
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

async function openCreate(memberNames: string[] = []) {
  while (loading.value) await new Promise((resolve) => setTimeout(resolve, 30));
  if (!footprints.value.length) await load();
  editingGroup.value = undefined;
  draftMemberNames.value = [...new Set(memberNames)];
  editorWasCreate = true;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
}

function openEdit(summary: FootprintGroupSummary) {
  editingGroup.value = summary.group;
  draftMemberNames.value = [];
  editorWasCreate = false;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
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
    description: `确认删除“${summary.group.spec.title}”吗？成员足迹不会被删除，删除后可在 10 秒内撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprintGroup(summary.group.metadata.name);
        pendingUndo.value = {
          group: JSON.parse(JSON.stringify(summary.group)) as FootprintGroup,
          title: summary.group.spec.title,
        };
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          pendingUndo.value = undefined;
        }, 10000);
        Toast.success("已删除，可在下方撤销");
        await load(true);
      } catch (error) {
        console.error("删除旅程或收藏失败", error);
        Toast.error("删除失败");
      }
    },
  });
}

async function undoDelete() {
  const pending = pendingUndo.value;
  if (!pending) return;
  clearTimeout(undoTimer);
  try {
    const restore = JSON.parse(JSON.stringify(pending.group)) as FootprintGroup;
    restore.metadata = {
      name: "",
      generateName: "footprint-group-",
      labels: restore.metadata.labels,
      annotations: restore.metadata.annotations,
    };
    const restored = await footprintApiClient.footprint.createFootprintGroup(restore);
    pendingUndo.value = undefined;
    await load(true);
    highlightedKey.value = restored.metadata.name;
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      highlightedKey.value = "";
    }, 2400);
    Toast.success("已恢复删除的旅程或收藏");
  } catch (error) {
    console.error("撤销删除失败", error);
    Toast.error("撤销失败，请重新创建");
  }
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
  clearTimeout(undoTimer);
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
            <input v-model="query" type="search" placeholder="搜索标题、说明或足迹类型" />
          </label>
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
            :class="{ 'is-highlighted': highlightedKey === summary.group.metadata.name }"
            :data-group-key="summary.group.metadata.name"
          >
            <div class="fp-group-card-cover">
              <img v-if="summary.cover" :src="summary.cover" alt="" loading="lazy" />
              <span v-else>{{ (summary.group.spec.title || "行").slice(0, 1) }}</span>
              <b>{{ typeLabel(summary) }}</b>
            </div>
            <div class="fp-group-card-body">
              <div class="fp-group-card-title">
                <h3>{{ summary.group.spec.title }}</h3>
                <span
                  class="fp-tag"
                  :class="{ 'is-private': summary.group.spec.visibility === 'private' }"
                >
                  {{ summary.group.spec.visibility === "private" ? "私密" : "公开" }}
                </span>
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
              <dl class="fp-group-card-meta">
                <div>
                  <dt>时间</dt>
                  <dd>{{ formatRange(summary) }}</dd>
                </div>
                <div>
                  <dt>成员</dt>
                  <dd>{{ progressText(summary) }}</dd>
                </div>
                <div>
                  <dt>覆盖</dt>
                  <dd>{{ summary.cityCount }} 座城市，{{ summary.provinceCount }} 个省份</dd>
                </div>
              </dl>
              <p v-if="summary.missingCount" class="fp-group-missing" role="status">
                有 {{ summary.missingCount }} 个成员足迹已失效，请编辑后移除。
              </p>
            </div>
            <footer class="fp-group-card-actions">
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
            </footer>
          </article>
        </div>
      </div>
      <div v-if="pendingUndo" class="fp-groups-undo" role="status" aria-live="polite">
        <span>已删除“{{ pendingUndo.title }}”</span>
        <button type="button" class="fp-button is-small" @click="undoDelete">撤销</button>
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
