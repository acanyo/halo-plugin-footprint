import { unwrapMarkdownLink } from './markdown-link';

const LOTTIE_MARKER_PARAM = 'comment-next-lottie';
const LOTTIE_MARKER_VALUE = '1';
const LOTTIE_MARKER_PARAMS = new Set([
  LOTTIE_MARKER_PARAM,
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

export type LottieFormat = 'json' | 'tgs' | 'lottie';

export type AllowedLottieSource = {
  url: URL;
  inferredFormat?: LottieFormat;
};

export function resolveAllowedLottieSource(
  value: string,
  allowedLottieHosts: readonly unknown[]
): AllowedLottieSource | undefined {
  const unwrapped = unwrapMarkdownLink(value);
  const normalized = unwrapped.startsWith('//')
    ? `https:${unwrapped}`
    : unwrapped.trim();

  try {
    const url = new URL(normalized, window.location.origin);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return undefined;
    }

    const inferredFormat = inferLottieFormat(url.pathname);
    if (!inferredFormat && !isPublicLottieContentPath(url.pathname)) {
      return undefined;
    }

    const isSameOrigin = url.origin === window.location.origin;
    const isAllowedExternalHost =
      url.protocol === 'https:' &&
      isAllowedLottieHost(url.host, allowedLottieHosts);
    if (!isSameOrigin && !isAllowedExternalHost) {
      return undefined;
    }

    return { url, inferredFormat };
  } catch {
    return undefined;
  }
}

export function isLegacyLottieSource(url: URL): boolean {
  return url.searchParams.get(LOTTIE_MARKER_PARAM) === LOTTIE_MARKER_VALUE;
}

export function isSupportedLottiePath(pathname: string): boolean {
  return (
    Boolean(inferLottieFormat(pathname)) || isPublicLottieContentPath(pathname)
  );
}

export function looksLikeLottieSource(value: string): boolean {
  return /(?:comment-next-lottie|\.(?:json|tgs|lottie))(?:[?#]|$)/i.test(value);
}

export function normalizeLottieFormat(
  value: string | null | undefined
): LottieFormat | undefined {
  const format = value?.trim().toLowerCase();
  return format === 'json' || format === 'tgs' || format === 'lottie'
    ? format
    : undefined;
}

export function stripLegacyLottieMarkerParams(url: URL): string {
  if (!isLegacyLottieSource(url)) {
    return url.href;
  }

  const sanitized = new URL(url.href);
  for (const parameter of LOTTIE_MARKER_PARAMS) {
    sanitized.searchParams.delete(parameter);
  }
  return sanitized.href;
}

function isAllowedLottieHost(
  host: string,
  allowedLottieHosts: readonly unknown[]
): boolean {
  const normalizedHost = normalizeLottieHostAndPort(host);
  if (!normalizedHost) {
    return false;
  }

  return allowedLottieHosts.some((value) => {
    const rawHost =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object' && 'host' in value
          ? (value as { host?: unknown }).host
          : undefined;
    return normalizeAllowedLottieHost(rawHost) === normalizedHost;
  });
}

function normalizeAllowedLottieHost(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const input = value.trim();
  if (!input) {
    return '';
  }

  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return '';
    }
    return normalizeLottieHostAndPort(url.host);
  } catch {
    return '';
  }
}

function normalizeLottieHostAndPort(value: string): string {
  try {
    const url = new URL(`https://${value.trim()}`);
    const hostname = url.hostname.replace(/\.+$/, '').toLowerCase();
    if (!hostname) {
      return '';
    }
    return `${hostname}:${url.port || '443'}`;
  } catch {
    return '';
  }
}

function inferLottieFormat(pathname: string): LottieFormat | undefined {
  const match = pathname.match(/\.(json|tgs|lottie)$/i);
  return normalizeLottieFormat(match?.[1]);
}

function isPublicLottieContentPath(pathname: string): boolean {
  return /^\/apis\/api\.lottie\.halo\.run\/v1alpha1\/animations\/[^/]+\/content\/?$/.test(
    pathname
  );
}
