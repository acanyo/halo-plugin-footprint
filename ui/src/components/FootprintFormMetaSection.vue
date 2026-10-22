<script setup lang="ts">
/**
 * 足迹编辑窗 · 其他信息分组。
 *
 * 足迹类型、关联对象（文章 / 自定义链接）、关联足迹、创建时间。
 * 「关联类型」是纯视图状态（决定显示文章选择器还是 URL 输入框），
 * 不写进足迹数据，因此由本组件自己持有。
 */

import { ref } from "vue";
import type { FootprintSpec, Option } from "@/api/models";

defineProps<{
  footprintTypes: Option[];
}>();

const spec = defineModel<FootprintSpec>("spec", { required: true });
const createTime = defineModel<string | undefined>("createTime", { required: true });

type ArticleType = "post" | "custom";
const articleType = ref<ArticleType>("post");
</script>

<template>
  <div class="mt-8 md:grid md:grid-cols-4 md:gap-6">
    <div class="md:col-span-1">
      <div class="sticky top-0 pt-1">
        <span class="text-sm font-semibold text-gray-700">其他信息</span>
      </div>
    </div>
    <div class="divide-y divide-gray-100 md:col-span-3">
      <FormKit
        v-model="spec.footprintType"
        :options="footprintTypes"
        label="足迹类型"
        name="footprintType"
        type="select"
      />
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
      <template v-if="articleType === 'post'">
        <FormKit
          v-model="spec.article"
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
      </template>
      <template v-else-if="articleType === 'custom'">
        <FormKit
          v-model="spec.article"
          type="text"
          name="customArticle"
          label="链接地址"
          placeholder="请输入完整URL，如 https://example.com"
          validation="url"
          :validation-messages="{
            url: '请输入有效的URL地址，需包含http://或https://',
          }"
        />
      </template>
      <FormKit
        v-model="spec.metadataNames"
        type="select"
        name="metadataNames"
        label="关联足迹"
        :multiple="true"
        :debounce="300"
        :min-chars="1"
        clearable
        searchable
        action="/apis/api.footprint.lik.cc/v1alpha1/footprints"
        :request-option="{
          method: 'GET',
          pageField: 'page',
          sizeField: 'size',
          totalField: 'total',
          itemsField: 'items',
          labelField: 'spec.name',
          valueField: 'metadata.name',
        }"
      />
      <FormKit
        v-model="createTime"
        type="datetime-local"
        min="0000-01-01T00:00"
        max="9999-12-31T23:59"
        name="createTime"
        validation="required"
        label="创建时间"
        help="如果为空，则使用当前时间"
      />
    </div>
  </div>
</template>
