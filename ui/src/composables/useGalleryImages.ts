/**
 * 足迹图片墙的 URL ↔ 有序图片项同步。
 *
 * 表单里绑定给 attachment 组件的是 `string[]`（组件的入参类型），
 * 但提交给接口时需要 `{ url, order }[]`，拖动排序也作用在带 order 的列表上。
 * 两边要保持同步，规则还不简单：attachment 返回的 URL 可能带图片处理后缀，
 * 而原 URL 里的后缀要保留 —— 直接归一化会把用户上传的图变成另一个地址。
 *
 * 这段逻辑原先夹在编辑窗的 script 里，watch 与 normalize 互相调用，读起来很绕。
 * 单独成 composable 后，规则集中在一处，也方便将来别的地方复用。
 */

import { ref, watch } from "vue";
import type { GalleryImage } from "@/api/models";
import {
  normalizeAttachmentImageUrl,
  normalizeGalleryImagesForEditor,
} from "@/utils/attachment";

/**
 * @param initialUrls 表单绑定的 URL 列表
 */
export function useGalleryImages(initialUrls: string[] = []) {
  const urls = ref<string[]>([...initialUrls]);
  const items = ref<GalleryImage[]>([]);

  /**
   * 用新的 URL 列表重建 items，尽量保留已有的原始 URL。
   *
   * 为什么要保留：`normalizeAttachmentImageUrl` 会去掉 `!w100` 这类处理后缀，
   * 而用户在附件库里选中的可能就是带后缀的地址。这里只把归一化结果用于**比较**，
   * 真正存回 `urls` 时优先用原值。
   */
  function syncFromUrls(nextUrls: string[]) {
    const existing = new Map(
      items.value.map((item) => [normalizeAttachmentImageUrl(item.url), item.url]),
    );
    const normalized = nextUrls.map(normalizeAttachmentImageUrl).filter(Boolean);
    const original = nextUrls.map((url) => String(url ?? "").trim()).filter(Boolean);

    items.value = normalized.map((url, index) => ({
      url: existing.get(url) ?? original[index] ?? url,
      order: index + 1,
    }));

    // 只有确实归一化掉了东西时才回写，避免 watch 自己触发自己
    const changed =
      normalized.length !== nextUrls.length ||
      normalized.some((url, index) => url !== nextUrls[index]);
    if (changed) {
      urls.value = normalized;
    }
  }

  /** 从足迹数据初始化（编辑模式）。 */
  function loadFromFootprint(galleryImages: unknown) {
    items.value = normalizeGalleryImagesForEditor(galleryImages) as GalleryImage[];
    urls.value = items.value.map((item) => normalizeAttachmentImageUrl(item.url));
  }

  function reset() {
    urls.value = [];
    items.value = [];
  }

  /** 提交给接口的形式：只保留有 URL 的项，order 按下标重排。 */
  function toSubmit(): GalleryImage[] {
    return items.value
      .filter((item) => item.url)
      .map((item, index) => ({ url: item.url, order: index + 1 }));
  }

  /** 顺序列表，供 validateGalleryOrders 使用。 */
  function orders(): number[] {
    return toSubmit().map((item) => item.order);
  }

  watch(urls, (next) => syncFromUrls(next), { deep: true });

  return { urls, items, loadFromFootprint, reset, toSubmit, orders };
}
