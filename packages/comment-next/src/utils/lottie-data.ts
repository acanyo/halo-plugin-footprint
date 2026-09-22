import {
  type LottieFormat,
  normalizeLottieFormat,
} from './lottie-source-policy';

const LOTTIE_METADATA_PREFIX = 'comment-next-lottie:';

export type LottieImageData = {
  src: string;
  format: LottieFormat;
  width: number;
  height: number;
  autoplay: string;
  loop: string;
  speed: string;
  fit: string;
  align: string;
  controls: string;
  hoverPlay: string;
  freezeOnOffscreen: string;
  ariaLabel: string;
};

export interface LottieImageUpgradeOptions {
  maxWidth?: number;
  maxHeight?: number;
}

export type LottieMetadata = Pick<
  LottieImageData,
  | 'format'
  | 'autoplay'
  | 'loop'
  | 'speed'
  | 'fit'
  | 'align'
  | 'controls'
  | 'hoverPlay'
  | 'freezeOnOffscreen'
  | 'ariaLabel'
>;

export function createLottieData(values: {
  src: string;
  inferredFormat?: LottieFormat;
  format?: string | null;
  width?: string | null;
  height?: string | null;
  autoplay?: string | null;
  loop?: string | null;
  speed?: string | null;
  fit?: string | null;
  align?: string | null;
  controls?: string | null;
  hoverPlay?: string | null;
  freezeOnOffscreen?: string | null;
  ariaLabel?: string | null;
}): LottieImageData {
  const dimensions = normalizeLottieDimensions(values.width, values.height);
  return {
    src: values.src,
    format:
      normalizeLottieFormat(values.format) ?? values.inferredFormat ?? 'json',
    width: dimensions.width,
    height: dimensions.height,
    autoplay: normalizeBooleanAttribute(values.autoplay, true),
    loop: normalizeBooleanAttribute(values.loop, true),
    speed: normalizeLottieSpeed(values.speed),
    fit: normalizeLottieFit(values.fit),
    align: normalizeLottieAlign(values.align),
    controls: normalizeBooleanAttribute(values.controls, false),
    hoverPlay: normalizeBooleanAttribute(values.hoverPlay, false),
    freezeOnOffscreen: normalizeBooleanAttribute(
      values.freezeOnOffscreen,
      true
    ),
    ariaLabel: (values.ariaLabel ?? '').trim().slice(0, 120),
  };
}

export function normalizeLottieDimensions(
  widthValue: string | null | undefined,
  heightValue: string | null | undefined
): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(parsePositiveDimension(widthValue, 160))),
    height: Math.max(1, Math.round(parsePositiveDimension(heightValue, 160))),
  };
}

export function limitLottieDimensions(
  data: LottieImageData,
  options: LottieImageUpgradeOptions
): LottieImageData {
  const maxWidth = normalizeLottieDimensionLimit(options.maxWidth);
  const maxHeight = normalizeLottieDimensionLimit(options.maxHeight);
  if (!maxWidth && !maxHeight) {
    return data;
  }

  const scale = Math.min(
    1,
    maxWidth ? maxWidth / data.width : 1,
    maxHeight ? maxHeight / data.height : 1
  );
  return {
    ...data,
    width: Math.max(1, Math.round(data.width * scale)),
    height: Math.max(1, Math.round(data.height * scale)),
  };
}

export function encodeLottieMetadata(metadata: LottieMetadata): string {
  const params = new URLSearchParams({
    format: metadata.format,
    autoplay: metadata.autoplay,
    loop: metadata.loop,
    speed: metadata.speed,
    fit: metadata.fit,
    align: metadata.align,
    controls: metadata.controls,
    hoverPlay: metadata.hoverPlay,
    freezeOnOffscreen: metadata.freezeOnOffscreen,
    ariaLabel: metadata.ariaLabel,
  });
  return `${LOTTIE_METADATA_PREFIX}${params.toString()}`;
}

export function decodeLottieMetadata(
  value: string | null
): LottieMetadata | undefined {
  if (!value?.startsWith(LOTTIE_METADATA_PREFIX)) {
    return undefined;
  }

  try {
    const params = new URLSearchParams(
      value.slice(LOTTIE_METADATA_PREFIX.length)
    );
    return {
      format: normalizeLottieFormat(params.get('format')) ?? 'json',
      autoplay: params.get('autoplay') ?? 'true',
      loop: params.get('loop') ?? 'true',
      speed: params.get('speed') ?? '1',
      fit: params.get('fit') ?? 'contain',
      align: params.get('align') ?? 'center',
      controls: params.get('controls') ?? 'false',
      hoverPlay: params.get('hoverPlay') ?? 'false',
      freezeOnOffscreen: params.get('freezeOnOffscreen') ?? 'true',
      ariaLabel: params.get('ariaLabel') ?? '',
    };
  } catch {
    return undefined;
  }
}

function normalizeLottieDimensionLimit(
  value: number | undefined
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function parsePositiveDimension(
  value: string | null | undefined,
  fallback: number
): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(number, 4096)
    : fallback;
}

function normalizeLottieSpeed(value: string | null | undefined): string {
  if (typeof value !== 'string' || !value.trim()) {
    return '1';
  }

  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0
    ? String(Math.min(10, Math.max(0.1, speed)))
    : '1';
}

function normalizeBooleanAttribute(
  value: string | null | undefined,
  fallback: boolean
): string {
  if (value === null || value === undefined) {
    return fallback ? 'true' : 'false';
  }
  return value.trim().toLowerCase() === 'false' ? 'false' : 'true';
}

function normalizeLottieFit(value: string | null | undefined): string {
  const fit = value?.trim();
  return fit &&
    ['contain', 'cover', 'fill', 'none', 'fit-width', 'fit-height'].includes(
      fit
    )
    ? fit
    : 'contain';
}

function normalizeLottieAlign(value: string | null | undefined): string {
  const align = value?.trim();
  return align && ['center', 'top', 'bottom', 'left', 'right'].includes(align)
    ? align
    : 'center';
}
