<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Dialog, Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import RiMapPin2Line from "~icons/ri/map-pin-2-line";
import type { Footprint, FootprintGroup, FootprintWish } from "@/api/models";
import { footprintApiClient } from "@/api";
import { addressFromCity } from "@/utils/address";
import MapPickerModal from "./MapPickerModal.vue";

const props = defineProps<{
  visible: boolean;
  wish?: FootprintWish;
  footprints: Footprint[];
  groups: FootprintGroup[];
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  saved: [wish: FootprintWish];
}>();

const STATUS_OPTIONS = [
  { label: "心愿", value: "wish" },
  { label: "计划中", value: "planning" },
  { label: "已订票", value: "booked" },
  { label: "已实现", value: "visited" },
];
const UPDATED_AT_ANNOTATION = "footprint.lik.cc/updated-at";

function blankWish(): FootprintWish {
  return {
    apiVersion: "footprint.lik.cc/v1alpha1",
    kind: "FootprintWish",
    metadata: {
      name: "",
      generateName: "footprint-wish-",
    },
    spec: {
      title: "",
      description: "",
      longitude: undefined as unknown as number,
      latitude: undefined as unknown as number,
      address: "",
      province: "",
      city: "",
      provinceAdcode: "",
      cityAdcode: "",
      status: "wish",
      plannedYear: undefined,
      plannedMonth: undefined,
      plannedTimeNote: "",
      tags: [],
      article: "",
      visibility: "public",
      pinned: false,
      sortOrder: undefined,
      realizedFootprintName: "",
      realizedGroupName: "",
    },
  };
}

const formState = ref<FootprintWish>(blankWish());
const formVisible = ref(false);
const saving = ref(false);
const initialSnapshot = ref("");
const tagsText = ref("");
const articleType = ref<"post" | "custom">("post");
const mapPickerVisible = ref(false);
const awaitingGeocode = ref(false);

function currentSnapshot() {
  return JSON.stringify({ form: formState.value, tags: tagsText.value });
}

function cloneWish(wish: FootprintWish): FootprintWish {
  return JSON.parse(JSON.stringify(wish)) as FootprintWish;
}

function resetForm() {
  const next = props.wish ? cloneWish(props.wish) : blankWish();
  next.spec.status = ["wish", "planning", "booked", "visited"].includes(next.spec.status)
    ? next.spec.status
    : "wish";
  next.spec.visibility = next.spec.visibility === "private" ? "private" : "public";
  next.spec.tags = Array.isArray(next.spec.tags) ? next.spec.tags.filter(Boolean) : [];
  next.spec.pinned = next.spec.pinned === true;
  tagsText.value = next.spec.tags.join("，");
  articleType.value = /^https?:\/\//i.test(next.spec.article || "") ? "custom" : "post";
  formState.value = next;
  nextTick(() => {
    initialSnapshot.value = currentSnapshot();
  });
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      formVisible.value = true;
      resetForm();
      return;
    }
    setTimeout(() => {
      formVisible.value = false;
      formState.value = blankWish();
      tagsText.value = "";
      initialSnapshot.value = "";
    }, 180);
  },
);

const hasCoordinate = computed(
  () =>
    Number.isFinite(Number(formState.value.spec.longitude)) &&
    Number.isFinite(Number(formState.value.spec.latitude)),
);
const isUpdateMode = computed(() => !!formState.value.metadata.creationTimestamp);
const isDirty = computed(
  () => initialSnapshot.value !== "" && currentSnapshot() !== initialSnapshot.value,
);
const plannedTimeText = computed(() => {
  const { plannedYear, plannedMonth, plannedTimeNote } = formState.value.spec;
  const date = plannedYear
    ? `${plannedYear} 年${plannedMonth ? ` ${plannedMonth} 月` : ""}`
    : "";
  return [date, plannedTimeNote].filter(Boolean).join(" · ") || "未计划时间";
});

function closeWithoutPrompt() {
  emit("update:visible", false);
}

function requestClose() {
  if (saving.value) return;
  if (!isDirty.value) {
    closeWithoutPrompt();
    return;
  }
  Dialog.warning({
    title: "放弃未保存修改？",
    description: "关闭后，本次对未来足迹的修改不会保存。",
    confirmText: "放弃修改",
    cancelText: "继续编辑",
    onConfirm: closeWithoutPrompt,
  });
}

function handleVisibleChange(value: boolean) {
  if (value) emit("update:visible", true);
  else requestClose();
}

function applyPickedLocation(value: {
  longitude: number;
  latitude: number;
  province?: string;
  city?: string;
  address?: string;
  provinceAdcode?: string;
  cityAdcode?: string;
}) {
  const address = value.address
    ? addressFromCity(value.address, value.city, value.province)
    : formState.value.spec.address;
  Object.assign(formState.value.spec, value, { address });
  Toast.success("已更新位置");
}

async function handleReparse() {
  if (!hasCoordinate.value) {
    Toast.error("请先通过地图选点确定位置");
    return;
  }
  awaitingGeocode.value = true;
  try {
    const geoInfo = await footprintApiClient.footprint.reverseGeocode(
      Number(formState.value.spec.longitude),
      Number(formState.value.spec.latitude),
    );
    Object.assign(formState.value.spec, {
      province: geoInfo.province,
      city: geoInfo.city,
      provinceAdcode: geoInfo.provinceAdcode,
      cityAdcode: geoInfo.cityAdcode,
    });
    Toast.success("省/市信息解析成功");
  } catch (error) {
    console.error("逆地理编码失败", error);
    Toast.error("逆地理编码失败");
  } finally {
    awaitingGeocode.value = false;
  }
}

function validateForm(): string {
  if (!formState.value.spec.title.trim()) return "地点名称不能为空";
  if (!String(formState.value.spec.address || "").trim()) return "地址不能为空";
  if (!hasCoordinate.value) return "请先通过地图选点选择位置";
  const monthText = String(formState.value.spec.plannedMonth ?? "").trim();
  const yearText = String(formState.value.spec.plannedYear ?? "").trim();
  if (monthText && !yearText) {
    return "填写计划月份时必须同时填写计划年份";
  }
  if (articleType.value === "custom") {
    const article = String(formState.value.spec.article || "").trim();
    if (article && !/^https?:\/\//i.test(article)) {
      return "链接地址必须以 http:// 或 https:// 开头";
    }
  }
  return "";
}

async function save() {
  const error = validateForm();
  if (error) {
    Toast.error(error);
    return;
  }
  saving.value = true;
  try {
    const submit = cloneWish(formState.value);
    submit.spec.title = submit.spec.title.trim();
    submit.spec.description = String(submit.spec.description || "").trim();
    submit.spec.plannedTimeNote = String(submit.spec.plannedTimeNote || "").trim();
    submit.spec.tags = [...new Set(
      tagsText.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
    )].slice(0, 20);
    submit.spec.article = String(submit.spec.article || "").trim();
    submit.spec.plannedYear =
      submit.spec.plannedYear != null && String(submit.spec.plannedYear).trim() !== ""
        ? Number(submit.spec.plannedYear)
        : undefined;
    submit.spec.plannedMonth =
      submit.spec.plannedMonth != null && String(submit.spec.plannedMonth).trim() !== ""
        ? Number(submit.spec.plannedMonth)
        : undefined;
    submit.spec.pinned = submit.spec.pinned === true;
    submit.spec.sortOrder =
      Number.isInteger(Number(submit.spec.sortOrder)) && Number(submit.spec.sortOrder) >= 0
        ? Number(submit.spec.sortOrder)
        : undefined;
    if (submit.spec.status !== "visited") {
      submit.spec.realizedFootprintName = "";
      submit.spec.realizedGroupName = "";
    }
    submit.metadata.annotations = {
      ...(submit.metadata.annotations || {}),
      [UPDATED_AT_ANNOTATION]: new Date().toISOString(),
    };

    const saved = isUpdateMode.value
      ? await footprintApiClient.footprint.updateFootprintWish(
          submit.metadata.name,
          submit,
        )
      : await footprintApiClient.footprint.createFootprintWish(submit);
    Toast.success(isUpdateMode.value ? "未来足迹已更新" : "未来足迹已创建");
    initialSnapshot.value = currentSnapshot();
    emit("saved", saved);
    closeWithoutPrompt();
  } catch (saveError) {
    console.error("保存未来足迹失败", saveError);
    Toast.error("保存失败，请稍后重试");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <VModal
    :visible="visible"
    :title="isUpdateMode ? '编辑未来足迹' : '新建未来足迹'"
    :width="980"
    :mask-closable="false"
    mount-to-body
    @update:visible="handleVisibleChange"
  >
    <div v-if="formVisible" class="fp-dialog fp-wish-dialog">
      <FormKit type="form" :actions="false" @submit.prevent>
        <section class="fp-form-section">
          <header>
            <h3>目的地</h3>
            <p>一个地点一条记录。当前位置尚未到访时，可选择心愿、计划中或已订票。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.title"
              type="text"
              name="title"
              label="地点名称"
              validation="required"
              :maxlength="100"
              placeholder="例如：冰岛、敦煌雅丹"
            />
            <FormKit
              v-model="formState.spec.status"
              type="select"
              name="status"
              label="状态"
              :options="STATUS_OPTIONS"
            />
            <FormKit
              v-model="formState.spec.visibility"
              type="select"
              name="visibility"
              label="可见性"
              :options="[
                { label: '公开', value: 'public' },
                { label: '私密', value: 'private' },
              ]"
            />
            <FormKit
              v-model="formState.spec.description"
              type="textarea"
              name="description"
              label="为什么想去"
              :rows="4"
              :maxlength="1000"
              placeholder="记录吸引你的风景、人文或期待"
            />
            <FormKit
              v-model="tagsText"
              type="text"
              name="tags"
              label="标签"
              placeholder="用逗号分隔，例如：雪山，古建，自驾"
            />
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>位置</h3>
            <p>经纬度必填。地图选点与新增足迹使用同一套高德选点能力。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.address"
              type="text"
              name="wishAddress"
              label="地址"
              validation="required"
              help="建议格式：市+地址，如杭州市灵隐寺"
              placeholder="输入详细地址"
            />

            <div class="formkit-outer fp-location py-5" data-type="text">
              <label class="formkit-label">位置</label>
              <div class="fp-readout">
                <span class="fp-readout-value fp-num" :class="{ 'is-empty': !hasCoordinate }">
                  {{
                    hasCoordinate
                      ? `${Number(formState.spec.longitude).toFixed(6)}, ${Number(formState.spec.latitude).toFixed(6)}`
                      : "未选点"
                  }}
                </span>
                <VButton size="sm" @click="mapPickerVisible = true">
                  <template #icon>
                    <RiMapPin2Line class="h-full w-full" />
                  </template>
                  地图选点
                </VButton>
              </div>
              <div class="fp-readout">
                <span
                  class="fp-readout-value"
                  :class="{ 'is-empty': !formState.spec.province }"
                >
                  {{
                    formState.spec.province
                      ? [formState.spec.province, formState.spec.city].filter(Boolean).join(" · ")
                      : "省 / 市未解析"
                  }}
                </span>
                <VButton
                  size="sm"
                  :loading="awaitingGeocode"
                  :disabled="!hasCoordinate"
                  @click="handleReparse"
                >
                  重新解析
                </VButton>
              </div>
              <p class="formkit-help">
                点「地图选点」可直接在地图上确定位置，省 / 市会一并解析，无需先保存。
              </p>
            </div>
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>计划时间</h3>
            <p>年和月都可不填，也可以只用备注记录季节或假期。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.plannedYear"
              type="number"
              name="plannedYear"
              label="计划年份"
              min="1900"
              max="2200"
              step="1"
            />
            <FormKit
              v-model="formState.spec.plannedMonth"
              type="number"
              name="plannedMonth"
              label="计划月份"
              min="1"
              max="12"
              step="1"
            />
            <FormKit
              v-model="formState.spec.plannedTimeNote"
              type="text"
              name="plannedTimeNote"
              label="时间备注"
              :maxlength="50"
              placeholder="例如：春季、国庆前后、待定"
            />
            <p class="fp-wish-time-preview">{{ plannedTimeText }}</p>
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>参考与实现</h3>
            <p>可以关联文章；状态为已实现时，可继续关联实际足迹或旅程。</p>
          </header>
          <div>
            <FormKit
              v-model="articleType"
              type="select"
              name="articleType"
              label="关联类型"
              :options="[
                { label: '文章', value: 'post' },
                { label: '自定义链接', value: 'custom' },
              ]"
            />
            <FormKit
              v-if="articleType === 'post'"
              v-model="formState.spec.article"
              type="select"
              name="article"
              label="关联文章"
              clearable
              searchable
              action="/apis/content.halo.run/v1alpha1/posts"
              :request-option="{
                method: 'GET',
                pageField: 'page',
                sizeField: 'size',
                totalField: 'total',
                itemsField: 'items',
                labelField: 'spec.title',
                valueField: 'status.permalink',
              }"
            />
            <FormKit
              v-else
              v-model="formState.spec.article"
              type="text"
              name="customArticle"
              label="链接地址"
              placeholder="https://example.com/inspiration"
            />
            <template v-if="formState.spec.status === 'visited'">
              <FormKit
                v-model="formState.spec.realizedFootprintName"
                type="select"
                name="realizedFootprintName"
                label="关联足迹"
                clearable
                searchable
                :options="footprints.map((item) => ({
                  label: [item.spec.name, item.spec.city].filter(Boolean).join(' · '),
                  value: item.metadata.name,
                }))"
              />
              <FormKit
                v-model="formState.spec.realizedGroupName"
                type="select"
                name="realizedGroupName"
                label="关联旅程"
                clearable
                searchable
                :options="groups
                  .filter((group) => group.spec.groupType === 'trip')
                  .map((group) => ({
                    label: group.spec.title,
                    value: group.metadata.name,
                  }))"
              />
            </template>
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>展示顺序</h3>
            <p>置顶优先，其次按排序值升序；未设置时按最近更新时间倒序。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.pinned"
              type="checkbox"
              name="pinned"
              label="置顶"
            />
            <FormKit
              v-model="formState.spec.sortOrder"
              type="number"
              name="sortOrder"
              label="排序值"
              min="0"
              step="1"
              placeholder="数值越小越靠前"
            />
          </div>
        </section>
      </FormKit>
    </div>

    <template #footer>
      <VSpace>
        <VButton :disabled="saving" @click="requestClose">取消</VButton>
        <VButton type="primary" :loading="saving" @click="save">
          {{ isUpdateMode ? "保存修改" : "创建" }}
        </VButton>
      </VSpace>
    </template>
  </VModal>

  <Teleport to="body">
    <MapPickerModal
      v-model:visible="mapPickerVisible"
      :longitude="hasCoordinate ? Number(formState.spec.longitude) : undefined"
      :latitude="hasCoordinate ? Number(formState.spec.latitude) : undefined"
      :address="formState.spec.address"
      @confirm="applyPickedLocation"
    />
  </Teleport>
</template>
