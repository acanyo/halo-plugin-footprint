import type { Footprint, FootprintGroup } from "@/api/models";

export const MAX_GROUP_MEMBERS = 500;
export const GROUP_PINNED_ANNOTATION = "footprint.lik.cc/pinned";
export const GROUP_SORT_ORDER_ANNOTATION = "footprint.lik.cc/sort-order";
export const GROUP_UPDATED_AT_ANNOTATION = "footprint.lik.cc/updated-at";

export interface GroupRange {
  start?: string;
  end?: string;
  days: number;
}

export interface FootprintGroupSummary {
  group: FootprintGroup;
  members: Footprint[];
  memberCount: number;
  searchTerms: string[];
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

export function isGroupPinned(group: FootprintGroup): boolean {
  const annotation = group.metadata.annotations?.[GROUP_PINNED_ANNOTATION];
  if (annotation !== undefined) return String(annotation) === "true";
  return group.spec.pinned === true;
}

export function groupSortOrder(group: FootprintGroup): number | null {
  const raw = group.metadata.annotations?.[GROUP_SORT_ORDER_ANNOTATION] ?? group.spec.sortOrder;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
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

export function sortFootprintsForGroup(
  group: FootprintGroup,
  footprints: Footprint[],
): Footprint[] {
  if (group.spec.groupType === "collection" && group.spec.memberOrderMode === "manual") {
    const order = new Map(
      uniqueMemberNames(group.spec.memberNames).map((name, index) => [name, index]),
    );
    return footprints
      .slice()
      .sort(
        (a, b) =>
          (order.get(a.metadata.name) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.metadata.name) ?? Number.MAX_SAFE_INTEGER),
      );
  }
  return sortFootprintsByVisitTime(footprints);
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
  const startInstant = new Date(start);
  const endInstant = new Date(end);
  const days =
    Number.isFinite(startInstant.getTime()) && Number.isFinite(endInstant.getTime())
      ? Math.max(
          1,
          Math.floor(
            (new Date(
              endInstant.getFullYear(),
              endInstant.getMonth(),
              endInstant.getDate(),
            ).getTime() -
              new Date(
                startInstant.getFullYear(),
                startInstant.getMonth(),
                startInstant.getDate(),
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
  if (group.spec.coverMemberName) {
    const preferred = members.find(
      (footprint) => footprint.metadata.name === group.spec.coverMemberName,
    );
    const image = preferred ? firstGalleryImage(preferred) : "";
    if (image) return image;
  }
  for (const footprint of sortFootprintsForGroup(group, members)) {
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
  const members = sortFootprintsForGroup(
    group,
    names.map((name) => footprintMap.get(name)).filter((item): item is Footprint => !!item),
  );
  return {
    group,
    members,
    memberCount: members.length,
    searchTerms: members.flatMap((member) => [
      member.spec.name,
      member.spec.city,
      member.spec.province,
      member.spec.address,
    ]).filter((value): value is string => !!value),
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
  if (
    spec.memberOrderMode &&
    spec.memberOrderMode !== "time" &&
    spec.memberOrderMode !== "manual"
  ) {
    return FAIL("成员排序方式不正确");
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
  if (
    spec.coverMemberName &&
    !names.includes(spec.coverMemberName)
  ) {
    return FAIL("封面成员必须是当前收藏或旅程中的成员");
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
  if (
    spec.groupType === "collection" &&
    Number(spec.targetCount) > 0 &&
    names.length > Number(spec.targetCount)
  ) {
    return FAIL("收藏成员数量不能超过目标数量");
  }
  return { ok: true };
}

export function sortGroupSummaries(summaries: FootprintGroupSummary[]): FootprintGroupSummary[] {
  return summaries.slice().sort((a, b) => {
    const pinnedA = isGroupPinned(a.group);
    const pinnedB = isGroupPinned(b.group);
    if (pinnedA !== pinnedB) return pinnedA ? -1 : 1;
    const orderA = groupSortOrder(a.group);
    const orderB = groupSortOrder(b.group);
    const hasOrderA = orderA !== null;
    const hasOrderB = orderB !== null;
    if (hasOrderA !== hasOrderB) return hasOrderA ? -1 : 1;
    if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
    const aTime =
      a.group.metadata.annotations?.[GROUP_UPDATED_AT_ANNOTATION] ||
      a.range.end ||
      String(a.group.metadata.creationTimestamp || "");
    const bTime =
      b.group.metadata.annotations?.[GROUP_UPDATED_AT_ANNOTATION] ||
      b.range.end ||
      String(b.group.metadata.creationTimestamp || "");
    const byTime = bTime.localeCompare(aTime);
    if (byTime) return byTime;
    return a.group.metadata.name.localeCompare(b.group.metadata.name);
  });
}
