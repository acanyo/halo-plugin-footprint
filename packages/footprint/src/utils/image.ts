import type { FootprintConfig, FootprintSpec, LightboxImage } from '../types/footprint';

/**
 * 图片 URL 处理。
 *
 * 后台按用途配置了三套 from→to→suffix 规则（标记点 / 时间线详情 / 城市卡片墙），
 * 用于把原图 URL 换成图床的缩略图。逐字迁移自 travel-memory.js，
 * 包括其中「城市卡片墙三项都留空时回退到标记点规则」这条为兼容旧版而保留的行为。
 */

export type ImageScene = 'marker' | 'timeline' | 'cityWall';

interface Rule {
  from: string;
  to: string;
  suffix: string;
}

function ruleOf(config: Partial<FootprintConfig>, scene: ImageScene): Rule {
  if (scene === 'marker') {
    return {
      from: config.markerImageFrom || '',
      to: config.markerImageTo || '',
      suffix: config.markerImageSuffix || '',
    };
  }
  if (scene === 'timeline') {
    return {
      from: config.timelineImageFrom || '',
      to: config.timelineImageTo || '',
      suffix: config.timelineImageSuffix || '',
    };
  }
  return {
    from: config.cityWallImageFrom || '',
    to: config.cityWallImageTo || '',
    suffix: config.cityWallImageSuffix || '',
  };
}

/**
 * 按场景套用图片 URL 规则。
 *
 * 城市卡片墙有一条特殊回退：三项都没配时沿用「标记点」的 from→to（且不追加
 * 后缀）。这是旧版行为，不能为了「规则统一」把它抹掉——抹掉会让升级前配置了
 * 标记点规则的站点，卡片墙突然改用原图。
 */
export function applyImageRule(
  url: string | undefined | null,
  config: Partial<FootprintConfig>,
  scene: ImageScene
): string {
  if (!url) return url ?? '';
  const rule = ruleOf(config, scene);

  if (scene === 'cityWall' && !rule.from && !rule.to && !rule.suffix) {
    const marker = ruleOf(config, 'marker');
    if (marker.from && marker.to && String(url).includes(marker.from)) {
      return String(url).split(marker.from).join(marker.to);
    }
    return url;
  }

  let out = String(url);
  if (rule.from) out = out.split(rule.from).join(rule.to || '');
  if (rule.suffix && !out.endsWith(rule.suffix)) out += rule.suffix;
  return out;
}

/**
 * 归一化 Halo 附件字段。
 *
 * Halo 的附件在不同版本/配置下可能返回 URL 字符串、对象或单元素数组，
 * 直接 String() 会得到 "[object Object]"。控制台侧也有同样的坑。
 */
export function normalizeAttachmentUrl(value: unknown): string {
  let v: unknown = value;
  if (Array.isArray(v)) {
    v = v.find((item) => normalizeAttachmentUrl(item)) || '';
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown> & { spec?: { url?: string } };
    v = o.url ?? o.src ?? o.thumbnail ?? o.path ?? o.spec?.url ?? '';
  }
  const url = String(v ?? '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) {
    return typeof window !== 'undefined' ? window.location.protocol + url : `https:${url}`;
  }
  if (/^\//.test(url)) return url;
  return '';
}

/**
 * 取一条足迹的图集。
 *
 * galleryImages 可能是 JSON 字符串、字符串数组或对象数组；都没有时回退到封面图。
 */
export function galleryOf(spec: FootprintSpec | undefined | null): LightboxImage[] {
  if (!spec) return [];
  let gallery: unknown = spec.galleryImages;
  if (typeof gallery === 'string') {
    try {
      gallery = JSON.parse(gallery);
    } catch {
      gallery = [];
    }
  }
  const normalized: LightboxImage[] = Array.isArray(gallery)
    ? (gallery as unknown[])
        .map((item) =>
          typeof item === 'string'
            ? { url: item, caption: '' }
            : (item as LightboxImage)
        )
        .filter((item): item is LightboxImage => !!item && !!item.url)
    : [];
  if (normalized.length) return normalized;
  return spec.image ? [{ url: spec.image, caption: '' }] : [];
}
