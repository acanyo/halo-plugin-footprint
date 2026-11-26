<script setup lang="ts">
import { Toast, VButton, VLoading, VModal, VSpace } from "@halo-dev/components";
import RiFileExcel2Line from "~icons/ri/file-excel-2-line";
import RiFileTextLine from "~icons/ri/file-text-line";
import RiUpload2Line from "~icons/ri/upload-2-line";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import * as XLSX from "xlsx";
import { footprintApiClient } from "@/api";
import type { FootprintImportResult, FootprintImportRow, Option } from "@/api/models";
import {
  autoMapColumns,
  buildImportRows,
  IMPORT_MAX_ROWS,
  parseCsvTable,
  recordsFromJson,
  recordsFromTable,
  validateImportRow,
  type FootprintImportMapping,
  type ImportRecord,
  type ParsedFootprintImportRow,
} from "@/utils/footprint-import";

type ImportMode = "csv" | "excel" | "json";
const COMMIT_CHUNK_SIZE = 25;
const DUPLICATE_ROW_MESSAGE = "导入数据中存在相同名称、地址和访问时间";
const importModes: Array<{ value: ImportMode; label: string }> = [
  { value: "csv", label: "CSV" },
  { value: "excel", label: "Excel" },
  { value: "json", label: "JSON" },
];

const props = withDefaults(defineProps<{ visible: boolean }>(), {
  visible: false,
});

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "imported"): void;
}>();

const mode = ref<ImportMode>("csv");
const jsonText = ref("");
const sourceFileName = ref("");
const records = ref<ImportRecord[]>([]);
const columns = ref<string[]>([]);
const mapping = ref<FootprintImportMapping>(emptyMapping());
const footprintTypes = ref<Option[]>([]);
const selectedFootprintType = ref("");
const parsingFile = ref(false);
const previewing = ref(false);
const importing = ref(false);
const editableRows = ref<ParsedFootprintImportRow[]>([]);
const serverPreview = ref<FootprintImportResult | null>(null);
const parseError = ref("");
const modalVisible = ref(false);
const dragActive = ref(false);
const previewProgressDone = ref(0);
const previewProgressTotal = ref(0);
const commitProgressDone = ref(0);
const commitProgressTotal = ref(0);
const previewCancelled = ref(false);
let previewController: AbortController | null = null;
let dragDepth = 0;

onMounted(async () => {
  footprintTypes.value = await footprintApiClient.footprint.listFootprintTypes();
  if (!selectedFootprintType.value) {
    selectedFootprintType.value = footprintTypes.value[0]?.value || "";
  }
});

const mappingKeys: Array<{
  key: keyof FootprintImportMapping;
  label: string;
  required: boolean;
}> = [
  { key: "name", label: "地点名称", required: true },
  { key: "address", label: "地址", required: true },
  { key: "description", label: "描述", required: true },
  { key: "date", label: "日期", required: true },
  { key: "time", label: "时间", required: false },
];

const localRows = computed(() => editableRows.value);

const localReadyCount = computed(
  () => localRows.value.filter((row) => row.errors.length === 0).length,
);

const mappingComplete = computed(() =>
  mappingKeys.filter((item) => item.required).every((item) => Boolean(mapping.value[item.key])),
);

const canPreview = computed(
  () =>
    records.value.length > 0 &&
    localReadyCount.value > 0 &&
    mappingComplete.value &&
    !!selectedFootprintType.value &&
    !parsingFile.value &&
    !previewing.value,
);

const canCommit = computed(
  () =>
    !!serverPreview.value &&
    serverPreview.value.ready > 0 &&
    !importing.value &&
    !previewing.value &&
    serverPreview.value.items.every((item) => item.status !== "valid" || item.longitude != null),
);

const resolvedRowCount = computed(() => serverPreview.value?.items.length || 0);

const hasUnresolvedRows = computed(() => {
  const resolved = new Set((serverPreview.value?.items || []).map((item) => item.rowNumber));
  return localRows.value.some((row) => row.errors.length === 0 && !resolved.has(row.rowNumber));
});

const failedAddressRows = computed(() => {
  const failed = new Set(
    (serverPreview.value?.items || [])
      .filter((item) => item.status === "invalid" || item.status === "failed")
      .map((item) => item.rowNumber),
  );
  return localRows.value.filter((row) => row.errors.length === 0 && failed.has(row.rowNumber));
});

const displayedStatus = (row: FootprintImportRow | (typeof localRows.value)[number]) => {
  if ("errors" in row && row.errors.length) {
    return { label: "待修正", type: "error", message: row.errors.join("；") };
  }
  const resolved = serverPreview.value?.items.find((item) => item.rowNumber === row.rowNumber);
  if (resolved) {
    const labels: Record<string, string> = {
      valid: "可导入",
      duplicate: "已跳过",
      invalid: "失败",
      success: "已导入",
      failed: "失败",
    };
    const types: Record<string, string> = {
      valid: "ready",
      duplicate: "muted",
      invalid: "error",
      success: "success",
      failed: "error",
    };
    return {
      label: labels[resolved.status || "valid"] || resolved.status || "可导入",
      type: types[resolved.status || "valid"] || "muted",
      message: resolved.message || "",
    };
  }
  return { label: "待解析", type: "muted", message: "" };
};

function shouldShowReparse(row: ParsedFootprintImportRow): boolean {
  if (row.errors.length > 0 || previewing.value || importing.value) return false;
  const resolved = serverPreview.value?.items.find((item) => item.rowNumber === row.rowNumber);
  return resolved?.status === "invalid" || resolved?.status === "failed";
}

function rebuildEditableRows() {
  editableRows.value = buildImportRows(records.value, mapping.value, selectedFootprintType.value);
  revalidateEditableRows();
}

function revalidateEditableRows() {
  const seen = new Set<string>();
  editableRows.value.forEach((row) => {
    row.errors = validateImportRow(row).filter((message) => message !== DUPLICATE_ROW_MESSAGE);
    if (!row.errors.length) {
      const key = [row.name.trim(), row.address.trim(), String(row.visitTime || "")].join("\u0000");
      if (seen.has(key)) row.errors.push(DUPLICATE_ROW_MESSAGE);
      else seen.add(key);
    }
  });
  if (serverPreview.value) {
    const invalidRowNumbers = new Set(
      editableRows.value.filter((row) => row.errors.length > 0).map((row) => row.rowNumber),
    );
    serverPreview.value.items = serverPreview.value.items.filter(
      (item) => !invalidRowNumbers.has(item.rowNumber),
    );
    recomputePreviewSummary();
  }
}

function recomputePreviewSummary() {
  if (!serverPreview.value) return;
  const items = serverPreview.value.items;
  serverPreview.value = {
    ...serverPreview.value,
    total: editableRows.value.length,
    ready: items.filter((item) => item.status === "valid").length,
    failed: items.filter((item) => item.status === "invalid" || item.status === "failed").length,
    skipped: items.filter((item) => item.status === "duplicate").length,
    items,
  };
}

function mergePreviewItems(items: FootprintImportRow[]) {
  const merged = new Map((serverPreview.value?.items || []).map((item) => [item.rowNumber, item]));
  items.forEach((item) => merged.set(item.rowNumber, item));
  serverPreview.value = {
    total: editableRows.value.length,
    ready: [...merged.values()].filter((item) => item.status === "valid").length,
    success: 0,
    failed: [...merged.values()].filter(
      (item) => item.status === "invalid" || item.status === "failed",
    ).length,
    skipped: [...merged.values()].filter((item) => item.status === "duplicate").length,
    dryRun: true,
    items: [...merged.values()].sort(
      (left, right) => (left.rowNumber || 0) - (right.rowNumber || 0),
    ),
  };
}

function invalidateResolvedRow(rowNumber: number) {
  if (!serverPreview.value) return;
  serverPreview.value.items = serverPreview.value.items.filter(
    (item) => item.rowNumber !== rowNumber,
  );
  recomputePreviewSummary();
}

function emptyMapping(): FootprintImportMapping {
  return {
    name: "",
    address: "",
    description: "",
    date: "",
    time: "",
  };
}

function resetContent() {
  previewController?.abort();
  previewController = null;
  jsonText.value = "";
  sourceFileName.value = "";
  records.value = [];
  columns.value = [];
  mapping.value = emptyMapping();
  editableRows.value = [];
  parseError.value = "";
  dragActive.value = false;
  dragDepth = 0;
  serverPreview.value = null;
  previewProgressDone.value = 0;
  previewProgressTotal.value = 0;
  commitProgressDone.value = 0;
  commitProgressTotal.value = 0;
  previewCancelled.value = false;
}

function switchMode(nextMode: ImportMode) {
  if (mode.value === nextMode) return;
  mode.value = nextMode;
  resetContent();
}

function applyRecords(nextRecords: ImportRecord[], nextColumns: string[]) {
  records.value = nextRecords;
  columns.value = nextColumns;
  mapping.value = autoMapColumns(nextColumns);
  serverPreview.value = null;
  previewProgressDone.value = 0;
  previewProgressTotal.value = 0;
  rebuildEditableRows();
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await processImportFile(file);
}

async function processImportFile(file: File) {
  resetContent();
  sourceFileName.value = file.name;
  parsingFile.value = true;
  try {
    validateFileType(file);
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("文件不能超过 10 MB");
    }
    const table =
      mode.value === "excel" ? await readExcelFile(file) : parseCsvTable(await file.text());
    applyParsedTable(table);
  } catch (error) {
    console.error("解析导入文件失败", error);
    parseError.value = error instanceof Error ? error.message : "文件解析失败";
    records.value = [];
    columns.value = [];
    editableRows.value = [];
  } finally {
    parsingFile.value = false;
  }
}

function validateFileType(file: File) {
  const name = file.name.toLowerCase();
  if (mode.value === "excel" && !name.endsWith(".xlsx")) {
    throw new Error("仅支持 .xlsx 文件");
  }
  if (mode.value === "csv" && !name.endsWith(".csv") && !name.endsWith(".txt")) {
    throw new Error("仅支持 .csv 或 .txt 文件");
  }
}

function handleDragEnter(event: DragEvent) {
  if (previewing.value || importing.value) return;
  event.preventDefault();
  dragDepth += 1;
  dragActive.value = true;
}

function handleDragOver(event: DragEvent) {
  if (previewing.value || importing.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragActive.value = false;
}

function handleDrop(event: DragEvent) {
  event.preventDefault();
  dragDepth = 0;
  dragActive.value = false;
  if (previewing.value || importing.value) return;
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  void processImportFile(file);
}

async function readExcelFile(file: File): Promise<unknown[][]> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error("Excel 文件中没有工作表");
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: false,
    dateNF: "yyyy-mm-dd",
  });
}

function applyParsedTable(table: unknown[][]) {
  const parsed = recordsFromTable(table);
  if (!parsed.columns.length) throw new Error("没有识别到表头");
  if (!parsed.records.length) throw new Error("文件中没有数据行");
  if (parsed.records.length > IMPORT_MAX_ROWS) {
    throw new Error(`单次最多导入 ${IMPORT_MAX_ROWS} 条，请拆分文件`);
  }
  applyRecords(parsed.records, parsed.columns);
}

let jsonParseTimer: number | undefined;
watch(jsonText, (text) => {
  if (mode.value !== "json") return;
  window.clearTimeout(jsonParseTimer);
  serverPreview.value = null;
  jsonParseTimer = window.setTimeout(() => {
    parseError.value = "";
    if (!text.trim()) {
      records.value = [];
      columns.value = [];
      editableRows.value = [];
      serverPreview.value = null;
      return;
    }
    try {
      const parsed = recordsFromJson(text);
      if (!parsed.columns.length) throw new Error("没有识别到可导入的字段");
      if (parsed.records.length > IMPORT_MAX_ROWS) {
        throw new Error(`单次最多导入 ${IMPORT_MAX_ROWS} 条，请拆分数据`);
      }
      applyRecords(parsed.records, parsed.columns);
    } catch (error) {
      console.error("解析 JSON 失败", error);
      parseError.value = error instanceof Error ? error.message : "JSON 解析失败";
      records.value = [];
      columns.value = [];
      editableRows.value = [];
    }
  }, 250);
});

watch(
  mapping,
  () => {
    if (records.value.length) {
      serverPreview.value = null;
      rebuildEditableRows();
    }
  },
  { deep: true },
);

watch(selectedFootprintType, (type) => {
  if (!records.value.length) return;
  editableRows.value.forEach((row) => {
    row.footprintType = type;
  });
  revalidateEditableRows();
});

function rowHasLocallyCorrectableError(row: ParsedFootprintImportRow): boolean {
  return row.errors.length > 0;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function updateRowText(
  row: ParsedFootprintImportRow,
  field: "name" | "address" | "description",
  event: Event,
) {
  row[field] = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
  revalidateEditableRows();
  invalidateResolvedRow(row.rowNumber);
}

function updateRowType(row: ParsedFootprintImportRow, event: Event) {
  row.footprintType = (event.target as HTMLSelectElement).value;
  revalidateEditableRows();
}

function updateRowVisitTime(row: ParsedFootprintImportRow, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (!value) {
    row.visitTime = "";
  } else {
    const parsed = new Date(value);
    row.visitTime = Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  revalidateEditableRows();
  invalidateResolvedRow(row.rowNumber);
}

function openDateTimePicker(event: Event) {
  const input = event.currentTarget as HTMLInputElement & {
    showPicker?: () => void;
  };
  if (input.disabled) return;
  if (typeof input.showPicker === "function") {
    event.preventDefault();
    try {
      input.showPicker();
    } catch {
      // 浏览器可能因权限或用户激活限制拒绝打开，保留原生点击行为即可。
    }
  }
}

function handleDateTimeKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    openDateTimePicker(event);
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete" || event.key.length === 1) {
    event.preventDefault();
  }
}

function toDatetimeLocal(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function runPreview(rows: ParsedFootprintImportRow[], resetExisting: boolean) {
  const targetRows = rows.filter((row) => !rowHasLocallyCorrectableError(row));
  if (!targetRows.length) {
    if (!rows.length) Toast.warning("没有可解析的数据");
    return;
  }
  if (resetExisting) serverPreview.value = null;
  previewing.value = true;
  previewCancelled.value = false;
  previewProgressDone.value = 0;
  previewProgressTotal.value = targetRows.length;
  previewController?.abort();
  previewController = new AbortController();
  let streamError = "";
  try {
    const payload = targetRows.map(({ errors: _errors, ...row }) => row);
    await footprintApiClient.footprint.streamImportFootprints(
      payload,
      (event) => {
        if (event.type === "start") {
          previewProgressTotal.value = event.total || targetRows.length;
          previewProgressDone.value = 0;
          return;
        }
        if (event.type === "row" && event.item) {
          mergePreviewItems([event.item]);
          previewProgressDone.value += 1;
          return;
        }
        if (event.type === "error") {
          streamError = event.message || "流式解析失败";
        }
      },
      previewController.signal,
    );
    if (streamError) throw new Error(streamError);
    if (previewCancelled.value) {
      Toast.warning("已停止地址解析，保留已完成的结果");
    } else if ((serverPreview.value?.ready || 0) > 0) {
      Toast.success(
        `地址解析完成：可导入 ${serverPreview.value?.ready || 0} 条，失败 ${
          serverPreview.value?.failed || 0
        } 条，跳过 ${serverPreview.value?.skipped || 0} 条`,
      );
    } else {
      Toast.warning("没有可导入的数据，请检查地址和错误提示");
    }
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const name = (error as { name?: string })?.name;
    if (previewCancelled.value || code === "ERR_CANCELED" || name === "AbortError") {
      Toast.warning("已停止地址解析，保留已完成的结果");
    } else {
      console.error("地址解析预览失败", error);
      Toast.error("地址解析预览失败，请检查高德 Key 配置");
    }
  } finally {
    previewController = null;
    previewing.value = false;
  }
}

async function previewAddresses() {
  if (!canPreview.value) return;
  const resolved = new Set((serverPreview.value?.items || []).map((item) => item.rowNumber));
  const pendingRows = localRows.value.filter(
    (row) => row.errors.length === 0 && !resolved.has(row.rowNumber),
  );
  await runPreview(pendingRows, !serverPreview.value);
}

async function reparseRow(row: ParsedFootprintImportRow) {
  if (previewing.value || importing.value) return;
  invalidateResolvedRow(row.rowNumber);
  await runPreview([row], false);
}

async function retryFailedRows() {
  if (previewing.value || importing.value || !serverPreview.value) return;
  const rowsToRetry = [...failedAddressRows.value];
  const rowNumbers = new Set(rowsToRetry.map((row) => row.rowNumber));
  if (!rowNumbers.size) return;
  serverPreview.value.items = serverPreview.value.items.filter(
    (item) => !rowNumbers.has(item.rowNumber),
  );
  recomputePreviewSummary();
  await runPreview(rowsToRetry, false);
}

function clearImportedData() {
  if (previewing.value || importing.value) return;
  resetContent();
  Toast.success("已清空导入数据");
}

function removeImportedRow(rowNumber: number) {
  if (previewing.value || importing.value) return;
  records.value = records.value.filter((record) => record.rowNumber !== rowNumber);
  editableRows.value = editableRows.value.filter((row) => row.rowNumber !== rowNumber);

  if (serverPreview.value) {
    serverPreview.value.items = serverPreview.value.items.filter(
      (item) => item.rowNumber !== rowNumber,
    );
    if (editableRows.value.length === 0) {
      resetContent();
    } else {
      recomputePreviewSummary();
      previewProgressDone.value = Math.min(previewProgressDone.value, editableRows.value.length);
      previewProgressTotal.value = Math.min(previewProgressTotal.value, editableRows.value.length);
    }
  } else if (editableRows.value.length === 0) {
    resetContent();
  }
  Toast.success(`已移除第 ${rowNumber} 行`);
}

function cancelPreview() {
  previewCancelled.value = true;
  previewController?.abort();
}

async function commitImport() {
  if (!canCommit.value || !serverPreview.value || importing.value) return;
  importing.value = true;
  const readyRows = serverPreview.value.items.filter((item) => item.status === "valid");
  commitProgressDone.value = 0;
  commitProgressTotal.value = readyRows.length;
  let commitHadError = false;
  try {
    for (const chunk of chunkRows(readyRows, COMMIT_CHUNK_SIZE)) {
      const result = await footprintApiClient.footprint.importFootprints(
        chunk,
        false,
        selectedFootprintType.value,
      );
      mergePreviewItems(result.items);
      commitProgressDone.value += chunk.length;
    }
    const items = serverPreview.value?.items || [];
    const success = items.filter((item) => item.status === "success").length;
    const skipped = items.filter((item) => item.status === "duplicate").length;
    const failed =
      editableRows.value.filter((row) => row.errors.length > 0).length +
      items.filter((item) => item.status === "invalid" || item.status === "failed").length;
    const remaining = items.filter((item) => item.status === "valid").length;
    serverPreview.value = {
      total: editableRows.value.length,
      ready: remaining,
      success,
      failed,
      skipped,
      dryRun: remaining > 0,
      items,
    };
    if (failed > 0) {
      Toast.warning(`导入完成：成功 ${success} 条，失败 ${failed} 条，跳过 ${skipped} 条`);
    } else {
      Toast.success(`导入完成：成功 ${success} 条，跳过 ${skipped} 条`);
    }
    if (success > 0) emit("imported");
  } catch (error) {
    commitHadError = true;
    console.error("批量导入失败", error);
    Toast.error("批量导入中断，已成功的记录会保留，未完成的可以再次导入");
  } finally {
    importing.value = false;
    if (commitHadError) {
      const items = serverPreview.value?.items || [];
      serverPreview.value = {
        total: editableRows.value.length,
        ready: items.filter((item) => item.status === "valid").length,
        success: items.filter((item) => item.status === "success").length,
        failed:
          editableRows.value.filter((row) => row.errors.length > 0).length +
          items.filter((item) => item.status === "invalid" || item.status === "failed").length,
        skipped: items.filter((item) => item.status === "duplicate").length,
        dryRun: true,
        items,
      };
    }
  }
}

function close() {
  if (importing.value) return;
  if (previewing.value) cancelPreview();
  emit("update:visible", false);
}

function onVisibleChange(visible: boolean) {
  if (!visible && importing.value) return;
  if (!visible && previewing.value) cancelPreview();
  modalVisible.value = visible;
  emit("update:visible", visible);
}

function downloadTemplate() {
  const content = [
    "地点名称 *,地址 *,描述 *,日期 *,时间",
    "西湖,浙江省杭州市西湖区,春天去西湖散步,\u200B2024-05-01,14:30",
    "故宫,北京市东城区景山前街4号,第一次去故宫,\u200B2023-10-02,",
  ].join("\r\n");
  const blob = new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "footprint-import-template.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      if (previewing.value) cancelPreview();
      modalVisible.value = false;
      return;
    }
    resetContent();
    // 异步组件首次挂载时，VModal 需要先收到一次 false 再收到 true 才会打开。
    await nextTick();
    modalVisible.value = true;
  },
  { immediate: true },
);
</script>

<template>
  <VModal
    :visible="modalVisible"
    :width="1080"
    title="批量导入足迹"
    :mask-closable="false"
    mount-to-body
    @update:visible="onVisibleChange"
  >
    <div class="fp-import">
      <section class="fp-import-controls">
        <div class="fp-import-intro">
          <div>
            <strong>先导入地点，再补照片</strong>
            <p>地址由服务端自动解析经纬度；未设置类型和图片可在导入后继续维护。</p>
          </div>
          <div class="fp-import-type">
            <FormKit
              v-model="selectedFootprintType"
              type="select"
              name="importFootprintType"
              label="导入类型"
              validation="required"
              :disabled="previewing || importing"
              :options="
                footprintTypes.map((type) => ({
                  label: type.label,
                  value: type.value,
                }))
              "
              help="默认应用到本批所有足迹，可在下方逐行修改"
            />
          </div>
        </div>

        <div class="fp-import-modes" role="tablist" aria-label="导入格式">
          <button
            v-for="item in importModes"
            :key="item.value"
            type="button"
            role="tab"
            :aria-selected="mode === item.value"
            :class="{ 'is-active': mode === item.value }"
            :disabled="previewing || importing"
            @click="switchMode(item.value)"
          >
            <RiFileTextLine v-if="item.value !== 'excel'" width="16" height="16" />
            <RiFileExcel2Line v-else width="16" height="16" />
            {{ item.label }}
          </button>
        </div>

        <div v-if="mode !== 'json'" class="fp-import-upload">
          <label
            :class="{ 'is-drag-active': dragActive }"
            @dragenter="handleDragEnter"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <RiUpload2Line width="18" height="18" />
            <span>
              {{ sourceFileName || `选择或拖入 ${mode === "excel" ? ".xlsx" : ".csv"} 文件` }}
            </span>
            <input
              type="file"
              :accept="mode === 'excel' ? '.xlsx' : '.csv,.txt'"
              :disabled="previewing || importing"
              @change="handleFileChange"
            />
          </label>
          <div class="fp-import-upload-help">
            <p>第一行为表头，文件不超过 10 MB，单次最多 {{ IMPORT_MAX_ROWS }} 条。</p>
            <button type="button" @click="downloadTemplate">下载 CSV 模板</button>
          </div>
        </div>

        <div v-else class="fp-import-json">
          <FormKit
            v-model="jsonText"
            :disabled="previewing || importing"
            type="textarea"
            name="footprintImportJson"
            label="粘贴 JSON 数组"
            :rows="7"
            placeholder='[
  {
    "地点名称": "西湖",
    "地址": "杭州市西湖区",
    "描述": "春天去西湖散步",
    "日期": "2024-05-01",
    "时间": "14:30"
  }
]'
          />
        </div>

        <div v-if="parseError" class="fp-import-error" role="alert">
          {{ parseError }}
        </div>

        <div v-if="columns.length" class="fp-import-mapping">
          <header>
            <div>
              <strong>字段映射</strong>
              <p>带 * 的字段必须映射；时间留空按 00:00 处理。</p>
            </div>
            <span>{{ records.length }} 行</span>
          </header>
          <div class="fp-import-mapping-grid">
            <div v-for="item in mappingKeys" :key="item.key" class="fp-import-map-field">
              <FormKit
                v-model="mapping[item.key]"
                :disabled="previewing || importing"
                type="select"
                :name="`mapping-${item.key}`"
                :label="`${item.label}${item.required ? ' *' : ''}`"
                :options="[
                  { label: '不映射', value: '' },
                  ...columns.map((column) => ({ label: column, value: column })),
                ]"
              />
            </div>
          </div>
        </div>
      </section>

      <section v-if="records.length" class="fp-import-preview">
        <header>
          <div>
            <strong>解析预览</strong>
            <p>
              本地校验通过 {{ localReadyCount }} / {{ records.length }} 条
              <template v-if="serverPreview">
                · 已解析 {{ resolvedRowCount }} 条 · 可导入 {{ serverPreview.ready }} 条
              </template>
            </p>
          </div>
          <div class="fp-import-preview-actions">
            <VLoading v-if="parsingFile || previewing" />
            <VButton
              size="sm"
              type="danger"
              :disabled="previewing || importing"
              @click="clearImportedData"
            >
              清空数据
            </VButton>
          </div>
        </header>

        <div v-if="previewing || importing || previewProgressTotal > 0" class="fp-import-progress">
          <span>
            <template v-if="importing">
              正在写入 {{ commitProgressDone }} / {{ commitProgressTotal }}
            </template>
            <template v-else-if="previewing">
              正在解析 {{ previewProgressDone }} / {{ previewProgressTotal }}
            </template>
            <template v-else>
              已解析 {{ previewProgressDone }} / {{ previewProgressTotal }}
            </template>
          </span>
          <div>
            <i
              :style="{
                width: `${
                  importing
                    ? commitProgressTotal
                      ? (commitProgressDone / commitProgressTotal) * 100
                      : 0
                    : previewProgressTotal
                      ? (previewProgressDone / previewProgressTotal) * 100
                      : 0
                }%`,
              }"
            />
          </div>
        </div>

        <div class="fp-import-table-wrap">
          <table>
            <thead>
              <tr>
                <th>行</th>
                <th>地点名称</th>
                <th>地址</th>
                <th>描述</th>
                <th>访问时间</th>
                <th>类型</th>
                <th>坐标 / 状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in localRows" :key="row.rowNumber">
                <td class="fp-num">{{ row.rowNumber }}</td>
                <td>
                  <input
                    class="fp-import-inline-input"
                    :value="row.name"
                    aria-label="地点名称"
                    :disabled="previewing || importing"
                    @change="updateRowText(row, 'name', $event)"
                  />
                </td>
                <td>
                  <input
                    class="fp-import-inline-input"
                    :value="row.address"
                    :title="row.address"
                    aria-label="地址"
                    :disabled="previewing || importing"
                    @change="updateRowText(row, 'address', $event)"
                  />
                </td>
                <td>
                  <input
                    class="fp-import-inline-input"
                    :value="row.description"
                    :title="row.description"
                    aria-label="描述"
                    :disabled="previewing || importing"
                    @change="updateRowText(row, 'description', $event)"
                  />
                </td>
                <td>
                  <input
                    class="fp-import-inline-input fp-num"
                    type="datetime-local"
                    step="1"
                    :value="toDatetimeLocal(row.visitTime)"
                    aria-label="访问时间"
                    inputmode="none"
                    :disabled="previewing || importing"
                    @click="openDateTimePicker"
                    @keydown="handleDateTimeKeydown"
                    @paste.prevent
                    @drop.prevent
                    @change="updateRowVisitTime(row, $event)"
                  />
                </td>
                <td>
                  <select
                    class="fp-import-inline-select"
                    :value="row.footprintType"
                    aria-label="足迹类型"
                    :disabled="previewing || importing"
                    @change="updateRowType(row, $event)"
                  >
                    <option v-for="type in footprintTypes" :key="type.value" :value="type.value">
                      {{ type.label }}
                    </option>
                  </select>
                </td>
                <td>
                  <div class="fp-import-row-state">
                    <span class="fp-import-status" :class="`is-${displayedStatus(row).type}`">
                      {{ displayedStatus(row).label }}
                    </span>
                    <small
                      v-if="displayedStatus(row).message"
                      :title="displayedStatus(row).message"
                    >
                      {{ displayedStatus(row).message }}
                    </small>
                    <small
                      v-else-if="
                        serverPreview?.items.find((item) => item.rowNumber === row.rowNumber)
                          ?.longitude != null
                      "
                    >
                      {{
                        serverPreview.items.find((item) => item.rowNumber === row.rowNumber)
                          ?.longitude
                      }},
                      {{
                        serverPreview.items.find((item) => item.rowNumber === row.rowNumber)
                          ?.latitude
                      }}
                    </small>
                    <button
                      v-if="shouldShowReparse(row)"
                      type="button"
                      class="fp-import-reparse"
                      @click="reparseRow(row)"
                    >
                      重新解析此行
                    </button>
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    class="fp-import-remove"
                    :disabled="previewing || importing"
                    @click="removeImportedRow(row.rowNumber)"
                  >
                    移除
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-else-if="!parseError" class="fp-import-empty">
        <RiUpload2Line width="30" height="30" />
        <p>选择文件或粘贴 JSON 后，这里会显示逐行预览。</p>
      </section>
    </div>

    <template #footer>
      <VSpace class="fp-dialog">
        <VButton :disabled="importing" @click="close">取消</VButton>
        <VButton v-if="previewing" @click="cancelPreview"> 停止解析 </VButton>
        <template v-else>
          <VButton
            v-if="!importing && serverPreview?.dryRun && failedAddressRows.length"
            :disabled="previewing"
            @click="retryFailedRows"
          >
            重新解析失败 {{ failedAddressRows.length }} 条
          </VButton>
          <VButton
            v-if="hasUnresolvedRows"
            type="secondary"
            :disabled="!canPreview"
            @click="previewAddresses"
          >
            {{ serverPreview ? "继续解析剩余地址" : "解析地址并预览" }}
          </VButton>
          <VButton
            v-else-if="serverPreview?.dryRun"
            type="secondary"
            :loading="importing"
            :disabled="!canCommit"
            @click="commitImport"
          >
            确认导入 {{ serverPreview.ready }} 条
          </VButton>
          <VButton v-else type="secondary" @click="close">完成</VButton>
        </template>
      </VSpace>
    </template>
  </VModal>
</template>

<style scoped>
.fp-import {
  display: flex;
  max-height: min(72vh, 780px);
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  padding-right: 8px;
  scrollbar-color: rgb(124 123 192 / 45%) transparent;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  overscroll-behavior: contain;
}

.fp-import::-webkit-scrollbar {
  width: 10px;
}

.fp-import::-webkit-scrollbar-track {
  background: transparent;
}

.fp-import::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: 999px;
  background: rgb(124 123 192 / 42%);
  background-clip: content-box;
}

.fp-import::-webkit-scrollbar-thumb:hover {
  background: rgb(124 123 192 / 68%);
  background-clip: content-box;
}

.fp-import-controls,
.fp-import-preview {
  border: 1px solid var(--fp-border, #e7e7ec);
  border-radius: 10px;
  background: var(--fp-card, #fff);
}

.fp-import-controls {
  padding: 16px;
}

.fp-import-intro,
.fp-import-mapping > header,
.fp-import-preview > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.fp-import-intro strong,
.fp-import-mapping strong,
.fp-import-preview strong {
  color: var(--fp-text, #25252b);
  font-size: 14px;
}

.fp-import-intro p,
.fp-import-mapping p,
.fp-import-preview p,
.fp-import-upload p,
.fp-import-empty p {
  margin: 4px 0 0;
  color: var(--fp-muted, #777782);
  font-size: 12px;
  line-height: 1.6;
}

.fp-import-type {
  width: 240px;
  flex: 0 0 auto;
}

.fp-import-type :deep(.formkit-outer) {
  margin: 0;
}

.fp-import-modes {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.fp-import-modes button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: #666872;
  background: #f5f5f7;
  cursor: pointer;
}

.fp-import-modes button.is-active {
  border-color: #d5d5dc;
  color: #202027;
  background: #fff;
  box-shadow: 0 1px 3px rgb(20 20 30 / 8%);
}

.fp-import-upload {
  margin-top: 14px;
}

.fp-import-upload label {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px dashed #cfd0d8;
  border-radius: 8px;
  color: #555762;
  background: #fafafd;
  cursor: pointer;
}

.fp-import-upload label:hover {
  border-color: var(--fp-accent, #7c7bc0);
  color: var(--fp-accent, #7c7bc0);
}

.fp-import-upload label.is-drag-active {
  border-color: var(--fp-accent, #7c7bc0);
  color: var(--fp-accent, #7c7bc0);
  background: var(--fp-accent-bg, #f0f7f4);
  box-shadow: inset 0 0 0 1px var(--fp-accent, #7c7bc0);
}

.fp-import-upload input {
  display: none;
}

.fp-import-upload-help {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.fp-import-upload-help button {
  flex: 0 0 auto;
  padding: 4px 0;
  border: 0;
  color: var(--fp-accent, #7c7bc0);
  background: none;
  cursor: pointer;
  font-size: 12px;
}

.fp-import-upload-help button:hover {
  text-decoration: underline;
}

.fp-import-json {
  margin-top: 14px;
}

.fp-import-error {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 7px;
  color: #a83232;
  background: #fff1f1;
  font-size: 12px;
}

.fp-import-mapping {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #ececf1;
}

.fp-import-mapping > header > span {
  color: #8a8b94;
  font-size: 12px;
}

.fp-import-mapping-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 12px;
}

.fp-import-map-field {
  min-width: 0;
}

.fp-import-map-field :deep(.formkit-outer) {
  margin: 0;
}

.fp-import-map-field :deep(.formkit-label) {
  display: block;
  min-height: 20px;
}

.fp-import-preview > header {
  padding: 14px 16px;
  border-bottom: 1px solid #ececf1;
}

.fp-import-preview-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fp-import-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 16px;
  border-bottom: 1px solid #ececf1;
  color: #666872;
  font-size: 12px;
}

.fp-import-progress span {
  flex: 0 0 auto;
}

.fp-import-progress > div {
  flex: 1;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: #ececf1;
}

.fp-import-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--fp-accent, #7c7bc0);
  transition: width 180ms ease;
}

.fp-import-table-wrap {
  position: relative;
}

.fp-import-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;
}

.fp-import-table-wrap th,
.fp-import-table-wrap td {
  padding: 9px 10px;
  border-bottom: 1px solid #f0f0f3;
  text-align: left;
  vertical-align: middle;
}

.fp-import-table-wrap th {
  position: sticky;
  z-index: 1;
  top: 0;
  color: #777982;
  background: #fafafd;
  font-weight: 600;
}

.fp-import-table-wrap th:first-child,
.fp-import-table-wrap td:first-child {
  width: 44px;
}

.fp-import-table-wrap th:nth-child(2) {
  width: 105px;
  padding-left: 11px;
}

.fp-import-table-wrap th:nth-child(3) {
  width: 18%;
}

.fp-import-table-wrap th:nth-child(4) {
  width: 22%;
}

.fp-import-table-wrap th:nth-child(5) {
  width: 160px;
}

.fp-import-table-wrap th:nth-child(6) {
  width: 95px;
}

.fp-import-table-wrap th:nth-child(7) {
  width: 160px;
}

.fp-import-table-wrap th:nth-child(8) {
  width: 52px;
}

.is-address,
.is-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fp-import-inline-input {
  width: 100%;
  min-width: 0;
  padding: 4px 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--fp-text, #25252b);
  background: transparent;
  font: inherit;
}

.fp-import-inline-input:hover {
  border-color: #dddde3;
  background: #fff;
}

.fp-import-inline-input:focus {
  border-color: var(--fp-accent, #7c7bc0);
  outline: none;
  background: #fff;
}

.fp-import-inline-input:disabled {
  opacity: 0.65;
  cursor: progress;
}

.fp-import-inline-input[type="datetime-local"] {
  cursor: pointer;
  font-size: 11px;
  caret-color: transparent;
}

.fp-import-inline-select {
  width: 100%;
  min-width: 0;
  padding: 4px 0;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--fp-text, #25252b);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.fp-import-inline-select:hover,
.fp-import-inline-select:focus {
  border-color: var(--fp-accent, #7c7bc0);
  outline: none;
  background: #fff;
}

.fp-import-remove {
  padding: 0;
  border: 0;
  color: #a83232;
  background: none;
  cursor: pointer;
  font-size: 11px;
}

.fp-import-remove:hover {
  text-decoration: underline;
}

.fp-import-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fp-import-row-state {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.fp-import-row-state small {
  display: -webkit-box;
  overflow: hidden;
  color: #777982;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.fp-import-reparse {
  width: fit-content;
  padding: 0;
  border: 0;
  color: var(--fp-accent, #7c7bc0);
  background: none;
  cursor: pointer;
  font-size: 11px;
}

.fp-import-reparse:hover {
  text-decoration: underline;
}

.fp-import-status {
  width: fit-content;
  padding: 2px 7px;
  border-radius: 999px;
  background: #f1f1f4;
  color: #6c6e78;
  font-size: 11px;
}

.fp-import-status.is-ready {
  color: #2367a5;
  background: #eaf4ff;
}

.fp-import-status.is-success {
  color: #27774b;
  background: #eaf8f0;
}

.fp-import-status.is-error {
  color: #a83232;
  background: #fff0f0;
}

.fp-import-empty {
  display: grid;
  min-height: 150px;
  place-items: center;
  border: 1px dashed #d7d8df;
  border-radius: 10px;
  color: #a0a1aa;
  text-align: center;
}

@media (max-width: 760px) {
  .fp-import-intro {
    flex-direction: column;
  }

  .fp-import-type {
    width: 100%;
  }

  .fp-import-mapping-grid {
    grid-template-columns: 1fr;
  }
}
</style>
