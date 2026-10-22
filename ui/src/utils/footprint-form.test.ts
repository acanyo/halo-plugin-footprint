import { describe, expect, it } from "vitest";
import {
  PITCH_VISIBLE_FROM_ZOOM,
  shouldShowPitchAngle,
  validateFootprintForm,
  validateGalleryOrders,
} from "@/utils/footprint-form";
import type { Footprint } from "@/api/models";

function form(overrides: Partial<Footprint["spec"]> = {}): Footprint {
  return {
    apiVersion: "footprint.lik.cc/v1alpha1",
    kind: "Footprint",
    metadata: { name: "", generateName: "footprint-" },
    spec: {
      name: "杭州",
      description: "西湖",
      address: "杭州市西湖区",
      longitude: 120.1,
      latitude: 30.2,
      zoomLevel: "14",
      pitchAngle: "0",
      rotationAngle: "0",
      createTime: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
  };
}

describe("shouldShowPitchAngle", () => {
  it("缩放达到阈值才显示", () => {
    expect(PITCH_VISIBLE_FROM_ZOOM).toBe(18);
    expect(shouldShowPitchAngle("17.9")).toBe(false);
    expect(shouldShowPitchAngle("18")).toBe(true);
    expect(shouldShowPitchAngle("20")).toBe(true);
  });

  it("空值不显示，不抛异常", () => {
    expect(shouldShowPitchAngle(undefined)).toBe(false);
    expect(shouldShowPitchAngle("")).toBe(false);
  });
});

describe("validateFootprintForm", () => {
  it("完整表单通过", () => {
    expect(validateFootprintForm(form(), "2026-01-01T00:00").ok).toBe(true);
  });

  it("必填项按顺序报错", () => {
    expect(validateFootprintForm(form({ name: " " }), "2026-01-01T00:00").message).toBe(
      "足迹名称不能为空",
    );
    expect(validateFootprintForm(form({ description: "" }), "2026-01-01T00:00").message).toBe(
      "足迹描述不能为空",
    );
    expect(validateFootprintForm(form({ address: "" }), "2026-01-01T00:00").message).toBe(
      "地址不能为空",
    );
    expect(validateFootprintForm(form(), undefined).message).toBe("请选择创建时间");
  });

  it("缩放级别超出范围被拦住", () => {
    expect(validateFootprintForm(form({ zoomLevel: "3" }), "2026-01-01T00:00").message).toBe(
      "缩放级别必须在 4 到 26 之间",
    );
    expect(validateFootprintForm(form({ zoomLevel: "abc" }), "2026-01-01T00:00").message).toBe(
      "缩放级别必须是数字",
    );
  });

  it("缩放不足 18 时不校验俯仰与旋转", () => {
    const state = form({ zoomLevel: "14", pitchAngle: "", rotationAngle: "" });
    expect(validateFootprintForm(state, "2026-01-01T00:00").ok).toBe(true);
  });

  it("缩放达到 18 时俯仰与旋转必须合法", () => {
    const missingPitch = form({ zoomLevel: "19", pitchAngle: "abc" });
    expect(validateFootprintForm(missingPitch, "2026-01-01T00:00").message).toBe(
      "俯仰角度必须是数字",
    );

    const badRotation = form({ zoomLevel: "19", rotationAngle: "400" });
    expect(validateFootprintForm(badRotation, "2026-01-01T00:00").message).toBe(
      "旋转角度必须在 -360 到 360 之间",
    );
  });

  it("缩放达到 18 但俯仰/旋转为空时按 0 处理，不拦保存", () => {
    const state = form({ zoomLevel: "19", pitchAngle: "", rotationAngle: "" });
    expect(validateFootprintForm(state, "2026-01-01T00:00").ok).toBe(true);
  });
});

describe("validateGalleryOrders", () => {
  it("空列表通过", () => {
    expect(validateGalleryOrders([]).ok).toBe(true);
  });

  it("正序整数通过", () => {
    expect(validateGalleryOrders([1, 2, 3]).ok).toBe(true);
  });

  it("非整数或小于 1 被拦住", () => {
    expect(validateGalleryOrders([1, 1.5]).message).toBe(
      "图片墙显示顺序必须是大于 0 的整数",
    );
    expect(validateGalleryOrders([0, 1]).message).toBe(
      "图片墙显示顺序必须是大于 0 的整数",
    );
  });

  it("重复顺序被拦住", () => {
    expect(validateGalleryOrders([1, 1]).message).toBe("图片墙显示顺序不能重复");
  });
});
