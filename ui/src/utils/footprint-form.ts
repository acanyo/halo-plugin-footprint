/**
 * 足迹表单的校验规则。
 *
 * 原先这些判断散在编辑窗的 `isFormValid` 计算属性和 `handleSubmit` 的一串
 * if 里，同一条规则（必填、范围）写了两遍，改一处忘另一处就会「按钮可点但保存报错」。
 * 这里收敛成「校验 → 返回第一条错误」，调用方只负责把错误显示出来。
 */

import type { Footprint } from "@/api/models";

export const ZOOM_RANGE = [4, 26] as const;
export const PITCH_RANGE = [0, 83] as const;
export const ROTATION_RANGE = [-360, 360] as const;

/** 俯仰 / 旋转只在缩放级别足够大时才有意义（与表单里的条件显示一致）。 */
export const PITCH_VISIBLE_FROM_ZOOM = 18;

export interface FormValidationResult {
  ok: boolean;
  message?: string;
}

const OK: FormValidationResult = { ok: true };

function fail(message: string): FormValidationResult {
  return { ok: false, message };
}

function isBlank(value: string | undefined | null): boolean {
  return !value || !value.trim();
}

/** 缩放级别达到该值时，表单才显示 3D 俯仰 / 旋转两项。 */
export function shouldShowPitchAngle(zoomLevel: string | undefined): boolean {
  return parseFloat(zoomLevel || "0") >= PITCH_VISIBLE_FROM_ZOOM;
}

function checkNumberInRange(
  value: string | undefined,
  range: readonly [number, number],
  label: string,
): FormValidationResult {
  const parsed = parseFloat(value ?? "");
  if (Number.isNaN(parsed)) return fail(`${label}必须是数字`);
  if (parsed < range[0] || parsed > range[1]) {
    return fail(`${label}必须在 ${range[0]} 到 ${range[1]} 之间`);
  }
  return OK;
}

/**
 * 校验表单主体。
 *
 * @param state      表单数据
 * @param createTime 创建时间（独立于 spec 的 datetime-local 输入）
 * @returns 第一条不通过的规则；全部通过时 `ok` 为 true
 */
export function validateFootprintForm(
  state: Footprint,
  createTime: string | undefined,
): FormValidationResult {
  const spec = state.spec;

  if (isBlank(spec.name)) return fail("足迹名称不能为空");
  if (isBlank(spec.description)) return fail("足迹描述不能为空");
  if (isBlank(spec.address)) return fail("地址不能为空");
  if (isBlank(spec.zoomLevel)) return fail("缩放级别不能为空");
  if (!createTime) return fail("请选择创建时间");

  const zoom = checkNumberInRange(spec.zoomLevel, ZOOM_RANGE, "缩放级别");
  if (!zoom.ok) return zoom;

  // 俯仰 / 旋转在表单里是条件显示的：缩放不够大时它们不参与校验，
  // 否则用户根本看不到那两个输入框，却会被告知"俯仰角不能为空"
  if (shouldShowPitchAngle(spec.zoomLevel)) {
    // 历史数据里这两项可能是空串（早期版本不校验）。按 0 处理而不是拦下保存 ——
    // 0 是它们的默认值，用户没填不代表数据有问题
    const pitch = checkNumberInRange(spec.pitchAngle || "0", PITCH_RANGE, "俯仰角度");
    if (!pitch.ok) return pitch;

    const rotation = checkNumberInRange(spec.rotationAngle || "0", ROTATION_RANGE, "旋转角度");
    if (!rotation.ok) return rotation;
  }

  return OK;
}

/**
 * 校验图片墙的显示顺序：必须是大于 0 的整数且不重复。
 *
 * 顺序决定前台图片墙的排列，出现重复时排序结果不稳定，所以宁可拦住保存。
 */
export function validateGalleryOrders(orders: number[]): FormValidationResult {
  if (orders.some((order) => !Number.isInteger(order) || order < 1)) {
    return fail("图片墙显示顺序必须是大于 0 的整数");
  }
  if (new Set(orders).size !== orders.length) {
    return fail("图片墙显示顺序不能重复");
  }
  return OK;
}
