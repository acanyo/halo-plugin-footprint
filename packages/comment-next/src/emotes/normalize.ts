import { DEFAULT_COMMENT_NEXT_EMOTE_PACKS } from './default-packs';
import type {
  CommentNextEmoteItem,
  CommentNextEmotePack,
  CommentNextEmoteProvider,
  CommentNextEmoteType,
  CommentNextLottieDefaults,
  CommentNextRawEmotePack,
} from '../types/emote';

type NamedRawPack = { name: string; id?: string; pack: CommentNextRawEmotePack };

export function normalizeCommentNextEmotePacks(
  value: unknown
): CommentNextEmotePack[] {
  const rawPacks = normalizeRawPacks(value)
    ?? Object.entries(DEFAULT_COMMENT_NEXT_EMOTE_PACKS).map(([name, pack]) => ({
      name,
      id: undefined,
      pack,
    }));

  return rawPacks
    .map(({ name, id, pack }) => normalizePack(name, id, pack))
    .filter((pack): pack is CommentNextEmotePack => Boolean(pack));
}

function normalizeRawPacks(value: unknown): NamedRawPack[] | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') {
    try { return normalizeRawPacks(JSON.parse(value)); } catch { return undefined; }
  }
  if (Array.isArray(value) || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.packs)) {
    return record.packs
      .map((pack, index) => normalizeNamedPack(pack, index))
      .filter((pack): pack is NamedRawPack => Boolean(pack));
  }
  return Object.entries(record)
    .filter(([name]) => name !== 'packs')
    .map(([name, pack]) => ({ name, pack: pack as CommentNextRawEmotePack }));
}

function normalizeNamedPack(value: unknown, index: number): NamedRawPack | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as CommentNextRawEmotePack;
  const name = normalizeString(raw.name) || normalizeString(raw.id) || `表情包 ${index + 1}`;
  return { name, id: normalizeString(raw.id) || undefined, pack: raw };
}

function normalizePack(name: string, explicitId: string | undefined, pack: unknown): CommentNextEmotePack | undefined {
  if (!pack || typeof pack !== 'object') return undefined;
  const rawPack = pack as CommentNextRawEmotePack;
  const provider = normalizeProvider(rawPack.provider, rawPack.type);
  const type = provider === 'LOTTIE' ? 'lottie' : normalizeType(rawPack.type);
  const container = Array.isArray(rawPack.container) ? rawPack.container : [];
  const id = explicitId || createStableId(name);
  const items = container
    .map((item, index) => normalizeItem(id, provider, type, item, index))
    .filter((item): item is CommentNextEmoteItem => Boolean(item));
  if (!items.length) return undefined;
  return { id, name, provider, type, items };
}

function normalizeProvider(provider: unknown, type: unknown): CommentNextEmoteProvider {
  return provider === 'LOTTIE' || type === 'lottie' ? 'LOTTIE' : 'OWO';
}

function normalizeType(value: unknown): CommentNextEmoteType {
  return value === 'image' ? 'image' : 'emoticon';
}

function normalizeItem(packId: string, provider: CommentNextEmoteProvider, type: CommentNextEmoteType, value: unknown, index: number): CommentNextEmoteItem | undefined {
  if (provider === 'LOTTIE') return normalizeLottieItem(packId, value, index);
  const rawItem = normalizeRawItem(value);
  if (!rawItem) return undefined;
  const itemValue = type === 'image' ? rawItem.previewSrc : rawItem.icon;
  if (!itemValue) return undefined;
  return {
    id: `${packId}-${index}-${createStableId(itemValue)}`,
    type,
    provider,
    label: rawItem.text || itemValue,
    value: itemValue,
    description: rawItem.text,
    previewSrc: type === 'image' ? rawItem.previewSrc : undefined,
    originSrc: type === 'image' ? rawItem.originSrc : undefined,
    src: type === 'image' ? (rawItem.originSrc || rawItem.previewSrc) : undefined,
  };
}

function normalizeLottieItem(packId: string, value: unknown, index: number): CommentNextEmoteItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const animationName = normalizeString(raw.animationName || raw.name || raw.id);
  const contentUrl = normalizeUrl(normalizeString(raw.contentUrl || raw.src || raw.url));
  if (!animationName || !contentUrl) return undefined;
  const text = normalizeString(raw.text || raw.displayName);
  return {
    id: `${packId}-${index}-${createStableId(animationName)}`,
    type: 'lottie',
    provider: 'LOTTIE',
    label: text || animationName,
    value: animationName,
    description: text,
    animationName,
    contentUrl,
    format: normalizeFormat(raw.format),
    defaults: normalizeLottieDefaults(raw.defaults),
  };
}

function normalizeRawItem(value: unknown): { icon: string; previewSrc: string; originSrc: string; text: string } | undefined {
  if (typeof value === 'string') {
    const icon = value.trim();
    return { icon, previewSrc: normalizeUrl(extractImageAttribute(icon, 'src') || icon), originSrc: normalizeUrl(extractImageAttribute(icon, 'origin')), text: '' };
  }
  if (!value || typeof value !== 'object') return undefined;
  const item = value as { icon?: unknown; src?: unknown; url?: unknown; text?: unknown; name?: unknown };
  const icon = normalizeString(item.icon);
  const rawSrc = normalizeString(item.src) || normalizeString(item.url) || extractImageAttribute(icon, 'src') || icon;
  return { icon, previewSrc: normalizeUrl(rawSrc), originSrc: normalizeUrl(extractImageAttribute(icon, 'origin')), text: normalizeString(item.text) || normalizeString(item.name) };
}

export function normalizeLottieDefaults(value: unknown): CommentNextLottieDefaults {
  const defaults = value && typeof value === 'object' ? value as Partial<CommentNextLottieDefaults> : {};
  const positiveNumber = (candidate: unknown, fallback: number) => {
    const number = Number(candidate);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };
  const booleanValue = (candidate: unknown, fallback: boolean) => typeof candidate === 'boolean' ? candidate : fallback;
  return {
    width: positiveNumber(defaults.width, 160),
    height: positiveNumber(defaults.height, 160),
    autoplay: booleanValue(defaults.autoplay, false),
    loop: booleanValue(defaults.loop, true),
    speed: Math.min(10, positiveNumber(defaults.speed, 1)),
    fit: normalizeEnum(defaults.fit, ['contain', 'cover', 'fill', 'none', 'fit-width', 'fit-height'], 'contain'),
    align: normalizeEnum(defaults.align, ['center', 'top', 'bottom', 'left', 'right'], 'center'),
    controls: booleanValue(defaults.controls, false),
    hoverPlay: booleanValue(defaults.hoverPlay, true),
    freezeOnOffscreen: booleanValue(defaults.freezeOnOffscreen, true),
    ariaLabel: normalizeString(defaults.ariaLabel),
  };
}

function normalizeEnum(value: unknown, values: string[], fallback: string): string {
  return typeof value === 'string' && values.includes(value) ? value : fallback;
}

function normalizeFormat(value: unknown): string {
  return normalizeEnum(value, ['json', 'tgs', 'lottie'], 'json');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createStableId(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9\u3400-\u9fff]+/g, '-').replaceAll(/^-|-$/g, '') || 'emote';
}

function extractImageAttribute(value: string, attribute: string): string {
  const pattern = new RegExp(`${attribute}=['"]([^'"]+)['"]`, 'i');
  return value.match(pattern)?.[1] ?? '';
}

function normalizeUrl(value: string): string {
  return value.startsWith('//') ? `https:${value}` : value;
}
