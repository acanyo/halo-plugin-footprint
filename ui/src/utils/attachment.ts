/**
 * 附件字段的取值与归一化。
 *
 * Halo 的 FormKit `attachment` 组件在不同版本里会返回字符串、对象或单元素数组，
 * 甚至同一次提交里不同字段的形态也可能不一样。这些判断原先写在编辑窗里，
 * 和表单逻辑混在一起；抽出来之后既能在别处复用（管理页、以后可能的批量改图），
 * 也能直接写单测覆盖各种返回形态。
 */

/** 图片处理后缀，如 `!w100`、`!style-logo`。 */
const IMAGE_PROCESS_SUFFIX = /(\.(?:jpe?g|png|gif|webp|bmp|svg|avif|ico))(?:![^/?#]*)?(?=([?#]|$))/i;

export interface GalleryImageLike {
  url?: string;
  src?: string;
  thumbnail?: string;
  order?: number;
}

/**
 * 把 attachment 组件的返回值取成字符串 URL。
 *
 * 不能直接 `String(value)`：对象会被转成 `"[object Object]"` 存进足迹数据，
 * 之后图片墙就再也显示不出来。
 */
export function unwrapAttachmentImageUrl(value: unknown): string {
  let current: unknown = value;
  if (Array.isArray(current)) current = current[0];
  if (current && typeof current === "object") {
    const image = current as GalleryImageLike & { path?: unknown };
    current = image.url ?? image.src ?? image.thumbnail ?? image.path ?? "";
  }
  return String(current ?? "").trim();
}

/**
 * 归一化附件 URL：去掉图片处理后缀，保留查询串与锚点。
 *
 * 注意只用于「主图 / 图片墙」；票根图片要原样保存后缀（见编辑窗的注释），
 * 因此票根走 {@link unwrapAttachmentImageUrl} 而不是这个函数。
 */
export function normalizeAttachmentImageUrl(value: unknown): string {
  return unwrapAttachmentImageUrl(value).replace(IMAGE_PROCESS_SUFFIX, "$1");
}

/**
 * 把足迹里存的 galleryImages 还原成编辑器使用的有序列表。
 *
 * 历史数据可能是字符串数组（只有 URL）或对象数组（带 order），
 * 两种都要能读；缺失或非法的 order 按数组下标补齐。
 */
export function normalizeGalleryImagesForEditor(images: unknown): GalleryImageLike[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((item, index) => {
      if (typeof item === "string") {
        return { url: item, order: index + 1 };
      }
      if (item && typeof item === "object") {
        const image = item as GalleryImageLike;
        const order = Number(image.order);
        return {
          url: image.url || image.src || image.thumbnail || "",
          order: Number.isInteger(order) && order > 0 ? order : index + 1,
        };
      }
      return { url: "", order: index + 1 };
    })
    .filter((item) => item.url)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
