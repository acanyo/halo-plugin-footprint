<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Dialog, IconRefreshLine, Toast, VButton, VLoading } from "@halo-dev/components";
import RiArrowDownLine from "~icons/ri/arrow-down-line";
import RiArrowUpLine from "~icons/ri/arrow-up-line";
import RiDeleteBinLine from "~icons/ri/delete-bin-line";
import RiDragMoveLine from "~icons/ri/drag-move-line";
import RiExternalLinkLine from "~icons/ri/external-link-line";
import RiMapPinLine from "~icons/ri/map-pin-line";
import RiPencilLine from "~icons/ri/pencil-line";
import type {
  Footprint,
  FootprintGroup,
  FootprintWish,
  FootprintWishStatus,
} from "@/api/models";
import { footprintApiClient } from "@/api";
import FootprintWishEditingModal from "./FootprintWishEditingModal.vue";

type StatusFilter = "all" | FootprintWishStatus;

const STATUS_LABELS: Record<FootprintWishStatus, string> = {
  wish: "心愿",
  planning: "计划中",
  booked: "已订票",
  visited: "已实现",
};
const STATUS_PRIORITY: Record<FootprintWishStatus, number> = {
  booked: 0,
  planning: 1,
  wish: 2,
  visited: 3,
};
const UPDATED_AT_ANNOTATION = "footprint.lik.cc/updated-at";

const wishes = ref<FootprintWish[]>([]);
const footprints = ref<Footprint[]>([]);
const groups = ref<FootprintGroup[]>([]);
const loading = ref(false);
const refreshing = ref(false);
const errorMessage = ref("");
const query = ref("");
const statusFilter = ref<StatusFilter>("all");
const editorVisible = ref(false);
const editingWish = ref<FootprintWish>();
const highlightedKey = ref("");
const reordering = ref(false);
const draggedName = ref("");
const dragOverName = ref("");
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
let editorStartScroll = 0;

function pluralUpdateTime(wish: FootprintWish) {
  return wish.metadata.annotations?.[UPDATED_AT_ANNOTATION] ||
    wish.metadata.updateTimestamp ||
    wish.metadata.creationTimestamp ||
    "";
}

function sortedWishes(items: FootprintWish[]) {
  return items.slice().sort((a, b) => {
    const statusA = STATUS_PRIORITY[a.spec.status] ?? STATUS_PRIORITY.wish;
    const statusB = STATUS_PRIORITY[b.spec.status] ?? STATUS_PRIORITY.wish;
    if (statusA !== statusB) return statusA - statusB;
    if (!!a.spec.pinned !== !!b.spec.pinned) return a.spec.pinned ? -1 : 1;
    const orderA = a.spec.sortOrder == null ? Number.MAX_SAFE_INTEGER : a.spec.sortOrder;
    const orderB = b.spec.sortOrder == null ? Number.MAX_SAFE_INTEGER : b.spec.sortOrder;
    if (orderA !== orderB) return orderA - orderB;
    const byUpdate = pluralUpdateTime(b).localeCompare(pluralUpdateTime(a));
    return byUpdate || a.spec.title.localeCompare(b.spec.title, "zh-Hans-CN");
  });
}

const filteredWishes = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return sortedWishes(wishes.value.filter((wish) => {
    if (statusFilter.value !== "all" && wish.spec.status !== statusFilter.value) return false;
    if (!keyword) return true;
    return [
      wish.spec.title,
      wish.spec.description,
      wish.spec.address,
      wish.spec.province,
      wish.spec.city,
      ...(wish.spec.tags || []),
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  }));
});

const counts = computed(() => ({
  all: wishes.value.length,
  wish: wishes.value.filter((wish) => wish.spec.status === "wish").length,
  planning: wishes.value.filter((wish) => wish.spec.status === "planning").length,
  booked: wishes.value.filter((wish) => wish.spec.status === "booked").length,
  visited: wishes.value.filter((wish) => wish.spec.status === "visited").length,
}));

function planText(wish: FootprintWish) {
  const date = wish.spec.plannedYear
    ? `${wish.spec.plannedYear} 年${wish.spec.plannedMonth ? ` ${wish.spec.plannedMonth} 月` : ""}`
    : "";
  return [date, wish.spec.plannedTimeNote].filter(Boolean).join(" · ") || "未计划时间";
}

function regionText(wish: FootprintWish) {
  return [wish.spec.province, wish.spec.city].filter(Boolean).join(" · ") ||
    wish.spec.address ||
    "位置已记录";
}

function openCreate() {
  editingWish.value = undefined;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
}

function openEdit(wish: FootprintWish) {
  editingWish.value = wish;
  editorStartScroll = window.scrollY;
  editorVisible.value = true;
}

function openFrontend(wish: FootprintWish) {
  window.open(
    `/footprints?view=groups&wish=${encodeURIComponent(wish.metadata.name)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

async function load(manual = false) {
  if (loading.value || refreshing.value) return;
  if (manual) refreshing.value = true;
  else loading.value = true;
  errorMessage.value = "";
  try {
    const [nextWishes, nextFootprints, nextGroups] = await Promise.all([
      footprintApiClient.footprint.listAllFootprintWishes(),
      footprintApiClient.footprint.listAllFootprints(),
      footprintApiClient.footprint.listAllFootprintGroups(),
    ]);
    wishes.value = nextWishes;
    footprints.value = nextFootprints;
    groups.value = nextGroups;
  } catch (error) {
    console.error("读取未来足迹失败", error);
    errorMessage.value =
      (error as { response?: { status?: number } })?.response?.status === 404
        ? "运行中的 Halo 尚未加载“未来足迹”数据模型，请先热重载插件后再试。"
        : "读取未来足迹失败，请稍后重试。";
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

async function updateWish(
  wish: FootprintWish,
  patch: Partial<FootprintWish["spec"]>,
) {
  return footprintApiClient.footprint.updateFootprintWish(wish.metadata.name, {
    ...wish,
    spec: { ...wish.spec, ...patch },
  });
}

async function togglePinned(wish: FootprintWish) {
  try {
    await updateWish(wish, { pinned: !wish.spec.pinned });
    Toast.success(wish.spec.pinned ? "已取消置顶" : "已置顶");
    await load(true);
  } catch (error) {
    console.error("更新未来足迹置顶失败", error);
    Toast.error("更新置顶失败");
  }
}

async function moveWish(wish: FootprintWish, delta: number) {
  if (reordering.value) return;
  const ordered = sortedWishes(wishes.value);
  const index = ordered.findIndex((item) => item.metadata.name === wish.metadata.name);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= ordered.length) return;
  if (ordered[index].spec.status !== ordered[target].spec.status) return;
  if (!!ordered[index].spec.pinned !== !!ordered[target].spec.pinned) return;
  reordering.value = true;
  try {
    const next = ordered.slice();
    [next[index], next[target]] = [next[target], next[index]];
    await Promise.all(
      next.map((item, order) => updateWish(item, { sortOrder: order + 1 })),
    );
    Toast.success("顺序已更新");
    await load(true);
  } catch (error) {
    console.error("更新未来足迹顺序失败", error);
    Toast.error("更新顺序失败");
  } finally {
    reordering.value = false;
  }
}

function sameWishOrderGroup(a: FootprintWish, b: FootprintWish) {
  return a.spec.status === b.spec.status && !!a.spec.pinned === !!b.spec.pinned;
}

function startWishDrag(event: DragEvent, wish: FootprintWish) {
  if (reordering.value) {
    event.preventDefault();
    return;
  }
  draggedName.value = wish.metadata.name;
  dragOverName.value = "";
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", wish.metadata.name);
  }
}

function dragOverWish(event: DragEvent, wish: FootprintWish) {
  if (!draggedName.value || draggedName.value === wish.metadata.name) return;
  const source = wishes.value.find((item) => item.metadata.name === draggedName.value);
  if (!source || !sameWishOrderGroup(source, wish)) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    return;
  }
  event.preventDefault();
  dragOverName.value = wish.metadata.name;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
}

async function dropWish(event: DragEvent, target: FootprintWish) {
  event.preventDefault();
  const sourceName = draggedName.value || event.dataTransfer?.getData("text/plain") || "";
  dragOverName.value = "";
  draggedName.value = "";
  if (!sourceName || sourceName === target.metadata.name || reordering.value) return;
  const ordered = sortedWishes(wishes.value);
  const sourceIndex = ordered.findIndex((item) => item.metadata.name === sourceName);
  const targetIndex = ordered.findIndex((item) => item.metadata.name === target.metadata.name);
  if (sourceIndex < 0 || targetIndex < 0) return;
  if (!sameWishOrderGroup(ordered[sourceIndex], ordered[targetIndex])) return;
  const next = ordered.slice();
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  reordering.value = true;
  try {
    await Promise.all(
      next.map((item, order) => updateWish(item, { sortOrder: order + 1 })),
    );
    Toast.success("顺序已更新");
    await load(true);
  } catch (error) {
    console.error("拖拽更新未来足迹顺序失败", error);
    Toast.error("更新顺序失败");
  } finally {
    reordering.value = false;
  }
}

function endWishDrag() {
  draggedName.value = "";
  dragOverName.value = "";
}

function confirmDelete(wish: FootprintWish) {
  Dialog.warning({
    title: "删除未来足迹",
    description: `确认删除“${wish.spec.title}”吗？此操作无法撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    async onConfirm() {
      try {
        await footprintApiClient.footprint.deleteFootprintWish(wish.metadata.name);
        Toast.success("已删除");
        await load(true);
      } catch (error) {
        console.error("删除未来足迹失败", error);
        Toast.error("删除失败");
      }
    },
  });
}

async function handleSaved(saved: FootprintWish) {
  await load(true);
  await nextTick();
  window.scrollTo({ top: editorStartScroll, behavior: "auto" });
  highlightedKey.value = saved.metadata.name;
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
  <main class="fp-main fp-wishes-main" role="tabpanel" aria-labelledby="fp-tab-wishes">
    <section aria-labelledby="fp-wishes-title">
      <header class="fp-section-header">
        <div>
          <h2 id="fp-wishes-title">
            未来足迹
            <span class="fp-count">{{ wishes.length }}</span>
          </h2>
          <p>记录尚未到访的地点、计划时间和实现状态。</p>
        </div>
        <div class="fp-section-actions">
          <VButton :loading="refreshing" @click="load(true)">
            <template #icon><IconRefreshLine width="15" height="15" /></template>
            刷新
          </VButton>
        </div>
      </header>

      <div class="fp-panel">
        <div class="fp-toolbar">
          <div class="fp-groups-filters" role="group" aria-label="未来足迹状态筛选">
            <button
              v-for="item in [
                ['all', '全部', counts.all],
                ['wish', '心愿', counts.wish],
                ['planning', '计划中', counts.planning],
                ['booked', '已订票', counts.booked],
                ['visited', '已实现', counts.visited],
              ]"
              :key="item[0]"
              type="button"
              class="fp-button is-small"
              :aria-pressed="statusFilter === item[0]"
              @click="statusFilter = item[0] as StatusFilter"
            >
              {{ item[1] }} <span class="fp-filter-count">{{ item[2] }}</span>
            </button>
          </div>
          <label class="fp-groups-search">
            <span class="sr-only">搜索未来足迹</span>
            <input v-model="query" type="search" placeholder="搜索地点、地区或标签" />
          </label>
        </div>

        <VLoading v-if="loading" />
        <div v-else-if="errorMessage" class="fp-state" role="alert">
          <RiMapPinLine width="28" height="28" aria-hidden="true" />
          <h3>暂时无法读取</h3>
          <p>{{ errorMessage }}</p>
          <VButton @click="load()">重新加载</VButton>
        </div>
        <div v-else-if="!filteredWishes.length" class="fp-state" role="status">
          <RiMapPinLine width="28" height="28" aria-hidden="true" />
          <h3>{{ wishes.length ? "没有符合筛选条件的未来足迹" : "还没有未来足迹" }}</h3>
          <p>
            {{
              wishes.length
                ? "调整状态或搜索条件后再试。"
                : "记录第一个尚未到访的地点，并通过地图选择位置。"
            }}
          </p>
          <VButton v-if="!wishes.length" type="primary" @click="openCreate">
            新建未来足迹
          </VButton>
        </div>

        <div v-else class="fp-wish-grid">
          <article
            v-for="wish in filteredWishes"
            :key="wish.metadata.name"
            class="fp-wish-card"
            :class="{
              'is-highlighted': highlightedKey === wish.metadata.name,
              'is-dragging': draggedName === wish.metadata.name,
              'is-drag-over': dragOverName === wish.metadata.name,
            }"
            :data-wish-key="wish.metadata.name"
            @dragover="dragOverWish($event, wish)"
            @drop="dropWish($event, wish)"
          >
            <header class="fp-wish-card-head">
              <div>
                <span class="fp-wish-status" :data-status="wish.spec.status">
                  {{ STATUS_LABELS[wish.spec.status] }}
                </span>
                <span v-if="wish.spec.pinned" class="fp-tag">置顶</span>
                <span v-if="wish.spec.visibility === 'private'" class="fp-tag is-private">
                  私密
                </span>
              </div>
              <div class="fp-wish-order-actions">
                <button
                  type="button"
                  class="fp-icon-button fp-wish-drag-handle"
                  draggable="true"
                  title="拖动排序，聚焦后可用上下方向键"
                  :aria-label="`拖动排序 ${wish.spec.title}`"
                  :disabled="reordering"
                  @dragstart="startWishDrag($event, wish)"
                  @dragend="endWishDrag"
                  @keydown.up.prevent.stop="moveWish(wish, -1)"
                  @keydown.down.prevent.stop="moveWish(wish, 1)"
                >
                  <RiDragMoveLine width="15" height="15" />
                </button>
                <button
                  type="button"
                  class="fp-icon-button"
                  title="上移"
                  aria-label="上移"
                  :disabled="reordering"
                  @click="moveWish(wish, -1)"
                >
                  <RiArrowUpLine width="15" height="15" />
                </button>
                <button
                  type="button"
                  class="fp-icon-button"
                  title="下移"
                  aria-label="下移"
                  :disabled="reordering"
                  @click="moveWish(wish, 1)"
                >
                  <RiArrowDownLine width="15" height="15" />
                </button>
              </div>
            </header>
            <h3>{{ wish.spec.title }}</h3>
            <p class="fp-wish-region">{{ regionText(wish) }}</p>
            <p v-if="wish.spec.description" class="fp-wish-description">
              {{ wish.spec.description }}
            </p>
            <div class="fp-group-card-types">
              <span v-for="tag in wish.spec.tags || []" :key="tag" class="fp-tag">
                {{ tag }}
              </span>
            </div>
            <div class="fp-wish-meta">
              <span>{{ planText(wish) }}</span>
              <span v-if="wish.spec.status === 'visited'">
                {{ wish.spec.realizedFootprintName || wish.spec.realizedGroupName
                  ? "已关联实现记录"
                  : "等待关联足迹" }}
              </span>
            </div>
            <footer class="fp-wish-card-actions">
              <button type="button" class="fp-button is-small" @click="togglePinned(wish)">
                {{ wish.spec.pinned ? "取消置顶" : "置顶" }}
              </button>
              <div>
                <button type="button" class="fp-button is-small" @click="openEdit(wish)">
                  <RiPencilLine width="14" height="14" />编辑
                </button>
                <button
                  v-if="wish.spec.visibility !== 'private'"
                  type="button"
                  class="fp-button is-small"
                  @click="openFrontend(wish)"
                >
                  <RiExternalLinkLine width="14" height="14" />前台
                </button>
                <button
                  type="button"
                  class="fp-button is-small is-danger"
                  @click="confirmDelete(wish)"
                >
                  <RiDeleteBinLine width="14" height="14" />删除
                </button>
              </div>
            </footer>
          </article>
        </div>
      </div>
    </section>

    <FootprintWishEditingModal
      v-model:visible="editorVisible"
      :wish="editingWish"
      :footprints="footprints"
      :groups="groups"
      @saved="handleSaved"
    />
  </main>
</template>
