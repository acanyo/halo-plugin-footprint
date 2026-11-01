import type { Footprint, FootprintGroup } from "@/api/models";

export const MAX_GROUP_MEMBERS = 500;

export interface GroupRange {
  start?: string;
  end?: string;
  days: number;
}

export interface FootprintGroupSummary {
  group: FootprintGroup;
  members: Footprint[];
  missingCount: number;
  range: GroupRange;
  cityCount: number;
  provinceCount: number;
  cover: string;
}

export interface GroupValidationResult {
  ok: boolean;
  message?: string;
}

const FAIL = (message: string): GroupValidationResult => ({ ok: false, message });

export function visitTimeOf(footprint: Footprint | undefined): string {
  return String(footprint?.spec?.createTime || "");
}

export function sortFootprintsByVisitTime(footprints: Footprint[]): Footprint[] {
  return footprints.slice().sort((a, b) => {
    const parsedA = Date.parse(visitTimeOf(a));
    const parsedB = Date.parse(visitTimeOf(b));
    if (Number.isFinite(parsedA) && Number.isFinite(parsedB) && parsedA !== parsedB) {
      return parsedA - parsedB;
    }
    const time = visitTimeOf(a).localeCompare(visitTimeOf(b));
    if (time) return time;
    return String(a.metadata.name).localeCompare(String(b.metadata.name));
  });
}

export function uniqueMemberNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
}

export function groupRange(members: Footprint[]): GroupRange {
  const dated = sortFootprintsByVisitTime(members.filter((member) => visitTimeOf(member)));
  if (!dated.length) return { days: 0 };
  const start = visitTimeOf(dated[0]);
  const end = visitTimeOf(dated[dated.length - 1]);
  const startDate = new Date(start);
  const endDate = new Date(end);
  const days =
    Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
      ? Math.max(
          1,
          Math.floor(
            (new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime() -
              new Date(
                startDate.getFullYear(),
                startDate.getMonth(),
                startDate.getDate(),
              ).getTime()) /
              86400000,
          ) + 1,
        )
      : 0;
  return { start, end, days };
}

function firstGalleryImage(footprint: Footprint): string {
  const images = Array.isArray(footprint.spec.galleryImages) ? footprint.spec.galleryImages : [];
  if (images.length) {
    const normalized = images
      .map((image, index) =>
        typeof image === "string"
          ? { url: image, order: index + 1 }
          : { url: image?.url || "", order: Number(image?.order) || index + 1 },
      )
      .filter((image) => image.url)
      .sort((a, b) => a.order - b.order);
    if (normalized[0]) return normalized[0].url;
  }
  return footprint.spec.image || "";
}

export function groupCover(group: FootprintGroup, members: Footprint[]): string {
  if (group.spec.cover) return group.spec.cover;
  for (const footprint of sortFootprintsByVisitTime(members)) {
    const image = firstGalleryImage(footprint);
    if (image) return image;
  }
  return "";
}

export function summarizeGroup(
  group: FootprintGroup,
  footprintMap: Map<string, Footprint>,
): FootprintGroupSummary {
  const names = uniqueMemberNames(group.spec.memberNames);
  const members = sortFootprintsByVisitTime(
    names.map((name) => footprintMap.get(name)).filter((item): item is Footprint => !!item),
  );
  return {
    group,
    members,
    missingCount: Math.max(0, names.length - members.length),
    range: groupRange(members),
    cityCount: new Set(
      members.map((item) => item.spec.cityAdcode || item.spec.city).filter(Boolean),
    ).size,
    provinceCount: new Set(
      members.map((item) => item.spec.provinceAdcode || item.spec.province).filter(Boolean),
    ).size,
    cover: groupCover(group, members),
  };
}

export function validateFootprintGroup(
  group: FootprintGroup,
  footprintMap: Map<string, Footprint>,
): GroupValidationResult {
  const spec = group.spec;
  if (!String(spec.title || "").trim()) return FAIL("标题不能为空");
  if (spec.groupType !== "trip" && spec.groupType !== "collection") {
    return FAIL("请选择旅程或收藏类型");
  }
  if (spec.visibility !== "public" && spec.visibility !== "private") {
    return FAIL("请选择公开或私密");
  }

  const names = uniqueMemberNames(spec.memberNames);
  if (spec.groupType === "trip" && names.length === 0) {
    return FAIL("旅程至少需要一条足迹");
  }
  if (names.length > MAX_GROUP_MEMBERS) {
    return FAIL(`单段旅程或收藏最多包含 ${MAX_GROUP_MEMBERS} 条足迹`);
  }
  if (names.some((name) => !footprintMap.has(name))) {
    return FAIL("存在已失效的成员足迹，请先移除");
  }
  const targetRaw = spec.targetCount as unknown;
  const hasTarget =
    targetRaw !== undefined && targetRaw !== null && String(targetRaw).trim() !== "";
  if (
    spec.groupType === "collection" &&
    hasTarget &&
    (!Number.isInteger(Number(targetRaw)) || Number(targetRaw) <= 0)
  ) {
    return FAIL("目标数量必须是大于 0 的整数");
  }
  return { ok: true };
}

export function sortGroupSummaries(summaries: FootprintGroupSummary[]): FootprintGroupSummary[] {
  return summaries.slice().sort((a, b) => {
    const aTime = a.range.end || String(a.group.metadata.creationTimestamp || "");
    const bTime = b.range.end || String(b.group.metadata.creationTimestamp || "");
    const byTime = bTime.localeCompare(aTime);
    if (byTime) return byTime;
    return a.group.metadata.name.localeCompare(b.group.metadata.name);
  });
}
