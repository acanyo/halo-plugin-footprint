<script setup lang="ts">
import { computed } from "vue";
import { VDropdown, VDropdownItem } from "@halo-dev/components";

interface Item {
  label: string;
  value?: string;
}

const props = defineProps<{
  modelValue?: string;
  label: string;
  items: Item[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value?: string): void;
}>();

const selectedItem = computed(() => {
  return props.items.find((item) => item.value === props.modelValue);
});

const handleSelect = (value?: string) => {
  emit("update:modelValue", value);
};
</script>

<template>
  <div class="relative inline-block text-left">
    <VDropdown>
      <button
        type="button"
        class="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        <span>{{ label }}：{{ selectedItem?.label || "全部" }}</span>
      </button>
      <template #popper>
        <div class="w-36 max-h-60 overflow-auto">
          <VDropdownItem
            v-for="item in items"
            :key="item.label"
            :selected="item.value === modelValue"
            @click="handleSelect(item.value)"
          >
            {{ item.label }}
          </VDropdownItem>
        </div>
      </template>
    </VDropdown>
  </div>
</template>

<style scoped lang="scss">
.filter-item {
  display: flex;
  align-items: center;
  
  .filter-label {
    margin-right: 0.5rem;
    font-size: 0.875rem;
    color: #4b5563;
  }
  
  .filter-btn {
    min-width: 80px;
    justify-content: center;
  }
}
</style> 