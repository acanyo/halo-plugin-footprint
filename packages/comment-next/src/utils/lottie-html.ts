import {
  createLottieData,
  decodeLottieMetadata,
  encodeLottieMetadata,
  type LottieImageData,
  type LottieImageUpgradeOptions,
  limitLottieDimensions,
  normalizeLottieDimensions,
} from './lottie-data';
import {
  isLegacyLottieSource,
  isSupportedLottiePath,
  looksLikeLottieSource,
  resolveAllowedLottieSource,
  stripLegacyLottieMarkerParams,
} from './lottie-source-policy';
import { unwrapMarkdownLink } from './markdown-link';

export type { LottieImageData, LottieImageUpgradeOptions } from './lottie-data';

export const LOTTIE_ALLOWED_ATTRIBUTES = new Set([
  'src',
  'format',
  'width',
  'height',
  'autoplay',
  'loop',
  'speed',
  'fit',
  'align',
  'controls',
  'hover-play',
  'freeze-on-offscreen',
  'aria-label',
]);

type LottieSanitizeMode = 'display' | 'submit';

export type LottieImageResolution =
  | { status: 'not-lottie' }
  | { status: 'blocked' }
  | { status: 'allowed'; data: LottieImageData };

export function sanitizeLottieElement(
  element: Element,
  mode: LottieSanitizeMode,
  allowedLottieHosts: readonly unknown[] = []
): void {
  for (const attribute of Array.from(element.attributes)) {
    const attributeName = attribute.name.toLowerCase();
    if (
      !LOTTIE_ALLOWED_ATTRIBUTES.has(attributeName) ||
      attributeName.startsWith('on')
    ) {
      element.removeAttribute(attribute.name);
    }
  }

  const source = resolveAllowedLottieSource(
    element.getAttribute('src') ?? '',
    allowedLottieHosts
  );
  if (!source) {
    element.remove();
    return;
  }

  const data = createLottieData({
    src: stripLegacyLottieMarkerParams(source.url),
    inferredFormat: source.inferredFormat,
    format: element.getAttribute('format'),
    width: element.getAttribute('width'),
    height: element.getAttribute('height'),
    autoplay: element.getAttribute('autoplay'),
    loop: element.getAttribute('loop'),
    speed: element.getAttribute('speed'),
    fit: element.getAttribute('fit'),
    align: element.getAttribute('align'),
    controls: element.getAttribute('controls'),
    hoverPlay: element.getAttribute('hover-play'),
    freezeOnOffscreen: element.getAttribute('freeze-on-offscreen'),
    ariaLabel: element.getAttribute('aria-label'),
  });

  if (mode === 'submit') {
    replaceWithStoredLottieImage(element, data);
    return;
  }

  applyDisplayAttributes(element, data);
  element.replaceChildren();
}

export function resolveLottieImage(
  element: Element,
  allowedLottieHosts: readonly unknown[] = []
): LottieImageResolution {
  const rawSource = element.getAttribute('src') ?? '';
  const metadata = decodeLottieMetadata(element.getAttribute('title'));
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(unwrapMarkdownLink(rawSource), window.location.origin);
  } catch {
    return metadata || looksLikeLottieSource(rawSource)
      ? { status: 'blocked' }
      : { status: 'not-lottie' };
  }

  const hasLegacyQueryMarker = isLegacyLottieSource(parsedUrl);
  const sourceLooksLikeLottie = isSupportedLottiePath(parsedUrl.pathname);
  if (!hasLegacyQueryMarker && !metadata && !sourceLooksLikeLottie) {
    return { status: 'not-lottie' };
  }

  const source = resolveAllowedLottieSource(rawSource, allowedLottieHosts);
  if (!source) {
    return { status: 'blocked' };
  }

  const dimensions = normalizeLottieDimensions(
    parsedUrl.searchParams.get('width') ?? element.getAttribute('width'),
    parsedUrl.searchParams.get('height') ?? element.getAttribute('height')
  );
  const data = createLottieData({
    src: hasLegacyQueryMarker
      ? stripLegacyLottieMarkerParams(source.url)
      : source.url.href,
    inferredFormat: source.inferredFormat,
    format: metadata?.format ?? parsedUrl.searchParams.get('format'),
    width: String(dimensions.width),
    height: String(dimensions.height),
    autoplay: metadata?.autoplay ?? parsedUrl.searchParams.get('autoplay'),
    loop: metadata?.loop ?? parsedUrl.searchParams.get('loop'),
    speed: metadata?.speed ?? parsedUrl.searchParams.get('speed'),
    fit: metadata?.fit ?? parsedUrl.searchParams.get('fit'),
    align: metadata?.align ?? parsedUrl.searchParams.get('align'),
    controls: metadata?.controls ?? parsedUrl.searchParams.get('controls'),
    hoverPlay: metadata?.hoverPlay ?? parsedUrl.searchParams.get('hover-play'),
    freezeOnOffscreen:
      metadata?.freezeOnOffscreen ??
      parsedUrl.searchParams.get('freeze-on-offscreen'),
    ariaLabel: metadata?.ariaLabel ?? parsedUrl.searchParams.get('aria-label'),
  });
  return { status: 'allowed', data };
}

export function replaceWithLottie(
  element: Element,
  data: LottieImageData
): void {
  const lottie = document.createElement('halo-lottie');
  applyDisplayAttributes(lottie, data);
  element.replaceWith(lottie);
}

export function replaceWithStoredLottieImage(
  element: Element,
  data: LottieImageData
): void {
  const image = document.createElement('img');
  image.setAttribute('src', data.src);
  image.setAttribute('alt', data.ariaLabel || 'Lottie 动画');
  image.setAttribute('width', String(data.width));
  image.setAttribute('height', String(data.height));
  image.setAttribute('title', encodeLottieMetadata(data));
  element.replaceWith(image);
}

/**
 * Upgrade Halo-safe Lottie images rendered outside the comment widget while
 * enforcing the same source policy used by the comment sanitizer.
 */
export function upgradeLottieImages(
  root: ParentNode,
  allowedLottieHosts: readonly unknown[] = [],
  options: LottieImageUpgradeOptions = {}
): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  const images: HTMLImageElement[] = [];
  if (root instanceof Element && root.matches('img[src]')) {
    images.push(root as HTMLImageElement);
  }
  images.push(...root.querySelectorAll<HTMLImageElement>('img[src]'));

  let upgraded = false;
  for (const image of images) {
    const resolution = resolveLottieImage(image, allowedLottieHosts);
    if (resolution.status === 'blocked') {
      image.remove();
      continue;
    }
    if (resolution.status !== 'allowed' || !image.isConnected) {
      continue;
    }

    replaceWithLottie(image, limitLottieDimensions(resolution.data, options));
    upgraded = true;
  }

  return upgraded;
}

function applyDisplayAttributes(element: Element, data: LottieImageData): void {
  element.setAttribute('src', data.src);
  element.setAttribute('format', data.format);
  element.setAttribute('width', String(data.width));
  element.setAttribute('height', String(data.height));
  element.setAttribute('autoplay', 'true');
  element.setAttribute('loop', data.loop);
  element.setAttribute('speed', data.speed);
  element.setAttribute('fit', data.fit);
  element.setAttribute('align', data.align);
  element.setAttribute('controls', data.controls);
  element.setAttribute('hover-play', 'false');
  element.setAttribute('freeze-on-offscreen', 'true');
  if (data.ariaLabel) {
    element.setAttribute('aria-label', data.ariaLabel);
  } else {
    element.removeAttribute('aria-label');
  }
}
