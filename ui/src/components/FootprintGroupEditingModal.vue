<script setup lang="ts">
/**
 * 行程/集合编辑弹窗。
 *
 * 只保存用户可编辑的集合字段；日期范围、天数、排序和封面兜底都在展示层派生。
 */
import { computed, nextTick, ref, watch } from "vue";
import { Dialog, Toast, VButton, VModal, VSpace } from "@halo-dev/components";
import type { Footprint, FootprintGroup, Option } from "@/api/models";
import { footprintApiClient } from "@/api";
import {
  MAX_GROUP_MEMBERS,
  groupRange,
  sortFootprintsByVisitTime,
  uniqueMemberNames,
  validateFootprintGroup,
} from "@/utils/footprint-groups";
import { normalizeAttachmentImageUrl } from "@/utils/attachment";
import { formatDatetime } from "@/utils/date";
import FootprintGroupMemberPicker from "./FootprintGroupMemberPicker.vue";

const props = defineProps<{
  visible: boolean;
  group?: FootprintGroup;
  footprints: Footprint[];
  footprintTypes: Option[];
  initialMemberNames?: string[];
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  saved: [group: FootprintGroup];
}>();

function blankGroup(): FootprintGroup {
  return {
    apiVersion: "footprint.lik.cc/v1alpha1",
    kind: "FootprintGroup",
    metadata: {
      name: "",
      generateName: "footprint-group-",
    },
    spec: {
      groupType: "trip",
      title: "",
      description: "",
      visibility: "public",
      cover: "",
      memberNames: [],
      targetCount: undefined,
      article: "",
      footprintTypes: [],
    },
  };
}

const formState = ref<FootprintGroup>(blankGroup());
const articleType = ref<"post" | "custom">("post");
const saving = ref(false);
const formVisible = ref(false);
const initialSnapshot = ref("");

const footprintMap = computed(
  () => new Map(props.footprints.map((footprint) => [footprint.metadata.name, footprint])),
);
const selectedMembers = computed(() =>
  sortFootprintsByVisitTime(
    uniqueMemberNames(formState.value.spec.memberNames)
      .map((name) => footprintMap.value.get(name))
      .filter((item): item is Footprint => !!item),
  ),
);
const range = computed(() => groupRange(selectedMembers.value));
const coverPreview = computed(() => normalizeAttachmentImageUrl(formState.value.spec.cover));
const isUpdateMode = computed(() => !!formState.value.metadata.creationTimestamp);
const modalTitle = computed(() =>
  isUpdateMode.value
    ? formState.value.spec.groupType === "trip"
      ? "编辑行程"
      : "编辑集合"
    : formState.value.spec.groupType === "trip"
      ? "新建行程"
      : "新建集合",
);
const validation = computed(() => validateFootprintGroup(formState.value, footprintMap.value));
const isDirty = computed(
  () => initialSnapshot.value !== "" && JSON.stringify(formState.value) !== initialSnapshot.value,
);
const missingMemberNames = computed(() =>
  uniqueMemberNames(formState.value.spec.memberNames).filter(
    (name) => !footprintMap.value.has(name),
  ),
);
const dateRangeText = computed(() => {
  if (!range.value.start || !range.value.end) return "选择成员后自动计算";
  const start = formatDatetime(range.value.start);
  const end = formatDatetime(range.value.end);
  return `${start} 至 ${end}，共 ${range.value.days} 天`;
});

function cloneGroup(group: FootprintGroup): FootprintGroup {
  return JSON.parse(JSON.stringify(group)) as FootprintGroup;
}

function resetForm() {
  const next = props.group ? cloneGroup(props.group) : blankGroup();
  if (!props.group && props.initialMemberNames?.length) {
    next.spec.memberNames = uniqueMemberNames(props.initialMemberNames).slice(0, MAX_GROUP_MEMBERS);
  }
  next.spec.groupType = next.spec.groupType === "collection" ? "collection" : "trip";
  next.spec.visibility = next.spec.visibility === "private" ? "private" : "public";
  next.spec.memberNames = uniqueMemberNames(next.spec.memberNames);
  next.spec.footprintTypes = Array.isArray(next.spec.footprintTypes)
    ? next.spec.footprintTypes.filter(Boolean)
    : [];
  formState.value = next;
  articleType.value = /^https?:\/\//i.test(next.spec.article || "") ? "custom" : "post";
  nextTick(() => {
    initialSnapshot.value = JSON.stringify(formState.value);
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
      formState.value = blankGroup();
      initialSnapshot.value = "";
    }, 180);
  },
);

watch(
  () => formState.value.spec.groupType,
  (type) => {
    if (type === "trip") formState.value.spec.targetCount = undefined;
  },
);

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
    description: "关闭后，本次对标题、成员、封面或关联信息的修改将不会保存。",
    confirmText: "放弃修改",
    cancelText: "继续编辑",
    onConfirm: closeWithoutPrompt,
  });
}

function handleVisibleChange(visible: boolean) {
  if (visible) {
    emit("update:visible", true);
    return;
  }
  requestClose();
}

function removeMissingMember(name: string) {
  formState.value.spec.memberNames = uniqueMemberNames(formState.value.spec.memberNames).filter(
    (memberName) => memberName !== name,
  );
}

function validateArticle(): string | null {
  const article = String(formState.value.spec.article || "").trim();
  if (!article) return null;
  if (articleType.value === "custom" && !/^https?:\/\//i.test(article)) {
    return "链接地址必须以 http:// 或 https:// 开头";
  }
  return null;
}

async function save() {
  const check = validateFootprintGroup(formState.value, footprintMap.value);
  if (!check.ok) {
    Toast.error(check.message || "请检查表单");
    return;
  }
  const articleError = validateArticle();
  if (articleError) {
    Toast.error(articleError);
    return;
  }

  saving.value = true;
  try {
    const submit = cloneGroup(formState.value);
    submit.spec.title = submit.spec.title.trim();
    submit.spec.description = String(submit.spec.description || "").trim();
    submit.spec.cover = normalizeAttachmentImageUrl(submit.spec.cover);
    submit.spec.memberNames = uniqueMemberNames(submit.spec.memberNames);
    submit.spec.article = String(submit.spec.article || "").trim();
    submit.spec.footprintTypes = Array.isArray(submit.spec.footprintTypes)
      ? [...new Set(submit.spec.footprintTypes.map((item) => String(item).trim()).filter(Boolean))]
      : [];
    if (
      submit.spec.groupType === "collection" &&
      submit.spec.targetCount !== undefined &&
      submit.spec.targetCount !== null &&
      String(submit.spec.targetCount).trim() !== ""
    ) {
      submit.spec.targetCount = Number(submit.spec.targetCount);
    } else {
      delete submit.spec.targetCount;
    }

    let savedGroup: FootprintGroup;
    if (isUpdateMode.value) {
      savedGroup = await footprintApiClient.footprint.updateFootprintGroup(
        submit.metadata.name,
        submit,
      );
      Toast.success("行程或集合已更新");
    } else {
      savedGroup = await footprintApiClient.footprint.createFootprintGroup(submit);
      Toast.success("行程或集合已创建");
    }
    initialSnapshot.value = JSON.stringify(formState.value);
    emit("saved", savedGroup);
    closeWithoutPrompt();
  } catch (error) {
    console.error("保存行程或集合失败", error);
    Toast.error("保存失败，请稍后重试");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <VModal
    :visible="visible"
    :title="modalTitle"
    :width="940"
    :mask-closable="false"
    mount-to-body
    @update:visible="handleVisibleChange"
  >
    <div v-if="formVisible" class="fp-dialog fp-group-dialog">
      <FormKit type="form" :actions="false" @submit.prevent>
        <section class="fp-form-section">
          <header>
            <h3>基本信息</h3>
            <p>选择这是一次有明确路线的行程，还是一组主题收藏。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.groupType"
              type="select"
              name="groupType"
              label="类型"
              :options="[
                { label: '行程', value: 'trip' },
                { label: '集合', value: 'collection' },
              ]"
            />
            <FormKit
              v-model="formState.spec.title"
              type="text"
              name="title"
              label="标题"
              validation="required"
              :maxlength="100"
              placeholder="例如：2026 国庆川西行、五岳"
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
              help="公开后才会出现在前台底部“行程”入口中。"
            />
            <FormKit
              v-model="formState.spec.description"
              type="textarea"
              name="description"
              label="说明"
              :rows="3"
              :maxlength="1000"
              placeholder="可以留空"
            />
            <FormKit
              v-model="formState.spec.footprintTypes"
              type="select"
              name="footprintTypes"
              label="足迹类型"
              :options="footprintTypes"
              :multiple="true"
              clearable
              help="选项来自高级设置中的“足迹类型”，可以多选。"
            />
            <FormKit
              v-if="formState.spec.groupType === 'collection'"
              v-model="formState.spec.targetCount"
              type="number"
              name="targetCount"
              label="目标数量"
              min="1"
              step="1"
              help="可留空；例如五岳填写 5。"
            />
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>封面</h3>
            <p>可自定义；留空时按访问时间取第一张成员照片。</p>
          </header>
          <div>
            <FormKit
              v-model="formState.spec.cover"
              type="attachment"
              name="cover"
              label="自定义封面"
              :accepts="['image/*']"
            />
            <img
              v-if="coverPreview"
              class="fp-group-cover-preview"
              :src="coverPreview"
              alt="封面预览"
            />
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>成员与日期</h3>
            <p>成员按访问时间从早到晚排序，日期范围自动计算。</p>
          </header>
          <div>
            <FootprintGroupMemberPicker
              v-model="formState.spec.memberNames"
              :footprints="footprints"
              :max="MAX_GROUP_MEMBERS"
            />
            <ul v-if="missingMemberNames.length" class="fp-group-invalid-members">
              <li v-for="name in missingMemberNames" :key="name">
                <span>失效引用：{{ name }}</span>
                <button type="button" @click="removeMissingMember(name)">移除</button>
              </li>
            </ul>
            <div class="fp-group-range" role="status">
              <strong>{{
                formState.spec.groupType === "trip" ? "行程范围" : "成员时间范围"
              }}</strong>
              <span>{{ dateRangeText }}</span>
            </div>
          </div>
        </section>

        <section class="fp-form-section">
          <header>
            <h3>关联游记</h3>
            <p>可以关联 Halo 文章，也可以填写外部链接。</p>
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
              :multiple="false"
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
              placeholder="https://example.com/travel-note"
            />
          </div>
        </section>
      </FormKit>
    </div>

    <template #footer>
      <VSpace>
        <VButton :disabled="saving" @click="requestClose">取消</VButton>
        <VButton
          type="primary"
          :loading="saving"
          :disabled="!validation.ok || saving"
          @click="save"
        >
          {{ isUpdateMode ? "保存修改" : "创建" }}
        </VButton>
      </VSpace>
    </template>
  </VModal>
</template>
