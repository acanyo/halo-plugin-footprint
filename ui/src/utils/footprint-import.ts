import type { FootprintImportRow } from "@/api/models";

export interface ImportRecord {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface ImportTable {
  columns: string[];
  records: ImportRecord[];
}

export interface FootprintImportMapping {
  name: string;
  address: string;
  description: string;
  date: string;
  time: string;
}

export interface ParsedFootprintImportRow extends FootprintImportRow {
  errors: string[];
}

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_DEFAULT_ZOOM_LEVEL = "14";

const COLUMN_ALIASES: Record<keyof FootprintImportMapping, string[]> = {
  name: ["地点名称", "足迹名称", "名称", "地方", "name", "title", "place"],
  address: ["地址", "详细地址", "地点地址", "address", "location"],
  description: ["描述", "足迹描述", "简介", "备注", "description", "desc", "remark"],
  date: [
    "日期",
    "访问日期",
    "出行日期",
    "日期时间",
    "访问时间",
    "date",
    "datetime",
    "visitdate",
    "visiteddate",
    "visittime",
  ],
  time: ["时间", "时刻", "time"],
};
const INVISIBLE_CELL_PREFIX = /^[\u200B\uFEFF]+/;
const LEGACY_ZOOM_COLUMNS = new Set(["缩放级别", "地图缩放", "zoom", "zoomlevel"]);

export function parseCsvTable(text: string): unknown[][] {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function recordsFromTable(table: unknown[][]): ImportTable {
  if (!Array.isArray(table) || table.length === 0) {
    return { columns: [], records: [] };
  }
  const headers = table[0].map((value, index) => {
    const text = String(value ?? "").trim();
    return text || `第 ${index + 1} 列`;
  });
  const indexedColumns = makeUnique(headers)
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => !isIgnoredImportColumn(column));
  const columns = indexedColumns.map(({ column }) => column);
  const records: ImportRecord[] = [];
  for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    const cells = table[rowIndex] || [];
    if (!cells.some((value) => String(value ?? "").trim())) continue;
    const values: Record<string, unknown> = {};
    indexedColumns.forEach(({ column, index }) => {
      values[column] = cells[index] ?? "";
    });
    records.push({ rowNumber: rowIndex, values });
  }
  return { columns, records };
}

export function recordsFromJson(text: string): ImportTable {
  const source = text.trim();
  if (!source) return { columns: [], records: [] };
  const parsed: unknown = JSON.parse(source);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const records: ImportRecord[] = [];
  const columns: string[] = [];

  list.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const values = flattenObject(item as Record<string, unknown>);
    Object.keys(values)
      .filter((key) => isIgnoredImportColumn(key))
      .forEach((key) => delete values[key]);
    Object.keys(values).forEach((key) => {
      if (!columns.includes(key)) columns.push(key);
    });
    records.push({ rowNumber: index + 1, values });
  });
  return { columns, records };
}

export function autoMapColumns(columns: string[]): FootprintImportMapping {
  const result: FootprintImportMapping = {
    name: "",
    address: "",
    description: "",
    date: "",
    time: "",
  };
  const normalizedColumns = columns.map((column) => ({
    original: column,
    normalized: normalizeColumnHeader(column),
  }));
  (Object.keys(COLUMN_ALIASES) as Array<keyof FootprintImportMapping>).forEach((key) => {
    const alias = COLUMN_ALIASES[key]
      .map((value) => value.toLowerCase())
      .find((candidate) => normalizedColumns.some((column) => column.normalized === candidate));
    result[key] = normalizedColumns.find((column) => column.normalized === alias)?.original ?? "";
  });
  return result;
}

export function buildImportRows(
  records: ImportRecord[],
  mapping: FootprintImportMapping,
  footprintType: string,
): ParsedFootprintImportRow[] {
  return records.map((record) => {
    const name = valueAt(record.values, mapping.name);
    const address = valueAt(record.values, mapping.address);
    const description = valueAt(record.values, mapping.description);
    const date = valueAt(record.values, mapping.date);
    const time = valueAt(record.values, mapping.time);

    const visitTime = parseLocalVisitTime(date, time);
    const row: ParsedFootprintImportRow = {
      rowNumber: record.rowNumber,
      name,
      address,
      description,
      visitTime: visitTime.ok ? visitTime.value : "",
      zoomLevel: IMPORT_DEFAULT_ZOOM_LEVEL,
      footprintType: String(footprintType || "").trim(),
      errors: [],
    };
    row.errors = validateImportRow(row, visitTime.ok ? [] : [visitTime.message]);
    return row;
  });
}

/**
 * 重新校验一行。日期时间已经是 ISO 字符串；额外错误用于保留原始日期解析失败原因。
 */
export function validateImportRow(
  row: Pick<FootprintImportRow, "name" | "address" | "description" | "visitTime" | "footprintType">,
  extraErrors: string[] = [],
): string[] {
  const errors = [...extraErrors];
  const name = String(row.name || "").trim();
  const address = String(row.address || "").trim();
  const description = String(row.description || "").trim();
  const visitTime = String(row.visitTime || "").trim();
  const footprintType = String(row.footprintType || "").trim();

  if (!name) errors.push("地点名称不能为空");
  else if (name.length > 100) errors.push("地点名称不能超过 100 个字符");
  if (!description) errors.push("描述不能为空");
  else if (description.length > 500) errors.push("描述不能超过 500 个字符");
  if (!address) errors.push("地址不能为空");
  else if (address.length > 200) errors.push("地址不能超过 200 个字符");

  if (!visitTime) {
    if (!extraErrors.length) errors.push("日期不能为空");
  } else if (Number.isNaN(new Date(visitTime).getTime())) {
    errors.push("日期时间格式不正确");
  }
  if (!footprintType) errors.push("请选择足迹类型");

  return [...new Set(errors)];
}

export function parseLocalVisitTime(
  dateValue: unknown,
  timeValue?: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    year = dateValue.getFullYear();
    month = dateValue.getMonth() + 1;
    day = dateValue.getDate();
    hour = dateValue.getHours();
    minute = dateValue.getMinutes();
    second = dateValue.getSeconds();
  } else {
    const text = String(dateValue ?? "").trim();
    if (!text) return { ok: false, message: "日期不能为空" };

    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, message: "日期格式不正确" };
      }
      year = parsed.getFullYear();
      month = parsed.getMonth() + 1;
      day = parsed.getDate();
      hour = parsed.getHours();
      minute = parsed.getMinutes();
      second = parsed.getSeconds();
    } else {
      const match =
        /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(
          text,
        );
      if (!match) return { ok: false, message: "日期格式不正确，应使用 YYYY-MM-DD" };
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4] || 0);
      minute = Number(match[5] || 0);
      second = Number(match[6] || 0);
    }
  }

  if (timeValue instanceof Date && !Number.isNaN(timeValue.getTime())) {
    hour = timeValue.getHours();
    minute = timeValue.getMinutes();
    second = timeValue.getSeconds();
  } else if (typeof timeValue === "number" && timeValue >= 0 && timeValue < 1) {
    const totalSeconds = Math.round(timeValue * 24 * 60 * 60);
    hour = Math.floor(totalSeconds / 3600) % 24;
    minute = Math.floor((totalSeconds % 3600) / 60);
    second = totalSeconds % 60;
  } else {
    const timeText = String(timeValue ?? "").trim();
    if (timeText) {
      const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(timeText);
      if (!match) return { ok: false, message: "时间格式不正确，应使用 HH:mm 或 HH:mm:ss" };
      hour = Number(match[1]);
      minute = Number(match[2]);
      second = Number(match[3] || 0);
    }
  }

  const parsed = new Date(year, month - 1, day, hour, minute, second);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() + 1 !== month ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return { ok: false, message: "日期或时间超出有效范围" };
  }
  return { ok: true, value: toVisitTimeInstant(parsed) };
}

function toVisitTimeInstant(date: Date): string {
  // 与单条编辑一致：按浏览器本地时间输入，再用 ISO Instant 提交，
  // 避免控制台浏览器与 Halo 服务端机器时区不一致时发生偏移。
  return date.toISOString();
}

function valueAt(values: Record<string, unknown>, path: string): string {
  if (!path) return "";
  const value = path.split(".").reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, values);
  return normalizeCellText(value);
}

function normalizeColumnHeader(value: string): string {
  return value
    .trim()
    .replace(/\s*\*+\s*$/u, "")
    .toLowerCase();
}

function isIgnoredImportColumn(value: string): boolean {
  const leaf = value.split(".").pop() || value;
  return LEGACY_ZOOM_COLUMNS.has(normalizeColumnHeader(leaf));
}

function normalizeCellText(value: unknown): string {
  return String(value ?? "")
    .replace(INVISIBLE_CELL_PREFIX, "")
    .trim();
}

function flattenObject(
  value: Record<string, unknown>,
  prefix = "",
  target: Record<string, unknown> = {},
): Record<string, unknown> {
  Object.entries(value).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child) && !(child instanceof Date)) {
      flattenObject(child as Record<string, unknown>, path, target);
    } else {
      target[path] = child;
    }
  });
  return target;
}

function makeUnique(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value) => {
    const count = (seen.get(value) ?? 0) + 1;
    seen.set(value, count);
    return count === 1 ? value : `${value} (${count})`;
  });
}
