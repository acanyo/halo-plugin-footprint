import type {Footprint, GalleryImage} from "@/api/models";

/**
 * 仪表盘小组件用的聚合口径。
 *
 * 图片数量刻意与前台一致（见主题脚本里的 `cityWallImages`）：
 * 有图墙按图墙张数算，没有图墙但有主图算 1 张，两者都没有就是 0。
 * 这样后台小组件里看到的"照片数"和访客在地球上看到的图片墙张数是同一个口径。
 */
export interface FootprintSummary {
  photos: number;
  tickets: number;
  thisYear: number;
  types: {name: string; count: number}[];
  years: {year: number; count: number}[];
}

function normalizeGallery(value: unknown): GalleryImage[] {
  let gallery = value;
  if (typeof gallery === "string") {
    try {
      gallery = JSON.parse(gallery);
    } catch (e) {
      gallery = [];
    }
  }
  if (!Array.isArray(gallery)) return [];
  return gallery.filter((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    return !!(item && typeof item === "object" && (item as GalleryImage).url);
  }) as GalleryImage[];
}

/** 一条足迹的照片张数（与前台图片墙同口径） */
export function footprintPhotoCount(fp: Footprint): number {
  const gallery = normalizeGallery(fp?.spec?.galleryImages);
  if (gallery.length) return gallery.length;
  return fp?.spec?.image ? 1 : 0;
}

/** 足迹时间：优先 spec.createTime，退回 metadata.creationTimestamp */
export function footprintTime(fp: Footprint): number {
  const raw = fp?.spec?.createTime || fp?.metadata?.creationTimestamp || "";
  if (!raw) return 0;
  // 后台存的是 "YYYY-MM-DD HH:mm"，ISO 也能吃
  const time = new Date(String(raw).replace(" ", "T")).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function summarizeFootprints(items: Footprint[]): FootprintSummary {
  const list = Array.isArray(items) ? items : [];
  const typeCount = new Map<string, number>();
  const yearCount = new Map<number, number>();
  const thisYear = new Date().getFullYear();

  let photos = 0;
  let tickets = 0;
  let currentYear = 0;

  list.forEach((fp) => {
    photos += footprintPhotoCount(fp);
    if (fp?.spec?.ticketImage) tickets += 1;

    const type = (fp?.spec?.footprintType || "未分类").trim() || "未分类";
    typeCount.set(type, (typeCount.get(type) || 0) + 1);

    const time = footprintTime(fp);
    if (time) {
      const year = new Date(time).getFullYear();
      yearCount.set(year, (yearCount.get(year) || 0) + 1);
      if (year === thisYear) currentYear += 1;
    }
  });

  const byCountDesc = <T extends {count: number}>(rows: T[]) =>
    rows.sort((a, b) => b.count - a.count);

  return {
    photos,
    tickets,
    thisYear: currentYear,
    types: byCountDesc(
      [...typeCount.entries()].map(([name, count]) => ({name, count})),
    ),
    years: byCountDesc(
      [...yearCount.entries()].map(([year, count]) => ({year, count})),
    ),
  };
}
