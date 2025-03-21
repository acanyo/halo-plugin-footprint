<script setup lang="ts">
defineEmits<{
  (e: "click"): void;
}>();
</script>

<template>
  <button
    class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    @click="$emit('click')"
  >
    <span>清除筛选</span>
  </button>
</template> 