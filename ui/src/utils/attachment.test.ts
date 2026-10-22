import { describe, expect, it } from "vitest";
import {
  normalizeAttachmentImageUrl,
  normalizeGalleryImagesForEditor,
  unwrapAttachmentImageUrl,
} from "@/utils/attachment";

describe("unwrapAttachmentImageUrl", () => {
  it("字符串原样返回并去空白", () => {
    expect(unwrapAttachmentImageUrl("  https://a.com/x.jpg ")).toBe("https://a.com/x.jpg");
  });

  it("单元素数组取第一项", () => {
    expect(unwrapAttachmentImageUrl(["https://a.com/y.jpg"])).toBe("https://a.com/y.jpg");
  });

  it("对象按 url / src / thumbnail / path 依次取", () => {
    expect(unwrapAttachmentImageUrl({ url: "u" })).toBe("u");
    expect(unwrapAttachmentImageUrl({ src: "s" })).toBe("s");
    expect(unwrapAttachmentImageUrl({ thumbnail: "t" })).toBe("t");
    expect(unwrapAttachmentImageUrl({ path: "p" })).toBe("p");
  });

  it("对象里没有任何图片字段时返回空串而不是 [object Object]", () => {
    expect(unwrapAttachmentImageUrl({})).toBe("");
    expect(unwrapAttachmentImageUrl(null)).toBe("");
    expect(unwrapAttachmentImageUrl(undefined)).toBe("");
  });
});

describe("normalizeAttachmentImageUrl", () => {
  it("去掉图片处理后缀", () => {
    expect(normalizeAttachmentImageUrl("https://a.com/x.jpg!w100")).toBe(
      "https://a.com/x.jpg",
    );
  });

  it("保留查询串与锚点", () => {
    expect(normalizeAttachmentImageUrl("https://a.com/x.jpg!w100?v=1")).toBe(
      "https://a.com/x.jpg?v=1",
    );
    expect(normalizeAttachmentImageUrl("https://a.com/x.png!s#frag")).toBe(
      "https://a.com/x.png#frag",
    );
  });

  it("没有后缀时保持不变", () => {
    expect(normalizeAttachmentImageUrl("https://a.com/x.webp")).toBe(
      "https://a.com/x.webp",
    );
  });

  it("看起来像后缀但不是图片扩展名时不误删", () => {
    expect(normalizeAttachmentImageUrl("https://a.com/file.txt!w100")).toBe(
      "https://a.com/file.txt!w100",
    );
  });
});

describe("normalizeGalleryImagesForEditor", () => {
  it("非数组返回空列表", () => {
    expect(normalizeGalleryImagesForEditor(undefined)).toEqual([]);
    expect(normalizeGalleryImagesForEditor("https://a.com/x.jpg")).toEqual([]);
  });

  it("字符串数组按下标补 order", () => {
    expect(normalizeGalleryImagesForEditor(["a.jpg", "b.jpg"])).toEqual([
      { url: "a.jpg", order: 1 },
      { url: "b.jpg", order: 2 },
    ]);
  });

  it("对象数组保留合法 order 并按 order 排序", () => {
    expect(
      normalizeGalleryImagesForEditor([
        { url: "b.jpg", order: 2 },
        { url: "a.jpg", order: 1 },
      ]),
    ).toEqual([
      { url: "a.jpg", order: 1 },
      { url: "b.jpg", order: 2 },
    ]);
  });

  it("order 非法时按下标补齐", () => {
    expect(
      normalizeGalleryImagesForEditor([
        { url: "a.jpg", order: 0 },
        { url: "b.jpg", order: -3 },
      ]),
    ).toEqual([
      { url: "a.jpg", order: 1 },
      { url: "b.jpg", order: 2 },
    ]);
  });

  it("过滤空 URL，但保留后续项的 order", () => {
    expect(
      normalizeGalleryImagesForEditor([
        { url: "a.jpg", order: 1 },
        { url: "", order: 2 },
        { url: "c.jpg", order: 3 },
      ]),
    ).toEqual([
      { url: "a.jpg", order: 1 },
      { url: "c.jpg", order: 3 },
    ]);
  });
});
