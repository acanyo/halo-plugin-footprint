import { describe, expect, it } from "vitest";
import type { Footprint, FootprintGroup } from "@/api/models";
import {
  GROUP_PINNED_ANNOTATION,
  GROUP_SORT_ORDER_ANNOTATION,
  groupRange,
  sortFootprintsForGroup,
  sortFootprintsByVisitTime,
  sortGroupSummaries,
  summarizeGroup,
  uniqueMemberNames,
  validateFootprintGroup,
} from "./footprint-groups";

function footprint(
  name: string,
  createTime: string,
  overrides: Partial<Footprint["spec"]> = {},
): Footprint {
  return {
    apiVersion: "footprint.lik.cc/v1alpha1",
    kind: "Footprint",
    metadata: { name },
    spec: {
      name,
      longitude: 116.4,
      latitude: 39.9,
      zoomLevel: "12",
      pitchAngle: "0",
      rotationAngle: "0",
      createTime,
      ...overrides,
    },
  };
}

function group(overrides: Partial<FootprintGroup["spec"]> = {}): FootprintGroup {
  return {
    apiVersion: "footprint.lik.cc/v1alpha1",
    kind: "FootprintGroup",
    metadata: { name: "trip", creationTimestamp: "2024-01-01T00:00:00Z" },
    spec: {
      groupType: "trip",
      title: "国庆旅程",
      visibility: "public",
      memberNames: [],
      ...overrides,
    },
  };
}

describe("footprint groups", () => {
  it("去重成员并按完整创建时间排序", () => {
    expect(uniqueMemberNames(["b", "a", "b", ""])).toEqual(["b", "a"]);
    const members = sortFootprintsByVisitTime([
      footprint("late", "2024-10-01T18:30:00"),
      footprint("early", "2024-10-01T08:10:00"),
    ]);
    expect(members.map((member) => member.metadata.name)).toEqual(["early", "late"]);
    expect(groupRange(members).days).toBe(1);
  });

  it("允许空收藏，但拒绝空旅程", () => {
    const map = new Map<string, Footprint>();
    expect(validateFootprintGroup(group({ memberNames: [] }), map).ok).toBe(false);
    expect(
      validateFootprintGroup(
        group({ groupType: "collection", memberNames: [], targetCount: 5 }),
        map,
      ).ok,
    ).toBe(true);
  });

  it("统计有效成员、失效引用和城市覆盖", () => {
    const a = footprint("a", "2024-10-01T08:00:00Z", { city: "北京", province: "北京" });
    const b = footprint("b", "2024-10-02T08:00:00Z", { city: "上海", province: "上海" });
    const summary = summarizeGroup(
      group({ memberNames: ["a", "missing", "b"] }),
      new Map([
        ["a", a],
        ["b", b],
      ]),
    );
    expect(summary.members.map((member) => member.metadata.name)).toEqual(["a", "b"]);
    expect(summary.missingCount).toBe(1);
    expect(summary.cityCount).toBe(2);
    expect(summary.provinceCount).toBe(2);
  });

  it("收藏支持手动顺序", () => {
    const earlier = footprint("a", "2024-10-01T08:00:00Z");
    const later = footprint("b", "2024-10-02T08:00:00Z");
    const collection = group({
      groupType: "collection",
      memberOrderMode: "manual",
      memberNames: ["b", "a"],
    });
    expect(sortFootprintsForGroup(collection, [earlier, later]).map((item) => item.metadata.name))
      .toEqual(["b", "a"]);
    expect(groupRange([earlier, later]).days).toBe(2);
  });

  it("置顶记录优先，其次按手动排序值排列", () => {
    const map = new Map<string, Footprint>();
    const summaries = [
      summarizeGroup(group({ memberNames: [], sortOrder: 2 }), map),
      summarizeGroup(group({ memberNames: [], pinned: true, sortOrder: 9 }), map),
      summarizeGroup(group({ memberNames: [], sortOrder: 1 }), map),
    ];
    expect(sortGroupSummaries(summaries).map((summary) => summary.group.spec.sortOrder))
      .toEqual([9, 1, 2]);
  });

  it("兼容 metadata.annotations 中的置顶与排序值", () => {
    const pinned = group({ memberNames: [] });
    pinned.metadata.annotations = {
      [GROUP_PINNED_ANNOTATION]: "true",
      [GROUP_SORT_ORDER_ANNOTATION]: "7",
    };
    const normal = group({ memberNames: [], sortOrder: 1 });
    expect(sortGroupSummaries([
      summarizeGroup(normal, new Map()),
      summarizeGroup(pinned, new Map()),
    ])[0].group).toBe(pinned);
  });
});
