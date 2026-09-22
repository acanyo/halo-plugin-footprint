import {
  replaceWithLottie,
  replaceWithStoredLottieImage,
  resolveLottieImage,
  sanitizeLottieElement,
} from './lottie-html';
import { unwrapMarkdownLink } from './markdown-link';

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'halo-lottie',
  'u',
  'ul',
]);

const GLOBAL_ALLOWED_ATTRIBUTES = new Set(['title']);
const DISPLAY_TAG_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set([
    'src',
    'alt',
    'class',
    'loading',
    'decoding',
    'width',
    'height',
  ]),
};

const SUBMIT_TAG_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'title']),
  code: new Set(['class']),
  img: new Set(['align', 'alt', 'height', 'src', 'title', 'width']),
};

const REGULAR_IMAGE_METADATA_PREFIX = 'comment-next-image:';

interface SanitizeOptions {
  mode: 'display' | 'submit';
  allowImages: boolean;
  allowedLottieHosts: readonly unknown[];
}

export function sanitizeCommentHtml(
  value: string,
  allowedLottieHosts: readonly unknown[] = []
): string {
  return sanitizeHtml(value, {
    mode: 'display',
    allowImages: true,
    allowedLottieHosts,
  });
}

export function sanitizeCommentSubmitHtml(
  value: string,
  allowedLottieHosts: readonly unknown[] = []
): string {
  return sanitizeHtml(value, {
    mode: 'submit',
    allowImages: true,
    allowedLottieHosts,
  });
}

export function sanitizeConsoleCommentHtml(
  value: string,
  allowedLottieHosts: readonly unknown[] = []
): string {
  return sanitizeHtml(value, {
    mode: 'display',
    allowImages: false,
    allowedLottieHosts,
  });
}

function sanitizeHtml(value: string, options: SanitizeOptions): string {
  if (!value.trim()) {
    return '';
  }

  if (typeof document === 'undefined') {
    return escapeHtml(value);
  }

  const template = document.createElement('template');
  template.innerHTML = value;
  sanitizeChildren(template.content, options);
  return template.innerHTML;
}

function sanitizeChildren(parent: ParentNode, options: SanitizeOptions): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      sanitizeElement(node as Element, options);
      continue;
    }

    if (node.nodeType !== Node.TEXT_NODE) {
      node.remove();
    }
  }
}

function sanitizeElement(element: Element, options: SanitizeOptions): void {
  const tagName = element.tagName.toLowerCase();
  const imageClassName =
    tagName === 'img' ? element.getAttribute('class') : null;

  if (tagName === 'img') {
    const lottie = resolveLottieImage(element, options.allowedLottieHosts);
    if (lottie.status === 'blocked') {
      element.remove();
      return;
    }
    if (lottie.status === 'allowed') {
      if (options.mode === 'display') {
        replaceWithLottie(element, lottie.data);
      } else {
        replaceWithStoredLottieImage(element, lottie.data);
      }
      return;
    }

    if (!options.allowImages) {
      element.remove();
      return;
    }
  }

  if (tagName === 'halo-lottie') {
    sanitizeLottieElement(element, options.mode, options.allowedLottieHosts);
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    element.replaceWith(document.createTextNode(element.textContent ?? ''));
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    const attributeName = attribute.name.toLowerCase();
    const allowedAttributes =
      options.mode === 'submit'
        ? SUBMIT_TAG_ALLOWED_ATTRIBUTES[tagName]
        : DISPLAY_TAG_ALLOWED_ATTRIBUTES[tagName];
    const isAllowed =
      GLOBAL_ALLOWED_ATTRIBUTES.has(attributeName) ||
      Boolean(allowedAttributes?.has(attributeName));

    if (!isAllowed || attributeName.startsWith('on')) {
      element.removeAttribute(attribute.name);
      continue;
    }

    if (attributeName === 'href' && !isSafeHref(attribute.value)) {
      element.removeAttribute(attribute.name);
    }
  }

  if (tagName === 'a' && options.mode === 'display') {
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer nofollow ugc');
  }

  if (tagName === 'img') {
    sanitizeImage(element as HTMLImageElement, options, imageClassName);
  }

  sanitizeChildren(element, options);
}

function sanitizeImage(
  image: HTMLImageElement,
  options: SanitizeOptions,
  originalClassName: string | null
): void {
  const src = normalizeImageSrc(image.getAttribute('src') ?? '');
  if (!src) {
    image.replaceWith(document.createTextNode(image.getAttribute('alt') ?? ''));
    return;
  }

  image.setAttribute('src', src);
  image.setAttribute('alt', image.getAttribute('alt') ?? '表情');

  const dimensions = normalizeImageDimensions(
    image.getAttribute('width'),
    image.getAttribute('height')
  );
  if (dimensions.width) {
    image.setAttribute('width', String(dimensions.width));
  } else {
    image.removeAttribute('width');
  }
  if (dimensions.height) {
    image.setAttribute('height', String(dimensions.height));
  } else {
    image.removeAttribute('height');
  }

  const metadata = decodeRegularImageMetadata(image.getAttribute('title'));
  const imageClass = normalizeImageClass(originalClassName, Boolean(metadata));

  if (options.mode === 'submit' && imageClass === 'comment-next-image') {
    image.setAttribute(
      'title',
      encodeRegularImageMetadata(
        metadata?.title ?? image.getAttribute('title') ?? ''
      )
    );
  }

  if (options.mode === 'display') {
    if (metadata?.title) {
      image.setAttribute('title', metadata.title);
    } else if (metadata) {
      image.removeAttribute('title');
    }
    image.setAttribute('class', imageClass);
    image.setAttribute('loading', 'lazy');
    image.setAttribute('decoding', 'async');
  }
}

function normalizeImageClass(
  value: string | null,
  hasRegularImageMetadata: boolean
): 'comment-next-emote-image' | 'comment-next-image' {
  const classes = new Set((value ?? '').split(/\s+/).filter(Boolean));
  if (
    hasRegularImageMetadata ||
    classes.has('comment-next-editor-image') ||
    classes.has('comment-next-image')
  ) {
    return 'comment-next-image';
  }
  if (
    classes.has('comment-next-editor-emote-image') ||
    classes.has('comment-next-emote-image')
  ) {
    return 'comment-next-emote-image';
  }

  return 'comment-next-emote-image';
}

type RegularImageMetadata = {
  title: string;
};

function encodeRegularImageMetadata(title: string): string {
  return `${REGULAR_IMAGE_METADATA_PREFIX}${encodeURIComponent(title)}`;
}

function decodeRegularImageMetadata(
  value: string | null
): RegularImageMetadata | undefined {
  if (!value?.startsWith(REGULAR_IMAGE_METADATA_PREFIX)) {
    return undefined;
  }

  try {
    return {
      title: decodeURIComponent(
        value.slice(REGULAR_IMAGE_METADATA_PREFIX.length)
      ),
    };
  } catch {
    return { title: '' };
  }
}

function normalizeImageDimensions(
  widthValue: string | null,
  heightValue: string | null
): { width?: number; height?: number } {
  return {
    width: parseOptionalPositiveDimension(widthValue),
    height: parseOptionalPositiveDimension(heightValue),
  };
}

function parseOptionalPositiveDimension(
  value: string | null
): number | undefined {
  if (value === null || !value.trim()) {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(4096, Math.round(number))
    : undefined;
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function normalizeImageSrc(value: string): string {
  const unwrapped = unwrapMarkdownLink(value);
  const normalizedValue = unwrapped.startsWith('//')
    ? `https:${unwrapped}`
    : unwrapped;

  try {
    const url = new URL(normalizedValue, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
